// logic.mjs — the golden files for Facts, Find, Tags, Links and ListsLogic.
//
//   node swift/tools/golden/logic.mjs
//
// Runs the REAL modules in app/src over one rich shelf and writes what they
// answered to swift/Core/Tests/ShelfCoreTests/Fixtures/golden-*.json. The Swift
// tests run the port over the same inputs and must give the same answers.
//
// DETERMINISTIC ON PURPOSE: no clock, no random id, no default locale. Running
// it twice writes the same bytes, so a diff in a golden file is always a change
// in the JS (or in Node's ICU data), never noise.
//
// TWO THINGS ARE NORMALISED, and both are said in the Swift report:
//
// 1. `canonical` keys are SORTED before the JS sees them. Swift keeps
//    `canonical` as a dictionary, which has no order, so the port walks keys in
//    sorted order (find.js `factsText`). Sorting here makes the JS walk the
//    same way. Nothing else in these five modules reads key order.
// 2. A string the JS cut through the middle of an emoji holds half of one. Swift
//    strings cannot hold that; both sides write U+FFFD there (`toWellFormed`).
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as find from "../../../app/src/find.js";
import * as facts from "../../../app/src/facts.js";
import * as tags from "../../../app/src/tags.js";
import * as links from "../../../app/src/links.js";
import * as lists from "../../../app/src/lists.js";
import { LIST_KEYS } from "../../../app/src/design.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../Core/Tests/ShelfCoreTests/Fixtures");

// ── helpers ──────────────────────────────────────────────────────────────────
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
};
const wellFormed = (v) => {
  if (typeof v === "string") return v.toWellFormed();
  if (Array.isArray(v)) return v.map(wellFormed);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wellFormed(x)]));
  return v;
};
const write = (name, data) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), JSON.stringify(wellFormed(data), null, 1) + "\n");
  const n = Object.entries(data).filter(([, v]) => Array.isArray(v) && v[0] && typeof v[0] === "object" && "output" in v[0]).reduce((s, [, v]) => s + v.length, 0);
  console.log(`${name}: ${n} cases`);
};

const T = "2026-08-01T00:00:00.000Z";
const item = (o) => ({
  id: o.id, list: o.list, status: o.status || "filed", title: o.title ?? null,
  subtitle: o.subtitle || "", note: o.note || "", image_url: o.image_url ?? null,
  canonical: sortKeys(o.canonical || {}), confidence: o.confidence ?? 0.9, enriched: o.enriched ?? true,
  source_url: o.source_url ?? "https://insta/x", resolver: o.resolver ?? "crawler-embed-html",
  ...(o.caption != null ? { caption: o.caption } : {}),
  created_at: o.created_at ?? T, resolved_at: o.resolved_at ?? null,
});

// ── THE SHELF. Every shelf key, in the shapes the server really sends ────────
// (api/enrich/index.js pickBook / pickMovieDetail / pickOsmPlace / pickRecipe,
// api/resolveRoute.js productItem + carry, app/preview/storeStub.js.)
const DOSA = [
  "There is no sign outside. You find it by the queue, which starts at half past five and is gone by seven, because by seven the batter is gone too.",
  "Inside are twelve stools, one flat-top and a man who has made the same dosa for nineteen years. He does not hurry and he does not talk while he pours.",
  "The ghee roast comes first. It is as long as your forearm and it breaks like glass.",
  "Then the sambar, which is thinner than you expect and better for it. Then the coffee, poured from a height into a steel tumbler, and then somebody is standing behind you waiting for the stool.",
  "Nobody has written the recipe down. He says the batter knows what day it is, and that is all he will say about it.",
].join("\n\n");
const DAL_TEXT =
  "Rinse the pulses until the water runs clear. Simmer with turmeric for half an hour, " +
  "then stir through tamarind and a spoon of jaggery. The party trick is to start the tempering late. " +
  "Mustard seeds, curry leaves and dried chilli go in at the very end. " +
  ("Taste, and add salt before the lemon and never after it; the lemon goes in off the heat. ").repeat(30) +
  "Serve with rice, a spoon of yoghurt and whatever pickle is open. Café-style crème fraîche is not traditional but nobody has complained.";
const PIZZA = "🍕".repeat(40);

