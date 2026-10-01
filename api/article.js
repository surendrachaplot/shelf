// article.js — the words on the page, kept, so the link can die.
//
// A shared article is the one kind of share where the THING is the text. A
// book has a catalogue entry and a restaurant has a pin; an essay has nothing
// but its paragraphs, and those live on somebody else's server until the day
// they do not. So this reads them out once, at share time, and the phone keeps
// them.
//
//   extractArticle(html, url)
//     → { title, byline, siteName, text, readingMinutes, excerpt, hero } | null
//
// Pure functions over HTML. No network, no DOM, and NO DEPENDENCY: this
// service has exactly two (`pg`, the Anthropic SDK), and a readability
// library is a parser, a DOM and their CVEs in exchange for the last few
// percent of pages.
//
// ── WHAT "LITE" MEANS ───────────────────────────────────────────────────────
//
// It strips what is never the article (nav, footer, aside, forms, scripts,
// comments, and boxes that call themselves a sidebar), cuts what is left into
// blocks, and scores each block by how much of it is prose and how much of it
// is link. The body is the run from the first real paragraph to the last.
//
// ── THE RULE THAT MATTERS MORE THAN COVERAGE ────────────────────────────────
//
// NULL, NOT A THIN OR WRONG ARTICLE. A reader that opens on six teasers from a
// section front, or on a shop's product blurb, looks exactly like a reader
// that worked — the same trap as the Wicker Man caption in resolve.js. Every
// doubt below resolves to null, and an item with no article is just an item.
import { readFileSync } from "node:fs";
import { isMain } from "./ismain.js";
import { parseLd, metaTag, stripTags, decodeEntities, extractWebPage } from "./resolve.js";

// 60,000 characters of stored text — about 10,000 words, a 45-minute read.
// Past that it is a book, and the phone keeps every item in ONE json file that
// is rewritten whole on each save. Cut at a paragraph break, never mid-word.
export const MAX_TEXT = 60_000;

// Pages are read up to here and no further. A 3 MB document is not an essay,
// and every pass below is a regex over the whole string.
const MAX_HTML = 3_000_000;

const MIN_CHARS = 600;  // ~100 words. Shorter than a news brief is not a body.
const MIN_PARAS = 3;    // one long paragraph is a blurb, not an article
const LONG = 80;        // a block this long is prose; shorter has to prove it
const LINKY = 0.5;      // more than half link text → navigation, not writing
const WPM = 230;        // silent reading speed, adults, English

// ── stripping ────────────────────────────────────────────────────────────────

// Past the `</tag>` that closes an element opened just before `from`, counting
// nested opens of the same name. An element that never closes (a void tag, or
// broken markup) costs its opening tag and nothing else — dropping the rest of
// the document for one `<input class="share">` would be an empty article with
// no explanation.
function closeOf(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[0].endsWith("/>")) continue;
    depth += m[1] ? -1 : 1;
    if (!depth) return re.lastIndex;
  }
  return from;
}

// Remove every element whose OPENING TAG matches — the whole element, children
// and all. A non-greedy `<aside>[\s\S]*?</aside>` stops at the first close it
// meets, which for anything nested leaves the tail of the box in the article.
function drop(html, open) {
  const re = new RegExp(open.source, "gi");
  let out = "", at = 0, m;
  while ((m = re.exec(html))) {
    const end = closeOf(html, (m[1] || m[2]).toLowerCase(), re.lastIndex);
    out += html.slice(at, m.index) + "\0";   // \0 so the neighbours do not fuse
    at = re.lastIndex = end;
  }
  return out + html.slice(at);
}

// Every top-level <tag>…</tag>, outer HTML.
function elements(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const end = closeOf(html, tag, re.lastIndex);
    out.push(html.slice(re.lastIndex, end));
    re.lastIndex = end;
  }
  return out;
}

