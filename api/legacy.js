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

export function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
