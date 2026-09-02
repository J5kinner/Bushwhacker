import { format, parseISO } from "date-fns";
import type { FinanceAnalysis } from "@/db/schema";

/**
 * Read-only history of local-model narratives (ADR 0012). `summaryMd` is
 * shown as plain text, not rendered Markdown — there is no Markdown renderer
 * in this project yet, and the trade isn't worth pulling one in for this.
 */
export function FinanceAnalyses({ analyses }: { analyses: FinanceAnalysis[] }) {
  if (analyses.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No monthly summaries yet — run{" "}
        <code className="text-xs">scripts/finance-narrate.mjs</code> on the machine running LM
        Studio.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {analyses.map((a) => (
        <li key={a.id} className="text-sm">
          <p className="font-medium">
            {format(parseISO(`${a.period}-01`), "MMMM yyyy")}
            <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
              {a.modelName}
            </span>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {a.summaryMd}
          </p>
        </li>
      ))}
    </ul>
  );
}
