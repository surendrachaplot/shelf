// web/check.mjs — does the built site actually work in a browser?
//
// Not "did esbuild exit 0". A bundle builds perfectly well with a module that
// throws on import, a store that saves nothing, or a screen that renders a
// blank page — and all three of those have happened in this repo. So this
// serves the real output over HTTP and drives it:
//
//   1. it loads with NO console errors and NO uncaught exceptions
//   2. the app is on screen — the wordmark, and all six shelves
//   3. A SHELF SAVED IN THE BROWSER SURVIVES A RELOAD. This is the one that
//      matters: web/fs.js is a filesystem made of localStorage, and if the
//      real store.ts cannot write and re-read through it then the web version
//      loses everything on every refresh, silently, exactly like the outage
//      that started all of this.
//   4. a shared link in the query string (?url=…) is picked up
//   5. Find opens and searches what was restored
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// The SAME folder the build writes and the server serves. It used to be
// ../web-dist/, the build moved to api/public/, and this was not updated — so
// the check served 404s and reported the app as completely broken. A checker
// pointed at the wrong directory is worse than no checker: it cried wolf about
// a live, working site.
const DIST = fileURLToPath(new URL("../../api/public/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png",
                ".webmanifest": "application/manifest+json" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path === "/" ? "index.html" : path.slice(1);
  try {
    const body = await readFile(join(DIST, file));
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (_) {
    res.writeHead(404).end("no");
  }
});
await new Promise((r) => server.listen(8099, r));
const BASE = "http://127.0.0.1:8099/";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } else console.log("  ok  ", label); };

// The sandbox has its own Chromium; a CI runner has Chrome somewhere else.
// Named rather than hardcoded so this check can run in both places.
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("uncaught: " + String(e)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // The API is not reachable from this sandbox and is not what is under test.
  // A failed fetch to it is expected; anything else is not.
  if (/onrender\.com|Failed to load resource|net::ERR/.test(m.text())) return;
  errors.push("console: " + m.text());
});

// ── 1 + 2. it loads, and it is the app ───────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok(errors.length === 0, "no uncaught errors on load", errors.slice(0, 3));
ok(await page.getByText("shelf", { exact: true }).first().isVisible(), "the wordmark is on screen");
// BY LABEL, NOT BY TEXT. The tab strip paints numbers — 01…06 — and the
// shelf name lives in the accessible label, which is also the only thing a
// screen reader gets. Asserting on visible text looked right and was checking
// for words that are deliberately not on screen.
for (const shelf of ["Books", "Restaurants", "Movies", "Recipes", "Quotes", "Places"]) {
  ok((await page.getByLabel(shelf, { exact: false }).count()) > 0, `${shelf} is there`);
}

// ── 3. THE ONE THAT MATTERS ──────────────────────────────────────────────────
// Two halves, and both are needed. READING is seeded here by writing the exact
// bytes store.ts writes — not through store.ts, because the bundle is minified
// and exports nothing to call. WRITING is then proved through the app itself
// further down, by editing a note and reloading: that path runs the real
// save(), the real atomic temp-write-and-rename, over web/fs.js.
const wrote = await page.evaluate(async () => {
  const shelf = {
    version: 1,
    items: [{
      id: "i_web1", list: "books", status: "filed", title: "Piranesi",
      subtitle: "Susanna Clarke", note: "the one with the halls", image_url: null,
      canonical: { author: "Susanna Clarke", year: 2020 }, confidence: 1, enriched: true,
      source_url: null, resolver: "test", created_at: new Date().toISOString(),
    }],
    profile: { name: "", bio: "", seed: "", home_city: "" },
    links: [],
  };
  localStorage.setItem("shelf.fs:shelf/shelf.json", JSON.stringify(shelf));
  return localStorage.getItem("shelf.fs:shelf/shelf.json").length;
});
ok(wrote > 100, "a shelf can be seeded where the app looks for it", wrote);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok((await page.getByText("Piranesi", { exact: false }).count()) > 0,
   "A SAVED SHELF IS READ BACK — store.ts reads through web/fs.js");
ok(errors.length === 0, "still no errors after the reload", errors.slice(0, 3));

// ── 3b. AND THE APP CAN WRITE ────────────────────────────────────────────────
// Editing a note needs no network, so it is the one write that can be driven
// end to end in a sandbox with no API. It goes through the real save(): temp
// file, then rename, then re-read on the next launch.
await page.getByLabel("Piranesi", { exact: false }).first().click();
await page.waitForTimeout(600);
await page.getByLabel("Edit your note", { exact: false }).first().click();
await page.waitForTimeout(400);
await page.locator("textarea, input").first().fill("written in a browser");
await page.getByLabel("Save the note", { exact: false }).first().click();
await page.waitForTimeout(800);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const saved = await page.evaluate(() => localStorage.getItem("shelf.fs:shelf/shelf.json") || "");
ok(saved.includes("written in a browser"),
   "A NOTE TYPED IN THE BROWSER SURVIVES A RELOAD — the whole write path works", saved.slice(0, 120));
const leftovers = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes(".tmp")));
ok(leftovers.length === 0, "no temp file is left behind by the atomic write", leftovers);

// ── 5. Find, over the restored shelf ─────────────────────────────────────────
await page.getByLabel("Search everything you have saved", { exact: false }).first().click();
await page.waitForTimeout(500);
await page.locator("input").first().fill("halls");
await page.waitForTimeout(700);
ok((await page.getByText("Piranesi", { exact: false }).count()) > 0,
   "Find searches the note of a shelf that came off localStorage");
await page.screenshot({ path: fileURLToPath(new URL("../preview/shots/web-find-390.png", import.meta.url)) });
await page.getByLabel("Close", { exact: false }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: fileURLToPath(new URL("../preview/shots/web-390-light.png", import.meta.url)) });

// ── 4. a shared link arrives in the query string ─────────────────────────────
await page.goto(BASE + "?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FDAbCdEf%2F", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const cleaned = await page.evaluate(() => location.search);
ok(!cleaned.includes("url="), "the shared link is taken out of the address bar, so a refresh does not re-share it", cleaned);

await ctx.close();
await browser.close();
server.close();
console.log(fail ? `\nweb check FAILED (${fail})` : "\nweb check ok — it loads, it saves, it survives a reload");
process.exit(fail ? 1 : 0);
