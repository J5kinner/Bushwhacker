import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseFinanceTransactions } from "./finance-overview.ts";

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
