// store.mjs — golden files for Store.swift, Drain.swift and API.swift.
//
// PARITY IS PROVEN, NOT CLAIMED (swift/PLAN.md, rule 2). This runs the REAL
// JavaScript — app/src/store.ts bundled against the in-memory file system the
// store selftest uses, app/src/resume.js, and the server's own route functions
// — and writes its answers down. The Swift tests run the port over the same
// inputs and must give the same answers.
//
//   node swift/tools/golden/store.mjs
//
// Writes swift/Core/Tests/ShelfCoreTests/Fixtures/store-*.json and api-*.json.
// Deterministic: every date is fixed, so a second run changes nothing.
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = (p) => fileURLToPath(new URL("../../../" + p, import.meta.url));
const { build } = await import(root("app/node_modules/esbuild/lib/main.js"));

const bundle = join(mkdtempSync(join(tmpdir(), "shelf-golden-")), "store.mjs");
await build({
  entryPoints: [root("app/src/store.ts")],
  bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "silent",
  alias: { "expo-file-system": root("app/preview/fakeFs.js") },
});
const S = await import(bundle);
const fs = globalThis.__fs;
const { resumePlan, whyStopped } = await import(root("app/src/resume.js"));
const { LIST_KEYS } = await import(root("app/src/design.js"));

const OUT = root("swift/Core/Tests/ShelfCoreTests/Fixtures/");
mkdirSync(OUT, { recursive: true });
const write = (name, value) =>
  writeFileSync(OUT + name, typeof value === "string" ? value : JSON.stringify(value, null, 1) + "\n");

// ── 1. ids ───────────────────────────────────────────────────────────────────
// Two 32-bit hashes over UTF-16 CODE UNITS. The seeds below are chosen to
// separate a port that walks code units from one that walks bytes, characters
// or scalars: accents, CJK, an emoji (a surrogate pair), a family emoji (many
// pairs and joiners), a combining mark.
const seeds = [
  "a", "ab", "abc", "shelf", " ", "0", "null", "#",
  "https://www.instagram.com/reel/C8xYz12AbCd/",
  "https://www.instagram.com/p/DAbCdEfGhIj/?igsh=MTIzNDU2Nzg5",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.reddit.com/r/books/comments/1abcde/piranesi/",
  "https://paulgraham.com/greatwork.html",
  "https://www.theguardian.com/books/2020/sep/17/piranesi-by-susanna-clarke-review",
  "https://shop.example/overshirt?colour=navy&size=m",
  "https://www.instagram.com/reel/C8xYz12AbCd/#Piranesi",
  "https://www.instagram.com/reel/C8xYz12AbCd/#null",
  "file:///private/var/mobile/Containers/Shared/AppGroup/1234/queue/images/IMG_0042.PNG",
  "1727863200000-1a2b3c4d.png",
  "books:/works/OL20893680W",
  "movies:movie/27205",
  "restaurants:ChIJdd4hrwug2EcRmSrV3Vo6llI",
  "places:node/123456789",
  "café", "Café de Flore", "naïve façade", "Zoë", "São Paulo", "Malmö", "Kraków", "İstanbul",
  "東京", "東京都渋谷区", "서울", "Москва", "القاهرة", "ירושלים", "ไทย", "हिन्दी",
  "📚", "📚✨ ugh this one", "👨‍👩‍👧‍👦", "🇬🇧", "é", "é", "a\u0000b", "tab\there", "line\nbreak",
  "The quick brown fox jumps over the lazy dog",
  "x".repeat(1000),
  "ÿ".repeat(257),
  "😀".repeat(64),
  "A } brace { in [ the ] \"title\" \\",
  "constructor", "__proto__", "toString",
  "https://例え.jp/パス?クエリ=値",
  "\uD83D", // a lone surrogate: JS hashes the unit; Swift cannot hold one, see the test
];
write("store-ids.json", seeds.filter((s) => s !== "\uD83D").map((seed) => ({ seed, id: S.idFor(seed) })));

