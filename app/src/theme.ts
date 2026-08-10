// theme.ts — one palette, one type scale, defined once.
//
// Deliberately not soundcheck's palette: different product, different mood.
// What IS carried over is the discipline — a fixed set of tokens, and no
// component inventing a colour or a size that does not appear here.
export const c = {
  bg: "#FAF9F6",
  card: "#FFFFFF",
  ink: "#1A1A1A",
  inkSoft: "#6B6862",
  line: "#E6E2DA",
  accent: "#B4541F",
  accentSoft: "#F3E7DF",
  ok: "#2F6B4F",
} as const;

export const lists = {
  books: { label: "Books", glyph: "📚" },
  restaurants: { label: "Restaurants", glyph: "🍜" },
  movies: { label: "Movies", glyph: "🎬" },
  recipes: { label: "Recipes", glyph: "🥣" },
  unsorted: { label: "Unsorted", glyph: "📥" },
} as const;

export const t = {
  title: { fontSize: 26, fontWeight: "700", color: c.ink, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: "600", color: c.ink },
  body: { fontSize: 15, color: c.ink },
  meta: { fontSize: 13, color: c.inkSoft },
  tiny: { fontSize: 11, color: c.inkSoft, letterSpacing: 0.4, textTransform: "uppercase" },
} as const;

// One radius, one touch target. 44pt is Apple's minimum and every tappable
// thing here meets it — the share sheet in particular is used one-handed,
// in a hurry, over another app.
export const radius = 14;
export const touch = 48;
