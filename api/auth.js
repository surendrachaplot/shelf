// auth.js — device tokens, hashed at rest.
//
// One person's shelf, so this is deliberately small: mint a pairing code on the
// server, type it into the app once, get a long-lived token that lives in the
// iOS Keychain and is readable by both the app and the share extension (same
// App Group). Email + 6-digit code is the upgrade path when this stops being a
// one-person app; nothing here blocks it, because the token table is already
// per-device and per-user.
//
// The tokens are stored HASHED. A database dump should not be a working set of
// credentials, and there is no reason the server ever needs the plaintext back.
import { isMain } from "./ismain.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query, dbReady } from "./db.js";

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

// Unambiguous alphabet: no O/0, no I/1/L. This gets read off a terminal and
// typed into a phone, and "was that a zero" is a support ticket.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function makeCode(len = 8) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export const userIdFor = (email) => "u_" + sha256(String(email).trim().toLowerCase()).slice(0, 16);

// Create (or find) a user and mint a single-use pairing code.
export async function mintPairCode(email, ttlMinutes = 30) {
  const id = userIdFor(email);
  await query(
    `insert into users (id, email) values ($1, $2)
     on conflict (id) do nothing`, [id, String(email).trim().toLowerCase()]
  );
  const code = makeCode();
  await query(
    `insert into pair_codes (code, user_id, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`, [code, id, String(ttlMinutes)]
  );
  return { code, userId: id };
}

// Exchange a pairing code for a device token. Single use, and the plaintext
// token is returned exactly once — there is no endpoint that can read it back.
export async function redeemPairCode(code, deviceName) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const r = await query(
    `update pair_codes set used_at = now()
      where code = $1 and used_at is null and expires_at > now()
      returning user_id`, [c]
  );
  if (!r.rows.length) return null;
  const token = "shelf_" + randomBytes(32).toString("base64url");
  await query(
    `insert into devices (token_hash, user_id, name) values ($1, $2, $3)`,
    [sha256(token), r.rows[0].user_id, String(deviceName || "iPhone").slice(0, 80)]
  );
  return { token, userId: r.rows[0].user_id };
}

function bearer(req) {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Resolve the caller. Returns null rather than throwing — every endpoint
// decides for itself whether anonymous is acceptable (none currently are).
export async function getUser(req) {
  if (!dbReady()) return null;
  const token = bearer(req);
  if (!token) return null;
  const r = await query(
    `update devices set last_seen = now() where token_hash = $1 returning user_id`,
    [sha256(token)]
  );
  return r.rows.length ? { id: r.rows[0].user_id } : null;
}

// Constant-time compare for the admin secret. Not because a shelf app is a
// juicy target, but because `a === b` on a secret is the kind of thing that
// gets copied into somewhere it matters.
export function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// CLI: node auth.js --pair you@example.com
if (isMain(import.meta.url) && process.argv.includes("--pair")) {
  const email = process.argv[process.argv.indexOf("--pair") + 1];
  if (!email || !email.includes("@")) {
    console.error("usage: node auth.js --pair you@example.com");
    process.exit(1);
  }
  const { code, userId } = await mintPairCode(email);
  console.log(`pairing code for ${email} (${userId}): ${code}  — valid 30 minutes, single use`);
  process.exit(0);
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };
  ok(userIdFor("A@B.com ") === userIdFor("a@b.com"), "user id normalises case + whitespace");
  ok(makeCode(8).length === 8, "code length");
  ok(!/[O0I1L]/.test(makeCode(200)), "code alphabet excludes lookalikes");
  ok(new Set(Array.from({ length: 50 }, () => makeCode())).size === 50, "codes are not repeating");
  ok(secretMatches("abc", "abc") === true, "secret match");
  ok(secretMatches("abc", "abd") === false, "secret mismatch");
  ok(secretMatches("abc", "abcd") === false, "secret length mismatch");
  ok(secretMatches("", "") === false && secretMatches(null, "x") === false, "empty secret never matches");
  console.log(fail ? `selftest FAILED (${fail})` : "auth selftest ok");
  process.exit(fail ? 1 : 0);
}
