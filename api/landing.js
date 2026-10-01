// landing.js — the front door: what shelf is, said once, at `/`.
//
// Paper: file "shelf" → page "WEBSITE — landing page" (desktop 1440 and mobile
// 390). This file is that design in HTML; when they disagree, fix this.
//
// ONE argument carries the page: the things you mean to come back to are
// scattered across Instagram saves, Reddit bookmarks and a YouTube "watch
// later" nobody opens. shelf takes the THING out of the feed — the book, the
// restaurant, the film — and keeps it in one place. The four source rows are
// that argument; everything under them is supporting evidence.
//
// EVERY CLAIM HERE IS SOMETHING THE SERVICE DOES. The source rows name
// resolvers that exist in resolve.js; "kept, not linked" is article.js; "take
// a copy" is export.js. If one of those is removed, its row goes with it. A
// landing page that promises a thing the app cannot do is the fastest way to
// lose the person it just convinced.
//
// Rendered from `app/src/design.js`, like page.js and for the same reason:
// the same palette file the app imports, not a stylesheet that agrees today.
// No script, no font download, no tracker. It is a page of type.
import { isMain } from "./ismain.js";
import * as D from "../app/src/design.js";
import { esc, canonical } from "./page.js";

// The shelves, derived — a hand-written list would be wrong the next time one
// is added (see the two that already were, in HANDOVER).
const SHELVES = D.LIST_KEYS.filter((k) => k !== "unsorted");

/**
 * Where a thing comes from, and what it turns into. `shelf` names the list
 * whose colour the "you get" label takes, so the row points at the band it
 * lands on.
 */
export const SOURCES = [
  { name: "Instagram", share: "A reel or a post.",
    get: "Every book, restaurant or recipe it mentions.", shelf: "books" },
  { name: "Reddit", share: "A thread.",
    get: "The recommendations from the post and the comments.", shelf: "restaurants" },
  { name: "YouTube", share: "A video.",
    get: "The films, books and places from its description.", shelf: "movies" },
  { name: "Any link", share: "An article or a screenshot.",
    get: "The full text, saved to read later.", shelf: "recipes" },
];

// Plain words, on purpose. The first draft of this page was full of lines
// that sounded written ("Not a pile of links. The real things.") and the
// owner asked for it to read like a landing page instead: say what it does.
const LATER = [
  ["Search", "Search everything",
   "By title, author, city or your own notes. Works offline."],
  ["Tags", "Automatic tags",
   "Browse by author, neighbourhood or cuisine. No manual tagging."],
  ["Read later", "Articles saved in full",
   "Each one comes with a short summary and stays readable if the page goes away."],
  ["Share", "Share a shelf",
   "Send friends a link to your restaurant list. Turn it off any time."],
  ["Screenshots", "Clear out your screenshots",
   "Pick screenshots from your camera roll. shelf reads them and saves what is in them."],
  ["Reminders", "Old saves come back",
   "shelf shows you something you saved a year ago, or something you forgot about."],
];

/**
 * What people use it for: one plain use per shelf, keyed by the shelf so a
 * new shelf without a use case fails the selftest instead of rendering blank.
 * The second sentence only lists facts the enrichers really return (see
 * app/src/facts.js) — "where to watch" is TMDB, "opening hours" is OSM.
 */
export const USES = {
  books: ["Build a reading list", "Books from reels and threads. Each with its cover, author and year."],
  restaurants: ["Remember where to eat", "Every place a friend or a thread told you about. With the address, a map and opening hours."],
  movies: ["Pick a film for tonight", "Films and shows you heard about. With the runtime, the rating and where to watch."],
  recipes: ["Cook it later", "Recipes from videos and food sites. With the ingredients, the time and the steps."],
  quotes: ["Keep a line you liked", "The exact words, and who said them."],
  places: ["Plan a trip", "One travel reel can name ten places. You get all ten, by city, each with a map link."],
};

