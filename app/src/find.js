// find.js — one box that looks through everything you have ever kept.
//
// Plain JS, like design.js and facts.js, so the app renders it and a node
// selftest drives every branch with fixtures. Ranking is the kind of code that
// is wrong in ways a screenshot cannot show — "why is that fourth" has no
// visual answer — so it lives where it can be asserted.
//
// ONE import, and it is another file of the same kind: tags.js, which itself
// imports nothing. Search has to find a thing by the tag printed on it, so the
// tags and the way text is folded are read from the one place that defines
// them instead of being written out a second time here.
//
// ── WHY LOCAL SEARCH IS A DIFFERENT THING FROM `Add` ────────────────────────
//
// `Add` searches CATALOGUES: Open Library, TMDB, OpenStreetMap. It answers
// "what is this thing called". This answers "did I keep it, and where did I
// put it" — and the answer is already on the phone, so it costs nothing, needs
// no network, and can run on every keystroke instead of behind a debounce.
//
// Six shelves is the reason it has to exist. Once a person has two hundred
// items across books, restaurants, movies, recipes, quotes and places, the
// tabs are a filing system and not a way to FIND anything: you remember "that
// Korean place someone mentioned", not which of six tabs you filed it under.
// A search that made you pick the shelf first would be asking you the question
// you opened it to ask.
//
// ── THE RULES THIS FILE IS BUILT ON ─────────────────────────────────────────
//
// 1. EVERY WORD MUST MATCH SOMETHING. Two words are a narrowing, never a
//    widening. "clarke piranesi" returns the one book, not everything by
//    Clarke plus everything called Piranesi.
// 2. MATCH THE FIELDS A PERSON ACTUALLY REMEMBERS. The title, yes — but also
//    the author, the city, the cuisine, the year, and above all THE NOTE THEY
//    TYPED. A note is the most personal text in the app and searching it is
//    most of the value of having written it.
// 3. A MATCH THE TITLE DOES NOT EXPLAIN MUST SAY WHERE IT CAME FROM. A row
//    reading "Ganapati" for the query "peckham" looks like a bug unless the
//    row says "Peckham · London" is what matched. §8: never make somebody
//    guess why they are looking at something.
// 4. FORGIVE THE TYPING. Accents, case, punctuation and one wrong letter in a
//    long word are all things people do at 1am, and none of them mean "show me
//    nothing".

// Accents and case are folded in tags.js, so a tag's identity and a search's
// matching can never disagree about whether two spellings are the same word.
import { fold, tagsFor } from "./tags.js";
export { fold };

/** Field weights. Title dominates; a caption is background noise that should
 *  break a tie and never win one. */
// `list` is worth more than it looks. Typing a shelf's own name in full is an
// unambiguous instruction — "books" means show me my books — and it has to
// outrank a one-letter typo match on some other shelf's title, which is worth
// 5. It stays below a title PREFIX (8.5) so a real title always wins.
//
// `tags` sits just above `facts`: a tag IS a fact, picked as one a person
// would filter by, so the author's name on the tag outranks the same word
// turning up in an address — and the row can say "tags: Susanna Clarke"
// instead of a run of every fact the catalogue had.
//
// `ocr` and `article` are BODY TEXT and are low on purpose. An article is
// three thousand words; almost any query is in one somewhere. Both stay under
// 5, the WEAKEST thing a title can score (a typo), so a title match of any
// kind outranks a body match of every kind. The words in a screenshot are
// what the screenshot IS, so they beat an article's; an article beats a
// caption, which is somebody else's hashtags.
export const W = { title: 10, subtitle: 4, tags: 4.5, facts: 4, note: 3, list: 6, ocr: 2, article: 1.5, caption: 1 };

/** Foldable words, punctuation dropped. "St. John's" → ["st","john","s"]. */
export const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** First letters, for "hp" → "Harry Potter". Only ever tried on a title. */
export const initials = (toks) => toks.map((w) => w[0]).join("");

/**
 * One substitution, insertion, deletion or transposition apart?
 *
 * Bounded at one on purpose. Two edits on an eight-letter word starts matching
 * unrelated words, and a search that returns things you did not ask for is
 * worse than one that returns nothing: nothing is a fact you can act on.
 */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diff = -1;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        if (diff >= 0) {
          // A transposition — "teh" for "the" — is one keystroke, not two.
          return diff === i - 1 && a[diff] === b[i] && a[i] === b[diff] &&
            a.slice(i + 1) === b.slice(i + 1);
        }
        diff = i;
      }
    }
    return true;
  }
  const [long, short] = la > lb ? [a, b] : [b, a];
  for (let i = 0, j = 0; i < long.length; i++) {
    if (long[i] === short[j]) j++;
    else if (i !== j) return false;
  }
  return true;
}

