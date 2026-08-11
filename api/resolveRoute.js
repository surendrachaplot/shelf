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
import { resolveShare, handlesIn, resolveTaggedAccounts } from "./resolve.js";
import { classifyCaption, classifyImage } from "./classify.js";
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
    // The caption is returned so the DEVICE can decide whether to keep it.
    // Storing it here would be storing what you read, which is the thing this
    // service no longer does.
    caption: envelope.caption || "",
  };
}

export async function resolveRoute(req, res, body) {
  const url = canonicalUrl(body?.url);
  if (!url) return json(res, 400, { ok: false, error: "a http(s) url is required" });
  const list = normList(body?.list);

  const envelope = await resolveShare(url);

  // A LIST POST THAT TAGS RATHER THAN NAMES. Measured on a real one: the
  // caption was "10 lovely bookshops … Bookshops featured: @a @b @c @d @e @f
  // @g @h" — eight places, none of them written out. Read as text that is a
  // headline and a row of usernames, and it yields nothing.
  //
  // Two or more handles is the signal; one is a credit or a friend. The
  // poster's own account is dropped, because "follow @me for more" is on
  // almost every one of these.
  //
  // Deliberately NOT unconditional: it costs one fetch per handle, and a
  // caption that already names its places does not need it.
  const handles = handlesIn(envelope.caption).filter((h) => h !== envelope.authorHandle);
  if (handles.length >= 2) {
    envelope.taggedAccounts = await resolveTaggedAccounts(handles).catch(() => []);
  }

  const read = envelope.caption ? await classifyCaption(envelope, list) : [];

  const homeCity = String(body?.home_city || "").slice(0, 80) || null;
  const items = [];
  for (const it of read) {
    items.push(shape(await enrich(it, { outboundUrls: envelope.outboundUrls, homeCity }), envelope, url));
  }

  // An empty array is a legitimate, honest answer: the link is real, nothing
  // nameable came out of it. The device keeps the row unresolved and can ask
  // again later — which is a decision for the phone, not for this endpoint.
  return json(res, 200, {
    ok: true,
    url,
    resolver: envelope.via || "none",
    caption_chars: (envelope.caption || "").length,
    tagged_accounts: (envelope.taggedAccounts || []).length,
    items,
  });
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

  console.log(fail ? `resolveRoute selftest FAILED (${fail})` : "resolveRoute selftest ok");
  process.exit(fail ? 1 : 0);
}
