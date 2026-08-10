// serve.js — the whole HTTP surface. Plain node:http, no framework: this is a
// dozen routes and a router that fits on one screen is easier to audit than a
// dependency that hides where the request goes.
import { createServer } from "node:http";
import { migrate, dbReady, query } from "./db.js";
import { redeemPairCode, secretMatches } from "./auth.js";
import { listItems, updateItem, json } from "./items.js";
import { ingestUrl, ingestImage } from "./ingest.js";
import { drain } from "./worker.js";

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

const routes = {
  "POST /api/ingest": ingestUrl,
  "POST /api/ingest/image": ingestImage,
  "POST /api/item": updateItem,
};

async function handle(req, res, url) {
  const key = `${req.method} ${url.pathname}`;

  if (key === "GET /api/health") {
    // Says what is actually true, in words. If the queue is backing up or the
    // worker died, this is where you find out — a bare {ok:true} that is
    // green while nothing resolves would be worse than no health check.
    const out = { ok: true, db: dbReady(), model: process.env.SHELF_MODEL || "claude-opus-5" };
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
          out.warn = "shares are queued but not resolving — is the worker running?";
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

  if (key === "GET /api/items") return listItems(req, res, url);

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
server.listen(PORT, () => console.log(`[shelf] listening on :${PORT}  db=${dbReady()}`));
