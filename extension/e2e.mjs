// e2e.mjs — the extension, loaded unpacked in a real Chromium, doing a save.
//
//   node extension/e2e.mjs
//
// Needs no network: a local server stands in for the shelf site and for the
// page being saved. The stand-in app does the two things the real one does
// with a share (app/web/native.js): reads `url` and `text` with
// URLSearchParams, then strips them from the address bar.
//
// THE TOOLBAR CLICK IS REAL. Playwright cannot click browser chrome, but the
// DevTools protocol has `Extensions.triggerAction`, which runs the action the
// way a click does — including the activeTab grant. So `tab.url` in the
// worker is the browser's, not a value this test handed over. (Its price: the
// browser socket, hence `--remote-debugging-port` and the 20 lines of
// WebSocket below.) The right-click menu has no such door; its handler is
// dispatched with the `info` a real click would carry, and the item's
// registration is checked separately.
import { createRequire } from "node:module";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildSaveUrl } from "./src/url.js";
import { bookmarkletHref } from "./bookmarklet.js";

// playwright-core is the app's, not ours: no dependency is added for this.
const require = createRequire(new URL("../app/package.json", import.meta.url));
const { chromium } = require("playwright-core");

// The BUILT folder — the one a person loads — not src/.
const EXT = fileURLToPath(new URL("./chrome", import.meta.url));
const EXE = process.env.SHELF_CHROMIUM || path.join(os.homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

let fail = 0, count = 0;
const ok = (c, label, got) => {
  count++;
  if (c) console.log("  ok  ", label);
  else { fail++; console.error("  FAIL", label, got === undefined ? "" : `\n        got: ${JSON.stringify(got)}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) { const v = await fn(); if (v) return v; }
  return null;
};

// ── the stand-in site ────────────────────────────────────────────────────────
const hits = [];          // every /app/ address the browser asked for, in order
let appDelay = 0;         // ms — a sleeping Render service, on demand
let BASE = "";
const srv = http.createServer((req, res) => {
  const html = (body, ms = 0) => setTimeout(() => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(body); }, ms);
  if (req.url.startsWith("/app/")) {
    hits.push(req.url);
    return html(`<!doctype html><title>shelf</title><script>
      const q = new URLSearchParams(location.search);
      document.title = JSON.stringify({ url: q.get("url"), text: q.get("text") });
      history.replaceState({}, "", location.pathname);
    </script>`, appDelay);
  }
  if (req.url === "/other") return html("<!doctype html><title>somewhere else</title>");
  // The bookmarklet goes into a real href="…" here, raw. If it carried a
  // quote, the parser would cut it short and the click below would fail.
  html(`<!doctype html><title>a page</title>
    <p id="quote">Books are a   uniquely portable magic.</p>
    <a id="link" href="/linked?a=1&amp;b=two%20words#part">a link</a>
    <a id="bm" href="${bookmarkletHref(BASE)}">Save to shelf</a>`);
}).listen(0, "127.0.0.1");
await new Promise((r) => srv.on("listening", r));
BASE = `http://127.0.0.1:${srv.address().port}`;
const PAGE = `${BASE}/page?x=1&y=a b`;
const PAGE_HREF = new URL(PAGE).href;

// ── the browser ──────────────────────────────────────────────────────────────
const profile = await mkdtemp(path.join(os.tmpdir(), "shelf-ext-e2e-"));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: EXE,
  headless: false, // extensions do not load in the old headless; `--headless=new` below keeps it off the screen
  args: [
    process.env.SHELF_E2E_SHOW ? "" : "--headless=new",
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    "--enable-unsafe-extension-debugging", "--remote-debugging-port=0",
  ].filter(Boolean),
});

try {
  const first = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(first.url()).host;

  // TURN ERROR COLLECTION ON, THEN RELOAD. Chromium records manifest warnings
  // and worker errors only in Developer mode; with it off, `manifestErrors` is
  // an empty list whatever the manifest says. (The first version of this test
  // read that empty list as "no warnings" while there was one.) The reload is
  // also a real "update": onInstalled runs a second time.
  const ext = await ctx.newPage();
  await ext.goto("chrome://extensions");
  const extInfo = () => ext.evaluate((id) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(id, r)), id);
  await ext.evaluate(() => new Promise((r) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r)));
  const [sw] = await Promise.all([
    ctx.waitForEvent("serviceworker", { timeout: 15000 }),
    ext.evaluate((id) => new Promise((r) => chrome.developerPrivate.reload(id, { failQuietly: true }, r)), id),
  ]);
  await until(() => sw.evaluate(() => !!globalThis.chrome?.storage));
  await sleep(500); // onInstalled, and the menu item it makes
  const titles = () => Promise.all(ctx.pages().map((p) => p.title().catch(() => "")));
  const appPages = () => ctx.pages().filter((p) => p.url().startsWith(`${BASE}/app/`));

  // The browser-level protocol socket, for the real toolbar click.
  const [port, wsPath] = (await until(() => readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => null))).split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const cdp = (method, params = {}) => new Promise((res) => {
    const mine = ++seq;
    const on = (m) => { const d = JSON.parse(m.data); if (d.id === mine) { ws.removeEventListener("message", on); res(d); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
  const clickToolbar = async (page) => {
    await page.bringToFront();
    const { result } = await cdp("Target.getTargets", { filter: [{ type: "tab" }] });
    const tab = result.targetInfos.find((t) => t.url === page.url());
    return cdp("Extensions.triggerAction", { id, targetId: tab.targetId });
  };

  console.log("1. it loads, and asks for nothing it does not need");
  const info = await extInfo();
  ok(info.errorCollection.isActive === true, "Chromium is collecting errors for it (or the next line proves nothing)", info.errorCollection);
  ok(info.installWarnings.length === 0 && info.manifestErrors.length === 0, "the manifest loads with no warning and no error", [info.installWarnings, info.manifestErrors.map((x) => x.message)]);
  ok(info.permissions.simplePermissions.length === 0 && (info.permissions.runtimeHostPermissions?.hosts ?? []).length === 0,
    "the install prompt lists NO permission warning and no site access", info.permissions);
  ok(await sw.evaluate(() => chrome.contextMenus.update("save", {}).then(() => true, () => false)), "the right-click item is registered");
  const cmds = await sw.evaluate(() => chrome.commands.getAll());
  ok(cmds.some((c) => c.name === "_execute_action" && /S$/.test(c.shortcut)), "the shortcut is bound to the toolbar action", cmds);

  console.log("2. the options page stores the shelf address");
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${id}/options.html`);
  // The page fills the field and writes its status after an await: poll, or
  // this reads the moment before and fails some runs.
  const status = (re) => until(async () => re.test(await opt.textContent("#status")), 3000);
  ok(await until(async () => await opt.inputValue("#base") === "https://shelf-api-u8xy.onrender.com", 3000) === true, "it opens on the default address", await opt.inputValue("#base"));
  await opt.fill("#base", "chrome://settings");
  await opt.click("#save");
  ok(await status(/https/) === true, "a bad address is refused, in words", await opt.textContent("#status"));
  ok((await sw.evaluate(() => chrome.storage.local.get("base"))).base === undefined, "and is not stored");
  await opt.fill("#base", `${BASE}/app/`);
  await opt.click("#save");
  ok(await status(/^Saved\.$/) === true, "a good one says Saved.", await opt.textContent("#status"));
  ok((await sw.evaluate(() => chrome.storage.local.get("base"))).base === BASE, "stored without the trailing /app/", await sw.evaluate(() => chrome.storage.local.get("base")));
  // The design rules, measured rather than looked at.
  const look = await opt.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const cs = (el) => getComputedStyle(el);
    const main = document.querySelector("main").getBoundingClientRect().width;
    return {
      rounded: all.filter((el) => cs(el).borderTopLeftRadius !== "0px").map((el) => el.tagName),
      families: [...new Set(all.map((el) => cs(el).fontFamily))],
      // Natural width: the two buttons together leave most of the row empty.
      buttonShare: [...document.querySelectorAll("button")].reduce((n, b) => n + b.getBoundingClientRect().width, 0) / main,
      rules: [...document.querySelectorAll("hr")].map((h) => h.getBoundingClientRect().height),
      scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  ok(look.rounded.length === 0, "radius zero on every element", look.rounded);
  ok(look.families.length === 1 && /^Helvetica, Arial/.test(look.families[0]), "one family", look.families);
  ok(look.buttonShare > 0.2 && look.buttonShare < 0.5, "buttons are natural width, not stretched", look.buttonShare);
  ok(look.rules.length === 3 && look.rules.every((h) => h === 3), "the rules are 3px", look.rules);
  const paint = async (scheme) => { await opt.emulateMedia({ colorScheme: scheme }); return opt.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]); };
  ok(JSON.stringify(await paint("light")) === '["rgb(255, 255, 255)","rgb(10, 10, 10)"]', "light: #0A0A0A on #FFFFFF", await paint("light"));
  ok(JSON.stringify(await paint("dark")) === '["rgb(10, 10, 10)","rgb(255, 255, 255)"]', "dark: #FFFFFF on #0A0A0A", await paint("dark"));
  if (process.env.SHELF_E2E_SHOTS) {
    for (const s of ["light", "dark"]) { await opt.emulateMedia({ colorScheme: s }); await opt.screenshot({ path: path.join(process.env.SHELF_E2E_SHOTS, `options-${s}.png`), fullPage: true }); }
  }
  await opt.close();

  console.log("3. the toolbar button saves the tab you are on");
  const page = await ctx.newPage();
  await page.goto(PAGE);
  const before = ctx.pages().length;
  await clickToolbar(page);
  const want1 = `/app/?url=${encodeURIComponent(PAGE_HREF)}`;
  await until(() => hits.length === 1);
  ok(hits[0] === want1, "a tab opened at /app/?url=<this page, encoded>", hits);
  ok(BASE + hits[0] === buildSaveUrl(BASE, { url: PAGE_HREF }).url, "and it is exactly what url.js builds");
  ok(await until(() => ctx.pages().length === before + 1) === true, "one new tab", ctx.pages().length - before);
  const read1 = await until(async () => (await titles()).find((t) => t.startsWith("{")));
  ok(read1 === JSON.stringify({ url: PAGE_HREF, text: null }), "the app reads back the same address, and no text", read1);

  console.log("4. right-click: the link, with the selected text, in the SAME shelf tab");
  const LINK = `${BASE}/linked?a=1&b=two%20words#part`;
  await page.bringToFront();
  await sw.evaluate(([linkUrl, pageUrl]) => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) =>
    chrome.contextMenus.onClicked.dispatch({ menuItemId: "save", linkUrl, pageUrl, selectionText: "  Books are a   uniquely portable magic.\n" }, tab)), [LINK, PAGE_HREF]);
  await until(() => hits.length === 2);
  ok(hits[1] === `/app/?url=${encodeURIComponent(LINK)}&text=Books%20are%20a%20uniquely%20portable%20magic.`, "the link is what is saved, text trimmed and encoded", hits[1]);
  const read2 = await until(async () => (await titles()).find((t) => t.includes("linked")));
  await sleep(500); // a tab that should NOT exist needs time to not appear
  ok(ctx.pages().length === before + 1 && appPages().length === 1, "no second shelf tab: the first one was reused", ctx.pages().map((p) => p.url()));
  ok(read2 === JSON.stringify({ url: LINK, text: "Books are a uniquely portable magic." }), "the app reads back the link and the text", read2);

  console.log("5. a slow shelf (a sleeping server) is still the same tab");
  const settled = () => until(async () => (await sw.evaluate(() => chrome.storage.session.get("shelfTab"))).shelfTab?.pending === false);
  await settled();
  appDelay = 2500;
  await clickToolbar(page);
  await until(() => hits.length === 3);
  await settled();
  appDelay = 0;
  await clickToolbar(page);
  await until(() => hits.length === 4);
  await sleep(500);
  ok(hits.length === 4 && appPages().length === 1 && ctx.pages().length === before + 1, "two more saves, one of them 2.5 s slow, still one shelf tab", ctx.pages().map((p) => p.url()));

  console.log("6. a shelf tab that went somewhere else is left alone");
  const shelf = appPages()[0];
  await settled();
  await shelf.goto(`${BASE}/other`);
  await until(async () => !(await sw.evaluate(() => chrome.storage.session.get("shelfTab"))).shelfTab, 3000);
  await clickToolbar(page);
  await until(() => hits.length === 5);
  await until(() => appPages().length === 1);
  ok(shelf.url() === `${BASE}/other`, "the page that replaced shelf is still there", shelf.url());
  ok(appPages().length === 1 && ctx.pages().length === before + 2, "and the save went to a new tab", ctx.pages().map((p) => p.url()));

  console.log("7. a closed shelf tab: the next save opens a new one");
  await appPages()[0].close();
  await clickToolbar(page);
  await until(() => hits.length === 6);
  ok(await until(() => appPages().length === 1) === true, "saved, in a new tab", ctx.pages().map((p) => p.url()));

  console.log("8. a page that cannot be saved is refused, with the reason");
  const n = hits.length, tabs = ctx.pages().length;
  await clickToolbar(ext); // chrome://extensions
  const badge = await until(() => sw.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([t]) => {
    const text = await chrome.action.getBadgeText({ tabId: t.id });
    return text ? { text, title: await chrome.action.getTitle({ tabId: t.id }) } : null;
  })), 4000);
  ok(badge?.text === "!" && /web pages only/.test(badge.title), "the button shows ! and says why", badge);
  ok(hits.length === n && ctx.pages().length === tabs, "nothing was opened", [hits.length - n, ctx.pages().length - tabs]);
  // A file: page, where the browser DOES hand over the address.
  await sw.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => chrome.action.onClicked.dispatch({ ...tab, url: "file:///Users/me/notes.html" })));
  const badge2 = await until(() => sw.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([t]) => {
    const title = await chrome.action.getTitle({ tabId: t.id });
    return /file:/.test(title) ? title : null;
  })), 4000);
  ok(!!badge2 && hits.length === n, "file: is named in the reason, and not saved", badge2);

  console.log("9. the bookmarklet, clicked on a real page");
  await page.bringToFront();
  await page.evaluate(() => getSelection().selectAllChildren(document.getElementById("quote")));
  const [popup] = await Promise.all([ctx.waitForEvent("page"), page.click("#bm")]);
  await until(() => hits.length === n + 1);
  const q = new URLSearchParams((hits[n] || "").replace(/^\/app\/\?/, ""));
  ok((hits[n] || "").startsWith("/app/?url="), "it opens /app/?url=… in a new tab", hits[n]);
  ok(q.get("url") === PAGE_HREF && q.get("text") === "Books are a uniquely portable magic.", "with this page and the selection", [q.get("url"), q.get("text")]);
  ok(page.url() === PAGE_HREF, "and the page you were on did not move", page.url());
  await popup.close();
  ws.close();

  console.log("10. and through all of that, the worker threw nothing");
  const end = await extInfo();
  ok(end.runtimeErrors.length === 0 && end.manifestErrors.length === 0, "no runtime error was recorded", end.runtimeErrors.map((x) => x.message));
} finally {
  await ctx.close();
  srv.close();
  await rm(profile, { recursive: true, force: true });
}

console.log(fail ? `\ne2e: ${fail} of ${count} FAILED` : `\ne2e: all ${count} passed, in a real Chromium with the extension loaded unpacked`);
process.exit(fail ? 1 : 0);
