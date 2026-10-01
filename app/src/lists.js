// lists.js — a list somebody made: the things they put on it, and a search they kept.
//
// Plain JS, like design.js, facts.js and find.js, so the app draws it and a
// node selftest drives every branch. ONE import, find.js, because a saved
// search has to match exactly what the Find box matches: a list that shows
// four things for "lisbon" when Find shows five is two definitions of "found".
//
// A moodboard, a wishlist and a trip are all this one thing. The only
// difference between them is `view`, and that is a choice about drawing.
//
// In the file on the phone these are `shelf.boards`. `list` on an ITEM already
// means which shelf it is filed on, so the field could not be called `lists`.
// On screen the word is "Lists".
//
// THREE RULES:
//
// 1. NOTHING HERE CHANGES WHAT IT IS GIVEN. Every operation returns a new
//    array, or THE SAME ARRAY when there was nothing to do — an unknown list,
//    a pin that is already there, a name that is empty. So the caller can
//    compare with `===` and skip a save that would write the same bytes.
//
// 2. A PIN IS AN ID, AND AN ID CAN OUTLIVE ITS ITEM. `itemsOf` skips a pin
//    whose item is not on the shelf; it does not throw and it does not draw a
//    hole. The pin itself is left alone, on purpose: ids are made from the
//    source link (store.ts `idFor`), so a thing that is removed and shared
//    again, or put back by a rescue, comes back with the same id — and back
//    onto every list it was on. `prune` is the only thing that forgets a pin.
//
// 3. TWO CURRENCIES ARE NEVER ONE NUMBER. There is no exchange rate on a phone
//    with no network, and a total that adds pounds to yen is not approximately
//    right, it is a number that means nothing. One line per currency.
import { searchShelf } from "./find.js";

/** Long enough for "Things to do in Lisbon with my parents", short enough for one line. */
export const NAME_MAX = 60;
export const VIEWS = ["pictures", "rows"];

const arr = (v) => (Array.isArray(v) ? v : []);

