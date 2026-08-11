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
  const author = (doc.author_name && doc.author_name[0]) || null;
  // `first_sentence` is Open Library's oddest and best field: an actual line
  // of the book. It tells you more about whether you want to read it than any
  // blurb, and no other free catalogue has it.
  const opener = Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : doc.first_sentence || null;
  return {
    title: doc.title || null,
    subtitle: author || "",
    image_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
    canonical: {
      openlibrary_key: doc.key || null,
      isbn: (doc.isbn && doc.isbn[0]) || null,
      year: doc.first_publish_year || null,
      author,
      pages: doc.number_of_pages_median || null,
      // Deduplicated and trimmed: Open Library subjects run to hundreds of
      // near-identical strings and three good ones are a shelf label.
      subjects: [...new Set((doc.subject || []).map((s) => String(s).trim()))].slice(0, 3),
      rating: typeof doc.ratings_average === "number" ? Math.round(doc.ratings_average * 10) / 10 : null,
      first_sentence: opener ? String(opener).slice(0, 300) : null,
      read_url: doc.key ? `https://openlibrary.org${doc.key}` : null,
    },
  };
}

export async function enrichBook({ title, search_hints }) {
  const author = search_hints?.author || "";
  const key = cacheKey(["book", title, author]);
  return cached("openlibrary", key, async () => {
    // `fields` is not an optimisation — the default response omits pages,
    // subjects, ratings and first_sentence entirely, so without it there is
    // nothing to enrich WITH.
    const q = new URLSearchParams({
      q: [title, author].filter(Boolean).join(" "),
      limit: "3",
      fields: "key,title,author_name,cover_i,isbn,first_publish_year,number_of_pages_median,subject,ratings_average,first_sentence",
    });
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

// Where "is it streaming" gets answered from. TMDB's provider data is
// per-region and there is no sensible global answer — a UK subscriber does not
// care what is on Hulu. One variable with one default beats a silent US
// assumption nobody notices until the line is wrong.
const REGION = (process.env.SHELF_REGION || "GB").toUpperCase();

/**
 * Everything worth knowing about a film, from ONE extra request.
 *
 * `append_to_response` is what makes this affordable: videos, credits and
 * watch-providers arrive in the same round trip as the details, so a rich
 * entry costs two TMDB calls rather than five.
 *
 * The trailer is the point of all this. A poster tells you which film it is; a
 * trailer is what you actually want at 11pm deciding what to watch. Official
 * trailers first, then any trailer, then a teaser — a teaser beats a dead
 * button.
 */
export function pickMovieDetail(base, d, region = REGION) {
  if (!base) return null;
  if (!d) return base;

  const vids = (d.videos?.results || []).filter((v) => v.site === "YouTube");
  const trailer =
    vids.find((v) => v.type === "Trailer" && v.official) ||
    vids.find((v) => v.type === "Trailer") ||
    vids.find((v) => v.type === "Teaser") ||
    vids[0] || null;

  const crew = d.credits?.crew || [];
  const director = crew.find((c) => c.job === "Director")?.name
    || (d.created_by || []).map((c) => c.name)[0]   // a series has no director, it has a creator
    || null;

  const runtime = d.runtime || (Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : null) || null;
  const providers = d["watch/providers"]?.results?.[region];

  return {
    ...base,
    // The director goes in the subtitle, where a bare year was doing very
    // little work.
    subtitle: [director, base.canonical?.year].filter(Boolean).join(" · ") || base.subtitle,
    image_url: base.image_url || (d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null),
    canonical: {
      ...base.canonical,
      director,
      runtime_min: runtime,
      genres: (d.genres || []).map((g) => g.name).slice(0, 3),
      rating: typeof d.vote_average === "number" && d.vote_average > 0 ? Math.round(d.vote_average * 10) / 10 : null,
      overview: d.overview ? String(d.overview).slice(0, 600) : null,
      cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
      trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
      backdrop_url: d.backdrop_path ? `https://image.tmdb.org/t/p/w780${d.backdrop_path}` : null,
      // SUBSCRIPTION ONLY. "Rent for £3.49" is a different answer from "it is
      // on a subscription you already pay for", and merging them makes the
      // whole line untrustworthy.
      streaming: (providers?.flatrate || []).map((p) => p.provider_name).slice(0, 4),
      watch_url: providers?.link || null,
      region,
    },
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
    const base = pickMovie(byYear || hits[0]);
    if (!base?.canonical?.tmdb_id) return base;

    // The details call is allowed to fail on its own. A poster and a year is
    // already a good entry; losing it because a trailer lookup 500'd would be
    // trading the meal for the garnish.
    try {
      const kind = base.canonical.media_type === "tv" ? "tv" : "movie";
      const dq = new URLSearchParams({ api_key: key, append_to_response: "videos,credits,watch/providers" });
      const d = await jsonGet(`https://api.themoviedb.org/3/${kind}/${base.canonical.tmdb_id}?${dq}`);
      return pickMovieDetail(base, d);
    } catch (_) {
      return base;
    }
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

/**
 * OpenStreetMap, via Nominatim. FREE, NO KEY, NO CARD, and it is the reason a
 * restaurant no longer needs a billing account to get an address.
 *
 * `extratags=1` is what makes it competitive rather than merely free: for a
 * well-mapped restaurant OSM carries website, phone, opening hours and cuisine
 * — things Google charges a second billed call for.
 *
 * Its usage policy is a real constraint and it is honoured here: a genuine
 * identifying User-Agent, one result, and the provider cache in front of it so
 * the same restaurant is asked about exactly once, ever. Heavy automated use
 * gets an IP banned, and rightly.
 */
// OSM tags are lowercase machine values — `coffee_shop`, `british`. Rendering
// them raw puts "british" in the middle of a sentence-cased table, which reads
// as a data leak rather than a design.
const humanTag = (s) =>
  String(s || "").replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());

export function pickOsmPlace(p) {
  if (!p) return null;
  const name = p.namedetails?.name || (p.display_name || "").split(",")[0] || null;
  if (!name) return null;
  const x = p.extratags || {};
  const a = p.address || {};
  const area = a.suburb || a.neighbourhood || a.city_district || a.town || a.city || a.village || null;
  return {
    title: name,
    // The neighbourhood, not the full postal address: "Peckham" is what tells
    // you whether you can go tonight. The address is kept below for the map.
    subtitle: [x.cuisine ? humanTag(x.cuisine.split(";")[0]) : null, area].filter(Boolean).join(" · "),
    image_url: null,
    canonical: {
      osm_type: p.osm_type || null,
      osm_id: p.osm_id || null,
      address: p.display_name || null,
      area,
      lat: p.lat ? Number(p.lat) : null,
      lng: p.lon ? Number(p.lon) : null,
      website: x.website || x["contact:website"] || null,
      phone: x.phone || x["contact:phone"] || null,
      opening_hours: x.opening_hours || null,
      cuisine: x.cuisine ? x.cuisine.split(";").map(humanTag).slice(0, 3) : [],
      // A geo: URI opens whatever map app the phone actually uses, rather than
      // deciding on somebody's behalf that they want Google Maps.
      map_url: p.lat && p.lon ? `geo:${p.lat},${p.lon}?q=${encodeURIComponent(name)}` : null,
      osm_url: p.osm_type && p.osm_id ? `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` : null,
      source: "openstreetmap",
    },
  };
}

// Identifying and contactable, as Nominatim's policy requires. An anonymous
// scraper UA is how a shared service gets an IP blocked for everybody.
const OSM_UA = process.env.SHELF_OSM_UA
  || "shelf/0.1 (personal shelf app; +https://github.com/surendrachaplot/shelf)";

async function osmPlace(title, city) {
  const q = new URLSearchParams({
    q: [title, city].filter(Boolean).join(" "),
    format: "jsonv2", limit: "1", addressdetails: "1", extratags: "1", namedetails: "1",
  });
  const j = await jsonGet(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "User-Agent": OSM_UA },
  });
  return pickOsmPlace(Array.isArray(j) ? j[0] : null);
}

async function googlePlace(key, title, city) {
  const j = await jsonGet("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: [title, city].filter(Boolean).join(" "), maxResultCount: 1 }),
  });
  return pickPlace(j?.places?.[0]);
}

export async function enrichPlace({ title, search_hints }, homeCity) {
  // The city matters twice: it disambiguates ("Ganapati" exists in several
  // cities) and it is part of the cache key, so the same name in two cities is
  // two questions rather than one wrong answer reused.
  const city = search_hints?.city || homeCity || "";
  const gkey = process.env.GOOGLE_PLACES_KEY;

  // OSM FIRST, deliberately. It is free and unmetered, so a restaurant costs
  // nothing to look up, and Google is only consulted for what OSM could not
  // answer. The previous order had no fallback at all: without a billing
  // account, every restaurant filed with no address whatsoever.
  return cached("place", cacheKey(["place", title, city, gkey ? "g" : "osm"]), async () => {
    const osm = await osmPlace(title, city).catch(() => null);
    if (osm) return osm;
    if (gkey) return googlePlace(gkey, title, city).catch(() => null);
    return null;
  });
}

// ── recipes: the outbound link, parsed as schema.org ─────────────────────────

/**
 * ISO 8601 durations, because that is what schema.org uses and "PT1H30M" on a
 * recipe card is a bug you can see from across the room.
 */
export function humanDuration(iso) {
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?/.exec(String(iso || ""));
  if (!m) return null;
  const mins = Math.round((Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0));
  if (!mins) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), r = mins % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function pickRecipe(node, url) {
  if (!node) return null;
  const img = typeof node.image === "string" ? node.image
    : Array.isArray(node.image) ? (typeof node.image[0] === "string" ? node.image[0] : node.image[0]?.url)
    : node.image?.url || null;
  const ing = node.recipeIngredient || node.ingredients || [];
  const time = humanDuration(node.totalTime)
    || humanDuration(node.cookTime)
    || humanDuration(node.prepTime);
  const steps = node.recipeInstructions;
  const author = typeof node.author === "string" ? node.author
    : Array.isArray(node.author) ? node.author[0]?.name : node.author?.name || null;
  const yieldText = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;

  return {
    title: node.name || null,
    // Time first: it is the field that decides whether you cook this tonight.
    subtitle: [time, yieldText ? String(yieldText) : null].filter(Boolean).join(" · "),
    image_url: img || null,
    canonical: {
      recipe_url: url || null,
      ingredients: Array.isArray(ing) ? ing.slice(0, 60) : [],
      total_time: time,
      serves: yieldText ? String(yieldText).slice(0, 40) : null,
      // A count, not the text. Twelve steps and three steps are different
      // weeknight decisions, and the full method belongs on the source site.
      steps: Array.isArray(steps) ? steps.length : null,
      author: author ? String(author).slice(0, 80) : null,
      rating: Number(node.aggregateRating?.ratingValue) || null,
      calories: node.nutrition?.calories ? String(node.nutrition.calories).slice(0, 24) : null,
      cuisine: node.recipeCuisine ? String(Array.isArray(node.recipeCuisine) ? node.recipeCuisine[0] : node.recipeCuisine).slice(0, 40) : null,
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
                         recipeYield: "4 servings", totalTime: "PT45M",
                         recipeInstructions: [{}, {}, {}], author: { name: "Meera" },
                         aggregateRating: { ratingValue: "4.6" }, nutrition: { calories: "320 kcal" } },
                       "https://food.example/dal");
  ok(r.title === "Lemon dal" && r.subtitle === "45 min · 4 servings", "recipe time before yield", r.subtitle);
  ok(r.image_url === "https://cdn/d.jpg" && r.canonical.recipe_url === "https://food.example/dal", "recipe image + url");
  ok(r.canonical.ingredients.length === 1, "ingredients carried");
  ok(r.canonical.steps === 3 && r.canonical.author === "Meera", "step count + author");
  ok(r.canonical.rating === 4.6 && r.canonical.calories === "320 kcal", "rating + calories");

  // ISO 8601 durations, which is what a recipe card would otherwise print raw.
  ok(humanDuration("PT45M") === "45 min", "minutes", humanDuration("PT45M"));
  ok(humanDuration("PT1H30M") === "1h 30m", "hours and minutes", humanDuration("PT1H30M"));
  ok(humanDuration("PT2H") === "2h", "whole hours", humanDuration("PT2H"));
  // Exactly one right answer. An assertion that accepts two is not a test —
  // it passes whichever way the code happens to behave.
  ok(humanDuration("P1DT2H") === "26h", "a day folds into hours (overnight proving)", humanDuration("P1DT2H"));
  ok(humanDuration("") === null && humanDuration(null) === null && humanDuration("PT0M") === null, "no duration → null, never '0 min'");

  // The rich film fields, from the shape TMDB actually returns.
  const md = pickMovieDetail(
    { title: "Sinners", subtitle: "2025", image_url: null, canonical: { tmdb_id: 7, media_type: "movie", year: "2025" } },
    {
      runtime: 137, vote_average: 7.62, overview: "A story.",
      genres: [{ name: "Horror" }, { name: "Thriller" }],
      poster_path: "/p.jpg", backdrop_path: "/b.jpg",
      videos: { results: [
        { site: "YouTube", type: "Teaser", key: "teaser1" },
        { site: "Vimeo", type: "Trailer", key: "nope", official: true },
        { site: "YouTube", type: "Trailer", key: "official1", official: true },
      ] },
      credits: { crew: [{ job: "Editor", name: "X" }, { job: "Director", name: "Ryan Coogler" }],
                 cast: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }] },
      "watch/providers": { results: { GB: { link: "https://tmdb/watch", flatrate: [{ provider_name: "Mubi" }] },
                                      US: { flatrate: [{ provider_name: "Hulu" }] } } },
    }, "GB");
  ok(md.canonical.trailer_url === "https://www.youtube.com/watch?v=official1", "official YouTube trailer wins over a teaser and over Vimeo", md.canonical.trailer_url);
  ok(md.canonical.director === "Ryan Coogler" && md.subtitle === "Ryan Coogler · 2025", "director found and put in the subtitle", md.subtitle);
  ok(md.canonical.runtime_min === 137 && md.canonical.rating === 7.6, "runtime + rating rounded to one place");
  ok(md.canonical.cast.length === 4, "cast capped at four");
  ok(md.canonical.streaming[0] === "Mubi", "the region's providers, not another region's", JSON.stringify(md.canonical.streaming));
  ok(md.image_url === "https://image.tmdb.org/t/p/w500/p.jpg", "poster filled in from the details call");
  ok(pickMovieDetail({ title: "T", canonical: {} }, null).title === "T", "no details → the base entry survives");

  const tv = pickMovieDetail({ title: "Severance", canonical: { media_type: "tv", year: "2022" } },
    { episode_run_time: [45], created_by: [{ name: "Dan Erickson" }], credits: {}, genres: [] }, "GB");
  ok(tv.canonical.director === "Dan Erickson" && tv.canonical.runtime_min === 45, "a series has a creator and an episode length");

  // Rent-only must NOT read as "you can watch this".
  const rentOnly = pickMovieDetail({ title: "T", canonical: {} },
    { "watch/providers": { results: { GB: { rent: [{ provider_name: "Apple TV" }] } } } }, "GB");
  ok(rentOnly.canonical.streaming.length === 0, "rent-only is not streaming");

  const osm = pickOsmPlace({
    display_name: "Multi Story, 95A Rye Lane, Peckham, London, SE15 4ST",
    namedetails: { name: "Multi Story" }, osm_type: "node", osm_id: 42, lat: "51.47", lon: "-0.07",
    address: { suburb: "Peckham", city: "London" },
    extratags: { cuisine: "coffee_shop;brunch", website: "https://multi.story", phone: "+44 20", opening_hours: "Mo-Su 08:00-16:00" },
  });
  ok(osm.title === "Multi Story" && osm.subtitle === "Coffee shop · Peckham", "osm tags are humanised, not raw machine values", osm.subtitle);
  ok(osm.canonical.cuisine[0] === "Coffee shop" && osm.canonical.cuisine[1] === "Brunch", "every cuisine tag humanised", JSON.stringify(osm.canonical.cuisine));
  ok(osm.canonical.website === "https://multi.story" && osm.canonical.opening_hours === "Mo-Su 08:00-16:00", "osm contact details");
  ok(osm.canonical.map_url.startsWith("geo:51.47,-0.07"), "geo: uri opens the phone's own map app", osm.canonical.map_url);
  ok(osm.canonical.osm_url === "https://www.openstreetmap.org/node/42", "osm permalink");
  ok(pickOsmPlace({ display_name: "", namedetails: {} }) === null, "a nameless osm result is not a place");

  const b2 = pickBook({ title: "P", author_name: ["S"], number_of_pages_median: 245,
                        subject: ["Fantasy", "Fantasy", " Labyrinths "], ratings_average: 4.31,
                        first_sentence: ["When the moon rose."], key: "/works/OL1W" });
  ok(b2.canonical.pages === 245 && b2.canonical.rating === 4.3, "pages + rounded rating");
  ok(b2.canonical.subjects.length === 2, "subjects deduplicated and trimmed", JSON.stringify(b2.canonical.subjects));
  ok(b2.canonical.first_sentence === "When the moon rose.", "the opening line survives");

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
