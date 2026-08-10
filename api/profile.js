// profile.js — who you are, and the links that carry your shelves out.
//
// The profile is not a settings screen. It is the thing people see when you
// send them a shelf, so it is treated as a designed object: a handle, a name, a
// line about yourself, and an ex-libris mark derived from the handle and then
// PINNED, so changing your handle does not silently change the plate people
// recognise you by.
import { randomBytes } from "node:crypto";
import { isMain } from "./ismain.js";
import { query } from "./db.js";
import { getUser } from "./auth.js";
import { json, ALL_LISTS, itemId, normList } from "./items.js";
import { handleProblem, normHandle } from "../app/src/exlibris.js";

export const SHARE_KINDS = ["item", "shelf", "profile"];

// Base32-ish without the letters that get misread aloud or in a screenshot.
// A share code gets typed by hand more often than anyone expects.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function shareCode(len = 8) {
  const bytes = randomBytes(len);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function publicProfile(row) {
  if (!row) return null;
  return {
    handle: row.handle,
    display_name: row.display_name || row.handle,
    bio: row.bio || null,
    plate_seed: row.plate_seed || row.handle,
    since: row.created_at,
  };
}

// ── read / write your own profile ────────────────────────────────────────────

export async function getProfile(req, res) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });
  const r = await query("select * from users where id = $1", [user.id]);
  const row = r.rows[0];
  const counts = await query(
    `select list, count(*)::int as n from items
      where user_id = $1 and status = 'filed' group by list`,
    [user.id]
  );
  return json(res, 200, {
    ok: true,
    profile: publicProfile(row),
    // A profile with no handle is not an error — it is a person who has not
    // finished setting up, and the app needs to be able to tell those apart.
    needs_handle: !row?.handle,
    public_shelves: !!row?.public_shelves,
    counts: Object.fromEntries(counts.rows.map((x) => [x.list, x.n])),
  });
}

export async function putProfile(req, res, body) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });

  const patch = {};
  if (body?.handle !== undefined) {
    const problem = handleProblem(body.handle);
    if (problem) return json(res, 400, { ok: false, error: problem });
    patch.handle = normHandle(body.handle);
  }
  // Trimmed and length-capped here rather than in the UI: the extension, a
  // curl and a future web client all reach this same function, and only one of
  // them has a TextInput with a maxLength on it.
  if (body?.display_name !== undefined) patch.display_name = String(body.display_name).trim().slice(0, 60) || null;
  if (body?.bio !== undefined) patch.bio = String(body.bio).trim().slice(0, 200) || null;
  if (body?.public_shelves !== undefined) patch.public_shelves = !!body.public_shelves;

  if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: "nothing to change" });

  const cols = Object.keys(patch);
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  try {
    // The plate is pinned the first time a handle is set and never moves on
    // its own afterwards — coalesce, not assignment.
    await query(
      `update users set ${set}, plate_seed = coalesce(plate_seed, $${cols.length + 2}) where id = $1`,
      [user.id, ...cols.map((c) => patch[c]), patch.handle ?? null]
    );
  } catch (e) {
    if (/users_handle_uniq/.test(e.message)) return json(res, 409, { ok: false, error: "that handle is taken" });
    throw e;
  }
  return getProfile(req, res);
}

// ── links ────────────────────────────────────────────────────────────────────

export async function createShare(req, res, body) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });

  const kind = SHARE_KINDS.includes(body?.kind) ? body.kind : null;
  if (!kind) return json(res, 400, { ok: false, error: "kind must be item, shelf or profile" });

  let target = null;
  if (kind === "shelf") {
    target = normList(body?.target);
    if (target === "unsorted") return json(res, 400, { ok: false, error: "the pile is not a shelf you can share" });
  }
  if (kind === "item") {
    target = String(body?.target || "");
    const owns = await query("select 1 from items where id = $1 and user_id = $2", [target, user.id]);
    if (!owns.rowCount) return json(res, 404, { ok: false, error: "no such item" });
  }

  // A profile link requires a handle, because the link IS the handle's page.
  const me = (await query("select handle from users where id = $1", [user.id])).rows[0];
  if (!me?.handle) return json(res, 409, { ok: false, error: "pick a handle first — it is the address people open" });

  const code = shareCode();
  const r = await query(
    `insert into share_links (code, user_id, kind, target, note)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, kind, coalesce(target, '')) where revoked_at is null
     do update set note = coalesce(excluded.note, share_links.note)
     returning code, kind, target, created_at, views`,
    [code, user.id, kind, target, body?.note ? String(body.note).slice(0, 200) : null]
  );
  return json(res, 200, { ok: true, share: r.rows[0], handle: me.handle });
}

