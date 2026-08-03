# Clear bought items — design

Date: 2026-08-03
Status: approved

## Problem

Bought (checked) items accumulate on the shopping list forever.
After a shop, the only way to remove them is deleting each item one by one with the bin icon.
This is the largest daily friction on the shopping page.

## Design

### UI

When at least one item is checked, a slim row appears at the top of the list, above the first category heading:

- Left: a count label, e.g. `3 bought`.
- Right: a `Clear bought` text button.

Tapping the button flips it to a red confirm state, e.g. `Clear 3 items?`.
A second tap within about 4 seconds clears the items; otherwise the button reverts to its resting state.
No dialog and no new components — the confirm state is local component state in `ShoppingList`.

The row is hidden entirely when nothing is checked.

### Server

One new Server Action in `app/shopping/actions.ts`:

```ts
clearBoughtItems(): Promise<void>
```

It deletes every checked item for the current household
(`DELETE FROM shopping_items WHERE household_id = ? AND checked = true`)
and then calls `revalidatePath("/shopping")`.
No schema change and no migration.

### Client

A new `{ type: "clear" }` case in the existing optimistic reducer filters out checked items.
It is dispatched through the existing `run()` helper so failures surface through the same error path as add, toggle, and delete.
Categories whose items are all cleared disappear naturally, because groups are derived from the item list.

## Edge cases

- If the other household member checks an item between the two taps, the count label may be momentarily stale, but the server deletes by `checked = true`, so whatever is actually bought is cleared — the intended meaning.
- If the clear empties the whole list, the existing "Nothing on the list yet" empty state shows.

## Verification

- `pnpm run lint` and `pnpm run build` pass.
- Manual check on the Vercel preview from a phone: check items, clear them, confirm the revert-on-timeout behaviour.
