import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const URLBASE = "file://" + fileURLToPath(new URL("./index.html", import.meta.url));
// phase2.mjs — the Phase 2 features, reached the way a person reaches them.
//
// Not "does the function return": tap the entry point, then read the screen.
// Export is checked by taking the real download and opening the file.
const out = process.argv[2] || mkdtempSync(join(tmpdir(), "shelf-phase2-"));
let failed = 0;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
const tap = async (l) => { await page.getByLabel(l, { exact: false }).first().click(); await page.waitForTimeout(500); };
const has = async (t) => (await page.getByText(t, { exact: false }).count()) > 0;
const say = (ok, m) => { if (!ok) failed++; console.log((ok ? "ok   " : "FAIL ") + m); };
await page.goto(URLBASE); await page.waitForTimeout(800);
// export, both kinds
await tap("Your card");
for (const [label, ext] of [["Save a page you can read", "html"], ["Save the data", "json"]]) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByLabel(label).first().click()]);
  const path = `${out}/export.${ext}`; await dl.saveAs(path);
  const body = readFileSync(path, "utf8");
  say(dl.suggestedFilename().endsWith("." + ext) && body.includes("Piranesi") && body.includes("There is no sign outside"),
      `export .${ext} downloads as ${dl.suggestedFilename()} (${body.length} bytes) with items and the article text`);
}
say(await has("Copy saved."), "the card says the copy was saved");
await tap("Close");
// strip → not now
say(await has("year ago"), "home shows the year-ago card");
await tap("Not now");
say(!(await has("year ago")), "Not now takes the card away");
// find → tags → tag → item → link → tag
await tap("Search everything you have saved"); await tap("Browse by tag"); await tap("Farringdon,");
say(await has("02 things"), "Farringdon holds two things");
await tap("St. John,");
say(await has("Also in Farringdon"), "the item page shows the connection");
await tap("Open Brutto");
say(await has("Also in Farringdon") && await has("35-37 Greenhill"), "a linked title opens that item");
await tap("Everything tagged Farringdon");
say(await has("02 things") && await has("All tags"), "the link heading opens the tag");
await tap("All tags"); await tap("Close");
// article: pile → detail → read → close
await tap("Not shelved,"); await tap("Open The dosa counter"); await tap("Read the saved article");
say(await has("In short") && await has("There is no sign outside"), "the reader shows summary and text");
await page.getByLabel("Close").last().click(); await page.waitForTimeout(500);   // the reader's own Close, on top
say(await has("Read →") || await has("READ →"), "closing the reader returns to the item");
// find indexes the article body
await page.keyboard.press("Escape");
await page.goto(URLBASE); await page.waitForTimeout(800);
await tap("Search everything you have saved"); await page.keyboard.type("tumbler"); await page.waitForTimeout(600);
say(await has("the article:") && await has("dosa counter"), "Find matches a word that is only in the article body");
say(errs.length === 0, "no page errors " + errs.slice(0, 2).join(" | "));
// the archive renders
const p2 = await ctx.newPage(); await p2.goto("file://" + out + "/export.html");
say((await p2.locator("script").count()) === 0 && (await p2.getByText("Piranesi").count()) > 0, "the HTML archive opens, has no script, shows the items");
await p2.screenshot({ path: out + "/export-archive.png" });
await b.close();
console.log(failed ? `phase2 check FAILED (${failed})` : "phase2 check ok");
process.exit(failed ? 1 : 0);
