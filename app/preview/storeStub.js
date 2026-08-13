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
// Covers and photos. Books and films always had these — Open Library and TMDB
// hand them over — so the contact sheet has always shown a shelf of artwork
// next to a shelf of flat colour and nobody read that as a defect.
//
// A place CAN have a photo now (OSM tags, Wikidata, Foursquare), and most
// places still will not: a listed landmark is photographed, an independent
// bookshop is not. So the fixture is deliberately MIXED — one restaurant with
// a photo and one without, sitting in the same row, because that is the real
// shelf and the question is whether it looks composed or half-finished.
const ART = {
  Piranesi: art("#101010", "#F5C542", "PIRANESI"), Sinners: art("#2A0A0A", "#FF6B4A", "SINNERS"),
  Babel: art("#0E2A4A", "#FFFFFF", "BABEL"),
  "St. John": art("#3A2A18", "#F0E6D2", "ST JOHN"),
  Kiln: art("#20160E", "#E8A33D", "KILN"),
  "Belém": art("#1B3A5C", "#EFE7D8", "BELÉM"),
  "Time Out Market": art("#2B1F2E", "#F2C4CE", "TIME OUT"),
};

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
  // QUOTES ARE THE HARD CASE and the fixtures have to say so: a four-word one,
  // a long one that only just fits, and one longer than any jacket can hold so
  // the excerpt is looked at rather than assumed.
  quotes: [
    "Be kind, for everyone you meet is fighting a hard battle.",
    "The center of me is always and eternally a terrible pain, a curious wild pain, a searching for something beyond what the world contains.",
    "Attention is the rarest and purest form of generosity.",
    "We tell ourselves stories in order to live. We look for the sermon in the suicide, for the social or moral lesson in the murder of five. We interpret what we see, select the most workable of the multiple choices, and we live entirely by the imposition of a narrative line upon disparate images.",
  ],
  // A trip is one reel and many places — the whole point of one item per place.
  places: ["Miradouro da Senhora do Monte", "Time Out Market", "Belém", "A Cevicheria", "Praia da Ursa"],
};

const QUOTE_BY = {
  "Be kind, for everyone you meet is fighting a hard battle.": "Ian Maclaren",
  "The center of me is always and eternally a terrible pain, a curious wild pain, a searching for something beyond what the world contains.": "Bertrand Russell",
  "Attention is the rarest and purest form of generosity.": "Simone Weil",
  "We tell ourselves stories in order to live. We look for the sermon in the suicide, for the social or moral lesson in the murder of five. We interpret what we see, select the most workable of the multiple choices, and we live entirely by the imposition of a narrative line upon disparate images.": "Joan Didion",
};

const TRAVEL = {
  "Miradouro da Senhora do Monte": { city: "Lisbon", area: "Graça", located: true,
    address: "Largo Monte, 1170-107 Lisboa", lat: 38.72, lng: -9.13,
    map_url: "geo:38.72,-9.13?q=Miradouro", osm_url: "https://www.openstreetmap.org/node/1", source: "openstreetmap" },
  "Time Out Market": { city: "Lisbon", area: "Cais do Sodré", located: true,
    address: "Av. 24 de Julho 49, Lisboa", opening_hours: "Su-We 10:00-24:00",
    map_url: "geo:38.70,-9.14?q=Time%20Out", website: "https://timeoutmarket.com", source: "openstreetmap" },
  // The honest case: OSM has never heard of it, so it gets a search rather
  // than a pin — and the panel has to SAY so.
  "Praia da Ursa": { city: "Sintra", located: false, map_url: "geo:0,0?q=Praia%20da%20Ursa%2C%20Sintra", source: "search" },
};

const mk = (list, title, i) => {
  // ORDER MATTERS. The per-list subtitle used to be spread BEFORE the generic
  // one, so the generic empty string overwrote it and every quote rendered
  // with no attribution — which looked like the feature was missing rather
  // than the fixture being wrong.
  const generic = list === "books" ? "Susanna Clarke" : list === "restaurants" ? "Peckham" : "";
  const rich = RICH[title];
  const richSub = rich && (list === "movies"
    ? [rich.director, rich.year].filter(Boolean).join(" · ")
    : list === "recipes" ? [rich.total_time, rich.serves].filter(Boolean).join(" · ") : null);

  const perList =
    list === "quotes"
      ? { subtitle: QUOTE_BY[title] ?? "", canonical: { author: QUOTE_BY[title] ?? null } }
      : list === "places"
        ? { subtitle: [TRAVEL[title]?.area, TRAVEL[title]?.city].filter(Boolean).join(" · ") || "Lisbon",
            canonical: TRAVEL[title] ?? { city: "Lisbon", located: false, map_url: `geo:0,0?q=${encodeURIComponent(title)}` } }
        : {};

  return {
    id: `${list}-${i}`, list, status: "filed", title,
    subtitle: richSub || generic,
    note: "", image_url: ART[title] ?? null, canonical: rich ?? {},
    confidence: 0.9, enriched: true, source_url: "https://insta/x", resolver: "crawler-embed-html",
    created_at: "2026-08-01T00:00:00Z",
    ...perList,
  };
};

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
