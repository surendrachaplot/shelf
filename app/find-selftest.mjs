// find-selftest.mjs — ranking, asserted.
//
// A SEPARATE FILE, same reason as facts-selftest.mjs: `src/find.js` has no
// imports so the app, this test and (one day) the published page can all read
// it, and an inline `--selftest` block would mean touching `process` from a
// file the phone loads.
//
// What this is really for: ORDER IS INVISIBLE. A wrong colour shows up in a
// screenshot and a wrong touch target shows up in the design gate, but "the
// right book is fourth" looks exactly like "the right book is first" in every
// check this project has. So every ranking claim the module makes is written
// down here as a fixture with an expected winner.
import {
  fold, words, withinOneEdit, tokenScore, factsText, scoreItem, searchShelf,
  snippetOf, alreadyShelved, initials,
} from "./src/find.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

const item = (o) => ({
  id: o.id || Math.random().toString(36).slice(2),
  list: o.list || "books", status: "filed", title: o.title ?? null,
  subtitle: o.subtitle || "", note: o.note || "", image_url: null,
  canonical: o.canonical || {}, confidence: 1, enriched: true,
  source_url: o.source_url || null, resolver: "test",
  caption: o.caption || "", created_at: o.created_at || "2026-01-01T00:00:00.000Z",
});

// ── folding ─────────────────────────────────────────────────────────────────
// A restaurant is filed under the name on its awning, accents and all, and
// nobody types the accents.
ok(fold("Café de Flore") === "cafe de flore", "accents fold away", fold("Café de Flore"));
ok(fold("MØRK Ø") === "mork o" || fold("MØRK Ø") === "mørk ø", "stroke letters", fold("MØRK Ø"));
// THE TABLE PATH, not just the normalize path. Hermes availability is not a
// thing to assume, so the fallback has to be exercised, not carried.
ok(fold("Café de Flore", false) === "cafe de flore", "the no-normalize fallback folds too", fold("Café de Flore", false));
ok(fold("Ganapati’s", false) === "ganapati’s", "the fallback leaves anything it does not know alone");
ok(fold(null) === "" && fold(undefined) === "", "null folds to nothing, no crash");
ok(words("St. John's — 26 St John St").join("|") === "st|john|s|26|st|john|st", "punctuation splits", words("St. John's — 26 St John St"));
ok(initials(["harry", "potter"]) === "hp", "initials");

// ── one edit ────────────────────────────────────────────────────────────────
ok(withinOneEdit("piranesi", "piranesi"), "same word");
ok(withinOneEdit("pirenesi", "piranesi"), "one substitution");
ok(withinOneEdit("piranes", "piranesi"), "one deletion");
ok(withinOneEdit("piiranesi", "piranesi"), "one insertion");
ok(withinOneEdit("teh", "the"), "a transposition is one keystroke, not two");
ok(!withinOneEdit("pxranesx", "piranesi"), "two edits is a different word");
ok(!withinOneEdit("cat", "dog"), "unrelated");

// ── token scores are the ranking ────────────────────────────────────────────
ok(tokenScore("book", "book") === 1, "exact");
ok(tokenScore("boo", "book") === 0.85, "prefix");
ok(tokenScore("ook", "book") === 0.55, "mid-word, and only for 3+ letters");
ok(tokenScore("oo", "book") === 0, "two letters mid-word is noise, not a match");
ok(tokenScore("piranese", "piranesi") === 0.5, "a typo in a long word still lands");
ok(tokenScore("cat", "car") === 0, "one edit in a SHORT word is a different word");
ok(tokenScore("", "book") === 0 && tokenScore("book", "") === 0, "empty");
ok(tokenScore("book", "book") > tokenScore("boo", "book"), "exact must outrank prefix — this IS the ordering");
ok(tokenScore("boo", "book") > tokenScore("ook", "book"), "prefix must outrank mid-word");
ok(tokenScore("ook", "book") > tokenScore("piranese", "piranesi"), "mid-word must outrank a typo");

// ── canonical: the half of an item people remember ──────────────────────────
const bookFacts = factsText({
  author: "Susanna Clarke", year: 2020, openlibrary_key: "/works/OL1W",
  image_url: "https://covers.openlibrary.org/b/id/42-L.jpg",
  // `key` is the one that hides from a naive check: it is not a URL and does
  // not start with a slash, so ONLY the key-name filter drops it. Dropping the
  // filter used to leave this test green — the fixture was staging the wrong
  // scenario, which is the trap HANDOVER.md names.
  key: "books:/works/OL1W", place_id: "ChIJabc123",
});
ok(bookFacts.includes("Susanna Clarke"), "the author is searchable", bookFacts);
ok(bookFacts.includes("2020"), "so is the year", bookFacts);
ok(!/OL1W|ChIJabc|covers|http/i.test(bookFacts),
   "catalogue machinery must NOT be indexed — an id that matches every book is a search box that always says yes", bookFacts);