// ── 2. THE FILE, written by the real save() ──────────────────────────────────
// Every shape the Expo app really writes: a pending row exactly as drainShares
// makes it (no resolved_at, no error, no caption), the same row after a failed
// read, after an empty read, and after a good one (error: null, checked), a
// note as NoteWriter makes it, a kept picture, top: true AND top: false — and a
// key from the future at every level.
const AT = "2026-08-01T09:30:00.000Z";
const pending = (url, list, at = AT) => ({
  id: S.idFor(url), list, status: "pending", title: null, subtitle: "", note: "", image_url: null,
  canonical: {}, confidence: null, enriched: false, source_url: url, resolver: null, created_at: at,
});
const resolved = (over) => ({
  list: "unsorted", title: null, subtitle: "", note: "", image_url: null, canonical: {}, confidence: null,
  enriched: false, source_url: null, resolver: "crawler-embed-html", checked: null, caption: "", ...over,
});
const filed = (url, first, extra = {}) => ({
  ...pending(url, first.list), ...first, status: "filed",
  caption: ["places", "quotes"].includes(first.list) ? (first.caption || "").slice(0, 4000) : undefined,
  resolved_at: "2026-08-01T09:30:07.412Z", error: null, ...extra,
});
const article = {
  byline: "Paul Graham", siteName: "paulgraham.com", text: "If you collected lists of techniques…\n\n“Quoted” — and a \\ backslash.",
  readingMinutes: 47, excerpt: "If you collected lists of techniques", hero: null, summary: "Work on what you are curious about.",
};

let shelf = S.emptyShelf();
const add = (it) => { shelf = S.upsert(shelf, it); };

