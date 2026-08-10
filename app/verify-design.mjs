// verify-design.mjs — the design gate a machine can hold.
//
//   node verify-design.mjs             audit the real system + sources
//   node verify-design.mjs --selftest  break every rule on purpose, confirm it fires
//   node verify-design.mjs --frames    print the frame table for every transition
//
// Two halves.
//
// STATIC rules read the components for the defects that are invisible in a
// screenshot and obvious in a grep: a raw font size, a 40pt tap target, a
// button told to fill its parent, an <Image> with no failure path.
//
// SYSTEM rules audit `src/design.js` itself — contrast for every pairing in
// both schemes, the type ladder against its floor, the spacing grid, and
// EVERY TRANSITION SIMULATED FRAME BY FRAME AT 120Hz. The frame audit imports
// the same spring math the app runs, so it measures the shipped curve rather
// than a model of it. It fails on: a frame that jumps more than a third of the
// journey (reads as a cut), a dead lead-in (reads as lag), overshoot outside
// the declared budget, drift away from the target, a settle longer than the
// budget, and any NaN.
//
// Looking at the thing is `npm run preview` (preview/): the real components
// through react-native-web in Chromium, screenshotted at 320 and 375 in both
// schemes, with tap targets measured off the live layout. That is §0.2 as far
// as a Linux box can take it — it caught a collapsed 2x2 grid, a tab strip
// eating 200pt of vertical space, and skeletons that read as holes in dark
// mode, none of which any static rule here could see. It is still not iOS.
import { readFile } from "node:fs/promises";
import { isMain } from "../api/ismain.js";
import * as D from "./src/design.js";

const SOURCES = ["App.tsx", "ShareExtension.tsx"];

// ─── static rules ────────────────────────────────────────────────────────────

function linesWithStyleName(src) {
  const out = [];
  let current = null;
  src.split("\n").forEach((line, i) => {
    const open = /^\s{2}([A-Za-z0-9_]+):\s*\{/.exec(line);
    if (open) current = open[1];
    else if (/^\s{2}\}/.test(line)) current = null;
    out.push({ n: i + 1, line, style: current });
  });
  return out;
}

const CONTROL = /btn|button|tab|tile|decide|input|action|chip|press|retry/i;
// ...but only when the style IS the control. Rules, fades, wrappers and labels
// are decoration that happens to sit inside one, and flagging them would push
// you to inflate a 2pt underline to 44pt.
const NOT_CONTROL = /(rule|fade|wrap|inner|list|label|icon|bar|line|dot)$/i;

// If a threshold the gate compares against is missing, every comparison using
// it quietly returns false and the gate reports a clean run. Assert the
// constants exist before trusting a single check.
const REQUIRED_NUMBERS = ["TOUCH_MIN", "TOUCH", "TYPE_FLOOR", "GRID", "FRAME_HZ", "MAX_SETTLE_MS", "MAX_FRAME_TRAVEL", "BOARD", "BAND_BOARD", "RULE", "COVER_KEYLINE", "JACKET_GLYPH"];
// Twice now a broad regex edit to design.js has silently deleted an export —
// TOUCH_MIN once, `family` once — and both times the failure surfaced far from
// the cause (a missing tap-target floor; a crash inside Platform.select at
// render). The gate names what must exist so a deletion fails HERE.
const REQUIRED_OBJECTS = ["family", "type", "sp", "radius", "light", "dark", "listOn", "springs", "easing", "cover", "coverFor", "jacketType", "mainTitle"];

