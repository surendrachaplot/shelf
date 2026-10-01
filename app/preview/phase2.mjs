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
// ── lists: made, filled, read as pictures and as rows, with a total ─────────
await page.goto(URLBASE); await page.waitForTimeout(800);
await tap("Search everything you have saved"); await tap("Your lists");
say(await has("Everything") && await has("Autumn outfit"), "the lists screen shows Everything and the saved lists");
await page.getByPlaceholder("A name for it").fill("Gifts for Maya");
await tap("Make the list");
say(await has("Nothing on this list yet"), "a new list opens, and says it is empty");
await page.getByLabel("Write a note").first().click(); await page.waitForTimeout(300);
await page.keyboard.type("Ask about the scarf");
await tap("Save the note");
say(await has("Ask about the scarf") && await has("01 thing"), "a note written on a list lands on it");
await tap("All lists"); await tap("Autumn outfit,");
say(await has("£83"), "the moodboard carries the total of what has a price");
await tap("Show as rows");
say(await has("£65") && await has("£18") && await has("2 with a price. 1 with no price."), "rows show each price and count only things to buy as unpriced");
say(!(await has("£65.00")), "a row and the total use one format");
await tap("Wool overshirt");
say(await has("Open the shop") || await has("OPEN THE SHOP"), "a thing to buy opens with its shop link");
say(await has("On 1 list"), "and says which list it is on");
await tap("Add to a list");
await tap("Add to Gifts for Maya");
await page.getByLabel("Done").first().click(); await page.waitForTimeout(500);
say(await has("On 2 lists"), "adding it to a second list shows on the item");
await tap("Pin to the top");
say(await has("Pinned") || await has("PINNED"), "a pinned thing is on the home screen");

// ── the seventh and eighth shelves, by their own front doors ─────────────────
await page.goto(URLBASE); await page.waitForTimeout(800);
await tap("Wishlist,");
say(await has("£83 in all") || await has("£83 IN ALL"), "the Wishlist band says what the shelf comes to");
say(await has("No price") || await has("NO PRICE"), "a thing with no price says so on its jacket");
say(!(await has("£65.00")), "and a jacket uses the same format as the total");
await tap("Wool overshirt");
say((await has("Price read 1 Oct") || await has("PRICE READ 1 OCT")) && await has("£65"), "a thing to buy opens on its price, with the day it was read");
say((await page.getByText("Price", { exact: true }).count()) === 0, "and the table under it does not say the price a second time");
await tap("Close");
await tap("Linen trousers");
say(!(await has("Price read")) && (await has("Open the shop") || await has("OPEN THE SHOP")), "a thing with no price has no price block, and still opens its shop");
await tap("Close");
await tap("Notes,");
say(await has("Gift ideas") && await has("Brown boots"), "the Notes shelf holds the notes, not the pile");
await tap("Write a note");
await page.keyboard.type("Ring the plumber\nBefore Friday");
await tap("Save the note");
say(await has("04") && await has("Ring the plumber"), "a note written from the band lands on the Notes shelf");
await tap("Ring the plumber");
say(await has("Before Friday") && (await has("Written by you") || await has("WRITTEN BY YOU")), "and opens with the rest of what was written");
await tap("Close");
await tap("Not shelved,");
say(!(await has("Wool overshirt")) && !(await has("Ring the plumber")), "neither a thing to buy nor a note is left in the pile");

say(errs.length === 0, "no page errors " + errs.slice(0, 2).join(" | "));
// the archive renders
const p2 = await ctx.newPage(); await p2.goto("file://" + out + "/export.html");
say((await p2.locator("script").count()) === 0 && (await p2.getByText("Piranesi").count()) > 0, "the HTML archive opens, has no script, shows the items");
await p2.screenshot({ path: out + "/export-archive.png" });
await b.close();
console.log(failed ? `phase2 check FAILED (${failed})` : "phase2 check ok");
process.exit(failed ? 1 : 0);
