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

export const LISTS = ["books", "restaurants", "movies", "recipes", "quotes", "places"];

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

const SYSTEM = `You extract saveable things from social media captions for a personal shelf app with six lists: books, restaurants, movies, recipes, quotes, places.

Return the thing itself, never the post about it. "POV: you finally read the book everyone's talking about 📚 Piranesi by Susanna Clarke" is one item titled "Piranesi", not "POV: you finally read...".

A reel can hold several things — "5 books I read in March" is five items. A reel can also hold none: if the caption is only hashtags, only a handle, or plainly about something that fits no list, return an empty array rather than inventing a title.

Confidence is about the NAME, not your enthusiasm. A caption that names a restaurant and its street gets 0.9. A caption that says "this place is unreal 🤯" with no name gets 0.2 and a title of whatever you can salvage — it will sit unshelved for the user to fix, which is the correct outcome and much better than a confident fabrication.

Never invent an author, year, or address that the caption does not support. An empty hint is useful; a wrong one sends the enrichment step off to fetch the wrong book.

QUOTES. The thing being saved is THE WORDS THEMSELVES. Put the quote in "title", verbatim — the person's actual sentence, not a summary of it and not a label for it. Strip surrounding quotation marks, hashtags, and the "follow for more" tail; keep the wording, the punctuation and the line breaks inside it exactly as written. Put whoever said it in "subtitle" and in search_hints.author. If the caption does not say who said it, leave both empty rather than guessing — a misattributed quote is worse than an unattributed one. A quote with no attribution is still a perfectly good quote.

PLACES. ONE ITEM PER PLACE, not one per reel. "10 things to do in Lisbon" is ten items, each titled with the individual place — the restaurant, the viewpoint, the neighbourhood, the shop — and NOT one item called "Lisbon". Put the city or area in search_hints.city on every one of them, because that is what turns a name into a point on a map. If the reel names a city with no specific places in it, that is one item titled with the city. A place with a name you cannot make out is better dropped than saved as "amazing rooftop bar".

TAGGED ACCOUNTS. Captions very often list things by TAGGING them instead of naming them: "10 lovely bookshops with cafes … Bookshops featured: @backstory.london @funnyweatherbooks @the_bookelephant". Those accounts ARE the list — three items, not one item called "10 lovely bookshops". The handle is the only name you get, so read it as one: @backstory.london is "Backstory", @funnyweatherbooks is "Funny Weather", @the_bookelephant is "The Book Elephant". BUILD THE NAME OUT OF THE LETTERS IN THE HANDLE AND NOTHING ELSE. Split it into words, drop a trailing city, country, "official", "hq" or "shop", and stop: @bookbaruk is "Book Bar", not "Book Bar UK". Do not add a word the handle does not contain, and do not reach for a similar place you happen to know — an exact short name is worth more than a fuller guess, because the map is searched with what you write here. Put the city from the caption in search_hints.city on every one of them — that is what turns a name into a place. Ignore the poster's own account and any account that is plainly a photographer credit, a friend, or a brand doing a giveaway. If a handle yields no plausible name, drop it: an item called "@xyz_92" is worse than nine items instead of ten.

RESTAURANTS vs PLACES: somewhere you would eat, at home, is a restaurant. Somewhere you would go on a trip — including its restaurants — is a place. When the caption is about travelling, prefer places.

THE PICTURE. When a post's image is attached, READ IT — it is evidence, not decoration, and it is very often where the name actually is. A book cover carries the title and the author in print. A film has a poster or a title card. A restaurant has signage over the door, a menu header, a napkin, a shopfront. A recipe has its ingredients burned into the frame. A quote is frequently an image of text with no caption at all.

Take a name you can READ in the picture over a name you inferred from the caption. Printed text on a cover is the strongest evidence available anywhere in a share — stronger than a hashtag, stronger than a handle, stronger than your own knowledge of what the caption is probably about. When the picture and the caption disagree, the picture is describing the thing and the caption is describing the poster's feelings about it.

Do not describe the photograph. "A stack of books on a wooden table" is not an item. If the picture shows things you cannot name, say nothing about them rather than inventing a title from the scenery. Read the words in it; do not narrate it.

If the picture is unreadable, dark, tiny, or shows nothing relevant, ignore it entirely and work from the caption. A post with a useless image is not a post with a useless caption.`;