ok(factsText({ cuisine: ["indian", "south indian"] }).includes("indian"), "arrays flatten");
ok(factsText({ a: { b: { c: { d: { e: "deep" } } } } }) === "", "recursion is bounded");
ok(factsText(null) === "" && factsText("x") === "", "no crash on rubbish");

// ── the shelf ───────────────────────────────────────────────────────────────
const piranesi = item({
  id: "p", list: "books", title: "Piranesi",
  canonical: { author: "Susanna Clarke", year: 2020, key: "books:/works/OL1W" },
  subtitle: "Susanna Clarke · 2020", created_at: "2026-02-01T00:00:00.000Z",
});
const ganapati = item({
  id: "g", list: "restaurants", title: "Ganapati",
  subtitle: "South Indian · Peckham",
  canonical: { city: "London", area: "Peckham", cuisine: ["south indian"] },
  note: "Go early on a Saturday, the dosa sells out by two.",
});
const bookBar = item({ id: "bb", list: "places", title: "Book Bar", subtitle: "Bounds Green" });
const sinners = item({ id: "s", list: "movies", title: "Sinners", subtitle: "2025", canonical: { year: 2025 } });
const harry = item({ id: "h", list: "books", title: "Harry Potter and the Goblet of Fire" });
const cafe = item({ id: "c", list: "restaurants", title: "Café de Flore", canonical: { city: "Paris" } });
const nameless = item({ id: "n", list: "unsorted", title: null, note: "the one with the yellow cover" });
const quote = item({
  id: "q", list: "quotes", title: "“Attention is the beginning of devotion.”",
  caption: "mary oliver, upstream", subtitle: "Mary Oliver",
});
const SHELF = [piranesi, ganapati, bookBar, sinners, harry, cafe, nameless, quote];

const find = (q, opts) => searchShelf(SHELF, q, opts);
const ids = (q, opts) => find(q, opts).hits.map((h) => h.item.id);

ok(ids("piranesi")[0] === "p", "the obvious one", ids("piranesi"));
ok(ids("piranese")[0] === "p", "one letter wrong still finds it", ids("piranese"));
ok(ids("PIRANESI")[0] === "p", "case does not matter");
ok(ids("cafe")[0] === "c", "no accents typed, accented title found", ids("cafe"));
ok(ids("clarke")[0] === "p", "found by author, which is only in canonical", ids("clarke"));
ok(ids("peckham")[0] === "g", "found by neighbourhood", ids("peckham"));
ok(ids("dosa")[0] === "g", "found by something YOU typed in the note", ids("dosa"));
ok(ids("2020")[0] === "p", "found by year", ids("2020"));
ok(ids("hp")[0] === "h", "initials, on a title", ids("hp"));
ok(ids("oliver").includes("q"), "a quote is findable by who said it", ids("oliver"));

// RULE 1: every word narrows.
ok(ids("clarke piranesi").join() === "p", "two words are an AND, not an OR", ids("clarke piranesi"));
ok(find("clarke sinners").hits.length === 0, "no item has both, so nothing matches", ids("clarke sinners"));

// RULE 3, and the ordering claim that matters most: a title beats a mention.
const noted = item({ id: "x", list: "movies", title: "Anatomy of a Fall", note: "reminded me of Piranesi" });
const ordered = searchShelf([noted, piranesi], "piranesi").hits;
ok(ordered[0].item.id === "p", "the BOOK called Piranesi outranks the film whose note mentions it", ordered.map((h) => h.item.id));
ok(ordered[0].why === null, "a title match needs no explanation");
ok(ordered[1].why === "note" && /Piranesi/.test(ordered[1].snippet || ""),
   "a note match says so, and shows the words", ordered[1].snippet);

const gan = find("dosa").hits[0];
ok(gan.why === "note" && gan.snippet.includes("dosa"), "the snippet holds what matched", gan.snippet);
ok(snippetOf(ganapati, "note", ["saturday"], 30).length <= 34, "snippets are cut to width", snippetOf(ganapati, "note", ["saturday"], 30));
ok(snippetOf(piranesi, "note", ["x"]) === null, "no text, no snippet");

// A snippet must never start or end mid-word. Cutting a cast list at a fixed
// offset produced "….6 Michael B. Jordan" on the Sinners row, which reads as
// broken data rather than as an excerpt — visible in the screenshot, invisible
// to every other check.
const longNote = item({
  id: "ln", list: "movies", title: "Sinners",
  note: "Ryan Coogler 2025 137 minutes with Michael B. Jordan Hailee Steinfeld Delroy Lindo",
});
const sn = snippetOf(longNote, "note", ["steinfeld"], 60);
const body = sn.replace(/^…/, "").replace(/…$/, "");
const at = longNote.note.indexOf(body);
ok(at >= 0, "a snippet is verbatim from the text it came from", sn);
ok(at === 0 || longNote.note[at - 1] === " ", "a snippet begins at a word boundary, never mid-word", sn);
const endAt = at + body.length;
ok(endAt === longNote.note.length || longNote.note[endAt] === " ", "…and ends at one", sn);
ok(sn.includes("Steinfeld"), "the matched word is in the snippet, not cut off by the context window", sn);
const front = snippetOf(longNote, "note", ["ryan"], 40);
ok(!front.startsWith("…"), "a match at the very start needs no leading ellipsis", front);

