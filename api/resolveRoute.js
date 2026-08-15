// resolveRoute.js — the whole service, in one request.
//
//   POST /api/resolve  { url, list }  →  { items: [ …resolved, enriched… ] }
//
// Send a link, get back what it is. NOTHING IS STORED. There is no row, no
// user, no id — the phone asked a question, this answered it, and the answer
// belongs to the phone.
//
// This replaces ingest + worker + items. That architecture existed because the
// share sheet could not wait four seconds for Claude, so the work had to be
// queued somewhere durable, and "somewhere durable" meant a database with your
// shelves in it. Now the share extension writes to the shared Keychain and
// closes instantly, and the APP does this call with a row on screen saying
// what it is doing. The four seconds are still there; they are just somewhere
// a person can see them, instead of behind a queue.
//
// It IS slow — a scrape, a Claude call and a catalogue lookup, three to six
// seconds. That is the honest cost of turning a reel into a named thing, and
// the app shows it rather than hiding it.
import { isMain } from "./ismain.js";
import { json, normList } from "./http.js";
import { resolveShare, handlesIn } from "./resolve.js";
import { classifyShare, classifyImage, verifyItems, needsCheck } from "./classify.js";
import { imageBlock } from "./frames.js";
import { enrich } from "./enrich/index.js";
import { canonicalUrl } from "./url.js";

/**
 * Everything an item needs to exist on a phone. The device adds its own id and
 * timestamps — those are local facts and the server has no business minting
 * them any more.
 */
function shape(it, envelope, sourceUrl) {
  return {
    list: normList(it.list),
    title: it.title || null,
    subtitle: it.subtitle || "",
    note: it.note || "",
    image_url: it.image_url || envelope.imageUrl || null,
    canonical: it.canonical || {},
    confidence: typeof it.confidence === "number" ? it.confidence : null,
    enriched: !!it.enriched,
    source_url: sourceUrl || null,
    resolver: envelope.via || "none",
    // "confirmed" | "corrected" | "unfound" | null — see verifyItems.
    checked: it.checked || null,
    // The caption is returned so the DEVICE can decide whether to keep it.
    // Storing it here would be storing what you read, which is the thing this
    // service no longer does.
    caption: envelope.caption || "",
  };
}

/**
 * The response body, as a pure function.
 *
 * PULLED OUT BECAUSE IT SHIPPED BROKEN. A find-and-replace meant to add one
 * field to `shape()` matched twice — `resolver: envelope.via || "none"` also
 * appears here — and put `it.checked` into this object, where `it` is a
 * parameter of a different function. Every share came back
 * `{"ok":false,"error":"it is not defined"}`, and nothing caught it, because
 * the only test of this file exercised `shape()` and never built a response.
 *
 * Now it is a function with a test, so the same slip fails in milliseconds
 * instead of on somebody's phone.
 */
export function summary({ url, envelope = {}, items = [], cover = null, read = [], handles = [] }) {
  return {
    ok: true,
    url,
    resolver: envelope.via || "none",
    caption_chars: (envelope.caption || "").length,
    // Read the picture? Checked anything? Without these, "why did this come
    // back thin" needs a second request to answer — and the diagnose workflow
    // prints this JSON verbatim.
    saw_image: !!cover,
    checked_items: needsCheck(read).length,
    tagged_handles: handles.length,
    items,
  };
}

