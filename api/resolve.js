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
import { fetchT, BROWSER_HEADERS, CRAWLER_HEADERS, isBotWall } from "./net.js";

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

/**
 * A PROFILE, not a post. `instagram.com/<handle>/` and nothing else.
 *
 * Deliberately strict: the reserved words are real Instagram paths, and
 * treating `/explore/` or `/accounts/` as somebody's handle would send the
 * resolver off to fetch a page that has no bio on it and report the failure as
 * "that person has no bio".
 */
const RESERVED_PATHS = new Set([
  "p", "reel", "reels", "tv", "share", "explore", "accounts", "stories",
  "direct", "about", "developer", "legal", "privacy", "api", "web", "graphql",
]);
export function parseInstagramProfile(u) {
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?|#|$)/i.exec(String(u || "").trim());
  if (!m) return null;
  const handle = m[1].toLowerCase();
  if (RESERVED_PATHS.has(handle)) return null;
  return { handle };
}

/** The handles a caption mentions, deduplicated, in the order they appear. */
export function handlesIn(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(/(?:^|[^\w@])@([A-Za-z0-9._]{2,30})\b/g)) {
    const h = m[1].toLowerCase().replace(/\.+$/, "");
    if (h.length < 2 || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/**
 * WHO A TAGGED ACCOUNT IS — asked, measured, and answered NO.
 *
 * The plan was to read each tagged profile and turn @backstory.london into a
 * name. Two measurements, in this order:
 *
 *   From a GitHub runner: no `biography` field, but og:description carries
 *   "…videos from Backstory | independent bookshop (@backstory.london)" —
 *   a name and a descriptor, which is what the bio was wanted for. Built on it.
 *
 *   From RENDER, where the code actually runs: browser UA → HTTP 429, zero
 *   bytes. Crawler UA → 200 and 617 kB of login wall with NO og:description
 *   at all. In production the path fetched eight profiles and returned eight
 *   nothings, which is exactly what `tagged_accounts: 0` said.
 *
 * So it is gone, rather than kept as an optimistic branch that costs eight
 * sequential fetches on the request path to return an empty array. The two
 * IPs disagree; the one that matters is the server's.
 *
 * WHAT REPLACED IT: nothing, because nothing was needed. The classifier reads
 * @funnyweatherbooks as "Funny Weather" perfectly well, and the geocoder
 * confirms or drops it. That was already happening underneath the dead call —
 * all eight bookshops resolved with `tagged_accounts: 0`. classify.js now says
 * so out loud instead of asking for names that never arrive.
 *
 * `probeProfile` stays: it is the instrument that measured this, and it is how
 * you check whether Meta has changed its mind. /api/debug/reel?url=<profile>.
 */

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
  //
  // FOUR shapes, because Meta has shipped four. The old `edge_media_to_caption`
  // edges array, the bare `"caption":"…"` string, and — the one that broke this
  // in production — `"caption":{"pk":…,"text":"…"}`, where the value is an
  // OBJECT and a parser looking for a string finds nothing and reports the page
  // as unreadable. The nested form is tried before the bare one so it cannot be
  // shadowed by a `"caption"` that happens to appear earlier as a string.
  out.caption =
    jsonStringAfter(html, /"edge_media_to_caption":\s*\{\s*"edges":\s*\[\s*\{\s*"node":\s*\{\s*"text"/) ||
    jsonStringAfter(html, /"caption"\s*:\s*\{[^{}]{0,400}?"text"/) ||
    jsonStringAfter(html, /"caption"/) ||
    // Last of the JSON forms: the alt text Meta generates. Worse than a caption
    // and far better than nothing — "Photo by X on August 01, 2026. May be an
    // image of pasta." still tells the classifier what it is looking at.
    jsonStringAfter(html, /"accessibility_caption"/) || "";
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

async function tryFetch(url, ms = 12000, headers = BROWSER_HEADERS) {
  try {
    const r = await fetchT(url, { headers, redirect: "follow" }, ms);
    const html = await r.text();
    // `status`/`bytes` are for `probeShare` and ignored by the resolvers. A
    // wall is NOT a fetch failure — 200 with a login page is the single most
    // common way this chain dies, and in a diagnosis it must not be
    // indistinguishable from "the network was down".
    if (isBotWall(r.status, html)) return { blocked: true, html: "", status: r.status, bytes: html.length };
    return { blocked: false, html, status: r.status, bytes: html.length };
  } catch (e) {
    return { blocked: false, html: "", status: 0, bytes: 0, error: e.message };
  }
}

async function viaEmbed(ig) {
  const { html } = await tryFetch(embedUrl(ig));
  const got = extractInstagram(html);
  return got.caption ? { ...got, via: got.via || "embed" } : null;
}

async function viaCanonical(ig) {
  const { html } = await tryFetch(canonicalOf(ig));
  // SCOPED, for the same reason the crawler step reads the embed page: this
  // URL can return a blob holding several of the account's posts, and an
  // unscoped read picks whichever caption appears first.
  const scoped = scopeToShortcode(html, ig.shortcode);
  if (!scoped) return null;
  const got = extractInstagram(scoped);
  return got.caption ? { ...got, via: "canonical-og" } : null;
}

/**
 * Ask as a link-preview crawler instead of a browser.
 *
 * Measured, not assumed: as a browser, Meta returns 606kB with
 * `<title>Instagram</title>`, zero og: tags and no caption in any form — an
 * app shell rendered entirely client-side, with nothing in it to parse no
 * matter how clever the parser. But every chat app that draws a preview card
 * for a pasted reel is getting og: tags from somewhere, and it gets them by
 * announcing itself as a crawler. So this asks the same way.
 */
/**
 * THE EMBED PAGE FIRST, and it is not a preference — it is a correctness
 * requirement, learned by filing a reel about "Willow and Wind" as
 * "The Wicker Man".
 *
 * The canonical page comes back as ~930kB carrying SEVERAL of the account's
 * posts in one JSON blob. Reading the first `"caption"` in document order
 * therefore reads a NEIGHBOURING POST — and the result is not an obvious
 * failure. It is a confident, well-formed, catalogue-matched entry for
 * entirely the wrong film. That is worse than resolving nothing.
 *
 * `/embed/captioned/` is ~130kB and holds exactly one post by construction, so
 * there is no wrong caption available to pick.
 *
 * The canonical page is still used for ONE thing: `og:image`. Meta's og: tags
 * are page-level metadata describing the URL that was requested, so unlike the
 * JSON blob they cannot belong to a different post.
 */
async function viaCrawler(ig) {
  const { html } = await tryFetch(embedUrl(ig), 12000, CRAWLER_HEADERS);
  const got = extractInstagram(html);
  if (!got.caption) return null;

  if (!got.imageUrl) {
    const canon = await tryFetch(canonicalOf(ig), 12000, CRAWLER_HEADERS);
    got.imageUrl = metaTag(canon.html, "og:image") || null;
  }
  return { ...got, via: `crawler-${got.via ?? "og"}` };
}

export const canonicalOf = (ig) =>
  `https://www.instagram.com/${ig.kind === "p" ? "p" : "reel"}/${ig.shortcode}/`;

/**
 * Narrow a multi-post page to the post that was actually asked for.
 *
 * Returns null when the shortcode is nowhere in the page — which must be read
 * as "do not trust anything here", not as "use the whole page". Being lenient
 * about this is the exact bug above.
 */
export function scopeToShortcode(html, shortcode) {
  if (!html || !shortcode) return null;
  const at = html.indexOf(`"${shortcode}"`);
  if (at < 0) return null;
  return html.slice(at);
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
    // Crawler BEFORE the paid resolver and after the free browser attempts:
    // it is free, it is one request, and as of 2026-08-11 the two above it
    // return a JavaScript shell with nothing in it.
    for (const step of [viaEmbed, viaCanonical, viaCrawler, viaPaidResolver]) {
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

/**
 * What a PROFILE page gives up. Measured, not assumed.
 *
 * The plan for "a reel that just tags ten restaurants" is to read each tagged
 * account's bio. Whether that is possible at all depends on what
 * instagram.com/<handle>/ returns to a crawler, and the honest answer is that
 * nobody here knows yet — a profile has no /embed/ endpoint, and og:description
 * on a profile is usually a follower count rather than the bio.
 *
 * So this reports what actually comes back, per user agent, before a line of
 * resolver is written for it.
 */
export async function probeProfile(handle) {
  const url = `https://www.instagram.com/${handle}/`;
  const steps = [];
  for (const [name, headers] of [["browser", BROWSER_HEADERS], ["crawler", CRAWLER_HEADERS]]) {
    const t0 = Date.now();
    const r = await tryFetch(url, 12000, headers);
    const og = metaTag(r.html, "og:description");
    const bioJson = jsonStringAfter(r.html, /"biography"/);
    steps.push({
      step: name, url, ms: Date.now() - t0, http: r.status, bytes: r.bytes,
      blocked: !!r.blocked, error: r.error ?? null,
      og_description: og ? String(og).slice(0, 400) : null,
      biography: bioJson ? String(bioJson).slice(0, 400) : null,
      full_name: jsonStringAfter(r.html, /"full_name"/) || null,
      category: jsonStringAfter(r.html, /"category_name"/) || jsonStringAfter(r.html, /"category"/) || null,
      // A profile bio very often IS the address, which is the whole point.
      external_url: jsonStringAfter(r.html, /"external_url"/) || null,
    });
  }
  const best = steps.find((x) => x.biography) || steps.find((x) => x.og_description);
  return {
    handle, kind: "profile", steps,
    verdict: steps.some((x) => x.biography)
      ? "BIO READABLE — the profile page carries a biography field, so tagged accounts can be resolved into places"
      : best?.og_description
        ? "ONLY og:description — usually a follower count, not the bio. Check the sample before building on it."
        : "NOTHING — the profile page gives up neither a bio nor og:description to this server",
  };
}

/**
 * Run the chain WITHOUT hiding it, and report what each link actually got.
 *
 * This exists because "nothing is coming back with a title" has at least four
 * causes that look identical from the app — Meta serving a login wall to a
 * datacentre IP, a markup change, a timeout, or a classifier that ran fine and
 * found nothing nameable — and picking between them by reasoning is how a day
 * gets spent. The trap was named in the plan as Milestone 0 and never
 * measured; this is the measurement, run from the server whose IP is the
 * variable that matters.
 *
 * Deliberately reports SIZES AND STATUSES, not page bodies: the answer is
 * "2.1kB and blocked" versus "310kB and a caption", and dumping Instagram's
 * HTML through an API response helps nobody.
 */
/**
 * What KIND of page came back. A 200 of 600kB with nothing extractable has at
 * least three explanations — a login shell, a JS-only app shell, or real markup
 * whose keys have moved — and they are three different fixes. Counting known
 * markers is how you tell them apart without pasting a 600kB page around.
 */
const MARKERS = {
  og_description: /<meta[^>]+og:description/i,
  og_image: /<meta[^>]+og:image/i,
  og_title: /<meta[^>]+og:title/i,
  edge_media_to_caption: /"edge_media_to_caption"/,
  caption_key: /"caption"\s*:/,
  caption_text_object: /"caption"\s*:\s*\{/,
  xdt_web_info: /xdt_api__v1__media__shortcode__web_info/,
  polaris_post: /PolarisPostRoot|PolarisPost\b/,
  caption_class: /class="[^"]*\bCaption\b/,
  login_redirect: /accounts\/login/,
  login_form: /loginForm|LoginAndSignupPage/,
  challenge: /challenge-platform|cf-mitigated/i,
  age_gate: /age_gate|restricted_by_age/i,
  json_script: /<script[^>]+type="application\/json"/i,
};

/**
 * A few hundred characters around the first occurrence of a key, so a moved
 * field can be READ rather than guessed at. Deliberately short and deliberately
 * stripped of newlines: this is evidence, not a page dump.
 */
function excerpt(html, re, span = 220) {
  const m = re.exec(html);
  if (!m) return null;
  const at = Math.max(0, m.index - 40);
  return html.slice(at, at + span).replace(/\s+/g, " ");
}

export async function probeShare(sourceUrl) {
  // A profile URL is a different question with a different answer.
  const prof = parseInstagramProfile(sourceUrl);
  if (prof) return probeProfile(prof.handle);

  const ig = parseInstagramUrl(sourceUrl);
  const steps = [];

  const record = async (step, url, extract, headers) => {
    const t0 = Date.now();
    const r = await tryFetch(url, 12000, headers);
    const got = extract(r.html);
    const markers = {};
    for (const [k, re] of Object.entries(MARKERS)) if (re.test(r.html)) markers[k] = true;
    steps.push({
      step, url, ms: Date.now() - t0,
      http: r.status, bytes: r.bytes, blocked: !!r.blocked, error: r.error ?? null,
      caption_chars: (got.caption || "").length,
      // THE TEXT ITSELF, not just its length. A character count told me the
      // chain worked and told me nothing about why the classifier then named
      // the wrong film — and the caption is precisely the classifier's input.
      // Truncated because these run to hashtag walls.
      caption_text: (got.caption || "").slice(0, 900) || null,
      via: got.via ?? null,
      image: !!got.imageUrl,
      author: got.authorHandle ?? null,
      // Only the markers that are PRESENT, so the shape of the object is the
      // finding rather than a wall of `false`.
      markers,
      // The two places a caption could be hiding, verbatim, when we failed to
      // read one. Not sent when extraction worked — there is nothing to debug.
      samples: (got.caption || "").length ? undefined : {
        caption: excerpt(r.html, /"caption"\s*:/),
        og_description: excerpt(r.html, /<meta[^>]+og:description/i),
        title_tag: excerpt(r.html, /<title[^>]*>/i, 160),
      },
    });
    return got;
  };

  const canonicalIg = ig ? `https://www.instagram.com/${ig.kind === "p" ? "p" : "reel"}/${ig.shortcode}/` : null;

  if (ig) {
    await record("embed", embedUrl(ig), extractInstagram);
    // Reported BOTH ways: unscoped is what shipped and filed the wrong film,
    // scoped is what the resolver now does. Seeing the two side by side is the
    // only way to tell the difference is real on a given reel.
    await record("canonical-unscoped", canonicalIg, extractInstagram);
    await record("canonical", canonicalIg, (h) => {
      const scoped = scopeToShortcode(h, ig.shortcode);
      return scoped ? extractInstagram(scoped) : EMPTY();
    });
    // The same two URLs asked as a link-preview crawler. Reported separately
    // so the difference between the two user agents is visible as a number
    // rather than argued about.
    await record("crawler-canonical-unscoped", canonicalIg, extractInstagram, CRAWLER_HEADERS);
    await record("crawler-embed", embedUrl(ig), extractInstagram, CRAWLER_HEADERS);
    steps.push({
      step: "paid",
      configured: !!(process.env.IG_RESOLVER_KEY && process.env.IG_RESOLVER_URL),
      note: "off unless IG_RESOLVER_KEY and IG_RESOLVER_URL are both set",
    });
  } else if (/^https?:\/\//i.test(String(sourceUrl || ""))) {
    await record("web", String(sourceUrl), (html) => extractWebPage(html, sourceUrl));
  }

  const best = steps.filter((x) => x.caption_chars > 0).sort((a, b) => b.caption_chars - a.caption_chars)[0] ?? null;
  const seen = (k) => steps.some((x) => x.markers?.[k]);

  // Ordered most-specific first. A 200 that is really a login shell is the
  // case the original bot-wall detector missed entirely — it looks for 403s
  // and Cloudflare text, and Meta serves neither.
  const verdict = best
    ? `readable — ${best.step} returned ${best.caption_chars} characters via ${best.via}`
    : steps.some((x) => x.blocked)
      ? "BLOCKED — a wall, not a page. Datacentre IPs get this far more than residential ones, which is why this must be run from the server."
      : seen("caption_text_object")
        ? "MARKUP MOVED — the caption is there but nested (\"caption\":{…}), and the extractor reads only a bare string. Fixable here; see samples.caption."
        : seen("edge_media_to_caption") || seen("caption_key") || seen("og_description")
          ? "MARKUP MOVED — something caption-shaped is in the page and the extractor missed it. See `samples`."
          : seen("login_form") || seen("login_redirect")
            ? "LOGIN SHELL — 200 OK, but the page is the logged-out app shell. No parser fixes this: it needs the paid resolver (IG_RESOLVER_KEY) or the screenshot path."
            // The measured 2026-08-11 case. Hundreds of kB, `<title>Instagram</title>`,
            // `data-sjs` bootstrap blobs, and NOT ONE og: tag. There is nothing in the
            // page to read, so no extractor will ever help.
            : steps.some((x) => x.markers?.json_script) && !seen("og_title") && !seen("og_description")
              ? "JAVASCRIPT SHELL — a few hundred kB of bootstrap script, <title>Instagram</title>, and no og: tags of any kind. The page is rendered client-side and carries NO metadata. Parsing cannot fix this. If even the crawler user-agent came back empty, the remaining routes are the paid resolver or the screenshot path."
              : "no caption — the page fetched and contains nothing caption-shaped at all. Possibly a reel with no caption.";

  return {
    url: sourceUrl,
    kind: ig ? "instagram" : "web",
    shortcode: ig?.shortcode ?? null,
    steps,
    verdict,   // the one-line answer; everything above is the working
  };
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

  // THE SHAPE THAT BROKE IT IN PRODUCTION. `"caption"` is an object, not a
  // string — a parser reading only bare strings finds nothing, and a 600kB page
  // full of caption reports as "no caption". Verified against a live reel:
  // HTTP 200, 605,771 bytes, zero characters extracted.
  const nestedFix = `<html><script>{"xdt_api__v1__media__shortcode__web_info":{"items":[{"code":"AbC",
    "user":{"username":"filmbro"},
    "caption":{"pk":"18001","user_id":42,"text":"Sinners \\u2014 best thing I have seen this year."},
    "image_versions2":{}}]}}</script></html>`;
  const nested = extractInstagram(nestedFix);
  ok(nested.caption === "Sinners — best thing I have seen this year.", "nested caption object is read", JSON.stringify(nested.caption));
  ok(nested.authorHandle === "filmbro", "nested author", nested.authorHandle);

  // The edges array still wins when both are present — it is the complete one.
  const bothFix = `<html><script>{"caption":{"text":"short"},
    "edge_media_to_caption":{"edges":[{"node":{"text":"the full caption"}}]}}</script></html>`;
  ok(extractInstagram(bothFix).caption === "the full caption", "edges array beats the nested object");

  // THE WICKER MAN BUG, as a fixture. The canonical page returns several of
  // the account's posts in one blob; the requested one is not first. Unscoped,
  // the reader takes the neighbour and produces a confident, catalogue-matched
  // entry for entirely the wrong film — which is worse than reading nothing,
  // because nothing announces itself as wrong.
  const twoPosts = `<html><script>{"items":[
    {"code":"AAAneighbour","caption":{"text":"The Wicker Man (1973)"}},
    {"code":"BBBwanted","caption":{"text":"Willow and Wind (1999)"}}
  ]}</script></html>`;
  ok(extractInstagram(twoPosts).caption === "The Wicker Man (1973)",
     "unscoped really does read the neighbouring post — the bug is reproduced");
  ok(extractInstagram(scopeToShortcode(twoPosts, "BBBwanted")).caption === "Willow and Wind (1999)",
     "scoped to the requested shortcode reads the right post", JSON.stringify(extractInstagram(scopeToShortcode(twoPosts, "BBBwanted")).caption));
  ok(scopeToShortcode(twoPosts, "CCCabsent") === null,
     "a shortcode that is not on the page returns null — never the whole page");
  ok(scopeToShortcode("", "BBBwanted") === null && scopeToShortcode(twoPosts, "") === null,
     "empty input scopes to nothing");

  // Profiles and handles — the backup path for a post that names ten places by
  // tagging them rather than writing them out.
  ok(parseInstagramProfile("https://www.instagram.com/stillframe.archivee/")?.handle === "stillframe.archivee", "profile url");
  ok(parseInstagramProfile("https://instagram.com/foo?hl=en")?.handle === "foo", "query string tolerated");
  ok(parseInstagramProfile("https://www.instagram.com/p/DboDS-UAJEb/") === null, "a POST is not a profile");
  ok(parseInstagramProfile("https://www.instagram.com/reel/x/") === null, "a REEL is not a profile");
  ok(parseInstagramProfile("https://www.instagram.com/explore/") === null, "a reserved path is not somebody's handle");
  ok(handlesIn("Loved @kiln_soho and @st.john_bread, thanks @someone").join() === "kiln_soho,st.john_bread,someone",
     "handles in the order they appear");
  ok(handlesIn("mail me at ab@cd.com").length === 0, "an email address is not a handle");
  ok(handlesIn("@kiln @kiln @KILN").length === 1, "deduplicated case-insensitively");

  // Meta's generated alt text: worse than a caption, far better than nothing.
  const altFix = `<html><script>{"accessibility_caption":"Photo by suren on August 01, 2026. May be an image of pasta."}</script></html>`;
  ok(/May be an image of pasta/.test(extractInstagram(altFix).caption), "falls back to accessibility_caption");

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
