// tags.js — what an item can be filed under, read off the facts it already has.
//
// Plain JS with no imports, like design.js and facts.js, so the app draws the
// tags, a node selftest checks them, and the server can print the same ones on
// a public page. One place decides what a tag IS.
//
// ── A TAG IS A FACT, NEVER A GUESS ──────────────────────────────────────────
//
// The complaint people make about the other app is that its tags are too broad
// to be worth filtering by: a model looks at a picture and says "food". Nothing
// here is inferred. A catalogue said who wrote the book, who directed the film
// and which neighbourhood the restaurant is in, and those are the tags —
// "Susanna Clarke", "Ryan Coogler", "Peckham". If the catalogue did not say it,
// there is no tag, and an item with no tags is a correct answer.
//
// THE FIELDS ARE THE ONES THE SERVER REALLY SENDS (api/enrich/index.js), and
// they do not agree with each other, which is why this is not a loop over a
// list of key names:
//
//   books        author, year (a NUMBER), subjects[]
//   movies       director, year (a STRING), genres[], cast[]
//   restaurants  area, cuisine[]        — and no city: Nominatim's row has none
//   places       area, city
//   recipes      author, cuisine (a STRING, not an array)
//   quotes       NOTHING. `enrich()` hands a quote back with `canonical: {}`,
//                and whoever said it is in `subtitle`, where the reading step
//                is told to put it. So for a quote, and only for a quote, the
//                subtitle is the author.
//   any          article.siteName, once a page has been read

/**
 * Fold accents and case away.
 *
 * `String.prototype.normalize` is the one-line version, and the app runs on
 * Hermes, where availability is not something to assume from memory. So: use
 * it when the engine has it, and otherwise walk a table of the Latin-1 letters
 * that actually turn up in book titles and restaurant names. The table path is
 * exercised by the selftest, not just carried as a comfort.
 *
 * It lives HERE and find.js re-exports it, because this file may import
 * nothing and a tag's identity and a search's matching must fold the same way:
 * a tag you can see and cannot find by typing it is two definitions of "same".
 */
const ACCENTS = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a", ā: "a",
  é: "e", è: "e", ê: "e", ë: "e", ē: "e",
  í: "i", ì: "i", î: "i", ï: "i", ī: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o", ø: "o", ō: "o",
  ú: "u", ù: "u", û: "u", ü: "u", ū: "u",
  ñ: "n", ç: "c", ß: "ss", æ: "ae", œ: "oe", ý: "y", ÿ: "y",
};

export function fold(s, useNormalize = typeof "".normalize === "function") {
  let out = String(s ?? "").toLowerCase();
  if (useNormalize) {
    try {
      return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
    } catch (_) {
      /* fall through to the table */
    }
  }
  let built = "";
  for (const ch of out) built += ACCENTS[ch] ?? ch;
  return built;
}

/**
 * The stable id of a tag: `author:susanna clarke`.
 *
 * Folded, and with punctuation and spacing flattened, so "Susanna Clarke",
 * "susanna clarke" and "Susanna  Clarke." are ONE tag with three spellings and
 * not three tags with one book each. Punctuation is named rather than "anything
 * that is not a-z": a name in another script has to survive as itself, and a
 * `[^a-z0-9]` here would turn every one of them into the same empty key.
 */
export function tagKey(kind, value) {
  const v = fold(value).replace(/[\s.,;:!?'"’‘“”()\[\]\/_-]+/g, " ").trim();
  return v ? `${kind}:${v}` : "";
}

// Open Library's `year` is a number and TMDB's is a string. Either way it has
// to LOOK like a year before it becomes one: a decade of "0s" out of a missing
// release date is exactly the empty tag rule 1 forbids.
const yearOf = (v) => (/^(1[5-9]|20)\d\d$/.test(String(v ?? "").trim()) ? String(v).trim() : "");

/**
 * The tags of one item, in the order a person would filter by.
 *
 * WHO MADE IT, then WHERE IT IS, then WHAT KIND, then WHO IS IN IT, then WHEN,
 * then where you read it. Not alphabetical and not the API's order: "everything
 * by this author" is the filter people reach for first, and "everything from
 * the 2020s" is the one they reach for last.
 *
 * ONLY A FILED ITEM HAS TAGS. A pending or unread row is a link nobody has
 * read yet, and whatever is sitting in its fields is not a fact about anything.
 *
 * @returns {Array<{kind: string, value: string, key: string}>}
 */
export function tagsFor(item) {
  if (!item || item.status !== "filed") return [];
  const c = (item.canonical && typeof item.canonical === "object" && item.canonical) || {};
  const out = [];
  const seen = new Set();

  // One value or an array of them — `cuisine` is both, depending on the shelf.
  const add = (kind, v) => {
    for (const one of Array.isArray(v) ? v : [v]) {
      if (typeof one !== "string" && typeof one !== "number") continue;
      const value = String(one).replace(/\s+/g, " ").trim();
      const key = tagKey(kind, value);
      // 60 is a length no name reaches and a sentence always does. A blurb
      // that landed in an author field is not a tag.
      if (!key || value.length > 60 || seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, value, key });
    }
  };

  add("author", c.author || (item.list === "quotes" ? item.subtitle : null));
  add("director", c.director);
  // Nominatim falls back to the city when a place has no suburb, so `area` and
  // `city` are often the same word. Said once, as the city.
  if (tagKey("x", c.area) !== tagKey("x", c.city)) add("area", c.area);
  add("city", c.city);
  add("cuisine", c.cuisine);
  // A book's subjects and a film's genres are the same question asked of two
  // catalogues, so they are one kind: "Fantasy" finds the novel AND the film.
  add("genre", c.genres);
  add("genre", c.subjects);
  add("cast", c.cast);
  const year = yearOf(c.year);
  add("year", year);
  add("decade", year ? `${year.slice(0, 3)}0s` : null);
  add("site", c.article && c.article.siteName);

  return out;
}

/**
 * Every tag on the shelf, with what is under it — what a tag view lists.
 *
 * Most-used first, then by name, so the order does not shuffle between two
 * tags with the same count every time the shelf is re-read. The spelling shown
 * is the first one met.
 *
 * @returns {Array<{key: string, kind: string, value: string, count: number, ids: string[]}>}
 */
export function tagIndex(items) {
  const by = new Map();
  for (const item of items || []) {
    for (const t of tagsFor(item)) {
      let row = by.get(t.key);
      if (!row) by.set(t.key, (row = { key: t.key, kind: t.kind, value: t.value, count: 0, ids: [] }));
      row.count++;
      row.ids.push(item.id);
    }
  }
  const name = (r) => r.key.slice(r.kind.length + 1);
  return [...by.values()].sort((a, b) =>
    b.count - a.count || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : a.key < b.key ? -1 : 1));
}

/** The items under one tag, in the order they were given. */
export const itemsWithTag = (items, key) =>
  (items || []).filter((item) => tagsFor(item).some((t) => t.key === key));
