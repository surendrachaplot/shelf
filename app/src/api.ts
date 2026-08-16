// api.ts — the few things the app asks a server for.
//
// It does NOT ask for your shelves. Those are in `store.ts`, on this phone.
// This file exists for the three jobs a phone genuinely cannot do alone:
//
//   resolve   turn a link into a named thing (a scrape, then Claude, then a
//             catalogue). Claude needs a key that must never ship in a build.
//   search    the same catalogues, for adding something by name.
//   publish   host a snapshot so a link you hand out opens for somebody with
//             no app. Only what you explicitly share ever goes up.
//
// There is no login, because there is nothing to log in to. The build carries
// an app key so a stranger who finds the URL cannot spend the provider quota;
// it identifies the BUILD, not you, and it can read nothing.
import * as SecureStore from "expo-secure-store";

export const API_BASE = process.env.EXPO_PUBLIC_SHELF_API ?? "https://shelf-api-u8xy.onrender.com";

// Baked at build time by eas.json. Absent in a bare `expo start`, which is
// fine: a dev server with no key set accepts everything.
const APP_KEY = process.env.EXPO_PUBLIC_SHELF_KEY ?? "";

// Where a published link points. Same host as the API unless a real domain is
// configured — this is what people see, so it is worth having a name one day.
export const SHARE_BASE = process.env.EXPO_PUBLIC_SHELF_WEB ?? API_BASE;
export const shareUrl = (code: string) => `${SHARE_BASE}/s/${code}`;

export type ListName = "books" | "restaurants" | "movies" | "recipes" | "quotes" | "places" | "unsorted";
export const LISTS: ListName[] = ["books", "restaurants", "movies", "recipes", "quotes", "places"];

/** What the resolver hands back. The device turns this into a stored Item. */
export type Resolved = {
  list: ListName;
  title: string | null;
  subtitle: string;
  note: string;
  image_url: string | null;
  canonical: Record<string, unknown>;
  confidence: number | null;
  enriched: boolean;
  source_url: string | null;
  resolver: string;
  caption: string;
};

