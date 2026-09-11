// Writes one local-model narrative for a month into finance_analyses (ADR 0012).
// Runs entirely on the machine hosting LM Studio — never on Vercel, which
// cannot reach it.
//
//   node scripts/finance-narrate.mjs [YYYY-MM]   (defaults to the current month)
//
// Needs DATABASE_URL in .env.local (same as the other scripts) and LM Studio
// running locally with a model loaded — see LMSTUDIO_MODEL/LMSTUDIO_BASE_URL
// in .env.local.example. Re-running for a period already narrated adds
// another row rather than replacing it (ADR 0012) — e.g. to re-run a month
// against a newer model.
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { resolveFinancePeriod } from "../lib/finance-period.ts";
import { summariseFinanceTransactions } from "../lib/finance-overview.ts";
import { formatCents } from "../lib/finance-format.ts";

const PROMPT_VERSION = "v1";

const sql = neon(process.env.DATABASE_URL);
const baseUrl = process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1";
const model = process.env.LMSTUDIO_MODEL;

if (!model) {
  console.error(
    "LMSTUDIO_MODEL is not set. Add it to .env.local — the model name LM Studio is serving.",
  );
  process.exit(1);
}

const periodArg = process.argv[2];
if (periodArg && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodArg)) {
  console.error(`Invalid period "${periodArg}". Usage: node scripts/finance-narrate.mjs [YYYY-MM]`);
  process.exit(1);
}

const now = new Date();
const { period, from, to } = resolveFinancePeriod(periodArg, {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
});

const [household] = await sql`SELECT id FROM households LIMIT 1`;
if (!household) {
  console.error("No household set up yet — run scripts/seed.mjs first.");
  process.exit(1);
}

const transactionRows = await sql`
  SELECT amount_cents AS "amountCents", category
  FROM finance_transactions
  WHERE household_id = ${household.id}
    AND posted_date >= ${from}
    AND posted_date <= ${to}
`;

if (transactionRows.length === 0) {
  console.error(`No transactions found for ${period}. Import a statement covering this month first.`);
  process.exit(1);
}

const overview = summariseFinanceTransactions(transactionRows);
const categoryTotals = new Map(overview.categories.map((c) => [c.category, c.totalCents]));

const goalRows = await sql`
  SELECT name, category_filter AS "categoryFilter", target_cents AS "targetCents"
  FROM finance_goals
  WHERE household_id = ${household.id} AND archived_at IS NULL
`;
const goals = goalRows.map((g) => ({
  ...g,
  spentCents: categoryTotals.get(g.categoryFilter) ?? 0,
}));

// Stored verbatim in finance_analyses.metrics_json (ADR 0012), so a saved
// narrative stays auditable against the exact numbers it was shown even
// after the ledger keeps changing underneath it.
const metrics = { period, ...overview, goals };

const prompt = `You are a household finance assistant. Write a short (150-250 word), plain-English
monthly summary for ${period} from the numbers below. Note anything notable — a category that
grew a lot, whether spending is close to or over a goal's cap, anything worth a household
conversation. Do not invent numbers not given here. Do not give investment advice.

Income: ${formatCents(metrics.incomeCents)}
Expenses: ${formatCents(metrics.expenseCents)}
Net: ${formatCents(metrics.netCents)}

Spend by category:
${metrics.categories.map((c) => `- ${c.category}: ${formatCents(c.totalCents)}`).join("\n")}

Goals:
${
  goals.length > 0
    ? goals
        .map(
          (g) =>
            `- ${g.name} (${g.categoryFilter}): ${formatCents(g.spentCents)} of ${formatCents(g.targetCents)} cap`,
        )
        .join("\n")
    : "(none set)"
}`;

console.log(`Calling ${model} at ${baseUrl}…`);

const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  }),
});

if (!response.ok) {
  console.error(`LM Studio request failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}

const completion = await response.json();
const summaryMd = completion.choices?.[0]?.message?.content?.trim();
if (!summaryMd) {
  console.error("LM Studio returned no completion content.");
  process.exit(1);
}

await sql`
  INSERT INTO finance_analyses
    (household_id, period, model_name, prompt_version, summary_md, metrics_json)
  VALUES
    (${household.id}, ${period}, ${model}, ${PROMPT_VERSION}, ${summaryMd}, ${JSON.stringify(metrics)})
`;

console.log(`Saved narrative for ${period}:\n\n${summaryMd}`);