/**
 * How well one typed word matches one stored word, 0 to 1.
 *
 * The gaps between these numbers are the ranking. A word you typed in full
 * beats a word you started; a word you started beats a word that merely
 * contains what you typed; a word with a typo in it comes last, and only for
 * words long enough that one wrong letter is obviously a slip rather than a
 * different word ("cat" and "car" are not a typo for each other).
 */
export function tokenScore(q, tok) {
  if (!q || !tok) return 0;
  if (tok === q) return 1;
  if (tok.startsWith(q)) return 0.85;
  if (q.length >= 3 && tok.includes(q)) return 0.55;
  if (q.length >= 4 && tok.length >= 4 && withinOneEdit(q, tok)) return 0.5;
  return 0;
}

// Keys and values that are machinery, not language. Searching "openlibrary"
// must not return every book on the shelf, and a cover URL contains the words
// "covers", "images" and sometimes the whole title — indexing it would make
// half the vocabulary match half the shelf.
// Two checks, not one. The substring pattern catches `place_id`, `image_url`,
// `openlibrary_key`; the exact set catches the bare ones — and `key` was
// slipping through a substring-only pattern, so `canonical.key` (the catalogue
// identity every searched item carries) was in the index. Found by a probe:
// the rule was written, and the code did not keep it.
const NOISY_NAME = new Set(["key", "id", "url", "href", "slug", "source", "lat", "lng", "lon", "located"]);
const NOISY_KEY = /(_key|_id|_url|url|href|image|photo|thumb|slug|coord)/i;
const NOISY_VALUE = /^(https?:|\/|geo:|data:)/i;
// Not noise — the opposite. These two hold whole pages of prose, and they are
// indexed as fields of their own at their own low weight (see W). Left in
// here, a twenty-thousand-character article would be "facts" at weight 4 and
// every search would return every article.
const OWN_FIELD = new Set(["article", "ocr_text"]);

/**
 * The searchable words inside `canonical` — the author, the city, the cuisine,
 * the year, the director. This is the half of an item a person remembers when
 * they have forgotten the title, and none of it is in any other field.
 */
export function factsText(canonical, depth = 0) {
  if (!canonical || typeof canonical !== "object" || depth > 3) return "";
  const out = [];
  for (const [k, v] of Object.entries(canonical)) {
    if (NOISY_NAME.has(k.toLowerCase()) || NOISY_KEY.test(k)) continue;
    if (depth === 0 && OWN_FIELD.has(k)) continue;
    if (v == null || typeof v === "boolean") continue;
    if (typeof v === "number") { out.push(String(v)); continue; }
    if (typeof v === "string") {
      if (v.length > 80 || NOISY_VALUE.test(v)) continue;
      out.push(v);
      continue;
    }
    if (Array.isArray(v)) { out.push(factsText({ ...v }, depth + 1)); continue; }
    if (typeof v === "object") out.push(factsText(v, depth + 1));
  }
  return out.filter(Boolean).join(" ");
}

/**
 * The shelf's own name as searchable text.
 *
 * Deliberately narrow: a list only ever matches a word typed IN FULL, so
 * "books" shows every book and "boo" does not. A partial match here would let
 * three letters drown a real title match under forty rows of the same shelf.
 */
const LIST_WORDS = {
  books: ["books", "book", "reading", "read"],
  restaurants: ["restaurants", "restaurant", "eat", "food", "dinner"],
  movies: ["movies", "movie", "film", "films", "watch", "tv"],
  recipes: ["recipes", "recipe", "cook", "cooking"],
  quotes: ["quotes", "quote", "said"],
  places: ["places", "place", "travel", "trip", "visit"],
  unsorted: ["unsorted", "pile", "inbox"],
};

/** What a row prints for a tag match, and what the tag field is searched as. */
const tagsText = (item) => tagsFor(item).map((t) => t.value).join(" · ");

/**
 * The SHORT fields of one item, each with its raw text kept for snippets.
 * The two long ones — article and ocr — are not here: see `bodyText`.
 */
