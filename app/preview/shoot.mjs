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
  { name: "app-375-light", q: "", w: 375, h: 812, scheme: "light" },
  { name: "app-375-dark", q: "", w: 375, h: 812, scheme: "dark" },
  { name: "app-320-light", q: "", w: 320, h: 700, scheme: "light" },
  { name: "app-books-375-light", q: "", w: 375, h: 812, scheme: "light", click: "Books" },
  { name: "pair-375-light", q: "?paired=0", w: 375, h: 812, scheme: "light" },
  { name: "share-375-light", q: "?screen=share", w: 375, h: 320, scheme: "light" },
  { name: "share-375-dark", q: "?screen=share", w: 375, h: 320, scheme: "dark" },
  { name: "share-320-light", q: "?screen=share", w: 320, h: 320, scheme: "light" },
  { name: "share-done-375-light", q: "?screen=share", w: 375, h: 320, scheme: "light", click: "Restaurants" },
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
  if (s.click) {
    await page.getByText(s.click, { exact: false }).first().click();
    await page.waitForTimeout(600);      // and the transition after the tap
  }
  await page.screenshot({ path: OUT + s.name + ".png" });
  console.log(`${errors.length ? "ERR " : "ok  "} ${s.name}${errors.length ? "  " + errors.slice(0, 2).join(" | ") : ""}`);
  await ctx.close();
}
await browser.close();