export async function listShares(req, res) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });
  const r = await query(
    `select code, kind, target, note, created_at, views from share_links
      where user_id = $1 and revoked_at is null order by created_at desc limit 50`,
    [user.id]
  );
  return json(res, 200, { ok: true, shares: r.rows });
}

export async function revokeShare(req, res, body) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });
  const r = await query(
    "update share_links set revoked_at = now() where code = $1 and user_id = $2 and revoked_at is null returning code",
    [String(body?.code || ""), user.id]
  );
  // Revoking an already-dead link is a success, not a 404: the caller wanted
  // it gone and it is gone.
  return json(res, 200, { ok: true, revoked: r.rowCount > 0 });
}

/**
 * Resolve a share for public consumption. Returns null when the code is
 * unknown or revoked — the caller must not distinguish those two, or the 404
 * becomes an oracle for guessing codes.
 */
export async function resolveShare(code, { count = false } = {}) {
  const r = await query(
    `select s.*, u.handle, u.display_name, u.bio, u.plate_seed, u.created_at as user_since
       from share_links s join users u on u.id = s.user_id
      where s.code = $1 and s.revoked_at is null`,
    [String(code || "")]
  );
  const link = r.rows[0];
  if (!link) return null;
  if (count) await query("update share_links set views = views + 1 where code = $1", [code]);

  const owner = publicProfile({ ...link, created_at: link.user_since });
  if (link.kind === "profile") {
    const items = await query(
      `select id, list, title, subtitle, note, image_url, canonical from items
        where user_id = $1 and status = 'filed' order by list, filed_at desc nulls last limit 200`,
      [link.user_id]
    );
    return { kind: "profile", owner, note: link.note, lists: groupByList(items.rows) };
  }
  if (link.kind === "shelf") {
    const items = await query(
      `select id, list, title, subtitle, note, image_url, canonical from items
        where user_id = $1 and list = $2 and status = 'filed' order by filed_at desc nulls last limit 200`,
      [link.user_id, link.target]
    );
    return { kind: "shelf", owner, list: link.target, note: link.note, items: items.rows };
  }
  const one = await query(
    `select id, list, title, subtitle, note, image_url, canonical, source_url from items where id = $1`,
    [link.target]
  );
  if (!one.rows[0]) return null;
  return { kind: "item", owner, note: link.note, item: one.rows[0] };
}

/** A handle's public page, when the user has opted their shelves public. */
export async function resolveHandle(handle, list = null) {
  const r = await query(
    "select * from users where lower(handle) = lower($1) and public_shelves = true",
    [String(handle || "")]
  );
  const u = r.rows[0];
  if (!u) return null;
  const items = await query(
    `select id, list, title, subtitle, note, image_url, canonical from items
      where user_id = $1 and status = 'filed' ${list ? "and list = $2" : ""}
      order by list, filed_at desc nulls last limit 200`,
    list ? [u.id, list] : [u.id]
  );
  const owner = publicProfile(u);
  return list
    ? { kind: "shelf", owner, list, items: items.rows }
    : { kind: "profile", owner, lists: groupByList(items.rows) };
}

export function groupByList(rows) {
  const out = {};
  for (const l of ALL_LISTS) if (l !== "unsorted") out[l] = [];
  for (const row of rows) (out[row.list] ??= []).push(row);
  return out;
}

// ── sends ────────────────────────────────────────────────────────────────────

export async function sendToHandle(req, res, body) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });

  const to = normHandle(body?.to);
  const target = await query("select id, handle from users where lower(handle) = lower($1)", [to]);
  if (!target.rows[0]) return json(res, 404, { ok: false, error: `nobody here is called @${to}` });
  if (target.rows[0].id === user.id) return json(res, 400, { ok: false, error: "you already have this" });

  // A send carries a link, so the recipient sees the same page a stranger
  // would and the sender can revoke both with one action.
  const made = await createShareRow(user.id, body);
  if (made.error) return json(res, made.status, { ok: false, error: made.error });

  const id = "sn_" + shareCode(10);
  const r = await query(
    `insert into sends (id, from_user, to_user, code, note)
     values ($1, $2, $3, $4, $5)
     on conflict (from_user, to_user, code) where status = 'sent' do nothing
     returning id`,
    [id, user.id, target.rows[0].id, made.code, body?.note ? String(body.note).slice(0, 200) : null]
  );
  return json(res, 200, { ok: true, sent_to: target.rows[0].handle, code: made.code, duplicate: r.rowCount === 0 });
}

