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
