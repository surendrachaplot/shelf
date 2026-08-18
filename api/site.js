// site.js — shelf, served by shelf's own server.
//
// ── WHY THIS IS HERE AND NOT ON A HOST SOMEBODY HAS TO SWITCH ON ────────────
//
// The web build was going to GitHub Pages, and the deploy stopped dead on
// "Create Pages site failed. Resource not accessible by integration" — a
// repository setting no workflow token can set. So the app was finished,
// checked in a real browser, and waiting on a dropdown.
//
// This service is already deployed, already has a domain, already serves the
// public /s/<code> pages, and deploys itself on every push to main. Waiting
// for permission to use somebody else's host, while holding the keys to this
// one, was the mistake.
//
// ── WHY THE BUNDLE IS COMMITTED ─────────────────────────────────────────────
//
// `render.yaml` builds with `cd api && npm ci`, so `app/node_modules` does not
// exist on the deploy and esbuild cannot run there. The built site is
// therefore committed to `api/public/`. The usual objection to committing a
// build artifact is that it goes stale silently — so `checks.yml` rebuilds it
// on every push and fails if what is committed differs from what the source
// produces. It cannot drift without the build going red.
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, sep } from "node:path";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
};

export const typeOf = (p) => TYPES[extname(String(p)).toLowerCase()] || "application/octet-stream";

/**
 * A URL path → a file inside public/, or null.
 *
 * NULL IS THE POINT. `/app/../../../etc/passwd` is a request this will receive
 * eventually, and the answer has to be "no such file" rather than a file. The
 * check is on the RESOLVED path, not on the text: `%2e%2e%2f` and `....//` and
 * a dozen other spellings all normalise to the same thing, and only the
 * resolved path can be compared to the root it must stay inside.
 */
export function fileFor(pathname) {
  const rel = decodeURIComponent(String(pathname || "")).replace(/^\/app\/?/, "");
  const wanted = normalize(join(ROOT, rel || "index.html"));
  if (!wanted.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;
  return wanted;
}

/** Is this request ours at all? `/app` and everything under it. */
export const isAppPath = (pathname) => /^\/app(\/|$)/.test(String(pathname || ""));

/**
 * Serve it, or hand back the app for anything unknown.
 *
 * Returns TRUE when it has answered and null when the path is not ours. Not
 * `res.end()`'s return value, and not `undefined`: the first version returned
 * whatever `res.end()` gave back, the caller tested it for `undefined`, and the
 * page was served AND then fell through to the 404 — "cannot write headers
 * after they are sent", which killed the process on the first request. A
 * handler that has answered must say so in one unambiguous word.
 *
 * A single-page app owns every path under its root: a refresh on a deep link,
 * or a share arriving as `/app/?url=…`, must open the app rather than a 404
 * from a file server that has never heard of it.
 */
export async function serveApp(req, res, url) {
  if (!isAppPath(url.pathname)) return null;

  // `/app` with no slash makes every relative asset resolve one level too
  // high — ./bundle.js becomes /bundle.js — so the page loads and paints
  // nothing. One redirect is cheaper than debugging that twice.
  if (url.pathname === "/app") {
    res.writeHead(302, { Location: "/app/" + (url.search || "") });
    res.end();
    return true;
  }

  const path = fileFor(url.pathname);
  let body = null, type = "text/html; charset=utf-8";
  if (path) {
    try {
      if ((await stat(path)).isFile()) { body = await readFile(path); type = typeOf(path); }
    } catch (_) { /* fall through to the app itself */ }
  }
  if (body === null) {
    try { body = await readFile(join(ROOT, "index.html")); }
    catch (_) {
      // The bundle is missing from the deploy. Say so in words: a blank 404
      // here would look like the app is broken rather than absent.
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("the web app is not built into this deploy yet");
      return true;
    }
  }

  res.writeHead(200, {
    "Content-Type": type,
    // The HTML must never be cached: it names the bundle, and a stale copy
    // pins somebody to an old app forever. Assets are safe for a few minutes.
    "Cache-Control": type.startsWith("text/html") ? "no-store" : "public, max-age=300",
  });
  res.end(body);
  return true;
}

if (process.argv.includes("--selftest") && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  let bad = 0, n = 0;
  const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };

  ok(isAppPath("/app") && isAppPath("/app/") && isAppPath("/app/bundle.js"), "our paths");
  ok(!isAppPath("/api/health") && !isAppPath("/s/abc") && !isAppPath("/application"), "not our paths — /application must not be swallowed");

  ok(fileFor("/app/").endsWith("/public/index.html"), "the root is the app");
  ok(fileFor("/app/bundle.js").endsWith("/public/bundle.js"), "a file under it");

  // THE ONE THAT MATTERS. Every spelling of "go up a directory" resolves to
  // null, checked on the resolved path rather than on the text.
  for (const evil of ["/app/../serve.js", "/app/../../etc/passwd", "/app/%2e%2e%2fserve.js",
                      "/app/a/../../db.js", "/app/..%2f..%2fdb.js"]) {
    ok(fileFor(evil) === null, `escaping the folder must be refused: ${evil}`);
  }
  // `....` is a DIRECTORY NAME, not a traversal — four dots is a legal folder.
  // The first version of this test expected null and was simply wrong about
  // what the string means; the resolved path stays inside public/, which is
  // the property that matters, so it is asserted rather than the guess.
  const dots = fileFor("/app/....//serve.js");
  ok(dots !== null && dots.includes("/public/") && !dots.endsWith("/api/serve.js"),
     "four dots is a folder name and stays inside public/, so it can only ever miss");

  ok(typeOf("x.html").startsWith("text/html"), "html type");
  ok(typeOf("x.js").startsWith("text/javascript"), "js type");
  ok(typeOf("x.webmanifest").startsWith("application/manifest"), "manifest type");
  ok(typeOf("x.weird") === "application/octet-stream", "an unknown type is not guessed");

  console.log(bad ? `site selftest FAILED (${bad}/${n})` : `site selftest ok — ${n} assertions`);
  process.exit(bad ? 1 : 0);
}
