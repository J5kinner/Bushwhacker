import { CheckCircle2, XCircle } from "lucide-react";
import { getShoppingCategories } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { SetupNotice } from "@/components/db-notice";
import { CategoryManager } from "./category-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [session, categories, setupIssue] = await Promise.all([
    auth(),
    getShoppingCategories(),
    getSetupIssue(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Account
        </h2>
        {session?.user ? (
          /*
            The email wraps rather than truncating. The margin here was thinner
            than it looked: the column is 204px at 320px, and the signed-in
            address fits with about two characters to spare, so a slightly
            longer one loses its tail — and the tail is the domain, which is the
            part that tells you which of the two household accounts you are in.
            `wrap-break-word` is what does the work, an address being a single
            unbroken token that ordinary wrapping will not break.
          */
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="wrap-break-word text-base">
                {session.user.name ?? "Signed in"}
              </p>
              <p className="wrap-break-word text-sm text-zinc-500">
                {session.user.email}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Not signed in.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Status
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {setupIssue === null ? (
            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
          ) : (
            <XCircle className="size-4 text-amber-500" aria-hidden />
          )}
          {/* The notice above carries the detail; this line is the summary. */}
          <span>
            Household {setupIssue === null ? "ready" : "setup incomplete"}
          </span>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Shopping categories
        </h2>
        <CategoryManager
          initialCategories={categories.map((c) => ({ id: c.id, name: c.name }))}
        />
      </section>

      <section className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          About
        </h2>
        <p>
          HomeSync is for a two-person household — two accounts, one shared
          shopping list, calendar, and chore list.
        </p>
        <p>
          Chores are scored by <strong>mental load</strong>, not by time — see the
          Chore Cognitive Load Index in the project docs.
        </p>
      </section>
    </div>
  );
}