// Cut by CHARACTER, not by UTF-16 unit: `slice(0, 60)` through the middle of
// an emoji leaves half of one, which draws as a box and cannot be deleted
// with one backspace.
const cleanName = (name) =>
  typeof name === "string"
    ? Array.from(name.replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").trim()
    : "";

// "No saved search" is null and only null. An empty string would be a third
// state that every reader has to remember to treat as the second.
const cleanQuery = (q) => (typeof q === "string" && q.trim() ? q.trim() : null);

const newId = () => "l_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

/**
 * A new, empty list — or null when there is no name to give it.
 *
 * `now` and `id` are handed in so a test can say what they are. Left out, they
 * are the clock and a random id.
 */
export function makeList(name, opts) {
  const clean = cleanName(name);
  if (!clean) return null;
  const at = new Date((opts && opts.now) ?? Date.now());
  return {
    id: (opts && typeof opts.id === "string" && opts.id) || newId(),
    name: clean,
    pins: [],
    query: null,
    view: "pictures",
    created_at: (Number.isNaN(at.getTime()) ? new Date() : at).toISOString(),
  };
}

/** Replace one list with what `fn` makes of it. Same array back when nothing changed. */
function change(lists, listId, fn) {
  const all = arr(lists);
  const at = all.findIndex((l) => l && l.id === listId);
  if (at < 0) return all;
  const next = fn(all[at]);
  if (next === all[at]) return all;
  const out = all.slice();
  out[at] = next;
  return out;
}

/** An empty name is refused, not saved: the list keeps the name it had. */
export function renameList(lists, listId, name) {
  const clean = cleanName(name);
  return change(lists, listId, (l) => (!clean || clean === l.name ? l : { ...l, name: clean }));
}

export function removeList(lists, listId) {
  const all = arr(lists);
  return all.some((l) => l && l.id === listId) ? all.filter((l) => !l || l.id !== listId) : all;
}

export function setView(lists, listId, view) {
  return change(lists, listId, (l) => (!VIEWS.includes(view) || view === l.view ? l : { ...l, view }));
}

/** A blank search is no search. */
export function setQuery(lists, listId, query) {
  const q = cleanQuery(query);
  return change(lists, listId, (l) => (q === l.query ? l : { ...l, query: q }));
}

/** New pins go on the END: the order is the person's, and adding must not move what they arranged. */
export function pin(lists, listId, itemId) {
  if (typeof itemId !== "string" || !itemId) return arr(lists);
  return change(lists, listId, (l) => (arr(l.pins).includes(itemId) ? l : { ...l, pins: [...arr(l.pins), itemId] }));
}

export function unpin(lists, listId, itemId) {
  return change(lists, listId, (l) =>
    arr(l.pins).includes(itemId) ? { ...l, pins: arr(l.pins).filter((id) => id !== itemId) } : l);
}

export function togglePin(lists, listId, itemId) {
  const l = arr(lists).find((x) => x && x.id === listId);
  return l && arr(l.pins).includes(itemId) ? unpin(lists, listId, itemId) : pin(lists, listId, itemId);
}

/**
 * Put a pin at a position. `toIndex` is where it ENDS UP, counted after it has
 * been lifted out — which is the number a drag hands you. Past either end is
 * the end.
 */
export function movePin(lists, listId, itemId, toIndex) {
  return change(lists, listId, (l) => {
    const pins = arr(l.pins);
    const from = pins.indexOf(itemId);
    if (from < 0 || typeof toIndex !== "number" || Number.isNaN(toIndex)) return l;
    const to = Math.max(0, Math.min(pins.length - 1, Math.trunc(toIndex)));
    if (to === from) return l;
    const next = pins.slice();
    next.splice(from, 1);
    next.splice(to, 0, itemId);
    return { ...l, pins: next };
  });
}

/**
 * What is on a list: the pins, in the order the person put them, then
 * everything the saved search finds that is not pinned already.
 *
 * Pins come first because they are a decision and the search is a guess. The
 * search half is in Find's own order, and it is not capped: Find shows the
 * best sixty because it is a box you are still typing in, and a list that
 * quietly stopped at sixty would have a total that is wrong.
 */
export function itemsOf(list, items) {
  if (!list) return [];
  const all = arr(items).filter((it) => it && it.id);
  const byId = new Map(all.map((it) => [it.id, it]));

  const out = [];
  const seen = new Set();
  const take = (it) => {
    if (!it || seen.has(it.id)) return;
    seen.add(it.id);
    out.push(it);
  };
  for (const id of arr(list.pins)) take(byId.get(id));
  // No query, or a blank one, is no words — and Find's answer to no words is
  // nothing, never everything.
  for (const hit of searchShelf(all, list.query, { limit: Infinity }).hits) take(hit.item);
  return out;
}

/**
 * Forget the pins whose item is gone.
 *
 * ONLY EVER ON A SHELF THAT WAS READ. Handed the empty shelf the app shows
 * when the file would not open, this would take every pin off every list and
 * the next save would make it permanent — an error turned into a statement
 * about somebody's data. Nothing needs it to run: `itemsOf` skips a dead pin
 * by itself. It is housekeeping, for when the person has asked for a clean-up.
 */
export function prune(lists, items) {
  const all = arr(lists);
  const have = new Set(arr(items).map((it) => it && it.id));
  let touched = false;
  const out = all.map((l) => {
    const pins = arr(l && l.pins);
    const kept = pins.filter((id) => have.has(id));
    if (kept.length === pins.length) return l;
    touched = true;
    return { ...l, pins: kept };
  });
  return touched ? out : all;
}

/** The lists an item is PINNED on. A saved search finding it does not count: nobody put it there. */
export const listsWith = (lists, itemId) =>
  arr(lists).filter((l) => l && arr(l.pins).includes(itemId));

// ── MONEY ────────────────────────────────────────────────────────────────────
//
// THE CONTRACT with the server: `canonical.price`, a number in the currency's
// main unit (12.5 is twelve pounds fifty), and `canonical.currency`, an ISO
// code ("GBP").

/**
 * The price of one item, or null.
 *
 * Null for no price, and null for a price that is not one: a string, NaN, a
 * negative number. ZERO IS A PRICE — free is a thing a wishlist can say.
 *
 * And null for a price with no currency. "12" is not twelve of anything, and
 * guessing pounds because the phone is in London is how a total goes wrong.
 */
export function priceOf(item) {
  const c = (item && item.canonical) || {};
  const currency = String(c.currency ?? "").trim().toUpperCase();
  // `Number.isFinite` is false for everything that is not a number, "12.50"
  // included. It does not convert.
  if (!Number.isFinite(c.price) || c.price < 0) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  return { amount: c.price, currency };
}

// The app runs on Hermes, where `Intl` is not something to assume from memory
// (the same caution as `fold` in tags.js). A caller, or the selftest, can hand
// in `NumberFormat: null` to take the path a phone without it would take.
const formatter = (opts) =>
  opts && "NumberFormat" in opts ? opts.NumberFormat : typeof Intl !== "undefined" ? Intl.NumberFormat : null;

// Pence in a pound: 2. Yen have none, and a Kuwaiti dinar has 3. The engine
// knows; 2 is the answer when it cannot be asked.
function minorDigits(currency, NF) {
  try {
    const d = new NF("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return typeof d === "number" ? d : 2;
  } catch (_) {
    return 2;
  }
}

/**
 * "£12.50", and "£12" — not "£12.00" — when there is nothing after the point.
 * `locale` left out is the phone's own.
 */
export function priceText(amount, currency, opts) {
  const NF = formatter(opts);
  const d = minorDigits(currency, NF);
  const unit = Math.pow(10, d);
  const digits = Math.round(amount * unit) % unit === 0 ? 0 : d;
  try {
    return new NF((opts && opts.locale) || undefined, {
      style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(amount);
  } catch (_) {
    return `${currency} ${amount.toFixed(digits)}`;
  }
}

/**
 * What one item costs, AS IT IS SHOWN, or null.
 *
 * ONE formatter for a jacket, a row, an item page and the total under them.
 * The server's own text says "£65.00" and a total says "£83"; side by side
 * that reads as two different apps. The server's text is kept only for what a
 * single number cannot say — a range ("$20 to $35") — or when there is no
 * currency to format with.
 */
export function priceOn(item, opts) {
  const said = (item && item.canonical && item.canonical.price_text) || null;
  if (typeof said === "string" && / to /.test(said)) return said;
  const p = priceOf(item);
  return p ? priceText(p.amount, p.currency, opts) : (typeof said === "string" && said) || null;
}

/**
 * What a run of items comes to.
 *
 * One line per currency, largest amount first (the code breaks a tie, so two
 * lines do not swap places between two reads). `priced` and `unpriced` are
 * there so the screen can say "3 of 5 have a price" — a total that does not
 * say what it left out reads as the price of everything.
 *
 * SUMMED IN PENCE. 0.1 + 0.2 is 0.30000000000000004 in every language that
 * has floats, and a total is the one number on the screen somebody will check
 * with a calculator.
 *
 * @returns {{byCurrency: Array<{currency: string, amount: number, text: string}>, priced: number, unpriced: number}}
 */
export function shelfTotal(items, opts) {
  const NF = formatter(opts);
  const by = new Map();
  let priced = 0, unpriced = 0;
  for (const it of arr(items)) {
    const p = priceOf(it);
    if (!p) { unpriced++; continue; }
    priced++;
    if (!by.has(p.currency)) by.set(p.currency, []);
    by.get(p.currency).push(p.amount);
  }
  const byCurrency = [...by].map(([currency, amounts]) => {
    const unit = Math.pow(10, minorDigits(currency, NF));
    const amount = amounts.reduce((sum, a) => sum + Math.round(a * unit), 0) / unit;
    return { currency, amount, text: priceText(amount, currency, opts) };
  });
  byCurrency.sort((a, b) => b.amount - a.amount || (a.currency < b.currency ? -1 : 1));
  return { byCurrency, priced, unpriced };
}

/** The total of one list: its pins and whatever its saved search finds. */
export const totalOf = (list, items, opts) => shelfTotal(itemsOf(list, items), opts);
