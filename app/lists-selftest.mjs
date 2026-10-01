// lists-selftest.mjs — a list somebody made, asserted.
//
// A SEPARATE FILE, same reason as tags-selftest.mjs: `src/lists.js` is plain
// JS the phone loads, and an inline `--selftest` block would mean touching
// `process` from it.
//
// What is checked here is what a screenshot cannot show: that a pin stays
// where it was put, that an operation with nothing to do hands back the SAME
// array (so nothing is saved), that a saved search finds what Find finds, and
// that pounds are never added to yen.
//
// EVERY ASSERTION WAS WATCHED TO FAIL with the line it defends broken. Run
// from checks.yml, NOT from package.json `scripts`: Expo's fingerprint hashes
// that block into the runtime version.
import {
  NAME_MAX, VIEWS, makeList, renameList, removeList, setView, setQuery,
  pin, unpin, togglePin, movePin, itemsOf, prune, listsWith,
  priceOf, priceText, priceOn, totalOf, shelfTotal,
} from "./src/lists.js";
import { searchShelf } from "./src/find.js";
import { LIST_KEYS } from "./src/design.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

const T = "2026-01-01T00:00:00.000Z";
const item = (o) => ({
  id: o.id, list: o.list, status: o.status || "filed", title: o.title ?? null,
  subtitle: o.subtitle || "", note: "", image_url: null,
  canonical: o.canonical || {}, confidence: 1, enriched: true,
  source_url: null, resolver: "test", created_at: o.created_at || T,
});
const ids = (xs) => xs.map((x) => x.id).join();

// ── THE SHELF. One of everything, in the shapes the server sends ────────────
const piranesi = item({ id: "p", list: "books", title: "Piranesi", subtitle: "Susanna Clarke",
  canonical: { author: "Susanna Clarke", year: 2020, subjects: ["Fantasy"], price: 9.99, currency: "GBP" } });
const sinners = item({ id: "s", list: "movies", title: "Sinners", subtitle: "Ryan Coogler · 2025",
  canonical: { year: "2025", director: "Ryan Coogler", genres: ["Horror"] } });
const ganapati = item({ id: "g", list: "restaurants", title: "Ganapati", subtitle: "South indian · Peckham",
  canonical: { area: "Peckham", cuisine: ["South indian"], lat: 51.47, lng: -0.07 } });
const belem = item({ id: "b", list: "places", title: "Belém", subtitle: "Belém · Lisbon",
  canonical: { city: "Lisbon", area: "Belém", located: true }, created_at: "2026-02-01T00:00:00.000Z" });
const market = item({ id: "m", list: "places", title: "Time Out Market", subtitle: "Cais do Sodré · Lisbon",
  canonical: { city: "Lisbon", area: "Cais do Sodré", located: true }, created_at: "2026-03-01T00:00:00.000Z" });
const dal = item({ id: "d", list: "recipes", title: "Lemon dal", subtitle: "45 min · 4 servings",
  canonical: { author: "Meera Sodha", cuisine: "Indian", total_time: "45 min" } });
const quote = item({ id: "q", list: "quotes", title: "Attention is the beginning of devotion.", subtitle: "Mary Oliver" });
// A saved article: filed, and on no shelf. The city is only in its text.
const essay = item({ id: "e", list: "unsorted", title: "A week by the Tagus", subtitle: "Field Notes",
  canonical: { article: { byline: "R. Okafor", siteName: "Field Notes", text: "We landed in Lisbon on a Tuesday and did not leave the hill for three days.", summary: "A slow week." } } });
// A link nobody has read yet. No title, no facts — and it can still be pinned.
const pending = item({ id: "z", list: "unsorted", status: "pending" });
// Things to buy, in the shape api/product.js sends: a number, an ISO code, and
// the shop's own label beside them. They stand on the Wishlist shelf.
const product = (id, title, price, currency, price_text) => item({ id, list: "wishlist", title,
  canonical: { kind: "product", price, currency, price_text, brand: "Maker", availability: "in_stock", shop_url: `https://shop.example/${id}` } });
