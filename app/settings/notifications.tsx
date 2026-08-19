"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { savePushSubscription } from "./actions";

/**
 * "Enable notifications" (PR 8; ADR 0009). Reminders and partner-activity
 * pushes both need a subscription to exist before either can send anything,
 * and iOS requires that subscription be created from an explicit, in-app
 * user gesture — never on load (design decision 8 of the shared-calendar
 * plan) — which is why this is a plain button, not anything that runs in an
 * effect on mount (see components/push-resubscribe.tsx for the *silent*
 * re-subscribe path, which never calls `requestPermission` itself).
 */

function subscribeToNothing() {
  return () => {};
}

function getPermissionSnapshot(): NotificationPermission | "unsupported" {
  if (
    typeof Notification === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof window === "undefined" ||
    !("PushManager" in window)
  ) {
    return "unsupported";
  }
  return Notification.permission;
}

function getServerSnapshot(): null {
  return null;
}

/**
 * The live `Notification.permission` (or "unsupported"), read directly
 * rather than via `useState`+`useEffect` — see app/calendar/relative-time.tsx's
 * identical `useDeviceNow` comment: this repo's lint config flags a
 * synchronous `setState` call inside an effect, and `useSyncExternalStore`
 * gets the same "server and the client's first render agree, then diverge
 * safely" result with none. There is no browser event that fires when
 * permission changes, so `subscribe` is a no-op — the state this component
 * itself sets after a successful `handleEnable` triggers the re-render that
 * picks up the fresh value, exactly the way `useDeviceNow`'s doc comment
 * describes for its own no-op subscribe.
 */
function usePermission(): NotificationPermission | "unsupported" | null {
  return useSyncExternalStore(subscribeToNothing, getPermissionSnapshot, getServerSnapshot);
}

/**
 * Converts the VAPID public key's URL-safe base64 into the raw byte array
 * `pushManager.subscribe`'s `applicationServerKey` expects. Duplicated in
 * components/push-resubscribe.tsx rather than shared — both are tiny,
 * self-contained client-side leaf functions, and neither is in a position to
 * import the other without pulling this settings-only component's code path
 * into the root layout's own bundle.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  // `new Uint8Array(length)` (rather than `Uint8Array.from`) is what keeps
  // this backed by a plain `ArrayBuffer` — `pushManager.subscribe`'s
  // `applicationServerKey` type rejects the wider `ArrayBufferLike` that
  // `.from()` infers, which also admits `SharedArrayBuffer`.
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function NotificationsSettings() {
  const permission = usePermission();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Permission alone can lag a successful subscribe by a render (see
  // usePermission's own comment) — this flips immediately so the status line
  // updates the instant the subscribe actually lands, rather than waiting on
  // a permission value that in fact already changed a render ago.
  const [justEnabled, setJustEnabled] = useState(false);

  async function handleEnable() {
    setError(null);
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setError("Push isn't configured on this deployment yet.");
      return;
    }
    try {
      // Only ever called from this explicit tap — never on load. iOS revokes
      // a permission grant obtained any other way inside the installed PWA
      // (design decision 8 of the shared-calendar plan).
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setError("Notifications weren't allowed.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setError("Couldn't read the subscription details.");
        return;
      }
      await savePushSubscription({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setJustEnabled(true);
    } catch {
      setError("Couldn't enable notifications — please try again.");
    }
  }

  if (permission === null) {
    // The one render before the client has mounted (see usePermission) —
    // nothing to show yet rather than a guess that might not match.
    return null;
  }

  if (permission === "unsupported") {
    return <p className="text-sm text-zinc-500">Add HomeSync to your Home Screen first.</p>;
  }

  const enabled = justEnabled || permission === "granted";

  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-500">
        {enabled ? "Enabled on this device." : "Not enabled on this device."}
      </p>
      {!enabled && (
        <button
          type="button"
          onClick={() => startTransition(handleEnable)}
          disabled={isPending}
          className="rounded-lg bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
        >
          {isPending ? "Enabling…" : "Enable notifications"}
        </button>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
