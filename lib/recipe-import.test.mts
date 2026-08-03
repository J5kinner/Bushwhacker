import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicaliseRecipeUrl,
  parseRecipeHtml,
  RecipeImportError,
} from "./recipe-import.ts";

function ldPage(json: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(
    json,
  )}</script></head><body></body></html>`;
}

test("canonicaliseRecipeUrl keeps the path, drops query and hash", () => {
  assert.equal(
    canonicaliseRecipeUrl(
      "https://www.recipetineats.com/thai-grilled-chicken-gai-yang/?utm_source=x#steps",
    ),
    "https://www.recipetineats.com/thai-grilled-chicken-gai-yang/",
  );
});

test("canonicaliseRecipeUrl rejects other sites", () => {
  assert.throws(
    () => canonicaliseRecipeUrl("https://www.bbcgoodfood.com/recipes/x"),
    RecipeImportError,
  );
});

test("canonicaliseRecipeUrl rejects lookalike hosts", () => {
  assert.throws(
    () => canonicaliseRecipeUrl("https://evilrecipetineats.com/x/"),
    RecipeImportError,
  );
});

test("canonicaliseRecipeUrl rejects text that is not a URL", () => {
  assert.throws(() => canonicaliseRecipeUrl("gai yang"), RecipeImportError);
});

test("parseRecipeHtml reads a plain Recipe node", () => {
  const html = ldPage({
    "@type": "Recipe",
    name: "Thai Grilled Chicken",
    recipeIngredient: ["1 kg chicken thighs", "2 tbsp fish sauce"],
  });
  assert.deepEqual(parseRecipeHtml(html), {
    title: "Thai Grilled Chicken",
    ingredients: ["1 kg chicken thighs", "2 tbsp fish sauce"],
  });
});

test("parseRecipeHtml finds the Recipe inside an @graph wrapper", () => {
  const html = ldPage({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", name: "Post" },
      {
        "@type": ["Recipe"],
        name: "Gai Yang",
        recipeIngredient: ["1 lemongrass stalk"],
      },
    ],
  });
  assert.deepEqual(parseRecipeHtml(html), {
    title: "Gai Yang",
    ingredients: ["1 lemongrass stalk"],
  });
});

test("parseRecipeHtml decodes entities and collapses whitespace", () => {
  const html = ldPage({
    "@type": "Recipe",
    name: "Nagi&#039;s  Chicken &amp; Rice",
    recipeIngredient: ["2 tbsp  fish&nbsp;sauce "],
  });
  assert.deepEqual(parseRecipeHtml(html), {
    title: "Nagi's Chicken & Rice",
    ingredients: ["2 tbsp fish sauce"],
  });
});

test("parseRecipeHtml skips malformed JSON-LD blocks and keeps looking", () => {
  const html =
    `<script type="application/ld+json">{not json}</script>` +
    ldPage({
      "@type": "Recipe",
      name: "Soup",
      recipeIngredient: ["1 onion"],
    });
  assert.equal(parseRecipeHtml(html)?.title, "Soup");
});

test("parseRecipeHtml returns null when no recipe is present", () => {
  const html = ldPage({ "@type": "Article", name: "Just a post" });
  assert.equal(parseRecipeHtml(html), null);
});

test("parseRecipeHtml ignores a Recipe node with no usable ingredients", () => {
  const html = ldPage({ "@type": "Recipe", name: "Empty", recipeIngredient: [] });
  assert.equal(parseRecipeHtml(html), null);
});