const lamp = product("w1", "Anglepoise lamp", 120, "GBP", "£120.00");
const chair = product("w2", "Bentwood chair", 349.5, "EUR", "€349.50");
const knife = product("w3", "Petty knife", 12000, "JPY", "¥12,000");
// A note: an item whose words are the whole of it.
const jotting = item({ id: "n", list: "notes", title: "Brown boots, not black.", note: "Brown boots, not black. Ask Maya about the scarf.",
  canonical: { kind: "note" } });
const SHELF = [piranesi, sinners, ganapati, belem, market, dal, quote, essay, pending, lamp, chair, knife, jotting];

const list = (id, extra = {}) => ({ id, name: id, pins: [], query: null, view: "pictures", created_at: T, ...extra });

// ── EVERY SHELF, derived — "a fixture that stops at four shelves cannot show
// you the fifth". Add a shelf to LIST_KEYS and this fails until it has a
// fixture here.
for (const key of LIST_KEYS) {
  const it = SHELF.find((x) => x.list === key);
  ok(!!it, `${key}: there is a fixture for this shelf`);
  const made = it && pin([list("a")], "a", it.id);
  ok(!!it && ids(itemsOf(made[0], SHELF)) === it.id, `${key}: a thing on this shelf can be pinned and comes back`, made && made[0]);
}

// ── making one ───────────────────────────────────────────────────────────────
{
  const l = makeList("  Lisbon   trip ", { now: T, id: "l1" });
  ok(l.name === "Lisbon trip", "the name is trimmed, and a run of spaces is one space", l.name);
  ok(l.id === "l1", "an id that is handed in is the id", l.id);
  ok(l.created_at === T, "created_at is the `now` it was given", l.created_at);
  ok(Array.isArray(l.pins) && l.pins.length === 0 && l.query === null, "a new list has no pins and no saved search", l);
  ok(l.view === "pictures" && VIEWS.includes(l.view), "and opens as pictures", l.view);
  ok(Object.keys(l).sort().join() === "created_at,id,name,pins,query,view", "exactly the six fields the file keeps", Object.keys(l));
}
for (const [label, bad] of [["an empty string", ""], ["only spaces", "   \n "], ["null", null], ["undefined", undefined], ["a number", 7]]) {
  ok(makeList(bad, { now: T }) === null, `no name → no list: ${label}`, makeList(bad, { now: T }));
}
ok(NAME_MAX === 60 && makeList("x".repeat(80), { now: T }).name.length === 60, "a name is capped at 60", makeList("x".repeat(80), { now: T }).name.length);
ok(makeList("   " + "x".repeat(60), { now: T }).name.length === 60, "spaces in front are not counted toward the 60", makeList("   " + "x".repeat(60), { now: T }).name.length);
{
  // The 60th character is an emoji, which is TWO UTF-16 units. A cut by unit
  // keeps half of it.
  const name = makeList("a".repeat(59) + "😀" + "b", { now: T }).name;
  ok(name.endsWith("😀") && Array.from(name).length === 60, "the cap counts characters — it never leaves half an emoji", name.slice(-3));
  const spaced = makeList("a".repeat(59) + " bbb", { now: T }).name;
  ok(spaced === "a".repeat(59), "a cut that lands on a space does not keep the space", spaced.length);
}
{
  const a = makeList("One"), b = makeList("Two");
  ok(/^l_[a-z0-9]{6,}$/.test(a.id) && a.id !== b.id, "no id handed in → it makes one, and not the same one twice", [a.id, b.id]);
  ok(!Number.isNaN(Date.parse(a.created_at)) && Math.abs(Date.parse(a.created_at) - Date.now()) < 60000, "no `now` handed in → the clock", a.created_at);
  let threw = null, l = null;
  try { l = makeList("Three", { now: "not a date" }); } catch (e) { threw = e.message; }
  ok(threw === null && !!l && !Number.isNaN(Date.parse(l.created_at)), "a `now` that is not a date does not throw", threw);
  ok(makeList("Four", { now: Date.parse(T) }).created_at === T && makeList("Five", { now: new Date(T) }).created_at === T,
     "`now` can be milliseconds or a Date");
}

