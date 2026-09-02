import {
  getActivity,
  getCalendarWindow,
  getCurrentUserActivitySeenAt,
  getEventAttachments,
  getEventComments,
  getFinanceAnalyses,
  getFinanceGoals,
  getFinanceImports,
  getFinanceMonthOverview,
  getHouseholdMembers,
} from "@/lib/queries";
import { getSetupIssue, getCurrentUserId } from "@/lib/household";
import { resolveCalendarWindow } from "@/lib/calendar-window";
import { resolveFinancePeriod } from "@/lib/finance-period";
import { SetupNotice } from "@/components/db-notice";
import { CalendarEvents } from "./calendar-events";
import { FinanceSection } from "./finance-section";
import { FinanceOverview } from "./finance-overview";
import { FinanceGoals } from "./finance-goals";
import { FinanceAnalyses } from "./finance-analyses";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; fp?: string }>;
}) {
  const { m, fp } = await searchParams;
  const now = new Date();
  const { anchorMonth, windowFrom, windowTo } = resolveCalendarWindow(m, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
  const financePeriod = resolveFinancePeriod(fp, {
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
    financeImportsRows,
    financeOverview,
    financeGoalsRows,
    financeAnalysesRows,
  ] = await Promise.all([
    getCalendarWindow(windowFrom, windowTo),
    getHouseholdMembers(),
    getSetupIssue(),
    getEventComments(),
    getEventAttachments(),
    getActivity(),
    getCurrentUserActivitySeenAt(),
    getCurrentUserId(),
    getFinanceImports(),
    getFinanceMonthOverview(financePeriod.from, financePeriod.to),
    getFinanceGoals(),
    getFinanceAnalyses(),
  ]);

  const financeCategoryTotals = new Map(
    financeOverview.categories.map((c) => [c.category, c.totalCents]),
  );

  // Never baked into the (household-shared, cached) activity read itself —
  // see getCurrentUserActivitySeenAt's own doc comment — so the unseen count
  // is computed here, per request, from the cached rows plus this one user's
  // uncached seen marker.
  const unseenCount = activitySeenAt
    ? activityRows.filter((a) => a.createdAt > activitySeenAt).length
    : activityRows.length;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Almanac</h1>
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
      <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/10">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">Finances</h2>

        <FinanceOverview
          period={financePeriod.period}
          prevPeriod={financePeriod.prevPeriod}
          nextPeriod={financePeriod.nextPeriod}
          overview={financeOverview}
        />

        <h3 className="mt-6 mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Goals
        </h3>
        <FinanceGoals goals={financeGoalsRows} categoryTotals={financeCategoryTotals} />

        <h3 className="mt-6 mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Monthly summaries
        </h3>
        <FinanceAnalyses analyses={financeAnalysesRows} />

        <div className="mt-6">
          <FinanceSection initialImports={financeImportsRows} />
        </div>
      </section>
    </div>
  );
}
