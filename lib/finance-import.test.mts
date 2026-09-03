import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFinanceCsv,
  computeDedupeHash,
  FinanceImportError,
} from "./finance-import.ts";

const SAMPLE_CSV = [
  "Date,Description,Debit,Credit,Balance,Category,SubCategory",
  '01/09/2026,Visa Purchase                 29Aug Paypal *Colessuperm  402935773,7.00,,92297.69,Retail & Personal,Retail (shopping)',
  '01/09/2026,Osko Withdrawal               31Aug22:28 Basketball Lillian Martin,16.46,,92304.69,Withdrawals & Transfers,Withdrawal',
  "31/08/2026,Cityofparramatta 51576189,362.33,,92321.15,Bills & Payments,Expenses & Payments",
].join("\n");

test("parseFinanceCsv reads a debit row as a negative signed amount in cents", () => {
  const { rows } = parseFinanceCsv(SAMPLE_CSV);
  assert.equal(rows[0].amountCents, -700);
  assert.equal(rows[0].balanceCents, 9229769);
});

test("parseFinanceCsv converts DD/MM/YYYY to ISO without US-locale ambiguity", () => {
  const { rows } = parseFinanceCsv(SAMPLE_CSV);
  // 31/08/2026 must stay August, never roll to a nonsensical month 31.
  assert.equal(rows[2].postedDate, "2026-08-31");
});

test("parseFinanceCsv keeps the bank's category and subcategory verbatim", () => {
  const { rows } = parseFinanceCsv(SAMPLE_CSV);
  assert.equal(rows[0].category, "Retail & Personal");
  assert.equal(rows[0].subcategory, "Retail (shopping)");
});

test("parseFinanceCsv computes periodStart/periodEnd across unsorted rows", () => {
  const { periodStart, periodEnd } = parseFinanceCsv(SAMPLE_CSV);
  assert.equal(periodStart, "2026-08-31");
  assert.equal(periodEnd, "2026-09-01");
});

test("parseFinanceCsv reads a credit row as a positive signed amount", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "02/09/2026,Salary,,2500.50,94798.19,Income,Salary",
  ].join("\n");
  assert.equal(parseFinanceCsv(csv).rows[0].amountCents, 250050);
});

test("parseFinanceCsv treats an empty category/subcategory as null", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "02/09/2026,Interest,,1.20,94799.39,,",
  ].join("\n");
  const row = parseFinanceCsv(csv).rows[0];
  assert.equal(row.category, null);
  assert.equal(row.subcategory, null);
});

test("parseFinanceCsv rejects an unexpected header", () => {
  assert.throws(
    () => parseFinanceCsv("Date,Description,Amount\n01/09/2026,Coffee,-5.00"),
    FinanceImportError,
  );
});

test("parseFinanceCsv rejects a row with both Debit and Credit set", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "01/09/2026,Odd row,5.00,5.00,100.00,,",
  ].join("\n");
  assert.throws(() => parseFinanceCsv(csv), FinanceImportError);
});

test("parseFinanceCsv rejects a row with neither Debit nor Credit set", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "01/09/2026,Odd row,,,100.00,,",
  ].join("\n");
  assert.throws(() => parseFinanceCsv(csv), FinanceImportError);
});

test("parseFinanceCsv rejects an unparseable date", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "2026-09-01,Odd row,5.00,,100.00,,",
  ].join("\n");
  assert.throws(() => parseFinanceCsv(csv), FinanceImportError);
});

test("parseFinanceCsv rejects an empty file", () => {
  assert.throws(() => parseFinanceCsv(""), FinanceImportError);
});

test("parseFinanceCsv pads a row whose trailing SubCategory field was dropped entirely", () => {
  // The home loan account's export omits a wholly-empty trailing column
  // rather than leaving a trailing comma, so these rows have 6 fields
  // against a 7-column header.
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "05/08/2026,Repaymt A/C Tfr,,2853.00,455142.10,",
    "04/08/2026,Loan A/C Fee,,.00,457995.10,",
  ].join("\n");
  const { rows } = parseFinanceCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].postedDate, "2026-08-05");
  assert.equal(rows[0].amountCents, 285300);
  assert.equal(rows[0].balanceCents, 45514210);
  assert.equal(rows[0].category, null);
  assert.equal(rows[0].subcategory, null);
  assert.equal(rows[1].amountCents, 0);
});

test("parseFinanceCsv rejects a row missing a required column", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "01/09/2026,Too short,5.00",
  ].join("\n");
  assert.throws(() => parseFinanceCsv(csv), FinanceImportError);
});

test("computeDedupeHash is stable for the same account and row", () => {
  const row = parseFinanceCsv(SAMPLE_CSV).rows[0];
  assert.equal(computeDedupeHash("acct-1", row), computeDedupeHash("acct-1", row));
});

test("computeDedupeHash differs for two accounts given the same row", () => {
  const row = parseFinanceCsv(SAMPLE_CSV).rows[0];
  assert.notEqual(computeDedupeHash("acct-1", row), computeDedupeHash("acct-2", row));
});

test("computeDedupeHash differs when the running balance differs, even with identical date/amount/description", () => {
  const csv = [
    "Date,Description,Debit,Credit,Balance,Category,SubCategory",
    "01/09/2026,Coles,7.00,,92297.69,Retail & Personal,Retail (shopping)",
    "01/09/2026,Coles,7.00,,92290.69,Retail & Personal,Retail (shopping)",
  ].join("\n");
  const [first, second] = parseFinanceCsv(csv).rows;
  assert.notEqual(
    computeDedupeHash("acct-1", first),
    computeDedupeHash("acct-1", second),
  );
});