// ── the operations ───────────────────────────────────────────────────────────
// Two lists. A has three pins in an order that is NOT the shelf's order; B is
// only a saved search.
const L = [list("a", { name: "Weekend", pins: ["g", "p", "s"] }), list("b", { name: "Lisbon", query: "lisbon", view: "rows" })];
const SNAP = JSON.stringify(L);
// Rule 1, asserted after every operation rather than once at the end: the
// input is exactly what it was, and what came back is a different array.
const fresh = (out, label) => {
  ok(out !== L, `${label}: hands back a NEW array`);
  ok(JSON.stringify(L) === SNAP, `${label}: and leaves the one it was given alone`, L);
};
const same = (out, label) => ok(out === L, `${label} → the SAME array, so nothing is saved`, out);

{
  const out = renameList(L, "a", "  Porto ");
  ok(out[0].name === "Porto", "rename: the list has the new name, trimmed", out[0].name);
  fresh(out, "rename");
  ok(out[1] === L[1], "rename: the other list is the same object, untouched");
  ok(out[0].pins === L[0].pins && out[0].id === "a", "rename: the pins and the id come with it");
  same(renameList(L, "a", "   "), "rename to nothing");
  ok(renameList(L, "a", "   ")[0].name === "Weekend", "rename to nothing: the list keeps the name it had");
  same(renameList(L, "nope", "Porto"), "rename a list that is not there");
  same(renameList(L, "a", "Weekend"), "rename to the name it has");
  ok(renameList(L, "a", "y".repeat(90))[0].name.length === 60, "rename: capped like a new name");
}
{
  const out = removeList(L, "a");
  ok(ids(out) === "b", "remove: the list is gone and the other is not", ids(out));
  fresh(out, "remove");
  same(removeList(L, "nope"), "remove a list that is not there");
}
{
  const out = setView(L, "a", "rows");
  ok(out[0].view === "rows", "view: set", out[0].view);
  fresh(out, "view");
  same(setView(L, "a", "grid"), "a view that does not exist");
  same(setView(L, "a", "pictures"), "the view it already has");
  same(setView(L, "nope", "rows"), "view on a list that is not there");
}
{
  const out = setQuery(L, "a", "  peckham ");
  ok(out[0].query === "peckham", "query: saved, trimmed", out[0].query);
  fresh(out, "query");
  for (const [label, blank] of [["an empty string", ""], ["only spaces", "   "], ["null", null], ["a number", 7]]) {
    ok(setQuery(L, "b", blank)[1].query === null, `query: ${label} is NO saved search — null, not ""`, setQuery(L, "b", blank)[1].query);
  }
  same(setQuery(L, "b", "lisbon"), "the query it already has");
  same(setQuery(L, "a", ""), "clearing a query that is not set");
  same(setQuery(L, "nope", "x"), "query on a list that is not there");
}
{
  const out = pin(L, "a", "d");
  ok(out[0].pins.join() === "g,p,s,d", "pin: goes on the END — what was arranged stays arranged", out[0].pins);
  fresh(out, "pin");
  ok(out[1] === L[1], "pin: the other list is the same object");
  same(pin(L, "a", "p"), "pinning what is already pinned");
  same(pin(L, "nope", "p"), "pin on a list that is not there");
  same(pin(L, "a", ""), "pinning an empty id");
  same(pin(L, "a", 7), "pinning an id that is not a string");
}
{
  const out = unpin(L, "a", "p");
  ok(out[0].pins.join() === "g,s", "unpin: gone, and the rest keep their order", out[0].pins);
  fresh(out, "unpin");
  same(unpin(L, "a", "d"), "unpinning what is not pinned");
  same(unpin(L, "nope", "p"), "unpin on a list that is not there");
}
{
  const off = togglePin(L, "a", "p");
  ok(off[0].pins.join() === "g,s", "toggle: on → off", off[0].pins);
  const on = togglePin(L, "a", "d");
  ok(on[0].pins.join() === "g,p,s,d", "toggle: off → on, at the end", on[0].pins);
  fresh(on, "toggle");
  same(togglePin(L, "nope", "p"), "toggle on a list that is not there");
}
{
  ok(movePin(L, "a", "s", 0)[0].pins.join() === "s,g,p", "move: the last pin to the front", movePin(L, "a", "s", 0)[0].pins);
  ok(movePin(L, "a", "g", 2)[0].pins.join() === "p,s,g", "move: the first pin to the back", movePin(L, "a", "g", 2)[0].pins);
  ok(movePin(L, "a", "g", 1)[0].pins.join() === "p,g,s", "move: one place along — toIndex is where it ENDS UP", movePin(L, "a", "g", 1)[0].pins);
  ok(movePin(L, "a", "g", 99)[0].pins.join() === "p,s,g", "move: past the end is the end", movePin(L, "a", "g", 99)[0].pins);
  ok(movePin(L, "a", "s", -5)[0].pins.join() === "s,g,p", "move: before the start is the start", movePin(L, "a", "s", -5)[0].pins);
  ok(movePin(L, "a", "g", 1.9)[0].pins.join() === "p,g,s", "move: a position with a fraction is rounded down, not left between two pins", movePin(L, "a", "g", 1.9)[0].pins);
  fresh(movePin(L, "a", "s", 0), "move");
  same(movePin(L, "a", "p", 1), "moving a pin to where it is");
  same(movePin(L, "a", "g", -5), "moving the first pin before the start");
  same(movePin(L, "a", "s", 99), "moving the last pin past the end");
  same(movePin(L, "a", "p", 1.9), "moving a pin to a fraction past where it is");
  same(movePin(L, "a", "d", 0), "moving what is not pinned");
  same(movePin(L, "a", "p", NaN), "moving to a position that is not a number");
  same(movePin(L, "a", "p", "0"), "moving to a position that is a string");
  same(movePin(L, "nope", "p", 0), "move on a list that is not there");
}
{
  // `shelf.boards` is checked by store.ts before it gets here. This is for the
  // caller that passes something else anyway.
  let threw = null, out = null;
  try { out = [pin(null, "a", "p"), renameList(undefined, "a", "x"), removeList(null, "a"), togglePin(7, "a", "p"), prune(null, SHELF), listsWith(null, "p")]; }
  catch (e) { threw = e.message; }
  ok(threw === null && out.every((o) => Array.isArray(o) && o.length === 0), "handed no array at all: an empty one back, and no crash", threw || out);
}

