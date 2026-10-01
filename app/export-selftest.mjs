// export-selftest.mjs — the two files a person leaves with.
//
// What is defended here is not layout. It is three promises:
//
//   NOTHING IS LEFT BEHIND   the JSON gives back every item exactly as held.
//   NOTHING RUNS             the HTML is opened from disk, by a person who
//                            trusts it because it is theirs — and every string
//                            in it was written by somebody else. A note that
//                            says <script> must arrive as text.
//   NOTHING LEAKS            a link's code is the only key that revokes it, so
//                            it does not travel in a file that gets emailed.
import { exportJson, exportHtml, exportFilename, esc, EXPORT_FORMAT, EXPORT_VERSION } from "./src/export.js";
import * as D from "./src/design.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

// Local constructor, and the zone PINNED to one that is not UTC: on a runner in
// UTC a filename built from the UTC date would pass, and be yesterday's on a
// phone in the small hours.
process.env.TZ = "Asia/Kolkata";
const NOW = new Date(2026, 9, 1, 13, 0);
const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const item = (id, list, title, extra = {}) => ({
  id, list, status: "filed", title, subtitle: "", note: "", image_url: null, canonical: {},
  confidence: 0.9, enriched: true, source_url: null, resolver: "test", created_at: at(2026, 3, 2), ...extra,
});

const ARTICLE = "First paragraph of the saved piece.\n\nSecond paragraph, which outlives the link.";
const items = [
  item("b1", "books", "Piranesi", { subtitle: "Susanna Clarke · 2020", note: "The House is <b>kind</b> & vast",
    image_url: "https://covers.example/piranesi.jpg", source_url: "https://www.instagram.com/reel/abc/",
    caption: "5 books I read this month", canonical: { author: "Susanna Clarke", year: 2020, pages: 272, first_sentence: "When the Moon rose" } }),
  item("r1", "restaurants", "St. John", { canonical: { lat: 51.5203, lng: -0.1027, city: "London", address: "26 St John St",
    opening_hours: "Mo-Sa 12:00-23:00", cuisine: ["British"], website: "https://stjohnrestaurant.com", phone: "+44 20 7251 0848" } }),
  item("m1", "movies", "Sinners", { canonical: { runtime_min: 137, rating: 7.6, overview: "Twin brothers return home." } }),
  item("c1", "recipes", "Dal", { canonical: { total_time: "40 min", recipe_url: "https://food.example/dal" } }),
  item("q1", "quotes", "The trouble with the rat race is that even if you win, you're still a rat.", { canonical: { author: "Lily Tomlin" } }),
  item("p1", "places", "Book Bar", { canonical: { city: "London", located: false } }),
  item("a1", "unsorted", "A long read", { source_url: "https://example.com/long-read",
    canonical: { article: { text: ARTICLE, byline: "A. Writer", siteName: "The Paper" }, ocr_text: "words read off a screenshot" } }),
  { ...item("u1", "unsorted", null, { source_url: "https://www.instagram.com/reel/zzz/" }), status: "unread", error: "could not read it" },
];
const shelf = {
  version: 1,
  items,
  profile: { name: "Suren", bio: "Reads on trains", seed: "suren", home_city: "London" },
  links: [{ code: "k7m2pq9x", kind: "shelf", target: "books", title: "Books", at: at(2026, 9, 1), revoke_secret: "s3cr3t-token" }],
};
const shelves = D.LIST_KEYS.filter((k) => k !== "unsorted");
for (const k of D.LIST_KEYS) ok(items.some((i) => i.list === k), `the fixtures have nothing on ${k}`);

