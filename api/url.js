// url.js — one reel, one row.
//
// Instagram's share sheet hands over a URL with tracking junk attached
// (?igsh=…), and the same reel arrives as /reel/, /reels/ or /p/ depending on
// where it was tapped. Normalising here is what makes "share the same thing
// twice" update rather than duplicate — which is a thing people do constantly.
import { isMain } from "./ismain.js";
import { parseInstagramUrl } from "./resolve.js";

export function canonicalUrl(raw) {
  const s = String(raw || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  const ig = parseInstagramUrl(s);
  if (ig) return `https://www.instagram.com/${ig.kind === "p" ? "p" : "reel"}/${ig.shortcode}/`;
  try {
    const u = new URL(s);
    // Strip the usual campaign tail; keep everything else, since a recipe blog
    // may well need its query string to resolve the right page.
    for (const k of ["igsh", "igshid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "si"]) {
      u.searchParams.delete(k);
    }
    u.hash = "";
    return u.toString();
  } catch (_) { return null; }
}


if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  const want = "https://www.instagram.com/reel/DAbCdEf/";
  ok(canonicalUrl("https://www.instagram.com/reel/DAbCdEf/?igsh=MXk3") === want, "igsh stripped");
  ok(canonicalUrl("https://instagram.com/reels/DAbCdEf") === want, "reels → reel, scheme normalised");
  ok(canonicalUrl("https://www.instagram.com/someuser/reel/DAbCdEf/") === want, "user-scoped reel collapses");
  ok(canonicalUrl(" https://www.instagram.com/reel/DAbCdEf/ ") === want, "whitespace trimmed");
  ok(canonicalUrl("https://www.instagram.com/p/AbC/") === "https://www.instagram.com/p/AbC/", "posts keep /p/");
  // The point of all of the above: one reel, one row.
  ok(canonicalUrl("https://www.instagram.com/reel/DAbCdEf/?igsh=A") === canonicalUrl("https://instagram.com/reels/DAbCdEf?utm_source=x"),
     "two shares of one reel canonicalise identically");

  ok(canonicalUrl("https://food.example/dal?utm_source=ig&page=2") === "https://food.example/dal?page=2", "web: campaign junk out, real params kept");
  ok(canonicalUrl("https://food.example/dal#jump") === "https://food.example/dal", "fragment dropped");
  ok(canonicalUrl("not a url") === null && canonicalUrl("") === null && canonicalUrl(null) === null, "junk rejected");
  ok(canonicalUrl("javascript:alert(1)") === null, "non-http scheme rejected");

  console.log(fail ? `url selftest FAILED (${fail})` : "url selftest ok");
  process.exit(fail ? 1 : 0);
}
