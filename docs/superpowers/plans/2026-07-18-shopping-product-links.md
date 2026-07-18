# Product Links on Shopping Items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a partner paste a product URL into the shopping add box and have it stored and shown as a compact, non-overflowing link chip on the item row.

**Architecture:** A pure `lib/links.ts` helper detects the first `http(s)` URL and splits it from the item name; the server action re-runs it as the source of truth; the client runs the same helper for the optimistic item and renders the URL as a truncating chip. One new nullable `url` column on `shopping_items` — no new table, no backfill.

**Tech Stack:** Next.js (App Router, TS), Drizzle ORM + Neon Postgres, Tailwind, Lucide icons. Unit tests via Node's built-in test runner (`node --test`) with native TypeScript type-stripping — no new dependencies.

## Global Constraints

- Australian spelling in all user-facing text, comments, and docs (organise, colour, behaviour).
- Mobile-first Tailwind; every control stays reachable and nothing scrolls horizontally on a phone.
- Database mutations go through Server Actions.
- Commits follow Conventional Commits; attribute to the human author only — **no `Co-Authored-By` trailer** for AI.
- Keep each full Markdown sentence on its own line.
- Only `http:`/`https:` URLs are ever treated as links.

---

### Task 1: Link-detection helpers + unit tests

**Files:**
- Create: `lib/links.ts`
- Create: `lib/links.test.mts`
- Modify: `package.json` (add `test` script)
- Modify: `eslint.config.mjs` (ignore `.mts` test files)

**Interfaces:**
- Produces:
  - `extractLink(text: string): { name: string; url: string | null }`
  - `displayDomain(url: string): string`

- [ ] **Step 1: Add the `test` script and ignore test files from lint**

In `package.json`, add to `"scripts"` (after `"lint"`):

```json
    "test": "node --test",
```

In `eslint.config.mjs`, add `"**/*.test.mts"` to the `globalIgnores([...])` array:

```js
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node built-in test files are run by `node --test`, not linted.
    "**/*.test.mts",
  ]),
```

- [ ] **Step 2: Write the failing tests**

Create `lib/links.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLink, displayDomain } from "./links.ts";

test("extractLink splits a trailing URL out of the name", () => {
  assert.deepEqual(extractLink("Olive oil https://www.coles.com.au/p/olive-oil-123"), {
    name: "Olive oil",
    url: "https://www.coles.com.au/p/olive-oil-123",
  });
});

test("extractLink falls back to the domain when only a URL is pasted", () => {
  assert.deepEqual(extractLink("https://www.coles.com.au/p/olive-oil-123"), {
    name: "coles.com.au",
    url: "https://www.coles.com.au/p/olive-oil-123",
  });
});

test("extractLink returns plain trimmed text when there is no URL", () => {
  assert.deepEqual(extractLink("  Milk  "), { name: "Milk", url: null });
});

test("extractLink ignores a bare domain with no scheme", () => {
  assert.deepEqual(extractLink("coles.com.au olive oil"), {
    name: "coles.com.au olive oil",
    url: null,
  });
});

test("extractLink ignores non-http(s) schemes", () => {
  assert.deepEqual(extractLink("javascript:alert(1)"), {
    name: "javascript:alert(1)",
    url: null,
  });
});

test("extractLink strips trailing punctuation from the URL", () => {
  assert.deepEqual(extractLink("Get it here https://coles.com.au/p/x."), {
    name: "Get it here",
    url: "https://coles.com.au/p/x",
  });
});

test("extractLink links the first URL and leaves later ones in the name", () => {
  const r = extractLink("Milk https://a.com/1 https://b.com/2");
  assert.equal(r.url, "https://a.com/1");
  assert.equal(r.name, "Milk https://b.com/2");
});

test("displayDomain strips www and the path", () => {
  assert.equal(displayDomain("https://www.woolworths.com.au/shop/x?y=1"), "woolworths.com.au");
});

test("displayDomain returns the input when it will not parse", () => {
  assert.equal(displayDomain("not a url"), "not a url");
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `./links.ts` (module does not exist yet).

- [ ] **Step 4: Implement `lib/links.ts`**

Create `lib/links.ts`:

```ts
/**
 * Helpers for detecting a product link pasted into a shopping item's text and
 * showing it compactly. Pure and dependency-free, so the server action (the
 * source of truth) and the client (optimistic UI) can share exactly one rule.
 */

// Characters a URL should not keep when it is typed inline in a sentence.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Split free text into a clean name and the first http(s) URL it contains.
 *
 * - Only fully-qualified http/https URLs are detected; a bare "coles.com.au" or
 *   a "javascript:" URL is left untouched as plain text.
 * - If the text is only a URL, the name falls back to the display domain so the
 *   row is still readable.
 */
export function extractLink(text: string): { name: string; url: string | null } {
  const trimmed = text.trim();
  const match = trimmed.match(/https?:\/\/[^\s]+/i);
  if (!match) return { name: trimmed, url: null };

  const raw = match[0];
  const candidate = raw.replace(TRAILING_PUNCTUATION, "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { name: trimmed, url: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { name: trimmed, url: null };
  }

  const name = trimmed.replace(raw, "").replace(/\s+/g, " ").trim();
  return { name: name || displayDomain(candidate), url: candidate };
}

