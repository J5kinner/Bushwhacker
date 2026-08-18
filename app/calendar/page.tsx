import { getCalendarWindow, getHouseholdMembers } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { resolveCalendarWindow } from "@/lib/calendar-window";
import { SetupNotice } from "@/components/db-notice";
import { CalendarEvents } from "./calendar-events";

export const dynamic = "force-dynamic";

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

  const [{ events, exdates }, members, setupIssue] = await Promise.all([
    getCalendarWindow(windowFrom, windowTo),
    getHouseholdMembers(),
    getSetupIssue(),
  ]);

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
      />
    </div>
  );
}
