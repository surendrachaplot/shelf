// selftest.mjs — what can be known about the extension without a browser.
//
//   node extension/selftest.mjs
//
// Four things: the manifest asks for exactly what background.js justifies and
// names only files that exist; nothing shipped can run remote code; the
// address builder (url.js, the same file the worker runs) encodes, clips and
// refuses correctly; the bookmarklet is one line that survives an HTML
// attribute and does what it says when run.
//
// Every assertion has an id, and every id was WATCHED TO FAIL by breaking the
// thing it defends: 84 one-line mutations of the source and of build.mjs, 83
// turned a named assertion red, and all 56 ids were seen red at least once. The one
// survivor is equivalent (bookmarklet.js: without `if (!b.ok) throw`, the next
// line throws anyway, with a worse message). What a browser actually does with
// all this is e2e.mjs.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_BASE, TEXT_CAP, ENCODED_CAP, normalizeBase, clipText, buildSaveUrl } from "./src/url.js";
import { bookmarkletHref } from "./bookmarklet.js";
import { TARGETS, manifestFor } from "./build.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8");
const S = "./src/"; // the one source; chrome/ and firefox/ are built from it

let fail = 0, count = 0;
const ok = (id, c, label, got) => {
  count++;
  if (!c) { fail++; console.error("FAIL", id, label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── THE MANIFEST ─────────────────────────────────────────────────────────────
let m = {};
try { m = JSON.parse(read(S + "manifest.json")); } catch (e) { ok("M0", false, "manifest.json is valid JSON", String(e)); }
ok("M1", m.manifest_version === 3, "Manifest V3", m.manifest_version);
ok("M2", /^\d+(\.\d+){1,3}$/.test(m.version || ""), "a version the stores accept", m.version);
// The Chrome Web Store cuts a description at 132 characters.
ok("M3", !!m.name && !!m.description && m.description.length <= 132, "a name, and a description of 132 characters or fewer", m.description?.length);

// THE MINIMUM, EXACTLY. One more is an install warning; one fewer is a dead
// button. Each is justified at the top of background.js.
ok("M4", same([...(m.permissions || [])].sort(), ["activeTab", "contextMenus", "storage"]), "permissions are exactly activeTab, contextMenus, storage", m.permissions);
const widening = ["host_permissions", "optional_permissions", "optional_host_permissions", "content_scripts",
  "web_accessible_resources", "externally_connectable", "content_security_policy"].filter((k) => k in m);
ok("M5", widening.length === 0, "no host permissions, no content scripts, nothing that widens reach", widening);

// The source names the background file twice: `service_worker` for Chromium,
// `scripts` for Firefox. They have to be the same file or the two browsers
// ship different extensions. build.mjs gives each engine only its own key.
ok("M6", m.background?.service_worker === "background.js" && same(m.background?.scripts, ["background.js"]) && m.background?.type === "module",
  "one background file, named for Chromium and for Firefox, as a module", m.background);
// A popup SWALLOWS the click: with `default_popup` set, action.onClicked never
// fires and the button, the shortcut and half of this extension go quiet.
ok("M7", !!m.action && !("default_popup" in m.action), "the toolbar button has no popup, so a click reaches the worker", m.action);
ok("M8", !!m.commands?._execute_action?.suggested_key?.default, "a keyboard shortcut, bound to the toolbar action", m.commands);
const gecko = m.browser_specific_settings?.gecko || {};
ok("M9", /^[\w.-]+@[\w.-]+$/.test(gecko.id || "") && parseInt(gecko.strict_min_version, 10) >= 119 && parseInt(m.minimum_chrome_version, 10) >= 111,
  "an add-on id for Firefox, and the floor both engines need: Firefox 119 and Chrome 111, the first with String.toWellFormed (url.js)", [gecko, m.minimum_chrome_version]);

// ── EVERY FILE NAMED, EXISTS ─────────────────────────────────────────────────
const SHIPPED_JS = ["background.js", "options.js", "url.js"];
const named = new Set([
  ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {}),
  m.background?.service_worker, ...(m.background?.scripts || []), m.options_ui?.page,
]);
const html = existsSync(here(S + "options.html")) ? read(S + "options.html") : "";
for (const [, src] of html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) named.add(src);
for (const f of SHIPPED_JS) {
  if (!existsSync(here(S + f))) continue;
  for (const [, spec] of read(S + f).matchAll(/\bfrom\s+"(\.[^"]+)"/g)) named.add(spec.replace(/^\.\//, ""));
}
named.delete(undefined);
const missing = [...named].filter((f) => !existsSync(here(S + f)));
ok("F1", named.size >= 8 && missing.length === 0, "every file the manifest, the options page and the imports name is on disk", missing);
ok("F2", !!m.options_ui?.page && /<script type="module" src="options\.js">/.test(html), "the options page loads its script", m.options_ui);

// A PNG says its own size in bytes 16–23. An icon declared 48 that is 1024
// loads fine and looks like a smudge.
const badIcons = Object.entries({ ...(m.icons || {}), ...(m.action?.default_icon || {}) }).filter(([size, file]) => {
  if (!existsSync(here(S + file))) return true;
  const b = readFileSync(here(S + file));
  return b.toString("latin1", 1, 4) !== "PNG" || b.readUInt32BE(16) !== Number(size) || b.readUInt32BE(20) !== Number(size);
});
ok("F3", same(Object.keys(m.icons || {}), ["16", "32", "48", "128"]) && badIcons.length === 0, "icons at 16, 32, 48, 128, each a PNG of the size it claims", badIcons);

// ── THE TWO BUILT FOLDERS ────────────────────────────────────────────────────
// What a browser loads is chrome/ or firefox/, not src/. Both are committed
// build output, so the thing to prove is that they are what build.mjs would
// write from src/ TODAY — an edit to src/ with no rebuild must go red here.
const tree = (dir) => (existsSync(here(dir)) ? readdirSync(here(dir), { recursive: true }).map(String).filter((f) => statSync(here(dir + f)).isFile() && !f.endsWith(".DS_Store")).sort() : []);
for (const target of TARGETS) {
  const T = `./${target}/`;
  const stale = tree(S).filter((f) => f !== "manifest.json" && (!existsSync(here(T + f)) || !readFileSync(here(S + f)).equals(readFileSync(here(T + f)))));
  const extra = tree(T).filter((f) => !tree(S).includes(f));
  let built = null; try { built = JSON.parse(read(T + "manifest.json")); } catch (_) { /* reported below */ }
  ok("G1", tree(S).length >= 9 && stale.length === 0 && extra.length === 0 && same(built, manifestFor(target, m)),
    `${target}/ is exactly what build.mjs makes from src/ (if not: node extension/build.mjs)`, { stale, extra });
}
const cm = manifestFor("chrome", m), fm = manifestFor("firefox", m);
// Chromium files a warning under the card's Errors button for a key it does
// not use in MV3. Its copy carries neither.
ok("G2", cm.background?.service_worker === "background.js" && !("scripts" in (cm.background || {})) && !("browser_specific_settings" in cm),
  "the Chromium manifest names a service worker, and nothing Firefox-only", cm.background);
ok("G3", same(fm.background?.scripts, ["background.js"]) && !("service_worker" in (fm.background || {})) && !!fm.browser_specific_settings?.gecko?.id && !("minimum_chrome_version" in fm),
  "the Firefox manifest names background scripts and its add-on id, and nothing Chromium-only", fm.background);
ok("G4", same(cm.permissions, m.permissions) && same(fm.permissions, m.permissions) && same(cm.commands, fm.commands) && same(cm.action, fm.action),
  "both ask for the same permissions and do the same things");

// ── NOTHING REMOTE, NOTHING IT HAS NO PERMISSION FOR ─────────────────────────
const code = SHIPPED_JS.map((f) => (existsSync(here(S + f)) ? read(S + f) : "")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // comments may say what they like
const remote = code.match(/\beval\s*\(|new\s+Function\b|\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket|sendBeacon|import\s*\(/g) || [];
ok("R1", remote.length === 0, "shipped code makes no network call and evaluates no string", remote);
// MV3 refuses inline script, silently: the page renders and nothing works.
const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => body.trim() || /src="(?:https?:)?\/\//.test(attrs) || !/src=/.test(attrs));
ok("R2", inline.length === 0 && !/\son\w+="/.test(html), "the options page has no inline script, no remote script, no on*= handler", inline.map((x) => x[0].slice(0, 60)));
// Each API namespace is a permission question. These six are answered:
// storage and contextMenus are declared; action, runtime and windows need
// none; tabs is used only for create/update/onUpdated, which need none.
const spaces = [...new Set([...code.matchAll(/\bapi\.(\w+)\./g)].map((x) => x[1]))].sort();
ok("R3", spaces.every((s) => ["action", "contextMenus", "runtime", "storage", "tabs", "windows"].includes(s)), "only APIs the permissions cover", spaces);
ok("R4", !/\b(?:chrome|browser)\.\w+\./.test(code.replace(/globalThis\.(?:chrome|browser)/g, "")), "every call goes through `api`, so Firefox and Chromium run the same line");
const tabCalls = [...new Set([...code.matchAll(/\bapi\.tabs\.(\w+)/g)].map((x) => x[1]))].sort();
ok("R5", same(tabCalls, ["create", "onUpdated", "update"]), "tabs: create, update, onUpdated — the three that work without the `tabs` permission", tabCalls);
const emoji = ["src/background.js", "src/options.js", "src/url.js", "src/options.html", "src/manifest.json", "bookmarklet.js", "README.md"]
  .filter((f) => existsSync(here("./" + f)) && /\p{Extended_Pictographic}/u.test(read("./" + f).replace(/[©®™]/g, "")));
ok("R6", emoji.length === 0, "no emoji in anything a person reads", emoji);

// ── THE ADDRESS BUILDER ──────────────────────────────────────────────────────
const B = "https://shelf.example";
const reel = "https://www.instagram.com/reel/DAbCdEf/?igsh=a1&x=b c#top";

const r1 = buildSaveUrl(B, { url: reel });
ok("U1", r1.ok && r1.url === "https://shelf.example/app/?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FDAbCdEf%2F%3Figsh%3Da1%26x%3Db%2520c%23top",
  "a link is encoded whole: its own ? & # cannot leak into shelf's query", r1);
// What the web app does with it (app/web/native.js → readShare).
const back = (u) => { const q = new URL(u).searchParams; return [q.get("url"), q.get("text")]; };
ok("U2", same(back(r1.url), [new URL(reel).href, null]), "and readShare gets the same link back, with no text", back(r1.url));

const r2 = buildSaveUrl(B, { url: reel, text: "  \"Tom & Jerry\" = 100% #1?\n\t next   line + more  " });
ok("U3", r2.ok && same(back(r2.url), [new URL(reel).href, "\"Tom & Jerry\" = 100% #1? next line + more"]),
  "text is flattened to one line, trimmed, and survives & = % # ? + and quotes", r2.ok && back(r2.url));
ok("U4", r2.ok && !/[\s"'<>]/.test(r2.url), "the address has no raw space or quote in it", r2.url);
for (const blank of ["", "   \n ", null, undefined]) {
  const r = buildSaveUrl(B, { url: reel, text: blank });
  ok("U5", r.ok && !r.url.includes("text="), "no text means no text= at all (an empty one reads as a share of nothing)", [blank, r.url]);
}

// THE CAP. Selected text can be a whole article.
const long = buildSaveUrl(B, { url: reel, text: "word ".repeat(5000) });
ok("U6", long.ok && back(long.url)[1].length <= TEXT_CAP && back(long.url)[1].length > TEXT_CAP - 10 && !/\s$/.test(back(long.url)[1]),
  `text is cut at ${TEXT_CAP} characters, with no trailing space`, long.ok && back(long.url)[1].length);
// By CHARACTER. 999 letters then a two-unit character: cutting at unit 1,000
// leaves half a pair, and encodeURIComponent throws on half a pair.
let pair;
try { pair = buildSaveUrl(B, { url: reel, text: "a".repeat(TEXT_CAP - 1) + "\u{1F4DA}\u{1F4DA}" }); } catch (e) { pair = { ok: false, reason: String(e) }; }
ok("U7", pair.ok && back(pair.url)[1].endsWith("a\u{1F4DA}"), "the cut never splits a character in two", pair.ok ? back(pair.url)[1].slice(-3) : pair);
let lone;
try { lone = buildSaveUrl(B, { url: reel, text: "half \ud83d pair" }); } catch (e) { lone = { ok: false, reason: String(e) }; }
ok("U8", lone.ok === true, "a broken character already in the selection does not throw", lone);
// 1,000 characters of Devanagari is 9 kB encoded. The ENCODED length is held too.
const hindi = buildSaveUrl(B, { url: reel, text: "क".repeat(3000) });
const hindiLen = hindi.ok ? hindi.url.split("&text=")[1].length : -1;
ok("U9", hindiLen > ENCODED_CAP - 20 && hindiLen <= ENCODED_CAP, `encoded text stays under ${ENCODED_CAP} bytes of address`, hindiLen);
ok("U10", clipText("  a \n b  ") === "a b" && clipText(null) === "", "clipText on its own", clipText("  a \n b  "));

// REFUSED, WITH A REASON. The server cannot fetch any of these.
for (const bad of ["chrome://extensions/", "about:blank", "file:///Users/me/a.html", "javascript:alert(1)", "data:text/html,hi",
  "view-source:https://a.com", "chrome-extension://abc/options.html", "edge://settings", "ftp://a.com/f"]) {
  const r = buildSaveUrl(B, { url: bad });
  ok("U11", r.ok === false && !r.url && /web pages only/.test(r.reason || ""), "not http(s): refused, and says web pages only", [bad, r]);
  ok("U12", (r.reason || "").includes(new URL(bad).protocol), "the reason names what the page is", [bad, r.reason]);
}
for (const none of ["", undefined, null, "not a link", "www.example.com"]) {
  let r; try { r = buildSaveUrl(B, { url: none }); } catch (e) { r = { threw: String(e) }; }
  ok("U13", r.ok === false && typeof r.reason === "string" && r.reason.length > 10, "no address (chrome:// withholds it): refused in words, never a throw", [none, r]);
}
ok("U17", buildSaveUrl(B, { url: "http://example.com/old-site" }).ok === true, "a plain http page IS a web page, and is saved");
let bare; try { bare = buildSaveUrl(B); } catch (e) { bare = { threw: String(e) }; }
ok("U14", bare.ok === false, "called with nothing: still an answer, not a throw", bare);

// Saving shelf into shelf. But a PUBLISHED shelf on the same host (/s/<code>)
// is a page like any other, and so is /application.
for (const self of [`${B}/app/`, `${B}/app`, `${B}/app/?url=x`, `${B}/app?x=1`, `${B}/app/#h`]) {
  ok("U15", buildSaveUrl(B, { url: self }).ok === false, "the shelf app itself is refused", self);
}
for (const near of [`${B}/s/abc123`, `${B}/application`, `${B}/`, "https://other.example/app/"]) {
  ok("U16", buildSaveUrl(B, { url: near }).ok === true, "but its neighbours are saved", near);
}

// THE BASE. Typed by a person, so it arrives in every shape.
for (const [typed, want] of [
  ["https://shelf.example", B], ["https://shelf.example/", B], ["  https://shelf.example//  ", B],
  ["https://shelf.example/app/", B], ["https://shelf.example/app", B], ["HTTPS://Shelf.Example", B],
  ["https://shelf.example/sub/", B + "/sub"],
  ["http://localhost:8080/", "http://localhost:8080"], ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
]) {
  const n = normalizeBase(typed);
  ok("B1", n.ok && n.base === want, "the base is trimmed of slashes and of a pasted /app", [typed, n]);
}
ok("B2", buildSaveUrl("https://shelf.example/app/", { url: reel }).url === r1.url, "and builds the same address either way: never /app/app/");
// http is plain text on the wire and every saved link goes through this.
for (const typed of ["http://shelf.example", "http://192.168.1.4:8080", "ftp://shelf.example", "chrome://settings", "javascript:alert(1)"]) {
  ok("B3", normalizeBase(typed).ok === false, "http is allowed on this machine only; nothing else but https", typed);
}
for (const typed of ["", "   ", "shelf.example", "not an address", null, undefined]) {
  let n; try { n = normalizeBase(typed); } catch (e) { n = { threw: String(e) }; }
  ok("B4", n.ok === false && typeof n.reason === "string", "nonsense is refused in words", [typed, n]);
}
for (const typed of ["https://shelf.example/?a=1", "https://shelf.example/#x", "https://me:pw@shelf.example"]) {
  ok("B5", normalizeBase(typed).ok === false, "a base with a query, a fragment or a password is refused", typed);
}
ok("B6", buildSaveUrl("nope", { url: reel }).ok === false, "a bad base stops the save rather than opening a broken address");
ok("B7", same(normalizeBase(DEFAULT_BASE), { ok: true, base: DEFAULT_BASE }) && DEFAULT_BASE.startsWith("https://"), "the default base is already in its own normal form", normalizeBase(DEFAULT_BASE));

// ── THE BOOKMARKLET ──────────────────────────────────────────────────────────
const href = bookmarkletHref(B);
ok("K1", href.startsWith("javascript:") && !/[\r\n]/.test(href), "one line, and a javascript: address", href);
// Any of these can end or bend an HTML attribute — and a space ends an
// unquoted one. The string must be safe in href="…", href='…' and href=….
const unsafe = href.match(/["'<>&\s]/g) || [];
ok("K2", unsafe.length === 0, "no quote, no angle bracket, no ampersand, no space: safe inside any href", unsafe);
ok("K3", /href="([^"]*)"/.exec(`<a href="${href}">`)[1] === href && /href='([^']*)'/.exec(`<a href='${href}'>`)[1] === href, "it comes back out of an attribute whole");

// RUN IT. A browser percent-decodes a javascript: address, then runs it.
const run = (h, page, selection) => {
  let opened = null;
  new Function("open", "location", "getSelection", decodeURIComponent(h.slice("javascript:".length)))(
    (u) => { opened = u; }, { href: page }, () => ({ toString: () => selection }));
  return opened;
};
const pageUrl = "https://example.com/a path/?q=\"x\"&y='z'#frag";
const out = run(href, pageUrl, "  a `quote` & more ${x}  ");
ok("K4", typeof out === "string" && out.startsWith(B + "/app/?"), "run, it opens <base>/app/?…", out);
ok("K5", !!out && same(back(out), [pageUrl, "a `quote` & more ${x}"]), "and readShare gets this page and the trimmed selection", out && back(out));
const flood = run(href, pageUrl, "x".repeat(5000));
ok("K6", !!flood && back(flood)[1].length === TEXT_CAP, `the selection is cut at ${TEXT_CAP}`, flood && back(flood)[1].length);
ok("K7", decodeURIComponent(href).includes("void(") && bookmarkletHref() === bookmarkletHref(DEFAULT_BASE) && bookmarkletHref().includes(DEFAULT_BASE + "/app/?"),
  "it returns nothing (the page you are on stays put), and defaults to the real base");
// The base is pasted INTO the script. A base that is code must not get there.
for (const evil of ["https://x.example/`+alert(1)+`", "https://x.example/${alert(1)}", "https://x.example/a b", "https://x.example/\"", "https://x.example/'", "http://x.example", "javascript:alert(1)", ""]) {
  let threw = false; try { bookmarkletHref(evil); } catch (_) { threw = true; }
  ok("K8", threw, "a base that could carry code, or is not https, is refused", evil);
}
ok("K9", bookmarkletHref("https://shelf.example/app/") === href, "the base is normalised the same way as everywhere else");

if (fail) { console.error(`\n${fail} of ${count} checks failed`); process.exit(1); }
console.log(`extension selftest: all ${count} checks passed`);
