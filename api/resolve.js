// resolve.js — turn a shared URL into text we can reason about.
//
// THE PREMISE, STATED SO NOBODY RE-LITIGATES IT LATER: Meta has no API that
// returns an arbitrary public reel's caption. `instagram_business_basic` reads
// the media of the business account that authorised YOUR app and nothing else.
// So this is a scrape, scrapes break, and every design decision below assumes
// that and stays useful when it happens.
//
// The chain, first usable caption wins:
//
//   1. instagram.com/reel/<code>/embed/captioned/   free, no auth
//   2. og: tags on the canonical URL                truncated but often enough
//   3. a paid resolver behind IG_RESOLVER_KEY       only if 1+2 failed AND set
//   (4. screenshot + vision — not here; that path never has a URL to fetch,
//       it comes in as an image and goes straight to classify.js)
//
// Everything returns ONE envelope shape so classify.js has a single input:
//
//   { caption, imageUrl, locationTag, authorHandle, outboundUrls, via }
//
// `via` is recorded on the item. When items start coming back thin, the
// resolver histogram tells you which link in the chain died — without it you
// are guessing at Meta's mood.
import { isMain } from "./ismain.js";
import { fetchT, BROWSER_HEADERS, isBotWall } from "./net.js";

const EMPTY = () => ({
  caption: "", imageUrl: null, locationTag: null, authorHandle: null,
  outboundUrls: [], via: null,
});

