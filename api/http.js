// http.js — the two things every route needs, and the door.
//
// Split out of items.js when the server stopped owning anybody's items. There
// is no user table any more, no devices, no pairing: the shelves live on the
// phone. What is left is a resolver and a place to publish a snapshot to, and
// both of those need exactly this much HTTP.

export function json(res, status, obj, { priv = true } = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": priv ? "no-store" : "public, max-age=60",
  });
  res.end(JSON.stringify(obj));
}

/**
 * THE APP KEY. Not a user credential — there are no users.
 *
 * This service spends money on somebody's behalf: every resolve is a Claude
 * call, and the catalogue lookups are metered too. Left open, the URL alone is
 * a free API for anyone who finds it, and the first sign would be the bill.
 *
 * So the build carries a key and the server checks it. That is all it does:
 * it does not identify you, it cannot be used to read anything, and losing it
 * exposes no data — because the server holds no data to expose. It is a
 * turnstile, not a lock.
 *
 * Unset in development, where an open localhost is the point.
 */
export function appKeyOk(req) {
  const want = process.env.SHELF_APP_KEY;
  if (!want) return true;
  const got = req.headers["x-shelf-key"];
  if (!got || got.length !== want.length) return false;
  // Constant time, because a length-leaking compare on a shared secret is a
  // free lesson in how long the secret is.
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ String(got).charCodeAt(i);
  return diff === 0;
}

export const LISTS = ["books", "restaurants", "movies", "recipes"];
export const ALL_LISTS = [...LISTS, "unsorted"];
export const normList = (l) => (ALL_LISTS.includes(l) ? l : "unsorted");