const staticRules = [
  {
    id: "type-scale",
    why: "§1 — never a raw font size. One screen once carried 14 distinct sizes, none of them chosen.",
    check: (src) => linesWithStyleName(src)
      .filter(({ line }) => /fontSize:\s*\d/.test(line))
      .map(({ n, line }) => ({ n, msg: `raw fontSize — use a step from design.js: ${line.trim()}` })),
  },
  {
    id: "touch-target",
    why: `§5 / §4f — ${D.TOUCH_MIN}×${D.TOUCH_MIN} is a floor, not a target.`,
    check: (src) => linesWithStyleName(src)
      .filter(({ line, style }) => {
        if (!style || !CONTROL.test(style) || NOT_CONTROL.test(style)) return false;
        const m = /(?:minHeight|height):\s*(\d+)/.exec(line);
        return m && Number(m[1]) < D.TOUCH_MIN;
      })
      .map(({ n, line, style }) => ({ n, msg: `${style} is under ${D.TOUCH_MIN}pt: ${line.trim()}` })),
  },
  {
    id: "no-stretched-buttons",
    why: "§3 — never full-width or stretched buttons. Natural width, fixed height.",
    check: (src) => linesWithStyleName(src)
      .filter(({ line, style }) => style && /btn|button|decide|retry/i.test(style) && /width:\s*"100%"/.test(line))
      .map(({ n, style }) => ({ n, msg: `${style} is stretched to 100% — give it a natural width` })),
  },
  {
    id: "image-failure",
    why: "§6 — every image needs a designed fallback for BOTH missing and failed. A 404 otherwise leaves a hole.",
    check: (src) => {
      const out = [];
      const re = /<Image\b/g;
      let m;
      while ((m = re.exec(src))) {
        const tail = src.slice(m.index, src.indexOf(">", m.index) + 1);
        if (!/onError/.test(tail)) out.push({ n: src.slice(0, m.index).split("\n").length, msg: "<Image> with no onError fallback" });
      }
      return out;
    },
  },
  {
    id: "no-loose-colours",
    why: "§0a — never introduce a colour. Every value comes from the palette.",
    check: (src) => linesWithStyleName(src)
      .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b/.test(line))
      .map(({ n, line }) => ({ n, msg: `colour literal outside design.js: ${line.trim()}` })),
  },
  {
    id: "no-emoji-ui",
    why: "§0a — emoji are not an icon set. They carry another vendor's illustration style, refuse your colour, render differently on every OS, and sit at a weight and optical size you did not choose. Draw the mark (src/Icon.tsx).",
    check: (src) => {
      const out = [];
      const re = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
      src.split("\n").forEach((line, i) => {
        const m = line.match(re);
        if (m) out.push({ n: i + 1, msg: `emoji used as UI: ${[...new Set(m)].join(" ")}` });
      });
      return out;
    },
  },
  {
    id: "rows-wrap",
    why: "§4 — any row of 3+ items needs flexWrap or a proven fit. Three buttons once put 'Copy link' outside the sheet.",
    check: (src) => {
      const out = [];
      for (const b of src.split(/^\s{2}(?=[A-Za-z0-9_]+:\s*\{)/m)) {
        const name = /^([A-Za-z0-9_]+):/.exec(b)?.[1];
        if (!name || !/actions|grid/i.test(name)) continue;
        if (/flexDirection:\s*"row"/.test(b) && !/flexWrap/.test(b)) {
          out.push({ n: src.slice(0, src.indexOf(b)).split("\n").length, msg: `${name} is a row of controls with no flexWrap` });
        }
      }
      return out;
    },
  },
];

// ─── frame simulation ────────────────────────────────────────────────────────

/** Sample a transition at the real refresh rate and return every frame. */
export function frames(sample, totalMs, hz = D.FRAME_HZ) {
  const dt = 1000 / hz;
  const out = [];
  for (let t = 0; t <= totalMs + dt; t += dt) out.push({ t, v: sample(t) });
  return out;
}

/**
 * The frame audit. Everything a transition can do wrong that a still image
 * cannot show you.
 */
