// design.js — the single source of truth for every visual constant, and the
// motion math itself.
//
// PLAIN JS ON PURPOSE. The components import this and so does the auditor
// (`verify-design.mjs`, a Node script). If the auditor re-implemented the
// spring, it would be measuring a model of the animation rather than the
// animation — and every frame guarantee below would be worth nothing. One
// implementation, imported by both, is the only arrangement where "audited
// frame by frame" is a true statement.
//
// Nothing here is a taste value picked to look nice in isolation. The type
// scale is a ratio, the spacing is a grid, the springs are specified by the
// two numbers that actually describe how a spring feels (damping ratio and
// settle time) and the stiffness/damping are DERIVED from those. That way a
// change is a decision about feel, not a fiddle with a magic number.

// ─────────────────────────────────────────────────────────────────────────────
// TYPE — a minor-third-ish ratio anchored on 15px body.
//
// Every step carries its own line-height and tracking. Tracking tightens as
// size grows (large type needs less air between letters; small type needs
// more), which is the single change that most separates typography that was
// designed from typography that was defaulted.
// ─────────────────────────────────────────────────────────────────────────────

const RATIO = 1.185;
const BODY = 15;
const step = (n) => Math.round(BODY * Math.pow(RATIO, n) * 2) / 2;

// Optical tracking: roughly -0.4pt per doubling above body, easing to positive
// at small sizes. Continuous, so a new step never needs a hand-picked value.
const trackingFor = (size) => Math.round((-0.36 * Math.log2(size / BODY) + (size <= 12 ? 0.32 : 0)) * 100) / 100;

// Line-height: tight for display, generous for reading. Also continuous.
const leadingFor = (size) => {
  const ratio = size >= 24 ? 1.16 : size >= 18 ? 1.28 : size >= 15 ? 1.47 : 1.38;
  return Math.round(size * ratio * 2) / 2;
};

// 11px is the floor and it OUTRANKS the ratio. The ladder wanted 10.5 for the
// smallest step; a ratio is a tool for making decisions, not a reason to ship
// type nobody can read. Clamped here, and asserted by the auditor so the two
// can never drift apart again.
export const TYPE_FLOOR = 11;

const mkType = (name, rawSize, weight) => {
  const size = Math.max(TYPE_FLOOR, rawSize);
  return {
    name, fontSize: size, lineHeight: leadingFor(size),
    letterSpacing: trackingFor(size), fontWeight: weight,
  };
};

// Sizes are derived, so no number is written here twice. Print them with
// `node -e` rather than trusting a comment — a stale comment claiming 11 while
// the code produced 10.5 is exactly how this got caught.
export const type = {
  display: mkType("display", step(5), "700"),
  title:   mkType("title",   step(3), "700"),
  heading: mkType("heading", step(1.5), "600"),
  body:    mkType("body",    step(0), "400"),
  bodyMed: mkType("bodyMed", step(0), "600"),
  meta:    mkType("meta",    step(-1), "400"),
  micro:   mkType("micro",   step(-2), "600"),
};

// Emoji used as illustration. Three named steps so a fourth cannot be inlined.
export const glyph = { sm: 22, lg: 34, mark: 40 };

// ─────────────────────────────────────────────────────────────────────────────
// SPACE — a strict 4pt grid.
// ─────────────────────────────────────────────────────────────────────────────

export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 };
export const GRID = 4;

// Radii are on their own small scale; the card radius and the tile radius
// being "nearly the same" is the kind of thing that reads as sloppiness
// without anyone being able to say why.
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };

export const TOUCH_MIN = 44;   // Apple HIG floor. A floor, not a target.
export const TOUCH = 48;

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR — one palette, two schemes, every pairing contrast-checked.
//
// Warm neutrals rather than pure greys: a shelf of saved things should feel
// like paper, not like a settings screen. The accent is a burnt sienna that
// survives both schemes at text weight, which pure orange does not.
// ─────────────────────────────────────────────────────────────────────────────

export const light = {
  bg: "#FAF8F4",
  surface: "#FFFFFF",
  surfaceSunk: "#F1EDE6",
  ink: "#16130F",
  inkSoft: "#5C564D",
  inkFaint: "#746D62",
  line: "#E4DED3",
  lineStrong: "#CFC7B8",
  accent: "#A8431A",
  accentInk: "#FFFFFF",
  accentWash: "#F6E9E1",
  good: "#1F5D3F",
  warn: "#7A5310",
};

export const dark = {
  bg: "#131110",
  surface: "#1D1A18",
  surfaceSunk: "#0E0C0B",
  ink: "#F4F0EA",
  inkSoft: "#B0A89C",
  inkFaint: "#8D857A",
  line: "#2E2A26",
  lineStrong: "#433D37",
  accent: "#F08A5A",
  accentInk: "#1A0E07",
  accentWash: "#2A1C14",
  good: "#6FCF97",
  warn: "#E0B057",
};

// Text/background pairings that actually occur in the UI. The auditor walks
// this list rather than guessing — DESIGN-RULES §4d is explicit that measuring
// the DOM instead of the experience produces confident wrong answers, and
// "every colour against every other colour" is that mistake in palette form.
export const PAIRINGS = [
  ["ink", "bg"], ["ink", "surface"], ["ink", "surfaceSunk"],
  ["inkSoft", "bg"], ["inkSoft", "surface"],
  ["inkFaint", "bg"], ["inkFaint", "surface"],
  ["accent", "bg"], ["accent", "surface"], ["accent", "accentWash"],
  ["accentInk", "accent"],
  ["good", "bg"], ["good", "surface"],
  ["warn", "bg"], ["warn", "surface"],
];

