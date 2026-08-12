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
import { isMain } from "./ismain.js";
import { json } from "./http.js";
import { probeShare, probeProfile, parseInstagramUrl } from "./resolve.js";

/**
 * `instagram.com/backstory.london/` — a profile, not a post. One path segment,
 * and none of the ones Instagram reserves for its own routes.
 *
 * Worth its own branch because a profile page is a DIFFERENT question from a
 * post: the post is the thing you shared, the profile is what the tagged
 * accounts in it point at, and the two are gated separately. Measured on a
 * GitHub runner the profile gives up an og:description; measured from Render
 * it gave up nothing, and nothing is exactly what the tagged-accounts path
 * returned in production. This is how that gets checked rather than assumed.
 */
export function profileHandleIn(raw) {
  if (parseInstagramUrl(raw)) return null;              // it is a post or a reel
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?$/i.exec(String(raw || "").trim());
  if (!m) return null;
  const handle = m[1].toLowerCase();
  const RESERVED = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct"]);
  return RESERVED.has(handle) ? null : handle;
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
  // The app key already got this request through the door. No second check:
  // there is no per-user data here to protect — it fetches a public page and
  // reports what came back.
  const target = url.searchParams.get("url");
  if (!target) return json(res, 400, { ok: false, error: "url required" });
  const handle = profileHandleIn(target);
  if (handle) return json(res, 200, { ok: true, ...(await probeProfile(handle)) });
  return json(res, 200, { ok: true, ...(await probeShare(target)) });
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l) => { if (!c) { fail++; console.error("FAIL", l); } };

  ok(profileHandleIn("https://www.instagram.com/backstory.london/") === "backstory.london", "profile handle read");
  ok(profileHandleIn("https://instagram.com/BackStory") === "backstory", "no www, lowercased");
  ok(profileHandleIn("https://www.instagram.com/p/DboDS-UAJEb/") === null, "a post is not a profile");
  ok(profileHandleIn("https://www.instagram.com/reel/DAbCdEf/") === null, "a reel is not a profile");
  // The trap: /p/ and /reel/ are single segments too, and reading them as
  // handles would probe a profile called "p" instead of the post you shared.
  ok(profileHandleIn("https://www.instagram.com/p/") === null, "reserved segments are not handles");
  ok(profileHandleIn("https://example.com/someone/") === null, "another site is not a profile");

  console.log(fail ? `probe selftest FAILED (${fail})` : "probe selftest ok");
  process.exit(fail ? 1 : 0);
}
