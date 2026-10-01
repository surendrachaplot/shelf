// legacy.js — the door out of the old server-side store, and the lock behind it.
//
// There were real rows in the old design: films with trailers, a restaurant, a
// caption or two. Deleting them because the architecture changed would be
// making the user pay for a decision that was mine.
//
// So: the app exports them onto the phone once, and only then are they
// destroyed. Export is a READ and needs the app key; the wipe DESTROYS and
// needs the admin secret, because the app key ships inside every build and a
// build key should never be able to delete anything.
//
// THIS FILE IS TEMPORARY. It exists until the phone has the rows and the wipe
// has run. Deleting it — and the `users`, `devices`, `pair_codes` and `items`
// tables with it — is the last step of this migration, and it is deliberately
// not automatic: the check that it worked happens on a phone, not in a plan.
import { timingSafeEqual } from "node:crypto";
import { query, dbReady } from "./db.js";
import { json } from "./http.js";
import { isMain } from "./ismain.js";

export function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * IS THIS A BROWSER ASKING?
 *
 * Found 2026-10-02, the day the landing page went up: the WEB APP calls the
 * export on an empty shelf, exactly like the phone does — so every new visitor
 * to /app was handed the owner's 21 old items and told they had been "moved
 * onto this phone". One person's shelf, served to the public.
 *
 * The export exists for ONE client: the owner's phone app, which is not a
 * browser. A browser always says it is one — a `Mozilla/…` user agent, and an
 * `Origin` or `Sec-Fetch-Site` header on a fetch — and React Native's fetch
 * sends none of those. So a browser is refused.
 *
 * THIS IS NOT SECURITY and must not be read as it: anybody with curl can
 * still ask. The real fix is the one this file was always waiting for — the
 * phone has the rows, then the wipe. Until then this closes the door that
 * strangers were actually walking through.
 */
export function fromBrowser(req) {
  const h = (req && req.headers) || {};
  return /^mozilla\//i.test(String(h["user-agent"] || "")) || !!h.origin || !!h["sec-fetch-site"];
}

/**
 * Everything the old store held, in the shape the device stores now.
 *
 * `discarded` rows are included and marked. Somebody threw those away
 * deliberately, and silently resurrecting them on a new phone would be a
 * strange thing to do — but so would deciding for them that a deleted item is
 * unrecoverable. The device can drop them; this just does not decide.
 */
export async function legacyExport(req, res) {
  if (fromBrowser(req)) return json(res, 403, { ok: false, error: "the old shelf is only handed to the phone app" });
  if (!dbReady()) return json(res, 503, { ok: false, error: "no database" });
  try {
    const r = await query(
      `select id, list, status, title, subtitle, note, image_url, canonical, confidence,
              enriched, resolver, source_url, raw_caption, created_at, resolved_at
         from items order by created_at asc limit 2000`
    );
    return json(res, 200, { ok: true, count: r.rows.length, items: r.rows });
  } catch (e) {
    // The tables are gone, which means the migration already finished. That is
    // a success, not a failure, and it must not look like an outage.
    if (/relation .* does not exist/i.test(e.message)) {
      return json(res, 200, { ok: true, count: 0, items: [], note: "legacy tables already removed" });
    }
    throw e;
  }
}

export async function legacyWipe(req, res) {
  if (!dbReady()) return json(res, 503, { ok: false, error: "no database" });
  const dropped = [];
  // Order matters: children before parents, or the foreign keys refuse.
  for (const t of ["pair_codes", "devices", "items", "shares", "sends", "users"]) {
    try {
      await query(`drop table if exists ${t} cascade`);
      dropped.push(t);
    } catch (e) {
      return json(res, 500, { ok: false, dropped, failed_on: t, error: e.message });
    }
  }
  return json(res, 200, { ok: true, dropped, note: "the server now holds published snapshots and nothing else" });
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let bad = 0;
  const ok = (c, m) => { if (!c) { bad++; console.error("FAIL", m); } };
  ok(fromBrowser({ headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }), "a browser user agent is a browser");
  ok(fromBrowser({ headers: { "user-agent": "x", origin: "https://example.com" } }), "an Origin header is a browser");
  ok(fromBrowser({ headers: { "sec-fetch-site": "same-origin" } }), "Sec-Fetch-Site is a browser — the web app is same-origin and sends no Origin on a GET");
  ok(!fromBrowser({ headers: { "user-agent": "shelf/1 CFNetwork/1568.100.1 Darwin/24.0.0" } }), "the iOS app is not");
  ok(!fromBrowser({ headers: { "user-agent": "okhttp/4.9.2" } }) && !fromBrowser({}) && !fromBrowser(null), "the Android app, and no headers at all, are not");
  const res = { writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  await legacyExport({ headers: { "user-agent": "Mozilla/5.0" } }, res);
  ok(res.status === 403 && !/items/.test(res.body), "the export refuses a browser and sends no items");
  console.log(bad ? `legacy selftest FAILED (${bad})` : "legacy selftest ok");
  process.exit(bad ? 1 : 0);
}
