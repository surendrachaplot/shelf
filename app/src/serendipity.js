// serendipity.js — what a shelf says to you when you did not ask it anything.
//
// Plain JS with no imports, like facts.js, so the app renders it and a node
// selftest drives it with fixtures. NOTHING HERE READS THE CLOCK OR THE GPS:
// the time and the place are arguments. That is what lets "a year ago this
// week" and "open until 23:00" be asserted at all — a function that calls
// `new Date()` for itself can only be tested on the day it happens to be right.
//
// THREE KINDS, IN THE ORDER OF WHAT YOU CAN DO ABOUT THEM:
//
// 1. NEAR YOU. A saved place within a walk of where you are standing. This is
//    the one a memory app without resolution cannot do: it has a thumbnail,
//    we have a pin. It comes first because it expires — in ten minutes you are
//    somewhere else.
// 2. A YEAR AGO. Saved this week one, two or three years back.
// 3. FORGOTTEN. Filed long ago and never noted. Oldest first, turned by one
//    each day so the same card is not sitting there every morning.
//
// THE RULE THAT OUTRANKS ALL OF IT: NEVER CLAIM OPEN ON A GUESS. Walking
// somebody 400 m to a locked door is worse than saying nothing. `openState`
// answers only for hours it can read with certainty and returns null for
// everything else, and null prints no words at all.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

