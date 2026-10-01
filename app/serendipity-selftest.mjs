// serendipity-selftest.mjs — what the shelf brings back, and what it refuses
// to say.
//
// Two things here cannot be checked by looking at a screen. One is time: "a
// year ago this week" is right on one day in 365, so the clock is an argument
// and every date below is built from the fixture's own `now`. The other is the
// claim that matters most — OPEN NOW — which is wrong silently: a card that
// says open, outside a place that is shut. So most of this file is the list of
// things `openState` must answer null to.
//
// Every date is built with the LOCAL constructor (`new Date(y, m, d, h)`), and
// the zone is PINNED to one that is not UTC. On a runner in UTC, local time and
// UTC are the same number, so code that confuses them passes there and fails on
// a phone. Kolkata is five and a half hours off, so the two never agree.
import { surface, openState, metresBetween, WALK_M, FORGOTTEN_DAYS } from "./src/serendipity.js";
import { LIST_KEYS } from "./src/design.js";

process.env.TZ = "Asia/Kolkata";
let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

// Thursday 1 October 2026, 13:00 where the phone is.
const NOW = new Date(2026, 9, 1, 13, 0);
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
// 400 m due south of St. John (one degree of latitude is 111,195 m).
const STJOHN = { lat: 51.5203, lng: -0.1027 };
const HERE = { lat: STJOHN.lat - 400 / 111195, lng: STJOHN.lng };
const north = (m) => ({ lat: HERE.lat + m / 111195, lng: HERE.lng });

const item = (id, list, title, created_at, extra = {}) =>
  ({ id, list, status: "filed", title, subtitle: "", note: "", canonical: {}, created_at, ...extra });

const piranesi = item("book", "books", "Piranesi", at(2025, 10, 1));                       // a year ago today
const sinners = item("film", "movies", "Sinners", at(2024, 10, 3));                         // two years ago, this week
const dal = item("dal", "recipes", "Dal", at(2026, 1, 10));                                 // old, no note
const quote = item("quote", "quotes", "The trouble with the rat race", at(2026, 2, 1));     // old, no note
const loose = item("loose", "unsorted", "A thing", at(2025, 12, 1));                        // oldest, no note
const stJohn = item("stjohn", "restaurants", "St. John", at(2026, 9, 20),
  { note: "bone marrow", canonical: { ...STJOHN, city: "London", opening_hours: "Mo-Sa 12:00-23:00" } });
const bookBar = item("bookbar", "places", "Book Bar", at(2026, 5, 1), { canonical: north(150) });   // near, hours unknown
const holiday = item("holiday", "restaurants", "Holiday Cafe", at(2026, 9, 25),
  { note: "x", canonical: { ...north(200), opening_hours: "Mo-Su 09:00-17:00; PH off" } });          // near, hours unreadable
const shut = item("shut", "restaurants", "Early Week", at(2026, 9, 25),
  { note: "x", canonical: { ...north(100), opening_hours: "Mo-We 09:00-17:00" } });                  // near, certainly closed on a Thursday
const peckham = item("peckham", "places", "Multi Story", at(2026, 3, 1), { canonical: { lat: 51.47, lng: -0.07 } }); // far
const noted = item("noted", "books", "Babel", at(2025, 1, 5), { note: "read this twice" });  // old but noted
const fresh = item("fresh", "movies", "New Film", at(2026, 9, 28));                          // too recent to be forgotten
const pending = { ...item("pending", "unsorted", null, at(2025, 10, 1)), status: "pending" };
const unread = { ...item("unread", "unsorted", null, at(2025, 10, 1)), status: "unread", canonical: north(50) };

// The two newest shelves. Both too recent to be "forgotten" and neither a year
// old, so they change no answer below — they are here so the loop under them
// has every shelf in it.
const overshirt = item("shirt", "wishlist", "Wool overshirt", at(2026, 9, 29), { canonical: { kind: "product", brand: "Northfield" } });
const jotting = item("jot", "notes", "Ask Maya about the scarf", at(2026, 9, 29), { note: "Ask Maya about the scarf", canonical: { kind: "note" } });

const ALL = [piranesi, sinners, dal, quote, loose, stJohn, bookBar, holiday, shut, peckham, noted, fresh, pending, unread, overshirt, jotting];
const ids = (cards) => cards.map((c) => c.item.id);
const kinds = (cards) => cards.map((c) => c.kind);

// A fixture that stops at four shelves cannot show you the fifth.
for (const k of LIST_KEYS) ok(ALL.some((i) => i.list === k), `the fixtures have nothing on ${k}`);

