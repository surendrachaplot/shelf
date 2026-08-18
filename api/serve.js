// serve.js — the whole HTTP surface. Plain node:http, no framework: this is a
// handful of routes and a router that fits on one screen is easier to audit
// than a dependency that hides where the request goes.
//
// WHAT THIS SERVICE IS, since it used to be something else entirely:
//
//   It resolves a link into a named thing, and it hosts what you deliberately
//   publish. That is all. There are no users, no devices, no pairing codes and
//   no shelves here — your shelves are on your phone.
//
//   The old design had all of it: an accounts table, a device-token handshake,
//   a queue, a worker, and every item you ever saved. It existed because the
//   share sheet cannot wait four seconds for Claude, so the work had to be
//   queued somewhere durable — and "durable" quietly meant "a database holding
//   everything you read". The share extension now writes to the shared
//   Keychain and closes instantly, the app does the resolving with a row on
//   screen, and none of the rest is needed.
//
//   What is left needs no login, because there is nothing here to log in to.
import { createServer } from "node:http";
import { migrate, dbReady, query } from "./db.js";
import { json, appKeyOk , cors } from "./http.js";
import { serveApp } from "./site.js";
import { secretMatches } from "./legacy.js";
import { resolveRoute, resolveImageRoute } from "./resolveRoute.js";
import { createPublish, revokePublish, publishStats, readPublished } from "./publish.js";
import { searchRoute } from "./search.js";
import { probeRoute } from "./probe.js";
import { legacyExport, legacyWipe } from "./legacy.js";
import { renderProfile, renderShelf, renderItem, renderGone, html, canonical, WEB_BASE } from "./page.js";

const PORT = Number(process.env.PORT || 8080);

