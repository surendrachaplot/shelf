// storeStub.js — the on-device shelf, in memory, with real fixtures.
//
// `store.ts` writes a JSON file to the app's documents directory. A browser has
// neither, so the harness swaps this in: the SAME shape and the same pure
// operations, holding items rich enough that every panel has something to draw.
// A fixture thinner than production hides exactly the defects the harness
// exists to find.
const art = (bg, fg, txt) => "data:image/svg+xml;base64," + btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${bg}"/>` +
  `<circle cx="100" cy="118" r="52" fill="none" stroke="${fg}" stroke-width="6"/>` +
  `<text x="100" y="250" font-family="Helvetica" font-size="22" font-weight="bold" fill="${fg}" text-anchor="middle">${txt}</text></svg>`);
const ART = { Piranesi: art("#101010", "#F5C542", "PIRANESI"), Sinners: art("#2A0A0A", "#FF6B4A", "SINNERS"), Babel: art("#0E2A4A", "#FFFFFF", "BABEL") };

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

const mk = (list, title, i) => ({
  id: `${list}-${i}`, list, status: "filed", title,
  subtitle: (RICH[title] && (list === "movies"
    ? [RICH[title].director, RICH[title].year].filter(Boolean).join(" · ")
    : list === "recipes" ? [RICH[title].total_time, RICH[title].serves].filter(Boolean).join(" · ") : null))
    || (list === "books" ? "Susanna Clarke" : list === "restaurants" ? "Peckham" : ""),
  note: "", image_url: ART[title] ?? null, canonical: RICH[title] ?? {},
  confidence: 0.9, enriched: true, source_url: "https://insta/x", resolver: "crawler-embed-html",
  created_at: "2026-08-01T00:00:00Z",
});

const PILE = [
  { id: "p1", list: "restaurants", status: "filed", title: "Ganapati",
    subtitle: "38 Holly Grove, Peckham", note: "Get the dosa. Go early, they don't take bookings after 7",
    image_url: null, canonical: {}, confidence: 0.42, enriched: false,
    source_url: "https://insta/x", resolver: "crawler-embed-html", created_at: "" },
  { id: "p2", list: "unsorted", status: "pending", title: null, subtitle: "", note: "",
    image_url: null, canonical: {}, confidence: null, enriched: false,
    source_url: "https://insta/y", resolver: null, created_at: "" },
  // The row that was actually on the phone when it was reported broken: read,
  // and nothing nameable came back.
  { id: "p3", list: "unsorted", status: "unread", title: null, subtitle: "", note: "",
    image_url: null, canonical: {}, confidence: null, enriched: false,
    source_url: "https://www.instagram.com/reel/DAbCdEf/", resolver: "none", created_at: "" },
];

const blank = new URLSearchParams(location.search).get("blankProfile") === "1";

let SHELF = {
  version: 1,
  items: [
    ...PILE,
    ...Object.entries(SHELVED).flatMap(([list, titles]) => titles.map((t, i) => mk(list, t, i))),
  ],
  profile: blank
    ? { name: "", bio: "", seed: "", home_city: "" }
    : { name: "Suren Chaplot", bio: "Mostly things I saw at 1am and could not stop thinking about. Peckham, mostly.",
        seed: "suren", home_city: "London" },
  links: blank ? [] : [
    { code: "k3f9xqm2", kind: "shelf", target: "restaurants", title: "Your restaurants shelf", at: "" },
    { code: "b7ttpzc4", kind: "item", target: null, title: "St. John", at: "" },
  ],
};

export const emptyShelf = () => ({ version: 1, items: [], profile: { name: "", bio: "", seed: "", home_city: "" }, links: [] });
export const load = async () => SHELF;
export const save = async (next) => { SHELF = next; };

export function idFor(seed) {
  if (!seed) return "i_" + Math.random().toString(36).slice(2, 12);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2654435761) >>> 0;
  }
  return "i_" + h1.toString(36) + h2.toString(36);
}

export function upsert(shelf, item) {
  const at = shelf.items.findIndex((i) => i.id === item.id);
  const items = shelf.items.slice();
  if (at >= 0) items[at] = { ...items[at], ...item, note: item.note || items[at].note };
  else items.unshift(item);
  return { ...shelf, items };
}
export const remove = (shelf, id) => ({ ...shelf, items: shelf.items.filter((i) => i.id !== id) });
export const patch = (shelf, id, fields) =>
  ({ ...shelf, items: shelf.items.map((i) => (i.id === id ? { ...i, ...fields } : i)) });
export const shelfOf = (shelf, list) => shelf.items.filter((i) => i.status === "filed" && i.list === list);
export const pileOf = (shelf) => shelf.items.filter((i) => i.status !== "filed");
export const countsOf = (shelf) => {
  const out = {};
  for (const i of shelf.items) if (i.status === "filed") out[i.list] = (out[i.list] ?? 0) + 1;
  return out;
};