// ── OPEN NOW: only what can be read with certainty ──────────────────────────
const thu = (h, m = 0) => new Date(2026, 9, 1, h, m);
const sat = (h, m = 0) => new Date(2026, 9, 3, h, m);
const sun = (h, m = 0) => new Date(2026, 9, 4, h, m);
const fri = (h, m = 0) => new Date(2026, 9, 2, h, m);
const is = (hours, when, want, label) => {
  const got = openState(hours, when);
  ok(JSON.stringify(got) === JSON.stringify(want), label, got);
};
const OPEN = (until) => ({ open: true, until });
const SHUT = { open: false, until: null };

is("24/7", thu(3), OPEN(null), "24/7 is open, and has no closing time to print");
is("Mo-Su 00:00-24:00", thu(3), OPEN(null), "all day every day is 24 hours, however it is written");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", thu(13), OPEN("17:00"), "a weekday inside its span is open until the span ends");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", sat(13), OPEN("16:00"), "the second rule answers for Saturday");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", sat(9, 30), SHUT, "before opening is closed");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", thu(17), SHUT, "the closing minute is closed, not open");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", thu(8, 59), SHUT, "the minute before opening is closed");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", thu(9), OPEN("17:00"), "the opening minute is open");
is("Mo-Fr 09:00-17:00; Sa 10:00-16:00", sun(13), SHUT, "a day no rule names is closed");
is("Mo-Su 12:00-23:00", sun(13), OPEN("23:00"), "Mo-Su covers Sunday");
is("Mo-Su 12:00-23:00; Th off", thu(13), SHUT, "a later `off` rule closes the day an earlier rule opened");
is("Mo-Su 12:00-23:00; Th closed", thu(13), SHUT, "`closed` is `off`");
is("Mo-Su 12:00-23:00; Th off", fri(13), OPEN("23:00"), "…and only that day");
is("Mo,We,Fr 10:00-12:00", fri(11), OPEN("12:00"), "a comma list of days");
is("Mo,We,Fr 10:00-12:00", thu(11), SHUT, "…does not include the days between");
is("Fr-Mo 10:00-12:00", sun(11), OPEN("12:00"), "a day range that wraps the week");
is("Fr-Mo 10:00-12:00", thu(11), SHUT, "…and stays shut outside it");
is("Mo-Fr 12:00-15:00,18:00-23:00", thu(16), SHUT, "between two spans is closed");
is("Mo-Fr 12:00-15:00, 18:00-23:00", thu(19), OPEN("23:00"), "the second span, written with a space after the comma");
is("12:00-22:00", sun(13), OPEN("22:00"), "no days named means every day");
is("Mo-Su 12:00-24:00", thu(13), OPEN("midnight"), "24:00 is said as midnight");
// Past midnight: Friday's bar is still open at 01:00 on Saturday.
is("Fr-Sa 18:00-02:00", sat(1), OPEN("02:00"), "a span that runs past midnight is open the next morning");
is("Fr-Sa 18:00-02:00", fri(1), SHUT, "…but not on the morning BEFORE its first night");
is("Fr-Sa 18:00-02:00", sun(3), SHUT, "…and not after it has ended");
is("Fr-Sa 18:00-02:00", fri(19), OPEN("02:00"), "the evening itself");

// THE CEILING. Each of these is real OSM syntax, or a real typo, and each must
// produce NO claim — not "closed", which is a claim too.
for (const hours of [
  "Mo-Su 09:00-17:00; PH off",                 // is today a public holiday? unknowable here
  "sunrise-sunset",
  "Mo-Fr 17:00+",
  "Apr-Oct Mo-Su 10:00-18:00",
  "week 1-26 Mo-Fr 09:00-17:00",
  "mo-fr 09:00-17:00",
  'Mo-Fr 09:00-17:00 || "by appointment"',
  "Mo-Fr 09:00-17:00, Sa 10:00-14:00",
  "Mo-Fr 25:00-26:00",
  "Mo-Fr 09:60-17:00",
  "Mo 10:00-10:00",
  "Mo-Fr 9-5",
  "open",
  "",
]) ok(openState(hours, thu(13)) === null, `"${hours}" cannot be read with certainty, so it must say nothing`, openState(hours, thu(13)));
ok(openState(null, thu(13)) === null && openState(undefined, thu(13)) === null, "no hours, no claim");
ok(openState("24/7", null) === null && openState("24/7", new Date("nope")) === null, "no clock, no claim");

