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
  snippetOf, alreadyShelved, initials, bodyText, bodyHit, W,
} from "./src/find.js";
import { LIST_KEYS } from "./src/design.js";

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

// AN ARTICLE AND A SCREENSHOT'S WORDS ARE NOT FACTS. They are indexed as their
// own fields at their own low weight; left in here they are "facts" at weight
// 4 and every search returns every article.
//
// Every string below is SHORT on purpose. `factsText` already drops anything
// over 80 characters, so a fixture with a realistic long body would stay green
// with the exclusion deleted — the long-value rule would be doing its job for
// it. That is the fixture-staging-the-wrong-scenario trap again.
const withBody = factsText({
  author: "Meera Sodha",
  article: { byline: "Jay Rayner", siteName: "Observer", text: "tamarind and jaggery", readingMinutes: 4,
             excerpt: "tamarind", hero: "https://cdn/h.jpg", summary: "sour then sweet" },
  ocr_text: "menu del dia",
});
ok(withBody === "Meera Sodha", "article and ocr_text are NOT walked as facts — only the real fact is left", withBody);
ok(factsText({ a: { article: "kept", ocr_text: "kept too" } }) === "kept kept too",
   "…and only at the top, where the contract puts them — a nested key with the same name is an ordinary fact",
   factsText({ a: { article: "kept", ocr_text: "kept too" } }));

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
// The recipe carries the page it came from: `canonical.article`, the server's
// contract. The byline is deliberately NOT the recipe's author, so a search
// for it can only be answered by the article.
const dal = item({
  id: "d", list: "recipes", title: "Lemon dal", subtitle: "45 min · 4 servings",
  canonical: {
    author: "Meera Sodha", cuisine: "Indian", total_time: "45 min", recipe_url: "https://food.example/dal",
    article: {
      byline: "Words by Jay Rayner", siteName: "The Guardian", readingMinutes: 4, hero: "https://cdn/d.jpg",
      excerpt: "Rinse the pulses", summary: "Sour first, then sweet: a weeknight supper.",
      text: "Rinse the pulses until the water runs clear. Simmer with turmeric for half an hour, "
          + "then stir through tamarind and a spoon of jaggery. The party trick is to start the tempering late. "
          + "Mustard seeds, curry leaves and dried chilli go in at the very end.",
    },
  },
});
// A screenshot of a menu: nothing but the words the phone read off it.
const menu = item({
  id: "o", list: "unsorted", title: "Screenshot", created_at: "2026-03-01T00:00:00.000Z",
  canonical: { ocr_text: "MENÚ DEL DÍA\nCroquetas de jamón 9€\nPulpo a la gallega 14€" },
});
const SHELF = [piranesi, ganapati, bookBar, sinners, harry, cafe, nameless, quote, dal, menu];

// ALL SIX SHELVES, derived. "A fixture that stops at four shelves cannot show
// you the fifth" — this file had no recipe in it until it was counted.
for (const list of LIST_KEYS) {
  ok(SHELF.some((x) => x.list === list), `${list}: there is a fixture for this shelf`);
}

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

// ── TAGS ────────────────────────────────────────────────────────────────────
// A tag is searchable as itself. "2020s" and the site name are in NO other
// field — the decade is derived and `article` is kept out of the facts — so
// these two can only be answered by the tag field.
const decade = find("2020s").hits;
ok(decade[0]?.item.id === "p" && decade[0].why === "tags", "found by a tag that exists nowhere else on the item", decade.map((h) => [h.item.id, h.why]));
ok(decade[0]?.snippet === "Susanna Clarke · 2020 · 2020s", "…and the row prints the tags, as tags", decade[0]?.snippet);
const site = find("guardian").hits;
ok(site.length === 1 && site[0].item.id === "d" && site[0].why === "tags" && /The Guardian/.test(site[0].snippet || ""),
   "the site an article came from is a tag, and is found as one", site.map((h) => [h.item.id, h.why, h.snippet]));
// A tag is STRONG: the author on the tag outranks the same word in an address.
// Decoy first and fresher, so a tie could not pass.
const street = item({ id: "st", list: "restaurants", title: "Corner Cafe", created_at: "2026-09-01T00:00:00.000Z",
                      canonical: { address: "4 Clarke Street" } });
ok(searchShelf([street, piranesi], "clarke").hits.map((h) => h.item.id).join() === "p,st",
   "a tag match outranks the same word turning up in a fact nobody filters by", searchShelf([street, piranesi], "clarke").hits.map((h) => [h.item.id, h.score]));
ok(W.tags > W.facts && W.tags < 0.5 * W.title, "tags sit above facts and under the weakest title match", W);

