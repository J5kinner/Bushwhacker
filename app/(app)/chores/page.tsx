import { getChores, getHouseholdMembers } from "@/lib/queries";
import { getSetupIssue, getCurrentUserId } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { ChoresList } from "./chores-list";

export default async function ChoresPage() {
  const [chores, setupIssue, members, currentUserId] = await Promise.all([
    getChores(),
    getSetupIssue(),
    getHouseholdMembers(),
    getCurrentUserId(),
  ]);

  return (
    <div className="pb-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Upkeep</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Shared household maintenance and turn-taking.
      </p>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <ChoresList
        initialChores={chores}
        members={members}
        currentUserId={currentUserId}
      />
    </div>
  );
}
