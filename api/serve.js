// serve.js — the whole HTTP surface. Plain node:http, no framework: this is a
// dozen routes and a router that fits on one screen is easier to audit than a
// dependency that hides where the request goes.
import { createServer } from "node:http";
import { migrate, dbReady, query } from "./db.js";
import { redeemPairCode, secretMatches } from "./auth.js";
import { listItems, updateItem, json } from "./items.js";
import { ingestUrl, ingestImage } from "./ingest.js";
import { drain } from "./worker.js";
import {
  getProfile, putProfile, createShare, listShares, revokeShare,
  resolveShare, resolveHandle, sendToHandle, listReceived, actOnSend,
} from "./profile.js";
import { searchRoute, addRoute } from "./search.js";
import { renderProfile, renderShelf, renderItem, renderGone, html, canonical, WEB_BASE } from "./page.js";

const PORT = Number(process.env.PORT || 8080);

// Free-tier Render has no worker service. See the block at the bottom.
const WORKER_IN_PROCESS = /^(1|true|yes)$/i.test(process.env.WORKER_IN_PROCESS || "");
const WORKER_MODE = WORKER_IN_PROCESS ? "in-process" : "separate (worker service or cron)";

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

const routes = {
  "POST /api/ingest": ingestUrl,
  "POST /api/ingest/image": ingestImage,
  "POST /api/item": updateItem,
  "POST /api/profile": putProfile,
  "POST /api/share": createShare,
  "POST /api/share/revoke": revokeShare,
  "POST /api/send": sendToHandle,
  "POST /api/send/act": actOnSend,
  "POST /api/add": addRoute,
};

const getRoutes = {
  "GET /api/items": (req, res, url) => listItems(req, res, url),
  "GET /api/profile": (req, res) => getProfile(req, res),
  "GET /api/shares": (req, res) => listShares(req, res),
  "GET /api/received": (req, res) => listReceived(req, res),
  "GET /api/search": (req, res, url) => searchRoute(req, res, url),
};

/**
 * The public web surface. Three shapes of URL, and they are deliberately short
 * because they get typed off a screenshot and read aloud:
 *
 *   /s/<code>      a link somebody made and can revoke
 *   /@handle       a profile, only if its owner made their shelves public
 *   /@handle/books one shelf of that profile
 *
 * A revoked link and a link that never existed render IDENTICALLY. Any
 * difference between the two is an oracle for guessing codes.
 */
async function publicPage(req, res, url) {
  const path = decodeURIComponent(url.pathname);

  const shared = /^\/s\/([a-z0-9]{4,16})$/i.exec(path);
  if (shared) {
    const got = await resolveShare(shared[1], { count: true });
    if (!got) return html(res, 404, renderGone());
    // A share link's canonical address is the SHARE, not the owner's profile —
    // otherwise every card a person sends points at the same page.
    const at = { ...got, url: canonical(`/s/${shared[1]}`) };
    const page = at.kind === "profile" ? renderProfile(at) : at.kind === "shelf" ? renderShelf(at) : renderItem(at);
    return html(res, 200, page);
  }

  const at = /^\/@([A-Za-z0-9_]{2,24})(?:\/([a-z]+))?$/.exec(path);
  if (at) {
    const list = at[2] && ALL_PUBLIC_LISTS.includes(at[2]) ? at[2] : null;
    if (at[2] && !list) return html(res, 404, renderGone());
    const got = await resolveHandle(at[1], list);
    if (!got) return html(res, 404, renderGone());
    return html(res, 200, got.kind === "shelf" ? renderShelf(got) : renderProfile(got));
  }
  return null;
}

const ALL_PUBLIC_LISTS = ["books", "restaurants", "movies", "recipes"];

