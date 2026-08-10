"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { regenerateLocationToken } from "@/app/location/actions";

/** A label, a value, and a copy button — one OwnTracks field to transcribe. */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (older iOS, insecure context). The
      // value is on screen and selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="wrap-break-word font-mono text-sm">{value}</p>
      </div>
      <button
        onClick={copy}
        className="mt-4 flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="size-4 text-emerald-500" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

/**
 * One-time OwnTracks setup for the signed-in member.
 *
 * Shows the values to transcribe into the app's HTTP-mode settings. The copy
 * buttons are load-bearing rather than polish — typing a 32-character token by
 * hand on a phone is miserable.
 */
export function LocationSetup({
  initialToken,
  endpoint,
}: {
  initialToken: string | null;
  endpoint: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function regenerate() {
    setError(null);
    startTransition(async () => {
      try {
        const next = await regenerateLocationToken();
        if (next) setToken(next);
        else setError("Could not issue a token — check the household setup above.");
      } catch {
        setError("Could not issue a token. Try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A phone cannot report its position while HomeSync is in the background,
        so the free{" "}
        <a
          href="https://owntracks.org"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          OwnTracks
        </a>{" "}
        app does it instead. Install it, choose <strong>HTTP</strong> mode, and
        enter these values.
      </p>

      {token ? (
        <div className="divide-y divide-black/5 rounded-lg border border-black/10 px-3 py-1 dark:divide-white/10 dark:border-white/15">
          <CopyRow label="URL" value={endpoint} />
          <CopyRow label="User ID" value="homesync" />
          <CopyRow label="Password" value={token} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          No token yet. Generate one to set up your phone.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        onClick={regenerate}
        disabled={pending}
        className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/15"
      >
        <KeyRound className="size-4" aria-hidden />
        {token ? "Regenerate token" : "Generate token"}
      </button>

      {token && (
        <p className="text-xs text-zinc-500">
          Regenerating stops the old token working, so update your phone after
          you do it. Set OwnTracks to <strong>significant changes</strong> mode
          to keep battery use low.
        </p>
      )}
    </div>
  );
}