// 8MB: a downscaled screenshot as base64 plus headroom. Anything larger is
// rejected before it is buffered, not after.
const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (_) { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

// Everything here needs the app key. It is not a user credential — it is the
// turnstile in front of a service that spends money per request.
const routes = {
  "POST /api/resolve": resolveRoute,
  "POST /api/resolve/image": resolveImageRoute,
  "POST /api/publish": createPublish,
  "POST /api/publish/revoke": revokePublish,
  "POST /api/publish/stats": publishStats,
};

const getRoutes = {
  "GET /api/search": (req, res, url) => searchRoute(req, res, url),
  "GET /api/debug/reel": (req, res, url) => probeRoute(req, res, url),
  // The one-time move off the old server-side store. Removed once the phone
  // has the rows; see legacy.js.
  "GET /api/legacy/export": (req, res) => legacyExport(req, res),
};

/**
 * The public web surface. ONE shape of URL now:
 *
 *   /s/<code>   something somebody deliberately published
 *
 * `/@handle` is gone with the accounts that gave it meaning. A handle was a
 * lookup into a users table; there is no users table, and a profile page is
 * now just another published snapshot.
 *
 * A revoked link and a link that never existed render IDENTICALLY.
 */
async function publicPage(req, res, url) {
  const shared = /^\/s\/([a-z0-9]{4,16})$/i.exec(decodeURIComponent(url.pathname));
  if (!shared) return null;
  const got = await readPublished(shared[1], { count: true });
  if (!got) return html(res, 404, renderGone());
  const at = { ...got, url: canonical(`/s/${shared[1]}`) };
  const page = at.kind === "profile" ? renderProfile({ ...at, lists: at.lists })
    : at.kind === "shelf" ? renderShelf(at)
    : renderItem(at);
  return html(res, 200, page);
}

async function handle(req, res, url) {
  const key = `${req.method} ${url.pathname}`;

  if (key === "GET /api/health") {
    // Says what is actually true, in words. A bare {ok:true} that stays green
    // while nothing resolves would be worse than no health check at all.
    const out = {
      ok: true,
      db: dbReady(),
      model: process.env.SHELF_MODEL || "claude-opus-5",
      // What this service holds. Named explicitly because the answer changed,
      // and because "does the server have my shelves" is the question this
      // rewrite exists to answer with a no.
      stores: "published snapshots only — no accounts, no shelves",
      // WHICH BUILD IS ANSWERING. Without this, "is my fix live yet" is
      // guesswork against Render's deploy timing, and a diagnosis run two
      // minutes after a push silently measures the PREVIOUS build — which is
      // how a tagged-accounts change got tested against the code it replaced.
      // Render sets this; null everywhere else, and says so rather than lying.
      commit: (process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || null,
      web_base: WEB_BASE,
      app_key_required: !!process.env.SHELF_APP_KEY,
      providers: {
        claude: !!process.env.ANTHROPIC_API_KEY,
        tmdb: !!process.env.TMDB_API_KEY,
        places_google: !!process.env.GOOGLE_PLACES_KEY,
        places_osm: true,   // free, keyless, always available
        // Where a place's PHOTO can come from. The first two need no key and
        // ride along with the lookup we already make; Foursquare is the one
        // with real coverage of restaurants, and it is off until configured.
        photos_osm_wikidata: true,
        photos_foursquare: !!process.env.FOURSQUARE_KEY,
        ig_resolver: !!(process.env.IG_RESOLVER_KEY && process.env.IG_RESOLVER_URL),
      },
    };
    if (dbReady()) {
      try {
        const r = await query(`select count(*)::int as n, coalesce(sum(views), 0)::int as views from published`);
        out.published = { links: r.rows[0].n, opened: r.rows[0].views };
      } catch (e) { out.ok = false; out.db_error = e.message; }
    }
    return json(res, out.ok ? 200 : 503, out, { priv: true });
  }

  // Public pages first: they are the one thing that must work with no key,
  // because the whole point is handing a link to somebody who has no app.
  if (req.method === "GET" || req.method === "HEAD") {
    const served = await publicPage(req, res, url);
    if (served !== null) return served;
    // THE APP ITSELF, at /app. Same reasoning as the pages above: no key, no
    // account. This service already had a domain and a deploy, which is why
    // the web build lives here rather than waiting on somebody to switch on a
    // hosting product.
    if (await serveApp(req, res, url)) return;
  }

  // Guarded, uniformly. `/api/legacy/wipe` takes the admin secret instead,
  // because it destroys data and the app key is in every build.
  if (key === "POST /api/legacy/wipe") {
    if (!secretMatches(req.headers["x-shelf-secret"], process.env.ADMIN_SECRET)) {
      return json(res, 403, { ok: false, error: "nope" });
    }
    return legacyWipe(req, res);
  }

  if (url.pathname.startsWith("/api/") && !appKeyOk(req)) {
    return json(res, 401, { ok: false, error: "this build is not authorised to use this service" });
  }

  const get = getRoutes[key];
  if (get) return get(req, res, url);

  const fn = routes[key];
  if (fn) return fn(req, res, await readBody(req), url);

  return json(res, 404, { ok: false, error: "no such route" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  // Before anything else, including the public pages: a preflight is answered
  // and every response carries the headers. Without them the web app cannot
  // call this service at all, and the browser blocks it so early that nothing
  // reaches these logs to say so.
  if (cors(req, res)) return;
  try {
    await handle(req, res, url);
  } catch (e) {
    console.error(`[shelf] ${req.method} ${url.pathname}:`, e);
    // A SECOND WRITE MUST NOT KILL THE PROCESS. When a handler has already
    // answered, writing a 500 on top throws ERR_HTTP_HEADERS_SENT from inside
    // this catch — uncaught, so the whole server exits and every other request
    // in flight dies with it. That is precisely how the /app route took the
    // service down the first time it served a page.
    if (res.headersSent) res.end();
    else json(res, 500, { ok: false, error: e.message });
  }
});

await migrate();
server.listen(PORT, () => {
  console.log(`[shelf] listening on ${PORT}`);
  console.log(`[shelf] stores published snapshots only — no accounts, no shelves`);
  if (!process.env.SHELF_APP_KEY) {
    console.warn(`[shelf] SHELF_APP_KEY is not set — anyone who finds this URL can spend your provider quota`);
  }
});
