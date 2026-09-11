import { formatCents } from "@/lib/finance-format";
import type { FinanceAccountBreakdownRow } from "@/lib/queries";

/**
 * Each of the household's 3 accounts shown separately for one period, rather
 * than combined into the totals above (FinanceOverview) — see finance-queries
 * getFinanceAccountBreakdown, which always returns all 3 kinds, zeroed for
 * one that has never had a statement imported.
 */
export function FinanceAccountBreakdown({
  accounts,
}: {
  accounts: FinanceAccountBreakdownRow[];
}) {
  return (
    <ul className="space-y-2">
      {accounts.map((account) => (
        <li
          key={account.kind}
          className="rounded-lg border border-black/10 p-3 dark:border-white/15"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{account.name}</span>
            <span
              className={`text-sm font-medium ${
                account.netCents < 0 ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {formatCents(account.netCents)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            In {formatCents(account.incomeCents)} · Out {formatCents(account.expenseCents)}
          </p>
        </li>
      ))}
    </ul>
  );
}
