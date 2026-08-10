// exlibris.js — a personal mark, generated from a handle.
//
// The bookplate tradition: you owned a book, you pasted your plate inside the
// cover, and the plate said who you were before a single word of the book did.
// That is exactly the job here — a shelf you share is a part of yourself, and
// it needs a mark that is unmistakably yours and unmistakably not a stock
// avatar with a coloured circle behind an initial.
//
// PLAIN JS, and it returns a DESCRIPTION rather than markup. The app renders it
// with react-native-svg and the server renders it into the public page, and
// those two must produce the same plate down to the point — a mark that drifts
// between the app and the page you sent someone is not an identity. One
// generator, two renderers, and the gate walks the description.
//
// Colours are ROLE NAMES ("ground", "mark", "paper"), never values. §0a says no
// component invents a colour, and a generator that baked in hexes would be the
// largest violation of that rule in the codebase.

import { LIST_KEYS } from "./design.js";

export const PLATE = 100; // the viewBox everything below is drawn in

// A 32-bit-ish hash. Deliberately the same shape as the one in design.js:
// small, deterministic, and stable across engines. This is an identity, so it
// must produce the same plate on iOS, in Chromium and in Node, forever.
export function seedOf(handle) {
  let h = 2166136261;
  for (const ch of String(handle || "").toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Pull independent choices out of one seed without them correlating: each
// draw uses a different slice of the bits, so two handles that share a first
// letter do not end up sharing a border AND a device AND a ground.
const pick = (seed, shift, list) => list[(seed >>> shift) % list.length];

export const BORDERS = ["double", "heavy", "brackets", "stepped"];
export const DEVICES = ["ring", "diamond", "bars", "arc", "cross"];

/** The three colour roles a plate uses, as names the renderer resolves. */
export const ROLES = ["ground", "mark", "paper"];

/**
 * Everything about a plate, derived. Nothing here is chosen by taste: the
 * ground is one of the four list colours, so a person's mark is always in the
 * same palette their shelves are, and the mark colour is the label colour that
 * list already names for itself — which means the contrast is the pairing
 * `list-label-contrast` proves in both schemes, not a new one to check.
 */
export function plateFor(handle) {
  const seed = seedOf(handle);
  const letters = String(handle || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return {
    seed,
    letters,
    // Never "unsorted" — grey is the colour of a thing that has no shelf yet,
    // and a person is not an unresolved item.
    list: pick(seed, 3, LIST_KEYS.filter((k) => k !== "unsorted")),
    border: pick(seed, 11, BORDERS),
    device: pick(seed, 17, DEVICES),
    // One letter reads as a monogram; two read as initials. Both are plates.
    mono: (seed >>> 23) % 3 === 0 ? letters.slice(0, 1) : letters,
  };
}

/**
 * The plate as primitives, in draw order, in a 0..100 box.
 *
 * `fill` and `stroke` are role names. `sw` is stroke width in the same units.
 * Text carries `size`, `weight` and `anchor` and nothing else — the family is
 * the app's one family, supplied by whichever renderer is drawing.
 */
export function plateShapes(handle) {
  const p = plateFor(handle);
  const out = [{ k: "rect", x: 0, y: 0, w: PLATE, h: PLATE, fill: "ground" }];

  if (p.border === "double") {
    out.push({ k: "rect", x: 6, y: 6, w: 88, h: 88, stroke: "mark", sw: 2.5 });
    out.push({ k: "rect", x: 12, y: 12, w: 76, h: 76, stroke: "mark", sw: 1 });
  } else if (p.border === "heavy") {
    out.push({ k: "rect", x: 5, y: 5, w: 90, h: 90, stroke: "mark", sw: 6 });
  } else if (p.border === "brackets") {
    // Corner brackets only — the plate is implied rather than enclosed.
    for (const [x, y, dx, dy] of [[8, 8, 1, 1], [92, 8, -1, 1], [8, 92, 1, -1], [92, 92, -1, -1]]) {
      out.push({ k: "line", x1: x, y1: y, x2: x + 22 * dx, y2: y, stroke: "mark", sw: 3 });
      out.push({ k: "line", x1: x, y1: y, x2: x, y2: y + 22 * dy, stroke: "mark", sw: 3 });
    }
  } else {
    // stepped: a rule top and bottom, weighted like a masthead.
    out.push({ k: "rect", x: 0, y: 6, w: PLATE, h: 5, fill: "mark" });
    out.push({ k: "rect", x: 0, y: 89, w: PLATE, h: 5, fill: "mark" });
  }

  if (p.device === "ring") {
    out.push({ k: "circle", cx: 50, cy: 50, r: 27, stroke: "mark", sw: 2 });
  } else if (p.device === "diamond") {
    out.push({ k: "poly", pts: [[50, 20], [80, 50], [50, 80], [20, 50]], stroke: "mark", sw: 2 });
  } else if (p.device === "bars") {
    for (let i = 0; i < 3; i++) out.push({ k: "rect", x: 22, y: 30 + i * 17, w: 56, h: 2, fill: "mark" });
  } else if (p.device === "arc") {
    out.push({ k: "arc", cx: 50, cy: 52, r: 26, from: 180, to: 360, stroke: "mark", sw: 2.5 });
  } else {
    out.push({ k: "line", x1: 24, y1: 50, x2: 76, y2: 50, stroke: "mark", sw: 2 });
    out.push({ k: "line", x1: 50, y1: 24, x2: 50, y2: 76, stroke: "mark", sw: 2 });
  }

  // The monogram sits ON the device, knocked out of a small paper field so the
  // device never runs through the letterforms — a ring crossing an "S" at the
  // waist is the difference between a mark and a mess.
  const w = p.mono.length === 1 ? 30 : 44;
  out.push({ k: "rect", x: 50 - w / 2, y: 36, w, h: 28, fill: "ground" });
  out.push({
    k: "text", x: 50, y: 59, value: p.mono,
    size: p.mono.length === 1 ? 30 : 24, weight: "700", anchor: "middle", fill: "mark",
  });
  return out;
}

/** Resolve the three roles against a palette. Never invents a value. */
export function plateColours(handle, palette, listOn) {
  const p = plateFor(handle);
  return { ground: palette[p.list], mark: listOn[p.list], paper: palette.bg };
}

// An arc as a path, because SVG has no arc primitive and both renderers need
// the identical string. Degrees, clockwise, y down.
export function arcPath({ cx, cy, r, from, to }) {
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const round = (n) => Math.round(n * 100) / 100;
  return `M ${round(x1)} ${round(y1)} A ${r} ${r} 0 ${large} 1 ${round(x2)} ${round(y2)}`;
}

/** The plate as a standalone SVG string — the server's renderer. */
export function plateSvg(handle, colours, size = 96) {
  const body = plateShapes(handle).map((s) => {
    const fill = s.fill ? colours[s.fill] : "none";
    const stroke = s.stroke ? colours[s.stroke] : "none";
    const sw = s.sw ?? 0;
    if (s.k === "rect") return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (s.k === "circle") return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (s.k === "line") return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="butt"/>`;
    if (s.k === "poly") return `<polygon points="${s.pts.map((q) => q.join(",")).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (s.k === "arc") return `<path d="${arcPath(s)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (s.k === "text") return `<text x="${s.x}" y="${s.y}" font-size="${s.size}" font-weight="${s.weight}" text-anchor="${s.anchor}" fill="${fill}" font-family="Helvetica, Arial, sans-serif" letter-spacing="-1">${s.value}</text>`;
    return "";
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PLATE} ${PLATE}" width="${size}" height="${size}" role="img" aria-label="Ex libris ${handle}">${body}</svg>`;
}

// ── handles ──────────────────────────────────────────────────────────────────
// A handle is a URL, a mark and a name you type at someone. Getting the rules
// right once, here, is cheaper than three near-identical validators.

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 24;
// Reserved because they are real routes on the public site, and a user called
// "api" would shadow one. Checked case-insensitively, like handles themselves.
export const RESERVED = ["api", "s", "i", "u", "shelf", "about", "help", "login", "admin", "static", "assets", "new", "search"];

export function normHandle(raw) {
  return String(raw || "").trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, "");
}

/** Returns null when it is fine, or a sentence a person can act on. */
export function handleProblem(raw) {
  const h = normHandle(raw);
  if (h.length < HANDLE_MIN) return `Handles are at least ${HANDLE_MIN} characters.`;
  if (h.length > HANDLE_MAX) return `Handles are at most ${HANDLE_MAX} characters.`;
  if (/^[0-9_]/.test(h)) return "Handles start with a letter.";
  if (RESERVED.includes(h)) return `"${h}" is reserved.`;
  return null;
}