const ITEMS = [
  // books
  item({ id: "b1", list: "books", title: "Piranesi", subtitle: "Susanna Clarke · 2020", created_at: "2025-10-02T08:00:00.000Z", resolved_at: "2025-10-02T08:00:05.000Z",
    canonical: { openlibrary_key: "/works/OL1W", isbn: "9781635575637", year: 2020, author: "Susanna Clarke", pages: 245,
      subjects: ["Fantasy", "Labyrinths"], rating: 4.3, key: "books:/works/OL1W",
      first_sentence: "When the Moon rose in the Third Northern Hall I went to the Ninth Vestibule.", read_url: "https://openlibrary.org/works/OL1W" } }),
  item({ id: "b2", list: "books", title: "Jonathan Strange & Mr Norrell", subtitle: "Susanna Clarke · 2004", created_at: "2026-02-01T00:00:00Z",
    canonical: { author: "susanna  CLARKE.", year: 2004, subjects: ["Fantasy"], pages: 782, price: 9.99, currency: "GBP" } }),
  item({ id: "b3", list: "books", title: "Babel", subtitle: "R. F. Kuang · 2022", note: "Borrowed from Maya — give it back.",
    canonical: { author: "R. F. Kuang", year: 2022, subjects: ["Fantasy", "Dark academia", "fantasy"], rating: 4.1, read_url: "https://openlibrary.org/works/OL2W" } }),
  item({ id: "b4", list: "books", title: "ノルウェイの森", subtitle: "村上春樹 · 1987", canonical: { author: "村上春樹", year: 1987, pages: 296 } }),
  item({ id: "b5", list: "books", title: "Harry Potter and the Goblet of Fire", subtitle: "J.K. Rowling · 2000", canonical: { author: "J.K. Rowling", year: 2000 } }),
  item({ id: "b6", list: "books", title: "Cien años de soledad", subtitle: "Gabriel García Márquez · 1967", created_at: "2026-03-01T00:00:00+01:00",
    // The note has a DECOMPOSED accent (e + U+0301) and an emoji before the match,
    // so a snippet has to count the way the JS counts.
    note: "Read it in the café on Rua Augusta 🙂🙂 with María — the yellow butterflies chapter is the one to reread.",
    canonical: { author: "Gabriel García Márquez", year: 1967, pages: 417, subjects: ["Magical realism"] } }),
  item({ id: "b7", list: "books", title: "Upstream", subtitle: "Mary Oliver · 2016", created_at: "2026-04-01", canonical: { author: "Mary Oliver", year: 2016 } }),
  // restaurants
  item({ id: "r1", list: "restaurants", title: "St. John", subtitle: "British · Farringdon",
    canonical: { osm_type: "node", osm_id: 42, address: "26 St John Street, Farringdon, London EC1M 4AY", area: "Farringdon",
      lat: 51.5203, lng: -0.1027, website: "https://stjohnrestaurant.com", phone: "+44 20 7251 0848", opening_hours: "Mo-Sa 12:00-23:00",
      cuisine: ["british"], map_url: "geo:51.5203,-0.1027?q=St.%20John", osm_url: "https://www.openstreetmap.org/node/42", source: "openstreetmap" } }),
  item({ id: "r2", list: "restaurants", title: "Ganapati", subtitle: "South indian · Peckham", note: "Go early on a Saturday, the dosa sells out by two.",
    canonical: { osm_type: "node", osm_id: 43, address: "Ganapati, 38 Holly Grove, Peckham, London, SE15 5DF", area: "Peckham", lat: 51.47, lng: -0.07,
      cuisine: ["South indian", "Indian"], map_url: "geo:51.47,-0.07?q=Ganapati", source: "openstreetmap" } }),
  item({ id: "r3", list: "restaurants", title: "Café de Flore", subtitle: "French · Paris",
    canonical: { city: "Paris", area: "Saint-Germain-des-Prés", lat: 48.854, lng: 2.3326, cuisine: ["french"], address: "172 Boulevard Saint-Germain, 75006 Paris", website: "https://cafedeflore.fr" } }),
  item({ id: "r4", list: "restaurants", title: "Brutto", subtitle: "Italian · Farringdon",
    canonical: { osm_type: "node", osm_id: 44, address: "35-37 Greenhill Rents, London EC1M 6BN", area: "Farringdon", lat: 51.5205, lng: -0.1016, cuisine: ["italian"], source: "openstreetmap" } }),
  // A name with a comma, an ampersand and an apostrophe, and no pin.
  item({ id: "r5", list: "restaurants", title: "Tom's Kitchen & Bar, Chelsea", subtitle: "Chelsea", canonical: { city: "London", area: "Chelsea", cuisine: [] } }),
  item({ id: "r6", list: "restaurants", title: "Mangal II", subtitle: "38 Holly Grove", confidence: 0.42, enriched: false, canonical: {} }),
  // movies
  item({ id: "m1", list: "movies", title: "Sinners", subtitle: "Ryan Coogler · 2025", created_at: "2026-09-01T00:00:00.000Z",
    canonical: { tmdb_id: 7, media_type: "movie", year: "2025", director: "Ryan Coogler", runtime_min: 137, genres: ["Horror", "Thriller"], rating: 7.6,
      overview: "Two brothers return to their home town to start again, and find something far older waiting for them.",
      cast: ["Michael B. Jordan", "Hailee Steinfeld", "Delroy Lindo", "Jack O'Connell"], trailer_url: "https://www.youtube.com/watch?v=x",
      watch_url: "https://www.themoviedb.org/movie/7/watch", streaming: ["Mubi", "Netflix"], region: "GB" } }),
  item({ id: "m2", list: "movies", title: "Creed", subtitle: "Ryan Coogler · 2015",
    canonical: { tmdb_id: 8, year: "2015", director: "Ryan Coogler", runtime_min: 133, genres: ["Drama"], cast: ["Michael B. Jordan", "Sylvester Stallone"], watch_url: "https://www.themoviedb.org/movie/8/watch", streaming: [] } }),
  item({ id: "m3", list: "movies", title: "La Chimera", subtitle: "Alice Rohrwacher · 2023", canonical: { year: "2023", director: "Alice Rohrwacher", genres: ["Drama", "Fantasy"], rating: 7 } }),
  item({ id: "m4", list: "movies", title: "Anatomy of a Fall", subtitle: "2023", note: "reminded me of Piranesi", canonical: { year: "2023" } }),
  // What TMDB gives a film with no release date and no details.
  item({ id: "m5", list: "movies", title: "Untitled", canonical: { year: null, director: null, genres: [], cast: [], author: "", city: "  ", area: "", cuisine: [""], runtime_min: null, overview: "" } }),
  // recipes
  item({ id: "c1", list: "recipes", title: "Lemon dal", subtitle: "45 min · 4 servings",
    canonical: { recipe_url: "https://food.example/dal", ingredients: ["1 cup toor dal", "2 lemons", "curry leaves"], total_time: "45 min", serves: "4 servings",
      steps: 6, author: "Meera Sodha", rating: 4.6, calories: "320 kcal", cuisine: "Indian",
      article: { byline: "Words by Jay Rayner", siteName: "The Guardian", readingMinutes: 4, hero: "https://cdn/d.jpg", excerpt: "Rinse the pulses",
        summary: "Sour first, then sweet: a weeknight supper.", text: DAL_TEXT } } }),
  item({ id: "c2", list: "recipes", title: "Cacio e pepe", subtitle: "20 min", canonical: { recipe_url: "https://food.example/cacio", ingredients: [], total_time: "20 min", serves: 2, steps: 0, author: "Felicity Cloake", cuisine: "Italian", article: { siteName: "The Guardian" } } }),
  item({ id: "c3", list: "recipes", title: "Aubergine curry", subtitle: "1 hr", canonical: { total_time: "1 hr", author: "Meera Sodha", cuisine: "Indian", article: { siteName: "the guardian" } } }),
  // quotes — enrich() hands a quote back with `canonical: {}`.
  item({ id: "q1", list: "quotes", title: "“Attention is the beginning of devotion.”", subtitle: "Mary Oliver", caption: "mary oliver, upstream #poetry #quotes", canonical: {} }),
  item({ id: "q2", list: "quotes", subtitle: "Joan Didion",
    title: "We tell ourselves stories in order to live. We look for the sermon in the suicide, for the social or moral lesson in the murder of five. We interpret what we see, select the most workable of the multiple choices, and we live entirely by the imposition of a narrative line upon disparate images.",
    canonical: { author: "Joan Didion", source: "The White Album" } }),
  item({ id: "q3", list: "quotes", title: "Attention is the rarest and purest form of generosity.", subtitle: "Simone Weil", canonical: { author: null } }),
  // places
  item({ id: "p1", list: "places", title: "Miradouro da Senhora do Monte", subtitle: "Graça · Lisbon", created_at: "2026-02-01T00:00:00.000Z",
    canonical: { city: "Lisbon", area: "Graça", located: true, address: "Largo Monte, 1170-107 Lisboa", lat: 38.72, lng: -9.13, map_url: "geo:38.72,-9.13?q=Miradouro", osm_url: "https://www.openstreetmap.org/node/1", source: "openstreetmap" } }),
  item({ id: "p2", list: "places", title: "Time Out Market", subtitle: "Cais do Sodré · Lisbon", created_at: "2026-03-01T00:00:00.000Z",
    canonical: { city: "Lisbon", area: "Cais do Sodré", located: true, address: "Av. 24 de Julho 49, Lisboa", opening_hours: "Su-We 10:00-24:00", map_url: "geo:38.70,-9.14?q=Time%20Out", website: "https://timeoutmarket.com", source: "openstreetmap" } }),
  item({ id: "p3", list: "places", title: "Belém", subtitle: "Belém · Lisbon", created_at: "2026-02-01T00:00:00.000Z", canonical: { city: "Lisbon", area: "Belém", located: true } }),
  item({ id: "p4", list: "places", title: "Praia da Ursa", subtitle: "Sintra", canonical: { city: "Sintra", located: false, map_url: "geo:0,0?q=Praia%20da%20Ursa%2C%20Sintra", source: "search" } }),
  item({ id: "p5", list: "places", title: "Book Bar", subtitle: "Bounds Green · London", canonical: { osm_type: "node", osm_id: 9, address: "Book Bar, Bounds Green, London", area: "Bounds Green", lat: 51.6, lng: -0.12, cuisine: [], city: "London", located: true, source: "openstreetmap" } }),
  // Nominatim falls back to the city when a place has no suburb.
  item({ id: "p6", list: "places", title: "London Fields", subtitle: "London", canonical: { area: "London", city: "London", located: true, lat: 51.5422, lng: -0.0613 } }),
  item({ id: "p7", list: "places", title: "東京タワー", subtitle: "東京", canonical: { city: "東京", located: true, lat: 35.6586, lng: 139.7454 } }),
  item({ id: "p8", list: "places", title: "São Paulo Museum of Art", subtitle: "São Paulo", canonical: { city: "São Paulo", located: true, lat: -23.5614, lng: -46.6559, website: "https://masp.org.br" } }),
  // Hangul DECOMPOSES when folded (one unit becomes two or three), so an index
  // found in the folded note is far past the same word in the note itself.
  item({ id: "p9", list: "places", title: "광장시장", subtitle: "서울", canonical: { city: "Seoul", located: true, lat: 37.57, lng: 126.9996 },
    note: "빈대떡 먹기 mung bean pancake 마약김밥 그리고 육회 then walk to Cheonggyecheon stream after dark 그리고 집에 가기 before the last train leaves" }),
  // wishlist — api/resolveRoute.js productItem.
  item({ id: "w1", list: "wishlist", title: "Wool overshirt, olive", subtitle: "Northfield", source_url: "https://shop.example/overshirt", resolver: "web-og", created_at: "2026-09-20T09:00:00Z",
    canonical: { kind: "product", price: 65, currency: "GBP", price_text: "£65.00", brand: "Northfield", availability: "in_stock", seller: "Northfield", shop_url: "https://shop.example/overshirt", price_at: "2026-10-01T09:00:00Z" } }),
  item({ id: "w2", list: "wishlist", title: "Lip tint, Rosewood", subtitle: "Petal", created_at: "2026-09-21T09:00:00Z",
    canonical: { kind: "product", price: 18, currency: "GBP", price_text: "£18.00", brand: "Petal", availability: "in_stock", shop_url: "https://shop.example/tint" } }),
  item({ id: "w3", list: "wishlist", title: "Linen trousers, ecru", subtitle: "Marlow & Co", created_at: "2026-09-22T09:00:00Z",
    canonical: { kind: "product", price: null, currency: null, price_text: null, brand: "Marlow & Co", shop_url: "https://shop.example/linen" } }),
  item({ id: "w4", list: "wishlist", title: "Bentwood chair", subtitle: "Thonet", canonical: { kind: "product", price: 349.5, currency: "EUR", price_text: "€349.50", brand: "Thonet", availability: "out_of_stock", seller: "Liberty", shop_url: "https://shop.example/chair" } }),
  item({ id: "w5", list: "wishlist", title: "Petty knife", subtitle: "Tadafusa", canonical: { kind: "product", price: 12000, currency: "JPY", price_text: "¥12,000", brand: "Tadafusa", availability: "preorder", shop_url: "https://shop.example/knife" } }),
  item({ id: "w6", list: "wishlist", title: "Desk lamp", subtitle: "Maker", canonical: { kind: "product", price: 20, currency: "USD", price_text: "$20 to $35", brand: "Maker", availability: "discontinued", shop_url: "https://shop.example/lamp" } }),
  item({ id: "w7", list: "wishlist", title: "Laptop, 14 inch", subtitle: "", canonical: { kind: "product", price: 1299, currency: "eur", price_text: "€1,299.00", seller: "Big Shop", shop_url: "https://shop.example/laptop" } }),
  item({ id: "w8", list: "wishlist", title: "Sticker sheet", subtitle: "Petal", canonical: { kind: "product", price: 0, currency: "GBP", price_text: "Free", brand: "Petal" } }),
  item({ id: "w9", list: "wishlist", title: "Candle", subtitle: "", canonical: { kind: "product", price: null, currency: null, price_text: "From £9" } }),
  item({ id: "w10", list: "wishlist", title: "Scarf, lambswool", subtitle: "Northfield", canonical: { kind: "product", price: 65.5, currency: "GBP", price_text: "£65.50", brand: "Northfield", availability: "in_stock", seller: "Northfield" } }),
  // notes
  item({ id: "n1", list: "notes", title: "Brown boots, not black.", note: "Brown boots, not black. Ask Maya about the scarf.", source_url: null, resolver: "note", confidence: null, enriched: false, created_at: "2026-09-23T09:00:00Z", canonical: { kind: "note" } }),
  item({ id: "n2", list: "notes", title: "Gift ideas", note: "Gift ideas", source_url: null, resolver: "note", confidence: null, enriched: false, canonical: { kind: "note" } }),
  item({ id: "n3", list: "notes", title: "Things to ask the landlord.", source_url: null, resolver: "note", confidence: null, enriched: false, canonical: { kind: "note" },
    note: "Things to ask the landlord.\nDoes the boiler get serviced, and who pays for it? Is the deposit in a scheme, and which one? Can we put shelves up in the back room? Who do we call when the lift stops, because it stopped twice in the week we looked round. And is the bike store locked at night." }),
  // the pile
  item({ id: "u1", list: "unsorted", status: "pending", title: null, source_url: "https://insta/y", resolver: null, confidence: null, enriched: false, created_at: "", canonical: { author: "Susanna Clarke", city: "London" } }),
  item({ id: "u2", list: "unsorted", status: "unread", title: null, source_url: "https://www.instagram.com/reel/DAbCdEf/", resolver: "none", confidence: null, enriched: false, created_at: "not a date", caption: "piranesi lisbon dosa" }),
  item({ id: "u3", list: "unsorted", title: "The dosa counter that does not take bookings", subtitle: "Field Notes", source_url: "https://fieldnotes.example/dosa-counter", resolver: "web-og", confidence: null, enriched: false, created_at: "2026-09-12T09:00:00Z",
    canonical: { article: { byline: "R. Okafor", siteName: "Field Notes", readingMinutes: 6, hero: null, excerpt: "There is no sign outside. You find it by the queue.",
      summary: "A twelve-seat counter on Holly Grove serves one thing well. Go before seven. Order the ghee roast and the filter coffee. We landed in Lisbon the week after.", text: DOSA } } }),
  item({ id: "u4", list: "unsorted", title: "Screenshot", created_at: "2026-03-01T00:00:00.000Z", canonical: { ocr_text: "MENÚ DEL DÍA\nCroquetas de jamón 9€\nPulpo a la gallega 14€" } }),
  // A product on a build with no Wishlist shelf: it stands in the pile.
  item({ id: "u5", list: "unsorted", title: "Enamel mug", subtitle: "Falcon", canonical: { kind: "product", price: 12.5, currency: "GBP", price_text: "£12.50", brand: "Falcon", availability: "in_stock", seller: "Falcon", shop_url: "https://shop.example/mug" } }),
  item({ id: "u6", list: "unsorted", title: null, note: "the one with the yellow cover" }),
  // Emoji with no spaces between them: a cut by UTF-16 index lands inside one.
  item({ id: "u7", list: "unsorted", title: "🍕🍕 Pizza night 🍕", note: PIZZA + "margherita" + PIZZA + " and then tiramisù 🍰",
    caption: "#pizza #napoli " + "🍕".repeat(30) + " best slice in town " + "🔥".repeat(30), canonical: { ocr_text: PIZZA + " FORNO A LEGNA " + PIZZA } }),
  // Everything `factsText` has a rule about, in one canonical.
  item({ id: "u8", list: "unsorted", title: "Odd one", subtitle: "odds",
    canonical: { "10": "ten", "2": "two", zeta: "last", Alpha: "capital first", nested: { a: { b: { c: { d: "deep" } } } }, shallow: { a: { b: { c: "kept" } } },
      key: "books:/works/X", place_id: "ChIJabc123", image_url: "https://covers/x.jpg", href: "/x", HREF2: "upper", slug: "odd-one", Source: "openstreetmap",
      long: "x".repeat(81), exact80: "y".repeat(80), flag: true, nothing: null, count: 3.5, tiny: 1e-7, small: 0.000001, big: 1e21, huge: 123456789012345680000, neg: -0.5,
      arr: [1, "two", ["three"], { four: "4", url: "https://no" }, null, false], path: "/works/1", data: "DATA:abc", geo: "geo:1,2", web: "HTTPS://x", plain: "http and more",
      thumbs: "noisy by key", coordinates: "noisy too", emoji: "🍕 slice" } }),
];

