// The tap-target audit, run against the REAL rendered layout.
//
// DESIGN-RULES §0.4 and §4f: measure the thing that was asked about, and
// measure the EFFECTIVE box rather than the painted one. Eyeballing a
// screenshot and deciding a button "looks about 40" is precisely the habit
// those rules exist to kill — this reads getBoundingClientRect off every
// control on every screen at every width instead.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const URLBASE = "file://" + fileURLToPath(new URL("./index.html", import.meta.url));
const MIN = 44;
const HIT_SLOP = 8; // Press passes this to hitSlop; it counts toward the box.

// The overlays have to be OPENED to be measured. A screen that is only ever
// reachable by a tap is a screen this audit never saw, and every new control
// on it is unverified — which was true of Add, the profile card, deliveries
// and the share panel the moment they were written.
const SCREENS = [
  { name: "app 375", q: "", w: 375, h: 812 },
  { name: "app 320", q: "", w: 320, h: 700 },
  { name: "add 375", q: "", w: 375, h: 812, open: "Add something by name" },
  { name: "add 320", q: "", w: 320, h: 700, open: "Add something by name" },
  { name: "card 375", q: "", w: 375, h: 812, open: "Your card" },
  { name: "card 320", q: "", w: 320, h: 700, open: "Your card" },
  { name: "card new 375", q: "?blankProfile=1", w: 375, h: 812, open: "Your card" },
  { name: "share panel 375", q: "", w: 375, h: 812, open: "Share the Books shelf" },
  { name: "share panel 320", q: "", w: 320, h: 700, open: "Share the Books shelf" },
  { name: "detail 375", q: "", w: 375, h: 812, open: "Piranesi, Susanna Clarke" },
  { name: "pair 375", q: "?paired=0", w: 375, h: 812 },
  { name: "share 375", q: "?screen=share", w: 375, h: 320 },
  { name: "share 320", q: "?screen=share", w: 320, h: 320 },
  // The Android host. Same controls, very different geometry — six bands over
  // a whole screen instead of a 320pt sheet — so the numbers are not the iOS
  // ones and measuring only the sheet would leave the taller layout unchecked.
  { name: "android share 412", q: "?screen=android-share", w: 412, h: 915 },
  { name: "android share 360", q: "?screen=android-share", w: 360, h: 800 },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let bad = 0, checked = 0;
for (const s of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
  const page = await ctx.newPage();
  await page.goto(URLBASE + s.q);
  await page.waitForTimeout(700);
  if (s.open) {
    await page.getByLabel(s.open, { exact: false }).first().click();
    await page.waitForTimeout(600);
  }
  const rects = await page.$$eval('[role="button"]', (els, slop) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 24),
        w: Math.round((r.width + slop * 2) * 10) / 10,
        h: Math.round((r.height + slop * 2) * 10) / 10,
        paintedH: Math.round(r.height * 10) / 10,
      };
    }), HIT_SLOP);
  for (const r of rects) {
    checked++;
    if (r.w < MIN || r.h < MIN) {
      bad++;
      console.error(`  FAIL ${s.name}: "${r.text}" effective ${r.w}×${r.h} (painted h ${r.paintedH}) — floor ${MIN}`);
    }
  }
  console.log(`${rects.length ? "ok  " : "??? "} ${s.name}: ${rects.length} controls, smallest effective ${Math.min(...rects.map((r) => Math.min(r.w, r.h)))}pt`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n${bad}/${checked} controls under the ${MIN}pt floor` : `\nall ${checked} controls clear the ${MIN}pt floor`);
process.exit(bad ? 1 : 0);