// ── what is ON a list ────────────────────────────────────────────────────────
ok(ids(itemsOf(L[0], SHELF)) === "g,p,s", "pins come back in PIN order, not the shelf's (which is p,s,g)", ids(itemsOf(L[0], SHELF)));
ok(ids(itemsOf(list("x", { pins: ["g", "gone", "p"] }), SHELF)) === "g,p", "a pin whose item is gone is skipped — no hole, no crash", ids(itemsOf(list("x", { pins: ["g", "gone", "p"] }), SHELF)));
ok(ids(itemsOf(list("x", { pins: ["p", "g", "p"] }), SHELF)) === "p,g", "the same id pinned twice in the file is one thing on the list", ids(itemsOf(list("x", { pins: ["p", "g", "p"] }), SHELF)));
ok(ids(itemsOf(list("x", { pins: ["z"] }), SHELF)) === "z", "a link nobody has read yet can sit on a list", ids(itemsOf(list("x", { pins: ["z"] }), SHELF)));
{
  const got = ids(itemsOf(L[1], SHELF));
  ok(got === "m,b,e", "a saved search finds the two places AND the article that only mentions the city", got);
  ok(got === ids(searchShelf(SHELF, "lisbon").hits.map((h) => h.item)), "in exactly Find's order — one definition of found", got);
  const both = ids(itemsOf(list("x", { pins: ["b", "p"], query: "lisbon" }), SHELF));
  ok(both === "b,p,m,e", "pins first in pin order, then what the search finds — and a pinned match is not there twice", both);
  ok(ids(itemsOf(list("x", { pins: ["p"], query: "   " }), SHELF)) === "p", "a blank saved search finds nothing, not everything", ids(itemsOf(list("x", { pins: ["p"], query: "   " }), SHELF)));
  ok(itemsOf(list("x", { query: "zzzzqq" }), SHELF).length === 0, "a search that matches nothing is an empty list");
}
{
  // Find shows the best 60. A list is not a box you are still typing in.
  const many = Array.from({ length: 70 }, (_, i) => item({ id: `c${i}`, list: "places", title: `Place ${i}`, canonical: { city: "Lisbon" } }));
  ok(itemsOf(list("x", { query: "lisbon" }), many).length === 70, "a saved search is NOT cut at Find's sixty", itemsOf(list("x", { query: "lisbon" }), many).length);
}
{
  let threw = null, out = null;
  try {
    out = [itemsOf(null, SHELF), itemsOf(undefined, SHELF), itemsOf(L[0], null), itemsOf({ id: "x", pins: null, query: 7 }, SHELF)];
  } catch (e) { threw = e.message; }
  ok(threw === null && out.every((o) => Array.isArray(o) && o.length === 0), "no list, no shelf, pins that are not an array → nothing, and no crash", threw || out);
  let got = null;
  try { got = ids(itemsOf(list("x", { pins: ["p"], query: "lisbon" }), [null, { title: "no id" }, ...SHELF])); } catch (e) { got = e.message; }
  ok(got === "p,m,b,e", "a null and an id-less row in the shelf do not stop the rest", got);
}

