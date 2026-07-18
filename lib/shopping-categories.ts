/**
 * The categories offered by the shopping-list dropdown.
 *
 * These mirror the categories already in use in the household's list, using the
 * exact spelling stored in the database, ordered roughly by how a shop is walked
 * (fresh → staples → ambient → treats). To add another category, add a string
 * here. Nothing else changes — `shopping_items.category` is a free-text column,
 * so no schema change or migration is needed, and existing items keep whatever
 * category they already have.
 */
export const SHOPPING_CATEGORIES = [
  "Fruit / vegetables",
  "Dairy",
  "Grains / carbs / legumes",
  "Tins / jars",
  "Sauces",
  "Snacks",
] as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];