async function handle(req, res, url) {
  const key = `${req.method} ${url.pathname}`;

  if (key === "GET /api/health") {
    // Says what is actually true, in words. If the queue is backing up or the
    // worker died, this is where you find out — a bare {ok:true} that is
    // green while nothing resolves would be worse than no health check.
    // Says what is actually true, in words — including WHICH worker arrangement
    // this process believes it is in. "Shares are queued but not resolving"
    // reads very differently depending on whether anything is meant to be
    // draining them here.
    const out = {
      ok: true, db: dbReady(), model: process.env.SHELF_MODEL || "claude-opus-5", worker: WORKER_MODE,
      // Where share links point. Reported because it is derived — from
      // SHELF_WEB_BASE or Render's own RENDER_EXTERNAL_URL — and a wrong value
      // here is invisible until somebody tells you the link you sent them
      // 404s. An empty string means neither is set.
      web_base: WEB_BASE,
    };
    out.providers = {
      claude: !!process.env.ANTHROPIC_API_KEY,
      tmdb: !!process.env.TMDB_API_KEY,
      places: !!process.env.GOOGLE_PLACES_KEY,
      ig_resolver: !!(process.env.IG_RESOLVER_KEY && process.env.IG_RESOLVER_URL),
    };
    if (dbReady()) {
      try {
        const r = await query(
          `select count(*) filter (where status = 'pending')::int as pending,
                  count(*) filter (where status = 'needs_review')::int as inbox,
                  count(*) filter (where status = 'filed')::int as filed,
                  count(*) filter (where status = 'pending' and attempts >= 4)::int as stuck,
                  extract(epoch from now() - min(created_at) filter (where status = 'pending'))::int as oldest_pending_s
             from items`
        );
        out.queue = r.rows[0];
        if (out.queue.oldest_pending_s > 600) {
          out.ok = false;
          out.warn = WORKER_IN_PROCESS
            ? "shares are queued but the in-process drain is not clearing them — check the logs for a failing resolve"
            : "shares are queued but not resolving — is the worker service running? (free-tier Render has no workers: set WORKER_IN_PROCESS=1 on this service instead)";
        }
      } catch (e) { out.ok = false; out.db_error = e.message; }
    }
    return json(res, out.ok ? 200 : 503, out, { priv: true });
  }

  if (key === "POST /api/pair/redeem") {
    const body = await readBody(req);
    const got = await redeemPairCode(body?.code, body?.device);
    if (!got) return json(res, 401, { ok: false, error: "bad or expired code" });
    return json(res, 200, { ok: true, token: got.token });
  }

  const get = getRoutes[key];
  if (get) return get(req, res, url);

  if (req.method === "GET" || req.method === "HEAD") {
    const served = await publicPage(req, res, url);
    if (served !== null) return served;
  }

  // Lets a cron ping drive the queue where a long-lived worker is awkward.
  if (key === "POST /api/worker/run") {
    if (!secretMatches(req.headers["x-shelf-secret"], process.env.ADMIN_SECRET)) {
      return json(res, 403, { ok: false, error: "nope" });
    }
    return json(res, 200, { ok: true, resolved: await drain(10) });
  }

  const fn = routes[key];
  if (fn) return fn(req, res, await readBody(req));

  return json(res, 404, { ok: false, error: "no such route" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    await handle(req, res, url);
  } catch (e) {
    if (!res.headersSent) {
      const bad = /body too large|invalid json/.test(e.message);
      json(res, bad ? 400 : 500, { ok: false, error: bad ? e.message : "server error" });
    }
    if (!/body too large|invalid json/.test(e.message)) console.error("[serve]", req.method, url.pathname, e);
  }
});

await migrate();
server.listen(PORT, () => console.log(`[shelf] listening on :${PORT}  db=${dbReady()}  worker=${WORKER_MODE}`));

// ── the in-process drain ─────────────────────────────────────────────────────
//
// Render's free tier has no background workers, so `render.yaml`'s worker
// service needs a paid instance. This is the free-tier path: the same drain,
// on a timer, in the web process.
//
// It does NOT break the one architectural rule of this service. That rule is
// that nothing slow happens ON THE REQUEST PATH — a share writes a row and
// returns. A timer in the same process is not the request path. `for update
// skip locked` already makes concurrent drains safe, so running this AND a
// real worker is harmless rather than a race.
//
// It is off by default because a dedicated worker is better when you have one:
// a long Claude call here competes with request handling for the event loop.
if (WORKER_IN_PROCESS && dbReady()) {
  const every = Number(process.env.WORKER_INTERVAL_MS || 15_000);
  let running = false;
  setInterval(async () => {
    if (running) return;          // a slow drain must not stack up behind itself
    running = true;
    try {
      const done = await drain(3);
      if (done.length) console.log(`[shelf] drained ${done.length} in-process`);
    } catch (e) {
      console.error("[shelf] in-process drain failed:", e.message);
    } finally {
      running = false;
    }
  }, every).unref();
}