export function auditFrames(name, sample, budgetMs, { maxOvershoot = 0, monotonic = false } = {}) {
  const f = frames(sample, budgetMs);
  const bad = [];

  if (f.some((x) => !Number.isFinite(x.v))) {
    bad.push(`${name}: produced a non-finite value — the curve is broken, not merely ugly`);
    return bad;
  }

  // Dead lead-in: frames where nothing perceptibly happens read as the app
  // hanging, and are the single most common reason a transition feels cheap.
  const firstMove = f.find((x) => x.t > 0 && Math.abs(x.v) >= D.MIN_FIRST_FRAME);
  if (!firstMove) bad.push(`${name}: never moves within its budget`);
  else if (firstMove.t > 1000 / D.FRAME_HZ * 2) {
    bad.push(`${name}: dead for ${firstMove.t.toFixed(1)}ms before moving — reads as lag`);
  }

  // A frame that covers too much of the journey reads as a cut, not motion.
  let worst = { d: 0, t: 0 };
  for (let i = 1; i < f.length; i++) {
    const d = Math.abs(f[i].v - f[i - 1].v);
    if (d > worst.d) worst = { d, t: f[i].t };
  }
  if (worst.d > D.MAX_FRAME_TRAVEL) {
    bad.push(`${name}: one frame at ${worst.t.toFixed(1)}ms moves ${(worst.d * 100).toFixed(1)}% of the way (max ${(D.MAX_FRAME_TRAVEL * 100).toFixed(0)}%) — reads as a cut`);
  }

  // Overshoot must be a decision, not an accident.
  const peak = Math.max(...f.map((x) => x.v));
  const over = Math.max(0, peak - 1);
  if (over > maxOvershoot + 1e-6) {
    bad.push(`${name}: overshoots ${(over * 100).toFixed(2)}%, budget ${(maxOvershoot * 100).toFixed(2)}%`);
  }

  if (monotonic) {
    const dip = f.findIndex((x, i) => i > 0 && x.v < f[i - 1].v - 1e-9);
    if (dip > 0) bad.push(`${name}: not monotonic — reverses at ${f[dip].t.toFixed(1)}ms`);
  }

  // Settled, and STAYS settled. A curve that creeps after arriving is a curve
  // that will shimmer on a 120Hz display.
  const settleIdx = f.findIndex((x) => Math.abs(x.v - 1) < 0.005);
  if (settleIdx === -1) {
    bad.push(`${name}: never settles within ${budgetMs}ms`);
  } else {
    const settleMs = f[settleIdx].t;
    if (settleMs > D.MAX_SETTLE_MS) bad.push(`${name}: settles at ${settleMs.toFixed(0)}ms, budget ${D.MAX_SETTLE_MS}ms`);
    const drift = Math.max(...f.slice(settleIdx).map((x) => Math.abs(x.v - 1)));
    if (drift > Math.max(0.005, maxOvershoot)) bad.push(`${name}: drifts ${(drift * 100).toFixed(2)}% after settling`);
  }

  const end = f[f.length - 1].v;
  if (Math.abs(end - 1) > 0.005) bad.push(`${name}: ends at ${end.toFixed(4)}, not 1 — the transition does not arrive`);

  return bad;
}

// ─── system rules ────────────────────────────────────────────────────────────

const SPRING_BUDGET = { press: 0, enter: 0.02, sheet: 0.06 };

