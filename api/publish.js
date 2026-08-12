// publish.js — the only thing this server stores, and only when you ask.
//
// Your shelves are on your phone. Tapping Share uploads ONE item or ONE shelf
// as a frozen snapshot and returns a link. Everything not published has never
// been near this machine.
//
// Three properties, each with a reason:
//
//   FROZEN     the page renders what you published, not what you have now. A
//              link somebody saved should not change under them — and a live
//              view would require the server to hold your current shelves,
//              which is the whole thing we just stopped doing.
//   REVOCABLE  turning a link off DELETES the row. Not a flag, not a tombstone.
//              "Off" has to mean the bytes are gone or it is a promise you
//              cannot keep.
//   OPAQUE     a revoked link and a link that never existed render identically.
//              Any difference between them is an oracle for guessing codes.
import { isMain } from "./ismain.js";
import { randomBytes } from "node:crypto";
import { query, dbReady } from "./db.js";
import { json, normList } from "./http.js";

export const KINDS = ["profile", "shelf", "item"];

// 8 chars of base32-ish alphabet ≈ 40 bits. Short enough to read aloud off a
// screenshot, long enough that guessing is not a strategy. No vowels: it
// cannot accidentally spell anything, and it gets dictated over a phone.
const ALPHABET = "0123456789bcdfghjkmnpqrstvwxyz";
export function makeCode(n = 8) {
  const b = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

/**
 * What a snapshot is allowed to contain.
 *
 * The device sends whatever it likes; this decides what is stored. Anything
 * not named here is dropped rather than trusted — a publish endpoint that
 * persists arbitrary client JSON is a storage service with extra steps, and
 * the whole point of this rewrite was to stop being one.
 */
export function cleanItem(it) {
  if (!it || typeof it !== "object") return null;
  const title = String(it.title ?? "").trim();
  if (!title) return null;
  const canonical = it.canonical && typeof it.canonical === "object" ? it.canonical : {};
  return {
    title: title.slice(0, 300),
    subtitle: String(it.subtitle ?? "").slice(0, 300),
    note: String(it.note ?? "").slice(0, 2000),
    image_url: /^https:\/\//i.test(it.image_url || "") ? String(it.image_url).slice(0, 900) : null,
    list: normList(it.list),
    source_url: /^https:\/\//i.test(it.source_url || "") ? String(it.source_url).slice(0, 900) : null,
    canonical: JSON.parse(JSON.stringify(canonical)),
  };
}

export function cleanOwner(o) {
  return {
    name: String(o?.name ?? "").slice(0, 120) || "Someone",
    bio: String(o?.bio ?? "").slice(0, 400),
    // The plate is drawn FROM this string, on both the app and the server, so
    // a card looks the same in a browser as it does on the phone.
    seed: String(o?.seed ?? o?.name ?? "shelf").slice(0, 120),
  };
}

export function buildSnapshot(body) {
  const kind = KINDS.includes(body?.kind) ? body.kind : null;
  if (!kind) return null;
  const owner = cleanOwner(body?.owner);

  if (kind === "item") {
    const item = cleanItem(body?.item);
    return item ? { kind, target: null, payload: { owner, item } } : null;
  }
  if (kind === "shelf") {
    const target = normList(body?.target);
    const items = (Array.isArray(body?.items) ? body.items : []).map(cleanItem).filter(Boolean).slice(0, 300);
    return items.length ? { kind, target, payload: { owner, list: target, items } } : null;
  }
  // A card: the four shelves as they stood, capped so one tap cannot upload a
  // thousand rows.
  const lists = {};
  for (const [k, v] of Object.entries(body?.lists || {})) {
    const items = (Array.isArray(v) ? v : []).map(cleanItem).filter(Boolean).slice(0, 60);
    if (items.length) lists[normList(k)] = items;
  }
  return Object.keys(lists).length ? { kind, target: null, payload: { owner, lists } } : null;
}

export async function createPublish(req, res, body) {
  const snap = buildSnapshot(body);
  if (!snap) return json(res, 400, { ok: false, error: "nothing publishable in that request" });
  // Say which of the two it is. "Publishing is switched off on this server" is
  // something a person can act on; a 500 from a failed insert is not.
  if (!dbReady()) {
    return json(res, 503, { ok: false, error: "publishing is switched off on this server — it has no database" });
  }
  const code = makeCode();
  await query(
    `insert into published (code, kind, target, payload, note) values ($1, $2, $3, $4, $5)`,
    [code, snap.kind, snap.target, JSON.stringify(snap.payload), String(body?.note || "").slice(0, 500) || null]
  );
  return json(res, 200, { ok: true, code, kind: snap.kind });
}

export async function revokePublish(req, res, body) {
  const code = String(body?.code || "").toLowerCase();
  if (!code) return json(res, 400, { ok: false, error: "code required" });
  // DELETE, not a flag. See the header.
  const r = await query(`delete from published where code = $1 returning code`, [code]);
  // Reports revoked either way: "that code was not yours" would confirm which
  // codes exist to anyone who asked.
  return json(res, 200, { ok: true, revoked: true, existed: r.rows.length > 0 });
}

/** How many times each of your links has been opened. The device holds the list. */
export async function publishStats(req, res, body) {
  const codes = (Array.isArray(body?.codes) ? body.codes : []).map(String).slice(0, 200);
  if (!codes.length) return json(res, 200, { ok: true, views: {} });
  const r = await query(`select code, views from published where code = any($1)`, [codes]);
  const views = {};
  for (const row of r.rows) views[row.code] = row.views;
  // A code that is absent is absent from the answer, so the app can show
  // "no longer live" rather than a confident zero.
  return json(res, 200, { ok: true, views });
}

export async function readPublished(code, { count = false } = {}) {
  const c = String(code || "").toLowerCase();
  if (!/^[0-9a-z]{4,16}$/.test(c)) return null;
  // NO DATABASE, NO LINKS — and that renders as "nothing here", not as a stack
  // trace on a public URL. A deploy with no DATABASE_URL is a legitimate way to
  // run this (resolving and shelving need none); every /s/ link was answering
  // 500 in that configuration, which the smoke test caught before anyone met it.
  // Only the UNCONFIGURED case is swallowed: a pool that is attached and
  // failing still throws, because that is an outage and it should look like one.
  if (!dbReady()) return null;
  const r = count
    ? await query(`update published set views = views + 1 where code = $1 returning *`, [c])
    : await query(`select * from published where code = $1`, [c]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return { kind: row.kind, target: row.target, note: row.note, ...row.payload };
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  ok(makeCode().length === 8 && /^[0-9bcdfghjkmnpqrstvwxyz]+$/.test(makeCode()), "code shape");
  ok(makeCode() !== makeCode(), "codes differ");
  ok(!/[aeiou]/.test(makeCode(64)), "no vowels, so a code cannot spell a word");

  // The allow-list is the point: anything not named is dropped, not stored.
  const dirty = cleanItem({ title: "Piranesi", subtitle: "Susanna Clarke", note: "loved it",
    image_url: "https://cdn/x.jpg", list: "books", source_url: "https://insta/x",
    canonical: { isbn: "1" }, secret: "should not survive", password: "nope" });
  ok(dirty.title === "Piranesi" && dirty.canonical.isbn === "1", "named fields survive");
  ok(!("secret" in dirty) && !("password" in dirty), "unnamed fields are dropped, not stored");
  ok(cleanItem({ title: "  " }) === null, "a titleless item is not publishable");
  ok(cleanItem({ title: "T", image_url: "http://insecure/x" }).image_url === null, "http images rejected — a shared page must not go mixed-content");
  ok(cleanItem({ title: "T", image_url: "javascript:alert(1)" }).image_url === null, "non-https scheme rejected");
  ok(cleanItem({ title: "T", list: "nonsense" }).list === "unsorted", "unknown list normalised");
  ok(cleanItem({ title: "x".repeat(500) }).title.length === 300, "title capped");

  const shelf = buildSnapshot({ kind: "shelf", target: "books", owner: { name: "Suren" },
    items: [{ title: "A" }, { title: "" }, { title: "B" }] });
  ok(shelf.payload.items.length === 2, "unpublishable items are filtered out of a shelf", shelf.payload.items.length);
  ok(shelf.payload.owner.name === "Suren" && shelf.payload.owner.seed === "Suren", "owner carried, seed defaults to the name");
  ok(buildSnapshot({ kind: "shelf", target: "books", items: [] }) === null, "an empty shelf is not publishable");
  ok(buildSnapshot({ kind: "nope" }) === null, "unknown kind rejected");
  ok(buildSnapshot({ kind: "item", item: { title: "A" } }).payload.item.title === "A", "single item");

  const card = buildSnapshot({ kind: "profile", owner: { name: "S" },
    lists: { books: [{ title: "A" }], junk: [{ title: "B" }], movies: [] } });
  ok(Object.keys(card.payload.lists).sort().join() === "books,unsorted", "a card keeps real shelves, normalises junk, drops empties", JSON.stringify(Object.keys(card.payload.lists)));

  ok(cleanOwner({}).name === "Someone", "an unnamed owner is still a person");

  console.log(fail ? `publish selftest FAILED (${fail})` : "publish selftest ok");
  process.exit(fail ? 1 : 0);
}
