/**
 * Import a recipe from recipetineats.com by reading the schema.org Recipe
 * JSON-LD embedded in the page. Parsing the HTML is pure (unit-testable);
 * only `fetchRecipe` touches the network.
 */

export type ImportedRecipe = {
  title: string;
  url: string;
  ingredients: string[];
};

/** Raised for any user-facing import failure (bad URL, no recipe found…). */
export class RecipeImportError extends Error {}

/**
 * Validate and canonicalise a pasted recipe URL: https, recipetineats.com
 * (or a subdomain), with tracking query strings and fragments dropped so the
 * same recipe always stores as the same URL.
 */
export function canonicaliseRecipeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new RecipeImportError("That doesn't look like a valid link.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RecipeImportError("Recipe links must start with https://");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "recipetineats.com" && !host.endsWith(".recipetineats.com")) {
    throw new RecipeImportError(
      "Only recipetineats.com links are supported for now.",
    );
  }
  return `https://${host}${parsed.pathname}`;
}

// Minimal entity decoding for the handful that appear in recipe JSON-LD text.
const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
}

function cleanText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

// A JSON-LD node's @type can be a string or an array ("Recipe", ["Recipe", …]).
function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (typeof node !== "object" || node === null) return false;
  const type = (node as Record<string, unknown>)["@type"];
  return Array.isArray(type) ? type.includes("Recipe") : type === "Recipe";
}

// Search a parsed JSON-LD document for the Recipe node: the node itself, an
// array of nodes, or nodes nested under an @graph wrapper.
function findRecipeNode(doc: unknown): Record<string, unknown> | null {
  if (isRecipeNode(doc)) return doc;
  if (Array.isArray(doc)) {
    for (const node of doc) {
      const found = findRecipeNode(node);
      if (found) return found;
    }
    return null;
  }
  if (typeof doc === "object" && doc !== null && "@graph" in doc) {
    return findRecipeNode((doc as Record<string, unknown>)["@graph"]);
  }
  return null;
}

/**
 * Pull the recipe title and ingredient list out of a recipe page's HTML via
 * its schema.org Recipe JSON-LD. Returns null when the page has none.
 */
export function parseRecipeHtml(
  html: string,
): { title: string; ingredients: string[] } | null {
  const scripts = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, json] of scripts) {
    let doc: unknown;
    try {
      doc = JSON.parse(json);
    } catch {
      continue;
    }
    const recipe = findRecipeNode(doc);
    if (!recipe) continue;

    const rawIngredients = recipe.recipeIngredient;
    if (!Array.isArray(rawIngredients)) continue;
    const ingredients = rawIngredients
      .filter((i): i is string => typeof i === "string")
      .map(cleanText)
      .filter(Boolean);
    if (ingredients.length === 0) continue;

    const title =
      typeof recipe.name === "string" && recipe.name.trim()
        ? cleanText(recipe.name)
        : "Untitled recipe";
    return { title, ingredients };
  }
  return null;
}

/** Fetch a recipetineats.com page and parse its recipe. Throws RecipeImportError. */
export async function fetchRecipe(input: string): Promise<ImportedRecipe> {
  const url = canonicaliseRecipeUrl(input);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        // Some WordPress hosts reject requests without a browser-ish UA.
        "user-agent":
          "Mozilla/5.0 (compatible; HomeSync/1.0; +https://github.com/J5kinner/Bushwhacker)",
        accept: "text/html",
      },
      cache: "no-store",
    });
  } catch {
    throw new RecipeImportError(
      "Couldn't reach recipetineats.com. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    throw new RecipeImportError(
      `recipetineats.com responded with ${response.status}. Check the link and try again.`,
    );
  }

  const parsed = parseRecipeHtml(await response.text());
  if (!parsed) {
    throw new RecipeImportError(
      "No recipe found on that page. Make sure the link is a recipe page.",
    );
  }
  return { ...parsed, url };
}
