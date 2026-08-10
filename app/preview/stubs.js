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
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const fetchInbox = async () => { await wait(60); return ITEMS.filter((i) => i.status !== "filed"); };
const art = (bg, fg, txt) => "data:image/svg+xml;base64," + btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${bg}"/>` +
  `<circle cx="100" cy="118" r="52" fill="none" stroke="${fg}" stroke-width="6"/>` +
  `<text x="100" y="250" font-family="Helvetica" font-size="22" font-weight="bold" fill="${fg}" text-anchor="middle">${txt}</text></svg>`);
const ART = { Piranesi: art("#101010", "#F5C542", "PIRANESI"), Sinners: art("#2A0A0A", "#FF6B4A", "SINNERS"), Babel: art("#0E2A4A", "#FFFFFF", "BABEL") };

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
    subtitle: l === "books" ? "Susanna Clarke" : l === "restaurants" ? "Peckham" : "",
    note: "", image_url: ART[title] ?? null, canonical: {}, confidence: 0.9, source_url: "x", enriched: true, created_at: "",
  }));
};
export const updateItem = async () => ({ item: {} });
export const ingestUrl = async () => { await wait(140); return { id: "1" }; };
export const ingestImage = async () => ({ id: "1" });
export const queueShare = async () => {};
export const flushQueue = async () => 0;
export const pair = async () => "shelf_preview";
export const pendingShareCount = async () => 0;
export const API_BASE = "";
