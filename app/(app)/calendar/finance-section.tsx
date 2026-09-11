"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Loader2, Upload } from "lucide-react";
import {
  FINANCE_ACCOUNT_KINDS,
  FINANCE_ACCOUNT_KIND_LABELS,
  type FinanceAccountKind,
} from "@/lib/finance-import";
import { importFinanceCsv } from "./finance-actions";
import type { getFinanceImports } from "@/lib/queries";

type FinanceImportRow = Awaited<ReturnType<typeof getFinanceImports>>[number];

/**
 * The CSV upload form and recent-imports history — one subsection of the
 * Almanac page's Finances section (see page.tsx, which wraps this alongside
 * FinanceOverview/FinanceGoals/FinanceAnalyses under a single "Finances"
 * heading; ADR 0012 covers why this feature has no page of its own).
 */
export function FinanceSection({
  initialImports,
}: {
  initialImports: FinanceImportRow[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FinanceAccountKind>("credit_card");
  const [importing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The native <input type="file"> is visually hidden (see the sr-only input
  // below) — "Import statement" opens it via .click(), so there is exactly
  // one obvious, full-width tap target instead of a small native file input
  // sitting above a button that used to look tappable but wasn't (it was a
  // form submit with nothing to submit until a file had already been chosen
  // through that easy-to-miss control — the reported "nothing happens on
  // Android/iOS" bug).
  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared unconditionally so choosing the same filename again still
    // fires a fresh change event next time.
    e.target.value = "";
    if (!file || importing) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const csvText = await file.text();
      const result = await importFinanceCsv(kind, file.name, csvText);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNotice(
        `Imported "${file.name}" — ${result.rowCount} rows, ${result.imported} new, ${result.skipped} already on the ledger.`,
      );
      router.refresh();
    });
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Import a statement
      </h3>
      <div className="space-y-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as FinanceAccountKind)}
          aria-label="Account"
          className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-base outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
        >
          {FINANCE_ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {FINANCE_ACCOUNT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {/*
          Extension-only accept, deliberately no MIME type: Android's file
          picker filters by the file's reported MIME type when one is given,
          and a CSV exported from a banking app is inconsistently tagged
          (text/csv, text/comma-separated-values, application/vnd.ms-excel,
          or nothing at all depending on the app) — matching on ".csv" alone
          is what actually works across Android/iOS/desktop.
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          aria-label="Statement CSV"
          onChange={onFileChosen}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-background disabled:opacity-60"
        >
          {importing ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-5" aria-hidden />
          )}
          {importing ? "Importing…" : "Import statement"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>
      )}

      <h3 className="mt-6 mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Recent imports
      </h3>
      {initialImports.length === 0 ? (
        <p className="text-sm text-zinc-500">No statements imported yet.</p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {initialImports.map((row) => (
            <li key={row.id} className="py-3 text-sm">
              <p>
                {row.accountName} · {row.filename}
              </p>
              <p className="text-zinc-500 dark:text-zinc-400">
                {format(parseISO(row.periodStart), "d MMM")} –{" "}
                {format(parseISO(row.periodEnd), "d MMM yyyy")} · {row.rowCount} rows
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
