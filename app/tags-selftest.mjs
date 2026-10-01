// tags-selftest.mjs — a tag is a fact, asserted.
//
// A SEPARATE FILE, same reason as facts-selftest.mjs: `src/tags.js` has no
// imports so the app, this test and api/page.js can all read it, and an inline
// `--selftest` block would mean touching `process` from a file the phone loads.
//
// THE FIXTURES ARE THE SERVER'S SHAPES, not tidy ones. Every `canonical` below
// is what api/enrich/index.js really returns for that shelf — a book's year is
// a number and a film's is a string, a restaurant's cuisine is an array and a
// recipe's is a string, and a quote has no canonical at all. A fixture that
// gave all six the same neat fields would be testing a server that does not
// exist.
import { tagsFor, tagIndex, itemsWithTag, tagKey } from "./src/tags.js";
import { LIST_KEYS } from "./src/design.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

const item = (o) => ({
  id: o.id, list: o.list, status: o.status || "filed", title: o.title ?? null,
  subtitle: o.subtitle || "", note: "", image_url: null,
  canonical: o.canonical || {}, confidence: 1, enriched: true,
  source_url: null, resolver: "test", created_at: "2026-01-01T00:00:00.000Z",
});
const keys = (it) => tagsFor(it).map((t) => t.key);

// pickBook
const piranesi = item({
  id: "p", list: "books", title: "Piranesi", subtitle: "Susanna Clarke",
  canonical: { openlibrary_key: "/works/OL1W", isbn: "9781635575637", year: 2020, author: "Susanna Clarke",
               pages: 245, subjects: ["Fantasy", "Labyrinths"], rating: 4.3,
               first_sentence: "When the moon rose in the Third Northern Hall I went to the Ninth Vestibule.",
               read_url: "https://openlibrary.org/works/OL1W" },
});
// pickMovieDetail
const sinners = item({
  id: "s", list: "movies", title: "Sinners", subtitle: "Ryan Coogler · 2025",
  canonical: { tmdb_id: 7, media_type: "movie", year: "2025", director: "Ryan Coogler", runtime_min: 137,
               genres: ["Horror", "Thriller"], rating: 7.6, overview: "A story.",
               cast: ["Michael B. Jordan", "Hailee Steinfeld"], trailer_url: "https://www.youtube.com/watch?v=x",
               streaming: ["Mubi"], watch_url: "https://tmdb/watch", region: "GB" },
});
// pickOsmPlace, as enrichRestaurant returns it: an area, and NO city.
const ganapati = item({
  id: "g", list: "restaurants", title: "Ganapati", subtitle: "South indian · Peckham",
  canonical: { osm_type: "node", osm_id: 42, address: "Ganapati, 38 Holly Grove, Peckham, London, SE15 5DF",
               area: "Peckham", lat: 51.47, lng: -0.07, website: "https://ganapati.example", phone: "+44 20",
               opening_hours: "Tu-Su 12:00-22:30", cuisine: ["South indian", "Indian"],
               map_url: "geo:51.47,-0.07?q=Ganapati", osm_url: "https://www.openstreetmap.org/node/42",
               source: "openstreetmap" },
});
// enrichPlace, located.
const bookBar = item({
  id: "bb", list: "places", title: "Book Bar", subtitle: "Bounds Green · London",
  canonical: { osm_type: "node", osm_id: 9, address: "Book Bar, Bounds Green, London", area: "Bounds Green",
               lat: 51.6, lng: -0.12, cuisine: [], city: "London", located: true, source: "openstreetmap" },
});
// pickRecipe — cuisine is a STRING here — plus the article the page was read into.
const dal = item({
  id: "d", list: "recipes", title: "Lemon dal", subtitle: "45 min · 4 servings",
  canonical: { recipe_url: "https://food.example/dal", ingredients: ["1 cup toor dal"], total_time: "45 min",
               serves: "4 servings", steps: 3, author: "Meera Sodha", rating: 4.6, calories: "320 kcal",
               cuisine: "Indian",
               article: { byline: "Meera Sodha", siteName: "The Guardian", text: "Rinse the dal until the water runs clear.",
                          readingMinutes: 4, excerpt: "Rinse the dal", hero: "https://cdn/d.jpg", summary: "A weeknight dal." } },
});
// A quote: `enrich()` returns `canonical: {}` and the reading step puts whoever
// said it in the subtitle. This is the real shape, and the reason for the one
// special case in tags.js.
const quote = item({
  id: "q", list: "quotes", title: "Attention is the beginning of devotion.", subtitle: "Mary Oliver",
});
const SHELF = [piranesi, sinners, ganapati, bookBar, dal, quote];