// The user's tap wins. Stated separately from SYSTEM so it is impossible to
// accidentally drop when the prompt is edited.
function listDirective(chosenList) {
  if (!chosenList || !LISTS.includes(chosenList)) {
    return `The user did not pick a list — choose the best fitting one of: ${LISTS.join(", ")}.`;
  }
  return `The user already filed this under "${chosenList}". Every item you return MUST use list "${chosenList}". Do not re-categorise, even if the caption seems to point elsewhere — they can see the reel and you cannot.`;
}

export function buildPrompt(envelope, chosenList, hasImage = false) {
  const e = envelope || {};
  const lines = [listDirective(chosenList), ""];
  // Said in the user turn as well as SYSTEM, because it is the one fact about
  // THIS request that changes between shares — half of them have a readable
  // cover and half do not, and a model told to read a picture that is not
  // there will describe the caption as though it were one.
  if (hasImage) {
    lines.push("The post's image is attached above. Read any text in it — a cover, a poster,",
               "signage, a menu, on-screen captions — and prefer a name you can read there",
               "over one you inferred from the caption.", "");
  }
  if (e.authorHandle) lines.push(`Posted by: @${e.authorHandle}`);
  if (e.locationTag) lines.push(`Location tag: ${e.locationTag}`);
  if (e.outboundUrls?.length) lines.push(`Links in caption: ${e.outboundUrls.join(" ")}`);
  // There was a block here that listed each tagged @handle with the display
  // name fetched from its profile. The fetch does not work from the server
  // this runs on — 429 to a browser, a login wall to a crawler — so it fed an
  // empty list into a prompt section asking for names, every time. The handles
  // are in the caption below, and SYSTEM now says how to read them.
  lines.push("", "Caption:", e.caption ? String(e.caption).slice(0, 8000)
    : hasImage ? "(no caption — the picture is all there is)"
    : "(no caption could be read)");
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

/**
 * Caption AND cover, in one call.
 *
 * `image` is a content block from frames.js, or null. When it is present the
 * picture goes FIRST: the API's own guidance is that an image placed before
 * the text it relates to reads better, and it matches how a person opens a
 * post — you see it, then you read the caption underneath.
 *
 * A share with an image and no caption is now resolvable, which it was not
 * before: a photograph of a book cover is a book, and `classifyCaption`
 * returned an empty array for it because it checked for caption text first.
 */
export async function classifyShare(envelope, chosenList, image = null) {
  if (!envelope?.caption && !image) return [];
  const content = [];
  if (image) content.push(image);
  content.push({ type: "text", text: buildPrompt(envelope, chosenList, !!image) });
  const raw = await callClaude(content);
  return coerceItems(raw, chosenList);
}

/** The caption-only path, kept so nothing that had it has to change. */
export async function classifyCaption(envelope, chosenList) {
  return classifyShare(envelope, chosenList, null);
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

/**
 * ── THE SECOND PASS: check the name against the world ───────────────────────
 *
 * The first pass reads a caption and a picture. It is very good and it is
 * occasionally, confidently wrong — and a confidently wrong item is the worst
 * output this service produces, because it looks exactly like a correct one.
 * The repo has a scar for it: a caption tagging `@bookbaruk` resolved as "The
 * Book and Record Bar", a real bookshop in West Norwood, with a real address
 * and a real pin, and NOT the shop in the post. Nothing downstream could tell.
 *
 * So anything the first pass is unsure about gets looked up. `web_search` is a
 * SERVER-SIDE tool: Anthropic runs the query and feeds the results back into
 * the same turn, so this is one request, not a client-side search loop.
 *
 * The answer comes back through a CUSTOM TOOL rather than `output_config.format`
 * — structured outputs and citation-bearing search results are documented as
 * incompatible, and a 400 here would take down every share that reached it.
 * A `strict: true` tool schema gets the same validation guarantee by a route
 * that is compatible with server tools.
 *
 * ENTIRELY BEST EFFORT. Every failure — the API rejecting the shape, a search
 * timeout, a model that never calls the tool — returns the unverified items
 * unchanged. This pass can only improve a share or leave it alone; it must
 * never be the reason one fails.
 */

// What counts as "unsure". Deliberately narrow: verifying everything would
// double the cost and latency of shares that were already right.
const THIN = 0.75;

export const needsCheck = (items) =>
  (items || []).filter((it) => (typeof it.confidence === "number" ? it.confidence : 0) < THIN);

const CORRECTIONS_TOOL = {
  name: "corrections",
  description:
    "Report the checked version of each item. Call this exactly once, after searching, with one entry per item you were given — including the ones you did not change.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "title", "subtitle", "confidence", "verdict"],
          properties: {
            index: { type: "integer", description: "The item's index, exactly as given to you." },
            title: { type: "string", description: "The corrected name, or the original if it was right." },
            subtitle: { type: "string", description: "Author, director, city, cuisine — corrected or original. Empty string if still unknown." },
            confidence: { type: "number", description: "0 to 1 AFTER checking. Raise it only if the search confirmed the thing exists with this name." },
            verdict: {
              type: "string",
              enum: ["confirmed", "corrected", "unfound"],
              description: "confirmed: the search found this exact thing. corrected: the search found it under a different name, which you have used. unfound: the search could not confirm it — leave the title alone and lower the confidence.",
            },
          },
        },
      },
    },
  },
};

