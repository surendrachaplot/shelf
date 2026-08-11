// items.js — the shelf itself. Everything that reads or writes an item goes
// through here so there is one place where status transitions are defined.
import { isMain } from "./ismain.js";
import { createHash } from "node:crypto";
import { query } from "./db.js";
import { getUser, secretMatches } from "./auth.js";
import { LISTS } from "./classify.js";
import { probeShare } from "./resolve.js";

export const STATUSES = ["pending", "needs_review", "filed", "discarded"];
export const ALL_LISTS = [...LISTS, "unsorted"];

// Deterministic id from (user, source, ordinal) — the same trick
// soundcheck-api/import.js uses, and for the same reason: re-sharing the same
// reel is a thing people do, and it should update the row rather than mint a
// second one. Screenshot shares have no source_url and so are always distinct,
// which is correct: two screenshots are two deliberate saves.
export function itemId(userId, sourceUrl, ordinal = 0) {
  const key = [userId, sourceUrl || "", ordinal].join("|");
  return "i_" + createHash("md5").update(key).digest("hex").slice(0, 20);
}

export function json(res, status, obj, { priv = true } = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": priv ? "no-store" : "public, max-age=60",
  });
  res.end(JSON.stringify(obj));
}

export const normList = (l) => (ALL_LISTS.includes(l) ? l : "unsorted");

// Below this, we do not pretend to know what the thing is — it goes to the
// Inbox for one tap of human confirmation instead of quietly landing on a
// shelf under a name we guessed. 0.6 is a judgement call; it is the number to
// move first if the Inbox is either always empty or always full.
export const REVIEW_THRESHOLD = 0.6;

export function statusFor(confidence, enriched) {
  if (!Number.isFinite(confidence)) return "needs_review";
  if (confidence >= REVIEW_THRESHOLD && enriched) return "filed";
  if (confidence >= REVIEW_THRESHOLD) return "filed";
  return "needs_review";
}

// ── writes ───────────────────────────────────────────────────────────────────

// The queue write. Deliberately tiny: this runs while the iOS share sheet is
// still on screen, and anything slower than a database insert belongs in the
// worker. No fetching, no Claude, no enrichment on this path.
export async function createPending(userId, { sourceUrl, list, platform }) {
  const id = itemId(userId, sourceUrl, 0);
  const r = await query(
    `insert into items (id, user_id, list, status, source_url, source_platform, source_ordinal)
     values ($1, $2, $3, 'pending', $4, $5, 0)
     on conflict (user_id, source_url, source_ordinal)
     do update set attempts = 0, status = 'pending', last_error = null,
                   list = excluded.list
     returning id, status, list`,
    [id, userId, normList(list), sourceUrl || null, platform || "instagram"]
  );
  return r.rows[0];
}

export async function claimNextPending(limit = 5) {
  // `for update skip locked` so two workers never resolve the same share.
  const r = await query(
    `with picked as (
       select id from items
        where status = 'pending' and attempts < 4
        order by created_at
        limit $1
        for update skip locked
     )
     update items set attempts = attempts + 1
      where id in (select id from picked)
      returning *`,
    [limit]
  );
  return r.rows;
}