async function req<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, {
      ...init,
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        ...(APP_KEY ? { "x-shelf-key": APP_KEY } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json()) as T & { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) throw new Error(body.error ?? `http ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a shared link into things worth keeping.
 *
 * SIXTY SECONDS, not eight. This is a scrape, a Claude call and a catalogue
 * lookup in series, and on a sleeping free-tier server the first one of the
 * day also pays a cold start. The old eight-second timeout was written for an
 * endpoint that only wrote a queue row and returned; using it here would
 * abandon work that was about to succeed.
 */
export const resolveLink = (url: string, list: ListName, homeCity?: string) =>
  req<{ items: Resolved[]; resolver: string; caption_chars: number }>(
    "/api/resolve",
    { method: "POST", body: JSON.stringify({ url, list, home_city: homeCity || "" }) },
    60000
  );

export const resolveImage = (imageB64: string, mediaType: string, list: ListName) =>
  req<{ items: Resolved[]; resolver: string }>(
    "/api/resolve/image",
    { method: "POST", body: JSON.stringify({ image_b64: imageB64, media_type: mediaType, list }) },
    60000
  );

export type SearchHit = {
  list: ListName; title: string; subtitle: string; image_url: string | null;
  canonical: Record<string, unknown>;
  // A stable identity for the result — the catalogue's own key, and what the
  // list is keyed on when rendering. Always present: the server builds it.
  key: string;
};
export const search = (q: string, list?: ListName | null, city?: string) => {
  const p = new URLSearchParams({ q });
  if (list) p.set("list", list);
  if (city) p.set("city", city);
  return req<{ results: SearchHit[]; unavailable: { list: ListName; provider: string }[]; mode?: string }>(`/api/search?${p}`, {}, 15000);
};

// ── publishing: the only thing that ever leaves the phone ────────────────────

export type PublishKind = "item" | "shelf" | "profile";
export const publish = (body: Record<string, unknown>) =>
  req<{ code: string; kind: string }>("/api/publish", { method: "POST", body: JSON.stringify(body) });

export const revokePublish = (code: string) =>
  req<{ revoked: boolean }>("/api/publish/revoke", { method: "POST", body: JSON.stringify({ code }) });

/** How many times each link has been opened. Absent codes are no longer live. */
export const publishStats = (codes: string[]) =>
  req<{ views: Record<string, number> }>("/api/publish/stats", { method: "POST", body: JSON.stringify({ codes }) });

/** One-time: pull anything the old server-side store still holds. */
export const legacyExport = () =>
  req<{ count: number; items: Record<string, unknown>[] }>("/api/legacy/export", {}, 30000);

/**
 * Is the server up? TIMED and short, because it is called while the app is
 * still deciding what to draw. Render's free tier sleeps and can take a minute
 * to wake — an untimed call here once WAS "stuck on the splash screen".
 */
export const serverState = async (timeoutMs = 7000) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: ac.signal });
    return (await res.json()) as { ok?: boolean; db?: boolean };
  } finally {
    clearTimeout(timer);
  }
};

// ── the hand-off from the share extension ────────────────────────────────────
//
// THE EXTENSION NEVER TALKS TO THE SERVER NOW. It writes here and closes, in
// well under a second, and the app does the slow part later with a row on
// screen. That is better than the old design in every way that matters: the
// sheet is instant, a share in a lift is not a lost share, and a four-second
// resolve happens somewhere you can watch it.
//
// The Keychain is the channel because the two processes share nothing else —
// separate sandboxes, separate filesystems, one Keychain access group.

const QUEUE_KEY = "shelf.pending.shares";
const queueOpts = {
  accessGroup: "com.surendrachaplot.shelf",
  keychainAccessGroup: "com.surendrachaplot.shelf",
  keychainService: "shelf",
} as unknown as SecureStore.SecureStoreOptions;

/**
 * A share the extension left behind.
 *
 * TWO KINDS, and the second one is why this is a union rather than a string.
 * A link is a link. A SCREENSHOT is a file — and the file must not travel
 * through here. Keychain items are for secrets, not payloads: a 1 MB base64
 * PNG in a Keychain value is somewhere between "slow" and "refused", and the
 * sheet would say "Saved" for something that was never written.
 *
 * So the queue carries the PATH. On iOS expo-share-extension has already
 * copied the image into the App Group container, which is the one directory
 * both the extension and the app can read; on Android the app received the
 * intent itself, so its own cache path is fine. Either way the bytes stay on
 * disk and the app reads them when it resolves.
 */
export type QueuedShare =
  | { kind?: "url"; url: string; list: ListName; at: number }
  | { kind: "image"; uri: string; list: ListName; at: number };

/** Older queues have no `kind` — a share written before screenshots existed. */
export const isImageShare = (q: QueuedShare): q is Extract<QueuedShare, { kind: "image" }> =>
  (q as { kind?: string }).kind === "image";

/** What this share is OF, for a receipt and for de-duplication. */
export const shareRef = (q: QueuedShare): string =>
  isImageShare(q) ? q.uri : (q as { url: string }).url;

async function readQueue(): Promise<QueuedShare[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY, queueOpts);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: QueuedShare[]): Promise<void> {
  // Keychain items are not meant to be large. 50 unread shares means the app
  // has not been opened in a long time; dropping the oldest beats failing to
  // record the newest.
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(q.slice(-50)), queueOpts);
}

/**
 * Returns whether the share is really on disk. The sheet says "Saved" on the
 * strength of this, and a receipt for something that was thrown away is the
 * worst thing this app can produce — so the write is read back, not assumed.
 */
export async function queueShare(url: string, list: ListName): Promise<boolean> {
  return queueEntry({ kind: "url", url, list, at: Date.now() });
}

/**
 * A screenshot, by path. Same receipt discipline as a link: written, then read
 * back, and the sheet only says "Saved" if it is really there.
 */
export async function queueImage(uri: string, list: ListName): Promise<boolean> {
  return queueEntry({ kind: "image", uri, list, at: Date.now() });
}

async function queueEntry(entry: QueuedShare): Promise<boolean> {
  try {
    const q = await readQueue();
    q.push(entry);
    await writeQueue(q);
    const ref = shareRef(entry);
    return (await readQueue()).some((x) => shareRef(x) === ref && x.list === entry.list);
  } catch {
    return false;
  }
}

/** Everything the extension left, oldest first. Emptied by the caller. */
export const takeQueue = async (): Promise<QueuedShare[]> => {
  const q = await readQueue();
  if (q.length) await writeQueue([]);
  return q;
};

export const pendingShareCount = () => readQueue().then((q) => q.length);

/** Can the extension and the app see the same Keychain? */
export async function sharedKeychainOk(): Promise<boolean> {
  try {
    const stamp = String(Math.random());
    await SecureStore.setItemAsync("shelf.group.probe", stamp, queueOpts);
    return (await SecureStore.getItemAsync("shelf.group.probe", queueOpts)) === stamp;
  } catch {
    return false;
  }
}