// Two kinds of thing that are never the article.
//
// BY TAG: the ones HTML itself names. A <footer> inside an <article> is the
// author's bio and a <form> is the newsletter box, and both are made of
// well-formed sentences that no density score will ever throw out.
//
// BY NAME: a <div> that calls itself a sidebar. Old blogs have no <aside> —
// the "About me" paragraph sits in `<div id="sidebar">` and reads exactly like
// the post it follows. The class token has to START with the word:
// `content-sidebar-wrap` is the wrapper around the whole page on a great many
// WordPress themes, and matching it anywhere deletes the article with it.
// html/body/main/article are never dropped by name for the same reason.
const JUNK = new RegExp(
  "<(script|style|noscript|template|svg|iframe|nav|footer|aside|form|button|select)\\b[^>]*>" +
  "|<(?!(?:html|body|main|article)\\b)([a-z][a-z0-9]*)\\b[^>]*\\s(?:class|id)=[\"'](?:[^\"']*\\s)?" +
  "(?:sidebar|comment|related|share|social|newsletter|promo|advert|cookie)[^\"']*[\"'][^>]*>");

const ARTICLE = /<(article)\b[^>]*>/;

// ── blocks ───────────────────────────────────────────────────────────────────

const BLOCK = /\0|<\/?(?:p|div|section|article|main|header|h[1-6]|ul|ol|li|dl|dt|dd|blockquote|pre|table|tr|td|th|figure|figcaption|hr)\b[^>]*>|(?:<br\s*\/?>\s*){2,}/i;

const one = (s, max = 300) => stripTags(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, max) || null;

/**
 * A fragment of HTML → its body text, paragraphs joined by a blank line, or
 * null when there is no body in it.
 *
 * ponytail: this scores BLOCKS, not containers. Real Readability scores every
 * parent element and picks the best subtree, which is what separates a post
 * from a long comment thread underneath it in the same <div>. Without a DOM
 * that thread is appended to the article. If that shows up on real shares,
 * the upgrade is a tokenizer and a parent score — not more names in JUNK.
 */