// ── prune: the only thing that forgets a pin ─────────────────────────────────
{
  const dirty = [list("a", { pins: ["g", "gone", "p", "also-gone"] }), list("b", { pins: ["s"] })];
  const snap = JSON.stringify(dirty);
  const out = prune(dirty, SHELF);
  ok(out[0].pins.join() === "g,p", "prune: dead pins go, the live ones keep their order", out[0].pins);
  ok(out !== dirty && JSON.stringify(dirty) === snap, "prune: a new array, and the one it was given is left alone");
  ok(out[1] === dirty[1], "prune: a list with nothing dead on it is the same object");
  ok(prune(L, SHELF) === L, "prune: nothing dead anywhere → the SAME array, so nothing is saved");
  let got = "threw";
  try { got = prune([list("a", { pins: null })], SHELF)[0].pins; } catch (_) {}
  ok(got === null, "prune: pins that are not an array are not its business, and no crash", got);
}

// ── which lists is this on ───────────────────────────────────────────────────
{
  const three = [list("a", { pins: ["p", "s"] }), list("b", { query: "piranesi" }), list("c", { pins: ["g", "p"] })];
  ok(ids(listsWith(three, "p")) === "a,c", "the lists a thing is pinned on, in the lists' own order", ids(listsWith(three, "p")));
  // B's saved search finds Piranesi. Nobody PUT it on B.
  ok(!listsWith(three, "p").some((l) => l.id === "b"), "a saved search finding it is not a pin");
  ok(listsWith(three, "nope").length === 0, "pinned nowhere → no lists");
  ok(listsWith(three, "p")[0] === three[0], "they are the lists themselves, not copies");
}

// ── MONEY ────────────────────────────────────────────────────────────────────
const GB = { locale: "en-GB" };
const priced = (price, currency, id = "x") => item({ id, list: "wishlist", title: id, canonical: { price, currency } });

ok(JSON.stringify(priceOf(piranesi)) === '{"amount":9.99,"currency":"GBP"}', "a price is an amount and a currency", priceOf(piranesi));
ok(priceOf(priced(5, " gbp "))?.currency === "GBP", "the code is upper case whatever the server sent", priceOf(priced(5, " gbp ")));
ok(priceOf(priced(0, "GBP"))?.amount === 0, "ZERO is a price: free is a thing a wishlist can say", priceOf(priced(0, "GBP")));
for (const [label, bad] of [["null", null], ["absent", undefined], ["NaN", NaN], ["negative", -1], ["a string", "12.50"], ["Infinity", Infinity]]) {
  ok(priceOf(priced(bad, "GBP")) === null, `a price that is ${label} is unpriced`, priceOf(priced(bad, "GBP")));
}
for (const [label, bad] of [["missing", undefined], ["a symbol", "£"], ["a word", "POUNDS"], ["a number", 826]]) {
  ok(priceOf(priced(12, bad)) === null, `a price whose currency is ${label} is unpriced — 12 of nothing is not a price`, priceOf(priced(12, bad)));
}
{
  let got = "threw";
  try { got = [priceOf(null), priceOf({}), priceOf({ canonical: null })]; } catch (_) {}
  ok(Array.isArray(got) && got.every((p) => p === null), "no item, no canonical → no price, no crash", got);
}