async function createShareRow(userId, body) {
  const kind = SHARE_KINDS.includes(body?.kind) ? body.kind : null;
  if (!kind) return { error: "kind must be item, shelf or profile", status: 400 };
  let target = null;
  if (kind === "shelf") target = normList(body?.target);
  if (kind === "item") {
    target = String(body?.target || "");
    const owns = await query("select 1 from items where id = $1 and user_id = $2", [target, userId]);
    if (!owns.rowCount) return { error: "no such item", status: 404 };
  }
  const code = shareCode();
  const r = await query(
    `insert into share_links (code, user_id, kind, target, note)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, kind, coalesce(target, '')) where revoked_at is null
     do update set note = coalesce(excluded.note, share_links.note)
     returning code`,
    [code, userId, kind, target, body?.note ? String(body.note).slice(0, 200) : null]
  );
  return { code: r.rows[0].code };
}

export async function listReceived(req, res) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });
  const r = await query(
    `select s.id, s.note, s.status, s.created_at, s.code,
            u.handle as from_handle, u.display_name as from_name, u.plate_seed as from_seed,
            l.kind, l.target
       from sends s
       join users u on u.id = s.from_user
       left join share_links l on l.code = s.code
      where s.to_user = $1 and s.status = 'sent'
      order by s.created_at desc limit 50`,
    [user.id]
  );
  return json(res, 200, { ok: true, received: r.rows });
}

/**
 * Accept a send: COPY the things onto your shelves. Not a shared row — two
 * people who saved the same restaurant hold two opinions of it, and a shared
 * row would let one person's note overwrite the other's.
 */
export async function actOnSend(req, res, body) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { ok: false, error: "not paired" });
  const accept = body?.action !== "decline";
  const r = await query(
    "select * from sends where id = $1 and to_user = $2 and status = 'sent'",
    [String(body?.id || ""), user.id]
  );
  const send = r.rows[0];
  if (!send) return json(res, 404, { ok: false, error: "no such delivery" });

  let copied = 0;
  if (accept) {
    const share = await resolveShare(send.code);
    if (!share) return json(res, 410, { ok: false, error: "the sender revoked this" });
    const rows = share.kind === "item" ? [share.item]
      : share.kind === "shelf" ? share.items
      : Object.values(share.lists).flat();
    for (const it of rows) copied += await copyToShelf(user.id, it, share.owner.handle);
  }
  await query("update sends set status = $2, acted_at = now() where id = $1", [send.id, accept ? "accepted" : "declined"]);
  return json(res, 200, { ok: true, copied });
}

export async function copyToShelf(userId, it, fromHandle) {
  // A copy keeps the catalogue identity and the artwork, and drops the other
  // person's note — their note is theirs. What it keeps instead is WHO it came
  // from, which is the whole point of receiving something from a friend.
  const canonical = { ...(it.canonical || {}), from: fromHandle };
  const id = itemId(userId, it.source_url || `copy:${it.id}`, 0);
  const r = await query(
    `insert into items (id, user_id, list, status, source_url, title, subtitle, image_url,
                        canonical, confidence, enriched, added_by, filed_at)
     values ($1, $2, $3, 'filed', $4, $5, $6, $7, $8, 1.0, true, 'received', now())
     on conflict (user_id, source_url, source_ordinal) do nothing
     returning id`,
    [id, userId, normList(it.list), it.source_url || null, it.title, it.subtitle, it.image_url, canonical]
  );
  return r.rowCount;
}

// ── selftest ─────────────────────────────────────────────────────────────────

if (isMain(import.meta.url)) {
  if (process.argv.includes("--selftest")) {
    const assert = (cond, msg) => { if (!cond) { console.error("FAIL", msg); process.exitCode = 1; } };
    let n = 0;
    const ok = (cond, msg) => { n++; assert(cond, msg); };

    // Codes must be unguessable and unambiguous when read aloud.
    const codes = new Set(Array.from({ length: 2000 }, () => shareCode()));
    ok(codes.size === 2000, "share codes collided within 2000 draws");
    ok([...codes].every((c) => /^[a-z2-9]{8}$/.test(c)), "a share code contained a character outside the alphabet");
    ok([...codes].every((c) => !/[ilo01]/.test(c)), "a share code used a glyph that is misread aloud");

    ok(handleProblem("s") !== null, "a one-character handle was allowed");
    ok(handleProblem("api") !== null, "a reserved handle was allowed");
    ok(handleProblem("9lives") !== null, "a handle starting with a digit was allowed");
    ok(handleProblem("suren") === null, "a good handle was rejected");
    ok(normHandle("  @Suren_C ") === "suren_c", "handle normalisation");

    ok(groupByList([{ list: "books" }]).restaurants?.length === 0,
      "groupByList must return an empty array for a shelf with nothing on it, not undefined — 'zero' and 'we did not look' render differently");

    ok(publicProfile({ handle: "x", created_at: "t" }).display_name === "x",
      "a profile with no display name must fall back to the handle, never render blank");
    ok(publicProfile(null) === null, "publicProfile(null)");

    console.log(process.exitCode ? "profile selftest FAILED" : `profile selftest ok — ${n} assertions`);
    process.exit(process.exitCode ? 1 : 0);
  }
}
