// ingest.js — the endpoint the iOS share extension talks to.
//
// THIS IS THE HOT PATH AND IT MUST STAY BORING. It runs while the share sheet
// is still on screen over Instagram, so it does exactly one thing: write a row
// and return. No fetch, no Claude, no enrichment — those are the worker's job.
// Same standing rule as soundcheck's "never call YouTube from a request path",
// and for the same reason: a user waiting on a third party is a user watching a
// spinner in a sheet they cannot dismiss.
import { isMain } from "./ismain.js";
import { getUser } from "./auth.js";
import { createPending, json, normList } from "./items.js";
import { query } from "./db.js";
import { parseInstagramUrl } from "./resolve.js";

// Instagram's share sheet hands over a URL with tracking junk attached
// (?igsh=…). Two shares of the same reel must land on the same row, so the URL
// is normalised BEFORE it reaches the deterministic id.
export function canonicalUrl(raw) {
  const s = String(raw || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  const ig = parseInstagramUrl(s);
  if (ig) return `https://www.instagram.com/${ig.kind === "p" ? "p" : "reel"}/${ig.shortcode}/`;
  try {
    const u = new URL(s);
    // Strip the usual campaign tail; keep everything else, since a recipe blog
    // may well need its query string to resolve the right page.
    for (const k of ["igsh", "igshid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "si"]) {
      u.searchParams.delete(k);
    }
    u.hash = "";
    return u.toString();
  } catch (_) { return null; }
}

// POST /api/ingest  { url, list? }
export async function ingestUrl(req, res, body) {
  const me = await getUser(req);
  if (!me) return json(res, 401, { ok: false, error: "not signed in" });
  const url = canonicalUrl(body?.url);
  if (!url) return json(res, 400, { ok: false, error: "a http(s) url is required" });
  const row = await createPending(me.id, {
    sourceUrl: url,
    list: normList(body?.list),
    platform: parseInstagramUrl(url) ? "instagram" : "web",
  });
  return json(res, 200, { ok: true, id: row.id, status: row.status, list: row.list });
}

// POST /api/ingest/image  { image_b64, media_type?, list? }
// The path that does not depend on Meta at all: screenshot the reel, share the
// image. Capped at ~6MB of base64 — the extension downscales first, and a
// larger payload means something is wrong rather than something is detailed.
const MAX_IMAGE_B64 = 6 * 1024 * 1024;

export async function ingestImage(req, res, body) {
  const me = await getUser(req);
  if (!me) return json(res, 401, { ok: false, error: "not signed in" });
  const b64 = String(body?.image_b64 || "").replace(/^data:[^,]*,/, "");
  if (!b64) return json(res, 400, { ok: false, error: "image_b64 required" });
  if (b64.length > MAX_IMAGE_B64) return json(res, 413, { ok: false, error: "image too large — downscale before sending" });

  // No source URL, so no deterministic id to collide on: two screenshots are
  // two deliberate saves. The unique index tolerates this because NULLs never
  // conflict in Postgres.
  const id = "i_img" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await query(
    `insert into items (id, user_id, list, status, source_platform, raw_image_b64, raw_image_type)
     values ($1, $2, $3, 'pending', 'screenshot', $4, $5)`,
    [id, me.id, normList(body?.list), b64, String(body?.media_type || "image/jpeg").slice(0, 40)]
  );
  return json(res, 200, { ok: true, id, status: "pending", list: normList(body?.list) });
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  const want = "https://www.instagram.com/reel/DAbCdEf/";
  ok(canonicalUrl("https://www.instagram.com/reel/DAbCdEf/?igsh=MXk3") === want, "igsh stripped");
  ok(canonicalUrl("https://instagram.com/reels/DAbCdEf") === want, "reels → reel, scheme normalised");
  ok(canonicalUrl("https://www.instagram.com/someuser/reel/DAbCdEf/") === want, "user-scoped reel collapses");
  ok(canonicalUrl(" https://www.instagram.com/reel/DAbCdEf/ ") === want, "whitespace trimmed");
  ok(canonicalUrl("https://www.instagram.com/p/AbC/") === "https://www.instagram.com/p/AbC/", "posts keep /p/");
  // The point of all of the above: one reel, one row.
  ok(canonicalUrl("https://www.instagram.com/reel/DAbCdEf/?igsh=A") === canonicalUrl("https://instagram.com/reels/DAbCdEf?utm_source=x"),
     "two shares of one reel canonicalise identically");

  ok(canonicalUrl("https://food.example/dal?utm_source=ig&page=2") === "https://food.example/dal?page=2", "web: campaign junk out, real params kept");
  ok(canonicalUrl("https://food.example/dal#jump") === "https://food.example/dal", "fragment dropped");
  ok(canonicalUrl("not a url") === null && canonicalUrl("") === null && canonicalUrl(null) === null, "junk rejected");
  ok(canonicalUrl("javascript:alert(1)") === null, "non-http scheme rejected");

  console.log(fail ? `selftest FAILED (${fail})` : "ingest selftest ok");
  process.exit(fail ? 1 : 0);
}
