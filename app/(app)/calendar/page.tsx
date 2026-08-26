import {
  getActivity,
  getCalendarWindow,
  getCurrentUserActivitySeenAt,
  getEventAttachments,
  getEventComments,
  getHouseholdMembers,
} from "@/lib/queries";
import { getSetupIssue, getCurrentUserId } from "@/lib/household";
import { resolveCalendarWindow } from "@/lib/calendar-window";
import { SetupNotice } from "@/components/db-notice";
import { CalendarEvents } from "./calendar-events";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const now = new Date();
  const { anchorMonth, windowFrom, windowTo } = resolveCalendarWindow(m, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });

  const [
    { events, exdates },
    members,
    setupIssue,
    comments,
    attachments,
    activityRows,
    activitySeenAt,
    currentUserId,
  ] = await Promise.all([
    getCalendarWindow(windowFrom, windowTo),
    getHouseholdMembers(),
    getSetupIssue(),
    getEventComments(),
    getEventAttachments(),
    getActivity(),
    getCurrentUserActivitySeenAt(),
    getCurrentUserId(),
  ]);

  // Never baked into the (household-shared, cached) activity read itself —
  // see getCurrentUserActivitySeenAt's own doc comment — so the unseen count
  // is computed here, per request, from the cached rows plus this one user's
  // uncached seen marker.
  const unseenCount = activitySeenAt
    ? activityRows.filter((a) => a.createdAt > activitySeenAt).length
    : activityRows.length;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Calendar</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <CalendarEvents
        initialEvents={events}
        exdates={exdates}
        windowFrom={windowFrom}
        windowTo={windowTo}
        anchorMonth={anchorMonth}
        members={members}
        comments={comments}
        attachments={attachments}
        activity={activityRows}
        unseenCount={unseenCount}
        currentUserId={currentUserId}
      />
    </div>
  );
}
