import { CheckCircle2, XCircle } from "lucide-react";
import { isDbConfigured } from "@/db";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const dbOk = isDbConfigured();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Status
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {dbOk ? (
            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
          ) : (
            <XCircle className="size-4 text-amber-500" aria-hidden />
          )}
          <span>
            Database {dbOk ? "connected" : "not connected"}
            {!dbOk && " — add DATABASE_URL to .env.local"}
          </span>
        </div>
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
          Authentication is not wired up yet. Until it is, the app resolves the
          first household and its first member. To get started once the database
          is connected, run <code>pnpm db:migrate</code>, then seed one household
          and two users.
        </p>
        <p>
          Chores are scored by <strong>mental load</strong>, not by time — see the
          Chore Cognitive Load Index in the project docs.
        </p>
      </section>
    </div>
  );
}
