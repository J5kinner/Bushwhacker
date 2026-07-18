# Feature spec — Product links on shopping items

- **Date:** 2026-07-18
- **Status:** Design (approved, not yet implemented)

## Goal

Let either partner attach a website link to a shopping item — a product page for the exact thing to
buy — by pasting the URL straight into the add box, and show that link in the list in a compact form
that never blows out the phone's width.
Today a pasted URL becomes the item's name, so long links wrap badly and widen the screen.

## Scope

**In scope:**
detect an `http(s)` URL in the typed text, store it separately from the name, and render it as a
small tappable "domain chip" on the item row.

**Out of scope (YAGNI for now):**
editing a link in place (delete and re-add the item instead), more than one link per item, fetching
the site's favicon or page title, and any link preview/unfurl.
These can become their own specs if wanted.

## Data model

Neon PostgreSQL via Drizzle ORM.
Add one nullable column to the existing `shopping_items` table — no new table.

```ts
export const shoppingItems = pgTable("shopping_items", {
  // ...existing columns unchanged...
  // The product link for this item, if one was pasted. Always http(s); null when there is none.
  url: text("url"),
});
```

Generate the migration with `pnpm drizzle-kit generate`, review the SQL, and let CI apply it on
deploy (the migrate-on-deploy workflow already in the repo).
The column is nullable, so every existing item is valid with `url = NULL` — no backfill.

## Link detection

A small, pure, unit-testable helper module so the rule lives in exactly one place.

```ts
// lib/links.ts

/**
 * Split free text into a clean name and the first http(s) URL it contains.
 * If the text is only a URL, the name falls back to the URL's display domain so
 * the row is still readable. If there is no valid http(s) URL, url is null and
 * the name is just the trimmed text.
 */
export function extractLink(text: string): { name: string; url: string | null };

/** A compact host for display, e.g. "https://www.coles.com.au/p/x" -> "coles.com.au". */
export function displayDomain(url: string): string;
```

Rules:

- Match the first `https?://…` run in the text; strip trailing punctuation (`.,;:!?)]}`).
- Validate it with the `URL` constructor and require `protocol` to be `http:` or `https:` — anything
  else (e.g. `javascript:`, or a bare `coles.com.au` with no scheme) is treated as plain text, not a
  link.
- `name` = the text with that URL removed, inner whitespace collapsed, trimmed.
- If `name` is then empty, `name = displayDomain(url)`.
- `displayDomain` returns the hostname without a leading `www.`; if the URL somehow will not parse it
  returns the raw string, and the chip falls back to the label "link".

## Mutation

The server action is the source of truth for extraction, so a paste is parsed the same way no matter
what the client sends.

- `addShoppingItem({ name, category })` — `name` is the raw typed text.
  The action runs `extractLink(name)` and inserts `{ name, url, category }`.
- The client runs the *same* `extractLink` on submit only to build the optimistic temp item (so the
  clean name + chip appear instantly); it still sends the raw text, and the server re-derives.
  One shared function, no divergence.

## UI

On each item row in the **Shopping** tab, between the name and the delete button:

- When `item.url` is set, render an anchor styled as a compact chip: a `link` icon (Lucide) plus the
  display domain, e.g. `🔗 coles.com.au`.
- The anchor opens in a new tab: `target="_blank"`, `rel="noopener noreferrer"`.
- **Overflow discipline (the core of the request):**
  the name span gets `min-w-0` and truncates; the chip is `shrink-0` with a capped `max-width` and
  its domain text truncates with an ellipsis.
  A very long URL therefore can never widen the row or the page.
- Optimistic add/check-off/delete keep working; the temp item simply carries `url` too.

## Edge cases and rules

- **URL only** (no other words): name falls back to the display domain; the chip still shows.
- **Multiple URLs**: the first becomes the link; any later ones stay in the name text as-is (rare;
  not worth special handling).
- **No scheme** (`coles.com.au`): left as plain text — we do not guess `https://`, to avoid turning
  ordinary words with dots into links.
- **Non-http scheme**: ignored (see detection rules) — a guard against `javascript:` and friends.
- Existing items are unaffected: `url` is null and no chip renders.

## Acceptance criteria

1. Pasting `Olive oil https://www.coles.com.au/p/olive-oil-123` adds an item named "Olive oil" with a
   chip reading `coles.com.au` that opens the URL in a new tab.
2. Pasting only `https://www.coles.com.au/p/olive-oil-123` adds an item named "coles.com.au" with the
   chip.
3. Typing `Milk` (no URL) adds a plain item with no chip, exactly as before.
4. A pasted `javascript:alert(1)` or a bare `coles.com.au` is kept as plain text, not linkified.
5. On a 320px-wide phone, an item with a very long URL shows the truncated chip and causes **no**
   horizontal scrolling; the Add button and bottom tabs stay reachable.
6. Existing items (no `url`) render unchanged.

## Verification

- `pnpm run lint`, `pnpm exec tsc --noEmit`, `pnpm run build` — all pass.
- `pnpm drizzle-kit generate` produces a single `ADD COLUMN url` migration; review the SQL before
  committing.
- Browser check at 280–430px with a pathologically long URL: measured row/page overflow is 0px.

## Caveats

Link targets are whatever the household pastes; there is no server-side reachability or safety check
beyond the scheme allow-list, which is appropriate for two trusted accounts.
Because there is no favicon or title fetch, the chip shows the domain, not the product name — a
deliberate trade for privacy (no third-party requests) and offline rendering.
