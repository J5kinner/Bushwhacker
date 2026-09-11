/**
 * Pure summarising of a period's finance_transactions rows into income,
 * expenses, net, and a spend-by-category breakdown. Framework-free (no
 * Drizzle, no Next) so it is usable both from lib/queries.ts (a cached,
 * household-scoped read for the Almanac page) and from
 * scripts/finance-narrate.mjs, which reads the same rows with a raw SQL
 * query outside the Next.js runtime — see ADR 0012.
 */

export type FinanceMonthOverview = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  categories: { category: string; totalCents: number }[];
};

export function summariseFinanceTransactions(
  rows: { amountCents: number; category: string | null }[],
): FinanceMonthOverview {
  let incomeCents = 0;
  let expenseCents = 0;
  const byCategory = new Map<string, number>();

  for (const row of rows) {
    if (row.amountCents > 0) {
      incomeCents += row.amountCents;
    } else {
      const spent = -row.amountCents;
      expenseCents += spent;
      const key = row.category ?? "Uncategorised";
      byCategory.set(key, (byCategory.get(key) ?? 0) + spent);
    }
  }

  const categories = [...byCategory.entries()]
    .map(([category, totalCents]) => ({ category, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);

  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents, categories };
}

export type FinanceAccountTotals = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

/**
 * Income/expense/net per account, keyed by accountId — the per-account
 * breakdown on the Almanac page (each of the household's three accounts
 * shown separately for one period, rather than combined). Category is
 * deliberately not broken out here: the combined household breakdown from
 * summariseFinanceTransactions above already covers "where did the money
 * go", and a home loan or savings account rarely has more than one or two
 * categories in a given month anyway.
 */
export function summariseFinanceTransactionsByAccount(
  rows: { accountId: string; amountCents: number }[],
): Map<string, FinanceAccountTotals> {
  const byAccount = new Map<string, FinanceAccountTotals>();

  for (const row of rows) {
    const totals = byAccount.get(row.accountId) ?? {
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
    };
    if (row.amountCents > 0) {
      totals.incomeCents += row.amountCents;
    } else {
      totals.expenseCents += -row.amountCents;
    }
    totals.netCents = totals.incomeCents - totals.expenseCents;
    byAccount.set(row.accountId, totals);
  }

  return byAccount;
}