const systemRules = [
  {
    id: "contrast",
    why: "§2 — text nobody can read is not a design decision. WCAG 2.1: 4.5:1 for body text.",
    check: (d) => {
      const out = [];
      for (const [scheme, palette] of [["light", d.light], ["dark", d.dark]]) {
        for (const [fg, bg] of d.PAIRINGS) {
          const ratio = d.contrast(palette[fg], palette[bg]);
          if (ratio < 4.5) out.push({ msg: `${scheme}: ${fg} on ${bg} is ${ratio}:1 (needs 4.5:1)` });
        }
      }
      return out;
    },
  },
  {
    id: "type-floor",
    why: "§1 — 11px is the floor. No exceptions, including one the ratio wants.",
    check: (d) => Object.values(d.type)
      .filter((t) => t.fontSize < d.TYPE_FLOOR)
      .map((t) => ({ msg: `${t.name} is ${t.fontSize}px, below the ${d.TYPE_FLOOR}px floor` })),
  },
  {
    id: "type-complete",
    why: "§1 — every step ships with its paired line-height and tracking. A bare size is half a decision. Display type may set SOLID (leading below the size) because a wordmark is one line, but never below 0.85 or the ascenders collide.",
    check: (d) => Object.values(d.type)
      .filter((t) => !(t.lineHeight >= t.fontSize * 0.85) || typeof t.letterSpacing !== "number")
      .map((t) => ({ msg: `${t.name}: lineHeight ${t.lineHeight} against size ${t.fontSize} — below the 0.85 solid floor` })),
  },
  {
    id: "spacing-grid",
    why: "§3 — 4pt scale. A 13pt gap next to a 12pt gap is noise nobody can name but everybody feels.",
    check: (d) => Object.entries(d.sp)
      .filter(([, v]) => v % d.GRID !== 0)
      .map(([k, v]) => ({ msg: `sp.${k} = ${v} is off the ${d.GRID}pt grid` })),
  },
  {
    id: "motion-frames",
    why: "§5 — every transition is simulated frame by frame at 120Hz: no dead lead-in, no cut, overshoot on budget, settles and stays settled.",
    check: (d) => {
      const out = [];
      for (const [name, s] of Object.entries(d.springs)) {
        const budget = SPRING_BUDGET[name] ?? 0.06;
        out.push(...auditFrames(`spring.${name}`, (ms) => d.springAt(s, ms / 1000), d.MAX_SETTLE_MS,
          { maxOvershoot: budget, monotonic: s.dampingRatio >= 1 })
          .map((msg) => ({ msg })));
        // The derivation must actually produce the feel it promises.
        const predicted = d.overshoot(s);
        if (predicted > budget + 1e-6) out.push({ msg: `spring.${name}: closed-form overshoot ${(predicted * 100).toFixed(2)}% exceeds budget ${(budget * 100).toFixed(0)}%` });
      }
      for (const [name, [x1, y1, x2, y2]] of Object.entries(d.easing)) {
        const f = d.bezier(x1, y1, x2, y2);
        out.push(...auditFrames(`easing.${name}`, (ms) => f(ms / d.duration.base), d.duration.base,
          { maxOvershoot: 0, monotonic: true }).map((msg) => ({ msg })));
      }
      return out;
    },
  },
  {
    id: "list-label-contrast",
    why: "§2 — every list colour carries a label on top of it, and the label colour is PER LIST (yellow cannot take white). This must read listOn rather than assume one label colour for all four — assuming it would have shipped a 1.4:1 label on Movies.",
    check: (d) => {
      const out = [];
      for (const scheme of ["light", "dark"]) {
        for (const k of d.LIST_KEYS) {
          const r = d.contrast(d.listOn[k], d[scheme][k]);
          if (r < 4.5) out.push({ msg: `${scheme}: ${d.listOn[k]} label on ${k} is ${r}:1` });
        }
      }
      return out;
    },
  },
  {
    id: "placeholder-inverts",
    why: "§6 — a skeleton must read as ABOVE the card in dark and BELOW it in light. One 'sunk' token cannot do both, and using one made every placeholder in dark mode look like a hole punched through the card.",
    check: (d) => {
      const out = [];
      if (d.luminance(d.light.placeholder) >= d.luminance(d.light.surface)) out.push({ msg: "light: placeholder is not darker than surface" });
      if (d.luminance(d.dark.placeholder) <= d.luminance(d.dark.surface)) out.push({ msg: "dark: placeholder is not lighter than surface" });
      return out;
    },
  },
  {
    id: "cover-grid",
    why: "§3 / §0a — a cover's trim is a derived size, not a hand-picked one: both dimensions on the 4pt grid, aspect inside the range real jackets occupy, and the composition index inside the set that is actually implemented. A comp the renderer has no branch for falls through to a blank field. The band is 1.15–1.85 rather than a tight 1.5: a wide art-book trim is legitimately squarer, and heights are deliberately near-constant because a row is as tall as its tallest member.",
    check: (d) => {
      const out = [];
      // Walk enough distinct titles to exercise every branch of the hash.
      for (let i = 0; i < 400; i++) {
        const title = `title ${i} ${"x".repeat(i % 17)}`;
        const { width, height, comp } = d.coverFor(title);
        if (width % d.GRID || height % d.GRID) out.push({ msg: `coverFor("${title}") = ${width}×${height}, off the ${d.GRID}pt grid` });
        const aspect = height / width;
        if (aspect < 1.15 || aspect > 1.85) out.push({ msg: `coverFor("${title}") aspect ${aspect.toFixed(2)} is outside 1.15–1.85` });
        if (d.cover.heights) {
          const spread = Math.max(...d.cover.heights) - Math.min(...d.cover.heights);
          if (spread > 24) out.push({ msg: `heights spread ${spread}pt — every short cover on a shelf gets that much dead air above it` });
        }
        if (!Number.isInteger(comp) || comp < 0 || comp >= d.cover.comps) out.push({ msg: `coverFor("${title}") comp ${comp} outside 0..${d.cover.comps - 1}` });
      }
      return out.slice(0, 4);
    },
  },
  {
    id: "jacket-fits",
    why: "§1 — a cover title must FIT its trim. Set at a fixed step and left to wrap, 'The Dispossessed' rendered as 'Disposs / essed' on a 112pt jacket: a word split mid-syllable is a rendering failure, not a line break, and numberOfLines does not hide it. The size is derived from the longest word, and only the 11px floor may outrank the fit.",
    check: (d) => {
      const out = [];
      const words = ["Piranesi", "The Dispossessed", "Cacio e pepe", "Ganapati", "Mangal II", "Solenoid", "Extraordinarily", "A", "Pot-au-feu"];
      for (const w of d.cover.widths) {
        const box = w - 2 * d.COVER_KEYLINE - 2 * d.cover.pad;
        for (const title of words) {
          const { fontSize, lineHeight } = d.jacketType(title, w);
          const longest = title.split(/\s+/).reduce((n, x) => Math.max(n, x.length), 1);
          const needed = longest * fontSize * d.JACKET_GLYPH;
          if (needed > box + 1e-6 && fontSize > d.TYPE_FLOOR) {
            out.push({ msg: `"${title}" at ${fontSize}px needs ${needed.toFixed(1)}pt on a ${w}pt trim (box ${box}pt) — it will break mid-word` });
          }
          if (fontSize < d.TYPE_FLOOR) out.push({ msg: `"${title}" sized to ${fontSize}px, below the ${d.TYPE_FLOOR}px floor` });
          if (lineHeight < fontSize * 0.85) out.push({ msg: `"${title}" leading ${lineHeight} against size ${fontSize}` });
        }
      }
      return out.slice(0, 4);
    },
  },
  {
    id: "stagger-budget",
    why: "§5 — stagger caps at ~8 steps / 280ms. Past a third of a second it reads as slowness, not craft.",
    check: (d) => {
      const total = d.staggerDelay(50);
      return total > 280 ? [{ msg: `stagger reaches ${total}ms across the list (max 280ms)` }] : [];
    },
  },
];

