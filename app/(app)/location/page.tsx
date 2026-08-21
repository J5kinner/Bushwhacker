import { getMemberLocations } from "@/lib/queries";
import { getSetupIssue, getCurrentUserId } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { LocationView } from "./location-view";

export const dynamic = "force-dynamic";

export default async function LocationPage() {
  const [members, setupIssue, currentUserId] = await Promise.all([
    getMemberLocations(),
    getSetupIssue(),
    getCurrentUserId(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Location</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <LocationView members={members} currentUserId={currentUserId} />
    </div>
  );
}