for (const key of LIST_KEYS) if (!ITEMS.some((x) => x.list === key)) throw new Error(`${key}: no fixture for this shelf`);

const BOARDS = [
  { id: "l-outfit", name: "Autumn outfit", pins: ["w1", "w3", "n1", "w2", "b1"], query: null, view: "pictures", created_at: "2026-09-24T10:00:00Z" },
  { id: "l-weekend", name: "This weekend", pins: ["r1", "m1", "b1"], query: null, view: "pictures", created_at: "2026-09-20T10:00:00Z" },
  { id: "l-lisbon", name: "Lisbon", pins: [], query: "lisbon", view: "rows", created_at: "2026-09-21T10:00:00Z" },
  { id: "l-mix", name: "Lisbon and a book", pins: ["p3", "b1", "gone", "p3"], query: "lisbon", view: "rows", created_at: "2026-09-22T10:00:00Z" },
  { id: "l-money", name: "Everything to buy", pins: ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "b2", "u5", "also-gone"], query: "clarke", view: "pictures", created_at: "2026-09-23T10:00:00Z" },
  { id: "l-empty", name: "Empty", pins: [], query: null, view: "pictures", created_at: "2026-09-25T10:00:00Z" },
];

const byId = (id) => ITEMS.find((x) => x.id === id);
const idsOf = (xs) => xs.map((x) => x.id);

