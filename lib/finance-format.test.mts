import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCents } from "./finance-format.ts";

test("formatCents formats a positive amount with thousands separators", () => {
  assert.equal(formatCents(9229769), "$92,297.69");
});

test("formatCents formats a negative amount with a leading minus before the dollar sign", () => {
  assert.equal(formatCents(-700), "-$7.00");
});

test("formatCents formats zero", () => {
  assert.equal(formatCents(0), "$0.00");
});