// ── small parsers ────────────────────────────────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", "#x27": "'", "#x2F": "/" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] != null) return ENTITIES[k];
    if (k[0] === "#") {
      const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

export function metaTag(html, prop) {
  const a = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', "i").exec(html);
  if (a) return decodeEntities(a[1]);
  const b = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', "i").exec(html);
  return b ? decodeEntities(b[1]) : null;
}

// Pull a JSON string literal out of raw HTML by key, and JSON.parse it so the
// \u escapes and \n that Instagram embeds in captions come back as real text.
// Parsing these by hand is how emoji and line breaks turn into mojibake.
function jsonStringAfter(html, keyRe) {
  const re = new RegExp(keyRe.source + '\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")', keyRe.flags);
  const m = re.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (_) { return null; }
}

export function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Any http(s) URL sitting in caption text. Recipe reels in particular say
// "full recipe on the blog: example.com/x" and that link is worth more than
// everything else in the caption put together.
export function urlsIn(text) {
  const out = [];
  const re = /\bhttps?:\/\/[^\s"'<>)]+/gi;
  let m;
  while ((m = re.exec(String(text || "")))) out.push(m[0].replace(/[.,;:]+$/, ""));
  return [...new Set(out)];
}

// ── Instagram ────────────────────────────────────────────────────────────────

// /reel/<code>/, /p/<code>/, /tv/<code>/, share links (/share/<code>/) and
// anything with a query string or trailing junk.
export function parseInstagramUrl(u) {
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[^/]+\/)??(reel|reels|p|tv|share)\/([A-Za-z0-9_-]+)/i.exec(String(u || "").trim());
  if (!m) return null;
  const kind = m[1].toLowerCase() === "reels" ? "reel" : m[1].toLowerCase();
  return { kind, shortcode: m[2] };
}

export function embedUrl({ shortcode }) {
  // /p/<code>/embed/captioned/ serves the caption for reels as well as posts —
  // the /reel/ form of the embed path 302s to it anyway.
  return `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
}

// Everything we know how to dig a caption out of, in order of how much we
// trust it. Exported so the fixtures can hit it directly without a network.
export function extractInstagram(html) {
  const out = EMPTY();
  if (!html) return out;

  // 1. The GraphQL blob the embed page ships with. Complete and unescaped.
  out.caption =
    jsonStringAfter(html, /"edge_media_to_caption":\s*\{\s*"edges":\s*\[\s*\{\s*"node":\s*\{\s*"text"/) ||
    jsonStringAfter(html, /"caption"/) || "";
  out.via = out.caption ? "embed-json" : null;

  // 2. The rendered caption block on /embed/captioned/.
  if (!out.caption) {
    const cap = /<div[^>]+class="[^"]*\bCaption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (cap) {
      let text = cap[1]
        // The username is a link at the head of the block, not part of what
        // the person wrote. Leaving it in makes every caption start with a
        // handle and skews the classifier toward "this is about a person".
        .replace(/<a[^>]+class="[^"]*CaptionUsername[^"]*"[^>]*>[\s\S]*?<\/a>/i, "")
        .replace(/<span[^>]+class="[^"]*CaptionComments[^"]*"[^>]*>[\s\S]*?<\/span>/i, "");
      text = stripTags(text);
      if (text) { out.caption = text; out.via = "embed-html"; }
    }
  }

  // 3. og:description. Usually "1,234 likes, 56 comments - handle on August 1,
  //    2026: "the actual caption"." — the quoted tail is the only useful part.
  if (!out.caption) {
    const d = metaTag(html, "og:description");
    if (d) {
      const q = /[:\-—]\s*["“]([\s\S]+)["”]\s*\.?\s*$/.exec(d);
      out.caption = (q ? q[1] : d).trim();
      out.via = "og";
    }
  }

  out.imageUrl =
    metaTag(html, "og:image") ||
    jsonStringAfter(html, /"display_url"/) ||
    jsonStringAfter(html, /"thumbnail_src"/) ||
    null;

  const ogTitle = metaTag(html, "og:title") || "";
  out.authorHandle =
    jsonStringAfter(html, /"username"/) ||
    (/^([A-Za-z0-9._]+)\s+on\s+Instagram/i.exec(ogTitle) || [])[1] ||
    (/<a[^>]+class="[^"]*CaptionUsername[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(html) || [, ""])[1].replace(/<[^>]+>/g, "").trim() ||
    null;

  out.locationTag = jsonStringAfter(html, /"location":\s*\{[^}]*?"name"/) || null;
  out.outboundUrls = urlsIn(out.caption);
  if (!out.caption) out.via = null;
  return out;
}

async function tryFetch(url, ms = 12000) {
  try {
    const r = await fetchT(url, { headers: BROWSER_HEADERS, redirect: "follow" }, ms);
    const html = await r.text();
    if (isBotWall(r.status, html)) return { blocked: true, html: "" };
    return { blocked: false, html };
  } catch (_) {
    return { blocked: false, html: "" };
  }
}

async function viaEmbed(ig) {
  const { html } = await tryFetch(embedUrl(ig));
  const got = extractInstagram(html);
  return got.caption ? { ...got, via: got.via || "embed" } : null;
}

async function viaCanonical(ig) {
  const { html } = await tryFetch(`https://www.instagram.com/${ig.kind === "p" ? "p" : "reel"}/${ig.shortcode}/`);
  const got = extractInstagram(html);
  return got.caption ? { ...got, via: "canonical-og" } : null;
}

// A paid resolver (Apify / RapidAPI / similar). Deliberately last and
// deliberately inert without a key: an accidental deploy must not start
// spending money, and a resolver that runs when the free path already
// succeeded is pure waste. Response shapes differ per vendor, so the mapping
// is kept in one obvious place rather than spread through the chain.
async function viaPaidResolver(ig) {
  const key = process.env.IG_RESOLVER_KEY;
  const endpoint = process.env.IG_RESOLVER_URL;
  if (!key || !endpoint) return null;
  try {
    const url = endpoint.replace("{shortcode}", ig.shortcode).replace("{url}", encodeURIComponent(`https://www.instagram.com/reel/${ig.shortcode}/`));
    const r = await fetchT(url, { headers: { "x-api-key": key, Authorization: `Bearer ${key}`, Accept: "application/json" } }, 20000);
    if (!r.ok) return null;
    const j = await r.json();
    const node = Array.isArray(j) ? j[0] : j.data || j;
    const caption = node?.caption?.text || node?.caption || node?.edge_media_to_caption?.edges?.[0]?.node?.text || "";
    if (!caption) return null;
    return {
      caption: String(caption),
      imageUrl: node?.display_url || node?.thumbnail_url || node?.image || null,
      locationTag: node?.location?.name || null,
      authorHandle: node?.owner?.username || node?.username || null,
      outboundUrls: urlsIn(caption),
      via: "paid",
    };
  } catch (_) {
    return null;
  }
}

// ── generic web pages (recipe blogs, bookshops, letterboxd, a Maps link) ─────
// Shared links are not always Instagram, and a plain URL is the easiest thing
// in the world to support well. schema.org first, og: second — the same order
// soundcheck-api/import.js uses, for the same reason: structured data is
// authored, og: tags are frequently an afterthought.

function findNode(node, pred) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findNode(n, pred); if (f) return f; } return null; }
  if (pred(node)) return node;
  if (node["@graph"]) return findNode(node["@graph"], pred);
  return null;
}

