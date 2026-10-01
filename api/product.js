// product.js — the thing somebody wants to buy, and what it costs.
//
// A shared shop page is a coat, a lipstick, a lamp. The person saving it wants
// two things back later: which one it was, and the price. The shop already
// wrote both down for search engines, in three places of falling quality, and
// this reads them out.
//
//   extractProduct(html, url)
//     → { name, brand, price, currency, priceText, image, availability, seller, url } | null
//   formatPrice(price, currency, high?) → "£45.00" | "$20 to $35" | null
//   parsePrice(raw)                     → number | null
//
// Pure functions over HTML. No network, no DOM, no dependency.
//
// ── WHERE A PRICE MAY COME FROM ─────────────────────────────────────────────
//
//   1. JSON-LD `Product` / `ProductGroup` — authored, typed, one per product.
//   2. Open Graph / product meta — `product:price:amount`, `og:price:amount`.
//   3. Microdata — `itemprop="price"` inside the one `itemtype=…/Product`.
//
// And NOWHERE ELSE. Never the `<span class="price">`, never a "£45" in a
// sentence. A page has a dozen numbers with a currency sign in front of them —
// the crossed-out price, the delivery threshold, the thing in "you may also
// like" — and nothing but structure says which one is the price.
//
// ── THE RULE THAT MATTERS MORE THAN COVERAGE ────────────────────────────────
//
// A WRONG PRICE IS WORSE THAN NO PRICE. A coat saved at £45 that costs £450
// looks exactly like a coat saved correctly. So:
//
//   · a number that can be read two ways is not read (see parsePrice);
//   · two sources that disagree cancel out — the product comes back with
//     `price: null`, which the app can draw as "see the shop";
//   · a page that is not ONE product page is null. A category page has forty
//     products and a first one, and the first one is not what was saved.
import { readFileSync } from "node:fs";
import { isMain } from "./ismain.js";
import { parseLd, metaTag, stripTags, decodeEntities } from "./resolve.js";

// Same ceiling as article.js, for the same reason: every pass is a regex over
// the whole string.
const MAX_HTML = 3_000_000;

const ISO = new Set(Intl.supportedValuesOf("currency"));

// Only the signs that mean ONE currency. "$" is twenty currencies and "¥" is
// two, and guessing USD for a Canadian shop is a wrong price with a right
// number in it. "kr", "zł" and "Fr" are words, and a rule that strips words
// from in front of a number also strips "from" and "ab".
const SIGN = { "£": "GBP", "€": "EUR", "₹": "INR" };

// ── the number ───────────────────────────────────────────────────────────────

