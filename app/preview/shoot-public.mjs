// shoot-public.mjs — render the PUBLIC pages and look at them.
//
// The shared page is the one surface a stranger sees, and it is the only part
// of shelf that never runs through react-native-web — so the app harness could
// not have caught a defect here. Same rule, second surface: render it, look at
// it, at 375 and 320, in both schemes.
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderProfile, renderShelf, renderItem, renderGone } from "../../api/page.js";

const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
const TMP = fileURLToPath(new URL("./.public/", import.meta.url));
await mkdir(OUT, { recursive: true });
await mkdir(TMP, { recursive: true });

const owner = {
  handle: "suren", display_name: "Suren Chaplot",
  bio: "Mostly things I saw at 1am and could not stop thinking about. Peckham, mostly.",
  plate_seed: "suren", since: "2026-03-02T00:00:00Z",
};
const mk = (list, rows) => rows.map(([title, subtitle, image_url], i) =>
  ({ id: `${list}-${i}`, list, title, subtitle, image_url: image_url ?? null }));

const lists = {
  books: mk("books", [["Piranesi", "Susanna Clarke"], ["Babel, or the Necessity of Violence", "R.F. Kuang"],
    ["The Dispossessed", "Ursula K. Le Guin"], ["Solenoid", "Mircea Cărtărescu"], ["Checkout 19", "Claire-Louise Bennett"]]),
  restaurants: mk("restaurants", [["Ganapati", "Peckham"], ["Kiln", "Soho"], ["St. John", "Smithfield"], ["Mangal II", "Dalston"]]),
  movies: mk("movies", [["Sinners", "2025"], ["Petrol", "2022"], ["La Chimera", "2023"]]),
  recipes: mk("recipes", [["Lemon dal", "30 min"], ["Cacio e pepe", "15 min"], ["Pot-au-feu", "3 hr"]]),
};

const PAGES = [
  ["public-profile", renderProfile({ owner, lists })],
  ["public-shelf", renderShelf({ owner, list: "restaurants", items: lists.restaurants, note: "Everywhere I'd send you in south London." })],
  ["public-item", renderItem({ owner, item: { ...lists.books[0], note: "The one everyone in my feed could not shut up about.", source_url: "https://instagram.com/reel/x" }, note: "You'll like this one." })],
  ["public-gone", renderGone()],
];

const SHOTS = [
  { w: 390, h: 1200, scheme: "light", tag: "390-light" },
  { w: 390, h: 1200, scheme: "dark", tag: "390-dark" },
  { w: 320, h: 1100, scheme: "light", tag: "320-light" },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const [name, body] of PAGES) {
  const file = `${TMP}${name}.html`;
  await writeFile(file, body);
  for (const s of SHOTS) {
    if (name === "public-gone" && s.tag !== "390-light") continue;
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, colorScheme: s.scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("file://" + file);
    await page.waitForTimeout(250);
    // A page that scrolls sideways on a phone is a broken page, and it is
    // invisible in a full-page screenshot — so measure it rather than look.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) errors.push(`page scrolls horizontally by ${overflow}px`);
    await page.screenshot({ path: `${OUT}${name}-${s.tag}.png`, fullPage: name !== "public-profile" });
    console.log(`${errors.length ? "ERR " : "ok  "} ${name}-${s.tag}${errors.length ? "  " + errors.join(" | ") : ""}`);
    await ctx.close();
  }
}
await browser.close();
