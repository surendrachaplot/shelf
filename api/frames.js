// frames.js — fetch the picture, so the model can look at it.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Every resolve so far has been a READING exercise. The scrape returns a
// caption and a thumbnail URL; the caption goes to Claude and the thumbnail is
// filed away as `image_url` and never opened. That throws away the half of the
// post that most often holds the answer:
//
//   books       the cover is in shot, with the title and author printed on it
//   movies      the poster, or a title card
//   restaurants the signage over the door, or the menu header
//   recipes     the ingredient list burned into the frame
//   quotes      the entire quote, as an image, with NO caption at all
//   places      the name on the awning
//
// A caption of "📚✨ ugh this one" plus a photograph of a book with PIRANESI
// across it is a resolvable share. Caption-only, it is an unnamed row in the
// pile. That gap is what this closes.
//
// ── WHAT THIS FILE DOES, AND WHAT IT REFUSES TO DO ──────────────────────────
//
// It fetches bytes and hands back a base64 image block, or null. It does not
// decode, resize or re-encode: there is no image library in this service and
// adding one to shave tokens off a thumbnail would be a native dependency, a
// build step and a class of CVE, in exchange for a fraction of a cent.
//
// Instead it REFUSES anything too big. Instagram thumbnails are 640–1080px
// JPEGs, comfortably 40–200 kB; anything far outside that is not the picture
// we were promised, and sending it would be paying vision tokens for somebody
// else's mistake.
//
// Everything is best effort. A share whose image cannot be fetched resolves
// exactly as it did before this file existed — from the caption alone.
import { isMain } from "./ismain.js";
import { fetchT, BROWSER_HEADERS } from "./net.js";

// 1.5 MB. A 1080px JPEG is ~200 kB; PNG screenshots of a phone screen run to
// about a megabyte. Past that it is not a thumbnail.
const MAX_BYTES = 1_500_000;

// What the vision API accepts. A URL that returns anything else — an SVG
// placeholder, an HTML error page served with a 200 — is dropped rather than
// forwarded, because the API would reject it and take the whole share with it.
const OK_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Sniff the type from the bytes, not from Content-Type.
 *
 * A CDN that mislabels a JPEG as `application/octet-stream` is common enough,
 * and the magic numbers are four bytes. Trusting the header would drop images
 * that are perfectly readable.
 */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/**
 * A URL → an image content block the Messages API will accept, or null.
 *
 * Base64 rather than `source: {type: "url"}` on purpose: the CDN link in an
 * Instagram thumbnail is signed and short-lived, and handing Anthropic a URL
 * that has expired by the time it is fetched fails a share for a reason
 * nobody could diagnose from the response. We already have the bytes.
 */
export async function imageBlock(url, { timeoutMs = 6000 } = {}) {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  try {
    const res = await fetchT(url, { headers: BROWSER_HEADERS }, timeoutMs);
    if (!res.ok) return null;

    // Check the advertised length before buffering. A CDN that offers a 40 MB
    // file should cost us a header, not a download.
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;

    const type = sniffType(buf);
    if (!type || !OK_TYPES.has(type)) return null;

    return {
      type: "image",
      source: { type: "base64", media_type: type, data: buf.toString("base64") },
    };
  } catch (_) {
    // The picture is a bonus, never a requirement. A share whose image cannot
    // be fetched resolves from its caption exactly as it always did.
    return null;
  }
}

// `isMain`, NOT a bare argv check: process.argv is global, so a bare check
// makes this block run when resolveRoute.js is the one being selftested — and
// its process.exit(0) ends the run before the caller's own assertions. The
// repo has a scar for this; ismain.js exists for exactly it.
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, got) => { if (!c) { fail++; console.error("FAIL", l, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

  // Sniffing is what stops an HTML error page being sent to the vision API as
  // if it were a photograph — a 200 with the wrong body is the normal way a
  // CDN fails, and Content-Type is the field it gets wrong.
  ok(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])) === "image/jpeg", "jpeg");
  ok(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])) === "image/png", "png");
  ok(sniffType(Buffer.from("GIF89a......", "ascii")) === "image/gif", "gif");
  ok(sniffType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])) === "image/webp", "webp");
  ok(sniffType(Buffer.from("<!doctype html><html>", "ascii")) === null, "an HTML error page is not an image");
  ok(sniffType(Buffer.from("<svg xmlns=", "ascii")) === null, "SVG is not a type the vision API takes");
  ok(sniffType(Buffer.alloc(4)) === null, "too short to sniff");
  ok(sniffType(null) === null, "null survives");

  ok(await imageBlock(null) === null, "no url, no block");
  ok(await imageBlock("data:image/png;base64,AAAA") === null, "only http(s) is fetched");
  ok(await imageBlock("ftp://x/y.jpg") === null, "and nothing else");

  console.log(fail ? `frames selftest FAILED (${fail})` : "frames selftest ok");
  process.exit(fail ? 1 : 0);
}
