// api.ts — every call the app and the extension make.
//
// The offline queue at the bottom is not a nicety. The share extension runs in
// a lift, on a train, on 1 bar of signal; if a failed POST just showed an error
// and closed, the save would be gone and the user would never know which ones
// they lost. A share that cannot reach the server is written to disk and
// flushed by the app on next launch.
import { getToken } from "./tokenStore";

// The deployed service. eas.json sets EXPO_PUBLIC_SHELF_API for real builds;
// this default is what a bare `expo start` uses, and the two must agree or the
// app talks to a different server depending on how it was launched.
export const API_BASE = process.env.EXPO_PUBLIC_SHELF_API ?? "https://shelf-api-u8xy.onrender.com";

export type ListName = "books" | "restaurants" | "movies" | "recipes" | "unsorted";
export const LISTS: ListName[] = ["books", "restaurants", "movies", "recipes"];

export type Item = {
  id: string;
  list: ListName;
  status: "pending" | "needs_review" | "filed" | "discarded";
  title: string | null;
  subtitle: string | null;
  note: string | null;
  image_url: string | null;
  canonical: Record<string, unknown>;
  confidence: number | null;
  source_url: string | null;
  enriched: boolean;
  created_at: string;
};

async function req<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("not paired");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, {
      ...init,
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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

export const pair = async (code: string, device: string) => {
  const res = await fetch(`${API_BASE}/api/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, device }),
  });
  const body = (await res.json()) as { ok: boolean; token?: string; error?: string };
  if (!body.ok || !body.token) throw new Error(body.error ?? "pairing failed");
  return body.token;
};

export const fetchList = (list: ListName) =>
  req<{ items: Item[] }>(`/api/items?list=${list}`).then((r) => r.items);

export const fetchInbox = () =>
  req<{ items: Item[] }>(`/api/items?inbox=1`).then((r) => r.items);

export const updateItem = (body: Record<string, unknown>) =>
  req<{ item: Item }>(`/api/item`, { method: "POST", body: JSON.stringify(body) });

// The share-time call. Short timeout on purpose: the sheet is over Instagram
// and a spinner there is worse than an optimistic "saved" plus a retry.
export const ingestUrl = (url: string, list: ListName) =>
  req<{ id: string }>(`/api/ingest`, { method: "POST", body: JSON.stringify({ url, list }) }, 5000);

export const ingestImage = (imageB64: string, mediaType: string, list: ListName) =>
  req<{ id: string }>(
    `/api/ingest/image`,
    { method: "POST", body: JSON.stringify({ image_b64: imageB64, media_type: mediaType, list }) },
    15000
  );

// ── who you are, and handing a shelf to someone ──────────────────────────────

export type Profile = {
  handle: string | null;
  display_name: string;
  bio: string | null;
  plate_seed: string;
  since: string;
};

export type ProfileState = {
  profile: Profile | null;
  needs_handle: boolean;
  public_shelves: boolean;
  counts: Record<string, number>;
};

export type ShareKind = "item" | "shelf" | "profile";
export type Share = { code: string; kind: ShareKind; target: string | null; note: string | null; views: number };

export type Received = {
  id: string; note: string | null; created_at: string; code: string;
  from_handle: string; from_name: string | null; from_seed: string;
  kind: ShareKind | null; target: string | null;
};

/**
 * Where a share code becomes something you can paste into a message.
 *
 * DEFAULTS TO THE API, because the API is what serves /s/<code> — the public
 * pages and the JSON come out of the same process. A separate default (it used
 * to be a domain nobody owns yet) means every link the app hands out is dead
 * until somebody remembers to set a second variable, and you find out when a
 * friend tells you the link you sent them 404s.
 */
export const SHARE_BASE = (process.env.EXPO_PUBLIC_SHELF_WEB ?? API_BASE).replace(/\/+$/, "");
export const shareUrl = (code: string) => `${SHARE_BASE}/s/${code}`;
export const profileUrl = (handle: string) => `${SHARE_BASE}/@${handle}`;

export const getProfile = () => req<{ ok: true } & ProfileState>(`/api/profile`);

export const saveProfile = (patch: Partial<Profile> & { public_shelves?: boolean }) =>
  req<{ ok: true } & ProfileState>(`/api/profile`, { method: "POST", body: JSON.stringify(patch) });

export const makeShare = (kind: ShareKind, target?: string | null, note?: string) =>
  req<{ share: Share; handle: string }>(`/api/share`, {
    method: "POST", body: JSON.stringify({ kind, target: target ?? null, note: note ?? null }),
  });

export const revokeShare = (code: string) =>
  req<{ revoked: boolean }>(`/api/share/revoke`, { method: "POST", body: JSON.stringify({ code }) });

export const listShares = () => req<{ shares: Share[] }>(`/api/shares`).then((r) => r.shares);

export const sendTo = (to: string, kind: ShareKind, target: string | null, note?: string) =>
  req<{ sent_to: string; code: string; duplicate: boolean }>(`/api/send`, {
    method: "POST", body: JSON.stringify({ to, kind, target, note: note ?? null }),
  });

export const listReceived = () => req<{ received: Received[] }>(`/api/received`).then((r) => r.received);

export const actOnSend = (id: string, action: "accept" | "decline") =>
  req<{ copied: number }>(`/api/send/act`, { method: "POST", body: JSON.stringify({ id, action }) });

// ── search and add ───────────────────────────────────────────────────────────

export type SearchHit = {
  list: ListName; key: string; title: string; subtitle: string | null;
  image_url: string | null; canonical: Record<string, unknown>; provider: string;
};

/**
 * `unavailable` is not an error and must not render as one. It is the honest
 * answer to "why are there no films here" when nobody has set TMDB_API_KEY —
 * and §8 says a zero and a couldn't-look must never look the same.
 */
export const search = (q: string, list?: ListName) =>
  req<{ results: SearchHit[]; unavailable: { list: ListName; provider: string }[]; mode?: string }>(
    `/api/search?q=${encodeURIComponent(q)}${list ? `&list=${list}` : ""}`, {}, 12000
  );

export const addItem = (hit: Pick<SearchHit, "list" | "title" | "subtitle" | "image_url" | "canonical">) =>
  req<{ item: Item }>(`/api/add`, { method: "POST", body: JSON.stringify(hit) });

// ── offline queue ────────────────────────────────────────────────────────────
// Stored in the shared Keychain rather than AsyncStorage for the same reason
// the token is: the extension writes it and the app reads it, and they do not
// otherwise share a filesystem.
import * as SecureStore from "expo-secure-store";

const QUEUE_KEY = "shelf.pending.shares";
const queueOpts = {
  accessGroup: "com.surendrachaplot.shelf",
  keychainAccessGroup: "com.surendrachaplot.shelf",
  keychainService: "shelf",
} as unknown as SecureStore.SecureStoreOptions;

type QueuedShare = { url: string; list: ListName; at: number };

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
  // Keychain items are not meant to be large. 50 stranded shares means the
  // server has been unreachable for a long time, and dropping the oldest is
  // better than failing to record the newest.
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(q.slice(-50)), queueOpts);
}

export async function queueShare(url: string, list: ListName): Promise<void> {
  const q = await readQueue();
  q.push({ url, list, at: Date.now() });
  await writeQueue(q);
}

// Called on app launch. Returns how many stranded shares made it through.
export async function flushQueue(): Promise<number> {
  const q = await readQueue();
  if (!q.length) return 0;
  const stuck: QueuedShare[] = [];
  let sent = 0;
  for (const s of q) {
    try {
      await ingestUrl(s.url, s.list);
      sent++;
    } catch {
      stuck.push(s);
    }
  }
  await writeQueue(stuck);
  return sent;
}

export const pendingShareCount = () => readQueue().then((q) => q.length);
