import { getChores } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { ChoresList } from "./chores-list";

export const dynamic = "force-dynamic";

export default async function ChoresPage() {
  const [chores, setupIssue] = await Promise.all([getChores(), getSetupIssue()]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Chores</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Scored by mental load, not by minutes.
      </p>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <ChoresList initialChores={chores} />
    </div>
  );
}
