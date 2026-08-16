// Fixtures and platform stubs for the NETWORK half. The components are the
// real ones; only the three things a browser genuinely lacks are faked — the
// server, the Keychain, and the filesystem (see storeStub.js).
// MUST match src/api.ts. It did not, once: two new lists were added and the
// rail in every screenshot still showed the old five, which looked like the
// feature had not been built.
export const LISTS = ["books", "restaurants", "movies", "recipes", "quotes", "places"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const API_BASE = "";
export const SHARE_BASE = "https://shelf.club";
export const shareUrl = (code) => `${SHARE_BASE}/s/${code}`;

// A resolve takes seconds against the real service. The harness keeps that
// visible rather than instant, so the "Working it out…" row is a state
// somebody has actually looked at.
export const resolveLink = async () => {
  await wait(900);
  return { resolver: "crawler-embed-html", caption_chars: 1805, items: [] };
};
export const resolveImage = async () => ({ items: [] });
export const takeQueue = async () => [];
export const queueShare = async () => true;
// The screenshot half of the queue. These were added to api.ts and NOT added
// here, which broke the whole render harness — so the camera-roll import
// shipped without ever being rendered or measured, and the failure was a build
// error nobody was looking at. Anything api.ts exports and a screen imports
// has to exist here or there are no screenshots at all.
export const queueImage = async () => true;
export const isImageShare = (q) => q?.kind === "image";
export const shareRef = (q) => (q?.kind === "image" ? q.uri : q?.url);
export const pendingShareCount = async () => 0;
// ?keychain=0 renders the diagnosis in its FAILING state — the one that says
// the share sheet cannot reach the app. It is the state worth looking at and
// the one you can never reach on a healthy device.
export const sharedKeychainOk = async () =>
  new URLSearchParams(location.search).get("keychain") !== "0";
export const legacyExport = async () => ({ count: 0, items: [] });
export const serverState = async () => ({ ok: true });

export const publish = async () => { await wait(200); return { code: "n9wqk2ff", kind: "shelf" }; };
export const revokePublish = async () => ({ revoked: true });
export const publishStats = async () => ({ views: { k3f9xqm2: 12, b7ttpzc4: 0 } });

const HITS = [
  { list: "books", key: "books:ol1", title: "Piranesi", subtitle: "Susanna Clarke", image_url: null, canonical: { openlibrary_key: "/works/OL1W" }, provider: "Open Library" },
  { list: "books", key: "books:ol2", title: "Piranesi: A Novel", subtitle: "Susanna Clarke", image_url: "https://broken.invalid/c.jpg", canonical: {}, provider: "Open Library" },
  { list: "restaurants", key: "places:1", title: "Pizarro", subtitle: "Bermondsey Street, London", image_url: null, canonical: {}, provider: "OpenStreetMap" },
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
// `addItem` is gone: what you pick is written straight to this phone.