/** A compact host for display, e.g. "https://www.coles.com.au/p/x" -> "coles.com.au". */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm test`
Expected: PASS — `tests 9`, `pass 9`, `fail 0`.

- [ ] **Step 6: Lint and type-check**

Run: `pnpm run lint` → no errors.
Run: `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/links.ts lib/links.test.mts package.json eslint.config.mjs
git commit -m "feat(shopping): add link-detection helpers with tests"
```

---

### Task 2: Add the `url` column to `shopping_items`

**Files:**
- Modify: `db/schema.ts` (the `shoppingItems` table)
- Create: `db/migrations/0001_*.sql` (generated)

**Interfaces:**
- Produces: `ShoppingItem.url: string | null` (via `typeof shoppingItems.$inferSelect`), consumed by Tasks 3.

- [ ] **Step 1: Add the column to the schema**

In `db/schema.ts`, add a `url` column to `shoppingItems`, immediately after the `category` line:

```ts
  // Nullable: uncategorised items are grouped under "Other" in the UI.
  category: text("category"),
  // The product link for this item, if one was pasted. Always http(s); null when none.
  url: text("url"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`
Expected: a new file `db/migrations/0001_*.sql` is created.

- [ ] **Step 3: Review the generated SQL**

Run: `cat db/migrations/0001_*.sql`
Expected: exactly one statement, `ALTER TABLE "shopping_items" ADD COLUMN "url" text;` (a nullable add — no `NOT NULL`, no default, no data loss). If it contains anything else, stop and investigate before committing.

- [ ] **Step 4: Type-check and build**

Run: `pnpm exec tsc --noEmit` → no errors.
Run: `pnpm run build` → compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(shopping): add url column to shopping_items"
```

---

### Task 3: Detect on add and render the link chip

**Files:**
- Modify: `app/shopping/actions.ts` (`addShoppingItem`)
- Modify: `app/shopping/shopping-list.tsx` (optimistic add + row display)

**Interfaces:**
- Consumes: `extractLink`, `displayDomain` from `@/lib/links`; `ShoppingItem.url` from Task 2.

- [ ] **Step 1: Extract the link in the server action**

In `app/shopping/actions.ts`, add the import and rewrite `addShoppingItem`:

```ts
import { extractLink } from "@/lib/links";
```

```ts
export async function addShoppingItem(input: {
  name: string;
  category?: string | null;
}) {
  // `input.name` is the raw typed text; the server is the source of truth for
  // splitting out any pasted product URL.
  const { name, url } = extractLink(input.name);
  if (!name) return;
  const householdId = await requireHouseholdId();
  await getDb().insert(shoppingItems).values({
    householdId,
    name,
    url,
    category: input.category?.trim() || null,
  });
  revalidatePath("/shopping");
}
```

- [ ] **Step 2: Use the helper for the optimistic item and pass raw text to the action**

In `app/shopping/shopping-list.tsx`, update the imports:

```ts
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories";
import { extractLink, displayDomain } from "@/lib/links";
```

Rewrite `onAdd` so the temp item carries the cleaned name and `url`, while the action still receives the raw text:

```ts
  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const raw = name.trim();
    if (!raw) return;
    const cat = category.trim() || null;
    const { name: cleanName, url } = extractLink(raw);
    if (!cleanName) return;
    const temp: ShoppingItem = {
      id: crypto.randomUUID(),
      householdId: "optimistic",
      name: cleanName,
      category: cat,
      url,
      checked: false,
      addedById: null,
      createdAt: new Date(),
    };
    setName("");
    setCategory("");
    run({ type: "add", item: temp }, () =>
      addShoppingItem({ name: raw, category: cat }),
    );
  }
```

- [ ] **Step 3: Render the chip on each row (overflow-safe)**

In `app/shopping/shopping-list.tsx`, replace the item name `<span>` and add the chip before the delete button. The name gets `min-w-0 truncate`; the chip is `shrink-0` with a capped, truncating width:

```tsx
                    <span
                      className={`min-w-0 flex-1 truncate text-base ${
                        item.checked ? "text-zinc-400 line-through" : ""
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open link for ${item.name}`}
                        className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 rounded-full border border-black/10 px-2 py-0.5 text-xs text-zinc-600 hover:border-black/30 dark:border-white/15 dark:text-zinc-300 dark:hover:border-white/40"
                      >
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate">{displayDomain(item.url)}</span>
                      </a>
                    )}
```

- [ ] **Step 4: Lint, type-check, build**

Run: `pnpm run lint` → no errors.
Run: `pnpm exec tsc --noEmit` → no errors.
Run: `pnpm run build` → compiles successfully.

- [ ] **Step 5: Browser overflow check at phone widths**

Start the dev server (via the preview tooling / `pnpm run dev`).
Because `/shopping` is auth-gated and no local DB is configured, verify the row layout by rendering the list markup at 280/320/360/430px with a long URL (a static harness under `public/` served by dev, as used for the earlier responsive fix), and assert `scrollWidth === clientWidth` (0px overflow) at every width. Screenshot the 320px case showing the truncated chip.
Remove the harness file afterwards.

- [ ] **Step 6: Commit**

```bash
git add app/shopping/actions.ts app/shopping/shopping-list.tsx
git commit -m "feat(shopping): detect and display product links on items"
```

---

## Notes on verification limits

The add path writes to Neon, which is not configured in local dev, so Task 3 cannot exercise a real insert locally. The extraction logic it relies on is fully unit-tested in Task 1, and the wiring is covered by type-check + build + the browser overflow check. End-to-end confirmation happens on the Vercel preview (which has the database), per the PR checklist.