// ── distance ────────────────────────────────────────────────────────────────
ok(Math.abs(metresBetween(HERE, STJOHN) - 400) < 1, "400 m is measured as 400 m", metresBetween(HERE, STJOHN));
ok(metresBetween(HERE, {}) === null && metresBetween(HERE, { lat: null, lng: null }) === null && metresBetween(null, STJOHN) === null,
   "no pin is no distance — never zero, which would read as right here");

// ── NEAR comes first, and says only what it knows ───────────────────────────
const withHere = surface(ALL, { now: NOW, here: HERE, limit: 99 });
ok(kinds(withHere).join().startsWith("open-now,near,near,near,year-ago"), "open first, then near, then the calendar", kinds(withHere));
ok(ids(withHere).slice(0, 4).join() === "stjohn,bookbar,holiday,shut",
   "open, then hours unknown (nearest first), then certainly closed last", ids(withHere).slice(0, 4));
const card = (id, cards = withHere) => cards.find((c) => c.item.id === id);
ok(card("stjohn").reason === "400 m from you · open until 23:00", "the open card says how far and until when", card("stjohn").reason);
ok(card("bookbar").reason === "150 m from you", "no hours on the item: distance, and not a word about open", card("bookbar").reason);
ok(card("holiday").kind === "near" && !/open|closed/i.test(card("holiday").reason),
   "hours we cannot read are NOT a claim, in either direction", card("holiday"));
ok(card("shut").kind === "near" && card("shut").reason === "100 m from you · closed now",
   "certainly closed is still near you, and says closed", card("shut"));
ok(!card("peckham") || card("peckham").kind === "forgotten", "five kilometres is not walking distance", card("peckham"));
ok(metresBetween(HERE, peckham.canonical) > WALK_M, "…and the far fixture really is far");
ok(withHere.slice(0, 4).every((c) => c.action && c.action.type === "map"), "every near card carries a Map action");
ok(withHere.slice(0, 4).every((c) => !/https?:|geo:/.test(JSON.stringify(c.action))),
   "the action carries no URL — the device builds it with mapUrl");
ok(withHere.filter((c) => c.kind === "year-ago" || c.kind === "forgotten").every((c) => !("action" in c)),
   "a memory has no Map button");
ok(surface([{ ...stJohn, canonical: { ...stJohn.canonical, ...north(990) } }], { now: NOW, here: HERE })[0].reason.startsWith("1 km from you"),
   "990 m rounds to 1 km, not to 1000 m");
ok(surface([{ ...stJohn, canonical: { ...stJohn.canonical, ...north(4) } }], { now: NOW, here: HERE })[0].reason.startsWith("50 m from you"),
   "4 m does not print as 0 m");
const allNight = surface([{ ...stJohn, canonical: { ...north(250), opening_hours: "24/7" } }], { now: NOW, here: HERE })[0];
ok(allNight.kind === "open-now" && allNight.reason === "250 m from you · open 24 hours", "a place that never closes has no closing time to print", allNight);

const noHere = surface(ALL, { now: NOW, limit: 99 });
ok(!kinds(noHere).some((k) => k === "near" || k === "open-now"), "no place given, nothing claimed about distance", kinds(noHere));
ok(!kinds(surface(ALL, { now: NOW, here: { lat: String(HERE.lat), lng: String(HERE.lng) }, limit: 99 })).some((k) => k === "near" || k === "open-now"),
   "a place that is not two numbers is no place — a string that looks like one included");

// ── A YEAR AGO ──────────────────────────────────────────────────────────────
ok(card("book", noHere).kind === "year-ago" && card("book", noHere).reason === "Saved a year ago today", "a year ago to the day", card("book", noHere));
ok(card("film", noHere).kind === "year-ago" && card("film", noHere).reason === "Saved 2 years ago this week", "two years ago, two days off", card("film", noHere));
ok(ids(noHere.filter((c) => c.kind === "year-ago")).join() === "book,film", "closest to the day first", ids(noHere));
const five = item("five", "books", "Late", at(2025, 10, 6));
ok(surface([five], { now: NOW })[0]?.kind !== "year-ago", "five days off is not this week", surface([five], { now: NOW }));
ok(surface([item("y3", "books", "x", at(2023, 10, 1))], { now: NOW })[0]?.reason === "Saved 3 years ago today", "three years");
ok(surface([item("y4", "books", "x", at(2022, 10, 1), { note: "n" })], { now: NOW }).length === 0, "four years is not offered");

