import { Database, House, UserX } from "lucide-react";
import type { SetupIssue } from "@/lib/household";

/**
 * What to show for each way a deployment can be half-configured. The three cases
 * have different causes and different fixes, so each names the step to take.
 * Nothing here reveals a value — only the name of the setting to look at.
 */
const NOTICES: Record<
  SetupIssue,
  { Icon: typeof Database; message: React.ReactNode }
> = {
  "no-database": {
    Icon: Database,
    message: (
      <>
        No database connected. Set <code>DATABASE_URL</code> for this deployment
        (<code>.env.local</code> locally, or the environment settings for a
        preview), then migrate and seed a household. Until then, lists are empty
        and nothing can be saved.
      </>
    ),
  },
  "no-household": {
    Icon: House,
    message: (
      <>
        The database is connected but no household has been seeded, so lists are
        empty and nothing can be saved. Run <code>scripts/seed.mjs</code> against
        this database to create the household and its members.
      </>
    ),
  },
  "not-a-member": {
    Icon: UserX,
    message: (
      <>
        You are signed in, but this account is not a household member yet, so
        chores cannot be added or ticked off. Add the address you signed in with
        to <code>SEED_MEMBERS</code> and re-run <code>scripts/seed.mjs</code>.
      </>
    ),
  },
};

/**
 * Shown on feature pages when the deployment is not fully set up. A misconfigured
 * deployment — a Vercel preview pointed at an unseeded database, most often — then
 * says what is wrong on screen instead of failing a save with no explanation.
 */
export function SetupNotice({ issue }: { issue: SetupIssue }) {
  const { Icon, message } = NOTICES[issue];
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
