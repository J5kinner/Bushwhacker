"use server";

import { and, eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { createHash } from "node:crypto";
import { getDb } from "@/db";
import {
  financeAccounts,
  financeImports,
  financeTransactions,
  financeGoals,
} from "@/db/schema";
import { getHouseholdId } from "@/lib/household";
import { CACHE_TAGS } from "@/lib/queries";
import {
  parseFinanceCsv,
  computeDedupeHash,
  FinanceImportError,
  FINANCE_ACCOUNT_KIND_LABELS,
  type FinanceAccountKind,
} from "@/lib/finance-import";

// No seeded household means nowhere to store the import, so this write fails
// closed rather than throwing a 500 at the user — the SetupNotice on the page
// says which step is missing.

/**
 * Import one statement CSV for the given account kind. The account row is
 * upserted by kind (there is exactly one of each per household — see ADR
 * 0012), so there is no separate "manage accounts" step before a first
 * import.
 *
 * Two dedupe layers, both from ADR 0012: the whole file is skipped if its
 * sha256 was already imported for this account; otherwise each row is
 * skipped individually if its dedupeHash already exists, which is what
 * makes re-uploading an overlapping statement period safe.
 */
export async function importFinanceCsv(
  kind: FinanceAccountKind,
  filename: string,
  csvText: string,
): Promise<
  { error: string } | { imported: number; skipped: number; rowCount: number }
> {
  const householdId = await getHouseholdId();
  if (!householdId) {
    return {
      error:
        "This deployment has no household set up yet, so nothing can be saved.",
    };
  }

  let parsed;
  try {
    parsed = parseFinanceCsv(csvText);
  } catch (e) {
    if (e instanceof FinanceImportError) return { error: e.message };
    throw e;
  }

  const accountName = FINANCE_ACCOUNT_KIND_LABELS[kind];
  const [insertedAccount] = await getDb()
    .insert(financeAccounts)
    .values({ householdId, name: accountName, kind })
    .onConflictDoNothing({
      target: [financeAccounts.householdId, financeAccounts.name],
    })
    .returning({ id: financeAccounts.id });

  const accountId =
    insertedAccount?.id ??
    (
      await getDb()
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.householdId, householdId),
            eq(financeAccounts.name, accountName),
          ),
        )
        .limit(1)
    )[0]?.id;

  if (!accountId) {
    // Unreachable in practice: the insert above always either creates the
    // row or leaves an existing one for the select to find.
    return { error: "Could not resolve the account for this import." };
  }

  const sha256 = createHash("sha256").update(csvText).digest("hex");

  const [importRow] = await getDb()
    .insert(financeImports)
    .values({
      householdId,
      accountId,
      filename,
      sha256,
      rowCount: parsed.rows.length,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
    })
    .onConflictDoNothing({
      target: [financeImports.accountId, financeImports.sha256],
    })
    .returning({ id: financeImports.id });

  if (!importRow) {
    return { error: "This exact file has already been imported for this account." };
  }

  const inserted = await getDb()
    .insert(financeTransactions)
    .values(
      parsed.rows.map((row) => ({
        householdId,
        accountId,
        importId: importRow.id,
        postedDate: row.postedDate,
        descriptionRaw: row.descriptionRaw,
        amountCents: row.amountCents,
        balanceCents: row.balanceCents,
        category: row.category,
        subcategory: row.subcategory,
        dedupeHash: computeDedupeHash(accountId, row),
      })),
    )
    .onConflictDoNothing({
      target: [financeTransactions.accountId, financeTransactions.dedupeHash],
    })
    .returning({ id: financeTransactions.id });

  updateTag(CACHE_TAGS.financeImports);
  updateTag(CACHE_TAGS.financeTransactions);

  return {
    imported: inserted.length,
    skipped: parsed.rows.length - inserted.length,
    rowCount: parsed.rows.length,
  };
}

/**
 * Add a monthly spending-cap goal for one bank category — the only goal
 * shape this UI creates for now. `finance_goals.categoryFilter` stays
 * nullable in the schema for a future whole-ledger goal type (e.g. a
 * home-loan payoff target), but that needs its own progress computation (an
 * account balance trend, not a category spend sum) and isn't built yet.
 */
export async function addFinanceGoal(input: {
  name: string;
  category: string;
  targetCents: number;
}): Promise<{ error: string } | { id: string }> {
  const householdId = await getHouseholdId();
  if (!householdId) {
    return {
      error:
        "This deployment has no household set up yet, so nothing can be saved.",
    };
  }

  const name = input.name.trim();
  const category = input.category.trim();
  if (!name || !category) {
    return { error: "A goal needs a name and a category." };
  }
  if (!Number.isInteger(input.targetCents) || input.targetCents <= 0) {
    return { error: "Enter a monthly cap greater than $0." };
  }

  const [goal] = await getDb()
    .insert(financeGoals)
    .values({
      householdId,
      name,
      categoryFilter: category,
      targetCents: input.targetCents,
    })
    .returning({ id: financeGoals.id });

  updateTag(CACHE_TAGS.financeGoals);
  return { id: goal.id };
}

/** Retire a goal. Archived rather than deleted, so past progress stays reviewable. */
export async function archiveFinanceGoal(id: string) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  await getDb()
    .update(financeGoals)
    .set({ archivedAt: new Date() })
    .where(and(eq(financeGoals.id, id), eq(financeGoals.householdId, householdId)));
  updateTag(CACHE_TAGS.financeGoals);
}
