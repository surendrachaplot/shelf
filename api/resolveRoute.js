// resolveRoute.js — the whole service, in one request.
//
//   POST /api/resolve  { url, list }  →  { items: [ …resolved, enriched… ] }
//
// Send a link, get back what it is. NOTHING IS STORED. There is no row, no
// user, no id — the phone asked a question, this answered it, and the answer
// belongs to the phone.
//
// This replaces ingest + worker + items. That architecture existed because the
// share sheet could not wait four seconds for Claude, so the work had to be
// queued somewhere durable, and "somewhere durable" meant a database with your
// shelves in it. Now the share extension writes to the shared Keychain and
// closes instantly, and the APP does this call with a row on screen saying
// what it is doing. The four seconds are still there; they are just somewhere
// a person can see them, instead of behind a queue.
//
// It IS slow — a scrape, a Claude call and a catalogue lookup, three to six
// seconds. That is the honest cost of turning a reel into a named thing, and
// the app shows it rather than hiding it.
import { isMain } from "./ismain.js";
import { json, normList, shelvesOf, fitShelf } from "./http.js";
import { resolveShare, handlesIn } from "./resolve.js";
import { classifyShare, classifyImage, verifyItems, needsCheck, summarize } from "./classify.js";
import { extractArticle } from "./article.js";
import { extractProduct } from "./product.js";
import { imageBlock } from "./frames.js";
import { enrich } from "./enrich/index.js";
import { canonicalUrl } from "./url.js";

/**
 * Everything an item needs to exist on a phone. The device adds its own id and
 * timestamps — those are local facts and the server has no business minting
 * them any more.
 */
function shape(it, envelope, sourceUrl) {
  return {
    list: normList(it.list),
    title: it.title || null,
    subtitle: it.subtitle || "",
    note: it.note || "",
    image_url: it.image_url || envelope.imageUrl || null,
    canonical: it.canonical || {},
    confidence: typeof it.confidence === "number" ? it.confidence : null,
    enriched: !!it.enriched,
    source_url: sourceUrl || null,
    resolver: envelope.via || "none",
    // "confirmed" | "corrected" | "unfound" | null — see verifyItems.
    checked: it.checked || null,
    // The caption is returned so the DEVICE can decide whether to keep it.
    // Storing it here would be storing what you read, which is the thing this
    // service no longer does.
    caption: envelope.caption || "",
  };
}

/**
 * THE ARTICLE, for a share that is an ordinary web page with a body.
 *
 *   { byline, siteName, text, readingMinutes, excerpt, hero, summary }
 *
 * Those seven names are a contract with the app (find.js, tags.js, export.js
 * read them) — hence the object written out key by key instead of a spread
 * of whatever article.js returns today.
 *
 * NEVER THROWS AND NEVER REJECTS. The article is a bonus on top of an item
 * that is already resolved; a page that breaks the extractor, or a summary
 * call that times out, costs the article (or just the summary) and nothing
 * else. `extract` and `summarise` are parameters so the selftest can make
 * each of them fail and watch the share survive.
 */
export async function articleFor(envelope, url, { extract = extractArticle, summarise = summarize } = {}) {
  try {
    const a = envelope?.html ? extract(envelope.html, url) : null;
    if (!a) return null;
    let summary = null;
    try { summary = (await summarise(a)) || null; } catch (_) { /* the text is still worth having */ }
    return {
      byline: a.byline, siteName: a.siteName, text: a.text,
      readingMinutes: a.readingMinutes, excerpt: a.excerpt, hero: a.hero,
      summary,
    };
  } catch (_) {
    return null;
  }
}