// ── ALL SIX SHELVES, derived — "a fixture that stops at four shelves cannot
// show you the fifth". Add a shelf to LIST_KEYS and this fails until it has a
// fixture here.
for (const list of LIST_KEYS.filter((k) => k !== "unsorted")) {
  const it = SHELF.find((x) => x.list === list);
  ok(!!it, `${list}: there is a fixture for this shelf`);
  ok(it && tagsFor(it).length > 0, `${list}: a filed item with real facts has tags`, it && tagsFor(it));
}

// ── the key ─────────────────────────────────────────────────────────────────
ok(tagKey("author", "Susanna Clarke") === "author:susanna clarke", "a key is kind:folded value", tagKey("author", "Susanna Clarke"));
ok(tagKey("author", "susanna  CLARKE.") === tagKey("author", "Susanna Clarke"), "case, spacing and a full stop are not a different author");
ok(tagKey("city", "São Paulo") === "city:sao paulo", "accents fold", tagKey("city", "São Paulo"));
ok(tagKey("author", "村上春樹") === "author:村上春樹", "a name in another script survives as itself — it must not fold to nothing", tagKey("author", "村上春樹"));
ok(tagKey("author", " . ") === "" && tagKey("author", null) === "", "nothing to name → no key, never 'author:'");

// ── each shelf, by the fields the server really sends ───────────────────────
ok(keys(piranesi).join("|") === "author:susanna clarke|genre:fantasy|genre:labyrinths|year:2020|decade:2020s",
   "a book: who wrote it first, when last — and a NUMBER year still makes a year and a decade", keys(piranesi));
ok(keys(sinners).join("|") === "director:ryan coogler|genre:horror|genre:thriller|cast:michael b jordan|cast:hailee steinfeld|year:2025|decade:2020s",
   "a film: director, genres, cast, and a STRING year", keys(sinners));
ok(keys(ganapati).join("|") === "area:peckham|cuisine:south indian|cuisine:indian",
   "a restaurant: where, then what it serves — every cuisine in the array", keys(ganapati));
ok(keys(bookBar).join("|") === "area:bounds green|city:london", "a place: the neighbourhood, then the city", keys(bookBar));
ok(keys(dal).join("|") === "author:meera sodha|cuisine:indian|site:the guardian",
   "a recipe: a STRING cuisine is one tag, and the site it was read on is the last", keys(dal));
ok(keys(quote).join("|") === "author:mary oliver", "a quote: whoever said it, read from the subtitle", keys(quote));
ok(tagsFor(piranesi)[0].value === "Susanna Clarke", "the value is as the catalogue spelled it, not the folded key", tagsFor(piranesi)[0]);

// The subtitle is the author ONLY for a quote. A book's subtitle is a display
// string ("Susanna Clarke · 2020") and reading it as a fact is the guess this
// module exists not to make.
ok(tagsFor(item({ id: "x", list: "books", title: "Piranesi", subtitle: "Susanna Clarke · 2020" })).length === 0,
   "a book with no canonical has NO tags — its subtitle is not a fact");

// ── nothing that is not a fact ──────────────────────────────────────────────
const all = SHELF.flatMap(tagsFor);
ok(all.every((t) => t.key && t.value && t.kind), "never an empty tag", all.filter((t) => !t.key || !t.value));
ok(!all.some((t) => /https?:|openstreetmap|OL1W|\d{5,}|Holly Grove|45 min/i.test(t.value)),
   "an address, a URL, an id and a cooking time are not tags", all.map((t) => t.value));

const empties = item({
  id: "e", list: "movies", title: "Untitled",
  // What TMDB gives a film with no release date and no details: nulls and
  // empty arrays. Each of these was a tag before its guard.
  canonical: { year: null, director: null, genres: [], cast: [], author: "", city: "  ", area: "", cuisine: [""] },
});
ok(tagsFor(empties).length === 0, "nulls, blanks and empty arrays give no tags at all", tagsFor(empties));
ok(tagsFor(item({ id: "y", list: "movies", canonical: { year: "" } })).length === 0, "no year → no decade of '0s'");
ok(tagsFor(item({ id: "y2", list: "books", canonical: { year: 20 } })).length === 0, "a year that is not a year is not a year", tagsFor(item({ id: "y2", list: "books", canonical: { year: 20 } })));
ok(keys(item({ id: "y3", list: "books", canonical: { year: 1962 } })).join("|") === "year:1962|decade:1960s", "the decade is the year's own", keys(item({ id: "y3", list: "books", canonical: { year: 1962 } })));
ok(tagsFor(item({ id: "l", list: "recipes", canonical: { author: "By the test kitchen team, who made this eleven times before it worked properly" } })).length === 0,
   "a sentence that landed in an author field is not a tag");
ok(tagsFor(item({ id: "o", list: "books", canonical: { author: { name: "Someone" }, genres: [{ name: "Horror" }, 7, true] } }))
     .map((t) => t.key).join("|") === "genre:7",
   "objects and booleans are not values; a number is", tagsFor(item({ id: "o", list: "books", canonical: { author: { name: "Someone" }, genres: [{ name: "Horror" }, 7, true] } })));

