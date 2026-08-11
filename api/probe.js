// probe.js — run the resolver chain out loud.
//
//   GET /api/debug/reel?url=…
//
// This is not a feature, it is an INSTRUMENT, and it earned its place. "Reels
// come back with no name" had four candidate causes that look identical from
// the app — a blocked IP, a login wall, a JavaScript shell, a moved key — and
// picking between them by reasoning cost most of a day. This answers it in one
// request, from the machine whose IP address is the variable.
//
// It is also how the Wicker Man bug was found: reporting the caption TEXT and
// not merely its length showed two different captions coming back from two
// URLs for the same reel.
import { json } from "./http.js";
import { probeShare } from "./resolve.js";

/**
 * GET /api/debug/reel?url=… — run the resolver chain out loud.
 *
 * Behind the device token, because it fetches on your behalf and because the
 * answer is only interesting to whoever owns the shelf. It is the only way to
 * tell "Meta blocked this server" from "the markup moved" without shell access
 * to a machine Render's free tier does not give you one of.
 */
export async function probeRoute(req, res, url) {
  // The app key already got this request through the door. No second check:
  // there is no per-user data here to protect — it fetches a public page and
  // reports what came back.
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