add(filed("https://www.instagram.com/reel/book1/", resolved({
  list: "books", title: "Piranesi", subtitle: "Susanna Clarke", note: "The House is beautiful.",
  image_url: "https://covers.openlibrary.org/b/id/10520611-L.jpg", confidence: 0.93, enriched: true, checked: "confirmed",
  canonical: { openlibrary_key: "/works/OL20893680W", isbn: "9781635575637", year: 2020, rating: 4.21, ratings_count: 284113,
               subjects: ["Fantasy", "Fiction", "Labyrinths"], author: "Susanna Clarke", pages: null,
               article, future_canonical: { nested: [1, 2.5, null, true, "x", { deep: [] }] } },
}), { top: true, future_item: { a: [1, 2.5, null, false], b: "kept" } }));
add(filed("https://www.instagram.com/reel/food1/", resolved({
  list: "restaurants", title: "Ganapati", subtitle: "South Indian · Peckham", confidence: 0.8, enriched: true,
  canonical: { place_id: "ChIJdd4hrwug2EcRmSrV3Vo6llI", lat: 51.4689, lng: -0.0679, located: true, rating: 4.6,
               price_level: 2, cuisine: "South Indian", area: "Peckham", city: "London", address: "38 Holly Grove, London SE15 5DF",
               hours: { periods: [{ open: { day: 2, time: "1200" }, close: { day: 2, time: "2230" } }], weekday_text: ["Monday: Closed"] },
               website: "https://www.ganapatirestaurant.com/", phone: "+44 20 7277 2928" },
}), { top: false }));
add(filed("https://www.instagram.com/reel/film1/", resolved({
  list: "movies", title: "Inception", subtitle: "Christopher Nolan · 2010", image_url: "https://image.tmdb.org/t/p/w500/x.jpg",
  confidence: 1, enriched: true,
  canonical: { tmdb_id: 27205, media_type: "movie", year: 2010, runtime: 148, director: "Christopher Nolan",
               cast: ["Leonardo DiCaprio", "Elliot Page"], trailer: "https://www.youtube.com/watch?v=YoHD9XEInc0", vote: 8.369 },
})));
add(filed("https://www.bbcgoodfood.com/recipes/dal", resolved({
  list: "recipes", title: "Tarka dal", subtitle: "Serves 4", resolver: "web-og", enriched: true, confidence: 0.7,
  canonical: { recipe_url: "https://www.bbcgoodfood.com/recipes/dal", yield: "4", time: "PT45M", ingredients: ["200g red lentils", "1 tsp turmeric"] },
})));
add(filed("https://www.instagram.com/p/quote1/", resolved({
  list: "quotes", title: "“The beauty of the House is immeasurable; its kindness infinite.”", subtitle: "Susanna Clarke",
  confidence: 0.6, caption: "from Piranesi 📚\n\n#books #quotes", canonical: { attribution: "Susanna Clarke", work: "Piranesi" },
})));
add(filed("https://www.instagram.com/reel/trip1/", resolved({
  list: "places", title: "Miradouro da Graça", subtitle: "Lisboa", confidence: 0.75, enriched: true,
  caption: "10 spots in Lisbon ☀️\n1. Miradouro da Graça — go at sunset\n2. Pastéis de Belém",
  canonical: { osm_type: "node", osm_id: 123456789, lat: 38.7163, lng: -9.1307, city: "Lisboa", country: "Portugal", located: true },
})));
add({ ...filed("https://www.instagram.com/reel/trip1/", resolved({
  list: "places", title: "Pastéis de Belém", subtitle: "Lisboa", confidence: 0.75, enriched: false,
  caption: "10 spots in Lisbon ☀️\n1. Miradouro da Graça — go at sunset\n2. Pastéis de Belém", canonical: {},
})), id: S.idFor("https://www.instagram.com/reel/trip1/#Pastéis de Belém") });
add(filed("https://shop.example/overshirt", resolved({
  list: "wishlist", title: "Wool overshirt", subtitle: "Northfield", image_url: "https://shop.example/a.jpg",
  confidence: 0.9, enriched: true, resolver: "web-og",
  canonical: { kind: "product", price: 65, currency: "GBP", price_text: "£65.00", brand: "Northfield", availability: "in_stock",
               seller: "Northfield", shop_url: "https://shop.example/overshirt", price_at: "2026-08-01T09:30:07.000Z" },
})));
add(filed("https://shop.example/candle", resolved({
  list: "wishlist", title: "Candle", subtitle: "", confidence: 0.9, enriched: true, resolver: "web-og",
  canonical: { kind: "product", price: 12.5, currency: "EUR", price_text: "12,50 €", brand: null, availability: null,
               seller: null, shop_url: "https://shop.example/candle", price_at: "2026-08-02T10:00:00.000Z" },
})));
// A note, exactly as NoteWriter.tsx makes one.
add({ id: "i_note0001abc", list: "notes", status: "filed", title: "Ask Maya about the flat", subtitle: "",
      note: "Ask Maya about the flat\nand the deposit — £1,200?", image_url: null, canonical: { kind: "note" }, confidence: null,
      enriched: false, source_url: null, resolver: "note", created_at: "2026-09-03T18:00:00.000Z", resolved_at: "2026-09-03T18:00:00.000Z" });
// A picture kept from the camera roll: filed, and on no shelf.
add({ id: "i_pic0001abc", list: "unsorted", status: "filed", title: null, subtitle: "", note: "",
      image_url: "file:///var/mobile/Containers/Data/Application/AAAA-BBBB/Documents/pictures/i_pic0001abc.jpg",
      canonical: { kind: "picture", width: 900, height: 1200 }, confidence: null, enriched: false, source_url: null,
      resolver: "picture", created_at: "2026-09-04T08:00:00.000Z", resolved_at: "2026-09-04T08:00:00.000Z" });