/**
 * Your own lists — built 2026-10-01 (app/src/lists.js, ListsScreen.tsx,
 * api/product.js). Each line is something the app does: the price is read off
 * the shop page, pictures come from the camera roll, a list adds up.
 */
export const LISTS = [
  ["Wishlists with prices", "Save clothes, make-up or anything you want to buy. shelf reads the price and adds up the list."],
  ["Moodboards", "Add pictures from your camera roll and see them side by side."],
  ["Lists for anything", "An outfit, a gift, a room, a trip. Put saved things, pictures and notes on one list."],
];

/**
 * NOT BUILT YET, AND LABELLED SO. Outlined tiles under "Coming next", so
 * nobody reads them as things the app does today. When one ships, MOVE it up
 * and delete it here; when this is empty the section is not drawn at all.
 */
export const NEXT = [
  ["Browser extension", "Save from your laptop with one click."],
];

const JACKETS = [
  { from: "From a reel", title: "Piranesi", shelf: "books", h: 232 },
  { from: "From Reddit", title: "St. John", shelf: "restaurants", h: 208 },
  { from: "From YouTube", title: "La Chimera", shelf: "movies", h: 220 },
];

// Yellow cannot carry its own colour as a 12px label on white (1.4:1), so a
// label takes the shelf colour only where that clears 4.5:1 and `warn` — the
// palette's own dark yellow — where it does not.
const labelColour = (shelf, c) => (D.contrast(c[shelf], c.bg) >= 4.5 ? c[shelf] : c.warn);

const vars = (c) => `--bg:${c.bg};--ink:${c.ink};--soft:${c.inkSoft};--line:${c.lineStrong};--good:${c.good};` +
  SHELVES.map((k) => `--${k}:${c[k]};--on-${k}:${D.listOn[k]};--label-${k}:${labelColour(k, c)};`).join("");