function bodyOf(frag) {
  const blocks = frag
    .replace(/<h[2-6]\b[^>]*>/gi, "\0\x01")
    .split(BLOCK)
    .map((c) => {
      const text = stripTags(c).replace(/[\s\x01]+/g, " ").trim();
      let link = 0;
      for (const a of c.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) link += stripTags(a[1]).length;
      return { text, head: c.startsWith("\x01"), linky: link > text.length * LINKY };
    })
    .filter((b) => b.text);

  const strong = (b) => !b.head && !b.linky && b.text.length >= LONG;
  const first = blocks.findIndex(strong);
  if (first < 0) return null;
  // Everything before the first real paragraph is the byline, the date and the
  // share buttons; everything after the last is "more from this author".
  const range = blocks.slice(first, blocks.findLastIndex(strong) + 1);
  const paras = range.filter(strong).length;
  if (paras < MIN_PARAS) return null;

  // A SECTION FRONT IS NOT AN ARTICLE. Six teasers of ninety characters each
  // pass every length test there is. What gives the page away is the rhythm:
  // linked headline, teaser, linked headline, teaser. An article has one
  // "related" box, perhaps two; a listing has a run of links for every
  // paragraph or every other one.
  let runs = 0;
  range.forEach((b, i) => { if (b.linky && !range[i - 1]?.linky) runs++; });
  if (runs * 2 >= paras) return null;

  // A short block has to end like a sentence to stay: "No." is writing,
  // "Advertisement" and "4 min read" are furniture.
  const keep = (b) => !b.linky && (b.head || b.text.length >= LONG || /[.!?…:"”'’)]$/.test(b.text));
  const out = [];
  range.forEach((b, i) => {
    if (!keep(b)) return;
    // A heading earns its place by introducing text. "More on this story" over
    // a list of links introduces nothing once the links are gone.
    const next = range[i + 1];
    if (b.head && !(next && !next.head && keep(next))) return;
    out.push(b.text);
  });
  const text = out.join("\n\n");
  return text.length >= MIN_CHARS ? text : null;
}

// ── the page ─────────────────────────────────────────────────────────────────

function cap(text) {
  if (text.length <= MAX_TEXT) return text;
  const cut = text.lastIndexOf("\n\n", MAX_TEXT);
  return text.slice(0, cut > 0 ? cut : MAX_TEXT);
}

function absolute(src, base) {
  if (!src) return null;
  try {
    const u = new URL(String(src), base || undefined);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch (_) {
    return null;
  }
}

export function extractArticle(html, url) {
  if (!html) return null;
  html = String(html).slice(0, MAX_HTML);

  // A RECIPE OR A PRODUCT IS NOT AN ARTICLE, however much prose is wrapped
  // round it. The four paragraphs about somebody's grandmother above a dal are
  // not what was saved — the dal was, and enrich/ already reads it properly.
  const web = extractWebPage(html, url);
  if (web.via === "web-jsonld-recipe") return null;
  if (parseLd(html, /product/i) || /^product/i.test(metaTag(html, "og:type") || "")) return null;

  // Comments first and by regex — they are not elements, and a commented-out
  // <p> is a paragraph to everything downstream.
  const clean = drop(html.replace(/<!--[\s\S]*?-->/g, ""), JUNK);

  // <article>, then <main>, then the page. Each is tried WHOLE and has to hold
  // up on its own (see bodyOf).
  //
  // An <article> inside the one being read is a comment, and is dropped. And
  // an <article> that did not hold up is not allowed back in through <main>:
  // a section front built from <article> cards — each wrapped whole in one
  // link, so no block in it scores as linky — would otherwise be reassembled
  // into six paragraphs of teaser.
  let dom = elements(clean, "article")
    .map((a) => bodyOf(drop(a, ARTICLE)))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || null;
  if (!dom) {
    const rest = drop(clean, ARTICLE);
    const main = elements(rest, "main")[0];
    dom = (main && bodyOf(main)) || bodyOf(rest);
  }

  // JSON-LD `articleBody` is the publisher's own copy of the text: no clutter
  // to strip and nothing to mis-scope, and on a page rendered client-side it
  // is the ONLY copy. Taken when it holds up — long enough, and not a teaser
  // of something the markup has in full (a paywall ships the first hundred
  // words here and calls it the body).
  const ld = parseLd(html, /article|posting/i) || {};
  const ldBody = stripTags(String(ld.articleBody || ""))
    .split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
  const body = ldBody.length >= MIN_CHARS && ldBody.length >= (dom || "").length * 0.8 ? ldBody : dom;
  if (!body) return null;

  const text = cap(body);
  const authors = [].concat(ld.author || [])
    .map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).join(", ");
  // NEVER a byline guessed from "Posted by …" in the page. A name read out of
  // structured data is a fact; one regexed out of prose is how a commenter
  // ends up credited with the essay.
  const byline = [authors, metaTag(html, "author")].map((b) => one(b, 120))
    .find((b) => b && !/^https?:/i.test(b)) || null;

  let host = null;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (_) {}

  const lead = one(metaTag(html, "og:description") || metaTag(html, "description") || ld.description || text.split("\n\n")[0], 2000);
  const img = ld.image;

  return {
    title: one(decodeEntities(ld.headline)) || one(metaTag(html, "og:title"))
      || one((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(clean) || [])[1])
      || one((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]),
    byline,
    siteName: one(metaTag(html, "og:site_name") || ld.publisher?.name, 120) || host,
    text,
    readingMinutes: Math.ceil(text.split(/\s+/).length / WPM),
    excerpt: lead.length > 280 ? lead.slice(0, 280).replace(/\s+\S*$/, "") + "…" : lead,
    hero: absolute(web.imageUrl || (typeof img === "string" ? img : [].concat(img || [])[0]?.url || [].concat(img || [])[0]), url),
  };
}

// ── selftest ─────────────────────────────────────────────────────────────────
// Saved pages, not the network. Each fixture is a page this would otherwise
// get WRONG, and each assertion was watched to fail with its defence removed.
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (cond, label, extra) => { if (!cond) { fail++; console.error("FAIL", label, extra ?? ""); } };
  const fx = (name) => readFileSync(new URL(`./fixtures/article/${name}.html`, import.meta.url), "utf8");

  // ── a news story, buried in a news site ────────────────────────────────────
  const news = extractArticle(fx("news"), "https://www.tidewater.example/harbour/ferry-returns");
  ok(news, "the news story is an article — and <body class='sidebar-right'> is not a sidebar to drop");
  const nt = news?.text || "";
  ok(nt.startsWith("The Marlow Sound ferry carried passengers") && nt.endsWith("a second crew had been certified."),
     "the body runs from the first paragraph to the last, and no further", [nt.slice(0, 50), nt.slice(-50)]);
  ok(nt.split("\n\n").length === 11 && !/\n(?!\n)[^\n]/.test(nt.replace(/\n\n/g, "")),
     "one blank line between paragraphs and none inside them", nt.split("\n\n").length);
  for (const [what, marker] of [
    ["<nav>", "You are here"],
    ["<aside>", "Morning Dispatch"],
    ["<form>", "Enter your email address"],
    ["<footer>", "is a correspondent covering"],
    ["<script>", "__analytics"],
    ["an HTML comment", "legal desk"],
  ]) ok(!nt.includes(marker), `${what} is stripped — its sentences read like prose and no score throws them out`, marker);
  ok(!nt.includes("font-family"), "<style> is stripped — a rule that ends in '}' is long, unlinked and kept");
  ok(!nt.includes("Timeline: how"), "a link is not a paragraph, even a long one that ends in a full stop");
  ok(!nt.includes("More on this story"), "and the heading over it goes with it");
  ok(nt.includes("\n\nWhat the engineers found\n\n"), "a subheading that introduces text stays, as its own paragraph");
  ok(!nt.includes("Advertisement") && !nt.includes("Photograph:"), "a short block that is not a sentence is furniture");
  ok(nt.includes("\n\nNo.\n\n"), "a short block that IS a sentence is writing");
  ok(!nt.includes("My grandfather skippered"), "the replies under the story are other <article>s, and are not it");
  ok(nt.includes("aboard — most of them, by the skipper’s count") && nt.includes("£1.4m") && nt.includes("estimate & the"),
     "entities are decoded — &mdash; in a saved article is a bug the reader sees on every line");
  ok(news?.title === "Harbour ferry returns after two years of repairs", "title without the site's suffix", news?.title);
  ok(news?.byline === "Mara Ellison", "byline from structured data", news?.byline);
  ok(news?.siteName === "The Tidewater Courier", "site name", news?.siteName);
  ok(news?.hero === "https://cdn.tidewater.example/img/ferry-1200.jpg", "hero", news?.hero);
  ok(news?.excerpt?.startsWith("The Marlow Sound ferry carried its first passengers since 2024"), "excerpt is the page's own description", news?.excerpt);
  ok(news?.readingMinutes === 2, "295 words at 230 a minute, rounded up", news?.readingMinutes);

  // ── a blog with no <article>, no <main>, no metadata at all ────────────────
  const blog = extractArticle(fx("blog"), "https://www.slowbench.example/2026/06/sharpening");
  const bt = blog?.text || "";
  ok(blog, "a wrapper called content-SIDEBAR-wrap is not a sidebar — dropping it drops the post");
  ok(bt.startsWith("I put off learning to sharpen") && bt.endsWith("It is pinned above the bench."), "div soup still has a first and a last paragraph", [bt.slice(0, 40), bt.slice(-40)]);
  ok(!bt.includes("I am Tom"), "the About box in <div id=sidebar> is prose, and is not the post");
  ok(bt.includes("\n\nMost of what I read online skips straight to grit numbers, which is the least interesting part of the whole business and the easiest to get right.\n\nA coarse stone"),
     "<br><br> is a paragraph break on a page old enough to use it");
  ok(blog?.title === "Notes on sharpening a hand plane", "with no og:title the <h1> beats <title> and its ' - Slow Bench'", blog?.title);
  ok(blog?.siteName === "slowbench.example", "with no og:site_name the host is the site", blog?.siteName);
  ok(blog?.hero === null, "no image, no hero");
  ok(blog?.excerpt?.startsWith("I put off learning to sharpen") && blog.excerpt.endsWith("felt bad about it."),
     "with no description the first paragraph is the excerpt", blog?.excerpt);

  // ── pages that are NOT articles ────────────────────────────────────────────
  ok(extractArticle(fx("recipe"), "https://saltandcumin.example/dal") === null,
     "a recipe is not an article, however long the story above the ingredients");
  ok(extractArticle(fx("shop"), "https://northfold.example/fellside") === null,
     "a product page is not an article, however well written the blurb");
  ok(extractArticle(fx("news").replace('"NewsArticle"', '"Product"'), "https://x.example/") === null,
     "and a page whose JSON-LD says Product is one too, whatever og:type says");
  ok(extractArticle(fx("index"), "https://longshelf.example/books") === null,
     "a section front is not an article — six teasers are not six paragraphs");
  {
    const p = "A sentence long enough to count as a real paragraph of prose, written out in full to be sure. ";
    const cards = Array.from({ length: 6 }, (_, i) =>
      `<a href="/s/${i}"><article><h3>Story ${i}</h3><p>${p}</p></article></a>`).join("");
    ok(extractArticle(`<html><main>${cards}</main></html>`, "https://x.example/") === null,
       "<article> cards that fail alone are not reassembled through <main>");
    const post = `<html><body><article>${`<p>${p}</p>`.repeat(8)}<article class="c"><p>FIRST! ${p}</p></article></article></body></html>`;
    ok(extractArticle(post, "https://x.example/p")?.text.includes("FIRST!") === false,
       "an <article> nested in the article is a comment on it");
    ok(extractArticle(`<html><body>${`<p>${p.repeat(4)}</p>`.repeat(2)}</body></html>`, "https://x.example/") === null,
       "two paragraphs are a blurb, however long they are");
    ok(extractArticle(`<html><body>${`<p>${p}</p>`.repeat(3)}</body></html>`, "https://x.example/") === null,
       "and three short ones are not a body either");
    const two = `<html><body><article>${`<p>SHORT ${p}</p>`.repeat(7)}</article><article>${`<p>LONG ${p}</p>`.repeat(20)}</article></body></html>`;
    ok(extractArticle(two, "https://x.example/")?.text.startsWith("LONG"), "of two <article>s that both hold up, the longer is the page's subject");
    ok(extractArticle(`<html><body><input class="share-box">${`<p>${p}</p>`.repeat(8)}</body></html>`, "https://x.example/") !== null,
       "a junk tag that never closes costs its own tag, not the rest of the page");

    // THE CAP. 800 paragraphs is 76,000 characters.
    const long = extractArticle(`<html><body><article>${`<p>${p}</p>`.repeat(800)}</article></body></html>`, "https://x.example/long");
    ok(long.text.length <= MAX_TEXT && long.text.length > MAX_TEXT - 200, "stored text is capped", long.text.length);
    ok(long.text.endsWith("to be sure."), "at a paragraph break, never mid-sentence", long.text.slice(-30));
    ok(long.readingMinutes === 53, "and the reading time is for the text that was kept", long.readingMinutes);
    const wordy = extractArticle(`<html><body>${`<p>${p.repeat(4)}</p>`.repeat(4)}</body></html>`, "https://x.example/");
    ok(wordy.excerpt.length <= 281 && wordy.excerpt.endsWith("…"), "a long first paragraph is cut to an excerpt", wordy.excerpt.length);
    ok(wordy.text.startsWith(wordy.excerpt.slice(0, -1) + " "), "at a word, not through one", wordy.excerpt.slice(-30));
  }

  // ── the body lives in JSON-LD and nowhere else ─────────────────────────────
  const ld = extractArticle(fx("jsonld"), "https://fieldnotes.example/swifts-late");
  ok(ld?.text.startsWith("The swifts that nest under the eaves") && ld.text.endsWith("every May since 1998."),
     "a client-rendered page with an articleBody is still readable", ld?.text?.slice(0, 40));
  ok(ld?.text.split("\n\n").length === 6 && !/[^\n]\n[^\n]/.test(ld.text), "its single newlines become paragraph breaks", ld?.text.split("\n\n").length);
  ok(ld?.title === "Why the swifts came back late this year", "headline beats a <title> that only names the site", ld?.title);
  ok(ld?.byline === "Priya Raman, Dan Okafor", "two authors, both credited", ld?.byline);
  ok(ld?.siteName === "Field Notes", "publisher is the site when og:site_name is missing", ld?.siteName);
  ok(ld?.hero === "https://fieldnotes.example/media/swifts-hero.jpg", "a relative image is made absolute", ld?.hero);
  ok(ld?.excerpt === "A cold, wet May held the birds south of the Alps for nearly three weeks.", "excerpt from the JSON-LD description", ld?.excerpt);
  {
    // A paywall's articleBody is the first hundred words. The markup has more.
    const p = "A sentence long enough to count as a real paragraph of prose, written out in full to be sure. ";
    const teaser = JSON.stringify({ "@type": "NewsArticle", articleBody: "TEASER " + p.repeat(7) });
    const page = `<html><script type="application/ld+json">${teaser}</script><body><article>${`<p>${p}</p>`.repeat(20)}</article></body></html>`;
    ok(extractArticle(page, "https://x.example/")?.text.startsWith("TEASER") === false,
       "an articleBody much shorter than the page's own text is a teaser, and loses");
  }

  console.log(fail ? `article selftest FAILED (${fail})` : "article selftest ok");
  process.exit(fail ? 1 : 0);
}