// An essay: read, and belonging to no shelf.
add(filed("https://paulgraham.com/greatwork.html", resolved({
  list: "unsorted", title: "How to Do Great Work", subtitle: "paulgraham.com", resolver: "web-og", canonical: { article },
})));
// A screenshot that was read: no source_url, text off the pixels.
add({ ...filed("file:///group/queue/images/a.png", resolved({
  list: "books", title: "The Dispossessed", subtitle: "Ursula K. Le Guin", resolver: "screenshot", confidence: 0.85, enriched: true,
  canonical: { isbn: "9780061054884", year: 1974, ocr_text: "THE DISPOSSESSED\nUrsula K. Le Guin" },
})), source_url: null });
// The three states of a row that is not on a shelf yet.
add(pending("https://www.instagram.com/reel/waiting1/", "movies", "2026-10-01T22:15:00.000Z"));
shelf = S.upsert(shelf, pending("https://www.instagram.com/reel/failed1/", "books", "2026-10-01T22:16:00.000Z"));
shelf = S.patch(shelf, S.idFor("https://www.instagram.com/reel/failed1/"), { status: "unread", error: "http 503" });
shelf = S.upsert(shelf, pending("https://www.instagram.com/reel/nameless1/", "unsorted", "2026-10-01T22:17:00.000Z"));
shelf = S.patch(shelf, S.idFor("https://www.instagram.com/reel/nameless1/"),
                { status: "unread", resolver: "crawler-embed-html", resolved_at: "2026-10-01T22:17:09.000Z" });

const pins = shelf.items.slice(0, 3).map((i) => i.id);
shelf = {
  ...shelf,
  profile: { name: "Suren", bio: "Reads on trains.", seed: "s-7f3a", home_city: "London", future_profile: { theme: "dusk" } },
  links: [
    { code: "k3x9q2", kind: "shelf", target: "books", title: "Books", at: "2026-08-10T10:00:00.000Z", future_link: 1 },
    { code: "p0m4zz", kind: "profile", target: null, title: "Suren's card", at: "2026-08-11T10:00:00.000Z" },
    { code: "i7c1aa", kind: "item", target: pins[0], title: "Piranesi", at: "2026-08-12T10:00:00.000Z" },
  ],
  boards: [
    { id: "i_board00001", name: "This weekend", pins: [pins[2], pins[0], pins[1]], query: null, view: "pictures",
      created_at: "2026-09-01T12:00:00.000Z", cover: pins[2], future_board: { sort: "manual" } },
    { id: "i_board00002", name: "Lisbon", pins: [], query: "lisbon", view: "rows", created_at: "2026-09-02T12:00:00.000Z" },
  ],
  future_top: { schema: 2, flags: ["a", "b"] },
};

fs.reset();
await S.save(shelf);
const fileText = fs.get("shelf.json");
write("store-shelf.json", fileText);
{
  const onShelves = new Set(JSON.parse(fileText).items.map((i) => i.list));
  for (const k of LIST_KEYS) if (!onShelves.has(k)) throw new Error(`the fixture has nothing on ${k}`);
  // What the real app makes of that file.
  const { shelf: read, state } = await S.load();
  if (state !== "read") throw new Error("the fixture does not read");
  write("store-views.json", {
    counts: S.countsOf(read),
    pile: S.pileOf(read).map((i) => i.id),
    shelves: Object.fromEntries(LIST_KEYS.map((k) => [k, S.shelfOf(read, k).map((i) => i.id)])),
  });
}

// ── 3. migrate: a file from before the rename and before two shelves ─────────
{
  const old = (id, list, extra = {}) => ({
    id, list, status: "filed", title: id, subtitle: "", note: "", image_url: null, canonical: {}, confidence: 1,
    enriched: true, source_url: null, resolver: "x", created_at: "2026-01-01T00:00:00.000Z", ...extra,
  });
  const before = JSON.stringify({
    version: 1,
    items: [
      old("trip", "travel"),
      old("shirt", "unsorted", { canonical: { kind: "product", price: 65, currency: "GBP" } }),
      old("jot", "unsorted", { note: "Ask Maya", canonical: { kind: "note" } }),
      old("essay", "unsorted", { canonical: { article: { text: "A long read." } } }),
      old("picture", "unsorted", { canonical: { kind: "picture" } }),
      old("novel", "books", { canonical: { kind: "product", price: 9, currency: "GBP" } }),
      old("weird", "unsorted", { canonical: { kind: "constructor" } }),
      old("ctor", "constructor"),
      old("waiting", "travel", { status: "pending", title: null }),
    ],
    profile: { name: "S", bio: "", seed: "s", home_city: "London" },
    links: [
      { code: "x", kind: "shelf", target: "travel", title: "Travel", at: "2026-01-02T00:00:00.000Z" },
      { code: "y", kind: "shelf", target: "books", title: "Books", at: "2026-01-02T00:00:00.000Z" },
      { code: "z", kind: "profile", target: null, title: "Card", at: "2026-01-02T00:00:00.000Z" },
    ],
    boards: [{ id: "l1", name: "Trip", pins: ["trip", "shirt"], query: null, view: "rows", created_at: "" }],
  });
  fs.reset();
  fs.put("shelf.json", before);
  const { shelf: read } = await S.load();
  await S.save(read);
  write("store-migrate-before.json", before);
  write("store-migrate-after.json", fs.get("shelf.json"));
}

