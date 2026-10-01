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
  // Two restaurants in one neighbourhood, so the item page has a connection
  // to draw ("Also in Farringdon") — links.js needs a shared FACT, and a
  // fixture where nothing shares anything never renders the section at all.
  Brutto: { osm_type: "node", osm_id: 43, address: "35-37 Greenhill Rents, London EC1M 6BN",
    area: "Farringdon", lat: 51.5205, lng: -0.1016, cuisine: ["italian"], source: "openstreetmap" },
  Kiln: { osm_type: "node", osm_id: 44, address: "58 Brewer Street, London W1F 9TL",
    area: "Soho", lat: 51.5113, lng: -0.1363, cuisine: ["thai"], source: "openstreetmap" },
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
    // RELATIVE to today, for one item: "Saved a year ago" is decided against
    // the clock, and a fixed date would put the card on the contact sheet for
    // one week a year and silently drop it for the other fifty-one.
    created_at: title === "Piranesi" ? new Date(Date.now() - 365 * 86400000).toISOString() : "2026-08-01T00:00:00Z",
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
  // THINGS TO BUY, in the shape api/product.js sends. Two with a price and one
  // without, because "no price" is a state the row and the total both have to
  // draw. Unsorted on purpose: this is what a build with no Wishlist shelf
  // receives.
  { id: "w1", list: "unsorted", status: "filed", title: "Wool overshirt, olive", subtitle: "Northfield", note: "",
    image_url: art("#2F3A2E", "#E9DCCB", "OVERSHIRT"), confidence: 0.9, enriched: true,
    source_url: "https://shop.example/overshirt", resolver: "web-og", created_at: "2026-09-20T09:00:00Z",
    canonical: { kind: "product", price: 65, currency: "GBP", price_text: "£65.00", brand: "Northfield",
                 availability: "in_stock", seller: "Northfield", shop_url: "https://shop.example/overshirt" } },
  { id: "w2", list: "unsorted", status: "filed", title: "Lip tint, Rosewood", subtitle: "Petal", note: "",
    image_url: null, confidence: 0.9, enriched: true,
    source_url: "https://shop.example/tint", resolver: "web-og", created_at: "2026-09-21T09:00:00Z",
    canonical: { kind: "product", price: 18, currency: "GBP", price_text: "£18.00", brand: "Petal",
                 availability: "in_stock", shop_url: "https://shop.example/tint" } },
  { id: "w3", list: "unsorted", status: "filed", title: "Linen trousers, ecru", subtitle: "Marlow & Co", note: "",
    image_url: art("#E9DCCB", "#2F3A2E", "LINEN"), confidence: 0.9, enriched: true,
    source_url: "https://shop.example/linen", resolver: "web-og", created_at: "2026-09-22T09:00:00Z",
    canonical: { kind: "product", price: null, currency: null, price_text: null, brand: "Marlow & Co",
                 shop_url: "https://shop.example/linen" } },
  { id: "n1", list: "unsorted", status: "filed", title: "Brown boots, not black.", subtitle: "",
    note: "Brown boots, not black. Ask Maya about the scarf.", image_url: null, confidence: null, enriched: false,
    source_url: null, resolver: "note", created_at: "2026-09-23T09:00:00Z", canonical: { kind: "note" } },
  // A SAVED ARTICLE. Read, named, and on no shelf — an essay is not a book, a
  // film or a place — carrying the text the server kept (api/article.js). Long
  // enough to scroll, with a summary, because the reader has to be looked at
  // with both.
  { id: "p4", list: "unsorted", status: "filed", title: "The dosa counter that does not take bookings",
    subtitle: "Field Notes", note: "", image_url: null, confidence: null, enriched: false,
    source_url: "https://fieldnotes.example/dosa-counter", resolver: "web-og", created_at: "2026-09-12T09:00:00Z",
    canonical: { article: {
      byline: "R. Okafor", siteName: "Field Notes", readingMinutes: 6, hero: null,
      excerpt: "There is no sign outside. You find it by the queue.",
      summary: "A twelve-seat counter on Holly Grove serves one thing well. Go before seven. Order the ghee roast and the filter coffee.",
      text: [
        "There is no sign outside. You find it by the queue, which starts at half past five and is gone by seven, because by seven the batter is gone too.",
        "Inside are twelve stools, one flat-top and a man who has made the same dosa for nineteen years. He does not hurry and he does not talk while he pours.",
        "The ghee roast comes first. It is as long as your forearm and it breaks like glass.",
        "Then the sambar, which is thinner than you expect and better for it. Then the coffee, poured from a height into a steel tumbler, and then somebody is standing behind you waiting for the stool.",
        "Nobody has written the recipe down. He says the batter knows what day it is, and that is all he will say about it.",
      ].join("\n\n"),
    } } },
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
  // TWO LISTS, one of each kind, so both halves of a list have been drawn:
  // one that is only things somebody pinned (three covers, in an order that is
  // NOT the shelf's order), and one that is only a saved search.
  boards: [
    // The moodboard-and-wishlist case: pictures, a jacket with no picture, a
    // note, two prices and one thing with no price.
    { id: "l-outfit", name: "Autumn outfit", pins: ["w1", "w3", "n1", "w2", "books-0"],
      query: null, view: "pictures", created_at: "2026-09-24T10:00:00Z" },
    { id: "l-weekend", name: "This weekend", pins: ["restaurants-2", "movies-0", "books-0"],
      query: null, view: "pictures", created_at: "2026-09-20T10:00:00Z" },
    { id: "l-lisbon", name: "Lisbon", pins: [], query: "lisbon", view: "rows", created_at: "2026-09-21T10:00:00Z" },
  ],
};

export const emptyShelf = () => ({ version: 1, items: [], profile: { name: "", bio: "", seed: "", home_city: "" }, links: [], boards: [] });

/**
 * `?broken=1` — the shelf file is there and would not open.
 *
 * A scenario the harness can SHOOT, because this state had no picture: an
 * unreadable file and a brand-new install rendered as the identical empty
 * screen, so the only report anybody could make about it was "there is
 * nothing on my shelf". It is a frame on the contact sheet now, sitting next
 * to the shelves it is the alternative to.
 */
const broken = new URLSearchParams(location.search).get("broken") === "1";
const RESCUABLE = SHELF.items.filter((i) => i.status === "filed").slice(0, 14);

export const load = async () =>
  broken
    ? { shelf: emptyShelf(), state: "unreadable",
        note: `Couldn't read your shelf file (48213 bytes): Unexpected end of JSON input. ${RESCUABLE.length} items can be put back.` }
    : { shelf: SHELF, state: "read", note: null };
export const save = async (next) => { SHELF = next; };
export const rescuable = async () => (broken ? { items: RESCUABLE } : null);
export const rescue = async (current) => ({
  shelf: { ...current, items: [...RESCUABLE, ...current.items] },
  added: RESCUABLE.length,
});
export const salvage = () => RESCUABLE;
export const migrate = (shelf) => shelf;

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
export const pileOf = (shelf) => shelf.items.filter((i) => i.status !== "filed" || i.list === "unsorted");
export const countsOf = (shelf) => {
  const out = {};
  for (const i of shelf.items) if (i.status === "filed") out[i.list] = (out[i.list] ?? 0) + 1;
  return out;
};