export function parseLd(html, typeRe) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch (_) { continue; }
    const hit = findNode(data, (n) => {
      const t = Array.isArray(n["@type"]) ? n["@type"].join(" ") : String(n["@type"] || "");
      return typeRe.test(t);
    });
    if (hit) return hit;
  }
  return null;
}

export function extractWebPage(html, url) {
  const out = EMPTY();
  if (!html) return out;
  const recipe = parseLd(html, /recipe/i);
  if (recipe) {
    const ing = (recipe.recipeIngredient || recipe.ingredients || []);
    const steps = (Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [recipe.recipeInstructions])
      .filter(Boolean).map((s) => (typeof s === "string" ? s : s.text || s.name || "")).filter(Boolean);
    out.caption = [
      recipe.name,
      recipe.description,
      ing.length ? "Ingredients:\n" + ing.join("\n") : "",
      steps.length ? "Method:\n" + steps.join("\n") : "",
    ].filter(Boolean).join("\n\n");
    out.imageUrl = typeof recipe.image === "string" ? recipe.image
      : Array.isArray(recipe.image) ? (typeof recipe.image[0] === "string" ? recipe.image[0] : recipe.image[0]?.url)
      : recipe.image?.url || null;
    out.via = "web-jsonld-recipe";
    out.outboundUrls = url ? [url] : [];
    return out;
  }
  const title = metaTag(html, "og:title") || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1];
  const desc = metaTag(html, "og:description") || metaTag(html, "description") || "";
  if (title || desc) {
    out.caption = [stripTags(title), desc].filter(Boolean).join("\n\n");
    out.imageUrl = metaTag(html, "og:image");
    out.via = "web-og";
    out.outboundUrls = url ? [url] : [];
  }
  return out;
}

// ── the chain ────────────────────────────────────────────────────────────────

export async function resolveShare(sourceUrl) {
  const ig = parseInstagramUrl(sourceUrl);
  if (ig) {
    for (const step of [viaEmbed, viaCanonical, viaPaidResolver]) {
      const got = await step(ig);
      if (got && got.caption) return got;
    }
    // Nothing readable. This is a normal outcome, not an error: the item still
    // has your chosen list and a link you can open. It goes to Inbox.
    return { ...EMPTY(), via: "none" };
  }
  if (/^https?:\/\//i.test(String(sourceUrl || ""))) {
    const { html } = await tryFetch(sourceUrl);
    const got = extractWebPage(html, sourceUrl);
    if (got.caption) return got;
  }
  return { ...EMPTY(), via: "none" };
}