// ── 4. salvage: what the real brace counter lifts out ────────────────────────
{
  const it = (id, extra = {}) => ({ id, list: "books", status: "filed", title: id, ...extra });
  const whole = JSON.stringify({ version: 1, items: [
    it("a"), it("b", { title: "A } brace { in the title" }), it("c", { title: "a \"quoted\" ] bracket \\" }),
    it("d", { canonical: { nested: { deep: [{ x: 1 }, { y: "}" }] } } }), it("e", { title: "東京 📚" }), it("f"),
  ], profile: {}, links: [] });
  const cases = [
    ["whole", whole],
    ...[20, 60, 100, 150, 200, 260, 330].map((n) => [`cut ${n} from the end`, whole.slice(0, whole.length - n)]),
    ["not json", "not json at all"],
    ["empty", ""],
    ["items never opens", '{"version":1,"items":'],
    ["an item with no id is not an item", '{"items":[{"title":"x"},{"id":"ok"},{"id":""},{"id":0},null,7,"s"]}'],
    ["a nested id does not count", '{"items":[{"canonical":{"id":"inner"}},{"id":"outer","canonical":{"id":"inner"}}]}'],
    ["stops at the end of the array", '{"items":[{"id":"in"}],"boards":[{"id":"board"}]}'],
    ["one bad item is one item", '{"items":[{"id":"a"},{"id":"b",,},{"id":"c"}]}'],
    ["the word items inside a string first", '{"note":"my \\"items\\" [","items":[{"id":"real"}]}'],
    ["pretty printed", JSON.stringify({ items: [it("p1"), it("p2")] }, null, 2)],
    ["a brace after an escaped quote", '{"items":[{"id":"a","title":"x \\" } y"},{"id":"b","title":"ends in a backslash \\\\"},{"id":"c"}]}'],
  ];
  write("store-salvage.json", cases.map(([label, raw]) => ({ label, raw, ids: S.salvage(raw).map((i) => i.id) })));
}

// ── 5. what load() says when the file is gone but a copy is not ──────────────
{
  const one = JSON.stringify({ version: 1, items: [{ id: "a", list: "books", status: "filed" }], profile: {}, links: [] });
  const two = JSON.stringify({ version: 1, items: [{ id: "a" }, { id: "b" }], profile: {}, links: [] });
  fs.reset(); fs.put("shelf.prev.json", one);
  const gone1 = (await S.load()).note;
  fs.reset(); fs.put("shelf.prev.json", two);
  const gone2 = (await S.load()).note;
  fs.reset(); fs.put("shelf.json", "{ this is not json");
  const bad = (await S.load()).note;
  fs.reset(); fs.put("shelf.json", '{"version":1,"items":null}');
  const notShelf = (await S.load()).note;
  write("store-notes.json", { gone1, gone2, bad, notShelf });
}

