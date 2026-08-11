// classify.js — turn a caption (or a screenshot) into filed items.
//
// One Claude call per share. Structured output via `output_config.format`, not
// free-text JSON parsing: the schema is enforced at the API layer, so there is
// no "the model wrapped it in ```json again" failure mode to defend against.
//
// THE ONE RULE THAT IS NOT NEGOTIABLE: if you picked a list at share time,
// that is the answer. The model fills in the fields; it does not get a vote on
// which shelf the thing belongs on. Your tap is data, not a suggestion — and a
// model that "helpfully" re-files a restaurant reel under Recipes because the
// caption mentioned garlic is a bug you can never quite prompt away.
import { isMain } from "./ismain.js";
import { readFile } from "node:fs/promises";

export const LISTS = ["books", "restaurants", "movies", "recipes", "quotes", "travel"];

// Opus 5 by default. Sonnet 5 is a drop-in via SHELF_MODEL if this ever runs
// hot enough to care — a per-share extraction is a few thousand tokens, so at
// Opus rates ($5/$25 per Mtok) a heavy day of sharing is still cents.
const MODEL = process.env.SHELF_MODEL || "claude-opus-5";

// The schema the API enforces. Optional fields are empty strings rather than
// nulls — the JSON-schema subset supports `anyOf` but plain required strings
// are one less thing to get subtly wrong, and "" reads the same downstream.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description: "One entry per distinct thing worth saving. Usually one.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["list", "title", "subtitle", "note", "confidence", "search_hints"],
        properties: {
          list: { type: "string", enum: LISTS },
          title: { type: "string", description: "The name of the thing itself — the book, the restaurant, the film, the dish. Not the caption, not the creator's handle." },
          subtitle: { type: "string", description: "Author, director, neighbourhood, cuisine — whatever disambiguates. Empty string if unknown." },
          note: { type: "string", description: "What the reel actually said about it, in one line. The reason it's worth saving. Empty string if the caption said nothing useful." },
          confidence: { type: "number", description: "0 to 1. How sure you are this is a real, correctly-named thing rather than a guess from thin text." },
          search_hints: {
            type: "object",
            additionalProperties: false,
            required: ["author", "year", "city", "cuisine"],
            properties: {
              author: { type: "string", description: "Author or director, for catalogue lookup. Empty if unknown." },
              year: { type: "string", description: "Release/publication year if stated. Empty if unknown." },
              city: { type: "string", description: "City or neighbourhood for a restaurant. Empty if unknown." },
              cuisine: { type: "string", description: "Cuisine or dish type. Empty if unknown." },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You extract saveable things from social media captions for a personal shelf app with six lists: books, restaurants, movies, recipes, quotes, travel.

Return the thing itself, never the post about it. "POV: you finally read the book everyone's talking about 📚 Piranesi by Susanna Clarke" is one item titled "Piranesi", not "POV: you finally read...".

A reel can hold several things — "5 books I read in March" is five items. A reel can also hold none: if the caption is only hashtags, only a handle, or plainly about something that fits no list, return an empty array rather than inventing a title.

Confidence is about the NAME, not your enthusiasm. A caption that names a restaurant and its street gets 0.9. A caption that says "this place is unreal 🤯" with no name gets 0.2 and a title of whatever you can salvage — it will land in the Inbox for the user to fix, which is the correct outcome and much better than a confident fabrication.

Never invent an author, year, or address that the caption does not support. An empty hint is useful; a wrong one sends the enrichment step off to fetch the wrong book.

QUOTES. The thing being saved is THE WORDS THEMSELVES. Put the quote in "title", verbatim — the person's actual sentence, not a summary of it and not a label for it. Strip surrounding quotation marks, hashtags, and the "follow for more" tail; keep the wording, the punctuation and the line breaks inside it exactly as written. Put whoever said it in "subtitle" and in search_hints.author. If the caption does not say who said it, leave both empty rather than guessing — a misattributed quote is worse than an unattributed one. A quote with no attribution is still a perfectly good quote.

TRAVEL. ONE ITEM PER PLACE, not one per reel. "10 things to do in Lisbon" is ten items, each titled with the individual place — the restaurant, the viewpoint, the neighbourhood, the shop — and NOT one item called "Lisbon". Put the city or area in search_hints.city on every one of them, because that is what turns a name into a point on a map. If the reel names a city with no specific places in it, that is one item titled with the city. A place with a name you cannot make out is better dropped than saved as "amazing rooftop bar".

RESTAURANTS vs TRAVEL: a place you would eat at, at home, is a restaurant. A place you would go to on a trip — including its restaurants — is travel. When the caption is about a trip, prefer travel.`;

// The user's tap wins. Stated separately from SYSTEM so it is impossible to
// accidentally drop when the prompt is edited.
function listDirective(chosenList) {
  if (!chosenList || !LISTS.includes(chosenList)) {
    return `The user did not pick a list — choose the best fitting one of: ${LISTS.join(", ")}.`;
  }
  return `The user already filed this under "${chosenList}". Every item you return MUST use list "${chosenList}". Do not re-categorise, even if the caption seems to point elsewhere — they can see the reel and you cannot.`;
}

export function buildPrompt(envelope, chosenList) {
  const e = envelope || {};
  const lines = [listDirective(chosenList), ""];
  if (e.authorHandle) lines.push(`Posted by: @${e.authorHandle}`);
  if (e.locationTag) lines.push(`Location tag: ${e.locationTag}`);
  if (e.outboundUrls?.length) lines.push(`Links in caption: ${e.outboundUrls.join(" ")}`);
  lines.push("", "Caption:", e.caption ? String(e.caption).slice(0, 8000) : "(no caption could be read)");
  return lines.join("\n");
}

// Everything that comes back gets clamped before it touches the database. The
// schema guarantees SHAPE; it does not guarantee sense — a confidence of 4.2 or
// a 900-character "title" both validate fine.
export function coerceItems(raw, chosenList) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const out = [];
  for (const it of items) {
    const title = String(it?.title || "").trim().slice(0, 200);
    if (!title) continue; // a nameless item is not an item
    const list = LISTS.includes(chosenList) ? chosenList
      : LISTS.includes(it?.list) ? it.list
      : "unsorted";
    let confidence = Number(it?.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.min(1, Math.max(0, confidence));
    const h = it?.search_hints || {};
    out.push({
      list,
      title,
      subtitle: String(it?.subtitle || "").trim().slice(0, 200),
      note: String(it?.note || "").trim().slice(0, 1000),
      confidence,
      search_hints: {
        author: String(h.author || "").trim().slice(0, 120),
        year: String(h.year || "").trim().slice(0, 8),
        city: String(h.city || "").trim().slice(0, 120),
        cuisine: String(h.cuisine || "").trim().slice(0, 120),
      },
    });
  }
  return out.slice(0, 20); // a reel listing 40 books is a reel we mis-parsed
}

let clientPromise = null;
async function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk").then((m) => new m.default());
  }
  return clientPromise;
}

async function callClaude(content) {
  const client = await getClient();
  // Effort `low`: this is short mechanical extraction, not reasoning work.
  // Thinking stays ON — it is the default on Opus 5, and disabling it invites
  // the failure where a tool call is written as plain text instead. max_tokens
  // has headroom because it caps thinking AND output together.
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") return { items: [] };
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); } catch (_) { return { items: [] }; }
}

export async function classifyCaption(envelope, chosenList) {
  if (!envelope?.caption) return [];
  const raw = await callClaude([{ type: "text", text: buildPrompt(envelope, chosenList) }]);
  return coerceItems(raw, chosenList);
}

// The screenshot path — the one that does not depend on Meta's cooperation at
// all. The user screenshots the reel, shares the image, and the model reads the
// caption and any on-screen text straight off the pixels.
export async function classifyImage(imageBase64, mediaType, chosenList) {
  if (!imageBase64) return [];
  const raw = await callClaude([
    { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
    {
      type: "text",
      text: [
        listDirective(chosenList),
        "",
        "This is a screenshot of a social media post. Read the caption, any text",
        "burned into the image, and the location tag if one is visible, then",
        "extract the saveable things exactly as you would from caption text.",
      ].join("\n"),
    },
  ]);
  return coerceItems(raw, chosenList);
}

export async function classifyImageFile(path, mediaType, chosenList) {
  const buf = await readFile(path);
  return classifyImage(buf.toString("base64"), mediaType, chosenList);
}

// ── selftest ─────────────────────────────────────────────────────────────────
// No network. This covers the parts that have actually been wrong in this kind
// of code: the user's list choice being silently overridden, and a well-formed
// response still carrying nonsense values.
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (cond, label, extra) => { if (!cond) { fail++; console.error("FAIL", label, extra ?? ""); } };

  const env = {
    caption: "Best dosa in Peckham — Ganapati.\nFull recipe: https://example.com/dosa",
    authorHandle: "chef_amma", locationTag: "Peckham, London",
    outboundUrls: ["https://example.com/dosa"],
  };
  const p = buildPrompt(env, "restaurants");
  ok(p.includes('MUST use list "restaurants"'), "prompt pins the chosen list");
  ok(p.includes("@chef_amma") && p.includes("Peckham, London"), "prompt carries author + location");
  ok(p.includes("https://example.com/dosa"), "prompt carries outbound link");
  ok(p.trimEnd().endsWith(env.caption), "caption is last, verbatim");
  ok(buildPrompt(env, null).includes("did not pick a list"), "no-choice directive");
  ok(buildPrompt(env, "wine").includes("did not pick a list"), "bogus list falls back, never trusted");

  // The model tries to re-file into movies; the user said restaurants.
  const forced = coerceItems({ items: [{ list: "movies", title: "Ganapati", subtitle: "South Indian", note: "Get the dosa", confidence: 0.9, search_hints: { author: "", year: "", city: "Peckham", cuisine: "South Indian" } }] }, "restaurants");
  ok(forced[0].list === "restaurants", "user's tap overrides the model", forced[0].list);
  ok(forced[0].search_hints.city === "Peckham", "hints survive");

  // No user choice → the model's own answer is accepted.
  ok(coerceItems({ items: [{ list: "movies", title: "Sinners", confidence: 0.8 }] }, null)[0].list === "movies", "model choice honoured when user made none");
  // …unless it is a list that does not exist.
  ok(coerceItems({ items: [{ list: "podcasts", title: "X", confidence: 0.8 }] }, null)[0].list === "unsorted", "unknown list → unsorted");

  ok(coerceItems({ items: [{ title: "  ", confidence: 1 }] }, "books").length === 0, "nameless item dropped");
  ok(coerceItems({ items: [{ title: "A", confidence: 4.2 }] }, "books")[0].confidence === 1, "confidence clamped high");
  ok(coerceItems({ items: [{ title: "A", confidence: -3 }] }, "books")[0].confidence === 0, "confidence clamped low");
  ok(coerceItems({ items: [{ title: "A", confidence: "nope" }] }, "books")[0].confidence === 0, "non-numeric confidence → 0");
  ok(coerceItems({ items: [{ title: "x".repeat(500), confidence: 1 }] }, "books")[0].title.length === 200, "title truncated");
  ok(coerceItems({ items: Array.from({ length: 40 }, (_, i) => ({ title: `B${i}`, confidence: 1 })) }, "books").length === 20, "runaway list capped");
  ok(coerceItems(null, "books").length === 0 && coerceItems({}, "books").length === 0, "garbage in → empty out");
  ok(coerceItems({ items: [{ title: "A", confidence: 0.5 }] }, "books")[0].subtitle === "", "missing optionals become empty strings");

  // Multi-item reels are the whole reason `items` is an array.
  ok(coerceItems({ items: [{ title: "Piranesi", confidence: 0.9 }, { title: "Babel", confidence: 0.8 }] }, "books").length === 2, "multi-item reel");

  ok(SCHEMA.properties.items.items.properties.list.enum.join() === LISTS.join(), "schema enum tracks LISTS");

  console.log(fail ? `selftest FAILED (${fail})` : "classify selftest ok");
  process.exit(fail ? 1 : 0);
}