export function fieldsOf(item) {
  return [
    { name: "title", weight: W.title, text: item.title || "" },
    { name: "subtitle", weight: W.subtitle, text: item.subtitle || "" },
    { name: "tags", weight: W.tags, text: tagsText(item) },
    { name: "facts", weight: W.facts, text: factsText(item.canonical) },
    { name: "note", weight: W.note, text: item.note || "" },
    { name: "caption", weight: W.caption, text: (item.caption || "").slice(0, 2000) },
  ];
}

// ── BODY TEXT: an article, and the words read off a screenshot ──────────────
//
// THE CONTRACT with the server: `canonical.article = { byline, siteName, text,
// readingMinutes, excerpt, hero, summary }` and `canonical.ocr_text`, a string.
//
// These are searched DIFFERENTLY from every field above, for two reasons.
//
// 1. No fuzziness. In a title, "ook" finding "book" and one wrong letter being
//    forgiven are kindnesses. Across three thousand words they are a machine
//    for matching everything: "art" is inside "party", "start" and "heart" in
//    any article ever written. A body matches a WHOLE word or the START of
//    one, and nothing else.
// 2. No tokenising per keystroke. The short fields are split into words every
//    time a letter is typed, which is fine for a title and ruinous for a page.
//    A body is folded ONCE and the query is looked for in it as a substring.
//
// ponytail: the folded copy is cached per `canonical` object in a WeakMap, so
// the first keystroke pays to fold each article once and the rest are an
// indexOf over it. Two ceilings. (a) Only the first BODY_MAX characters are
// searched — the tail of a very long read is invisible to Find. (b) The cache
// trusts `canonical` to be REPLACED, not mutated, when an article arrives,
// which is how store.ts writes. If either is felt: build one inverted index
// (word → item ids) when the shelf loads, and drop this.
const BODY = ["ocr", "article"];
const BODY_MAX = 20000;

/** The raw prose of a body field, for a snippet. "" when there is none. */
export function bodyText(item, field) {
  const c = (item && item.canonical) || {};
  const str = (v) => (typeof v === "string" ? v : "");
  if (field === "ocr") return str(c.ocr_text).slice(0, BODY_MAX);
  const a = c.article || {};
  // Who wrote it and what it comes to, THEN the page: the byline is the part
  // somebody remembers, and it must not be the part the cap cuts off. The site
  // name is not here — it is a tag, and is found as one.
  return [a.byline, a.summary, a.text].map(str).filter(Boolean).join("\n").slice(0, BODY_MAX);
}

const FOLDED = new WeakMap();
function foldedBody(item, field) {
  const c = item && item.canonical;
  if (!c || typeof c !== "object") return "";
  let row = FOLDED.get(c);
  if (!row) FOLDED.set(c, (row = {}));
  return row[field] ?? (row[field] = fold(bodyText(item, field)));
}

const wordChar = (code) => (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

/**
 * Where a typed word is in a folded body, and how well: 1 for a whole word,
 * 0.85 for the start of one — the same two numbers `tokenScore` gives them —
 * and 0 for anything that only turns up in the middle of a word.
 */
export function bodyHit(hay, q) {
  let best = { score: 0, at: -1 };
  if (!hay || !q) return best;
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + 1)) {
    if (i > 0 && wordChar(hay.charCodeAt(i - 1))) continue;
    if (!wordChar(hay.charCodeAt(i + q.length))) return { score: 1, at: i };
    if (!best.score) best = { score: 0.85, at: i };
  }
  return best;
}

/**
 * Score one item against already-folded query words. `null` means it does not
 * match at all — rule 1, every word has to land somewhere.
 */
