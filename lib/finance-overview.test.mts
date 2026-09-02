import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summariseFinanceTransactions,
  summariseFinanceTransactionsByAccount,
} from "./finance-overview.ts";

test("summariseFinanceTransactions splits income and expenses", () => {
  const result = summariseFinanceTransactions([
    { amountCents: 250050, category: "Income" },
    { amountCents: -700, category: "Retail & Personal" },
  ]);
  assert.equal(result.incomeCents, 250050);
  assert.equal(result.expenseCents, 700);
  assert.equal(result.netCents, 249350);
});

test("summariseFinanceTransactions groups expenses by category, descending", () => {
  const result = summariseFinanceTransactions([
    { amountCents: -700, category: "Retail & Personal" },
    { amountCents: -362_33, category: "Bills & Payments" },
    { amountCents: -1646, category: "Retail & Personal" },
  ]);
  assert.deepEqual(result.categories, [
    { category: "Bills & Payments", totalCents: 36233 },
    { category: "Retail & Personal", totalCents: 700 + 1646 },
  ]);
});

test("summariseFinanceTransactions buckets a null category as Uncategorised", () => {
  const result = summariseFinanceTransactions([{ amountCents: -500, category: null }]);
  assert.deepEqual(result.categories, [{ category: "Uncategorised", totalCents: 500 }]);
});

test("summariseFinanceTransactions ignores income when building the category breakdown", () => {
  const result = summariseFinanceTransactions([{ amountCents: 5000, category: "Income" }]);
  assert.deepEqual(result.categories, []);
});

test("summariseFinanceTransactions handles an empty period", () => {
  assert.deepEqual(summariseFinanceTransactions([]), {
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    categories: [],
  });
});

test("summariseFinanceTransactionsByAccount keeps each account's totals separate", () => {
  const result = summariseFinanceTransactionsByAccount([
    { accountId: "credit-card", amountCents: -700 },
    { accountId: "credit-card", amountCents: -1646 },
    { accountId: "savings", amountCents: 50000 },
    { accountId: "home-loan", amountCents: -215000 },
  ]);
  assert.deepEqual(result.get("credit-card"), {
    incomeCents: 0,
    expenseCents: 2346,
    netCents: -2346,
  });
  assert.deepEqual(result.get("savings"), {
    incomeCents: 50000,
    expenseCents: 0,
    netCents: 50000,
  });
  assert.deepEqual(result.get("home-loan"), {
    incomeCents: 0,
    expenseCents: 215000,
    netCents: -215000,
  });
});

test("summariseFinanceTransactionsByAccount has no entry for an account with no rows", () => {
  const result = summariseFinanceTransactionsByAccount([
    { accountId: "credit-card", amountCents: -700 },
  ]);
  assert.equal(result.has("savings"), false);
});