// The phrase bonus: exact title, in order, wins.
// The decoy goes FIRST in the array on purpose: both titles hold both words,
// so without the phrase bonus this is a tie, and a tie keeps whatever order it
// was given. With the decoy first, a silent pass is impossible.
const phrased = searchShelf([item({ id: "z", list: "books", title: "The Bar Book" }), bookBar], "book bar").hits;
ok(phrased[0].item.id === "bb", "'book bar' is Book Bar, not The Bar Book", phrased.map((h) => h.item.id));

// Shelf names, whole word only — the rule that stops three letters returning
// forty rows of one shelf.
const booksQuery = ids("books");
ok(booksQuery[0] === "p" || booksQuery[0] === "h", "'books' puts the books first", booksQuery);
ok(booksQuery.slice(0, 2).sort().join() === "h,p", "…both of them, before anything else", booksQuery);
// "Book Bar" is one letter from "books", so it still appears — that is the
// typo tolerance doing its job. It must appear BELOW the books, which is the
// whole reason a whole-word shelf match is worth more than a typo match.
ok(booksQuery.indexOf("bb") > 1, "a near-miss title ranks under the shelf it nearly named", booksQuery);
ok(!ids("boo").includes("h"), "'boo' must NOT drag in every book — a partial shelf name is not a filter", ids("boo"));
ok(ids("film")[0] === "s", "the words people use, not just the label", ids("film"));

// Filters and counts.
const all = find("book");
ok((all.counts.places || 0) >= 1, "counts are computed before the filter, so a chip can say how many it hides", all.counts);
const onlyPlaces = find("book", { list: "places" });
ok(onlyPlaces.hits.every((h) => h.item.list === "places"), "the filter filters");
ok(onlyPlaces.counts.books === all.counts.books, "…and does not change the counts, which is the whole point");

// Rubbish in.
ok(find("").hits.length === 0 && find("   ").hits.length === 0, "an empty query matches nothing, not everything");
ok(find("zzzzqqq").hits.length === 0, "no match is no match");
ok(searchShelf(null, "book").hits.length === 0, "no shelf, no crash");
ok(find("yellow")[0] !== undefined || true, "an item with a null title does not crash the scorer");
ok(ids("yellow").join() === "n", "…and is still findable by its note", ids("yellow"));
ok(find("a", { limit: 3 }).hits.length <= 3, "limit is honoured");

// Freshness only ever breaks a tie.
const older = item({ id: "o", list: "books", title: "Twin", created_at: "2020-01-01T00:00:00.000Z" });
const newer = item({ id: "w", list: "books", title: "Twin", created_at: "2026-08-01T00:00:00.000Z" });
ok(searchShelf([older, newer], "twin").hits[0].item.id === "w", "same score, newer first");

// ── dedupe against the catalogue ────────────────────────────────────────────
ok(alreadyShelved(SHELF, { list: "books", key: "books:/works/OL1W", title: "Piranesi" }),
   "a catalogue key that is already on a shelf is not offered again");
ok(alreadyShelved(SHELF, { list: "restaurants", key: "restaurants:node/999", title: "ganapati" }),
   "no shared key, same name, same shelf — still already yours (this is the reel-shared case)");
ok(!alreadyShelved(SHELF, { list: "books", key: "books:x", title: "Ganapati" }),
   "same name on a DIFFERENT shelf is a different thing");
ok(!alreadyShelved(SHELF, { list: "movies", key: "movies:7", title: "Sinners 2" }), "a near name is not a match");
ok(!alreadyShelved([], { list: "books", key: "k", title: "x" }) && !alreadyShelved(null, { list: "books", title: "x" }),
   "empty shelf, no crash");

// ── it has to be fast enough to run on every keystroke ──────────────────────
// No debounce is the design: a local search that lags is a search box people
// stop trusting. 800 items is far past what this app holds.
const many = Array.from({ length: 800 }, (_, i) => item({
  id: `m${i}`, title: `Item number ${i}`, note: "a note with some words in it",
  canonical: { author: "Someone Or Other", year: 2000 + (i % 25) },
}));
const t0 = Date.now();
for (const term of ["it", "item num", "someone", "2015", "zzz"]) searchShelf(many, term);
const ms = Date.now() - t0;
ok(ms < 400, `five searches over 800 items took ${ms}ms — too slow to run per keystroke`, ms);

console.log(fail ? `find selftest FAILED (${fail})` : "find selftest ok");
process.exit(fail ? 1 : 0);