const foldText = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "Piranesi: A Novel" is on a page that says "Piranesi". Compare the main title.
const mainOf = (t) => foldText(String(t || "").split(/\s*[:(\u2013\u2014]\s*|\s+-\s+/)[0]);

/**
 * ON A PAGE WITH AN ARTICLE BODY, THE PAGE IS THE EVIDENCE.
 *
 * Measured on the live service, 2026-10-01: an essay titled "How to Do Great
 * Work" came back as the BOOK "Hackers & Painters" — a real book, by the same
 * author, with an ISBN and a rating, that the essay never mentions. The
 * classifier called the essay a book and the catalogue handed back its
 * nearest neighbour. Same failure as the wrong bookshop (see nameFound in
 * enrich): confident, well-formed, and not the thing that was saved.
 *
 * A reel gives us a caption and little else, so this cannot be checked there.
 * An article gives us the whole text, so it can:
 *
 *   1. A named thing whose title appears nowhere on the page is not from the
 *      page. Dropped. (A "10 best books" list names every one of its books.)
 *   2. A thing that is just the page's own headline, with no catalogue match,
 *      IS the article. It goes on the pile as itself, not onto a shelf as a
 *      book that does not exist.
 *
 * No article → items untouched. Pure, so the selftest drives it.
 */
export function onArticlePage(items, envelope, article) {
  if (!article) return items;
  const headline = foldText(String(envelope?.caption || "").split("\n")[0]);
  const page = " " + foldText(`${envelope?.caption || ""} ${article.text || ""}`) + " ";
  return items
    .filter((it) => { const m = mainOf(it.title); return !m || page.includes(" " + m + " "); })
    .map((it) => (!it.enriched && headline && foldText(it.title) === headline ? { ...it, list: "unsorted" } : it));
}

/**
 * A THING TO BUY, as an item.
 *
 * A shop's product page says what it is in its own markup (api/product.js), so
 * there is nothing for a classifier to work out and no model call is made: the
 * page's name, brand, picture and price ARE the item.
 *
 * WHICH SHELF depends on who is asking. The Wishlist shelf exists only in
 * builds that have it, and a build that does not would file "wishlist" on a
 * shelf it cannot draw — saved, and visible nowhere. So the client says which
 * shelves it has (`shelves` in the request, read by `shelvesOf` in http.js)
 * and everybody else gets the item as "unsorted", which every build shows in
 * the pile. The facts (price, brand,
 * shop) ride on `canonical.kind === "product"` either way, so the price is on
 * screen wherever the item stands.
 *
 * `price` stays a NUMBER (lists add them up) next to `price_text` (what is
 * shown). `price_at` is when it was read: a price is true on a day.
 */
export function productItem(product, envelope, url, { shelves = [], now = new Date() } = {}) {
  const item = shape({
    title: product.name,
    subtitle: product.brand || product.seller || "",
    image_url: product.image,
    confidence: 0.9,
    enriched: true,
    canonical: {
      kind: "product",
      price: product.price, currency: product.currency, price_text: product.priceText,
      brand: product.brand, availability: product.availability, seller: product.seller,
      shop_url: product.url || url, price_at: now.toISOString(),
    },
  }, envelope, url);
  return { ...item, list: fitShelf("wishlist", shelvesOf(shelves)) };
}

/**
 * Put the article / the screenshot's text on an item's `canonical`.
 *
 * AFTER enrich(), never before: enrich() REPLACES `canonical` with the
 * provider's (or with `{}` on a miss), so anything attached earlier is
 * silently dropped on exactly the items a catalogue recognised. And outside
 * the provider cache, so `SHAPE` does not move — nothing here widens what an
 * enricher returns.
 *
 * Empty things are OMITTED, not sent as null or "": `"article" in canonical`
 * means there is one to read.
 */
export function carry(item, { article = null, ocr_text = "" } = {}) {
  const extra = {};
  if (article) extra.article = article;
  if (ocr_text) extra.ocr_text = ocr_text;
  return { ...item, canonical: { ...item.canonical, ...extra } };
}

/**
 * The response body, as a pure function.
 *
 * PULLED OUT BECAUSE IT SHIPPED BROKEN. A find-and-replace meant to add one
 * field to `shape()` matched twice — `resolver: envelope.via || "none"` also
 * appears here — and put `it.checked` into this object, where `it` is a
 * parameter of a different function. Every share came back
 * `{"ok":false,"error":"it is not defined"}`, and nothing caught it, because
 * the only test of this file exercised `shape()` and never built a response.
 *
 * Now it is a function with a test, so the same slip fails in milliseconds
 * instead of on somebody's phone.
 */
export function summary({ url, envelope = {}, items = [], cover = null, read = [], handles = [], article = null }) {
  return {
    ok: true,
    url,
    resolver: envelope.via || "none",
    caption_chars: (envelope.caption || "").length,
    // Read the picture? Checked anything? Without these, "why did this come
    // back thin" needs a second request to answer — and the diagnose workflow
    // prints this JSON verbatim.
    saw_image: !!cover,
    checked_items: needsCheck(read).length,
    tagged_handles: handles.length,
    // Counted for the same reason: "no article on this item" is either a page
    // with no body or a body that had no item to ride on, and those are two
    // different conversations.
    article_chars: article?.text?.length || 0,
    items,
  };
}

// What the two routes call out to. Named and passed in for ONE reason: so the
// selftest can run a whole request — not just the helpers — with the network
// swapped out. This file has already shipped a route that no test ever built.
const IO = { resolveShare, imageBlock, classifyShare, classifyImage, verifyItems, enrich, articleFor, extractProduct };

// (`_url` is the parsed request URL serve.js hands every route; unused here.)
export async function resolveRoute(req, res, body, _url, io = IO) {
  const url = canonicalUrl(body?.url);
  if (!url) return json(res, 400, { ok: false, error: "a http(s) url is required" });
  const list = normList(body?.list);

  const envelope = await io.resolveShare(url);

  // A LIST POST THAT TAGS RATHER THAN NAMES. Measured on a real one: the
  // caption was "10 lovely bookshops … Bookshops featured: @a @b @c @d @e @f
  // @g @h" — eight places, none of them written out.
  //
  // This used to fetch each profile to turn the handle into a name. It does
  // not any more: from Render those fetches return a 429 or a login wall, so
  // the call cost eight round trips and returned an empty array (see
  // resolve.js). The handles go to the classifier as text instead, which is
  // what was resolving them correctly all along.
  //
  // COUNTED, not acted on. When a tag-list post comes back with no items, the
  // first question is whether it was a tag-list post at all, and this answers
  // it without another request.
  const handles = handlesIn(envelope.caption).filter((h) => h !== envelope.authorHandle);

  // What this build can draw. A shelf the person tapped is one it has, said
  // or not — nobody can pick a tile their build did not paint.
  const has = [...shelvesOf(body?.shelves), list];
  const fit = (it) => ({ ...it, list: fitShelf(it.list, has) });

  // A SHOP PAGE, when the person did not pick a shelf — or picked Wishlist,
  // which is the same request said out loud, and must not cost them the price
  // by sending the page to the classifier instead. If they picked any OTHER
  // shelf (a novel on a bookshop's site, filed under Books) the tap wins and
  // the page is read the ordinary way. A parser that throws costs the product
  // and nothing else — the share falls through to the classifier.
  if (envelope.html && (list === "unsorted" || list === "wishlist")) {
    let product = null;
    try { product = io.extractProduct(envelope.html, url); } catch (_) { /* not a product, then */ }
    if (product) {
      const item = productItem(product, envelope, url, { shelves: has });
      return json(res, 200, summary({ url, envelope, items: [item], read: [], handles }));
    }
  }

  // THE PICTURE, NOT JUST THE WORDS. The scrape has always returned a
  // thumbnail URL and this endpoint has always filed it away unopened. Half
  // the shares that used to land nameless carry the name in print — on a
  // cover, a poster, a shopfront, a menu — and a caption of "📚✨ ugh this
  // one" over a photograph of PIRANESI is a resolvable share.
  //
  // Fetched in parallel with nothing, because the scrape has already finished
  // by here; ~200 kB and a fraction of a second, and null on any failure.
  const cover = await io.imageBlock(envelope.imageUrl);

  // THE ARTICLE, started now and collected after the items exist. It cannot
  // reject (see articleFor), so there is nothing to catch and no unhandled
  // promise; it runs alongside the classifier because the summary is a second
  // model call and the person is watching a row say "working it out".
  const reading = io.articleFor(envelope, url);

  const read = (envelope.caption || cover) ? await io.classifyShare(envelope, list, cover) : [];

  // AND THEN CHECK THE UNSURE ONES. See classify.js — the failure this exists
  // for is a confidently wrong name, which is indistinguishable from a right
  // one everywhere downstream. Only items below the confidence bar are looked
  // up, and a failure here returns them untouched.
  const checked = await io.verifyItems(read, envelope);

  const homeCity = String(body?.home_city || "").slice(0, 80) || null;
  const article = await reading;
  const shaped = [];
  for (const it of checked) {
    // `fit`: the classifier knows shelves an older build does not have. What
    // it files there goes to that build's pile instead of to nowhere.
    shaped.push(fit(shape(await io.enrich(it, { outboundUrls: envelope.outboundUrls, homeCity }), envelope, url)));
  }
  // ONE COPY. A "10 best books" page is ten items and one article; carrying
  // 60,000 characters on each of them is 600 kB in a file the phone rewrites
  // on every save. The first item holds it and the rest share its source_url.
  const items = onArticlePage(shaped, envelope, article).map((it, i) => carry(it, { article: i === 0 ? article : null }));

  // AN ARTICLE THAT IS NOT A BOOK, A FILM OR A PLACE IS STILL WORTH KEEPING.
  // The classifier names things for six shelves; an essay names none of them,
  // so it used to come back as zero items and the text was thrown away — the
  // one case reading mode exists for. It lands on the pile instead, under the
  // page's own title, with the article on it.
  if (!items.length && article) {
    const title = String(envelope.caption || "").split("\n")[0].trim() || null;
    items.push(carry(shape({ list, title, subtitle: article.siteName || "", confidence: null }, envelope, url), { article }));
  }

  // An empty array is a legitimate, honest answer: the link is real, nothing
  // nameable came out of it. The device keeps the row unresolved and can ask
  // again later — which is a decision for the phone, not for this endpoint.
  return json(res, 200, summary({ url, envelope, items, cover, read, handles, article }));
}

/** The path that never touches Meta: share a screenshot, read it with vision. */
export async function resolveImageRoute(req, res, body, _url, io = IO) {
  const b64 = String(body?.image_b64 || "").replace(/^data:[^,]*,/, "");
  if (!b64) return json(res, 400, { ok: false, error: "image_b64 required" });
  if (b64.length > 6 * 1024 * 1024) {
    return json(res, 413, { ok: false, error: "image too large — downscale before sending" });
  }
  const list = normList(body?.list);
  const envelope = { caption: "", imageUrl: null, locationTag: null, authorHandle: null,
                     outboundUrls: [], via: "screenshot" };
  const { items: read, ocr_text } = await io.classifyImage(b64, String(body?.media_type || "image/jpeg").slice(0, 40), list);
  const has = [...shelvesOf(body?.shelves), list];
  const items = [];
  for (const it of read) {
    const shaped = shape(await io.enrich(it, {}), envelope, null);
    items.push(carry({ ...shaped, list: fitShelf(shaped.list, has) }, { ocr_text }));
  }
  return json(res, 200, { ok: true, resolver: "screenshot", ocr_chars: ocr_text.length, items });
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  const env = { caption: "cap", imageUrl: "https://cdn/x.jpg", via: "crawler-embed-html", outboundUrls: [] };
  const s = shape({ list: "movies", title: "T", confidence: 0.9, enriched: true, canonical: { tmdb_id: 1 } },
                  env, "https://insta/reel/x/");
  ok(s.title === "T" && s.resolver === "crawler-embed-html", "shape carries title and resolver");
  ok(s.image_url === "https://cdn/x.jpg", "envelope image fills in when the enricher had none");
  ok(s.caption === "cap", "the caption goes back to the device rather than being stored here");
  ok(!("id" in s) && !("user_id" in s) && !("status" in s),
     "NO id, NO user, NO status — those are the device's to decide now");
  ok(shape({ list: "nonsense", title: "T" }, env).list === "unsorted", "list normalised");

  // THE RESPONSE BODY. Every share returned `{"ok":false,"error":"it is not
  // defined"}` because a field referencing `shape()`'s parameter was pasted
  // into this object too. Building it here is the whole guard.
  {
    let threw = null, out = null;
    try {
      out = summary({ url: "https://insta/p/x/", envelope: env, items: [s],
                      cover: { type: "image" }, read: [{ confidence: 0.5 }], handles: ["a"] });
    } catch (e) { threw = e.message; }
    ok(threw === null, "building the response body does not throw", threw);
    ok(out?.ok === true && out?.items?.length === 1, "and it carries the items", out);
    ok(out?.saw_image === true, "it reports whether the picture was read");
    ok(out?.checked_items === 1, "and how many items were looked up", out?.checked_items);
    ok(summary({ url: "u" }).saw_image === false, "no cover, no claim to have read one");
    ok(!("checked" in summary({ url: "u" })), "the per-item verdict belongs on the item, not the envelope");
  }

  // ── THE ARTICLE AND THE SCREENSHOT'S TEXT ──────────────────────────────────
  {
    const p = "A sentence long enough to count as a real paragraph of prose, written out in full to be sure. ";
    const page = `<html><head><meta property="og:site_name" content="Field Notes"></head><body><article>${`<p>${p}</p>`.repeat(8)}</article></body></html>`;
    // The caption NAMES both books: on an article page, an item the page never
    // mentions is dropped (onArticlePage), so the fixture has to mention them.
    const web = { caption: "Two books: One and Two", via: "web-og", html: page, outboundUrls: [] };

    const a = await articleFor(web, "https://fieldnotes.example/x", { summarise: async () => "It says this." });
    ok(Object.keys(a || {}).join() === "byline,siteName,text,readingMinutes,excerpt,hero,summary",
       "the article carries EXACTLY the seven names the app reads", Object.keys(a || {}).join());
    ok(a?.summary === "It says this." && a?.siteName === "Field Notes" && a?.text.startsWith("A sentence long enough"), "filled from the page and the summary");
    ok(a?.byline === null && a?.hero === null, "what the page did not say is null, not undefined — undefined vanishes from JSON");

    // NEVER THE REASON A SHARE FAILS. Each of these used to be a way to turn a
    // resolved item into `{"ok":false}`.
    const noSum = await articleFor(web, "https://fieldnotes.example/x", { summarise: async () => { throw new Error("529 overloaded"); } });
    ok(noSum?.text && noSum.summary === null, "a summary call that throws costs the summary, not the article", noSum);
    let threw = null, none;
    try { none = await articleFor(web, "u", { extract: () => { throw new Error("regex blew up"); } }); } catch (e) { threw = e.message; }
    ok(threw === null && none === null, "an extractor that throws costs the article, not the share", threw);
    ok(await articleFor({ caption: "a reel", via: "embed-json" }, "https://instagram.com/reel/x/", { extract: () => ({ text: "WRONG" }) }) === null,
       "an Instagram share has no page, so nothing is extracted from it");
    let asked = false;
    await articleFor(web, "u", { extract: () => null, summarise: async () => { asked = true; return "s"; } });
    ok(asked === false, "no body, no summary call — a page with no article does not cost a request");
    ok((await articleFor(web, "u", { summarise: async () => "" })).summary === null, "an empty summary is null");

    // enrich() REPLACES canonical. Attached before it, the article is dropped
    // on precisely the items a catalogue recognised.
    const book = shape({ list: "books", title: "T", enriched: true, canonical: { isbn: "978" } }, env, "u");
    const got = carry(book, { article: a });
    ok(got.canonical.article === a && got.canonical.isbn === "978", "the article joins the provider's canonical, it does not replace it", got.canonical);
    ok(!("article" in book.canonical), "and the item it was given is not mutated");
    ok(!("article" in carry(book, { article: null }).canonical) && !("ocr_text" in carry(book, { ocr_text: "" }).canonical),
       "nothing to read → the key is absent, not null and not ''");
    ok(carry(book, { ocr_text: "PIRANESI" }).canonical.ocr_text === "PIRANESI" && carry(book, { ocr_text: "PIRANESI" }).canonical.isbn === "978",
       "a screenshot's text rides on canonical too");
    ok(carry({ title: "bare" }, { ocr_text: "x" }).canonical.ocr_text === "x", "an item with no canonical at all still gets one");

    ok(summary({ url: "u", article: a }).article_chars === a.text.length && summary({ url: "u" }).article_chars === 0,
       "the response says whether a body was found, items or no items");

    // ── A WHOLE REQUEST, both routes, network swapped out ────────────────────
    const fakeRes = () => ({ writeHead(s) { this.status = s; }, end(b) { this.body = JSON.parse(b); } });
    const io = {
      resolveShare: async () => web,
      imageBlock: async () => null,
      classifyShare: async () => [{ list: "books", title: "One", confidence: 0.9 }, { list: "books", title: "Two", confidence: 0.9 }],
      verifyItems: async (items) => items,
      // What enrich() really does to canonical: a hit replaces it, a miss empties it.
      enrich: async (it) => (it.title === "One" ? { ...it, enriched: true, canonical: { isbn: "978" } } : { ...it, enriched: false, canonical: {} }),
      articleFor,   // the real one: the page is under the summary threshold, so no model call
    };
    const r1 = fakeRes();
    await resolveRoute({}, r1, { url: "https://fieldnotes.example/x", list: "books" }, null, io);
    ok(r1.status === 200 && r1.body?.items?.length === 2, "a web share resolves", r1.body);
    ok(r1.body?.items?.[0]?.canonical?.article?.text?.startsWith("A sentence long enough") && !("article" in r1.body.items[1].canonical),
       "the FIRST item from an article page carries the article, and only the first", r1.body?.items?.map((it) => Object.keys(it.canonical)));
    ok(r1.body?.items?.[0]?.canonical?.isbn === "978", "next to what the catalogue said, not instead of it");
    ok(r1.body?.article_chars > 0 && !("html" in (r1.body || {})) && !JSON.stringify(r1.body).includes("<article>"),
       "and the page's HTML does not leak into the response");

    // ── the page is the evidence ─────────────────────────────────────────────
    {
      const env = { caption: "How to Do Great Work\n\nJuly 2023", via: "web-og" };
      const art = { text: "If you collected lists of techniques for doing great work, what would the intersection look like? The swifts were late. Piranesi is the best book I read this year." };
      const wrong = { list: "books", title: "Hackers & painters", enriched: true };
      const named = { list: "books", title: "Piranesi: A Novel", enriched: true };
      const self = { list: "books", title: "How to Do Great Work", enriched: false };
      ok(onArticlePage([wrong, named], env, art).map((i) => i.title).join() === "Piranesi: A Novel",
         "a catalogue match the page never mentions is dropped; one it names is kept, subtitle and all");
      ok(onArticlePage([self], env, art)[0].list === "unsorted", "an unmatched item that is just the headline is the article, not a book");
      ok(onArticlePage([{ ...self, enriched: true }], env, art)[0].list === "books", "a headline the catalogue DID match stays on its shelf");
      ok(onArticlePage([wrong], env, null).length === 1, "no article, no evidence: a reel's items are left alone");
      ok(onArticlePage([{ list: "books", title: "Swift", enriched: true }], env, art).length === 0,
         "whole words only: 'Swift' is not found inside 'swifts'");
      ok(onArticlePage([{ list: "unsorted", title: null }], env, art).length === 1, "a nameless item is not dropped for having no name");
    }

    // ── a thing to buy ───────────────────────────────────────────────────────
    {
      const prod = { name: "Wool overshirt", brand: "Northfield", price: 65, currency: "GBP", priceText: "£65.00",
                     image: "https://shop.example/a.jpg", availability: "in_stock", seller: "Northfield", url: "https://shop.example/overshirt" };
      const shopIo = { ...io, extractProduct: () => prod, classifyShare: async () => { throw new Error("the classifier must not run for a product page"); } };
      const p1 = fakeRes();
      await resolveRoute({}, p1, { url: "https://shop.example/overshirt" }, null, shopIo);
      const it = p1.body?.items?.[0];
      ok(p1.body?.items?.length === 1 && it.title === "Wool overshirt" && it.canonical.kind === "product"
         && it.canonical.price === 65 && it.canonical.price_text === "£65.00" && it.canonical.shop_url === prod.url,
         "a shop page is one item with its price, and no model call", p1.body);
      ok(it.list === "unsorted", "a build that did not say it has a Wishlist shelf gets it in the pile, where it can be seen", it.list);
      const p2 = fakeRes();
      await resolveRoute({}, p2, { url: "https://shop.example/overshirt", shelves: ["books", "wishlist"] }, null, shopIo);
      ok(p2.body?.items?.[0]?.list === "wishlist", "a build that has the shelf gets it on the shelf", p2.body?.items?.[0]?.list);
      // Picking Wishlist on a shop page is asking for exactly this. It used to
      // skip the product reader (the tap "won") and lose the price.
      const p2b = fakeRes();
      await resolveRoute({}, p2b, { url: "https://shop.example/overshirt", list: "wishlist" }, null, shopIo);
      ok(p2b.body?.items?.[0]?.list === "wishlist" && p2b.body.items[0].canonical.price === 65,
         "a shop page shared TO the Wishlist keeps its price, and no model call", p2b.body?.items?.[0]);
      // The classifier knows the wishlist too. A build that does not have the
      // shelf must get the item in its pile, not on a shelf it cannot draw.
      const wishIo = { ...io, classifyShare: async () => [{ list: "wishlist", title: "One", confidence: 0.9 }] };
      const c1 = fakeRes();
      await resolveRoute({}, c1, { url: "https://fieldnotes.example/x" }, null, wishIo);
      ok(c1.body?.items?.[0]?.list === "unsorted", "a classifier-made wishlist item goes to the PILE of a build with no Wishlist shelf", c1.body?.items?.[0]?.list);
      const c2 = fakeRes();
      await resolveRoute({}, c2, { url: "https://fieldnotes.example/x", shelves: ["books", "wishlist", "nonsense", 7] }, null, wishIo);
      ok(c2.body?.items?.[0]?.list === "wishlist", "and onto the shelf of a build that has one", c2.body?.items?.[0]?.list);
      ok(!("price" in (c2.body?.items?.[0]?.canonical ?? {})), "with no price: only a shop page read by product.js has one");
      const c3 = fakeRes();
      await resolveRoute({}, c3, { url: "https://fieldnotes.example/x", shelves: [] }, null, io);
      ok(c3.body?.items?.every((i) => i.list === "books"), "an empty `shelves` is a build that said nothing: the first six are still its shelves", c3.body?.items?.map((i) => i.list));
      const c4 = fakeRes();
      await resolveRoute({}, c4, { url: "https://fieldnotes.example/x", shelves: ["gadgets", 7, null] }, null, io);
      ok(c4.body?.items?.every((i) => i.list === "books"), "and so is one that names only shelves nobody has heard of", c4.body?.items?.map((i) => i.list));
      const p3 = fakeRes();
      await resolveRoute({}, p3, { url: "https://shop.example/overshirt", list: "books" }, null, { ...io, extractProduct: () => prod });
      ok(p3.body?.items?.every((i) => i.list === "books" && i.canonical.kind !== "product"),
         "a shelf the person picked wins over the shop page", p3.body?.items?.map((i) => i.list));
      const p4 = fakeRes();
      await resolveRoute({}, p4, { url: "https://fieldnotes.example/x" }, null, { ...io, extractProduct: () => { throw new Error("boom"); } });
      ok(p4.status === 200 && p4.body?.items?.length === 2, "a product parser that throws does not fail the share", p4.body);
      ok(typeof it.canonical.price_at === "string" && !Number.isNaN(Date.parse(it.canonical.price_at)), "the price carries the day it was read");
    }

    const r0 = fakeRes();
    await resolveRoute({}, r0, { url: "https://fieldnotes.example/x" }, null, { ...io, classifyShare: async () => [] });
    ok(r0.body?.items?.length === 1 && r0.body.items[0].list === "unsorted" && r0.body.items[0].title
       && r0.body.items[0].canonical?.article?.text, "an article that fits no shelf is kept on the pile, with its text", r0.body?.items);
    const rNone = fakeRes();
    await resolveRoute({}, rNone, { url: "https://fieldnotes.example/x" }, null,
      { ...io, classifyShare: async () => [], articleFor: async () => null });
    ok(rNone.body?.items?.length === 0, "and a page with no article and no items is still an honest empty answer", rNone.body?.items);

    const r2 = fakeRes();
    await resolveRoute({}, r2, { url: "https://fieldnotes.example/x" }, null,
      { ...io, articleFor: (e, u) => articleFor(e, u, { extract: () => { throw new Error("boom"); } }) });
    ok(r2.status === 200 && r2.body?.items?.length === 2 && !("article" in r2.body.items[0].canonical),
       "a share whose article extraction blows up still comes back, without the article", r2.body);

    const shot = async (ocr_text) => {
      const r = fakeRes();
      await resolveImageRoute({}, r, { image_b64: "AAAA", list: "books" }, null,
        { ...io, classifyImage: async () => ({ items: [{ list: "books", title: "Piranesi", confidence: 0.9 }], ocr_text }) });
      return r;
    };
    const r3 = await shot("PIRANESI\nSusanna Clarke");
    ok(r3.status === 200 && r3.body?.items?.[0]?.canonical?.ocr_text === "PIRANESI\nSusanna Clarke",
       "a screenshot's item carries the text read off it", r3.body);
    ok(r3.body?.ocr_chars === 23, "and the response counts it", r3.body?.ocr_chars);
    ok(!("ocr_text" in (await shot("")).body.items[0].canonical), "a picture with no words adds no key");
  }

  console.log(fail ? `resolveRoute selftest FAILED (${fail})` : "resolveRoute selftest ok");
  process.exit(fail ? 1 : 0);
}