const MONEY = /^(\p{Sc}|[A-Z]{3})?\s*(\d(?:[\d.,\s'’]*\d)?)\s*(\p{Sc}|[A-Z]{3})?$/u;
const GROUPS = {
  ".": /^\d{1,3}(?:\.\d{3})+$/,
  // 1,299,000 — and 1,29,900, which is how every shop in India writes it.
  ",": /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})$/,
};

/**
 * One price FIELD → { n, cur } or null. `cur` is the currency the string
 * itself names ("£45", "45.00 EUR"), or null.
 *
 * What is read:
 *   1299  "1299"  "45.00"  "45,5"      plain, or one separator and 1–2 decimals
 *   "1,299.00"  "1.299,00"             both separators: the LAST is the decimal
 *   "1.299.000"  "1,29,900"            one separator, repeated: thousands
 *   "1 299,00"  "1'299.00"             a space or an apostrophe is thousands
 *   "£45"  "45,00 €"  "USD 20"         a currency sign or ISO code at either end
 *
 * What is AMBIGUOUS, and so is null:
 *   "1.299" and "1,299" — ONE separator and exactly three digits after it.
 *     A German shop means 1299. schema.org says "." is the decimal point, so
 *     the spec means 1.299. A shop that stores prices before tax means 1.30.
 *     There is a factor of a thousand between the readings and nothing in the
 *     string to choose with. NOT GUESSED, for either separator.
 *   More than two decimals, as a string ("16.6583") or a JSON number (1.299).
 *     Either a pre-tax figure nobody is charged, or the case above after a
 *     template dropped the quotes. This also refuses real three-decimal
 *     prices (KWD, BHD, OMR 12.500) — the cost of the rule, taken knowingly.
 *
 * And what is not a price at all: zero (a shop's "ask us"), a negative, a
 * range ("20 - 35"), or anything with a word in it ("from 45", "45/month").
 */
function money(raw) {
  if (typeof raw === "number") {
    return raw > 0 && Number.isFinite(raw) && Math.round(raw * 100) / 100 === raw ? { n: raw, cur: null } : null;
  }
  if (typeof raw !== "string") return null;
  const m = MONEY.exec(raw.trim());
  if (!m) return null;
  const mark = m[1] || m[3] || null;
  if (mark && /^[A-Z]{3}$/.test(mark) && !ISO.has(mark)) return null;

  const s = m[2].replace(/[\s'’](?=\d{3}(?:\D|$))/g, "");

  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  const both = dot >= 0 && comma >= 0;
  const last = dot > comma ? "." : ",";
  let int = s, dec = "";
  if (both || s.split(last).length === 2) {
    const parts = s.split(last);
    if (parts.length !== 2) return null;                  // "1,299.00.50"
    [int, dec] = parts;
    if (dec.length > 2) return null;                      // the ambiguous three, and beyond
  }
  const sep = /[.,]/.exec(int)?.[0];
  if (sep) {
    if (!GROUPS[sep].test(int)) return null;              // "1,299,00"
    int = int.split(sep).join("");
  }
  const n = Number(dec ? `${int}.${dec}` : int);
  return n > 0 && Number.isFinite(n) ? { n, cur: SIGN[mark] || (ISO.has(mark) ? mark : null) } : null;
}

export const parsePrice = (raw) => money(raw)?.n ?? null;

/**
 * The string a person reads. `high` makes it a range.
 *
 * English formatting, always: the server does not know who is reading, and
 * "€1,299.00" is understood everywhere where "1.299,00 €" is not. A single
 * price keeps its pence ("£45.00", as on the shop's own label); a range drops
 * them when there are none ("$20 to $35"), because four zeros in one line is
 * noise. With no currency it is the bare number — never a guessed sign.
 */
export function formatPrice(price, currency, high) {
  if (!(Number.isFinite(price) && price > 0)) return null;
  const fmt = (n, lean) => (ISO.has(currency)
    ? new Intl.NumberFormat("en", { style: "currency", currency, trailingZeroDisplay: lean ? "stripIfInteger" : "auto" })
    : new Intl.NumberFormat("en", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
  ).format(n);
  return high > price ? `${fmt(price, true)} to ${fmt(high, true)}` : fmt(price, false);
}

// ── small things ─────────────────────────────────────────────────────────────

const one = (s, max = 200) => (typeof s === "string" || typeof s === "number"
  ? stripTags(String(s)).replace(/\s+/g, " ").trim().slice(0, max) : "") || null;

// Same as article.js's, which does not export it.
function absolute(src, base) {
  if (!src || typeof src !== "string") return null;
  try {
    const u = new URL(src.trim(), base || undefined);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch (_) {
    return null;
  }
}

// schema.org/InStock, "http://schema.org/OutOfStock", "instock", "oos".
const STOCK = [
  ["in_stock", /(instock|limitedavailability|onlineonly)$/],
  ["preorder", /(preorder|presale)$/],
  ["out_of_stock", /(outofstock|soldout|discontinued|^oos)$/],
];
// One product, many offers: a coat is in stock if ANY size is. In that order —
// in stock beats pre-order beats sold out.
function stock(values) {
  const seen = values.map((v) => String(v ?? "").toLowerCase().replace(/[^a-z]/g, ""));
  for (const [state, re] of STOCK) if (seen.some((v) => re.test(v))) return state;
  return null;
}

// A CLAIM is what one source says the price is:
//   null                      it states no price
//   { span: null, cur }       it states one, and it cannot be read with certainty
//   { span: [low, high], cur } it states one; low === high unless it is a range
// `cur` is every currency it named, raw.
const claim = (said, cur) => {
  if (!said.length) return null;
  const read = said.map(money);
  const ok = read.every((r) => r && r.n === read[0].n);
  return { span: ok ? [read[0].n, read[0].n] : null, cur: [...cur, ...read.map((r) => r?.cur)] };
};

// ── 1. JSON-LD ───────────────────────────────────────────────────────────────

const typesOf = (n) => [].concat(n["@type"] || []).map((t) => String(t).replace(/^.*[/:#]/, ""));

// EVERY Product on the page, not the first. resolve.js's `parseLd` stops at
// the first hit, which is the right answer to "is there a recipe here" and the
// wrong one to "is this page about one thing". Same reach as its `findNode` —
// arrays and @graph — plus `mainEntity`, where big retailers hang the product
// off a WebPage/ItemPage. NOT `itemListElement`: the "you may also like"
// carousel is the other products, and it does not make the page a listing.
function ldProducts(html) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typesOf(n).some((t) => t === "Product" || t === "ProductGroup")) return out.push(n);
    walk(n["@graph"]);
    walk(n.mainEntity);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch (_) { /* a broken block is no block; see the malformed fixture */ }
  }
  return out;
}

// The offers of one product. A Shopify `ProductGroup` keeps them one level
// down, on each variant.
const offersOf = (p) => [].concat(p.offers || [], [].concat(p.hasVariant || []).flatMap((v) => v?.offers || []))
  .flatMap((o) => (o && typeof o === "object" ? [o, ...[].concat(o.offers || []).filter((x) => x && typeof x === "object")] : []));

// A priceSpecification entry that is the price PAID. Not the list price that
// is drawn crossed out, not the members' price, and not the "£3.20 per 100ml"
// that sits beside the real one.
const paid = (s) => s && typeof s === "object" && s.price != null
  && (!s.priceType || /SalePrice$/i.test(String(s.priceType)))
  && !s.referenceQuantity && !s.validForMemberTier;

function ldClaim(product) {
  const spans = [], cur = [];
  let stated = false;
  for (const o of offersOf(product)) {
    cur.push(o.priceCurrency);
    if (o.lowPrice != null || o.highPrice != null) {
      // AggregateOffer. A missing end is the other end, not zero.
      const lo = money(o.lowPrice ?? o.highPrice), hi = money(o.highPrice ?? o.lowPrice);
      stated = true;
      spans.push(lo && hi && lo.n <= hi.n ? [lo.n, hi.n] : null);
      cur.push(lo?.cur, hi?.cur);
      continue;
    }
    const specs = [].concat(o.priceSpecification || []).filter(paid);
    const c = claim([o.price, ...specs.map((s) => s.price)].filter((v) => v != null && v !== ""),
      specs.map((s) => s.priceCurrency));
    if (!c) continue;
    stated = true;
    spans.push(c.span);
    cur.push(...c.cur);
  }
  if (!stated) return null;
  // Several offers at several prices is sizes or sellers: a range, honestly
  // labelled. One offer that cannot be read spoils the lot — the cheapest
  // READABLE variant is not the cheapest variant.
  const span = spans.every(Boolean) ? [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))] : null;
  return { span, cur };
}

// ── 2. meta tags ─────────────────────────────────────────────────────────────

function metaClaim(html) {
  const amount = metaTag(html, "product:price:amount") || metaTag(html, "og:price:amount");
  if (!amount) return null;
  // Facebook's catalogue tags: `price` is the regular price and `sale_price`
  // the reduced one, with dates this page may or may not be inside. When both
  // are there and differ, which one is charged TODAY is not on the page.
  const sale = metaTag(html, "product:sale_price:amount");
  return claim(sale ? [amount, sale] : [amount],
    [metaTag(html, "product:price:currency"), metaTag(html, "og:price:currency"), sale && metaTag(html, "product:sale_price:currency")]);
}

// ── 3. microdata ─────────────────────────────────────────────────────────────

const PRODUCT_SCOPE = /<[a-z][a-z0-9]*\b[^>]*\bitemtype=["']?https?:\/\/schema\.org\/Product["']?[^>]*>/gi;

// Every value of one itemprop, in page order, with where it was found: the
// `content` / `href` / `src` attribute when there is one (that is what the
// microdata spec reads), else the element's text.
//
// ponytail: no DOM, so the text runs to the FIRST `</tag>` — an element that
// nests its own tag name is cut short. Prices and names are leaves; if a real
// page breaks this, the upgrade is article.js's `closeOf`, exported.
function props(scope, name) {
  const re = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bitemprop=["']?${name}["']?(?=[\\s>/])[^>]*>`, "gi");
  const out = [];
  for (const m of scope.matchAll(re)) {
    const attr = /\s(?:content|href|src)=["']([^"']*)["']/i.exec(m[0]);
    const from = m.index + m[0].length;
    const end = scope.slice(from).search(new RegExp(`</${m[1]}\\s*>`, "i"));
    out.push({ at: m.index, value: attr ? decodeEntities(attr[1]) : stripTags(end < 0 ? "" : scope.slice(from, from + end)) });
  }
  return out;
}

// ── the page ─────────────────────────────────────────────────────────────────

export function extractProduct(html, url) {
  if (!html) return null;
  html = String(html).slice(0, MAX_HTML);

  // ONE PAGE, ONE PRODUCT, OR NOTHING.
  //
  // A page that says it is a collection is one, even on the day it has a
  // single product in it.
  if (parseLd(html, /\b(CollectionPage|SearchResultsPage)\b/)) return null;

  // Two JSON-LD products with two names is a listing. Two with ONE name is a
  // theme and a reviews plugin both describing the same coat, and they are
  // held to the same rule as any other two sources: agree, or no price.
  const nodes = ldProducts(html);
  if (new Set(nodes.map((n) => one(n.name)?.toLowerCase()).filter(Boolean)).size > 1) return null;
  const ld = nodes[0] || null;

  // Microdata gets the same test. More than one Product scope and it is not
  // used at all — on a listing that leaves nothing, and on a product page with
  // "related items" marked up it leaves the better sources to speak.
  const scopes = [...html.matchAll(PRODUCT_SCOPE)];
  const micro = scopes.length === 1 ? html.slice(scopes[0].index) : null;

  const ogType = (metaTag(html, "og:type") || "").trim();
  // "product", "og:product", "product.item". NOT "product.group", which is
  // Facebook's own word for a listing.
  const shopType = /^(og:)?product(\.item)?$/i.test(ogType);

  const claims = [
    nodes.length ? nodes.map(ldClaim).reduce((a, b) => {
      // The same product described twice: both must say the same thing.
      if (!a || !b) return a || b;
      return { span: a.span && b.span && a.span[0] === b.span[0] && a.span[1] === b.span[1] ? a.span : null, cur: [...a.cur, ...b.cur] };
    }) : null,
    metaClaim(html),
    micro ? claim(props(micro, "price").map((p) => p.value).filter(Boolean), props(micro, "priceCurrency").map((p) => p.value)) : null,
  ];

  // WHAT MAKES IT A PRODUCT PAGE. Something has to be FOR SALE here:
  //   · a JSON-LD Product with offers. Without offers it is a review — an
  //     article ABOUT a kettle carries a Product node too, for the stars;
  //   · or og:type=product;
  //   · or a price in the meta tags, on a page that does not call itself an
  //     article (an affiliate write-up does both);
  //   · or the one microdata Product, with a price in it.
  const forSale = (ld && offersOf(ld).length) || shopType
    || (claims[1] && !/^article/i.test(ogType)) || claims[2];
  if (!forSale) return null;

  // THE PRICE. The most trusted source that states one decides whether it can
  // be read at all; nothing below it is allowed to rescue it. Every source
  // below that CAN be read has to agree — equal, or inside the range.
  const stated = claims.filter(Boolean);
  let span = stated[0]?.span || null;
  for (const c of stated.slice(1)) {
    if (span && c.span && !(span[0] <= c.span[0] && c.span[1] <= span[1])) span = null;
  }
  // The currency likewise: one answer across everything that names one. "£45"
  // under `priceCurrency: EUR` is two answers, and then the number is not
  // trusted either — 45 of WHAT is the whole question.
  const curs = new Set(stated.flatMap((c) => c.cur)
    .map((c) => String(c ?? "").trim()).map((c) => SIGN[c] || c.toUpperCase()).filter((c) => ISO.has(c)));
  const currency = curs.size === 1 ? [...curs][0] : null;
  if (curs.size > 1) span = null;

  // Name: the first microdata `name` only counts if it comes BEFORE any nested
  // scope opens. After that it may be the brand's name, or a reviewer's.
  const inner = micro ? micro.slice(1).search(/<[^>]+\bitemscope\b/i) + 1 : 0;
  const microName = micro && props(micro, "name").find((p) => !inner || p.at < inner)?.value;
  const name = one(ld?.name) || one(microName) || one(metaTag(html, "og:title"));
  if (!name) return null;

  const offers = ld ? nodes.flatMap(offersOf) : [];
  const brand = [].concat(ld?.brand || [])[0];
  const img = [].concat(ld?.image || [])[0];
  const seller = offers.map((o) => (typeof o.seller === "string" ? o.seller : o.seller?.name)).find(Boolean);
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html)?.[0].match(/href=["']([^"']*)["']/i)?.[1];

  return {
    name,
    brand: one(typeof brand === "object" ? brand?.name : brand, 80) || one(metaTag(html, "product:brand"), 80)
      || one(micro && props(micro, "brand")[0]?.value, 80),
    price: span ? span[0] : null,
    currency,
    priceText: span ? formatPrice(span[0], currency, span[1]) : null,
    image: absolute(typeof img === "object" ? img?.url || img?.contentUrl : img, url)
      || absolute(metaTag(html, "og:image"), url) || absolute(micro && props(micro, "image")[0]?.value, url),
    availability: stock(offers.map((o) => o.availability))
      || stock([metaTag(html, "product:availability"), metaTag(html, "og:availability")])
      || (micro ? stock(props(micro, "availability").map((p) => p.value)) : null),
    seller: one(seller, 120) || one(metaTag(html, "og:site_name"), 120),
    url: absolute(ld?.url, url) || absolute(metaTag(html, "og:url"), url)
      || absolute(canonical && decodeEntities(canonical), url) || absolute(url),
  };
}

// ── selftest ─────────────────────────────────────────────────────────────────
// Saved pages, not the network. Each fixture is a shape of shop page, and each
// assertion was watched to fail with its defence removed.
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (cond, label, extra) => { if (!cond) { fail++; console.error("FAIL", label, extra ?? ""); } };
  const fx = (name) => readFileSync(new URL(`./fixtures/product/${name}.html`, import.meta.url), "utf8");
  const page = (ld, head = "") => `<html><head>${head}<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
  const coat = (offers, more = {}) => ({ "@context": "https://schema.org", "@type": "Product", name: "Coat", offers, ...more });
  const U = "https://shop.example/p/coat";

  // ── the number ─────────────────────────────────────────────────────────────
  for (const [raw, want] of [
    [1299, 1299], [45.5, 45.5], ["1299", 1299], ["45.00", 45], ["45,5", 45.5], ["1299,00", 1299],
    ["1,299.00", 1299], ["1.299,00", 1299], ["1.299.000", 1299000], ["1,299,000.50", 1299000.5],
    ["1,29,900.00", 129900], ["1 299,00", 1299], ["1 299", 1299], ["1'299.00", 1299],
    ["£45", 45], ["45,00 €", 45], ["USD 20", 20], [" £45 ", 45],
  ]) ok(parsePrice(raw) === want, `parsePrice reads ${JSON.stringify(raw)}`, parsePrice(raw));
  for (const [raw, why] of [
    ["1.299", "one dot and three digits: 1299 in Berlin, 1.299 by the spec"],
    ["1,299", "one comma and three digits: 1299 in Boston, 1.299 in Bonn"],
    [1.299, "a JSON number with three decimals is the same doubt with the quotes off"],
    ["16.6583", "four decimals is a pre-tax figure nobody is charged"],
    ["1,299.000", "three decimals stay refused when both separators are there"],
    ["1,299,00", "groups of the wrong size are not thousands"],
    ["1,299.00.50", "a decimal separator comes once"],
    ["12 34", "a space that is not before three digits splits two numbers"],
    ["from 45", "a word in front makes it somebody's starting price"],
    ["45.", "a number has to end in a digit"],
    ["ABC 45", "three capitals that are not a currency are a word"],
    [0, "zero is a shop's way of saying ask us"], ["0.00", "and so is zero as a string"],
    [-5, "a negative price is a discount line"], [Infinity, "infinity is not a number anybody pays"],
    [["45", "50"], "a list of two prices is not 45,50"],
  ]) ok(parsePrice(raw) === null, `parsePrice refuses ${raw === Infinity ? raw : JSON.stringify(raw)} — ${why}`, parsePrice(raw));

  // ── the string ─────────────────────────────────────────────────────────────
  ok(formatPrice(45, "GBP") === "£45.00", "a single price keeps its pence", formatPrice(45, "GBP"));
  ok(formatPrice(1299, "EUR") === "€1,299.00", "English grouping whatever the currency", formatPrice(1299, "EUR"));
  ok(formatPrice(4800, "JPY") === "¥4,800", "a currency with no minor unit has no decimals", formatPrice(4800, "JPY"));
  ok(formatPrice(20, "USD", 35) === "$20 to $35", "a range drops the empty pence", formatPrice(20, "USD", 35));
  ok(formatPrice(20.5, "USD", 35) === "$20.50 to $35", "and keeps the ones that are not empty", formatPrice(20.5, "USD", 35));
  ok(formatPrice(45, "GBP", 45) === "£45.00", "a range from 45 to 45 is a price", formatPrice(45, "GBP", 45));
  ok(formatPrice(1299.5, null) === "1,299.50", "no currency, no sign — the bare number", formatPrice(1299.5, null));
  ok(formatPrice(45, "QQQ") === "45", "a code Intl would accept but nobody mints is no currency", formatPrice(45, "QQQ"));
  ok(formatPrice(null, "GBP") === null && formatPrice(0, "GBP") === null && formatPrice("45", "GBP") === null,
     "no price, no string");

  // ── a Shopify product ──────────────────────────────────────────────────────
  const shopify = extractProduct(fx("shopify"), "https://kilnandthread.example/products/harbour-smock?variant=4410");
  ok(shopify?.name === "Harbour Smock — Men's, Ochre", "name: entities decoded", shopify?.name);
  ok(shopify?.price === 68 && shopify?.currency === "GBP" && shopify?.priceText === "£68.00",
     "three variants at one price is one price, not a range", [shopify?.price, shopify?.currency, shopify?.priceText]);
  ok(shopify?.brand === "Kiln & Thread", "brand from a Brand object", shopify?.brand);
  ok(shopify?.image === "https://cdn.kilnandthread.example/s/files/harbour-smock-ochre_1200x.jpg",
     "a protocol-relative image takes the page's scheme", shopify?.image);
  ok(shopify?.availability === "in_stock", "one size sold out and two in stock is in stock", shopify?.availability);
  ok(shopify?.seller === "Kiln & Thread", "with no seller in the offers the site is the seller", shopify?.seller);
  ok(shopify?.url === "https://kilnandthread.example/products/harbour-smock", "the product's own url, without the variant", shopify?.url);
  ok(Object.keys(shopify || {}).join() === "name,brand,price,currency,priceText,image,availability,seller,url", "the shape, exactly");
  {
    const off = extractProduct(fx("shopify").replace('og:price:amount" content="68.00"', 'og:price:amount" content="54.00"'), U);
    ok(off && off.name === shopify.name && off.price === null && off.priceText === null,
       "JSON-LD says 68 and the meta tag says 54: a product, and no price", off?.price);
    const cur = extractProduct(fx("shopify").replace('og:price:currency" content="GBP"', 'og:price:currency" content="EUR"'), U);
    ok(cur && cur.price === null && cur.currency === null, "the same number in two currencies is no price and no currency", [cur?.price, cur?.currency]);
    const loose = extractProduct(fx("shopify").replace('og:price:amount" content="68.00"', 'og:price:amount" content="1.068"'), U);
    ok(loose?.price === 68, "a lower source that cannot be read is not a disagreement", loose?.price);
  }

  // ── a WooCommerce product ──────────────────────────────────────────────────
  const woo = extractProduct(fx("woocommerce"), "https://fernhillpottery.example/product/stoneware-jug/");
  ok(woo?.name === "Stoneware Jug, 1 Litre", "the Product is in the SECOND ld+json block, after Yoast's", woo?.name);
  ok(woo?.price === 89 && woo?.priceText === "£89.00", "price and priceSpecification say the same thing once", [woo?.price, woo?.priceText]);
  ok(woo?.seller === "Fernhill Pottery Ltd", "seller from the offer, which knows the company's name", woo?.seller);
  ok(woo?.brand === null, "no brand, no brand");
  ok(woo?.image === "https://fernhillpottery.example/wp-content/uploads/2026/03/jug-oat.jpg", "image from the JSON-LD, not og:image's crop", woo?.image);
  ok(woo?.url === "https://fernhillpottery.example/product/stoneware-jug/", "url", woo?.url);
  ok(extractProduct(fx("woocommerce").replace('"price":"89.00","priceValidUntil"', '"price":"95.00","priceValidUntil"'), U)?.price === null,
     "an offer whose price and priceSpecification differ has no price");

  // ── @graph, AggregateOffer ─────────────────────────────────────────────────
  const range = extractProduct(fx("graph-range"), "https://www.marlowoutfitters.example/p/trail-bottle/88213?color=blue&cm_mmc=ig");
  ok(range?.name === "Trail Bottle, Insulated", "the Product inside @graph, under mainEntity", range?.name);
  ok(range?.price === 20 && range?.priceText === "$20 to $35" && range?.currency === "USD",
     "lowPrice is the price and the string says it is a range", [range?.price, range?.priceText]);
  ok(range?.brand === "Marlow", "brand as a plain string", range?.brand);
  ok(range?.image === "https://img.marlowoutfitters.example/88213/main.jpg", "image from an ImageObject", range?.image);
  ok(range?.url === "https://www.marlowoutfitters.example/p/trail-bottle/88213", "a relative url is made absolute", range?.url);
  ok(extractProduct(fx("graph-range").replace('"lowPrice": "20.00"', '"lowPrice": "40.00"'), U)?.price === null,
     "a range that runs backwards is not a range");
  {
    const tag = (n) => fx("graph-range").replace("</head>", `<meta property="product:price:amount" content="${n}"><meta property="product:price:currency" content="USD"></head>`);
    ok(extractProduct(tag("25.00"), U)?.priceText === "$20 to $35", "a meta price INSIDE the range is the selected size, and agrees");
    ok(extractProduct(tag("50.00"), U)?.price === null, "a meta price outside the range does not");
  }
  ok(extractProduct(fx("graph-range").replace('"@type": "ItemPage"', '"@type": "CollectionPage"'), U) === null,
     "a page that calls itself a collection is one, even with a single product on it");

  // ── meta tags only ─────────────────────────────────────────────────────────
  const meta = extractProduct(fx("meta-only"), "https://lumenandoak.example/shop/desk-lamp-brass?utm_source=ig");
  ok(meta?.name === "Arc Desk Lamp, Brass" && meta?.price === 45 && meta?.currency === "GBP" && meta?.priceText === "£45.00",
     "og:title and product:price:* are enough", [meta?.name, meta?.priceText]);
  ok(meta?.brand === "Lumen & Oak" && meta?.availability === "in_stock", "product:brand and product:availability", [meta?.brand, meta?.availability]);
  ok(meta?.image === "https://lumenandoak.example/media/arc-brass.jpg" && meta?.seller === "Lumen & Oak", "og:image and og:site_name", [meta?.image, meta?.seller]);
  ok(meta?.url === "https://lumenandoak.example/shop/desk-lamp-brass", "og:url beats the shared url and its tracking", meta?.url);
  ok(extractProduct(fx("meta-only").replace(/<link rel="canonical"[^>]*>/, ""), "https://lumenandoak.example/shop/desk-lamp-brass?utm_source=ig")?.url
       === "https://lumenandoak.example/shop/desk-lamp-brass", "og:url alone is enough");
  ok(extractProduct(fx("meta-only").replace("<meta property=\"og:url\" content=\"https://lumenandoak.example/shop/desk-lamp-brass\">", ""),
       "https://lumenandoak.example/shop/desk-lamp-brass?utm_source=ig")?.url === "https://lumenandoak.example/shop/desk-lamp-brass",
     "with no og:url the canonical link is the url");
  ok(extractProduct(fx("meta-only").replace('content="45.00"', 'content="£45"').replace(/<meta property="product:price:currency"[^>]*>/, ""), U)?.currency === "GBP",
     "£ with no currency tag is pounds");
  ok(extractProduct(fx("meta-only").replace('content="45.00"', 'content="$45"').replace(/<meta property="product:price:currency"[^>]*>/, ""), U)?.priceText === "45",
     "$ with no currency tag is twenty currencies, so none");
  ok(extractProduct(fx("meta-only").replace('content="45.00"', 'content="USD 45"').replace(/<meta property="product:price:currency"[^>]*>/, ""), U)?.priceText === "$45.00",
     "an ISO code inside the amount is a currency");
  {
    const bare = extractProduct(fx("meta-only").replace(/<meta property="product:price:[^>]*>/g, ""), U);
    ok(bare?.name === "Arc Desk Lamp, Brass" && bare.price === null && bare.currency === null && bare.priceText === null,
       "og:type=product with no price anywhere is a product with no price", bare);
    ok(extractProduct(fx("meta-only").replace('content="product"', 'content="website"'), U)?.price === 45,
       "and a price tag makes a product of a page whose og:type is the theme's default");
  }
  ok(extractProduct(fx("meta-only").replace('content="45.00"', 'content="£45"').replace('content="GBP"', 'content="EUR"'), U)?.price === null,
     "£45 under a EUR tag is two answers");
  ok(extractProduct(fx("meta-only").replace("</head>", '<meta property="product:sale_price:amount" content="36.00"></head>'), U)?.price === null,
     "a sale_price that differs from price: which is charged today is not on the page");
  ok(extractProduct(fx("meta-only").replace('content="product"', 'content="product.group"').replace(/<meta property="product:[^>]*>/g, ""), U) === null,
     "og:type product.group is a listing");
  ok(extractProduct(fx("meta-only").replace('content="product"', 'content="article"'), U) === null,
     "an article with a price tag is an affiliate write-up, not a shop");
  ok(extractProduct(fx("meta-only").replace(/<meta property="og:title"[^>]*>/, ""), U) === null, "a product with no name is nothing");

  // ── microdata only ─────────────────────────────────────────────────────────
  const micro = extractProduct(fx("microdata"), "https://www.oldmillyarns.example/yarn/shetland-4ply-peat.html");
  ok(micro?.name === "Shetland 4-ply, Peat", "itemprop=name", micro?.name);
  ok(micro?.price === 7.5 && micro?.currency === "GBP" && micro?.priceText === "£7.50",
     "the content attribute is the price, not the text beside it", [micro?.price, micro?.priceText]);
  ok(micro?.brand === "Old Mill" && micro?.availability === "in_stock", "brand text and <link itemprop=availability>", [micro?.brand, micro?.availability]);
  ok(micro?.image === "https://www.oldmillyarns.example/media/yarn/shetland-peat.jpg", "itemprop=image src, made absolute", micro?.image);
  ok(extractProduct(fx("microdata").replace(' content="7.50">£7.50 a ball', ">£7.50"), U)?.price === 7.5, "with no content attribute the element's text is read, sign and all");
  ok(extractProduct(fx("microdata").replace("</body>", '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Other</span><span itemprop="price" content="9.00">9</span></div></body>'), U) === null,
     "two microdata Products is a listing");
  ok(extractProduct(fx("microdata").replace("</body>", '<span itemprop="price" content="9.00">9</span></body>'), U)?.price === null,
     "two different itemprop=price in one product: no price");
  ok(extractProduct(fx("microdata").replace('<h1 itemprop="name">Shetland 4-ply, Peat</h1>', "<h1>Shetland 4-ply, Peat</h1>"), U) === null,
     "the only itemprop=name left is inside the brand's scope, and a brand is not a product name");

  // ── out of stock ───────────────────────────────────────────────────────────
  const gone = extractProduct(fx("out-of-stock"), "https://redcurrantbeauty.example/products/cream-blush-fig");
  ok(gone?.availability === "out_of_stock" && gone?.price === 22 && gone?.currency === "EUR" && gone?.priceText === "€22.00",
     "sold out, and still €22", [gone?.availability, gone?.priceText]);
  ok(extractProduct(fx("out-of-stock").replace("https://schema.org/OutOfStock", "https://schema.org/PreOrder"), U)?.availability === "preorder", "PreOrder");
  ok(extractProduct(fx("out-of-stock").replace("https://schema.org/OutOfStock", "https://schema.org/BackOrder"), U)?.availability === null,
     "a state that is none of the three is null, not a guess");

  // ── a sale price beside a crossed-out original ─────────────────────────────
  const sale = extractProduct(fx("sale"), "https://tannerandrow.example/product/weekend-holdall/");
  ok(sale?.price === 60 && sale?.priceText === "£60.00", "the ListPrice entry is the crossed-out one, and is not the price", [sale?.price, sale?.priceText]);
  ok(extractProduct(fx("sale").replace('"priceType":"https://schema.org/ListPrice"', '"referenceQuantity":{"@type":"QuantitativeValue","value":"100","unitCode":"MLT"}'), U)?.price === 60,
     "a per-100ml unit price is not the price either");
  ok(extractProduct(fx("sale").replace('"priceType":"https://schema.org/ListPrice"', '"validForMemberTier":{"@type":"MemberProgramTier","name":"Gold"}'), U)?.price === 60,
     "nor is the members' price");

  // ── pages that are NOT one product ─────────────────────────────────────────
  ok(extractProduct(fx("article"), "https://www.tidewater.example/money/the-45-pound-kettle") === null,
     "an article that says £45 in every paragraph is not a product");
  ok(extractProduct(fx("article").replace('"@type": "NewsArticle"', '"@type": "Product", "name": "Kettle", "aggregateRating": {"ratingValue": 4}'), U) === null,
     "a Product with stars and no offers is a review");
  ok(extractProduct(fx("listing"), "https://fernhillpottery.example/product-category/jugs/") === null,
     "a category page is not its first product");
  ok(extractProduct(page([coat({ price: "45.00", priceCurrency: "GBP" }), coat({ price: "45.00", priceCurrency: "GBP" })]), U)?.price === 45,
     "the same product described twice, agreeing, is one product");
  ok(extractProduct(page([coat({ price: "45.00", priceCurrency: "GBP" }), coat({ price: "50.00", priceCurrency: "GBP" })]), U)?.price === null,
     "described twice, disagreeing, it has no price — and it is not a £45 to £50 range");
  ok(extractProduct(page([coat({ price: "45.00", priceCurrency: "GBP" }),
       { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", item: { "@type": "Product", name: "Scarf", offers: { price: "9" } } }] }]), U)?.name === "Coat",
     "the products in an ItemList carousel are the other products, and do not make a listing");

  // ── malformed JSON-LD ──────────────────────────────────────────────────────
  const bad = extractProduct(fx("malformed"), "https://werkbank-leder.example/products/guertel-cognac");
  ok(bad?.name === "Ledergürtel, Cognac" && bad?.price === 1299 && bad?.currency === "EUR" && bad?.priceText === "€1,299.00",
     "an unquoted 1.299,00 breaks the JSON; the meta tags carry it, read the German way", [bad?.name, bad?.priceText]);
  ok(extractProduct(fx("malformed").replace(/<meta property="og:(type|price:[a-z]+)"[^>]*>/g, ""), U) === null,
     "broken JSON-LD and no product meta is no product — nothing is fished out of the wreck");
  ok(extractProduct(`<html><script type="application/ld+json">{"@type":"Product",,}</script>${page(coat({ price: 30, priceCurrency: "GBP" }))}`, U)?.price === 30,
     "a broken block does not stop the next one being read");

  // ── offers, the long tail ──────────────────────────────────────────────────
  const of = (offers, more) => extractProduct(page(coat(offers, more)), U);
  ok(of([{ price: 20, priceCurrency: "GBP" }, { price: 35, priceCurrency: "GBP" }])?.priceText === "£20 to £35", "sizes at different prices are a range");
  ok(of([{ price: 20, priceCurrency: "GBP" }, { price: "1.299", priceCurrency: "GBP" }])?.price === null, "one unreadable offer spoils the range");
  ok(of({ price: "1.299", priceCurrency: "EUR" })?.price === null && of({ price: "1.299", priceCurrency: "EUR" })?.currency === "EUR",
     "an ambiguous price is null and the product still comes back");
  ok(extractProduct(page(coat({ price: "1.299", priceCurrency: "EUR" }), '<meta property="og:price:amount" content="1299.00">'), U)?.price === null,
     "an unreadable JSON-LD price is not rescued by the meta tag below it");
  ok(of({ "@type": "AggregateOffer", lowPrice: 30, priceCurrency: "GBP" })?.priceText === "£30.00", "a lowPrice with no highPrice is one price");
  ok(of({ "@type": "AggregateOffer", priceCurrency: "GBP", offers: [{ price: 12 }, { price: 18 }] })?.priceText === "£12 to £18", "an AggregateOffer that only nests its offers");
  ok(of({ priceSpecification: { price: "45.00", priceCurrency: "GBP" } })?.priceText === "£45.00", "a price that lives only in priceSpecification");
  ok(of({ price: 45, priceSpecification: { price: "1.299" } })?.price === null, "an offer whose second figure cannot be read is not an offer with one figure");
  ok(extractProduct(page({ "@type": "schema:Product", name: "Coat", offers: { price: 45 } }), U)?.price === 45
     && extractProduct(page({ "@type": ["http://schema.org/Product", "Thing"], name: "Coat", offers: { price: 45 } }), U)?.price === 45,
     "a prefixed @type, and one in an array, is still a Product");
  ok(of({ price: 45, priceCurrency: "gbp" })?.currency === "GBP", "a lower-case currency code");
  ok(of({ price: 45, priceCurrency: "£" })?.currency === "GBP", "a sign where the code belongs");
  ok(of({ price: 45, priceCurrency: "Pounds" })?.currency === null && of({ price: 45, priceCurrency: "Pounds" })?.priceText === "45",
     "a currency that is not ISO 4217 is no currency");
  ok(of({ price: 45, priceCurrency: "GBP", seller: { name: "x".repeat(500) } }, { name: "y".repeat(500), brand: "z".repeat(500) })
       ?.seller?.length === 120, "seller is capped");
  ok(of({ price: 45 }, { name: "y".repeat(500) })?.name?.length === 200 && of({ price: 45 }, { brand: "z".repeat(500) })?.brand?.length === 80, "name and brand are capped");
  ok(of({ price: 45 }, { name: "<b>Wool</b> coat &amp; <i>hat</i>" })?.name === "Wool coat & hat", "tags are stripped from a name and entities decoded");
  ok(of({ price: 45 }, { image: "javascript:alert(1)", url: "data:text/html,x" })?.image === null, "an image that is not http(s) is no image");
  ok(of({ price: 45 }, { url: "javascript:alert(1)" })?.url === U, "a url that is not http(s) falls back to the page's");
  ok(extractProduct(page(coat({ price: 45 })), "ftp://x.example/a")?.url === null, "and that has to be http(s) too");
  const group = extractProduct(page({ "@type": "ProductGroup", name: "Tee", hasVariant: [
    { "@type": "Product", name: "Tee S", offers: { price: 18, priceCurrency: "GBP", availability: "https://schema.org/OutOfStock" } },
    { "@type": "Product", name: "Tee M", offers: { price: 18, priceCurrency: "GBP", availability: "https://schema.org/InStock" } }] }), U);
  ok(group?.name === "Tee" && group?.price === 18 && group?.availability === "in_stock", "a ProductGroup is one product, priced by its variants", [group?.name, group?.price]);

  console.log(fail ? `product selftest FAILED (${fail})` : "product selftest ok");
  process.exit(fail ? 1 : 0);
}
