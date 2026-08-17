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

export const LISTS = ["books", "restaurants", "movies", "recipes", "quotes", "places"];
export const ALL_LISTS = [...LISTS, "unsorted"];

// OLD NAMES NEVER STOP ARRIVING. "travel" became "places", and a phone still
// running the previous build keeps sending the old word — as does every
// snapshot already published under it. Without this they fall through to
// "unsorted", which is not an error anybody sees: the share just lands on the
// wrong shelf. An alias costs one line and outlives the rename.
const RENAMED = { travel: "places" };

export const normList = (l) => {
  const named = RENAMED[l] ?? l;
  return ALL_LISTS.includes(named) ? named : "unsorted";
};

// ── THE BROWSER'S DOOR ───────────────────────────────────────────────────────
//
// A phone app can call this service from anywhere. A WEB app cannot: the
// browser refuses any cross-origin request the server has not explicitly
// allowed, and it refuses it BEFORE the request is sent, so the server never
// sees it and nothing appears in any log. The failure reads, in the console
// only, as "blocked by CORS policy" — which is why a web front end that has
// never been given these headers looks like a broken API rather than a
// missing header.
//
// `*` is correct here rather than lax. There are no cookies and no session:
// every request either carries the app key or is refused, and the key
// identifies a BUILD, not a person. An origin allowlist would be security
// theatre — anything that can read the key can also send any Origin it likes.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  // `x-shelf-key` is the one that matters. Leave it out and the browser's
  // preflight fails the moment SHELF_APP_KEY is set on the server — which
  // would break the web app at exactly the moment the service is locked down,
  // long after this was written and nowhere near it.
  "Access-Control-Allow-Headers": "content-type, x-shelf-key",
  "Access-Control-Max-Age": "86400",
};

/**
 * Put the headers on, and answer a preflight outright.
 *
 * Returns true when the request has been fully handled (an OPTIONS preflight),
 * so the caller stops. Headers set here survive `writeHead(status, {...})`:
 * Node merges them, with writeHead's own object winning any collision.
 */
export function cors(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method !== "OPTIONS") return false;
  res.writeHead(204);
  res.end();
  return true;
}