// ── selftest ─────────────────────────────────────────────────────────────────
// Fixtures, not the network. A Meta markup change should surface here in a
// second rather than as a week of quietly thin items.
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (cond, label, extra) => { if (!cond) { fail++; console.error("FAIL", label, extra ?? ""); } };

  ok(parseInstagramUrl("https://www.instagram.com/reel/DAbCdEf/")?.shortcode === "DAbCdEf", "url reel");
  ok(parseInstagramUrl("https://instagram.com/reels/XyZ_123-a?igsh=abc")?.shortcode === "XyZ_123-a", "url reels+query");
  ok(parseInstagramUrl("https://www.instagram.com/someuser/p/AbC/")?.kind === "p", "url user-scoped post");
  ok(parseInstagramUrl("https://example.com/x") === null, "url non-ig");
  ok(embedUrl({ shortcode: "AbC" }) === "https://www.instagram.com/p/AbC/embed/captioned/", "embed url");

  const jsonFix = `<html><script>window.__d={"shortcode":"AbC","owner":{"username":"chef_amma"},
    "edge_media_to_caption":{"edges":[{"node":{"text":"Best dosa in Peckham \\u2014 Ganapati.\\nFull recipe: https://example.com/dosa"}}]},
    "display_url":"https://cdn/x.jpg","location":{"pk":1,"name":"Peckham, London"}}</script></html>`;
  const a = extractInstagram(jsonFix);
  ok(a.caption.startsWith("Best dosa in Peckham — Ganapati."), "json caption + unicode unescape", a.caption);
  ok(a.caption.includes("\n"), "json caption keeps line break");
  ok(a.authorHandle === "chef_amma", "json author", a.authorHandle);
  ok(a.locationTag === "Peckham, London", "json location", a.locationTag);
  ok(a.imageUrl === "https://cdn/x.jpg", "json image", a.imageUrl);
  ok(a.outboundUrls[0] === "https://example.com/dosa", "outbound url", a.outboundUrls);
  ok(a.via === "embed-json", "via json", a.via);

  const htmlFix = `<html><meta property="og:image" content="https://cdn/y.jpg">
    <div class="Caption"><a class="CaptionUsername" href="/x/">bookclub</a>
    Three novels I could not put down &amp; one I could.<br>1. Piranesi
    <span class="CaptionComments">view all 12 comments</span></div></html>`;
  const b = extractInstagram(htmlFix);
  ok(b.via === "embed-html", "via html", b.via);
  ok(b.caption.startsWith("Three novels"), "html caption strips username", JSON.stringify(b.caption));
  ok(!/view all/.test(b.caption), "html caption strips comments count");
  ok(b.caption.includes("&") && !b.caption.includes("&amp;"), "html entities decoded");
  ok(b.caption.includes("1. Piranesi"), "html <br> becomes newline");
  ok(b.imageUrl === "https://cdn/y.jpg", "html image");

  const ogFix = `<html><meta property="og:title" content="tastytravels on Instagram">
    <meta property="og:description" content="1,204 likes, 33 comments - tastytravels on August 1, 2026: &quot;Kolkata biryani at Arsalan. Get the mutton.&quot;"></html>`;
  const c = extractInstagram(ogFix);
  ok(c.via === "og", "via og", c.via);
  ok(c.caption === "Kolkata biryani at Arsalan. Get the mutton.", "og caption unquoted", JSON.stringify(c.caption));
  ok(c.authorHandle === "tastytravels", "og author", c.authorHandle);

  // A login wall carries no data and must not be parsed into a title.
  ok(isBotWall(200, "<html><body>Please enable JavaScript and cookies</body></html>") === true, "botwall js");
  ok(isBotWall(403, "") === true, "botwall 403");
  ok(isBotWall(200, "<html><div class=\"Caption\">real</div></html>") === false, "botwall negative");
  ok(extractInstagram("").caption === "" && extractInstagram("").via === null, "empty html → empty envelope");

  const recipeFix = `<html><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@graph": [{ "@type": "WebSite" }, {
      "@type": "Recipe", name: "Lemon dal", description: "Weeknight dal.",
      recipeIngredient: ["1 cup toor dal", "2 lemons"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Boil the dal." }, { "@type": "HowToStep", text: "Add lemon." }],
      image: ["https://cdn/dal.jpg"],
    }] })}</script></html>`;
  const d = extractWebPage(recipeFix, "https://food.example/dal");
  ok(d.via === "web-jsonld-recipe", "recipe via", d.via);
  ok(d.caption.includes("Lemon dal") && d.caption.includes("toor dal") && d.caption.includes("Boil the dal."), "recipe fields", d.caption);
  ok(d.imageUrl === "https://cdn/dal.jpg", "recipe image array");

  const webFix = `<html><meta property="og:title" content="Piranesi by Susanna Clarke"><meta property="og:description" content="A novel."></html>`;
  const e = extractWebPage(webFix, "https://books.example/piranesi");
  ok(e.via === "web-og" && e.caption.includes("Piranesi"), "web og fallback", e);

  console.log(fail ? `selftest FAILED (${fail})` : "resolve selftest ok");
  process.exit(fail ? 1 : 0);
}
