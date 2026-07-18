/**
 * The default shopping-list categories, used to seed a household the first time
 * it has none (see `getShoppingCategories` in lib/queries.ts).
 *
 * After seeding, categories are household data — members add and remove their
 * own in Settings — so this list is only the starting point, not the source of
 * truth. It is ordered roughly by how a shop is walked (fresh → staples →
 * ambient → treats).
 */
export const DEFAULT_SHOPPING_CATEGORIES = [
  "Fruit / vegetables",
  "Dairy",
  "Grains / carbs / legumes",
  "Tins / jars",
  "Sauces",
  "Snacks",
] as const;
