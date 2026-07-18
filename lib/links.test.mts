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

test("extractLink keeps a balanced closing bracket inside the URL", () => {
  assert.deepEqual(extractLink("https://en.wikipedia.org/wiki/Nirvana_(band)"), {
    name: "en.wikipedia.org",
    url: "https://en.wikipedia.org/wiki/Nirvana_(band)",
  });
});

test("extractLink strips an unbalanced trailing bracket", () => {
  assert.equal(
    extractLink("Snacks https://coles.com.au/p/x)").url,
    "https://coles.com.au/p/x",
  );
});

test("displayDomain strips www and the path", () => {
  assert.equal(displayDomain("https://www.woolworths.com.au/shop/x?y=1"), "woolworths.com.au");
});

test("displayDomain returns the input when it will not parse", () => {
  assert.equal(displayDomain("not a url"), "not a url");
});
