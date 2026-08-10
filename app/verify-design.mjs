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
// What it CANNOT do is look at the thing. DESIGN-RULES §0.2 stands unmet until
// a human runs it on a device, and this script says so every time it passes.
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
        if (!style || !CONTROL.test(style)) return false;
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
    why: "§1 — every step ships with its paired line-height and tracking. A bare size is half a decision.",
    check: (d) => Object.values(d.type)
      .filter((t) => !(t.lineHeight > t.fontSize) || typeof t.letterSpacing !== "number")
      .map((t) => ({ msg: `${t.name} has no usable lineHeight/letterSpacing pairing` })),
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
  console.log(`\n§0.2 IS STILL UNMET: nothing here has been looked at. Run it on a device.`);
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
  "rows-wrap": { bad: `const s = {\n  actions: {\n    flexDirection: "row",\n  },\n};`, good: `const s = {\n  actions: {\n    flexDirection: "row", flexWrap: "wrap",\n  },\n};` },
};

// Deliberately broken systems, one per system rule.
const SYSTEM_PROBES = {
  contrast: { ...D, light: { ...D.light, inkFaint: "#CCCCCC" } },
  "type-floor": { ...D, type: { ...D.type, micro: { name: "micro", fontSize: 9, lineHeight: 12, letterSpacing: 0 } } },
  "type-complete": { ...D, type: { ...D.type, body: { name: "body", fontSize: 15, lineHeight: 0, letterSpacing: 0 } } },
  "spacing-grid": { ...D, sp: { ...D.sp, odd: 13 } },
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
