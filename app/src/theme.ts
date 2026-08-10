// theme.ts — typed bridge from design.js to React Native.
//
// It holds no values of its own. Every number comes from design.js, which the
// auditor also imports; a constant that lived only here could drift from the
// thing that checks it, and then the gate would be checking a different app
// than the one that ships.
import { useMemo } from "react";
import { useColorScheme, type TextStyle } from "react-native";
import * as D from "./design.js";

export const {
  glyph, sp, radius, TOUCH, TOUCH_MIN, TYPE_FLOOR,
  springs, duration, easing, staggerDelay, pressScale,
  STAGGER_STEP, STAGGER_MAX_STEPS,
} = D;

export type Palette = typeof D.light;

/** The four lists, and the one mark each. */
export const lists = {
  books: { label: "Books", glyph: "📚" },
  restaurants: { label: "Restaurants", glyph: "🍜" },
  movies: { label: "Movies", glyph: "🎬" },
  recipes: { label: "Recipes", glyph: "🥣" },
  unsorted: { label: "Unsorted", glyph: "📥" },
} as const;

const asText = (t: (typeof D.type)[keyof typeof D.type]): TextStyle => ({
  fontSize: t.fontSize,
  lineHeight: t.lineHeight,
  letterSpacing: t.letterSpacing,
  fontWeight: t.fontWeight as TextStyle["fontWeight"],
});

/** The type scale, ready to spread into a style. Never write a size by hand. */
export const t = {
  display: asText(D.type.display),
  title: asText(D.type.title),
  heading: asText(D.type.heading),
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