// ─── run ─────────────────────────────────────────────────────────────────────

async function run() {
  let findings = 0;
  for (const k of REQUIRED_OBJECTS) {
    if (D[k] == null) {
      findings++;
      console.error(`design.js  [missing-export] ${k} is not exported — something deleted it, and the failure will surface far from here`);
    }
  }
  for (const k of REQUIRED_NUMBERS) {
    if (typeof D[k] !== "number" || !Number.isFinite(D[k])) {
      findings++;
      console.error(`design.js  [missing-constant] ${k} is ${D[k]} — every check that compares against it is silently passing`);
    }
  }
  for (const rule of systemRules) {
    for (const f of rule.check(D)) {
      findings++;
      console.error(`design.js  [${rule.id}] ${f.msg}`);
      console.error(`    ${rule.why}`);
    }
  }
  for (const file of SOURCES) {
    const src = await readFile(new URL(file, import.meta.url), "utf8");
    for (const rule of staticRules) {
      for (const f of rule.check(src)) {
        findings++;
        console.error(`${file}:${f.n}  [${rule.id}] ${f.msg}`);
        console.error(`    ${rule.why}`);
      }
    }
  }
  if (findings) {
    console.error(`\n${findings} design violation${findings > 1 ? "s" : ""}.`);
    return 1;
  }
  const nSprings = Object.keys(D.springs).length;
  const nEasings = Object.keys(D.easing).length;
  const nPairs = D.PAIRINGS.length * 2;
  console.log(`design gate clean`);
  console.log(`  ${staticRules.length} static rules over ${SOURCES.join(", ")}`);
  console.log(`  ${nPairs} contrast pairings (light + dark), all ≥ 4.5:1`);
  console.log(`  ${nSprings + nEasings} transitions simulated at ${D.FRAME_HZ}Hz, frame by frame`);
  console.log(`
§0.2, honestly: every screen HAS been rendered and looked at — react-native-web
in Chromium at 320 and 375, light and dark, via \`npm run preview\`, with tap
targets measured off the live layout rather than eyeballed. That caught a
collapsed 2x2 grid, a tab strip eating 200pt of vertical space, and skeletons
that read as holes in dark mode. What it does NOT cover: iOS fonts and emoji,
native scrolling and blur, and the share sheet in its real host. Those still
need a device.`);
  return 0;
}

