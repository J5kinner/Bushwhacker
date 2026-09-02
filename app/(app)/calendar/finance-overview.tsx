import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCents } from "@/lib/finance-format";
import type { FinanceMonthOverview } from "@/lib/finance-overview";

/**
 * Income/expense/net cards plus a category breakdown for one period.
 * A plain Server Component: month navigation is just links carrying `?fp=`,
 * so it needs no client state (mirrors the calendar page's own `?m=` nav).
 */
export function FinanceOverview({
  period,
  prevPeriod,
  nextPeriod,
  overview,
}: {
  period: string;
  prevPeriod: string;
  nextPeriod: string;
  overview: FinanceMonthOverview;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Link
          href={`?fp=${prevPeriod}`}
          className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <p className="text-sm font-medium">{period}</p>
        <Link
          href={`?fp=${nextPeriod}`}
          className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Next month"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">In</p>
          <p className="text-sm font-medium">{formatCents(overview.incomeCents)}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Out</p>
          <p className="text-sm font-medium">{formatCents(overview.expenseCents)}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Net</p>
          <p
            className={`text-sm font-medium ${
              overview.netCents < 0 ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {formatCents(overview.netCents)}
          </p>
        </div>
      </div>

      {overview.categories.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {overview.categories.map(({ category, totalCents }) => {
            const share =
              overview.expenseCents > 0 ? (totalCents / overview.expenseCents) * 100 : 0;
            return (
              <li key={category} className="text-sm">
                <div className="flex items-center justify-between">
                  <span>{category}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {formatCents(totalCents)}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-black/5 dark:bg-white/10">
                  <div
                    className="h-1.5 rounded-full bg-foreground/60"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