const VERIFY_SYSTEM = `You check names before they are filed on somebody's shelf.

You are given items extracted from one social media post, each with a list, a title and whatever context the post carried. Some are right. Some are a plausible-looking guess from thin text. Your job is to tell them apart using web search, and to return the checked version of every item you were given.

SEARCH FOR WHAT IS ACTUALLY IN FRONT OF YOU. Search the title together with its context — the city for a place or restaurant, the author for a book, the year for a film. A bare title search returns the most famous thing with that name, which is precisely the failure this step exists to prevent.

A NEAR MATCH IS NOT A MATCH. If you searched for "Book Bar" in London and the results describe "The Book and Record Bar" in West Norwood, that is a DIFFERENT establishment that happens to share two words. Return the original title with verdict "unfound" and a lower confidence. Do not adopt a neighbouring name because it is the closest thing you found — a wrong name that looks right is worse than a thin one that looks thin, because nobody will ever check it again.

Correct only when the search shows the SAME thing under a fuller or more accurate name: a book whose title was abbreviated, a film missing its subtitle, a restaurant whose sign is its trading name. Say what the thing is actually called, not what it is like.

Never invent. If search returns nothing useful, verdict is "unfound", the title stays exactly as given, and the confidence goes down. That is a completely acceptable outcome and much better than a fabrication.`;

/**
 * Look up the thin items and fold any corrections back in.
 * Returns a NEW array; the input is never mutated.
 */