export function scoreItem(item, terms, phrase) {
  if (!terms.length) return null;
  const fields = fieldsOf(item).map((f) => ({ ...f, toks: words(f.text) }));
  const listToks = LIST_WORDS[item.list] || words(item.list);
  const titleInitials = initials(fields[0].toks);

  let total = 0;
  // Which field explained the most about WHY this row is here. The title
  // never needs explaining, so a title match wins this outright.
  let best = { field: null, gain: 0 };

  for (const q of terms) {
    let gain = 0, from = null;
    for (const f of fields) {
      let m = 0;
      for (const tok of f.toks) {
        m = Math.max(m, tokenScore(q, tok));
        if (m === 1) break;
      }
      // "hp", "lotr" — initials only, and only on a title, where they are how
      // people actually abbreviate. Anywhere else they are noise.
      if (f.name === "title" && q.length >= 2 && titleInitials.startsWith(q)) m = Math.max(m, 0.6);
      const v = m * f.weight;
      if (v > gain) { gain = v; from = f.name; }
    }
    // The long fields, and only when they could still win: a word the title
    // already explained never costs a scan of the article.
    for (const name of BODY) {
      if (W[name] <= gain) continue;
      const v = bodyHit(foldedBody(item, name), q).score * W[name];
      if (v > gain) { gain = v; from = name; }
    }
    // The shelf name, whole word only.
    if (listToks.includes(q)) {
      const v = W.list;
      if (v > gain) { gain = v; from = "list"; }
    }
    if (gain === 0) return null;
    total += gain;
    if (from !== "title" && gain > best.gain) best = { field: from, gain };
  }

  // Phrase bonuses. "book bar" typed in that order, against a title that IS
  // "Book Bar", must beat a note somewhere else containing both words.
  const titleFold = fold(item.title || "");
  if (phrase && titleFold) {
    if (titleFold === phrase) total += 12;
    else if (titleFold.startsWith(phrase)) total += 6;
    else if (titleFold.includes(phrase)) total += 4;
  }

  const why = best.field;
  return { item, score: total, why, snippet: why ? snippetOf(item, why, terms) : null };
}

/**
 * The words around the match, so a row that matched on a note can show the
 * bit of note that matched. Rule 3: a row has to be able to explain itself.
 */
const cut = (text, start, end, len) =>
  (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < len ? "…" : "");

export function snippetOf(item, field, terms, width = 84) {
  const body = BODY.includes(field);
  const text =
    field === "note" ? item.note || ""
    : field === "caption" ? item.caption || ""
    : field === "subtitle" ? item.subtitle || ""
    : field === "facts" ? factsText(item.canonical)
    : field === "tags" ? tagsText(item)
    : body ? bodyText(item, field)
    : "";
  if (!text) return null;
  const hay = body ? foldedBody(item, field) : fold(text);
  let at = -1;
  for (const q of terms) {
    // A body only ever matched at the start of a word, so that is where its
    // snippet has to open — the first "art" in an article is inside "party".
    const i = body ? bodyHit(hay, q).at : hay.indexOf(q);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return cut(text, 0, Math.min(width, text.length), text.length);
  // Back off a third of the width for context, then SNAP TO A WORD. Cutting
  // mid-word produced "….6 Michael B. Jordan" out of a cast list, which reads
  // as damaged data rather than as an excerpt — a snippet is supposed to
  // explain the row, not raise a second question.
  let start = Math.max(0, at - Math.floor(width / 3));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    // Never skip past the match itself chasing a space.
    start = space >= 0 && space < at ? space + 1 : start;
  }
  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at) end = space;
  }
  return cut(text, start, end, text.length);
}

const freshness = (it) => Date.parse(it.resolved_at || it.created_at || "") || 0;

/**
 * Everything on every shelf that matches, best first.
 *
 * `counts` is computed BEFORE the list filter so the shelf chips can say how
 * many are hiding behind each one — a filter that cannot tell you what it is
 * hiding is a filter you have to try one at a time.
 */
export function searchShelf(items, q, { limit = 60, list = null } = {}) {
  const phrase = fold(q).trim();
  const terms = words(q);
  if (!terms.length) return { hits: [], counts: {}, total: 0, terms: [] };

  const scored = [];
  for (const item of items || []) {
    const hit = scoreItem(item, terms, phrase);
    if (hit) scored.push(hit);
  }

  const counts = {};
  for (const h of scored) counts[h.item.list] = (counts[h.item.list] || 0) + 1;

  const kept = list ? scored.filter((h) => h.item.list === list) : scored;
  kept.sort((a, b) => b.score - a.score || freshness(b.item) - freshness(a.item));
  return { hits: kept.slice(0, limit), counts, total: kept.length, terms };
}

/**
 * Is this catalogue result already on a shelf?
 *
 * Two ways, because items arrive by two roads. Something added from search
 * carries the catalogue key in `canonical.key` and matches exactly. Something
 * that came off a reel has no catalogue key at all, so the fallback is the
 * folded title on the same shelf — which is why "Piranesi" shared from
 * Instagram is not offered back to you as a new book.
 */
export function alreadyShelved(items, hit) {
  const key = hit && hit.key;
  const title = fold(hit && hit.title);
  return (items || []).some((it) => {
    if (key && it.canonical && it.canonical.key === key) return true;
    return !!title && it.list === hit.list && fold(it.title) === title;
  });
}