const DAY_MS = 86400000;
/** About twelve minutes on foot. Past that it is a trip, not a detour. */
export const WALK_M = 1000;
/** "This week" is the anniversary and three and a half days either side. */
export const WEEK_HALF_MS = 3.5 * DAY_MS;
/** How long before an item with no note counts as forgotten. */
export const FORGOTTEN_DAYS = 90;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** Great-circle metres between two {lat,lng}. null when either has no pin. */
export function metresBetween(a, b) {
  if (!a || !b || !isNum(a.lat) || !isNum(a.lng) || !isNum(b.lat) || !isNum(b.lng)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// ── opening hours ───────────────────────────────────────────────────────────
//
// ponytail: this reads the simple common forms of OSM `opening_hours` and
// nothing else — `24/7`, and `;`-separated rules of `[days] HH:MM-HH:MM[,…]`
// or `[days] off`, where days are Mo..Su singly, in ranges, or comma-joined.
// A later rule replaces an earlier one for the days it names (so `Mo-Su
// 12:00-23:00; Tu off` closes Tuesday), a day no rule names is closed, and a
// span that ends before it starts runs past midnight. THE CEILING: public and
// school holidays (PH, SH), months, week numbers, `sunrise`/`sunset`, open
// ends (`17:00+`), `||` fallbacks, comments and lower-case days all return
// null — the whole string, not just the rule, because one clause we cannot
// read can overrule the ones we can. Upgrade path if coverage matters: the
// `opening_hours` npm package, which needs the country for holidays.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // Date#getDay order
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const SPAN = "\\d{2}:\\d{2}-\\d{2}:\\d{2}";
const RULE = new RegExp(`^(?:(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)\\s+)?(off|closed|${SPAN}(?:,${SPAN})*)$`);

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h > 24 || m > 59 || (h === 24 && m) ? null : h * 60 + m;
};

function daysOf(spec) {
  const out = [];
  for (const part of spec.split(",")) {
    const [from, to = from] = part.split("-").map((d) => DAYS.indexOf(d));
    // Fr-Mo wraps the week, and is a thing real bars write.
    for (let d = from; ; d = (d + 1) % 7) { out.push(d); if (d === to) break; }
  }
  return out;
}

/** Seven arrays of [startMin, endMin], Sunday first — or null if not certain. */
function weekOf(hours) {
  const s = String(hours ?? "").trim();
  if (!s) return null;
  if (s === "24/7") return DAYS.map(() => [[0, 1440]]);
  const week = DAYS.map(() => []);
  for (const raw of s.split(";")) {
    // "12:00-15:00, 18:00-23:00" is the same thing with a space typed in.
    const rule = raw.trim().replace(/,\s+/g, ",");
    if (!rule) continue;
    const m = RULE.exec(rule);
    if (!m) return null;
    const spans = [];
    if (m[2] !== "off" && m[2] !== "closed") {
      for (const span of m[2].split(",")) {
        const [a, b] = span.split("-").map(minutes);
        if (a === null || b === null || a === b) return null;
        spans.push([a, b > a ? b : b + 1440]);
      }
    }
    for (const d of m[1] ? daysOf(m[1]) : DAYS.keys()) week[d] = spans;
  }
  return week;
}

const clock = (min) => {
  const m = min % 1440;
  return m === 0 ? "midnight" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * Is it open at `now`?
 *
 *   { open: true,  until: "23:00" }   certain, and when it stops
 *   { open: true,  until: null }      certain, and it does not stop (24 hours)
 *   { open: false, until: null }      certain
 *   null                              NOT KNOWN — say nothing
 *
 * `now` IS READ IN THE DEVICE'S LOCAL TIME (`getDay`, `getHours`), and opening
 * hours are written in the PLACE'S local time. Those are the same clock only
 * when you are standing near the place — which is why `surface` asks this for
 * nothing but items within WALK_M of `here`. Do not call it for a restaurant
 * in another timezone and believe the answer. The one case left over is a
 * phone whose clock is set to a zone it is not in, and that phone is wrong
 * about everything else too.
 *
 * `until` is the end of the span you are in. Hours written as two spans that
 * meet at midnight read "until midnight" rather than the later time: early,
 * never late.
 */
export function openState(hours, now) {
  const week = weekOf(hours);
  if (!week || !isDate(now)) return null;
  const d = now.getDay();
  const m = now.getHours() * 60 + now.getMinutes();
  const inside = ([a, b]) => m >= a && m < b;
  // Today's spans, then last night's that ran past midnight into today.
  const hit = week[d].find(inside)
    || week[(d + 6) % 7].map(([a, b]) => [a - 1440, b - 1440]).find(inside);
  if (!hit) return { open: false, until: null };
  const always = week.every((day) => day.some(([a, b]) => a === 0 && b === 1440));
  return { open: true, until: always ? null : clock(hit[1]) };
}

// ── the words ───────────────────────────────────────────────────────────────

// To the nearest 50 m: a phone's fix is not better than that, and "437 m"
// claims a precision nobody has.
const distance = (m) => {
  const r = Math.max(50, Math.round(m / 50) * 50);
  return r >= 1000 ? "1 km from you" : `${r} m from you`;
};

const nearReason = (m, state) => {
  if (!state) return distance(m);
  if (!state.open) return `${distance(m)} · closed now`;
  return `${distance(m)} · ${state.until ? `open until ${state.until}` : "open 24 hours"}`;
};

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * What to put in front of somebody, best first, at most `limit`.
 *
 * `seen` is the ids shown recently — the caller keeps that list, because what
 * counts as recently is a decision about a screen and not about a shelf.
 *
 * @returns {Array<{kind: "open-now"|"near"|"year-ago"|"forgotten", item: object, reason: string, action?: {type: "map", label: string}}>}
 */
export function surface(items, { now, here = null, limit = 3, seen = [] } = {}) {
  // No clock, no answer. Falling back to `new Date()` here would make every
  // caller that forgot the argument work on the day it was written.
  if (!isDate(now)) return [];
  // `add` is the ONE place an id is checked, for `seen` and for doubles alike.
  const used = new Set(seen);
  // Only what has been resolved and filed. A pending row is not a memory yet.
  const filed = (items || []).filter((it) => it && it.status === "filed" && it.id);
  const out = [];
  const add = (card) => { if (!used.has(card.item.id)) { used.add(card.item.id); out.push(card); } };

  // 1. NEAR. Anything with a pin — the shelf it sits on is not the test, the
  // coordinates are. Open first, then unknown, then closed; nearest first
  // inside each. A closed place is still shown, and SAYS it is closed.
  // No `here`, or one that is not two numbers, measures as null to everything
  // and so finds nothing: `metresBetween` is the one guard.
  const rank = (s) => (s ? (s.open ? 0 : 2) : 1);
  filed
    .map((item) => ({ item, m: metresBetween(here, item.canonical) }))
    .filter((x) => x.m !== null && x.m <= WALK_M)
    .map((x) => ({ ...x, state: openState(x.item.canonical.opening_hours, now) }))
    .sort((a, b) => rank(a.state) - rank(b.state) || a.m - b.m)
    .forEach(({ item, m, state }) => add({
      kind: state && state.open ? "open-now" : "near",
      item,
      reason: nearReason(m, state),
      // The UI builds the link with mapUrl(item, Platform.OS) at render:
      // only the device knows what it can open (see facts.js).
      action: { type: "map", label: "Map" },
    }));

  // 2. A YEAR AGO, and two, and three. Closest to the day first.
  const years = [];
  for (const item of filed) {
    const saved = new Date(item.created_at);
    if (!isDate(saved)) continue;
    for (const n of [1, 2, 3]) {
      const due = new Date(saved);
      due.setFullYear(saved.getFullYear() + n);
      const off = Math.abs(now.getTime() - due.getTime());
      if (off <= WEEK_HALF_MS) years.push({ item, n, off, today: sameDay(due, now) });
    }
  }
  years.sort((a, b) => a.off - b.off || a.n - b.n).forEach(({ item, n, today }) => add({
    kind: "year-ago",
    item,
    reason: `Saved ${n === 1 ? "a year" : `${n} years`} ago ${today ? "today" : "this week"}`,
  }));

  // 3. FORGOTTEN. Oldest first, then turned by the day number, so tomorrow
  // starts one further along and the whole pile comes round in turn.
  const old = filed
    // Cards already out, and `seen`, leave the pile BEFORE it is turned: the
    // turn has to count what can actually be shown, or two days share a lead.
    .filter((it) => !used.has(it.id) && !String(it.note ?? "").trim())
    .map((item) => ({ item, saved: new Date(item.created_at) }))
    .filter((x) => isDate(x.saved) && now.getTime() - x.saved.getTime() >= FORGOTTEN_DAYS * DAY_MS)
    .sort((a, b) => a.saved - b.saved || String(a.item.id).localeCompare(String(b.item.id)));
  if (old.length) {
    // The LOCAL day, so the card changes at the person's midnight, not UTC's.
    const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / DAY_MS);
    const turn = day % old.length;
    [...old.slice(turn), ...old.slice(0, turn)].forEach(({ item, saved }) => add({
      kind: "forgotten",
      item,
      reason: `Saved in ${MONTHS[saved.getMonth()]} ${saved.getFullYear()}, no note yet`,
    }));
  }

  return out.slice(0, Math.max(0, limit));
}
