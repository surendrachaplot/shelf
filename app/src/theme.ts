// theme.ts — typed bridge from design.js to React Native.
//
// It holds no values of its own. Every number comes from design.js, which the
// auditor also imports; a constant that lived only here could drift from the
// thing that checks it.
import { useMemo } from "react";
import { Platform, useColorScheme, type TextStyle } from "react-native";
import * as D from "./design.js";

export const {
  icon, sp, radius, TOUCH, TOUCH_MIN, TYPE_FLOOR, STROKE,
  springs, duration, easing, staggerDelay, pressScale, elevation,
  STAGGER_STEP, STAGGER_MAX_STEPS, LIST_KEYS, listOn,
  BOARD, BAND_BOARD, RULE, HAIRLINE, COVER_KEYLINE, JACKET_GLYPH, cover, coverFor, jacketType, quoteType, excerpt, mainTitle, gridFor, rowsOf, emptyBoards, emptyPitch, EMPTY_BOARD_H, rowPitch, MAX_EMPTY_BOARDS, mix, placeholderOn, PLACEHOLDER_MIN,
} = D;

const sans = Platform.select(D.family.sans);

export type Palette = typeof D.light;

export const lists = {
  books: { label: "Books", one: "book", n: "01" },
  restaurants: { label: "Restaurants", one: "place", n: "02" },
  movies: { label: "Movies", one: "film", n: "03" },
  recipes: { label: "Recipes", one: "recipe", n: "04" },
  quotes: { label: "Quotes", one: "quote", n: "05" },
  places: { label: "Places", one: "place", n: "06" },
  unsorted: { label: "Not shelved", one: "item", n: "00" },
} as const;

export const LIST_ORDER = ["books", "restaurants", "movies", "recipes", "quotes", "places"] as const;

// Indexed by a string that came off the wire — a share target, a received
// delivery, a search hit — where the type system cannot know it is one of the
// five. Falling back to the raw key is right: a list we do not recognise is
// still better rendered as its own name than as "undefined".
const byKey = lists as Record<string, { label: string; one: string; n: string }>;
export const labelOf = (key: string | null | undefined) => byKey[key ?? ""]?.label ?? String(key ?? "");
export const oneOf = (key: string | null | undefined) => byKey[key ?? ""]?.one ?? "item";
export const numberOf = (key: string | null | undefined) => byKey[key ?? ""]?.n ?? "00";

const asText = (t: (typeof D.type)[keyof typeof D.type], extra: TextStyle = {}): TextStyle => ({
  fontFamily: sans,
  fontSize: t.fontSize,
  lineHeight: t.lineHeight,
  letterSpacing: t.letterSpacing,
  fontWeight: t.fontWeight as TextStyle["fontWeight"],
  ...extra,
});

/**
 * One family, four jobs. Everything caps-and-tracked is chrome; only item
 * titles are not.
 *
 * DISPLAY IS SET TIGHT, NOT SOLID — and that distinction cost a bug report.
 * The wordmark was 42pt type in a 38pt line box, four points shorter than the
 * type it holds. On the web that is fine: CSS line-height smaller than the
 * font size overflows the box and draws anyway. **On iOS the glyph is clipped
 * to the line box**, and what gets clipped is whatever reaches highest — in
 * "shelf" that is the f, whose hook is the tallest thing in the word. Reported
 * from a device as "the f of shelf is getting cut".
 *
 * The render harness could never have caught it: react-native-web emits CSS
 * line-height, which does not clip. Same shape as the safe-area bug — the
 * harness is a browser, and a browser is not the phone.
 *
 * 48 is fontSize + 6: above the type with headroom for an ascender, and still
 * well under the ~50pt this face would take naturally. The header row is
 * 44pt of tap target either way, so this costs four points of chrome.
 */
export const t = {
  wordmark: { ...asText(D.type.display), fontWeight: "700" as const, fontSize: 42, lineHeight: 48, letterSpacing: -2.6 },
  band: { ...asText(D.type.title), fontWeight: "700" as const, fontSize: 31, lineHeight: 31, letterSpacing: -1.5, textTransform: "uppercase" as const },
  itemTitle: { ...asText(D.type.heading), fontWeight: "700" as const, letterSpacing: -0.4 },
  // A jacket title. Set solid-ish and ranged left, the way a cover is set —
  // leading that is comfortable in a paragraph is a hole in a 104pt rectangle.
  coverTitle: { ...asText(D.type.heading), fontWeight: "700" as const, lineHeight: Math.round(D.type.heading.fontSize * 1.05), letterSpacing: -0.5 },
  detailTitle: { ...asText(D.type.display), fontWeight: "700" as const, letterSpacing: -1.4 },
  section: { ...asText(D.type.meta), fontWeight: "700" as const, letterSpacing: 0.9, textTransform: "uppercase" as const },
  // Set on a jacket: the series line at the top of a cover, the author at
  // the foot. Tighter tracking than `micro` because it sits inside 96pt.
  tag: { ...asText(D.type.micro), fontWeight: "700" as const, letterSpacing: 0.5, textTransform: "uppercase" as const },
  body: asText(D.type.body),
  bodyMed: asText(D.type.bodyMed),
  meta: asText(D.type.meta),
  micro: { ...asText(D.type.micro), fontWeight: "700" as const, letterSpacing: 1.8, textTransform: "uppercase" as const },
  code: { ...asText(D.type.meta), fontFamily: "Menlo" },
};

export const numeric: TextStyle = { fontVariant: ["tabular-nums"] };

export function useTheme() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? D.dark : D.light;
  return useMemo(() => ({ c, dark: scheme === "dark" }), [scheme]);
}