// ═══ TAGS ════════════════════════════════════════════════════════════════════
const FOLDS = ["Café de Flore", "MØRK Ø", "Ganapati’s", "São Paulo", "ÀÉÎÕÜ ñ ç ß æ œ ÿ", "café", "İstanbul", "ΟΔΟΣ ΣΟΦΟΣ", "村上春樹", "Straße", "🍕 Pizza", "", "ǅungla", "Ǻngström", "ﬁn", "DÉJÀ VU"];
const TAG_EXTRA = [
  item({ id: "x1", list: "books", title: "x", canonical: { brand: "Penguin" } }),
  item({ id: "x2", list: "movies", title: "x", canonical: { year: "" } }),
  item({ id: "x3", list: "books", title: "x", canonical: { year: 20 } }),
  item({ id: "x4", list: "books", title: "x", canonical: { year: 1962 } }),
  item({ id: "x5", list: "books", title: "x", canonical: { year: " 1999 " } }),
  item({ id: "x6", list: "books", title: "x", canonical: { year: 2100 } }),
  item({ id: "x7", list: "recipes", title: "x", canonical: { author: "By the test kitchen team, who made this eleven times before it worked properly" } }),
  item({ id: "x8", list: "books", title: "x", canonical: { author: { name: "Someone" }, genres: [{ name: "Horror" }, 7, true, null, 2.5] } }),
  item({ id: "x9", list: "restaurants", title: "x", canonical: { cuisine: ["Indian", "indian", "INDIAN ", " in\tdian"] } }),
  item({ id: "x10", list: "books", title: "x", canonical: { genres: ["Fantasy"], subjects: ["fantasy", "Gothic"] } }),
  item({ id: "x11", list: "books", title: "x", subtitle: "Susanna Clarke · 2020" }),
  item({ id: "x12", list: "quotes", title: "x", subtitle: "  Lily   Tomlin. " }),
  item({ id: "x13", list: "recipes", title: "x", canonical: { article: 0 } }),
  item({ id: "x14", list: "recipes", title: "x", canonical: { article: "a string", author: 7 } }),
  item({ id: "x15", list: "places", title: "x", canonical: { area: "São Paulo", city: "Sao  Paulo." } }),
  item({ id: "x16", list: "places", title: "x", canonical: { area: ["Soho", "Fitzrovia"], city: "London" } }),
  item({ id: "x17", list: "books", title: "x", canonical: { author: ["Ann", "Bob"], year: 1499 } }),
  item({ id: "x18", list: "wishlist", title: "x", canonical: { kind: "product", brand: ["Acme", "ACME"] } }),
  item({ id: "x19", list: "books", title: "x", canonical: { author: "a".repeat(60), director: "b".repeat(61) } }),
  item({ id: "x20", list: "places", title: "x", canonical: { city: "Zagreb" } }),
  item({ id: "x21", list: "places", title: "x", canonical: { city: "Athens" } }),
  item({ id: "x22", list: "movies", title: "x", canonical: { director: "Susanna Clarke", year: "2020" } }),
];
{
  const all = [...ITEMS, ...TAG_EXTRA];
  const index = tags.tagIndex(all);
  write("golden-tags.json", {
    items: all,
    mainCount: ITEMS.length,
    fold: FOLDS.flatMap((s) => [true, false].map((useNormalize) => ({ input: { s, useNormalize }, output: tags.fold(s, useNormalize) }))),
    tagKey: [["author", "Susanna Clarke"], ["author", "susanna  CLARKE."], ["city", "São Paulo"], ["author", "村上春樹"], ["author", " . "], ["author", ""],
      ["cast", "Michael B. Jordan"], ["cast", "Jack O'Connell"], ["x", "(a)[b]/c_d-e;f:g!h?i“j”k‘l’m\"n"], ["genre", "Rock & Roll"], ["x", "a b\tc\n d"], ["x", "–dash—"]]
      .map(([kind, value]) => ({ input: { kind, value }, output: tags.tagKey(kind, value) })),
    tagsFor: all.map((it) => ({ input: { id: it.id }, output: tags.tagsFor(it) })),
    tagIndex: [{ input: { count: ITEMS.length }, output: tags.tagIndex(ITEMS) }, { input: { count: all.length }, output: index }],
    itemsWithTag: [...index.map((r) => r.key), "author:nobody", "author:ryan coogler", ""].map((key) => ({ input: { key }, output: idsOf(tags.itemsWithTag(all, key)) })),
  });
}

