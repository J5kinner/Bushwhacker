import { getCalendarEvents } from "@/lib/queries";
import { getSetupIssue } from "@/lib/household";
import { SetupNotice } from "@/components/db-notice";
import { CalendarEvents } from "./calendar-events";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [events, setupIssue] = await Promise.all([
    getCalendarEvents(),
    getSetupIssue(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Calendar</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}
      <CalendarEvents initialEvents={events} />
    </div>
  );
}