export async function writeResolved(id, envelope, results) {
  if (!results.length) {
    // Nothing nameable came back. The item is still worth keeping — it has the
    // link and the list the user chose — so it goes to the Inbox rather than
    // being deleted or left spinning as 'pending' forever.
    await query(
      `update items set status = 'needs_review', raw_caption = $2, raw_media_url = $3,
              raw_location = $4, raw_author = $5, resolver = $6, resolved_at = now()
        where id = $1`,
      [id, envelope.caption || null, envelope.imageUrl || null,
       envelope.locationTag || null, envelope.authorHandle || null, envelope.via || "none"]
    );
    return;
  }
  const base = results[0];
  await query(
    `update items set list = $2, status = $3, title = $4, subtitle = $5, note = $6,
            image_url = coalesce($7, image_url), canonical = $8, confidence = $9,
            enriched = $10, raw_caption = $11, raw_location = $12, raw_author = $13,
            resolver = $14, resolved_at = now(), last_error = null,
            filed_at = case when $3 = 'filed' then now() else filed_at end
      where id = $1`,
    [id, normList(base.list), statusFor(base.confidence, base.enriched), base.title,
     base.subtitle || null, base.note || null, envelope.imageUrl || base.image_url || null,
     JSON.stringify(base.canonical || {}), base.confidence, !!base.enriched,
     envelope.caption || null, envelope.locationTag || null, envelope.authorHandle || null,
     envelope.via || "none"]
  );

  // A "5 books I read" reel: the extra items are siblings sharing the source
  // URL, separated by ordinal so the deterministic id still holds on re-share.
  for (let i = 1; i < results.length; i++) {
    const it = results[i];
    const row = await query(`select user_id, source_url, source_platform from items where id = $1`, [id]);
    if (!row.rows.length) break;
    const { user_id, source_url, source_platform } = row.rows[0];
    await query(
      `insert into items (id, user_id, list, status, source_url, source_platform, source_ordinal,
                          title, subtitle, note, canonical, confidence, enriched, resolver, resolved_at,
                          raw_caption, filed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15,
               case when $4 = 'filed' then now() else null end)
       on conflict (user_id, source_url, source_ordinal) do update
         set title = excluded.title, subtitle = excluded.subtitle, note = excluded.note,
             canonical = excluded.canonical, confidence = excluded.confidence,
             enriched = excluded.enriched, status = excluded.status, resolved_at = now()`,
      [itemId(user_id, source_url, i), user_id, normList(it.list), statusFor(it.confidence, it.enriched),
       source_url, source_platform, i, it.title, it.subtitle || null, it.note || null,
       JSON.stringify(it.canonical || {}), it.confidence, !!it.enriched, envelope.via || "none",
       envelope.caption || null]
    );
  }
}

