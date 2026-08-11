// Fixtures and platform stubs for the preview harness. The COMPONENTS are the
// real ones — only the network and the four native modules are faked, because
// a browser has no Keychain and no share sheet. Everything visual (styles,
// layout, palette, springs) is exactly what ships.
export const LISTS = ["books", "restaurants", "movies", "recipes"];

const ITEMS = [
  { id: "1", list: "books", status: "filed", title: "Piranesi", subtitle: "Susanna Clarke",
    note: "The one everyone in my feed could not shut up about", image_url: null,
    canonical: {}, confidence: 0.94, source_url: "x", enriched: true, created_at: "" },
  { id: "2", list: "books", status: "filed", title: "Babel, or the Necessity of Violence: An Arcane History of the Oxford Translators' Revolution",
    subtitle: "R.F. Kuang", note: "", image_url: "https://broken.invalid/cover.jpg",
    canonical: {}, confidence: 0.88, source_url: "x", enriched: true, created_at: "" },
  { id: "3", list: "restaurants", status: "needs_review", title: "Ganapati", subtitle: "38 Holly Grove, Peckham, London SE15 5DF",
    note: "Get the dosa. Go early, they don't take bookings after 7", image_url: null,
    canonical: {}, confidence: 0.42, source_url: "x", enriched: false, created_at: "" },
  { id: "4", list: "unsorted", status: "pending", title: null, subtitle: null, note: null,
    image_url: null, canonical: {}, confidence: null, source_url: "x", enriched: false, created_at: "" },
  // The state this app was actually in when it was reported broken: Instagram
  // handed the server nothing, so the item has a link, a list and no name. If
  // it is not in the fixtures it is not on the contact sheet, and it was the
  // single most common row on the real device.
  { id: "5", list: "unsorted", status: "needs_review", title: null, subtitle: null, note: null,
    image_url: null, canonical: {}, confidence: null,
    source_url: "https://www.instagram.com/reel/DAbCdEf/", enriched: false, created_at: "",
    resolver: "none", attempts: 1, last_error: null, had_caption: false },
].map((x) => ({ resolver: "embed-json", attempts: 1, last_error: null, had_caption: true, ...x }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const fetchInbox = async () => { await wait(60); return ITEMS.filter((i) => i.status !== "filed"); };
const art = (bg, fg, txt) => "data:image/svg+xml;base64," + btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${bg}"/>` +
  `<circle cx="100" cy="118" r="52" fill="none" stroke="${fg}" stroke-width="6"/>` +
  `<text x="100" y="250" font-family="Helvetica" font-size="22" font-weight="bold" fill="${fg}" text-anchor="middle">${txt}</text></svg>`);
const ART = { Piranesi: art("#101010", "#F5C542", "PIRANESI"), Sinners: art("#2A0A0A", "#FF6B4A", "SINNERS"), Babel: art("#0E2A4A", "#FFFFFF", "BABEL") };

// Rich canonical data, so the facts block is actually LOOKED AT rather than
// assumed. Without a fixture carrying a trailer and a runtime, that whole
// panel renders empty in every screenshot and ships unseen.
const RICH = {
  Sinners: { tmdb_id: 7, media_type: "movie", year: "2025", director: "Ryan Coogler",
    runtime_min: 137, genres: ["Horror", "Thriller"], rating: 7.6,
    overview: "Two brothers return to their home town to start again, and find something far older waiting for them.",
    cast: ["Michael B. Jordan", "Hailee Steinfeld", "Delroy Lindo", "Jack O'Connell"],
    trailer_url: "https://www.youtube.com/watch?v=x", watch_url: "https://www.themoviedb.org/movie/7/watch",
    streaming: ["Mubi"], region: "GB" },
  Piranesi: { openlibrary_key: "/works/OL1W", isbn: "9781635575637", year: 2020,
    author: "Susanna Clarke", pages: 245, subjects: ["Fantasy", "Labyrinths"], rating: 4.3,
    first_sentence: "When the Moon rose in the Third Northern Hall I went to the Ninth Vestibule.",
    read_url: "https://openlibrary.org/works/OL1W" },
  "St. John": { osm_type: "node", osm_id: 42, address: "26 St John Street, Farringdon, London EC1M 4AY",
    area: "Farringdon", lat: 51.52, lng: -0.1, website: "https://stjohnrestaurant.com",
    phone: "+44 20 7251 0848", opening_hours: "Mo-Sa 12:00-23:00", cuisine: ["british"],
    map_url: "geo:51.52,-0.1?q=St.%20John", osm_url: "https://www.openstreetmap.org/node/42",
    source: "openstreetmap" },
  "Lemon dal": { recipe_url: "https://food.example/dal", ingredients: ["1 cup toor dal", "2 lemons", "curry leaves"],
    total_time: "45 min", serves: "4", steps: 6, author: "Meera Sodha", calories: "320 kcal" },
};

const SHELVED = {
  books: ["Piranesi", "Babel", "The Dispossessed", "Solenoid", "Checkout 19"],
  restaurants: ["Ganapati", "Kiln", "St. John", "Mangal II", "Brutto", "Toklas"],
  movies: ["Sinners", "Petrol", "La Chimera"],
  recipes: ["Lemon dal", "Cacio e pepe", "Pot-au-feu", "Miso cod"],
};
export const fetchList = async (l) => {
  await wait(60);
  return (SHELVED[l] ?? []).map((title, i) => ({
    id: `${l}-${i}`, list: l, status: "filed", title,
    // The subtitle the enricher would really produce: a director and a year,
    // not an empty string. A fixture thinner than production hides exactly the
    // wrapping problems the harness exists to find.
    subtitle: (RICH[title] && (l === "movies"
      ? [RICH[title].director, RICH[title].year].filter(Boolean).join(" · ")
      : l === "recipes" ? [RICH[title].total_time, RICH[title].serves].filter(Boolean).join(" · ") : null))
      || (l === "books" ? "Susanna Clarke" : l === "restaurants" ? "Peckham" : ""),
    note: "", image_url: ART[title] ?? null, canonical: RICH[title] ?? {}, confidence: 0.9, source_url: "x", enriched: true, created_at: "",
  }));
};
export const updateItem = async () => ({ item: {} });
export const retryItem = async () => ({ item: { id: "5", status: "pending" } });
export const ingestUrl = async () => { await wait(140); return { id: "1" }; };
export const ingestImage = async () => ({ id: "1" });
export const NOT_PAIRED = "not paired";
export const queueShare = async () => true;
export const flushQueue = async () => 0;
export const pair = async () => "shelf_preview";
// ?unclaimed=1 renders the first-run screen, which is otherwise only reachable
// against a server nobody has ever paired with. ?asleep=1 makes this throw for
// ever, which is how you look at the "waking the server" copy — the state that
// shipped as an indefinite spinner indistinguishable from the splash screen.
export const serverState = async () => {
  if (new URLSearchParams(location.search).get("asleep") === "1") {
    await wait(200);
    throw new Error("aborted");
  }
  return { unclaimed: new URLSearchParams(location.search).get("unclaimed") === "1" };
};
export const claim = async () => "shelf_preview";
export const pendingShareCount = async () => 0;
export const API_BASE = "";

// ── profile, sharing, search ─────────────────────────────────────────────────
// The fixtures carry the states that are HARD to get to on a live server and
// easy to get wrong: a profile with no handle yet, a link nobody has opened, a
// provider that is switched off, and a result whose artwork 404s.
export const SHARE_BASE = "https://shelf.club";
export const shareUrl = (code) => `${SHARE_BASE}/s/${code}`;
export const profileUrl = (h) => `${SHARE_BASE}/@${h}`;

const blank = new URLSearchParams(location.search).get("blankProfile") === "1";
let PROFILE = blank
  ? { profile: null, needs_handle: true, public_shelves: false, counts: {} }
  : {
      profile: {
        handle: "suren", display_name: "Suren Chaplot",
        bio: "Mostly things I saw at 1am and could not stop thinking about. Peckham, mostly.",
        plate_seed: "suren", since: "2026-03-02T00:00:00Z",
      },
      needs_handle: false, public_shelves: false,
      counts: { books: 5, restaurants: 6, movies: 3, recipes: 4 },
    };

export const getProfile = async () => { await wait(40); return PROFILE; };
export const saveProfile = async (patch) => {
  await wait(60);
  PROFILE = {
    ...PROFILE, needs_handle: false,
    profile: { ...(PROFILE.profile ?? { since: new Date().toISOString() }), ...patch, plate_seed: PROFILE.profile?.plate_seed ?? patch.handle },
  };
  return PROFILE;
};

let SHARES = [
  { code: "k3f9xqm2", kind: "shelf", target: "restaurants", note: null, views: 12 },
  { code: "b7ttpzc4", kind: "item", target: "i_1", note: null, views: 0 },
];
export const listShares = async () => { await wait(40); return SHARES; };
export const makeShare = async (kind, target) => {
  await wait(120);
  const code = "n9wqk2ff";
  SHARES = [{ code, kind, target: target ?? null, note: null, views: 0 }, ...SHARES.filter((x) => x.code !== code)];
  return { share: SHARES[0], handle: "suren" };
};
export const revokeShare = async (code) => { SHARES = SHARES.filter((x) => x.code !== code); return { revoked: true }; };
export const sendTo = async (to) => { await wait(200); return { sent_to: to, code: "n9wqk2ff", duplicate: false }; };

export const listReceived = async () => {
  await wait(40);
  return [
    { id: "sn_1", note: "The dosa place I keep going on about.", created_at: "", code: "aaa",
      from_handle: "nadia", from_name: "Nadia Rahman", from_seed: "nadia", kind: "item", target: "i_9" },
    { id: "sn_2", note: null, created_at: "", code: "bbb",
      from_handle: "tom", from_name: null, from_seed: "tom", kind: "shelf", target: "movies" },
  ];
};
export const actOnSend = async () => ({ copied: 1 });

const HITS = [
  { list: "books", key: "books:/works/OL1W", title: "Piranesi", subtitle: "Susanna Clarke · 2020",
    image_url: ART.Piranesi, canonical: { key: "books:/works/OL1W" }, provider: "Open Library" },
  { list: "restaurants", key: "restaurants:p1", title: "Ganapati", subtitle: "38 Holly Grove, Peckham",
    image_url: null, canonical: { key: "restaurants:p1" }, provider: "Google Places" },
  { list: "books", key: "books:/works/OL2W", title: "Piranesi's Prisons", subtitle: "Giovanni Battista Piranesi · 1750",
    image_url: "https://broken.invalid/cover.jpg", canonical: { key: "books:/works/OL2W" }, provider: "Open Library" },
  { list: "restaurants", key: "restaurants:p2", title: "Piranesi Bar", subtitle: "Rome",
    image_url: null, canonical: { key: "restaurants:p2" }, provider: "Google Places" },
];
export const search = async (q) => {
  await wait(180);
  if (!q || q.trim().length < 2) return { results: [], unavailable: [] };
  if (/^https?:/i.test(q)) {
    return { results: [{ list: "recipes", key: "recipes:x", title: "Lemon dal", subtitle: "40 min", image_url: null, canonical: {}, provider: "the page itself" }], unavailable: [], mode: "url" };
  }
  return {
    results: HITS.filter((h) => h.title.toLowerCase().includes(q.toLowerCase().slice(0, 4))),
    // The state that only exists when nobody has set a key. It has to be
    // visible in a screenshot or the sentence never gets designed.
    unavailable: [{ list: "movies", provider: "TMDB" }],
  };
};
export const addItem = async (hit) => { await wait(120); return { item: { ...hit, id: "new", status: "filed" } }; };