// WCAG 2.1 relative luminance + contrast ratio. Exact, not approximated.
export function luminance(hex) {
  const h = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTION
//
// Springs are specified by DAMPING RATIO (how much it overshoots) and SETTLE
// TIME (how long until it is visually done). Those are the two things a person
// perceives. Stiffness and damping are derived, because nobody has ever had an
// opinion about a stiffness of 420.
//
//   ζ  < 1  underdamped — overshoots, feels alive
//   ζ == 1  critically damped — fastest arrival with no overshoot
//   ζ  > 1  overdamped — sluggish, reads as heavy
//
// settle is defined at the 0.1% threshold: t = -ln(0.001) / (ζ·ω₀)
// ─────────────────────────────────────────────────────────────────────────────

const SETTLE_EPS = 0.001;
const LN_EPS = -Math.log(SETTLE_EPS); // ≈ 6.9078

/** Derive {stiffness, damping, mass} from the feel you actually want. */
export function spring({ dampingRatio, settleMs, mass = 1 }) {
  const zw0 = LN_EPS / (settleMs / 1000); // ζ·ω₀
  const w0 = zw0 / dampingRatio;
  return {
    dampingRatio, settleMs, mass,
    stiffness: Math.round(w0 * w0 * mass * 10) / 10,
    damping: Math.round(2 * dampingRatio * w0 * mass * 10) / 10,
    omega0: w0,
  };
}

/**
 * Closed-form position of a unit spring at time t (seconds), from 0 to 1,
 * released at rest. All three damping regimes, because a system that silently
 * mis-handles ζ ≥ 1 will look fine right up until someone asks for a spring
 * that does not bounce.
 */
export function springAt(s, t) {
  const { dampingRatio: z, omega0: w0 } = s;
  if (t <= 0) return 0;
  if (Math.abs(z - 1) < 1e-9) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  const r = w0 * Math.sqrt(z * z - 1);
  const a = (z * w0 + r) / (2 * r);
  const b = (r - z * w0) / (2 * r);
  return 1 - Math.exp(-z * w0 * t) * (a * Math.exp(-r * t) + b * Math.exp(r * t));
}

/** Peak overshoot as a fraction above the target (0 for ζ ≥ 1). */
export const overshoot = (s) =>
  s.dampingRatio >= 1 ? 0 : Math.exp((-Math.PI * s.dampingRatio) / Math.sqrt(1 - s.dampingRatio * s.dampingRatio));

// Cubic bezier, Newton–Raphson on x then evaluate y. Same curve the platform
// runs, so auditing it means something.
export function bezier(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= (calc(t, x1, x2) - x) / d;
    }
    return calc(t, y1, y2);
  };
}

export const duration = { instant: 90, quick: 150, base: 230, slow: 340, page: 430 };

export const easing = {
  // Asymmetric, deceleration-weighted. Things arrive gently and leave briskly —
  // the single most reliable difference between motion that feels considered
  // and motion that feels linear.
  standard: [0.32, 0.02, 0.0, 1.0],
  // Initial slope is y1/x1 and it is NOT a free parameter: at 120Hz over the
  // base duration, one frame is 3.6% of the journey, so a slope above ~9 puts
  // more than a third of the travel in the first frame and reads as a snap.
  // The first draft here was [0.05, 0.7, …] — slope 14 — and the frame audit
  // caught it. 0.61/0.22 = 2.8.
  enter: [0.22, 0.61, 0.36, 1.0],
  exit: [0.4, 0.0, 0.9, 0.35],
};

export const springs = {
  // No overshoot: a press that bounces reads as a bug, not as delight.
  press: spring({ dampingRatio: 1.0, settleMs: 220 }),
  // A trace of overshoot — enough to feel physical, not enough to notice.
  enter: spring({ dampingRatio: 0.82, settleMs: 340 }),
  // The share sheet's arrival. It is allowed to have a little presence.
  sheet: spring({ dampingRatio: 0.72, settleMs: 430 }),
};

// Stagger: never more than 8 steps, never longer than 280ms in total, or it
// stops reading as craft and starts reading as the app being slow.
export const STAGGER_STEP = 32;
export const STAGGER_MAX_STEPS = 8;
export const staggerDelay = (i) => Math.min(i, STAGGER_MAX_STEPS - 1) * STAGGER_STEP;

// Press scale is size-dependent: a 44pt control and a 300pt card must not
// scale by the same factor, or the big one looks like it is collapsing.
export const pressScale = (sizePt) => Math.max(0.96, 1 - 2.2 / Math.max(sizePt, 40));

// The frame budget every transition is audited against.
export const FRAME_HZ = 120;              // ProMotion. Audit the hard case.
export const MAX_SETTLE_MS = 500;         // beyond this a transition reads as a wait
export const MAX_FRAME_TRAVEL = 0.34;     // >34% of the journey in one frame reads as a cut
export const MIN_FIRST_FRAME = 0.0008;    // below this the first frames look like lag
