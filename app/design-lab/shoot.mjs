import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const URLBASE = "file://" + fileURLToPath(new URL("./lab.html", import.meta.url));
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 840, height: 830 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const names = [];
for (let v = 0; v < 6; v++) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${URLBASE}?v=${v}`);
  await page.waitForTimeout(250);
  const title = await page.title();
  names.push(title);
  await page.screenshot({ path: `${OUT}v${v}.png`, fullPage: true });
  console.log(`${errs.length ? "ERR " : "ok  "} v${v}  ${title}${errs.length ? "  " + errs[0] : ""}`);
}
await browser.close();
