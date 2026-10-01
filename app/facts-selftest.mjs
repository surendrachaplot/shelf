// facts-selftest.mjs — the rows and links a catalogue produces.
//
// A SEPARATE FILE on purpose. `src/facts.js` has no imports so that the app,
// this test and the server can all read it; giving it an inline `--selftest`
// block would mean referencing `process` from a file the phone loads. Its own
// header has claimed "a node selftest checks it" since the day it was written,
// and until the map buttons turned out to be broken on iOS, that was a claim
// with nothing behind it.
import { factsFor, hasFacts, mapUrl, STOCK } from "./src/facts.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

const stJohn = {
  list: "restaurants", title: "St. John",
  canonical: { lat: 51.5203, lng: -0.1027, city: "London", address: "26 St John St",
               opening_hours: "Mo-Sa 12:00-23:00", cuisine: ["British"],
               // The Android link the server stores. Kept, and never read.
               map_url: "geo:51.5203,-0.1027?q=St.%20John" },
};
const bookBar = { list: "places", title: "Book Bar", canonical: { city: "London", located: false } };

// ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
// `geo:` is Android-only. iOS silently opens nothing, which is how both the
// restaurant Map button and travel's "Find on map" shipped dead on an iPhone.
for (const item of [stJohn, bookBar]) {
  const ios = mapUrl(item, "ios");
  ok(!/^geo:/.test(ios), `${item.title}: iOS must never be handed a geo: URI`, ios);
  ok(/^https:\/\/maps\.apple\.com\//.test(ios), `${item.title}: iOS gets an Apple Maps link`, ios);
}
ok(mapUrl(stJohn, "android") === "geo:51.5203,-0.1027?q=St.%20John", "Android keeps geo:, on the pin", mapUrl(stJohn, "android"));
ok(mapUrl(bookBar, "android") === "geo:0,0?q=Book%20Bar%2C%20London", "Android, no pin: a search", mapUrl(bookBar, "android"));

// Neither phone: the public page, opened on anything. A geo: link in a browser
// is a dead link, so this one has to be https.
for (const item of [stJohn, bookBar]) {
  const web = mapUrl(item, null);
  ok(/^https:\/\//.test(web), `${item.title}: the web gets an https map`, web);
}

ok(mapUrl(stJohn, "ios").includes("ll=51.5203,-0.1027"), "a located place opens ON the pin");
ok(mapUrl(bookBar, "ios").includes("Book%20Bar%2C%20London"), "an unlocated one searches for name + city");
ok(mapUrl({ list: "places", title: "", canonical: {} }, "ios") === null, "nothing to search for → no link at all");

// ── the rows ────────────────────────────────────────────────────────────────
const r = factsFor(stJohn, { platform: "ios" });
ok(r.rows.some((x) => x.label === "Address"), "a restaurant shows its address");
ok(r.links.some((x) => x.label === "Map"), "and a Map link");
ok(!r.rows.some((x) => !x.value), "RULE 1: never a row with an empty value");

const t = factsFor(bookBar, { platform: "ios" });
ok(t.links.some((x) => x.label === "Find on map"),
   "an unlocated place says Find on map — labelling it Map makes an approximate result feel broken");
ok(factsFor({ list: "quotes", title: "x", canonical: { author: "Lily Tomlin" } }).rows.length === 1,
   "a quote's facts are who said it, and not the quote printed twice");
ok(hasFacts(stJohn) && !hasFacts({ list: "books", title: "x", canonical: {} }),
   "hasFacts saves drawing a rule above nothing");

// ── a thing to buy ──────────────────────────────────────────────────────────
// The same rows wherever it stands: on a build with no Wishlist shelf it is in
// the pile as "unsorted", and it must still say what it costs.
const shirt = (list, extra = {}) => ({ list, title: "Wool overshirt", canonical: {
  kind: "product", price: 65, currency: "GBP", price_text: "£65", brand: "Northfield",
  availability: "in_stock", seller: "Northfield", shop_url: "https://shop.example/overshirt", ...extra } });
for (const list of ["wishlist", "unsorted"]) {
  const p = factsFor(shirt(list));
  ok(p.rows[0]?.label === "Price" && p.rows[0]?.value === "£65", `${list}: the price is the first row`, p.rows);
  ok(p.links.some((x) => x.label === "Open the shop" && x.url === "https://shop.example/overshirt"), `${list}: and the shop opens`, p.links);
}
// THE ITEM PAGE SAYS THE PRICE ONCE. It draws it large, above the table, and
// asks for the table without it — the rest of the rows must be untouched.
{
  const p = factsFor(shirt("wishlist", { seller: "Liberty" }), { price: false });
  ok(!p.rows.some((x) => x.label === "Price"), "price:false leaves the Price row out", p.rows);
  ok(p.rows.map((x) => x.label).join() === "Brand,Stock,Sold by" && p.links.some((x) => x.label === "Open the shop"),
     "and keeps the brand, the stock, the seller and the shop", p.rows.map((x) => x.label));
  ok(factsFor(shirt("wishlist"), { platform: "ios" }).rows[0]?.label === "Price", "any other option leaves the price where it was");
  ok(STOCK.in_stock === "In stock" && STOCK.out_of_stock === "Sold out", "the item page reads stock from the same table the row does", STOCK);
}
ok(!factsFor(shirt("wishlist", { price: null, price_text: null })).rows.some((x) => x.label === "Price"),
   "no price → no Price row, never a guess or a dash");
ok(factsFor(shirt("wishlist", { availability: "out_of_stock" })).rows.some((x) => x.value === "Sold out"), "stock is said in plain words");
ok(!factsFor(shirt("wishlist")).rows.some((x) => x.label === "Sold by"), "the seller is not repeated when it is the brand");
ok(factsFor(shirt("wishlist", { seller: "Liberty" })).rows.some((x) => x.label === "Sold by" && x.value === "Liberty"), "a different seller is named");
ok(!factsFor({ list: "books", title: "x", canonical: { price_text: "£9" } }).rows.some((x) => x.label === "Price"),
   "a price on something that is not a product is not shown — only kind:product is a thing to buy");

console.log(fail ? `facts selftest FAILED (${fail})` : "facts selftest ok");
process.exit(fail ? 1 : 0);
