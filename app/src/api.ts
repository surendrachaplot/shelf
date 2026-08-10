// api.ts — every call the app and the extension make.
//
// The offline queue at the bottom is not a nicety. The share extension runs in
// a lift, on a train, on 1 bar of signal; if a failed POST just showed an error
// and closed, the save would be gone and the user would never know which ones
// they lost. A share that cannot reach the server is written to disk and
// flushed by the app on next launch.
import { getToken } from "./tokenStore";

export const API_BASE = process.env.EXPO_PUBLIC_SHELF_API ?? "https://shelf-api.onrender.com";

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