// ═══ LINKS ═══════════════════════════════════════════════════════════════════
{
  const extra = [
    item({ id: "k1", list: "movies", title: "Shot on location", canonical: { cast: ["Michael B. Jordan"], city: "London", director: "Nobody Else" } }),
    item({ id: "k2", list: "books", title: "A copy", canonical: { author: "Mary Oliver" } }),
  ];
  const all = [...ITEMS, ...extra];
  write("golden-links.json", {
    items: all,
    kinds: links.LINK_KINDS,
    linksFor: all.map((it) => ({ input: { id: it.id }, output: links.linksFor(it, all).map((g) => ({ reason: g.reason, ids: idsOf(g.items) })) })),
  });
}

// ═══ FACTS ═══════════════════════════════════════════════════════════════════
{
  const extra = [
    item({ id: "f1", list: "places", title: "A/B?C#D=E+F%G", canonical: { city: "Köln" } }),
    item({ id: "f2", list: "places", title: "naïve ~ (test) *star* !bang_under-dash.dot", canonical: { city: "Zürich", located: false } }),
    item({ id: "f3", list: "restaurants", title: "🍕 Pizza Pilgrims", canonical: { lat: 51.5, lng: 0, phone: " 020 7287\t8964 " } }),
    item({ id: "f4", list: "restaurants", title: "", canonical: {} }),
    item({ id: "f5", list: "places", title: null, canonical: { city: "Porto" } }),
    item({ id: "f6", list: "places", title: "Tiny pin", canonical: { lat: 1e-7, lng: -1.5e-7, area: "Nowhere", city: "Nowhere" } }),
    item({ id: "f7", list: "places", title: "Half a pin", canonical: { lat: 51.5, lng: "0.1", city: 7 } }),
    item({ id: "f8", list: "movies", title: "Bare film", canonical: { runtime_min: 0, rating: 0, genres: ["", "Drama", null, 7], cast: "not a list", streaming: ["Mubi"], watch_url: "https://w", trailer_url: "" } }),
    item({ id: "f9", list: "books", title: "Bare book", canonical: { year: 0, pages: 0, rating: 5, subjects: [], author: 12 } }),
    item({ id: "f10", list: "recipes", title: "Bare recipe", canonical: { steps: 0, ingredients: [""], serves: 4, total_time: "", calories: 0 } }),
    item({ id: "f11", list: "wishlist", title: "Odd product", canonical: { kind: "product", price_text: 12, brand: "", availability: "nope", seller: "Shop", shop_url: null } }),
    item({ id: "f12", list: "books", title: "A book with a price", canonical: { price_text: "£9", author: "Someone" } }),
    item({ id: "f13", list: "notes", title: "A note", canonical: { kind: "note" } }),
    item({ id: "f14", list: "restaurants", title: "Big numbers", canonical: { lat: 123456789012345680000, lng: 1e21, city: "X" } }),
    item({ id: "f15", list: "places", title: "Two wheres", canonical: { area: "Alfama", city: "Lisbon", located: null } }),
  ];
  const all = [...ITEMS, ...extra];
  const cases = [];
  for (const it of all) {
    for (const platform of ["ios", "android", null]) {
      cases.push({ input: { id: it.id, platform, price: true }, output: { ...facts.factsFor(it, { platform }), map: facts.mapUrl(it, platform) } });
    }
    if (it.canonical.kind === "product") cases.push({ input: { id: it.id, platform: null, price: false }, output: { ...facts.factsFor(it, { price: false }), map: facts.mapUrl(it, null) } });
  }
  write("golden-facts.json", {
    items: all,
    stock: facts.STOCK,
    factsFor: cases,
    hasFacts: all.map((it) => ({ input: { id: it.id }, output: facts.hasFacts(it) })),
  });
}

