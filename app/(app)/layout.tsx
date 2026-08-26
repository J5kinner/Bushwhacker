import { BottomNav } from "@/components/bottom-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { PushResubscribe } from "@/components/push-resubscribe";

/**
 * The signed-in app shell: the tab bar, the live-refresh poll, and the push
 * re-subscription check.
 *
 * The nav renders unconditionally rather than behind a session check. Every
 * route in this group is matched by `proxy.ts`, which redirects anyone without
 * a session to /signin, so a signed-out visitor never reaches this layout.
 * Reading the session here instead would make the layout dynamic, and a
 * blocking read in a layout blocks every route beneath it from being
 * prerendered — which is the whole reason the sign-in page lives outside this
 * group rather than behind a branch in the root layout.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {/*
        The bottom padding reserves exactly the band the fixed nav covers —
        its 4rem height plus the home-indicator inset underneath it — so
        page content can always scroll clear of the nav. A flat value would
        come up short by the inset on an iPhone.
      */}
      <main className="flex-1 px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-6">
        {children}
      </main>
      <BottomNav />
      <LiveRefresh />
      <PushResubscribe />
    </div>
  );
}
