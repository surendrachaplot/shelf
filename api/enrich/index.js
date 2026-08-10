// enrich/index.js — turn "Piranesi" into a book with a cover and an author.
//
// Enrichment is BEST EFFORT AND NEVER FATAL. An item that Claude named
// correctly is already useful; a missing cover image is not a reason to send it
// to the Inbox or to fail the ingest. Every enricher returns null on any
// problem and the caller carries on with `enriched: false`.
//
// Google Places is the only metered provider here, so it gets the discipline
// soundcheck learned the expensive way (OPERATIONS.md §10): CACHE THE MISS AS
// WELL AS THE HIT. "Searched, found nothing" costs exactly what a hit costs,
// and not storing it means every retry re-buys the same negative answer.
import { isMain } from "../ismain.js";
import { fetchT, BROWSER_HEADERS } from "../net.js";
import { query, dbReady } from "../db.js";
import { parseLd, extractWebPage } from "../resolve.js";

// ── provider cache ───────────────────────────────────────────────────────────

export const cacheKey = (parts) =>
  parts.map((p) => String(p ?? "").trim().toLowerCase()).filter(Boolean).join("|").slice(0, 400);

async function cacheGet(provider, key) {
  if (!dbReady()) return undefined;
  const r = await query(
    `select found, payload from provider_cache where provider = $1 and cache_key = $2`,
    [provider, key]
  );
  if (!r.rows.length) return undefined;      // never asked
  return r.rows[0].found ? r.rows[0].payload : null; // asked; null = known miss
}

async function cachePut(provider, key, payload) {
  if (!dbReady()) return;
  await query(
    `insert into provider_cache (provider, cache_key, found, payload)
     values ($1, $2, $3, $4)
     on conflict (provider, cache_key) do update
       set found = excluded.found, payload = excluded.payload, created_at = now()`,
    [provider, key, !!payload, payload ? JSON.stringify(payload) : null]
  );
}

// undefined = not cached, null = cached miss, object = cached hit.
async function cached(provider, key, fetcher) {
  const hit = await cacheGet(provider, key);
  if (hit !== undefined) return hit;
  let value = null;
  try { value = await fetcher(); } catch (_) { return null; } // a failure is NOT a cached miss
  await cachePut(provider, key, value);
  return value;
}

const jsonGet = async (url, opts = {}, ms = 10000) => {
  const r = await fetchT(url, { headers: { Accept: "application/json", ...(opts.headers || {}) }, ...opts }, ms);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

// ── books: Open Library (free, no key) ───────────────────────────────────────

export function pickBook(doc) {
  if (!doc) return null;
  return {
    title: doc.title || null,
    subtitle: (doc.author_name && doc.author_name[0]) || "",
    image_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
    canonical: {
      openlibrary_key: doc.key || null,
      isbn: (doc.isbn && doc.isbn[0]) || null,
      year: doc.first_publish_year || null,
      author: (doc.author_name && doc.author_name[0]) || null,
    },
  };
}

export async function enrichBook({ title, search_hints }) {
  const author = search_hints?.author || "";
  const key = cacheKey(["book", title, author]);
  return cached("openlibrary", key, async () => {
    const q = new URLSearchParams({ q: [title, author].filter(Boolean).join(" "), limit: "3" });
    const j = await jsonGet(`https://openlibrary.org/search.json?${q}`);
    return pickBook(j?.docs?.[0]);
  });
}

// ── movies & TV: TMDB (free key) ─────────────────────────────────────────────

export function pickMovie(hit) {
  if (!hit) return null;
  const name = hit.title || hit.name || null;
  if (!name) return null;
  const date = hit.release_date || hit.first_air_date || "";
  return {
    title: name,
    subtitle: date ? date.slice(0, 4) : "",
    image_url: hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : null,
    canonical: { tmdb_id: hit.id || null, media_type: hit.media_type || "movie", year: date.slice(0, 4) || null },
  };
}

export async function enrichMovie({ title, search_hints }) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  const year = search_hints?.year || "";
  return cached("tmdb", cacheKey(["movie", title, year]), async () => {
    const q = new URLSearchParams({ api_key: key, query: title, include_adult: "false" });
    const j = await jsonGet(`https://api.themoviedb.org/3/search/multi?${q}`);
    const hits = (j?.results || []).filter((h) => h.media_type === "movie" || h.media_type === "tv");
    const byYear = year ? hits.find((h) => (h.release_date || h.first_air_date || "").startsWith(year)) : null;
    return pickMovie(byYear || hits[0]);
  });
}

// ── restaurants: Google Places (PAID — the one to watch) ─────────────────────

export function pickPlace(p) {
  if (!p) return null;
  return {
    title: p.displayName?.text || null,
    subtitle: p.formattedAddress || "",
    image_url: null, // Place photos are a second billed call; not worth it yet.
    canonical: {
      place_id: p.id || null,
      address: p.formattedAddress || null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      maps_url: p.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : null,
    },
  };
}

export async function enrichPlace({ title, search_hints }, homeCity) {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return null;
  // The city matters twice: it disambiguates ("Ganapati" exists in several
  // cities) and it is part of the cache key, so the same name in two cities is
  // two questions rather than one wrong answer reused.
  const city = search_hints?.city || homeCity || "";
  const textQuery = [title, city].filter(Boolean).join(" ");
  return cached("places", cacheKey(["place", title, city]), async () => {
    const j = await jsonGet("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 1 }),
    });
    return pickPlace(j?.places?.[0]);
  });
}

// ── recipes: the outbound link, parsed as schema.org ─────────────────────────

