// Weekly Web Vitals report. Usage: node scripts/vitals-report.mjs [days]
import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const days = Number(process.argv[2] ?? 7);

if (!Number.isInteger(days) || days < 1) {
  console.error("Usage: node scripts/vitals-report.mjs [days]");
  process.exit(1);
}

// Google's Core Web Vitals thresholds. A route is only as good as its worst
// metric, so these are printed per metric rather than rolled into one score.
const GOOD = { LCP: 2500, INP: 200, CLS: 0.1, FCP: 1800, TTFB: 800 };
const POOR = { LCP: 4000, INP: 500, CLS: 0.25, FCP: 3000, TTFB: 1800 };

// p75 is the statistic Core Web Vitals are defined against: a mean lets one
// fast load hide a consistently slow one.
const rows = await sql`
  SELECT route,
         metric,
         count(*)::int AS samples,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
  FROM web_vitals
  WHERE recorded_at >= now() - make_interval(days => ${days})
  GROUP BY route, metric
  ORDER BY route, metric
`;

if (rows.length === 0) {
  console.log(`No Web Vitals recorded in the last ${days} days.`);
  process.exit(0);
}

const verdict = (metric, value) => {
  if (value <= GOOD[metric]) return "good";
  return value >= POOR[metric] ? "POOR" : "needs work";
};

const format = (metric, value) =>
  metric === "CLS" ? value.toFixed(3) : `${Math.round(value)}ms`;

console.log(`Web Vitals p75, last ${days} days\n`);

let currentRoute = null;
for (const row of rows) {
  if (row.route !== currentRoute) {
    currentRoute = row.route;
    console.log(currentRoute);
  }
  const value = Number(row.p75);
  console.log(
    `  ${row.metric.padEnd(5)} ${format(row.metric, value).padStart(9)}` +
      `  ${verdict(row.metric, value).padEnd(10)} (${row.samples} samples)`,
  );
}

// Two users generate few samples, so a p75 over a handful of loads is noise.
// Saying so beats printing a confident number nobody should act on.
const thin = rows.filter((row) => row.samples < 10);
if (thin.length > 0) {
  console.log(
    `\n${thin.length} of ${rows.length} figures come from under 10 samples — treat those as indicative only.`,
  );
}