// ── de-duplication ──────────────────────────────────────────────────────────
ok(keys(item({ id: "dd", list: "restaurants", canonical: { cuisine: ["Indian", "indian", "INDIAN "] } })).join("|") === "cuisine:indian",
   "three spellings of one cuisine are one tag");
// Nominatim falls back to the city when a place has no suburb.
ok(keys(item({ id: "ac", list: "places", canonical: { area: "London", city: "London" } })).join("|") === "city:london",
   "area and city the same word → said once, as the city", keys(item({ id: "ac", list: "places", canonical: { area: "London", city: "London" } })));
ok(keys(item({ id: "gs", list: "books", canonical: { genres: ["Fantasy"], subjects: ["fantasy", "Gothic"] } })).join("|") === "genre:fantasy|genre:gothic",
   "genres and subjects are one kind and do not repeat each other");

// ── only a FILED item ───────────────────────────────────────────────────────
for (const status of ["pending", "unread"]) {
  ok(tagsFor({ ...piranesi, status }).length === 0, `a ${status} row gives no tags, whatever is sitting in its fields`);
}
ok(tagsFor(null).length === 0 && tagsFor(undefined).length === 0 && tagsFor({}).length === 0, "rubbish in, no crash");
ok(tagsFor({ status: "filed", list: "books", canonical: null }).length === 0 && tagsFor({ status: "filed", canonical: "x" }).length === 0,
   "a canonical that is not an object, no crash");

// ── the index: what a tag view lists ────────────────────────────────────────
const jonathan = item({ id: "j", list: "books", title: "Jonathan Strange & Mr Norrell",
                        canonical: { author: "susanna clarke", year: 2004, subjects: ["Fantasy"] } });
const upstream = item({ id: "u", list: "books", title: "Upstream", canonical: { author: "Mary Oliver", year: 2016 } });
const pending = { ...item({ id: "z", list: "books", canonical: { author: "Susanna Clarke" } }), status: "pending" };
const idx = tagIndex([...SHELF, jonathan, upstream, pending]);
const row = (key) => idx.find((r) => r.key === key);

ok(row("author:susanna clarke").count === 2 && row("author:susanna clarke").ids.join() === "p,j",
   "two spellings of one author are ONE row with both books — and the pending row is not counted", row("author:susanna clarke"));
ok(row("author:susanna clarke").value === "Susanna Clarke", "the spelling shown is the first one met");
ok(row("author:mary oliver").ids.join() === "q,u", "a quote and a book by the same person share a tag, across shelves", row("author:mary oliver"));
ok(row("cuisine:indian").ids.join() === "g,d", "a restaurant's array and a recipe's string meet on one cuisine", row("cuisine:indian"));
ok(row("decade:2020s").ids.join() === "p,s", "a book's number and a film's string meet on one decade", row("decade:2020s"));
ok(idx.every((r) => r.count === r.ids.length && r.count > 0), "count is the ids, and no row is empty");
ok(new Set(idx.map((r) => r.key)).size === idx.length, "one row per key");
ok(idx.every((r, i) => i === 0 || idx[i - 1].count >= r.count), "most-used first", idx.map((r) => r.count));
// Then by name. Three single-use tags given in the WRONG order, so an
// unsorted index cannot pass by luck.
const byName = tagIndex([
  item({ id: "1", list: "places", canonical: { city: "Zagreb" } }),
  item({ id: "2", list: "places", canonical: { city: "Athens" } }),
  item({ id: "3", list: "places", canonical: { city: "Lisbon" } }),
  item({ id: "4", list: "places", canonical: { city: "Lisbon" } }),
]).map((r) => r.value);
ok(byName.join() === "Lisbon,Athens,Zagreb", "count first, then the name — not the order they arrived in", byName);
ok(tagIndex(null).length === 0 && tagIndex([]).length === 0, "no shelf, no crash");

// ── one tag's items ─────────────────────────────────────────────────────────
ok(itemsWithTag([...SHELF, jonathan, pending], "author:susanna clarke").map((x) => x.id).join() === "p,j",
   "the items under a tag, folded the same way, pending left out", itemsWithTag([...SHELF, jonathan, pending], "author:susanna clarke").map((x) => x.id));
ok(itemsWithTag(SHELF, "author:nobody").length === 0 && itemsWithTag(null, "x").length === 0, "no such tag, no shelf → nothing");
// A tag is a kind AND a value: a director is not an author with the same name.
ok(itemsWithTag(SHELF, "author:ryan coogler").length === 0 && itemsWithTag(SHELF, "director:ryan coogler").length === 1,
   "the kind is part of the tag");

console.log(fail ? `tags selftest FAILED (${fail})` : "tags selftest ok");
process.exit(fail ? 1 : 0);