// ── JSON: everything, exactly ───────────────────────────────────────────────
const before = JSON.stringify(shelf);
const json = exportJson(shelf, { now: NOW });
const back = JSON.parse(json);
ok(back.format === EXPORT_FORMAT && back.format === "shelf-export", "the file names its own format", back.format);
ok(back.version === EXPORT_VERSION && back.version === 1, "…and its version", back.version);
ok(back.exported_at === NOW.toISOString(), "exported_at is the time it was GIVEN", back.exported_at);
ok(back.items.length === items.length, "every item is in the file, filed or not", back.items.length);
items.forEach((it, i) => ok(JSON.stringify(back.items[i]) === JSON.stringify(it), `${it.id} did not round-trip byte for byte`, back.items[i]));
ok(back.items[6].canonical?.article?.text === ARTICLE, "the saved article text travels");
ok(back.items[6].canonical?.ocr_text === "words read off a screenshot", "…and the text read off a screenshot");
ok(back.items[0].note === items[0].note && back.items[0].caption === items[0].caption, "notes and captions travel");
ok(JSON.stringify(back.profile) === JSON.stringify(shelf.profile), "the profile travels", back.profile);
ok(json.includes('\n  "items": [\n    {'), "pretty-printed, so a person can read it and a diff can show it");
ok(JSON.stringify(shelf) === before, "exporting must not change the shelf it was handed");
ok(exportJson(shelf, { now: NOW }) === json, "same shelf, same moment, same bytes");

// THE LINK CODE IS THE REVOKE KEY. It stays on the phone.
ok(!json.includes("k7m2pq9x"), "a published link's code is in the export — whoever holds the file can delete the page");
ok(!json.includes("s3cr3t-token") && !json.includes("revoke_secret"), "a field nobody named travelled out of `links`");
ok(JSON.stringify(back.links) === JSON.stringify([{ kind: "shelf", target: "books", title: "Books", at: at(2026, 9, 1) }]),
   "what is kept is the record that a link was made", back.links);

// A forgotten argument must not be the thing that stops somebody leaving.
ok(JSON.parse(exportJson(shelf)).exported_at === null && JSON.parse(exportJson(shelf)).items.length === items.length,
   "no clock: exported_at is null, and the items still come out");
for (const junk of [null, undefined, {}, { items: null, links: null, profile: null }, "x"]) {
  const j = JSON.parse(exportJson(junk, { now: NOW }));
  ok(Array.isArray(j.items) && j.items.length === 0 && Array.isArray(j.links), `a shelf of ${JSON.stringify(junk)} still exports`, j);
}

