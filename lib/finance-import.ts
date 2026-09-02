/**
 * Parsing for the Almanac's Finances CSV import. Pure and network-free (no
 * DB, no crypto beyond a plain digest), so it is unit-testable on its own —
 * the same split as lib/recipe-import.ts.
 *
 * The three accounts this household has (home loan, savings, credit card)
 * all export the same statement layout: `Date,Description,Debit,Credit,
 * Balance,Category,SubCategory`, dates as DD/MM/YYYY, and the bank already
 * categorises every row — see ADR 0012 for why that means there is no rules
 * or model-categorisation step here.
 */

import { createHash } from "node:crypto";

/** Raised for any user-facing import failure (bad columns, a malformed row…). */
export class FinanceImportError extends Error {}

export const FINANCE_ACCOUNT_KINDS = ["home_loan", "savings", "credit_card"] as const;
export type FinanceAccountKind = (typeof FINANCE_ACCOUNT_KINDS)[number];

/** Display name for each account kind, also used as its finance_accounts.name. */
export const FINANCE_ACCOUNT_KIND_LABELS: Record<FinanceAccountKind, string> = {
  home_loan: "Home Loan",
  savings: "Savings",
  credit_card: "Credit Card",
};

const EXPECTED_HEADER = [
  "Date",
  "Description",
  "Debit",
  "Credit",
  "Balance",
  "Category",
  "SubCategory",
];

export type ParsedFinanceRow = {
  /** ISO "YYYY-MM-DD". */
  postedDate: string;
  descriptionRaw: string;
  /** Signed: a credit is positive, a debit negative. */
  amountCents: number;
  /** The bank's own running balance after this transaction. */
  balanceCents: number;
  category: string | null;
  subcategory: string | null;
};

export type ParsedFinanceCsv = {
  rows: ParsedFinanceRow[];
  periodStart: string;
  periodEnd: string;
};

/** Splits one CSV line into fields, honouring double-quoted fields with embedded commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

/** DD/MM/YYYY -> "YYYY-MM-DD". Never `new Date(string)`, whose slash-format parsing assumes MM/DD. */
function parseAuDate(raw: string, context: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) {
    throw new FinanceImportError(`${context}: unrecognised date "${raw}" (expected DD/MM/YYYY).`);
  }
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new FinanceImportError(`${context}: unrecognised date "${raw}".`);
  }
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseCents(raw: string, field: string, context: string): number {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) {
    throw new FinanceImportError(`${context}: unrecognised ${field} amount "${raw}".`);
  }
  return Math.round(value * 100);
}

/**
 * Parses a full statement CSV. Throws FinanceImportError on the first
 * malformed row rather than skipping it — a household statement export is
 * either the expected shape throughout or something is wrong worth seeing
 * immediately, not partially importing an unknown format.
 */
export function parseFinanceCsv(csvText: string): ParsedFinanceCsv {
  const lines = csvText.split(/\r\n|\n|\r/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new FinanceImportError("The CSV file is empty.");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const headerMatches =
    header.length === EXPECTED_HEADER.length &&
    header.every((h, i) => h.toLowerCase() === EXPECTED_HEADER[i].toLowerCase());
  if (!headerMatches) {
    throw new FinanceImportError(
      `Unexpected CSV columns. Expected "${EXPECTED_HEADER.join(",")}", got "${header.join(",")}".`,
    );
  }

  const rows: ParsedFinanceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const context = `Row ${lineNumber}`;
    const fields = splitCsvLine(lines[i]).map((f) => f.trim());
    if (fields.length !== EXPECTED_HEADER.length) {
      throw new FinanceImportError(
        `${context}: expected ${EXPECTED_HEADER.length} columns, got ${fields.length}.`,
      );
    }
    const [dateRaw, descriptionRaw, debitRaw, creditRaw, balanceRaw, categoryRaw, subcategoryRaw] =
      fields;

    if (!descriptionRaw) {
      throw new FinanceImportError(`${context}: missing description.`);
    }

    const hasDebit = debitRaw.length > 0;
    const hasCredit = creditRaw.length > 0;
    if (hasDebit === hasCredit) {
      throw new FinanceImportError(
        `${context}: expected exactly one of Debit/Credit to be set.`,
      );
    }

    rows.push({
      postedDate: parseAuDate(dateRaw, context),
      descriptionRaw,
      amountCents: hasDebit
        ? -parseCents(debitRaw, "debit", context)
        : parseCents(creditRaw, "credit", context),
      balanceCents: parseCents(balanceRaw, "balance", context),
      category: categoryRaw || null,
      subcategory: subcategoryRaw || null,
    });
  }

  if (rows.length === 0) {
    throw new FinanceImportError("The CSV file has no transaction rows.");
  }

  const sortedDates = [...rows.map((r) => r.postedDate)].sort();
  return {
    rows,
    periodStart: sortedDates[0],
    periodEnd: sortedDates[sortedDates.length - 1],
  };
}

/**
 * See ADR 0012: these statements carry no bank transaction id, so the
 * running balance is included as the tie-breaker between a true duplicate
 * import and two separate transactions that happen to share a date, amount
 * and description — the balance differs for the latter.
 */
export function computeDedupeHash(accountId: string, row: ParsedFinanceRow): string {
  return createHash("sha256")
    .update(`${accountId}|${row.postedDate}|${row.amountCents}|${row.descriptionRaw}|${row.balanceCents}`)
    .digest("hex");
}
