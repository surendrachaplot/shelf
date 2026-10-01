// url.js — the one decision the extension makes: what address to open.
//
// PURE. No `chrome`, no `document`, no `process`: the service worker, the
// options page, the bookmarklet and `selftest.mjs` all read this same file, so
// what the test checks is what the browser runs.
//
// The shelf lives in the web app's localStorage on the shelf origin. An
// extension cannot write there. What it CAN do is open the web app at
// `/app/?url=…&text=…`, which `app/web/native.js` (`readShare`) already treats
// as a share. So "save" is "build that address and open it".

// THE ONE CONSTANT. A custom domain is coming; the options page overrides this
// per browser, and this line is the only place the default is written.
export const DEFAULT_BASE = "https://shelf-api-u8xy.onrender.com";

// Selected text rides in a query string, and the query string is sent to the
// server with the page request. 1,000 characters is a long paragraph and keeps
// the whole address well under the 8 kB a proxy will accept.
export const TEXT_CAP = 1000;
// …and 1,000 characters of Hindi or of emoji is 9–12 kB once encoded, which is
// not. So the ENCODED text is held to this as well.
export const ENCODED_CAP = 4000;

const isLocal = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** What a person typed in the options page → a base with no trailing slash. */
export function normalizeBase(input) {
  let u;
  try { u = new URL(String(input ?? "").trim()); } catch (_) {
    return { ok: false, reason: "That is not a web address. It must start with https://" };
  }
  // http is plain text on the wire, and every saved link goes through this
  // address. Allowed for a server on this machine only.
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLocal(u.hostname))) {
    return { ok: false, reason: "The address must start with https://" };
  }
  if (u.username || u.password || u.search || u.hash) {
    return { ok: false, reason: "Use the address only, with nothing after a ? or a #" };
  }
  // Somebody will paste the address of the app itself. `/app` is added back
  // below, so it comes off here or the result is /app/app/.
  const path = u.pathname.replace(/\/+$/, "").replace(/\/app$/, "");
  return { ok: true, base: u.origin + path };
}

/** One line, trimmed, capped by CHARACTER — cutting by UTF-16 unit can split a
 *  pair, and `encodeURIComponent` throws on half of one. `toWellFormed` mends a
 *  half that was already in the selection. */
export function clipText(text) {
  const flat = String(text ?? "").toWellFormed().replace(/\s+/g, " ").trim();
  const chars = Array.from(flat).slice(0, TEXT_CAP);
  while (encodeURIComponent(chars.join("")).length > ENCODED_CAP) chars.pop();
  return chars.join("").trim();
}

/** → { ok: true, url } to open, or { ok: false, reason } to show. Never throws. */
export function buildSaveUrl(base, { url, text } = {}) {
  const b = normalizeBase(base);
  if (!b.ok) return { ok: false, reason: "The shelf address in the options is not valid." };

  // No address at all is the same case seen from the other side: on chrome://
  // pages the browser withholds `tab.url` even after a click.
  const WEB_ONLY = "shelf can save web pages only (http or https).";
  let target;
  try { target = new URL(String(url ?? "")); } catch (_) {
    return { ok: false, reason: WEB_ONLY };
  }
  // chrome://, about:, file:, view-source:, the extension's own pages. The
  // resolver is a server: it cannot fetch any of these, so saving one would
  // put a dead item on the shelf. Say so instead.
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, reason: `${WEB_ONLY} This is a ${target.protocol} page.` };
  }
  const app = b.base + "/app";
  if (target.href === app || target.href.startsWith(app + "/") || target.href.startsWith(app + "?")) {
    return { ok: false, reason: "This page is your shelf." };
  }

  const clipped = clipText(text);
  return {
    ok: true,
    url: `${app}/?url=${encodeURIComponent(target.href)}` + (clipped ? `&text=${encodeURIComponent(clipped)}` : ""),
  };
}