// ── ARTICLE TEXT ────────────────────────────────────────────────────────────
const tam = find("tamarind").hits;
ok(tam.length === 1 && tam[0].item.id === "d" && tam[0].why === "article", "found by a word that is only in the article", tam.map((h) => [h.item.id, h.why]));
ok(/tamarind/.test(tam[0]?.snippet || ""), "the row shows the words around it", tam[0]?.snippet);
{
  const raw = bodyText(dal, "article");
  const body = (tam[0]?.snippet || "").replace(/^…/, "").replace(/…$/, "");
  const at = raw.indexOf(body);
  ok(body.length > 0 && at >= 0, "an article snippet is verbatim from the article", tam[0]?.snippet);
  // At every width, not one: a single width can land on a space by luck, and
  // did, the first time this was probed.
  for (let width = 40; width <= 90; width += 5) {
    const sn = snippetOf(dal, "article", ["tamarind"], width);
    const from = raw.indexOf(sn.replace(/^…/, "").replace(/…$/, ""));
    ok(from > 0 && /\s/.test(raw[from - 1]) && /tamarind/.test(sn), `an article snippet begins at a word boundary (width ${width})`, sn);
  }
}
ok(find("rayner").hits[0]?.why === "article" && /Jay Rayner/.test(find("rayner").hits[0]?.snippet || ""),
   "the byline is searchable — who wrote it is what people remember", find("rayner").hits.map((h) => [h.item.id, h.why, h.snippet]));
ok(ids("weeknight").join() === "d", "so is the summary", ids("weeknight"));
ok(ids("tamarind jaggery").join() === "d" && find("tamarind sinners").hits.length === 0, "rule 1 still holds across a body: every word narrows");

// NO FUZZINESS IN A BODY. "art" is inside "party" and "start"; in three
// thousand words it is inside something. A body matches a whole word or the
// start of one.
ok(bodyHit("the art of it", "art").score === 1 && bodyHit("the art of it", "art").at === 4, "a whole word", bodyHit("the art of it", "art"));
ok(bodyHit("an article", "art").score === 0.85, "the start of a word");
ok(bodyHit("the party will start", "art").score === 0, "the MIDDLE of a word is not a match in a body", bodyHit("the party will start", "art"));
ok(bodyHit("party art", "art").at === 6, "…and it does not stop at the first mid-word occurrence", bodyHit("party art", "art"));
ok(bodyHit("an article about art", "art").score === 1, "a whole word later beats a prefix sooner", bodyHit("an article about art", "art"));
ok(bodyHit("an article about artists", "art").at === 3, "of two word-starts, the FIRST is where the snippet opens", bodyHit("an article about artists", "art"));
ok(bodyHit("", "art").score === 0 && bodyHit("art", "").score === 0, "empty");
ok(find("amarind").hits.length === 0, "a mid-word fragment does not find an article — it would find all of them", ids("amarind"));
ok(find("tamarinf").hits.length === 0, "nor does a typo: one wrong letter against 3,000 words matches something every time", ids("tamarinf"));
// "art" is in "party" and "start" before any real word. The snippet has to
// open where the MATCH was, or the row explains itself with the wrong words.
const artful = item({ id: "af", list: "recipes", title: "Notes",
  canonical: { article: { text: "The party had to start somewhere, and after an hour of everyone standing about it finally did. Much later, art happened." } } });
ok(/\bart happened/.test(snippetOf(artful, "article", ["art"], 30) || ""), "a body snippet opens on the word that matched, not on a mid-word look-alike", snippetOf(artful, "article", ["art"], 30));

// ── OCR TEXT ────────────────────────────────────────────────────────────────
const croq = find("croquetas").hits;
ok(croq.length === 1 && croq[0].item.id === "o" && croq[0].why === "ocr" && /Croquetas de jamón/.test(croq[0].snippet || ""),
   "a screenshot is found by the words in it, and says so", croq.map((h) => [h.item.id, h.why, h.snippet]));
ok(ids("jamon").join() === "o" && ids("menu").join() === "o", "accents fold in a body too", [ids("jamon"), ids("menu")]);
ok(snippetOf(piranesi, "ocr", ["x"]) === null && snippetOf(piranesi, "article", ["x"]) === null && bodyText(piranesi, "article") === "",
   "no article, no screenshot → no text, no snippet, no crash");
// "note" is not in the title, so the search has to go all the way to the
// bodies to find out — which is where a missing canonical would throw.
ok(searchShelf([{ id: "nc", list: "books", title: "Bare", note: "a note" }], "note").hits.length === 1
   && searchShelf([{ id: "nc", list: "books", title: "Bare" }], "zzz").hits.length === 0,
   "an item with no canonical at all is still searched, not a crash");
ok(bodyText({ canonical: { article: "not an object", ocr_text: 7 } }, "article") === "" && bodyText({ canonical: { ocr_text: 7 } }, "ocr") === "" && bodyText({}, "ocr") === "",
   "a body that is the wrong type is no body");

// ── THE ORDERING CLAIMS FOR A BODY ──────────────────────────────────────────
// A title must ALWAYS outrank body text — even the weakest title match, one
// letter wrong, against an exact word in both an article and a screenshot.
// The body item goes first and is fresher, so a tie cannot pass.
const mentions = item({ id: "bo", list: "recipes", title: "Reading list", created_at: "2026-09-01T00:00:00.000Z",
  canonical: { ocr_text: "piranese", article: { text: "piranese piranese piranese" } } });
