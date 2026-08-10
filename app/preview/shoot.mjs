// Render every screen at every width, in both schemes, and write PNGs.
// This is DESIGN-RULES §0.2 — "render it and look at it" — as far as a Linux
// box can take it: react-native-web running the real components with the real
// styles, in Chromium. It is not iOS: fonts, emoji rasterisation and the
// native scroll/blur are different. It IS the real layout, the real palette,
// the real type scale and the real wrapping behaviour, which is where the
// defects that matter actually live.
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const URLBASE = "file://" + fileURLToPath(new URL("./index.html", import.meta.url));
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
await mkdir(OUT, { recursive: true });

const SHOTS = [
  { name: "app-375-light", q: "", w: 375, h: 980, scheme: "light" },
  { name: "app-375-dark", q: "", w: 375, h: 980, scheme: "dark" },
  { name: "app-320-light", q: "", w: 320, h: 900, scheme: "light" },
  { name: "app-restaurants-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Restaurants," },
  { name: "app-inbox-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Not shelved," },
  { name: "app-recipes-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Recipes," },
  // Tapping a jacket. The detail panel is the same two colours and the same
  // composition language at full size, so opening one reads as a zoom.
  { name: "app-detail-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Restaurants,", click: "St. John" },
  { name: "app-detail-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Restaurants,", click: "St. John" },
  // The same panel with a frame off the reel — the two cases the field has to
  // hold, and the only way to see whether the empty one is composed or unfinished.
  // By LABEL, not by text: a jacket showing artwork has no text node at all,
  // which is exactly why getByText timed out here the first time.
  { name: "app-detail-art-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Piranesi, Susanna Clarke" },
  { name: "pair-375-light", q: "?paired=0", w: 375, h: 980, scheme: "light" },
  { name: "share-375-light", q: "?screen=share", w: 375, h: 420, scheme: "light" },
  { name: "share-375-dark", q: "?screen=share", w: 375, h: 420, scheme: "dark" },
  { name: "share-320-light", q: "?screen=share", w: 320, h: 420, scheme: "light" },
  { name: "share-done-375-light", q: "?screen=share", w: 375, h: 420, scheme: "light", click: "Restaurants" },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
    colorScheme: s.scheme,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URLBASE + s.q);
  await page.waitForTimeout(700);        // let the entrance stagger finish
  if (s.scroll) {
    // RNW's ScrollView is an overflow div, not the window — scrolling the
    // window here silently does nothing and you screenshot the top twice.
    await page.evaluate((y) => {
      const el = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 40);
      if (!el) throw new Error("no scrollable container found");
      el.scrollTop = y;
    }, s.scroll);
    await page.waitForTimeout(200);
  }
  // Both, in order: reaching a jacket that is not on the default shelf takes
  // two taps — pick the list, then pick the thing.
  for (const step of [s.clickLabel && ["label", s.clickLabel], s.click && ["text", s.click]].filter(Boolean)) {
    const target = step[0] === "label"
      ? page.getByLabel(step[1], { exact: false })
      : page.getByText(step[1], { exact: false });
    await target.first().click();
    await page.waitForTimeout(600);      // and the transition after the tap
  }
  await page.screenshot({ path: OUT + s.name + ".png" });
  console.log(`${errors.length ? "ERR " : "ok  "} ${s.name}${errors.length ? "  " + errors.slice(0, 2).join(" | ") : ""}`);
  await ctx.close();
}
await browser.close();