export async function markFailed(id, message) {
  await query(
    `update items set last_error = $2,
            status = case when attempts >= 4 then 'needs_review' else status end
      where id = $1`,
    [id, String(message || "").slice(0, 500)]
  );
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

export async function listItems(req, res, url) {
  const me = await getUser(req);
  if (!me) return json(res, 401, { ok: false, error: "not signed in" });
  const list = url.searchParams.get("list");
  const inbox = url.searchParams.get("inbox") === "1";
  const params = [me.id];
  let where = `user_id = $1 and status <> 'discarded'`;
  if (inbox) {
    where += ` and status in ('pending','needs_review')`;
  } else if (list && ALL_LISTS.includes(list)) {
    params.push(list);
    where += ` and list = $${params.length} and status = 'filed'`;
  } else {
    where += ` and status = 'filed'`;
  }
  const r = await query(
    // `resolver`, `attempts` and `last_error` ride along because the Inbox has
    // to be able to say WHY something has no name. "Couldn't read it" with no
    // reason attached is the state this app spent a day in.
    `select id, list, status, title, subtitle, note, image_url, canonical, confidence,
            source_url, resolver, attempts, last_error, raw_caption is not null as had_caption,
            enriched, created_at, filed_at
       from items where ${where} order by coalesce(filed_at, created_at) desc limit 500`,
    params
  );
  return json(res, 200, { ok: true, items: r.rows });
}

/**
 * POST /api/item/retry { id } — put an unread item back in the queue.
 *
 * A reel that Instagram refused to hand over today may well hand over
 * tomorrow, and a resolver fix is worthless if the only way to apply it is to
 * re-share every reel by hand from Instagram. `attempts` goes back to zero
 * because the four-strikes rule is about not hammering a broken share, not
 * about refusing forever.
 */
export async function retryItem(req, res, body) {
  const me = await getUser(req);
  if (!me) return json(res, 401, { ok: false, error: "not signed in" });
  const id = String(body?.id || "");
  if (!id) return json(res, 400, { ok: false, error: "id required" });
  const r = await query(
    `update items set status = 'pending', attempts = 0, last_error = null
      where id = $1 and user_id = $2 and status <> 'discarded'
      returning id, status`,
    [id, me.id]
  );
  if (!r.rows.length) return json(res, 404, { ok: false, error: "no such item" });
  return json(res, 200, { ok: true, item: r.rows[0] });
}

/**
 * GET /api/debug/reel?url=… — run the resolver chain out loud.
 *
 * Behind the device token, because it fetches on your behalf and because the
 * answer is only interesting to whoever owns the shelf. It is the only way to
 * tell "Meta blocked this server" from "the markup moved" without shell access
 * to a machine Render's free tier does not give you one of.
 */
export async function probeRoute(req, res, url) {
  // Either credential. The device token lives in an iPhone Keychain and cannot
  // be got at from a laptop, which is where a curl gets typed — so the same
  // ADMIN_SECRET that mints a pairing code opens this, for exactly the same
  // reason that route exists: Render's free tier has no Shell.
  const admin = process.env.ADMIN_SECRET
    && secretMatches(req.headers["x-shelf-secret"], process.env.ADMIN_SECRET);
  if (!admin && !(await getUser(req))) return json(res, 401, { ok: false, error: "not signed in" });
  const target = url.searchParams.get("url");
  if (!target) return json(res, 400, { ok: false, error: "url required" });
  return json(res, 200, { ok: true, ...(await probeShare(target)) });
}

// One tap from the Inbox: accept it, move it, or bin it.
export async function updateItem(req, res, body) {
  const me = await getUser(req);
  if (!me) return json(res, 401, { ok: false, error: "not signed in" });
  const id = String(body?.id || "");
  if (!id) return json(res, 400, { ok: false, error: "id required" });

  const sets = [];
  const params = [id, me.id];
  const push = (frag, val) => { params.push(val); sets.push(`${frag} = $${params.length}`); };

  if (body.action === "discard") sets.push(`status = 'discarded'`);
  if (body.action === "file") { sets.push(`status = 'filed'`); sets.push(`filed_at = now()`); }
  if (typeof body.list === "string" && ALL_LISTS.includes(body.list)) push("list", body.list);
  if (typeof body.title === "string") push("title", body.title.trim().slice(0, 200));
  if (typeof body.subtitle === "string") push("subtitle", body.subtitle.trim().slice(0, 200));
  if (typeof body.note === "string") push("note", body.note.trim().slice(0, 1000));
  if (!sets.length) return json(res, 400, { ok: false, error: "nothing to update" });

  const r = await query(
    `update items set ${sets.join(", ")} where id = $1 and user_id = $2 returning id, list, status`,
    params
  );
  if (!r.rows.length) return json(res, 404, { ok: false, error: "no such item" });
  return json(res, 200, { ok: true, item: r.rows[0] });
}

export async function counts(userId) {
  const r = await query(
    `select list, status, count(*)::int as n from items
      where user_id = $1 and status <> 'discarded' group by list, status`, [userId]
  );
  return r.rows;
}

// ── selftest ─────────────────────────────────────────────────────────────────
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  const u = "u_abc";
  const url = "https://www.instagram.com/reel/AbC/";
  ok(itemId(u, url) === itemId(u, url), "id is deterministic — re-share updates, never duplicates");
  ok(itemId(u, url, 0) !== itemId(u, url, 1), "ordinals separate siblings from one reel");
  ok(itemId(u, url) !== itemId("u_other", url), "same reel, different people, different rows");
  ok(itemId(u, null) === itemId(u, ""), "null and empty source treated alike");
  ok(itemId(u, url).startsWith("i_") && itemId(u, url).length === 22, "id shape");

  ok(normList("books") === "books" && normList("wine") === "unsorted" && normList(null) === "unsorted", "list normalisation");
  ok(ALL_LISTS.length === LISTS.length + 1, "unsorted is the only extra list");

  ok(statusFor(0.9, true) === "filed", "confident + enriched files");
  ok(statusFor(0.9, false) === "filed", "confident but un-enriched still files — a missing cover is not a reason to nag");
  ok(statusFor(0.4, true) === "needs_review", "unsure goes to the Inbox even when enriched");
  ok(statusFor(REVIEW_THRESHOLD, false) === "filed", "threshold is inclusive");
  ok(statusFor(null) === "needs_review" && statusFor(undefined) === "needs_review", "no confidence → Inbox");
  ok(STATUSES.includes(statusFor(0.9, true)) && STATUSES.includes(statusFor(0.1, false)), "statuses are in the enum");

  console.log(fail ? `selftest FAILED (${fail})` : "items selftest ok");
  process.exit(fail ? 1 : 0);
}