const typo = searchShelf([mentions, piranesi], "piranese").hits;
ok(typo.map((h) => h.item.id).join() === "p,bo", "a typo'd TITLE outranks an exact word in an article and a screenshot", typo.map((h) => [h.item.id, h.score]));
ok(W.article < 0.5 * W.title && W.ocr < 0.5 * W.title, "which is a claim about the weights: every body is under the weakest title score", W);
// note > ocr > article > caption, each pair on its own, decoy first.
const inNote = item({ id: "n1", list: "books", title: "A", note: "saffron" });
const inOcr = item({ id: "o1", list: "books", title: "B", canonical: { ocr_text: "saffron" } });
const inArticle = item({ id: "a1", list: "books", title: "C", canonical: { article: { text: "saffron" } } });
const inCaption = item({ id: "c1", list: "books", title: "D", caption: "saffron" });
ok(searchShelf([inCaption, inArticle, inOcr, inNote], "saffron").hits.map((h) => h.item.id).join() === "n1,o1,a1,c1",
   "your note, then the screenshot's words, then the article, then the caption",
   searchShelf([inCaption, inArticle, inOcr, inNote], "saffron").hits.map((h) => [h.item.id, h.score]));

// A LONG ARTICLE MUST NOT DROWN A SEARCH. Twenty thousand characters that
// mention the author once: found, and below the book that is BY her.
const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";
const longRead = item({ id: "lr", list: "recipes", title: "A long read", created_at: "2026-09-01T00:00:00.000Z",
  canonical: { article: { text: filler.repeat(130) + " an aside about susanna clarke " + filler.repeat(120) } } });
const drowned = searchShelf([longRead, piranesi], "clarke").hits;
ok(drowned.map((h) => h.item.id).join() === "p,lr" && drowned[1].why === "article",
   "the book by Clarke outranks the 20,000-character article that mentions her", drowned.map((h) => [h.item.id, h.why, h.score]));
ok(drowned[1].snippet.length < 100 && /susanna clarke/.test(drowned[1].snippet), "and its snippet is the few words around the mention, not the article", drowned[1].snippet);

// THE CEILING, written down as a fact rather than discovered: only the first
// 20,000 characters of a body are searched.
const tooLong = item({ id: "tl", list: "recipes", title: "Very long",
  canonical: { article: { text: filler.repeat(250) + " earlyword " + filler.repeat(20) + " lateword" } } });
ok(bodyText(tooLong, "article").length === 20000, "a body is capped", bodyText(tooLong, "article").length);
ok(bodyText({ canonical: { ocr_text: "x".repeat(30000) } }, "ocr").length === 20000, "…a screenshot's words too", bodyText({ canonical: { ocr_text: "x".repeat(30000) } }, "ocr").length);
ok(searchShelf([tooLong], "earlyword").hits.length === 1 && searchShelf([tooLong], "lateword").hits.length === 0,
   "inside the cap is found; past it is not — the known ceiling of the simple route");

// THE CACHE IS KEYED ON `canonical`. An article that arrives later comes in a
// NEW canonical object (that is how store.ts writes), and must be searchable
// at once — and the text it replaced must stop matching.
const before = item({ id: "same", list: "places", title: "Somewhere", canonical: { ocr_text: "oldword" } });
ok(searchShelf([before], "oldword").hits.length === 1, "found (and now cached)");
const after = { ...before, canonical: { ...before.canonical, ocr_text: "newword" } };
ok(searchShelf([after], "newword").hits.length === 1 && searchShelf([after], "oldword").hits.length === 0,
   "the same item with a replaced canonical is searched on its NEW text, not a stale copy");

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

// And with something to READ on the shelf: 300 articles of 20,000 characters.
// NOT TIMED, deliberately. A stopwatch here was tried and could not be made to
// fail: this machine splits six megabytes into words inside the budget, so the
// assertion would have gone green with the whole design removed. A phone is
// not this machine. What is asserted instead is the thing that makes it fast.
const reads = Array.from({ length: 300 }, (_, i) => item({
  id: `r${i}`, list: "recipes", title: `Read ${i}`,
  canonical: { article: { text: filler.repeat(259) + ` needle${i}` } },
}));
ok(searchShelf(reads, "needle7").hits.length === 11, "the words at the very END of each one are really being searched", searchShelf(reads, "needle7").hits.length);

// The fold-once claim, COUNTED. A getter counts how many times the article is
// actually read: once, however many letters are typed after it.
let read = 0;
const counted = item({ id: "ct", list: "recipes", title: "Counted",
  canonical: { article: { get text() { read++; return "some words nobody will search for"; } } } });
for (const term of ["z", "zz", "zzz", "zzzz", "zzzzz"]) searchShelf([counted], term);
ok(read === 1, `five keystrokes read the article ${read} times — it must be folded once and kept`, read);

console.log(fail ? `find selftest FAILED (${fail})` : "find selftest ok");
process.exit(fail ? 1 : 0);
