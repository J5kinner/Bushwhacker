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
