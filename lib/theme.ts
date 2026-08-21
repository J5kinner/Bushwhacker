/**
 * The theme preference cookie.
 *
 * The database row on `users.darkMode` remains the source of truth — this
 * cookie is a per-device mirror of it, and exists so the root layout can apply
 * the theme without a request-time read. Deliberately not httpOnly: the inline
 * script in the root layout reads it from `document.cookie` before first paint,
 * which is the whole point of it.
 */
export const THEME_COOKIE = "homesync-theme";

/** A year. The preference is stable, and an expiry only means a one-frame flash. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Theme = "dark" | "light";

export function themeFor(darkMode: boolean): Theme {
  return darkMode ? "dark" : "light";
}

/**
 * Writes the theme cookie from the browser.
 *
 * The Server Action writes it too, but only when the toggle is used. This is
 * for the other case: a device that has never toggled has no cookie, so it
 * would paint light even for a member whose saved preference is dark. The
 * settings page knows the saved value and calls this to reconcile, which costs
 * one flash on one page instead of every page forever.
 */
export function writeThemeCookieFromBrowser(theme: Theme): void {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${theme}; max-age=${THEME_COOKIE_MAX_AGE}; path=/; samesite=lax${secure}`;
  } catch {
    /* cookies disabled — the theme just won't persist on this device */
  }
}
