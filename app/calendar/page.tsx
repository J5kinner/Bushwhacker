import { isDbConfigured } from "@/db";
import { getCalendarEvents } from "@/lib/queries";
import { DbNotice } from "@/components/db-notice";
import { CalendarEvents } from "./calendar-events";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const events = await getCalendarEvents();

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Calendar</h1>
      {!isDbConfigured() && <DbNotice />}
      <CalendarEvents initialEvents={events} />
    </div>
  );
}
