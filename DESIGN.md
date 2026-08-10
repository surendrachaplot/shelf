# shelf — design rules

**Read before writing any UI.** These are soundcheck's `DESIGN-RULES.md` — written
in anger after real things shipped broken — plus the standing bar below. The
failures they name are not soundcheck-specific and neither are the rules.

Run `node verify-design.mjs` in `app/` before shipping. Twelve of these rules
are mechanised there. The rest are yours to hold.

---

## The bar

**Top 1% of human designers, or it is not finished.** Not "good for an AI", not
"fine for a personal app" — eligible for an Apple Design Award on the merits.
Every pixel deliberate, every transition flawless frame to frame.

That bar is only meaningful if it is falsifiable, so it is:

- **No value is chosen by taste alone.** The type scale is a ratio; tracking and
  leading are continuous functions of size; spacing is a 4pt grid; springs are
  specified by damping ratio and settle time, with stiffness and damping
  *derived*. Nobody has ever had an opinion about a stiffness of 420 — they
  have opinions about whether it bounces and how long it takes.
- **Every transition is simulated frame by frame at 120Hz** and fails the gate
  on: a dead lead-in (reads as lag), a frame that covers more than a third of
  the journey (reads as a cut), overshoot outside its declared budget, drift
  after settling (shimmers on ProMotion), a settle beyond 500ms, or any
  non-finite value. The auditor imports the *same* spring math the app runs, so
  it measures the shipped curve and not a model of it.
- **Every text/surface pairing is contrast-checked in both schemes**, exactly,
  against WCAG 2.1. Thirty pairings, all ≥ 4.5:1.
- **Dark mode is not a v2 thing.** Styles are built from the live palette inside
  components, never frozen at import time — a StyleSheet created once cannot
  follow the system appearance, and that is how an app ends up with one scheme
  permanently wrong.

This bar has already paid for itself twice. The frame audit caught an `enter`
curve whose first frame covered 36.9% of the journey — an initial slope of 14,
which would have read as a snap rather than an ease. The type-floor check caught
the ratio quietly producing 10.5px for the smallest step while a comment claimed
11. Neither is visible in a screenshot; both are obvious to a machine that was
told what "right" means.

**And the honest limit:** none of this is a substitute for §0.2 below. The
auditor says so in its own passing output. A machine can prove the system is
coherent. It cannot tell you the thing is beautiful.

---

## 0a. No new colours. No new buttons.

Every colour comes from `src/design.js`. Every size comes from `type`, `glyph`,
`sp` or `radius`. If a value is missing, add a named step — never inline it.
Verify by *measuring* the resolved value, never by looking at a screenshot: a
flat orange that should have been a gradient looked entirely plausible in one.

## 0. The gate — never ship what you haven't looked at

1. **Grep every new style name before shipping.** A style with no rule renders
   as platform defaults, which is how a button ended up on top of a name.
2. **Render it and look at it.** On a device, at 320px as well as 375px.
   *This is the rule shelf has not yet satisfied. The auditor covers the
   mechanical half and says so explicitly every time it passes.*
3. **Exercise every call site you touched, not one.** A parse check proves
   syntax, never behaviour.
4. **Measure the thing that was asked about**, not an adjacent thing that is
   easier to measure.
5. **A 200 response is not a working feature.** Read the rows.
6. **Print the field names off a live payload** before writing a filter against
   them. Not from memory, not from the SQL.
7. **A number you didn't compute is a guess.** State measurements.

## The rules, in short

- **Type** — no raw sizes; 11px floor, which outranks the ratio; every step
  ships with its paired line-height and tracking; `tabular-nums` on every count.
- **Space** — 4pt grid; never full-width or stretched buttons; a control shares
  the inset of the content it governs.
- **Layout** — any row of 3+ items needs `flexWrap` or a proven fit; verify at
  320px; nothing clipped without a cue.
- **Touch** — 44×44 effective box, measured as painted size + hit slop, not the
  painted size alone.
- **Motion** — one press spring for the whole app; stagger caps at 8 steps /
  280ms; reduced-motion means *no* motion, not faster motion.
- **Images** — a designed fallback for **missing** *and* **failed**. A 404 that
  leaves an empty box reads as breakage.
- **Empty states** — a title, a sentence saying what happens next, and a way
  forward.
- **Data** — distinguish "zero" from "couldn't look". They must never render the
  same way.

## Deltas from soundcheck

- **shelf has its own palette.** Different product, different mood — the rule is
  *one* palette rigorously applied, not *soundcheck's* palette. `design.js` is
  the single source, and §0a applies to it with full force.
- **shelf is iOS-only.** soundcheck's standing rule is that every change ships
  web + mobile web + iOS + Android together, and permits saying so explicitly
  when a surface genuinely can't have it. There is no web surface and no Android
  target here: the product is an iOS share extension, and a share sheet over
  Instagram has no web equivalent.
- **Two surfaces, not one.** The app and the extension are separate processes
  with separate bundles. They share `design.js`, `Press` and `Reveal` so the
  press feel and entrance cannot diverge — a tile in the sheet and a button in
  the Inbox must answer identically or it reads as two apps.
- **The extension's tile grid is a picker, not a row of CTAs.** It is a
  deliberate 2×2. §3's "never stretched buttons" governs `decide`, the actual
  button, which takes its natural width.