// ═══ FIND ════════════════════════════════════════════════════════════════════
{
  const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";
  const LONG = [
    item({ id: "lr", list: "recipes", title: "A long read", created_at: "2026-09-01T00:00:00.000Z", canonical: { article: { text: filler.repeat(130) + " an aside about susanna clarke " + filler.repeat(120) } } }),
    item({ id: "tl", list: "recipes", title: "Very long", canonical: { article: { text: filler.repeat(250) + " earlyword " + filler.repeat(20) + " lateword" }, ocr_text: "x".repeat(19990) + " edge🍕🍕🍕🍕🍕🍕🍕 past" } }),
    byId("b1"),
  ];
  const SETS = { main: ITEMS, long: LONG };

  const QUERIES = [
    "piranesi", "piranese", "PIRANESI", "pirane", "cafe", "café", "café", "clarke", "clarke piranesi", "clarke sinners", "peckham", "dosa", "2020", "2020s",
    "hp", "oliver", "books", "book", "boo", "film", "buy", "note", "notes", "northfield", "scarf", "lisbon", "lisboa", "guardian", "tamarind", "amarind", "tamarinf",
    "rayner", "weeknight", "croquetas", "jamon", "menu", "menú del día", "yellow", "book bar", "bar book", "london", "farringdon", "st john", "St. John's",
    "tom's", "kitchen & bar", "村上春樹", "東京", "sao paulo", "são", "marquez", "soledad", "cien anos", "coogler", "michael b jordan", "jordan", "horror", "fantasy",
    "indian", "south indian", "", "   ", "zzzzqqq", "a", "the", "pizza", "🍕", "pizza night", "pile", "inbox", "wish", "eat", "245", "4.3", "7.6", "overshirt",
    "wool overshirt, olive", "olive", "liberty", "brutto", "italian", "teh", "goblet fire", "harry poter", "sinners 2025", "ghee", "filter coffee", "landlord",
    "boiler", "gift", "didion", "narrative line", "ten", "two", "deep", "kept", "chij", "9781635575637", "openlibrary", "openstreetmap", "margherita", "tiramisu",
    "forno", "napoli", "slice", "maya", "butterflies", "maria", "augusta", "salt lemon", "creme fraiche", "attention", "generosity", "white album", "mubi",
    "thriller", "labyrinths", "graca", "belem", "sintra", "holly grove", "ec1m", "in", "st", "lambswool", "petal", "falcon", "mug", "trip", "travel", "reading",
    "said", "shopping", "cook", "tv", "unsorted", "peckam", "faringdon", "susana", "yoghurt", "capital", "last", "odds", "noisy", "upper", "3.5", "sour sweet", "cheonggyecheon", "pancake", "seoul", "last train", "bean",
  ];
  const search = [];
  const out = (r) => ({ hits: r.hits.map((h) => ({ id: h.item.id, score: h.score, why: h.why, snippet: h.snippet })), counts: r.counts, total: r.total, terms: r.terms });
  for (const q of QUERIES) search.push({ input: { set: "main", q, limit: 60, list: null }, output: out(find.searchShelf(ITEMS, q)) });
  for (const [q, opts] of [["book", { list: "places" }], ["book", { list: "books" }], ["a", { limit: 3 }], ["a", { limit: 0 }], ["lisbon", { limit: 1000 }],
    ["clarke", { list: "wishlist" }], ["s", { limit: 5, list: "restaurants" }], ["london", { list: "nope" }], ["e", { limit: -1 }], ["e", { limit: 1e9 }]]) {
    search.push({ input: { set: "main", q, limit: opts.limit ?? 60, list: opts.list ?? null }, output: out(find.searchShelf(ITEMS, q, opts)) });
  }
  for (const q of ["clarke", "earlyword", "lateword", "lorem", "aside", "edge", "past", "xxxx", "susanna clarke"]) {
    search.push({ input: { set: "long", q, limit: 60, list: null }, output: out(find.searchShelf(LONG, q)) });
  }

  // Snippets, directly: every field of every item that has text, opened on a
  // word from the start, the middle and the end of it, at three widths.
  const snippetOf = [];
  const FIELDS = ["title", "subtitle", "tags", "facts", "note", "caption", "ocr", "article", "list"];
  for (const it of ITEMS) {
    for (const field of FIELDS) {
      const text = field === "ocr" || field === "article" ? find.bodyText(it, field) : (find.fieldsOf(it).find((f) => f.name === field)?.text ?? "");
      const ws = find.words(text);
      const picks = ws.length ? [...new Set([ws[0], ws[Math.floor(ws.length / 2)], ws[ws.length - 1]])] : [];
      const termSets = [...picks.map((w) => [w]), ...(picks.length > 1 ? [[picks[picks.length - 1], picks[0]]] : []), ["zzzz"]];
      for (const terms of termSets) for (const width of [30, 60, 84]) {
        if (!text && width !== 84) continue;
        snippetOf.push({ input: { set: "main", id: it.id, field, terms, width }, output: find.snippetOf(it, field, terms, width) });
      }
    }
  }
  for (const [id, field, terms, width] of [["tl", "ocr", ["edge"], 84], ["tl", "ocr", ["past"], 20], ["tl", "article", ["earlyword"], 50], ["lr", "article", ["clarke"], 84]]) {
    snippetOf.push({ input: { set: "long", id, field, terms, width }, output: find.snippetOf(LONG.find((x) => x.id === id), field, terms, width) });
  }

  const PAIRS = [["piranesi", "piranesi"], ["pirenesi", "piranesi"], ["piranes", "piranesi"], ["piiranesi", "piranesi"], ["teh", "the"], ["pxranesx", "piranesi"],
    ["cat", "dog"], ["cat", "car"], ["", ""], ["", "a"], ["ab", "ba"], ["abc", "acb"], ["abcd", "abdc"], ["abcd", "badc"], ["abc", "abcde"], ["book", "boook"],
    ["book", "bok"], ["book", "ook"], ["book", "boo"], ["ook", "book"], ["oo", "book"], ["boo", "book"], ["piranese", "piranesi"], ["book", ""], ["bar", "barb"],
    ["abcd", "abxy"], ["tamarinf", "tamarind"], ["lisboa", "lisbon"], ["a", "b"], ["ab", "abc"], ["xab", "ab"], ["axb", "ab"], ["abx", "ab"], ["acbd", "abcd"], ["acbe", "abcd"]];
  const HAYS = [["the art of it", "art"], ["an article", "art"], ["the party will start", "art"], ["party art", "art"], ["an article about art", "art"],
    ["an article about artists", "art"], ["", "art"], ["art", ""], ["art", "art"], ["art2", "art"], ["2art", "art"], ["menu del dia\ncroquetas", "croquetas"],
    ["ñandú art", "art"], ["🍕art🍕", "art"], ["ARTful art", "art"], ["aaa", "a"], ["aaa aa a", "a"], ["x-art", "art"], ["村上art春樹", "art"]];

  write("golden-find.json", {
    sets: SETS,
    weights: find.W,
    fold: FOLDS.map((s) => ({ input: { s }, output: find.fold(s) })),
    words: ["St. John's — 26 St John St", "Café de Flore", "", "   ", "村上春樹 1987", "🍕🍕 Pizza night 🍕", "MENÚ DEL DÍA\nCroquetas", "a_b-c.d", "İstanbul ΟΔΟΣ", "Straße 9€", "cafés", "ǅungla ﬁn"]
      .map((s) => ({ input: { s }, output: find.words(s) })),
    withinOneEdit: PAIRS.map(([a, b]) => ({ input: { a, b }, output: find.withinOneEdit(a, b) })),
    tokenScore: PAIRS.map(([a, b]) => ({ input: { a, b }, output: find.tokenScore(a, b) })),
    factsText: [...ITEMS, ...TAG_EXTRA].map((it) => ({ input: { canonical: it.canonical }, output: find.factsText(it.canonical) })),
    bodyText: ITEMS.flatMap((it) => ["ocr", "article"].map((field) => ({ input: { set: "main", id: it.id, field }, output: find.bodyText(it, field) })))
      .concat(LONG.flatMap((it) => ["ocr", "article"].map((field) => {
        const t = find.bodyText(it, field);
        return { input: { set: "long", id: it.id, field, lengthOnly: true }, output: { length: t.length, tail: t.slice(-12) } };
      }))),
    bodyHit: HAYS.map(([hay, q]) => ({ input: { hay, q }, output: find.bodyHit(hay, q) })),
    fieldsOf: ITEMS.map((it) => ({ input: { id: it.id }, output: find.fieldsOf(it) })),
    snippetOf,
    search,
    alreadyShelved: [
      { list: "books", key: "books:/works/OL1W", title: "Piranesi" }, { list: "restaurants", key: "restaurants:node/999", title: "ganapati" },
      { list: "books", key: "books:x", title: "Ganapati" }, { list: "movies", key: "movies:7", title: "Sinners 2" }, { list: "restaurants", key: null, title: "CAFE DE FLORE" },
      { list: "movies", key: "books:/works/OL1W", title: "Something else" }, { list: "unsorted", key: null, title: "" }, { list: "places", key: "", title: "belem" },
      { list: "books", key: "k", title: "ノルウェイの森" }, { list: "quotes", key: null, title: "attention is the rarest and purest form of generosity." },
    ].map((hit) => ({ input: { hit }, output: find.alreadyShelved(ITEMS, hit) })),
  });
}