ok(priceText(12.5, "GBP", GB) === "£12.50", "pence are shown when there are pence", priceText(12.5, "GBP", GB));
ok(priceText(12, "GBP", GB) === "£12", "and NOT when the amount is whole — £12, not £12.00", priceText(12, "GBP", GB));
ok(priceText(1234.5, "GBP", GB) === "£1,234.50", "thousands are grouped", priceText(1234.5, "GBP", GB));
ok(priceText(12000, "JPY", GB) === "JP¥12,000", "a currency is named the way the reader's locale names it", priceText(12000, "JPY", GB));
ok(/1\.500$/.test(priceText(1.5, "KWD", GB)), "a currency with three decimal places gets three", priceText(1.5, "KWD", GB));
ok(priceText(12.5, "USD", { locale: "en-US" }) === "$12.50" && priceText(12.5, "USD", GB) === "US$12.50", "the locale handed in is the one used", [priceText(12.5, "USD", { locale: "en-US" }), priceText(12.5, "USD", GB)]);
// The path a phone with no Intl takes. Exercised, not carried as a comfort.
ok(priceText(12.5, "GBP", { NumberFormat: null }) === "GBP 12.50", "no Intl: the code and the number, with pence", priceText(12.5, "GBP", { NumberFormat: null }));
ok(priceText(12, "GBP", { NumberFormat: null }) === "GBP 12", "no Intl: and still no .00 on a whole amount", priceText(12, "GBP", { NumberFormat: null }));

{
  const t = shelfTotal([priced(0.1, "GBP", "k"), priced(0.2, "GBP", "c")], GB);
  ok(t.byCurrency[0].amount === 0.3, "0.1 + 0.2 is 0.3 — summed in pence, not in floats", t.byCurrency[0].amount);
  ok(t.byCurrency[0].text === "£0.30", "and reads £0.30", t.byCurrency[0].text);
}
{
  const t = shelfTotal([piranesi, lamp, chair, knife, sinners], GB);
  ok(t.byCurrency.length === 3, "three currencies are three lines", t.byCurrency);
  ok(t.byCurrency.map((r) => r.currency).join() === "JPY,EUR,GBP", "largest amount first", t.byCurrency.map((r) => `${r.currency} ${r.amount}`));
  ok(t.byCurrency.map((r) => r.amount).join() === "12000,349.5,129.99", "each line is that currency's own sum — NEVER one number for two currencies", t.byCurrency.map((r) => r.amount));
  ok(t.byCurrency.map((r) => r.text).join(" + ") === "JP¥12,000 + €349.50 + £129.99", "each line has its text", t.byCurrency.map((r) => r.text));
  ok(t.priced === 4, "priced counts what went into a line", t.priced);
  ok(t.unpriced === 1, "unpriced counts what did not — the film", t.unpriced);
  ok(Object.keys(t).sort().join() === "byCurrency,priced,unpriced" && Object.keys(t.byCurrency[0]).sort().join() === "amount,currency,text", "the shape the screen reads");
}
{
  // Given dollars first, so an unsorted answer cannot pass by luck.
  const tie = shelfTotal([priced(10, "USD", "u"), priced(10, "EUR", "e")], GB);
  ok(tie.byCurrency.map((r) => r.currency).join() === "EUR,USD", "the same amount in two currencies: by code, so the lines do not swap", tie.byCurrency.map((r) => r.currency));
  ok(shelfTotal([priced(120, "GBP", "a"), priced(80, "GBP", "b")], GB).byCurrency[0].text === "£200", "a whole total has no .00", shelfTotal([priced(120, "GBP", "a"), priced(80, "GBP", "b")], GB).byCurrency[0].text);
  const mixed = shelfTotal([priced(5, "gbp", "a"), priced(7, "GBP", "b")], GB);
  ok(mixed.byCurrency.length === 1 && mixed.byCurrency[0].amount === 12, "gbp and GBP are one currency and one line", mixed.byCurrency);
  // A dinar has a thousand fils. Rounded to pence, both of these are nothing.
  const kwd = shelfTotal([priced(0.001, "KWD", "a"), priced(0.002, "KWD", "b")], GB);
  ok(kwd.byCurrency[0].amount === 0.003, "the smallest unit is the CURRENCY's, not always a hundredth", kwd.byCurrency[0].amount);
  const free = shelfTotal([priced(0, "GBP", "a")], GB);
  ok(free.priced === 1 && free.unpriced === 0 && free.byCurrency[0].text === "£0", "something free is priced, and its line says £0", free);
  const none = shelfTotal([priced(0.1, "GBP", "k"), priced(0.2, "GBP", "c")], { NumberFormat: null });
  ok(none.byCurrency[0].amount === 0.3 && none.byCurrency[0].text === "GBP 0.30", "no Intl: the sum is still right and still has a text", none.byCurrency);
}
{
  const whole = shelfTotal(SHELF, GB);
  ok(whole.priced === 4 && whole.unpriced === SHELF.length - 4, "a whole shelf: everything is either priced or unpriced", [whole.priced, whole.unpriced, SHELF.length]);
  let t = null;
  try { t = shelfTotal(null, GB); } catch (_) {}
  ok(!!t && t.byCurrency.length === 0 && t.priced === 0 && t.unpriced === 0, "the total of no shelf at all is no lines and two zeros, not a crash", t);
}
{
  const t = totalOf(list("x", { pins: ["p", "gone", "w1", "s"] }), SHELF, GB);
  ok(t.byCurrency.length === 1 && t.byCurrency[0].text === "£129.99", "a list's total is its OWN things, not the shelf's", t.byCurrency);
  ok(t.priced === 2 && t.unpriced === 1, "a pin whose item is gone is not counted as anything", [t.priced, t.unpriced]);
  const found = totalOf(list("x", { pins: ["w2"], query: "piranesi" }), SHELF, GB);
  ok(found.byCurrency.map((r) => r.text).join() === "€349.50,£9.99", "what the saved search finds is in the total too", found.byCurrency.map((r) => r.text));
  // A locale that writes the decimal point as a comma, so the phone's own
  // locale cannot give the same answer by luck.
  const de = totalOf(list("x", { pins: ["w2"] }), SHELF, { locale: "de-DE" });
  ok(/^349,50/.test(de.byCurrency[0].text), "the locale handed to a list's total reaches the text", de.byCurrency[0].text);
  const lisbon = totalOf(L[1], SHELF, GB);
  ok(lisbon.byCurrency.length === 0 && lisbon.priced === 0 && lisbon.unpriced === 3, "a list of places: no total line, three unpriced", lisbon);
  let none = null;
  try { none = totalOf(null, SHELF, GB); } catch (_) {}
  ok(!!none && none.priced === 0 && none.unpriced === 0, "no list → nothing to total, no crash", none);
}