export async function verifyItems(items, envelope = {}, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const thin = needsCheck(list);
  if (!thin.length) return list;

  // Index into the ORIGINAL array, so a correction can be put back exactly
  // where it came from without matching on titles that may have changed.
  const indexed = list.map((it, i) => ({ it, i })).filter(({ it }) => thin.includes(it));

  const brief = indexed.map(({ it, i }) =>
    [`[${i}] list=${it.list}`,
     `    title: ${it.title}`,
     it.subtitle ? `    subtitle: ${it.subtitle}` : null,
     it.search_hints?.city ? `    city: ${it.search_hints.city}` : null,
     it.search_hints?.author ? `    author: ${it.search_hints.author}` : null,
     it.search_hints?.year ? `    year: ${it.search_hints.year}` : null,
    ].filter(Boolean).join("\n")).join("\n\n");

  const prompt = [
    "Check each of these before they are filed. Search for each one, then call the",
    "`corrections` tool exactly once with an entry for every item listed.",
    "",
    brief,
    "",
    envelope.caption ? `For context, the post said:\n${String(envelope.caption).slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const client = await getClient();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: VERIFY_SYSTEM,
      // `high` here, not `low`. This is the judgement call the first pass got
      // wrong — is this the same place or a neighbour with a similar name —
      // and it is worth thinking about properly. It runs on a minority of
      // items, so the cost lands where the doubt is.
      output_config: { effort: "high" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 6 },
        CORRECTIONS_TOOL,
      ],
      messages: [{ role: "user", content: prompt }],
    });
    return applyCorrections(list, res);
  } catch (_) {
    // The check is a bonus. A share that could not be checked is a share that
    // resolves exactly as it did before this function existed.
    return list;
  }
}

/**
 * Fold a `corrections` tool call back into the items. Pure, so the rules that
 * matter — never adopt an unfound name, never let a correction blank a title —
 * are testable without a network.
 */
export function applyCorrections(items, res) {
  const call = (res?.content || []).find((b) => b?.type === "tool_use" && b?.name === "corrections");
  const rows = Array.isArray(call?.input?.items) ? call.input.items : [];
  if (!rows.length) return items;

  const out = items.slice();
  for (const row of rows) {
    const i = Number(row?.index);
    if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
    const verdict = String(row?.verdict || "");
    const conf = typeof row?.confidence === "number" ? Math.max(0, Math.min(1, row.confidence)) : null;
    const before = out[i];

    // A NAME IS ONLY REPLACED WHEN THE SEARCH FOUND THE SAME THING. On
    // "unfound" the title is left exactly as it was and only the confidence
    // moves — that is the whole point of having a third verdict rather than
    // making the model choose between keeping and replacing.
    const title = verdict === "corrected" ? String(row?.title || "").trim() : "";

    out[i] = {
      ...before,
      title: title || before.title,
      subtitle: verdict === "unfound" ? before.subtitle
        : String(row?.subtitle || "").trim() || before.subtitle,
      confidence: conf === null ? before.confidence : conf,
      // Recorded on the item so a wrong shelf entry can be attributed later
      // without re-running anything — the same reason `asked_as` exists.
      checked: verdict || null,
    };
  }
  return out;
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

  // A TAG-LIST POST — a headline and eight usernames, which is what a caption
  // looks like when it lists places by tagging them. Nothing may fetch those
  // profiles: from Render that returns a 429 or a login wall, so the prompt
  // has to carry the instruction to read the handle ITSELF as a name.
  const tagged = buildPrompt({
    caption: "10 lovely bookshops in London\n\nBookshops featured:\n@backstory.london @the_bookelephant",
    authorHandle: "whatshotblog",
  }, "places");
  ok(tagged.includes("@backstory.london"), "the handles reach the model as caption text");
  ok(!/=\s*$|Accounts tagged in the caption/.test(tagged),
     "no empty roster of resolved names — that section fed the model a blank every time");
  ok(SYSTEM.includes("@backstory.london is \"Backstory\""),
     "SYSTEM must show how to read a handle as a name, or a tag-list post yields one item called '10 lovely bookshops'");
  // The name written here is what the map gets searched with, so a fuller
  // guess is worse than an exact short name. (The wrong-bookshop row that
  // looked like a prompt failure was NOT one — measured, and it was the
  // geocoder adopting a near match. The guard for that lives in enrich/.)
  ok(/letters in the handle/i.test(SYSTEM) && /@bookbaruk is "Book Bar"/.test(SYSTEM),
     "SYSTEM must forbid adding words a handle does not contain");

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


  // ── THE PICTURE ────────────────────────────────────────────────────────────
  ok(buildPrompt({ caption: "ugh this one" }, "books", true).includes("image is attached"),
     "with a cover, the prompt says so");
  ok(!buildPrompt({ caption: "ugh this one" }, "books", false).includes("image is attached"),
     "without one it does NOT — a model told to read a picture that is not there narrates the caption instead");
  ok(buildPrompt({ caption: "" }, "books", true).includes("the picture is all there is"),
     "an image with no caption says so rather than 'no caption could be read'");
  ok(SYSTEM.includes("THE PICTURE"), "SYSTEM carries the rule too, so it survives a user-turn edit");

  // ── THE SECOND PASS ────────────────────────────────────────────────────────
  const thin = { list: "places", title: "Book Bar", subtitle: "", confidence: 0.6, search_hints: {} };
  const sure = { list: "books", title: "Piranesi", subtitle: "Susanna Clarke", confidence: 0.95, search_hints: {} };
  ok(needsCheck([thin, sure]).length === 1, "only the unsure item is looked up", needsCheck([thin, sure]).length);
  ok(needsCheck([sure]).length === 0, "a confident item costs nothing");
  ok(needsCheck([{ list: "books", title: "x" }]).length === 1, "a missing confidence counts as unsure");
  ok(needsCheck(null).length === 0 && needsCheck(undefined).length === 0, "and no items is not a crash");

  const call = (items) => ({ content: [{ type: "tool_use", name: "corrections", input: { items } }] });

  // THE SCAR. `@bookbaruk` resolved as "The Book and Record Bar" — a real shop,
  // in the wrong part of London, with a real pin. The whole point of a third
  // verdict is that "I could not confirm this" must not become "here is the
  // nearest thing I found".
  {
    const got = applyCorrections([thin], call([
      { index: 0, title: "The Book and Record Bar", subtitle: "West Norwood", confidence: 0.9, verdict: "unfound" },
    ]));
    ok(got[0].title === "Book Bar", "UNFOUND NEVER RENAMES — the near miss is refused", got[0].title);
    ok(got[0].subtitle === "", "and it does not adopt the near miss's subtitle either", got[0].subtitle);
    ok(got[0].confidence === 0.9, "the confidence the checker reported still applies");
    ok(got[0].checked === "unfound", "and the verdict is recorded on the item");
  }

  {
    const got = applyCorrections([{ ...thin, title: "Piranesi" }], call([
      { index: 0, title: "Piranesi: A Novel", subtitle: "Susanna Clarke", confidence: 0.95, verdict: "corrected" },
    ]));
    ok(got[0].title === "Piranesi: A Novel", "a genuine correction IS taken", got[0].title);
    ok(got[0].subtitle === "Susanna Clarke", "with its subtitle");
  }

  ok(applyCorrections([thin], call([{ index: 0, title: "", subtitle: "", confidence: 0.9, verdict: "corrected" }]))[0].title === "Book Bar",
     "a correction that blanks the title is refused — an empty name is not an improvement");
  ok(applyCorrections([thin], call([{ index: 0, title: "X", subtitle: "", confidence: 5, verdict: "corrected" }]))[0].confidence === 1,
     "confidence is clamped, same as the first pass");
  ok(applyCorrections([thin], call([{ index: 9, title: "X", subtitle: "", confidence: 0.9, verdict: "corrected" }]))[0].title === "Book Bar",
     "an index that is not in the list is ignored rather than throwing");
  ok(applyCorrections([thin], { content: [{ type: "text", text: "I could not check these." }] })[0].title === "Book Bar",
     "a turn with NO tool call leaves everything alone — the model declining to answer is not a correction");
  ok(applyCorrections([thin], null)[0].title === "Book Bar", "and neither is a missing response");
  {
    const original = [thin];
    applyCorrections(original, call([{ index: 0, title: "Y", subtitle: "", confidence: 0.9, verdict: "corrected" }]));
    ok(original[0].title === "Book Bar", "the input array is never mutated");
  }

  ok(CORRECTIONS_TOOL.strict === true, "the corrections tool is strict — the schema is enforced at the API layer");
  ok(CORRECTIONS_TOOL.input_schema.properties.items.items.properties.verdict.enum.includes("unfound"),
     "and 'unfound' is one of the three answers it can give");

  console.log(fail ? `selftest FAILED (${fail})` : "classify selftest ok");
  process.exit(fail ? 1 : 0);
}