// ── HTML: readable, whole, and inert ────────────────────────────────────────
const html = exportHtml(shelf, { now: NOW });
// An `on…=` ATTRIBUTE, on a real tag. The same letters inside a quoted value or
// as escaped text are just words, and matching them made this fire on a safe
// page — so quoted values are emptied before looking.
const handler = (h) => [...h.matchAll(/<[a-z][^>]*>/gi)].some((m) => /\son[a-z]+\s*=/i.test(m[0].replace(/"[^"]*"/g, '""')));

// In shelf order, every shelf that holds something, by the name derived from
// LIST_KEYS — and the items under the right one.
const heads = D.LIST_KEYS.map((k) => html.indexOf(`<h2>${k === "unsorted" ? "Not shelved" : k[0].toUpperCase() + k.slice(1)}</h2>`));
ok(heads.every((i) => i > 0), "a shelf with something on it has no heading", heads);
ok(heads.every((i, n) => n === 0 || i > heads[n - 1]), "the shelves are not in LIST_KEYS order", heads);
shelves.forEach((k, n) => {
  const title = esc(items.find((i) => i.list === k).title);
  const pos = html.indexOf(`<h3>${title}</h3>`);
  ok(pos > heads[n] && pos < heads[n + 1], `the ${k} item is not under the ${k} heading`, pos);
  ok(html.includes(`--${k}:${D.light[k]}`), `the page has no colour for ${k}`);
});
ok(!exportHtml({ items: [items[0]] }, { now: NOW }).includes("<h2>Movies</h2>"), "an empty shelf gets no heading in an archive");
ok(html.indexOf("<h3>Wrong shelf</h3>") === -1
   && exportHtml({ items: [item("x", "gadgets", "Wrong shelf")] }, { now: NOW }).includes("<h2>Not shelved</h2>"),
   "an item on a shelf that does not exist is still printed, under Not shelved");

// What each row carries.
ok(html.includes("Susanna Clarke · 2020"), "the subtitle");
ok(html.includes("<dt>Author</dt><dd>Susanna Clarke</dd>") && html.includes("<dt>Address</dt><dd>26 St John St</dd>"), "the facts rows, from factsFor");
ok(html.includes("“When the Moon rose”") && html.includes("Twin brothers return home."), "the lede");
ok(html.includes("Saved 2 Mar 2026"), "the day it was saved");
ok(html.includes('<a href="https://www.instagram.com/reel/abc/" rel="nofollow noopener">Where this came from</a>'), "the source link");
ok(html.includes('href="https://stjohnrestaurant.com"') && html.includes('href="https://food.example/dal"'), "the catalogue's links");
ok(html.includes("https://www.google.com/maps/search/"), "a map link that opens on anything, not geo: or Apple's");
ok(html.includes("Call +44") && !/href="tel:/.test(html), "a phone number is printed, not linked");
ok(html.includes("First paragraph of the saved piece.\n\nSecond paragraph, which outlives the link."), "an article's saved text is IN the file");
ok(html.includes("A. Writer · The Paper"), "…with who wrote it");
ok(exportHtml({ items: [item("s", "unsorted", "Plain", { canonical: { article: "just the text" } })] }, { now: NOW }).includes("just the text"),
   "an article held as a bare string is printed too");
ok(html.includes("<h3>Untitled</h3>") && html.includes("Not read yet"), "an unresolved save is still in the archive, and says what it is");
ok(html.includes('<h1 class="name">Suren</h1>') && html.includes("Reads on trains"), "whose shelf it is");
ok(html.includes("8 things · exported 1 Oct 2026"), "how much, and when", html.match(/\d+ things[^<]*/)?.[0]);
ok(html.includes('<img src="https://covers.example/piranesi.jpg" alt="Piranesi"'), "a cover carries the title as alt, so the row reads when the image rots");
ok(!html.includes("k7m2pq9x"), "a link code reached the page");

// ONE FILE. No script, nothing fetched but covers.
ok(!/<script/i.test(html), "the archive contains a script");
ok(!/<link\b|@import|url\(|@font-face|<iframe|<object|<embed|<form/i.test(html), "the archive fetches or embeds something besides a cover");
ok(!handler(html), "an inline event handler is a script by another name");
ok([...html.matchAll(/\ssrc=/g)].length === [...html.matchAll(/<img src=/g)].length, "something other than an <img> has a src");
ok(html.startsWith("<!doctype html>") && html.includes('<meta charset="utf-8">'), "a browser must be told the encoding, or every “ and · is mojibake");

// Light and dark, from the app's palettes, and not one rounded corner.
ok(html.includes(`--paper:${D.light.bg}`) && html.includes(`--ink:${D.light.ink}`), "the page is not painted from the light palette");
ok(new RegExp(`prefers-color-scheme: dark\\)\\{ :root\\{ --paper:${D.dark.bg}; --sunk:${D.dark.surfaceSunk}; --ink:${D.dark.ink}`).test(html), "no dark scheme from the dark palette");
ok(html.includes("border-radius:0") && [...html.matchAll(/border-radius:\s*([^;}]+)/g)].every((m) => m[1] === "0"), "a corner is rounded");
const loose = [...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toUpperCase());
const palette = new Set([...Object.values(D.light), ...Object.values(D.dark), ...Object.values(D.listOn)]);
ok(loose.length > 0 && loose.every((h) => palette.has(h)), "a colour that is not in design.js", loose.filter((h) => !palette.has(h)));

// ── EVERY STRING IS SOMEBODY ELSE'S ─────────────────────────────────────────
ok(html.includes("The House is &lt;b&gt;kind&lt;/b&gt; &amp; vast"), "a note's markup arrives as text", html.match(/The House[^\n]*/)?.[0]);
const XSS = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
const nasty = {
  profile: { name: XSS, bio: XSS },
  items: [
    item("n1", "books", XSS, { subtitle: XSS, note: XSS, image_url: "https://img.example/a.jpg",
      canonical: { author: XSS, first_sentence: XSS, subjects: [XSS], article: { text: XSS, byline: XSS, siteName: XSS } } }),
    item("n2", "restaurants", "Cafe", { canonical: { address: XSS, opening_hours: XSS, cuisine: [XSS], phone: XSS, website: `https://x.example/${XSS}` } }),
    item("n3", "movies", "Film", { canonical: { overview: XSS, genres: [XSS], cast: [XSS], streaming: [XSS], watch_url: "https://watch.example/" } }),
    item("n4", "gadgets<script>", XSS, { status: XSS, created_at: XSS }),
  ],
};
const bad = exportHtml(nasty, { now: NOW });
ok(!/<script/i.test(bad), "a <script> in a title, note, fact or profile reached the page as markup");
ok(!/<img src=x/i.test(bad) && !handler(bad), "an injected tag or handler reached the page");
ok([...bad.matchAll(/<img /g)].length === 1, "the only <img> is the one real cover", [...bad.matchAll(/<img /g)].length);
ok(bad.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "…and it is still there to read, as text");
ok(bad.includes('alt="&quot;&gt;&lt;script&gt;'), "a quote in a title cannot close the alt attribute");
ok(esc(`<a href="x" title='y'>&`) === "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;", "esc covers all five", esc(`<a href="x" title='y'>&`));

// A URL reaches an href or a src only if it is http(s). Every item below has
// its ONLY links in the field under test, so the right answer is no href and
// no src at all.
for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "javascript:alert('https://ok.example/')",
  "data:text/html,<script>x</script>", "file:///etc/passwd", "vbscript:x", "//evil.example/x", "geo:51.5,-0.1", "https://ok.example/a b"]) {
  const out = exportHtml({ items: [
    item("u", "recipes", "T", { image_url: url, source_url: url, canonical: { recipe_url: url } }),
    item("v", "books", "B", { canonical: { read_url: url } }),
    item("w", "movies", "M", { canonical: { trailer_url: url, watch_url: url } }),
  ] }, { now: NOW });
  const attrs = [...out.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  ok(attrs.length === 0, `"${url}" reached an href or src`, attrs);
}
const quoted = exportHtml({ items: [item("z", "books", "T", { image_url: `https://x.example/a.jpg"onerror="alert(1)`, source_url: `https://x.example/?a="><script>`,
  canonical: { read_url: `https://x.example/"onmouseover="alert(1)` } })] }, { now: NOW });
ok(!/<script/i.test(quoted) && !handler(quoted) && !/"on[a-z]+="/.test(quoted), "a quote inside an https URL broke out of its attribute");
ok([...quoted.matchAll(/\s(?:href|src)="/g)].length === 3, "…and all three are still links, escaped rather than dropped", [...quoted.matchAll(/\s(?:href|src)="/g)].length);
ok(/^http:/.test("http://plain.example/") && exportHtml({ items: [item("h", "books", "T", { source_url: "http://plain.example/" })] }, { now: NOW }).includes('href="http://plain.example/"'),
   "plain http is a real link and is kept");

// ── rubbish in ──────────────────────────────────────────────────────────────
for (const junk of [null, undefined, {}, { items: null }, { items: [null, 7, "x"] }]) {
  const out = exportHtml(junk, { now: NOW });
  ok(out.includes("Nothing on this shelf yet.") && out.includes("0 things"), `a shelf of ${JSON.stringify(junk)} is still a page`);
}
ok(exportHtml(shelf).includes("8 things</p>"), "no clock: the page is written without a date rather than not written");
ok(exportHtml(shelf, { now: NOW }) === html, "same shelf, same moment, same page");

// ── the filename ────────────────────────────────────────────────────────────
ok(exportFilename("json", NOW) === "shelf-2026-10-01.json", "json filename", exportFilename("json", NOW));
ok(exportFilename("html", NOW) === "shelf-2026-10-01.html", "html filename", exportFilename("html", NOW));
ok(exportFilename("json", new Date(2026, 0, 5, 0, 30)) === "shelf-2026-01-05.json", "the LOCAL day, zero-padded — half past midnight is still today",
   exportFilename("json", new Date(2026, 0, 5, 0, 30)));
ok(exportFilename("../../etc/passwd", NOW) === "shelf-2026-10-01.json", "the kind is one of two, never a path", exportFilename("../../etc/passwd", NOW));
ok(exportFilename("html", null) === "shelf.html", "no clock: still a filename");
ok(NOW.getTimezoneOffset() === -330, "the zone pin did not take, so the local-day line above proves nothing", NOW.getTimezoneOffset());

console.log(fail ? `export selftest FAILED (${fail})` : "export selftest ok");
process.exit(fail ? 1 : 0);
