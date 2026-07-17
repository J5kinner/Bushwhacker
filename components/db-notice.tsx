import { Database } from "lucide-react";

/** Shown on feature pages when DATABASE_URL is not configured yet. */
export function DbNotice() {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <Database className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        No database connected yet. Add your Neon <code>DATABASE_URL</code> to{" "}
        <code>.env.local</code>, then run <code>pnpm db:migrate</code> and seed a
        household. Until then, lists are empty and saving is disabled.
      </p>
    </div>
  );
}