const CSS = `
:root{${vars(D.light)}}
@media (prefers-color-scheme:dark){:root{${vars(D.dark)}}}
*{box-sizing:border-box;margin:0;border-radius:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font-family:${D.family.sans.web};-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.in{padding-left:64px;padding-right:64px}
.micro{font-size:12px;line-height:16px;letter-spacing:.18em;font-weight:700;text-transform:uppercase}
.soft{color:var(--soft)}
.btn{display:inline-flex;align-items:center;min-height:56px;padding:0 28px;background:var(--ink);color:var(--bg);font-size:13px;letter-spacing:.18em;font-weight:700;text-transform:uppercase}
.btn.sm{min-height:48px;padding:0 20px;font-size:12px}
.btn:focus-visible,a:focus-visible{outline:3px solid var(--books);outline-offset:3px}
.rule{height:${D.RULE}px;background:var(--line)}
nav{display:flex;align-items:center;justify-content:space-between;padding-top:28px;padding-bottom:28px}
.mark{font-size:44px;line-height:48px;letter-spacing:-2.6px;font-weight:700}
nav .links{display:flex;align-items:center;gap:32px}
a.micro{display:inline-flex;align-items:center;min-height:44px}
.hero{display:flex;gap:64px;align-items:flex-end;padding-top:88px;padding-bottom:96px}
.hero .text{flex:1;min-width:0;display:flex;flex-direction:column;gap:32px}
h1,.big{font-size:clamp(88px,8vw,120px);line-height:.92;letter-spacing:-.055em;font-weight:700}
.sub{font-size:22px;line-height:32px;letter-spacing:-.2px;max-width:620px}
.acts{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.note{font-size:15px;line-height:22px;color:var(--soft)}
.case{width:468px;flex-shrink:0}
.jackets{display:flex;gap:12px;align-items:flex-end;padding:0 12px}
.jacket{flex:1;min-width:0;border:2px solid var(--line);display:flex;flex-direction:column;justify-content:space-between;padding:12px}
.jacket .from{font-size:11px;line-height:15px;letter-spacing:.12em;font-weight:700;text-transform:uppercase}
.jacket .t{font-size:20px;line-height:22px;letter-spacing:-.5px;font-weight:700}
.board{height:10px;background:var(--line)}
h2{font-size:56px;line-height:58px;letter-spacing:-2.4px;font-weight:700;max-width:900px}
.shead{display:flex;justify-content:space-between;align-items:flex-end;gap:48px;padding-bottom:28px}
.shead p{font-size:17px;line-height:25px;color:var(--soft);max-width:360px}
.src{display:flex;align-items:flex-start;gap:48px;padding-top:36px;padding-bottom:36px;border-top:${D.RULE}px solid var(--line)}
.src:last-child{border-bottom:${D.RULE}px solid var(--line)}
.src .name{width:440px;flex-shrink:0;font-size:72px;line-height:70px;letter-spacing:-3.6px;font-weight:700;text-transform:uppercase}
.src .col{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;padding-top:8px}
.src .col p{font-size:22px;line-height:30px;letter-spacing:-.2px}
.src .col p.b{font-weight:700}
.sec{padding-top:104px}
.kick{display:flex;flex-direction:column;gap:16px;padding-bottom:40px}.kick .sub{color:var(--soft)}
.spread{display:flex;gap:4px}
.cell{flex:1;min-width:0;min-height:232px;display:flex;flex-direction:column;gap:8px;padding:20px}
.cell .n{font-size:12px;line-height:16px;letter-spacing:.14em;font-weight:700;font-variant-numeric:tabular-nums;text-transform:uppercase}
.cell h3{font-size:21px;line-height:24px;letter-spacing:-.6px;font-weight:700}
.cell p{font-size:15px;line-height:21px}
.cols{display:flex;flex-wrap:wrap;gap:40px 48px;padding-top:48px}
.colx{flex:1 1 28%;min-width:0;display:flex;flex-direction:column;gap:12px;border-top:${D.RULE}px solid var(--line);padding-top:20px}
.colx h3{font-size:26px;line-height:30px;letter-spacing:-.6px;font-weight:700}
.colx p{font-size:17px;line-height:25px;color:var(--soft)}
.tiles{display:flex;flex-wrap:wrap;gap:16px}
.tile{flex:1 1 22%;min-width:220px;display:flex;flex-direction:column;gap:10px;border:2px solid var(--line);padding:24px;min-height:200px}
.tile h3{font-size:26px;line-height:30px;letter-spacing:-.6px;font-weight:700}
.tile p{font-size:17px;line-height:25px;color:var(--soft)}
.private{display:flex;gap:64px;align-items:flex-end;justify-content:space-between;background:${D.light.ink};color:#fff;padding-top:88px;padding-bottom:88px}
.private .text{display:flex;flex-direction:column;gap:20px;max-width:820px}
.private .micro{color:${D.dark.inkSoft}}
.private h2{font-size:72px;line-height:70px;letter-spacing:-3.4px;max-width:none}
.private p{font-size:20px;line-height:30px;max-width:640px}
.facts{display:flex;flex-direction:column;gap:14px;flex-shrink:0;width:320px;list-style:none;padding:0}
.facts li{display:flex;gap:12px;align-items:center;font-size:17px;line-height:25px}
.facts li:before{content:"";width:10px;height:10px;background:${D.dark.good};flex-shrink:0}
.close{display:flex;flex-direction:column;gap:32px;align-items:flex-start;padding-top:104px;padding-bottom:88px}
footer{display:flex;justify-content:space-between;align-items:center;padding-top:24px;padding-bottom:24px;border-top:${D.RULE}px solid var(--line)}
footer .mark{font-size:22px;line-height:26px;letter-spacing:-1.2px}
@media (prefers-color-scheme:dark){.private{border-top:${D.RULE}px solid var(--line);border-bottom:${D.RULE}px solid var(--line)}}
@media (max-width:1100px){
  h1,.big{font-size:88px}
  .hero{flex-direction:column;align-items:stretch}
  .case{width:auto;max-width:468px}
  .src{flex-wrap:wrap;gap:16px 48px}.src .name{width:100%}
  .cols{flex-wrap:wrap}.colx{flex:1 1 40%}
  .spread{flex-wrap:wrap}.cell{flex:1 1 30%;min-height:0}
  .private{flex-direction:column;align-items:flex-start}
}
@media (max-width:700px){
  .in{padding-left:16px;padding-right:16px}
  nav{padding-top:16px;padding-bottom:16px}
  nav .links .micro{display:none}
  .mark{font-size:36px;line-height:44px;letter-spacing:-2px}
  .btn{min-height:52px;padding:0 20px;font-size:12px}.btn.sm{min-height:44px;padding:0 16px;font-size:11px}
  .hero{gap:40px;padding-top:40px;padding-bottom:0}
  .hero .text{gap:20px}
  h1,.big{font-size:56px}
  .sub{font-size:17px;line-height:25px}
  .micro{font-size:11px}
  .case{max-width:none;margin:0 -16px}
  .jackets{gap:8px;padding:0 16px}.jacket{padding:10px}
  .jacket .t{font-size:17px;line-height:19px;letter-spacing:-.4px}.jacket .from{letter-spacing:.08em}
  .board{height:8px}
  .sec{padding-top:56px}
  h2{font-size:36px;line-height:38px;letter-spacing:-1.6px}
  .shead{flex-direction:column;align-items:flex-start;gap:12px;padding-bottom:20px}
  .src{flex-direction:column;gap:12px;padding-top:24px;padding-bottom:24px}
  .src .name{font-size:44px;line-height:44px;letter-spacing:-2.2px}
  .src .col{padding-top:0}.src .col p{font-size:17px;line-height:25px}
  .src .col.share .micro{display:none}
  .spread{flex-wrap:wrap}.cell{flex:1 1 100%;min-height:0;padding:16px}
  #how{padding-top:56px}
  .cols{flex-direction:column;flex-wrap:nowrap;gap:28px;padding-top:28px}
  .tile{flex:1 1 100%;min-height:0;padding:16px}.kick{padding-bottom:24px}
  .private{padding-top:56px;padding-bottom:56px}
  .private h2{font-size:40px;line-height:40px;letter-spacing:-1.8px}.private p{font-size:17px;line-height:25px}
  .facts{width:auto}
  .close{padding-top:56px;padding-bottom:56px}
}
`;