// ── 6. resume: the real resumePlan and whyStopped ────────────────────────────
{
  const link = (id, url = "https://www.instagram.com/reel/" + id) => ({ id, status: "pending", source_url: url, title: null });
  const shot = (id) => ({ id, status: "pending", source_url: null, title: null });
  const sets = {
    mixed: [link("a"), shot("b"), { id: "c", status: "filed", source_url: "https://x/c", title: "A thing" },
            { id: "d", status: "unread", source_url: "https://x/d", title: null }, link("e")],
    many: Array.from({ length: 20 }, (_, i) => link("i" + i)),
    odd: [link("upper", "HTTPS://EXAMPLE.COM/x"), link("http", "http://example.com"), link("file", "file:///var/tmp/x.jpg"),
          link("word", "not a url"), link("ftp", "ftp://example.com"), link("inside", "see https://example.com"),
          link("empty", ""), shot("none")],
    none: [],
  };
  const plan = (items, opts) => {
    const p = resumePlan(items, opts);
    return { pending: p.pending.map((i) => i.id), retry: p.retry.map((i) => i.id), giveUp: p.giveUp.map((i) => i.id),
             why: Object.fromEntries(p.giveUp.map((i) => [i.id, whyStopped(i)])) };
  };
  write("store-resume.json", {
    cases: [
      { name: "mixed", items: sets.mixed, max: 6, plan: plan(sets.mixed) },
      { name: "many", items: sets.many, max: 6, plan: plan(sets.many, { max: 6 }) },
      { name: "many, two at a time", items: sets.many, max: 2, plan: plan(sets.many, { max: 2 }) },
      { name: "odd", items: sets.odd, max: 6, plan: plan(sets.odd) },
      { name: "none", items: sets.none, max: 6, plan: plan(sets.none) },
    ],
    whyLink: whyStopped(link("a")),
    whyShot: whyStopped(shot("b")),
  });
}