function printFrames() {
  for (const [name, s] of Object.entries(D.springs)) {
    console.log(`\nspring.${name}  ζ=${s.dampingRatio} settle=${s.settleMs}ms stiffness=${s.stiffness} damping=${s.damping}`);
    const f = frames((ms) => D.springAt(s, ms / 1000), D.MAX_SETTLE_MS);
    // Every 6th frame at 120Hz = every 50ms, enough to read on a terminal.
    for (let i = 0; i < f.length; i += 6) {
      const v = f[i].v;
      const bar = "█".repeat(Math.max(0, Math.round(v * 44)));
      console.log(`  ${f[i].t.toFixed(0).padStart(4)}ms ${(v * 100).toFixed(1).padStart(6)}%  ${bar}`);
    }
  }
}

// ─── selftest ────────────────────────────────────────────────────────────────
// §4d: a check that has never failed is a comment, not a check. Each rule is
// fed a deliberate violation AND clean input — a rule that fires on everything
// is as useless as one that fires on nothing.

const STATIC_PROBES = {
  "type-scale": { bad: `const s = {\n  x: {\n    fontSize: 34,\n  },\n};`, good: `const s = {\n  x: {\n    fontSize: glyph.lg,\n  },\n};` },
  "touch-target": { bad: `const s = {\n  btn: {\n    minHeight: 40,\n  },\n};`, good: `const s = {\n  btn: {\n    minHeight: 44,\n  },\n  thumb: {\n    height: 20,\n  },\n};` },
  "no-stretched-buttons": { bad: `const s = {\n  pairBtn: {\n    width: "100%",\n  },\n};`, good: `const s = {\n  pairBtn: {\n    alignSelf: "center",\n  },\n  input: {\n    width: "100%",\n  },\n};` },
  "image-failure": { bad: `<Image source={{ uri: u }} style={x} />`, good: `<Image source={{ uri: u }} style={x} onError={f} />` },
  "no-loose-colours": { bad: `const s = {\n  x: {\n    color: "#ff0000",\n  },\n};`, good: `const s = {\n  x: {\n    color: c.ink,\n  },\n};` },
  "no-emoji-ui": { bad: 'const s = { x: { label: "\u{1F4DA} Books" } };', good: 'const s = { x: { label: "Books" } };' },
  "rows-wrap": { bad: `const s = {\n  actions: {\n    flexDirection: "row",\n  },\n};`, good: `const s = {\n  actions: {\n    flexDirection: "row", flexWrap: "wrap",\n  },\n};` },
};

