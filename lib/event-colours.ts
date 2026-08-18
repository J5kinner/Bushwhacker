/**
 * The named colour palette a calendar event can carry. A closed set — not a
 * free colour picker — keeps the dots in the agenda visually consistent and
 * makes server-side validation a simple membership check. Hexes are chosen to
 * read clearly as small dots/chips on both a light and a dark background.
 */
export interface EventColour {
  name: string;
  hex: string;
}

export const EVENT_COLOURS: EventColour[] = [
  { name: "tomato", hex: "#e5484d" },
  { name: "tangerine", hex: "#f2994a" },
  { name: "sunflower", hex: "#e8b923" },
  { name: "fern", hex: "#4caf6e" },
  { name: "jade", hex: "#2fa88f" },
  { name: "sky", hex: "#3b9ee5" },
  { name: "cobalt", hex: "#4361ee" },
  { name: "lavender", hex: "#8b7ff0" },
  { name: "plum", hex: "#b15dc4" },
  { name: "graphite", hex: "#6b7280" },
];

const byName = new Map(EVENT_COLOURS.map((c) => [c.name, c.hex]));

/** The hex for a named palette colour, or undefined for null/unknown names. */
export function eventColourHex(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return byName.get(name);
}

/** Whether a value is one of the palette's names — used by action validation. */
export function isEventColour(name: string | null | undefined): boolean {
  return name != null && byName.has(name);
}
