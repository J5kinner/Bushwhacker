"use client";

import { useEffect } from "react";
import { savePushSubscription } from "@/app/settings/actions";

/**
 * Converts the VAPID public key's URL-safe base64 into the raw byte array
 * `pushManager.subscribe`'s `applicationServerKey` expects. Duplicated in
 * app/settings/notifications.tsx rather than shared — see that file's own
 * comment on why.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  // `new Uint8Array(length)` (rather than `Uint8Array.from`) is what keeps
  // this backed by a plain `ArrayBuffer` — see notifications.tsx's identical
  // comment on why `.from()`'s wider `ArrayBufferLike` doesn't typecheck here.
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * Best-effort silent re-subscribe on app open (design decision 8 of the
 * shared-calendar plan). iOS can expire a push subscription with no
 * client-side event to react to, so a member who enabled notifications once
 * can silently stop receiving them with nothing on-device to notice.
 *
 * This never calls `Notification.requestPermission()` itself — only the
 * explicit "Enable notifications" tap in Settings does that
 * (app/settings/notifications.tsx). If permission is already granted and the
 * service worker currently has no live subscription, this quietly creates
 * one and saves it. Renders nothing; mounted once from the root layout, next
 * to LiveRefresh.
 */
export function PushResubscribe() {
  useEffect(() => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return;

    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing || cancelled) return;

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const json = subscription.toJSON();
        if (cancelled || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

        await savePushSubscription({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
      } catch {
        // Best-effort — see the doc comment above; a failure here just means
        // this member keeps missing pushes until they next open Settings.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
