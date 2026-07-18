/**
 * The categories offered by the shopping-list dropdown.
 *
 * This is the single source of truth: to add another category, add a string
 * here. Nothing else changes — `shopping_items.category` is a free-text column,
 * so no schema change or migration is needed, and existing items keep whatever
 * category they already have.
 */
export const SHOPPING_CATEGORIES = [
  "Fruit & Veg",
  "Dairy & Chilled",
  "Pantry",
] as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];