// ── FORGOTTEN ───────────────────────────────────────────────────────────────
const forgotten = (cards) => ids(cards.filter((c) => c.kind === "forgotten"));
const pile = forgotten(noHere);
ok([...pile].sort().join() === "bookbar,dal,loose,peckham,quote", "old and never noted — and nothing else", pile);
ok(!pile.includes("noted"), "an item with a note was not forgotten");
ok(!pile.includes("fresh") && FORGOTTEN_DAYS === 90, "three days is not long ago; ninety is");
ok(card("dal", noHere).reason === "Saved in January 2026, no note yet", "it says when", card("dal", noHere).reason);
// Turned by the day: across as many days as there are cards, each one leads once.
const leads = pile.map((_, d) => forgotten(surface(ALL, { now: new Date(2026, 9, 1 + d, 13), limit: 99, seen: ["book", "film"] }))[0]);
ok(new Set(leads).size === pile.length, "a different card leads each day, and all of them get a turn", leads);
const dayOne = pile.findIndex((_, d) => leads[d] === "loose");
ok(forgotten(surface(ALL, { now: new Date(2026, 9, 1 + dayOne, 13), limit: 99, seen: ["book", "film"] })).join() === "loose,dal,quote,peckham,bookbar",
   "on the day the oldest leads, the order is oldest first");
ok(JSON.stringify(surface(ALL, { now: NOW, here: HERE, limit: 99 })) === JSON.stringify(surface(ALL, { now: NOW, here: HERE, limit: 99 })),
   "same shelf, same moment, same answer");
// 02:00 here is still yesterday in UTC. The card turns at the person's midnight.
ok(forgotten(surface(ALL, { now: new Date(2026, 9, 1, 2), limit: 99 }))[0] === forgotten(surface(ALL, { now: new Date(2026, 9, 1, 22), limit: 99 }))[0],
   "the same card leads all day, by the phone's day and not UTC's");
ok(new Date(2026, 9, 1, 2).getTimezoneOffset() === -330, "the zone pin did not take, so the line above proves nothing", new Date(2026, 9, 1, 2).getTimezoneOffset());

// ── the rules that hold across all three ────────────────────────────────────
for (const cards of [withHere, noHere]) {
  ok(!ids(cards).some((id) => id === "pending" || id === "unread"), "only filed items are surfaced", ids(cards));
  ok(new Set(ids(cards)).size === cards.length, "nothing is surfaced twice in one call", ids(cards));
  ok(cards.every((c) => !/[!—–]/.test(c.reason)), "plain words: no exclamation marks, no dashes", cards.map((c) => c.reason));
}
// One item that qualifies three ways is one card, under the first kind.
const triple = item("triple", "restaurants", "Triple", at(2025, 10, 1), { canonical: north(300) });
const once = surface([triple], { now: NOW, here: HERE, limit: 99 });
ok(once.length === 1 && once[0].kind === "near", "near, a year ago AND forgotten is still one card", once);
ok(surface([triple, { ...triple }], { now: NOW, limit: 99 }).length === 1, "a doubled id is one card");

ok(!ids(surface(ALL, { now: NOW, here: HERE, limit: 99, seen: ["stjohn", "book"] })).some((id) => id === "stjohn" || id === "book"),
   "what was shown recently is skipped");
ok(surface(ALL, { now: NOW, here: HERE }).length === 3, "three by default");
ok(surface(ALL, { now: NOW, here: HERE, limit: 1 }).length === 1 && surface(ALL, { now: NOW, limit: 0 }).length === 0, "the limit is the limit");

// ── rubbish in ──────────────────────────────────────────────────────────────
ok(surface(ALL, {}).length === 0 && surface(ALL).length === 0 && surface(ALL, { now: "2026-10-01" }).length === 0,
   "no clock passed in means no answer — it must never read the clock itself");
ok(surface(null, { now: NOW }).length === 0, "no shelf, no crash");
ok(surface([null, undefined, {}, { status: "filed" }, { id: "x", status: "filed", created_at: "nope" }], { now: NOW, here: HERE }).length === 0,
   "junk rows do not crash it and are not surfaced");
ok(surface([{ ...dal, id: undefined }, { ...stJohn, id: "" }], { now: NOW, here: HERE }).length === 0,
   "a row with no id cannot be opened, skipped or told apart, so it is not a card");

console.log(fail ? `serendipity selftest FAILED (${fail})` : "serendipity selftest ok");
process.exit(fail ? 1 : 0);