const OPEN = "/app/";

export function landingHtml() {
  const title = "shelf: save anything, find it later";
  const desc = "Save books, restaurants, films and articles from Instagram, Reddit, YouTube and any link. shelf sorts them for you. Free, no account.";
  const url = canonical("/");
  // Jacket heights scale down on a phone; the ratio between them is the design.
  const jackets = JACKETS.map((j) =>
    `<div class="jacket" style="background:var(--${j.shelf});color:var(--on-${j.shelf});height:clamp(${Math.round(j.h * 0.72)}px,16vw,${j.h}px)">` +
    `<div class="from">${esc(j.from)}</div><div class="t">${esc(j.title)}</div></div>`).join("");
  const sources = SOURCES.map((s) =>
    `<div class="src in"><div class="name">${esc(s.name)}</div>` +
    `<div class="col share"><div class="micro soft">You share</div><p>${esc(s.share)}</p></div>` +
    `<div class="col"><div class="micro" style="color:var(--label-${s.shelf})">You get</div><p class="b">${esc(s.get)}</p></div></div>`).join("");
  const cells = SHELVES.map((k, i) =>
    `<div class="cell" style="background:var(--${k});color:var(--on-${k})"><div class="n">${String(i + 1).padStart(2, "0")} · ${esc(k)}</div>` +
    `<h3>${esc(USES[k]?.[0] ?? k)}</h3><p>${esc(USES[k]?.[1] ?? "")}</p></div>`).join("");
  const tile = ([h, p]) => `<div class="tile"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`;
  const next = NEXT.map(tile).join("");
  const lists = LISTS.map(tile).join("");
  const later = LATER.map(([k, h, p]) =>
    `<div class="colx"><div class="micro soft">${esc(k)}</div><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">${url ? `<meta property="og:url" content="${esc(url)}"><link rel="canonical" href="${esc(url)}">` : ""}
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/app/icon.png">
<style>${CSS}</style></head><body>
<nav class="in"><a class="mark" href="/" aria-label="shelf, home">shelf</a>
<div class="links"><a class="micro soft" href="#how">How it works</a><a class="micro soft" href="#private">Private</a><a class="btn sm" href="${OPEN}">Open shelf →</a></div></nav>
<div class="rule"></div>
<main>
<section class="hero in"><div class="text">
<div class="micro soft">Works with Instagram, Reddit, YouTube and any link</div>
<h1>Save anything. Find it later.</h1>
<p class="sub">Share a reel, a Reddit thread, a YouTube video or an article to shelf. It saves the book, restaurant or film inside and sorts it for you.</p>
<div class="acts"><a class="btn" href="${OPEN}">Open shelf in your browser →</a><span class="note">Free. No account.</span></div>
</div><div class="case" aria-hidden="true"><div class="jackets">${jackets}</div><div class="board"></div></div></section>
<section id="how"><div class="shead in"><h2>Works with the apps you already use</h2>
<p>Tap Share in any app and pick shelf. That is the whole setup.</p></div>
${sources}</section>
<section class="sec"><div class="kick in"><div class="micro soft">Six shelves, sorted for you</div><h2>What people use it for</h2></div>
<div class="spread in">${cells}</div><div class="board"></div></section>
<section class="sec in"><div class="kick"><div class="micro soft">Lists</div><h2>Make your own lists</h2></div>
<div class="tiles">${lists}</div></section>
<section class="sec in"><h2>What else it does</h2><div class="cols">${later}</div></section>
${next ? `<section class="sec in"><div class="kick"><div class="micro soft">Coming next</div><h2>We are building this now</h2></div>
<div class="tiles">${next}</div></section>` : ""}
<section class="sec" id="private"><div class="private in"><div class="text"><div class="micro">Private</div>
<h2>Private by default</h2>
<p>Your shelf is stored on your device. There is no account and no sign-up. You can export everything whenever you want.</p></div>
<ul class="facts"><li>No account needed</li><li>No ads</li><li>Export any time</li></ul></div></section>
<section class="close in"><div class="big">Start your shelf</div>
<div class="acts"><a class="btn" href="${OPEN}">Open shelf in your browser →</a><span class="note">Free on the web. iPhone app in testing.</span></div></section>
</main>
<footer class="in"><span class="mark">shelf</span><a class="micro soft" href="${OPEN}">Open shelf</a></footer>
</body></html>`;
}

/** `GET /` — true when answered, null when the path is not ours (see site.js). */
export function serveLanding(req, res, url) {
  if (url.pathname !== "/" || (req.method !== "GET" && req.method !== "HEAD")) return null;
  // A share used to be able to arrive as `/?url=…` (GitHub Pages days). The app
  // owns that now; send it there rather than showing a brochure to a share.
  if (url.searchParams.get("url") || url.searchParams.get("text")) {
    res.writeHead(302, { Location: OPEN + url.search });
    res.end();
    return true;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  res.end(req.method === "HEAD" ? undefined : landingHtml());
  return true;
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let bad = 0, n = 0;
  const ok = (c, m, got) => { n++; if (!c) { bad++; console.error("FAIL", m, got ?? ""); } };
  const html = landingHtml();

  ok(!/<script/i.test(html), "no script: it is a page of type");
  ok(!/https?:\/\/(?!shelf)[^"' )]+\.(js|css|woff2?)/i.test(html), "nothing is fetched from another host");
  ok(!/border-radius:(?!0)/.test(html), "radius zero, everywhere");
  ok(!/—/.test(html), "no em dashes in the copy");
  ok(!/\p{Extended_Pictographic}/u.test(html), "no emoji");

  // THE KEY CLAIM. The three feeds are named, in this order, and each says
  // what you get.
  ok(SOURCES.slice(0, 3).map((s) => s.name).join() === "Instagram,Reddit,YouTube", "Instagram, Reddit and YouTube lead the page");
  for (const s of SOURCES) {
    ok(html.includes(esc(s.name)) && html.includes(esc(s.get)), `the page says what ${s.name} turns into`);
    ok(SHELVES.includes(s.shelf), `${s.name} points at a real shelf`, s.shelf);
  }
  // Every shelf is on the spread, derived — a seventh shelf shows up here
  // without anybody remembering to add it.
  for (const k of SHELVES) {
    ok(html.includes(`background:var(--${k})`) && html.includes(`· ${k}</div>`), `the ${k} shelf is on the spread`);
    ok(Array.isArray(USES[k]) && USES[k][0] && USES[k][1] && html.includes(esc(USES[k][0])), `the ${k} shelf says what people use it for`, USES[k]);
  }
  ok(Object.keys(USES).every((k) => SHELVES.includes(k)), "no use case for a shelf that does not exist");
  // What is not built is SAID to be not built: every "next" tile sits after
  // the words "Coming next", and none of them is repeated as a present-tense
  // use or feature.
  for (const [h, p] of LISTS) ok(html.includes(esc(h)) && html.includes(esc(p)) && html.indexOf(esc(h)) < html.indexOf("Coming next"),
    `"${h}" is on the page as a thing it does, above Coming next`);
  const cut = html.indexOf("Coming next");
  for (const [h] of NEXT) {
    ok(cut > 0 && html.indexOf(esc(h)) > cut, `"${h}" appears only under Coming next`, html.indexOf(esc(h)));
    ok(![...Object.values(USES).map((u) => u[0]), ...LATER.map((l) => l[1]), ...LISTS.map((l) => l[0])].includes(h), `"${h}" is not also claimed as built`);
  }
  ok((html.match(/class="cell"/g) || []).length === SHELVES.length, "one cell per shelf, no more");

  // A label on white must be readable: yellow is swapped for the dark yellow.
  for (const c of [D.light, D.dark]) for (const k of SHELVES) {
    ok(D.contrast(labelColour(k, c), c.bg) >= 4.5, `the ${k} label clears 4.5:1 on ${c === D.light ? "light" : "dark"} paper`, D.contrast(labelColour(k, c), c.bg));
    ok(D.contrast(D.listOn[k], c[k]) >= 4.5 || k === "movies" && D.contrast(D.listOn[k], c[k]) >= 4.5, `type on the ${k} field is readable`);
  }
  ok(/prefers-color-scheme:dark/.test(html), "dark mode is not a v2 thing");
  ok((html.match(/href="\/app\/"/g) || []).length >= 4, "every button opens the app");
  ok(/<meta name="viewport"/.test(html) && /<title>/.test(html) && /name="description"/.test(html), "a real head: viewport, title, description");

  // The route: answers `/`, leaves everything else alone, and hands a share on.
  const res = () => ({ writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } });
  const at = (p, method = "GET") => { const r = res(); const out = serveLanding({ method }, r, new URL("http://x" + p)); return { out, r }; };
  ok(at("/").out === true && at("/").r.status === 200 && at("/").r.body.startsWith("<!doctype html>"), "GET / is the page");
  ok(at("/api/health").out === null && at("/app/").out === null && at("/s/abc").out === null, "every other path is left alone");
  ok(at("/", "POST").out === null, "a POST to / is not ours");
  const shared = at("/?url=https%3A%2F%2Fexample.com");
  ok(shared.r.status === 302 && shared.r.headers.Location === "/app/?url=https%3A%2F%2Fexample.com", "a share that lands on / is passed to the app", shared.r.headers);
  ok(at("/", "HEAD").r.body === undefined && at("/", "HEAD").r.status === 200, "HEAD sends no body");

  console.log(bad ? `landing selftest FAILED (${bad}/${n})` : `landing selftest ok — ${n} assertions`);
  process.exit(bad ? 1 : 0);
}