// ── 7. the server's answers, from the server's own code ──────────────────────
// Both resolve routes run WHOLE with the network swapped out, the way
// api/resolveRoute.js's own selftest runs them, so these are the bytes a phone
// receives and not a description of them.
{
  const R = await import(root("api/resolveRoute.js"));
  const { result } = await import(root("api/search.js"));
  const fakeRes = () => ({ writeHead(s) { this.status = s; }, end(b) { this.text = b; } });
  const p = "A sentence long enough to count as a real paragraph of prose, written out in full to be sure. ";
  const page = `<html><head><meta property="og:site_name" content="Field Notes"></head><body><article>${`<p>${p}</p>`.repeat(8)}</article></body></html>`;
  const web = { caption: "Two books: One and Two", via: "web-og", html: page, imageUrl: "https://fieldnotes.example/og.jpg", outboundUrls: [] };
  const io = {
    resolveShare: async () => web,
    imageBlock: async () => null,
    classifyShare: async () => [{ list: "books", title: "One", subtitle: "A. Writer", note: "The one to start with.", confidence: 0.9 },
                                { list: "books", title: "Two", confidence: 0.55, checked: "corrected" }],
    verifyItems: async (items) => items,
    enrich: async (it) => (it.title === "One"
      ? { ...it, enriched: true, image_url: "https://covers.example/one.jpg", canonical: { isbn: "978", year: 2020, rating: 4.21 } }
      : { ...it, enriched: false, canonical: {} }),
    articleFor: R.articleFor,
    extractProduct: () => null,
    classifyImage: async () => ({ items: [{ list: "movies", title: "Inception", subtitle: "2010", confidence: 0.8 }], ocr_text: "INCEPTION\nIn cinemas July 16" }),
  };
  const run = async (route, body, over = {}) => { const r = fakeRes(); await route({}, r, body, null, { ...io, ...over }); return r; };

  const many = await run(R.resolveRoute, { url: "https://fieldnotes.example/x", list: "books", home_city: "London", shelves: LIST_KEYS });
  write("api-resolve.json", many.text);
  const none = await run(R.resolveRoute, { url: "https://www.instagram.com/reel/empty1/", list: "unsorted" },
                         { resolveShare: async () => ({ caption: "", via: "crawler-embed-html", outboundUrls: [] }) });
  write("api-resolve-empty.json", none.text);
  const prod = { name: "Wool overshirt", brand: "Northfield", price: 65, currency: "GBP", priceText: "£65.00",
                 image: "https://shop.example/a.jpg", availability: "in_stock", seller: "Northfield", url: "https://shop.example/overshirt" };
  const shop = await run(R.resolveRoute, { url: "https://shop.example/overshirt", shelves: LIST_KEYS }, { extractProduct: () => prod });
  write("api-resolve-product.json", shop.text.replace(/"price_at":"[^"]*"/, '"price_at":"2026-08-01T09:30:07.000Z"'));
  const image = await run(R.resolveImageRoute, { image_b64: "AAAA", media_type: "image/png", list: "movies", shelves: LIST_KEYS });
  write("api-resolve-image.json", image.text);
  const bad = await run(R.resolveRoute, { url: "not a link" });
  if (bad.status !== 400) throw new Error("expected the route to refuse");
  write("api-error.json", bad.text);

  // search.js builds every hit through result(); the envelope is searchRoute's.
  write("api-search.json", JSON.stringify({
    ok: true,
    results: [
      result({ list: "books", key: "/works/OL20893680W", title: "Piranesi", subtitle: "Susanna Clarke · 2020",
               imageUrl: "https://covers.openlibrary.org/b/id/42-M.jpg", provider: "Open Library",
               canonical: { openlibrary_key: "/works/OL20893680W", isbn: "978", year: 2020 } }),
      result({ list: "movies", key: "movie/27205", title: "Inception", subtitle: "2010", imageUrl: null, provider: "TMDB",
               canonical: { tmdb_id: 27205, media_type: "movie" } }),
      result({ list: "places", key: "node/123456789", title: "Miradouro da Graça", subtitle: "", provider: "OpenStreetMap",
               canonical: { osm_type: "node", osm_id: 123456789, lat: 38.7163, lng: -9.1307 } }),
    ],
    unavailable: [{ list: "movies", provider: "TMDB" }],
    mode: "query",
  }));
  // api/publish.js and api/legacy.js need a database to run; these are the
  // literal objects their `json(res, 200, …)` calls send.
  write("api-publish.json", JSON.stringify({ ok: true, code: "k3x9q2", kind: "shelf" }));
  write("api-revoke.json", JSON.stringify({ ok: true, revoked: true, existed: true }));
  write("api-stats.json", JSON.stringify({ ok: true, views: { k3x9q2: 12, p0m4zz: 0 } }));
  write("api-legacy.json", JSON.stringify({ ok: true, count: 4, items: [
    { id: 11, list: "movies", status: "resolved", title: "Inception", subtitle: "2010", note: "", image_url: "https://image.tmdb.org/t/p/w500/x.jpg",
      canonical: { tmdb_id: 27205 }, confidence: 0.9, enriched: true, resolver: "crawler-embed-html",
      source_url: "https://www.instagram.com/reel/old1/", raw_caption: "watch this", created_at: "2026-03-01T10:00:00.000Z", resolved_at: "2026-03-01T10:00:05.000Z" },
    { id: 12, list: "travel", status: "resolved", title: "Lisbon", subtitle: null, note: null, image_url: null,
      canonical: null, confidence: null, enriched: false, resolver: null,
      source_url: "https://www.instagram.com/reel/old2/", raw_caption: null, created_at: "2026-03-02T10:00:00.000Z", resolved_at: null },
    { id: 13, list: "unsorted", status: "pending", title: null, subtitle: "", note: "", image_url: null,
      canonical: {}, confidence: null, enriched: false, resolver: null,
      source_url: "https://www.instagram.com/reel/old3/", raw_caption: null, created_at: "2026-03-03T10:00:00.000Z", resolved_at: null },
    { id: 14, list: "books", status: "discarded", title: "Thrown away", subtitle: "", note: "", image_url: null,
      canonical: {}, confidence: 0.5, enriched: false, resolver: "x",
      source_url: null, raw_caption: null, created_at: "2026-03-04T10:00:00.000Z", resolved_at: null },
  ] }));
  // The shelves a build says it has: every key in design.js except the pile.
  write("api-shelves.json", JSON.stringify({ shelves: LIST_KEYS.filter((k) => k !== "unsorted"), all: LIST_KEYS }));
}

console.log("golden files written to " + OUT);