// ═══ LISTS ═══════════════════════════════════════════════════════════════════
{
  const NOW = "2026-01-01T00:00:00.000Z";
  const op = (name, args, fn) => ({ input: { op: name, ...args }, output: fn() });
  const ops = [];
  for (const [id, name] of [["l-outfit", "  Porto "], ["l-outfit", "   "], ["nope", "Porto"], ["l-outfit", "Autumn outfit"], ["l-lisbon", "y".repeat(90)], ["l-weekend", "Trip\n\n to \t Porto"]]) {
    ops.push(op("rename", { id, name }, () => lists.renameList(BOARDS, id, name)));
  }
  for (const id of ["l-outfit", "nope", "l-empty"]) ops.push(op("remove", { id }, () => lists.removeList(BOARDS, id)));
  for (const [id, view] of [["l-outfit", "rows"], ["l-outfit", "grid"], ["l-outfit", "pictures"], ["nope", "rows"], ["l-lisbon", "pictures"]]) {
    ops.push(op("setView", { id, view }, () => lists.setView(BOARDS, id, view)));
  }
  for (const [id, query] of [["l-outfit", "  peckham "], ["l-lisbon", ""], ["l-lisbon", "   "], ["l-lisbon", null], ["l-lisbon", "lisbon"], ["l-outfit", ""], ["nope", "x"], ["l-lisbon", " lisbon "]]) {
    ops.push(op("setQuery", { id, query }, () => lists.setQuery(BOARDS, id, query)));
  }
  for (const [id, itemId] of [["l-outfit", "m1"], ["l-outfit", "w1"], ["nope", "w1"], ["l-outfit", ""], ["l-empty", "u1"], ["l-mix", "p3"]]) {
    ops.push(op("pin", { id, itemId }, () => lists.pin(BOARDS, id, itemId)));
    ops.push(op("unpin", { id, itemId }, () => lists.unpin(BOARDS, id, itemId)));
    ops.push(op("togglePin", { id, itemId }, () => lists.togglePin(BOARDS, id, itemId)));
  }
  for (const [id, itemId, toIndex] of [["l-weekend", "b1", 0], ["l-weekend", "r1", 2], ["l-weekend", "r1", 1], ["l-weekend", "r1", 99], ["l-weekend", "b1", -5],
    ["l-weekend", "m1", 1], ["l-weekend", "r1", -5], ["l-weekend", "b1", 99], ["l-weekend", "zz", 0], ["nope", "b1", 0], ["l-outfit", "n1", 4], ["l-outfit", "b1", 1], ["l-mix", "p3", 3], ["l-empty", "x", 0]]) {
    ops.push(op("movePin", { id, itemId, toIndex }, () => lists.movePin(BOARDS, id, itemId, toIndex)));
  }
  ops.push(op("prune", {}, () => lists.prune(BOARDS, ITEMS)));
  ops.push(op("prune", { keep: ["w1", "b1"] }, () => lists.prune(BOARDS, ITEMS.filter((x) => ["w1", "b1"].includes(x.id)))));

  const NAMES = ["  Lisbon   trip ", "", "   \n ", "x".repeat(80), "   " + "x".repeat(60), "a".repeat(59) + "😀" + "b", "a".repeat(59) + " bbb",
    "a".repeat(58) + "👨‍👩‍👧 family", "a".repeat(59) + "éx", "Trip\tto Porto", "東京 2027", "a".repeat(58) + "🇬🇧 flag"];
  const LOCALES = ["en-GB", "en-US", "de-DE"];
  const AMOUNTS = [0, 12, 12.5, 1234.5, 83, 65.5, 20, 1299, 0.3, 0.125, 1.005, 999.995, 1000000.01, 349.5, 12000, 1.5, 0.001, 0.004, 99.999, 5e-7];
  const CODES = ["GBP", "USD", "EUR", "JPY", "KWD", "BHD", "CHF", "INR", "CNY", "KRW", "ISK", "CLP", "HUF", "VND", "TND", "JOD", "OMR", "AUD", "CAD", "NZD", "SEK", "NOK",
    "DKK", "PLN", "CZK", "BRL", "MXN", "ZAR", "TRY", "ILS", "AED", "SAR", "HKD", "SGD", "THB", "IDR", "TWD", "XAF", "UGX"];
  const priceText = [];
  for (const locale of LOCALES) for (const currency of ["GBP", "USD", "EUR", "JPY", "KWD"]) for (const amount of AMOUNTS) {
    priceText.push({ input: { amount, currency, locale }, output: lists.priceText(amount, currency, { locale }) });
  }
  // Every currency's own smallest unit and its en-GB sign: 12.5 shows the
  // fraction digits, 1234 shows the grouping and no ".00".
  for (const currency of CODES) for (const amount of [12.5, 1234]) priceText.push({ input: { amount, currency, locale: "en-GB" }, output: lists.priceText(amount, currency, { locale: "en-GB" }) });
  // EVERY code whose smallest unit is not a hundredth, found by asking Intl about
  // all 17,576 three-letter codes. Swift pins this table (macOS's own ICU says 0
  // for HUF and IDR where Node says 2), so the table is checked code by code.
  {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A) for (const b of A) for (const c of A) {
      const currency = a + b + c;
      const d = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      if (d !== 2) priceText.push({ input: { amount: 1.23456, currency, locale: "en-GB", digitsOnly: true }, output: lists.priceText(1.23456, currency, { locale: "en-GB" }) });
    }
  }
  // A code Intl refuses: the catch in priceText answers, with the code and the number.
  for (const [amount, currency] of [[12.5, "£"], [12, "POUNDS"], [0.125, "??"], [1234.5, ""]]) {
    priceText.push({ input: { amount, currency, locale: "en-GB" }, output: lists.priceText(amount, currency, { locale: "en-GB" }) });
  }

  const priced = (price, currency, id) => item({ id, list: "wishlist", title: id, canonical: { price, currency } });
  const RUNS = {
    all: ITEMS,
    none: [],
    floats: [priced(0.1, "GBP", "k"), priced(0.2, "GBP", "c")],
    fils: [priced(0.001, "KWD", "a"), priced(0.002, "KWD", "b")],
    tie: [priced(10, "USD", "u"), priced(10, "EUR", "e")],
    whole: [priced(120, "GBP", "a"), priced(80, "GBP", "b")],
    cases: [priced(5, "gbp", "a"), priced(7, " GBP ", "b")],
    free: [priced(0, "GBP", "a")],
    yen: [priced(1200.4, "JPY", "a"), priced(0.4, "JPY", "b"), priced(99.5, "JPY", "c")],
    bad: [priced(-1, "GBP", "a"), priced("12.50", "GBP", "b"), priced(12, "£", "c"), priced(12, "POUNDS", "d"), priced(12, 826, "e"), priced(12, null, "f"), priced(null, "GBP", "g"), priced(3, "gBp", "h")],
    three: [priced(19.99, "GBP", "a"), priced(0.01, "GBP", "b"), priced(63.01, "GBP", "c"), priced(1299, "EUR", "d"), priced(20, "USD", "e")],
  };
  for (const key of LIST_KEYS) RUNS[`shelf:${key}`] = ITEMS.filter((x) => x.list === key);

  write("golden-lists.json", {
    items: ITEMS,
    boards: BOARDS,
    runs: RUNS,
    nameMax: lists.NAME_MAX,
    views: lists.VIEWS,
    makeList: NAMES.map((name, i) => ({ input: { name, id: `l${i}`, now: NOW }, output: lists.makeList(name, { id: `l${i}`, now: NOW }) })),
    ops,
    itemsOf: BOARDS.map((b) => ({ input: { id: b.id }, output: idsOf(lists.itemsOf(b, ITEMS)) })),
    listsWith: [...ITEMS.map((x) => x.id), "gone", ""].map((itemId) => ({ input: { itemId }, output: idsOf(lists.listsWith(BOARDS, itemId)) })),
    priceOf: [...ITEMS, ...RUNS.bad].map((it, i) => ({ input: { run: i < ITEMS.length ? "all" : "bad", id: it.id }, output: lists.priceOf(it) })),
    priceOn: LOCALES.flatMap((locale) => ITEMS.map((it) => ({ input: { id: it.id, locale }, output: lists.priceOn(it, { locale }) }))),
    priceText,
    shelfTotal: LOCALES.flatMap((locale) => Object.keys(RUNS).map((run) => ({ input: { run, locale }, output: lists.shelfTotal(RUNS[run], { locale }) }))),
    totalOf: LOCALES.flatMap((locale) => BOARDS.map((b) => ({ input: { id: b.id, locale }, output: lists.totalOf(b, ITEMS, { locale }) }))),
  });
}