// ── ONE FORMATTER: a jacket, a row, an item page and the total ───────────────
// The server's text says "£120.00" and the total says "£120"; side by side
// that reads as two apps. So the number is formatted HERE, by the same
// function the total uses, and the server's text is only a fallback.
{
  const GB = { locale: "en-GB" };
  ok(priceOn(lamp, GB) === "£120" && priceOn(lamp, GB) === shelfTotal([lamp], GB).byCurrency[0].text,
     "what one thing costs is written the way a total of one thing is", priceOn(lamp, GB));
  ok(priceOn(chair, GB) === "€349.50", "pence are kept when there are pence", priceOn(chair, GB));
  ok(priceOn(item({ id: "r", list: "wishlist", canonical: { kind: "product", price: 20, currency: "USD", price_text: "$20 to $35" } }), GB) === "$20 to $35",
     "a range is something a single number cannot say, so the shop's own words are kept");
  ok(priceOn(item({ id: "t", list: "wishlist", canonical: { kind: "product", price: null, currency: null, price_text: "From £9" } }), GB) === "From £9",
     "with no number to format, the shop's text is still better than nothing");
  ok(priceOn(jotting) === null && priceOn(piranesiNoPrice()) === null && priceOn(null) === null && priceOn({ canonical: { price_text: 7 } }) === null,
     "no price is null — never '', never 'undefined', never a number");
}
function piranesiNoPrice() { return item({ id: "x", list: "books", title: "x", canonical: {} }); }

console.log(fail ? `lists selftest FAILED (${fail})` : "lists selftest ok");
process.exit(fail ? 1 : 0);