export function pickRecipe(node, url) {
  if (!node) return null;
  const img = typeof node.image === "string" ? node.image
    : Array.isArray(node.image) ? (typeof node.image[0] === "string" ? node.image[0] : node.image[0]?.url)
    : node.image?.url || null;
  const ing = node.recipeIngredient || node.ingredients || [];
  return {
    title: node.name || null,
    subtitle: node.recipeYield ? String(node.recipeYield) : "",
    image_url: img || null,
    canonical: {
      recipe_url: url || null,
      ingredients: Array.isArray(ing) ? ing.slice(0, 60) : [],
      total_time: node.totalTime || null,
    },
  };
}

export async function enrichRecipe({ title }, outboundUrls = []) {
  const url = (outboundUrls || []).find((u) => /^https?:\/\//i.test(u));
  if (!url) return null;
  return cached("recipe", cacheKey(["recipe", url]), async () => {
    const r = await fetchT(url, { headers: BROWSER_HEADERS, redirect: "follow" }, 12000);
    const html = await r.text();
    const node = parseLd(html, /recipe/i);
    if (node) return pickRecipe(node, url);
    // No structured recipe — an og: title and image still beat nothing.
    const web = extractWebPage(html, url);
    if (!web.caption) return null;
    return { title: web.caption.split("\n")[0].slice(0, 200) || title, subtitle: "",
             image_url: web.imageUrl, canonical: { recipe_url: url } };
  });
}

// ── dispatch ─────────────────────────────────────────────────────────────────

// Merges provider truth over Claude's reading. The provider wins on title and
// image (it has a catalogue); Claude's `note` always survives, because it is
// the only field that records WHY this was worth saving, and no catalogue knows
// that.
export async function enrich(item, { outboundUrls = [], homeCity = null } = {}) {
  let got = null;
  try {
    if (item.list === "books") got = await enrichBook(item);
    else if (item.list === "movies") got = await enrichMovie(item);
    else if (item.list === "restaurants") got = await enrichPlace(item, homeCity);
    else if (item.list === "recipes") got = await enrichRecipe(item, outboundUrls);
  } catch (_) {
    got = null;
  }
  if (!got || !got.title) return { ...item, enriched: false, canonical: {} };
  return {
    ...item,
    title: got.title,
    subtitle: got.subtitle || item.subtitle || "",
    note: item.note,
    image_url: got.image_url || null,
    canonical: got.canonical || {},
    enriched: true,
  };
}

// ── selftest ─────────────────────────────────────────────────────────────────
// Pure shaping only — no network, no database.
if (isMain(import.meta.url) && process.argv.includes("--selftest")) {
  let fail = 0;
  const ok = (c, l, e) => { if (!c) { fail++; console.error("FAIL", l, e ?? ""); } };

  const b = pickBook({ title: "Piranesi", author_name: ["Susanna Clarke"], cover_i: 123,
                       key: "/works/OL1W", isbn: ["9781635575637"], first_publish_year: 2020 });
  ok(b.title === "Piranesi" && b.subtitle === "Susanna Clarke", "book title + author");
  ok(b.image_url === "https://covers.openlibrary.org/b/id/123-L.jpg", "book cover url", b.image_url);
  ok(b.canonical.isbn === "9781635575637" && b.canonical.year === 2020, "book canonical");
  ok(pickBook({ title: "X" }).image_url === null, "book with no cover is still a book");
  ok(pickBook(null) === null, "no doc → null");

  const m = pickMovie({ id: 7, title: "Sinners", release_date: "2025-04-18", poster_path: "/p.jpg", media_type: "movie" });
  ok(m.subtitle === "2025" && m.canonical.tmdb_id === 7, "movie year + id");
  ok(m.image_url === "https://image.tmdb.org/t/p/w500/p.jpg", "poster url");
  ok(pickMovie({ id: 8, name: "Severance", first_air_date: "2022-02-18", media_type: "tv" }).title === "Severance", "tv uses name/first_air_date");
  ok(pickMovie({ id: 9 }) === null, "nameless hit rejected");

  const p = pickPlace({ id: "pid1", displayName: { text: "Ganapati" }, formattedAddress: "38 Holly Grove, London",
                        location: { latitude: 51.4, longitude: -0.07 } });
  ok(p.title === "Ganapati" && p.canonical.place_id === "pid1", "place name + id");
  ok(p.canonical.lat === 51.4 && p.canonical.lng === -0.07, "place coords");
  ok(p.canonical.maps_url.includes("place_id:pid1"), "maps deep link");

  const r = pickRecipe({ name: "Lemon dal", recipeIngredient: ["1 cup toor dal"], image: ["https://cdn/d.jpg"],
                         recipeYield: "4 servings" }, "https://food.example/dal");
  ok(r.title === "Lemon dal" && r.subtitle === "4 servings", "recipe name + yield");
  ok(r.image_url === "https://cdn/d.jpg" && r.canonical.recipe_url === "https://food.example/dal", "recipe image + url");
  ok(r.canonical.ingredients.length === 1, "ingredients carried");

  ok(cacheKey(["Place", " Ganapati ", "London"]) === "place|ganapati|london", "cache key normalises");
  ok(cacheKey(["book", "X", ""]) === "book|x", "cache key drops empties");
  ok(cacheKey(["place", "A", "London"]) !== cacheKey(["place", "A", "Lisbon"]), "city is part of the key");

  // The merge contract: provider wins on title, Claude's note always survives.
  const merged = await enrich({ list: "unsorted", title: "T", note: "the reason I saved it", subtitle: "" });
  ok(merged.enriched === false && merged.title === "T", "unknown list → passthrough, not an error");
  ok(merged.note === "the reason I saved it", "note survives a failed enrich");

  console.log(fail ? `selftest FAILED (${fail})` : "enrich selftest ok");
  process.exit(fail ? 1 : 0);
}
