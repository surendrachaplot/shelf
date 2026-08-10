// theme.ts — typed bridge from design.js to React Native.
//
// It holds no values of its own. Every number comes from design.js, which the
// auditor also imports; a constant that lived only here could drift from the
// thing that checks it, and then the gate would be checking a different app
// than the one that ships.
import { useMemo } from "react";
import { Platform, useColorScheme, type TextStyle } from "react-native";
import * as D from "./design.js";

export const {
  icon, sp, radius, TOUCH, TOUCH_MIN, TYPE_FLOOR, STROKE,
  springs, duration, easing, staggerDelay, pressScale, elevation,
  STAGGER_STEP, STAGGER_MAX_STEPS, LIST_KEYS,
} = D;

// The serif is not decoration. It is what separates content (the name of the
// thing you saved) from chrome (the label on the button that files it).
const serif = Platform.select(D.family.serif);

export type Palette = typeof D.light;

/** The four lists, and the one mark each. */
// `shape` is not decoration: a book and a film have covers (2:3), a place and
// a dish have photographs (1:1). Forcing one aspect on all four makes half the
// shelf look like it is missing artwork it was never going to have.
export const lists = {
  books: { label: "Books", one: "book", shape: "portrait" },
  restaurants: { label: "Restaurants", one: "place", shape: "square" },
  movies: { label: "Movies", one: "film", shape: "portrait" },
  recipes: { label: "Recipes", one: "recipe", shape: "square" },
  unsorted: { label: "Inbox", one: "item", shape: "square" },
} as const;

export const COVER_W = 62;
export const coverHeight = (list: keyof typeof lists) =>
  lists[list].shape === "portrait" ? Math.round(COVER_W * 1.5) : COVER_W;

const asText = (t: (typeof D.type)[keyof typeof D.type]): TextStyle => ({
  fontSize: t.fontSize,
  lineHeight: t.lineHeight,
  letterSpacing: t.letterSpacing,
  fontWeight: t.fontWeight as TextStyle["fontWeight"],
});

/** The type scale, ready to spread into a style. Never write a size by hand. */
export const t = {
  // Serif — content. The wordmark, list names, the titles of saved things.
  display: { ...asText(D.type.display), fontFamily: serif },
  title: { ...asText(D.type.title), fontFamily: serif },
  heading: { ...asText(D.type.heading), fontFamily: serif },
  itemTitle: { ...asText(D.type.heading), fontFamily: serif, fontWeight: "600" as const },
  quote: { ...asText(D.type.meta), fontFamily: serif, fontStyle: "italic" as const },
  // Sans — chrome. Labels, controls, metadata.
  body: asText(D.type.body),
  bodyMed: asText(D.type.bodyMed),
  meta: asText(D.type.meta),
  micro: { ...asText(D.type.micro), textTransform: "uppercase" as const },
  code: { fontFamily: "Menlo", ...asText(D.type.meta) },
};

/** Counts, dates, prices. Digits must not jitter between renders. */
export const numeric: TextStyle = { fontVariant: ["tabular-nums"] };

/**
 * Both schemes are first-class. Styles are built inside components from the
 * live palette rather than frozen at module scope — a StyleSheet created once
 * at import time cannot follow the system appearance, and "dark mode is a
 * v2 thing" is how an app ends up with one permanently wrong.
 */
export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? D.dark : D.light;
  return useMemo(() => ({ c, dark: scheme === "dark" }), [scheme]);
}