// Deliberately broken systems, one per system rule.
const SYSTEM_PROBES = {
  contrast: { ...D, light: { ...D.light, inkFaint: "#CCCCCC" } },
  "type-floor": { ...D, type: { ...D.type, micro: { name: "micro", fontSize: 9, lineHeight: 12, letterSpacing: 0 } } },
  "type-complete": { ...D, type: { ...D.type, body: { name: "body", fontSize: 15, lineHeight: 4, letterSpacing: 0 } } },
  "spacing-grid": { ...D, sp: { ...D.sp, odd: 13 } },
  "placeholder-inverts": { ...D, dark: { ...D.dark, placeholder: "#000000" } },
  "list-label-contrast": { ...D, listOn: { ...D.listOn, movies: "#FFFFFF" } },
  // A trim that is off-grid and far too square — exactly what hand-picking a
  // "nice looking" cover size produces.
  "cover-grid": { ...D, coverFor: () => ({ width: 101, height: 110, comp: 0 }) },
  // Type picked by eye instead of solved for: it looks right on "Kiln" and
  // shatters "The Dispossessed".
  "jacket-fits": { ...D, jacketType: () => ({ fontSize: 40, lineHeight: 42 }) },
  // ζ=0.35 is a spring that visibly bounces; the press budget forbids any.
  "motion-frames": { ...D, springs: { press: D.spring({ dampingRatio: 0.35, settleMs: 220 }) } },
  "stagger-budget": { ...D, staggerDelay: (i) => Math.min(i, 20) * 40 },
};

function selftest() {
  let fail = 0;
  for (const rule of staticRules) {
    const p = STATIC_PROBES[rule.id];
    if (!p) { fail++; console.error(`FAIL ${rule.id}: no probe — an unproven check`); continue; }
    if (rule.check(p.bad).length === 0) { fail++; console.error(`FAIL ${rule.id}: did NOT fire on a deliberate violation`); }
    const noise = rule.check(p.good);
    if (noise.length) { fail++; console.error(`FAIL ${rule.id}: fired on clean code`, noise); }
  }
  for (const rule of systemRules) {
    const broken = SYSTEM_PROBES[rule.id];
    if (!broken) { fail++; console.error(`FAIL ${rule.id}: no probe — an unproven check`); continue; }
    if (rule.check(broken).length === 0) { fail++; console.error(`FAIL ${rule.id}: did NOT fire on a deliberately broken system`); }
    if (rule.check(D).length !== 0) { fail++; console.error(`FAIL ${rule.id}: fires on the real system`); }
  }
  // The frame auditor itself must be able to fail, or every motion guarantee
  // above is decorative.
  const cut = auditFrames("probe-cut", (ms) => (ms < 100 ? 0 : 1), 300);
  if (!cut.some((m) => /cut|dead/.test(m))) { fail++; console.error("FAIL frame auditor did not catch a hard cut"); }
  const never = auditFrames("probe-stall", () => 0, 300);
  if (!never.length) { fail++; console.error("FAIL frame auditor did not catch a transition that never moves"); }
  const drifty = auditFrames("probe-drift", (ms) => 1 + 0.2 * Math.sin(ms / 8), 300);
  if (!drifty.some((m) => /drift|overshoot/.test(m))) { fail++; console.error("FAIL frame auditor did not catch post-settle shimmer"); }

  console.log(fail
    ? `verify-design selftest FAILED (${fail})`
    : `verify-design selftest ok — ${staticRules.length + systemRules.length} rules and the frame auditor all fire on a violation and stay quiet on clean input`);
  return fail ? 1 : 0;
}

if (isMain(import.meta.url)) {
  if (process.argv.includes("--frames")) { printFrames(); process.exit(0); }
  process.exit(process.argv.includes("--selftest") ? selftest() : await run());
}