export async function resolveRoute(req, res, body) {
  const url = canonicalUrl(body?.url);
  if (!url) return json(res, 400, { ok: false, error: "a http(s) url is required" });
  const list = normList(body?.list);

  const envelope = await resolveShare(url);

  // A LIST POST THAT TAGS RATHER THAN NAMES. Measured on a real one: the
  // caption was "10 lovely bookshops … Bookshops featured: @a @b @c @d @e @f
  // @g @h" — eight places, none of them written out.
  //
  // This used to fetch each profile to turn the handle into a name. It does
  // not any more: from Render those fetches return a 429 or a login wall, so
  // the call cost eight round trips and returned an empty array (see
  // resolve.js). The handles go to the classifier as text instead, which is
  // what was resolving them correctly all along.
  //
  // COUNTED, not acted on. When a tag-list post comes back with no items, the
  // first question is whether it was a tag-list post at all, and this answers
  // it without another request.
  const handles = handlesIn(envelope.caption).filter((h) => h !== envelope.authorHandle);

  // THE PICTURE, NOT JUST THE WORDS. The scrape has always returned a
  // thumbnail URL and this endpoint has always filed it away unopened. Half
  // the shares that used to land nameless carry the name in print — on a
  // cover, a poster, a shopfront, a menu — and a caption of "📚✨ ugh this
  // one" over a photograph of PIRANESI is a resolvable share.
  //
  // Fetched in parallel with nothing, because the scrape has already finished
  // by here; ~200 kB and a fraction of a second, and null on any failure.
  const cover = await imageBlock(envelope.imageUrl);

  const read = (envelope.caption || cover) ? await classifyShare(envelope, list, cover) : [];

  // AND THEN CHECK THE UNSURE ONES. See classify.js — the failure this exists
  // for is a confidently wrong name, which is indistinguishable from a right
  // one everywhere downstream. Only items below the confidence bar are looked
  // up, and a failure here returns them untouched.
  const checked = await verifyItems(read, envelope);

  const homeCity = String(body?.home_city || "").slice(0, 80) || null;
  const items = [];
  for (const it of checked) {
    items.push(shape(await enrich(it, { outboundUrls: envelope.outboundUrls, homeCity }), envelope, url));
  }

  // An empty array is a legitimate, honest answer: the link is real, nothing
  // nameable came out of it. The device keeps the row unresolved and can ask
  // again later — which is a decision for the phone, not for this endpoint.
  return json(res, 200, summary({ url, envelope, items, cover, read, handles }));
}

/** The path that never touches Meta: share a screenshot, read it with vision. */
export async function resolveImageRoute(req, res, body) {
  const b64 = String(body?.image_b64 || "").replace(/^data:[^,]*,/, "");
  if (!b64) return json(res, 400, { ok: false, error: "image_b64 required" });
  if (b64.length > 6 * 1024 * 1024) {
    return json(res, 413, { ok: false, error: "image too large — downscale before sending" });
  }
  const list = normList(body?.list);
  const envelope = { caption: "", imageUrl: null, locationTag: null, authorHandle: null,
                     outboundUrls: [], via: "screenshot" };
  const read = await classifyImage(b64, String(body?.media_type || "image/jpeg").slice(0, 40), list);
  const items = [];
  for (const it of read) items.push(shape(await enrich(it, {}), envelope, null));
  return json(res, 200, { ok: true, resolver: "screenshot", items });
}

if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  const env = { caption: "cap", imageUrl: "https://cdn/x.jpg", via: "crawler-embed-html", outboundUrls: [] };
  const s = shape({ list: "movies", title: "T", confidence: 0.9, enriched: true, canonical: { tmdb_id: 1 } },
                  env, "https://insta/reel/x/");
  ok(s.title === "T" && s.resolver === "crawler-embed-html", "shape carries title and resolver");
  ok(s.image_url === "https://cdn/x.jpg", "envelope image fills in when the enricher had none");
  ok(s.caption === "cap", "the caption goes back to the device rather than being stored here");
  ok(!("id" in s) && !("user_id" in s) && !("status" in s),
     "NO id, NO user, NO status — those are the device's to decide now");
  ok(shape({ list: "nonsense", title: "T" }, env).list === "unsorted", "list normalised");

  // THE RESPONSE BODY. Every share returned `{"ok":false,"error":"it is not
  // defined"}` because a field referencing `shape()`'s parameter was pasted
  // into this object too. Building it here is the whole guard.
  {
    let threw = null, out = null;
    try {
      out = summary({ url: "https://insta/p/x/", envelope: env, items: [s],
                      cover: { type: "image" }, read: [{ confidence: 0.5 }], handles: ["a"] });
    } catch (e) { threw = e.message; }
    ok(threw === null, "building the response body does not throw", threw);
    ok(out?.ok === true && out?.items?.length === 1, "and it carries the items", out);
    ok(out?.saw_image === true, "it reports whether the picture was read");
    ok(out?.checked_items === 1, "and how many items were looked up", out?.checked_items);
    ok(summary({ url: "u" }).saw_image === false, "no cover, no claim to have read one");
    ok(!("checked" in summary({ url: "u" })), "the per-item verdict belongs on the item, not the envelope");
  }

  console.log(fail ? `resolveRoute selftest FAILED (${fail})` : "resolveRoute selftest ok");
  process.exit(fail ? 1 : 0);
}
