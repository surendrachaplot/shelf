// store.ts — your shelves, on your phone, and nowhere else.
//
// One JSON file in the app's documents directory. No server row, no account,
// no sync. If you delete the app, it is gone — which is the honest trade for
// nothing about what you read living on somebody else's machine.
//
// WHY A FILE AND NOT A DATABASE. This is a few hundred items of a few hundred
// bytes: tens of kilobytes, read once at launch and held in memory. SQLite
// would be a native module — and a native module cannot travel over the air,
// so every schema change would mean a rebuild and a TestFlight round trip. The
// file is `expo-file-system`, which is already here.
//
// WHY A TEMP FILE AND A RENAME. A write interrupted halfway — backgrounded,
// killed, out of disk — leaves a truncated JSON file, and the next launch
// reads an empty shelf. Writing beside it and renaming makes the swap atomic:
// you get the old file or the new one, never half of either.
import * as FileSystem from "expo-file-system";

export type Item = {
  id: string;
  list: string;
  status: "pending" | "unread" | "filed";
  title: string | null;
  subtitle: string;
  note: string;
  image_url: string | null;
  canonical: Record<string, unknown>;
  confidence: number | null;
  enriched: boolean;
  source_url: string | null;
  resolver: string | null;
  caption?: string;
  created_at: string;
  resolved_at?: string | null;
  error?: string | null;
};

export type Profile = { name: string; bio: string; seed: string; home_city: string };
export type Link = { code: string; kind: string; target: string | null; title: string; at: string };

export type Shelf = {
  version: 1;
  items: Item[];
  profile: Profile;
  links: Link[];
};

const FILE = FileSystem.documentDirectory + "shelf.json";
const TMP = FileSystem.documentDirectory + "shelf.json.tmp";

export const emptyShelf = (): Shelf => ({
  version: 1,
  items: [],
  profile: { name: "", bio: "", seed: "", home_city: "" },
  links: [],
});

/**
 * Ids are made HERE now, not by a server.
 *
 * Deterministic from the source URL, so re-sharing the same reel updates the
 * row you already have instead of growing a second one — people re-share
 * things constantly. Hand-added items key off the catalogue identity instead,
 * and anything with neither gets a random id, because two screenshots are two
 * deliberate saves.
 */
export function idFor(seed: string | null): string {
  if (!seed) return "i_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2654435761) >>> 0;
  }
  return "i_" + h1.toString(36) + h2.toString(36);
}

/** Never throws. A shelf that cannot be read is an empty shelf, not a crash. */
export async function load(): Promise<Shelf> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return emptyShelf();
    const raw = await FileSystem.readAsStringAsync(FILE);
    const parsed = JSON.parse(raw) as Shelf;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return emptyShelf();
    return migrate({ ...emptyShelf(), ...parsed });
  } catch {
    return emptyShelf();
  }
}

/**
 * RENAMES ARE A DATA PROBLEM, not a find-and-replace.
 *
 * The travel shelf became "places". Everything already saved on this phone
 * says `list: "travel"`, and a shelf key nothing recognises does not error —
 * it falls through `normList` to "unsorted", so a rename shipped without this
 * would quietly empty somebody's shelf into the pile and look like data loss.
 *
 * Applied on read and written back by the next save, so it costs one pass and
 * then never runs again. Old names stay here forever: this phone may not have
 * been opened for a year.
 */
const RENAMED: Record<string, string> = { travel: "places" };

export function migrate(shelf: Shelf): Shelf {
  let touched = false;
  const items = shelf.items.map((it) => {
    const to = RENAMED[it.list as string];
    if (!to) return it;
    touched = true;
    return { ...it, list: to };
  });
  // The published links carry a shelf name too — a card shared as "travel"
  // should still say what it was.
  const links = shelf.links.map((l) => {
    const to = l.target ? RENAMED[l.target] : null;
    if (!to) return l;
    touched = true;
    return { ...l, target: to };
  });
  return touched ? { ...shelf, items, links } : shelf;
}

export async function save(shelf: Shelf): Promise<void> {
  const body = JSON.stringify({ ...shelf, version: 1 });
  await FileSystem.writeAsStringAsync(TMP, body);
  // Atomic swap. See the header — this is the difference between a bad write
  // and a lost shelf.
  await FileSystem.moveAsync({ from: TMP, to: FILE });
}

// ── pure operations, so they can be tested without a filesystem ──────────────

export function upsert(shelf: Shelf, item: Item): Shelf {
  const at = shelf.items.findIndex((i) => i.id === item.id);
  const items = shelf.items.slice();
  // A re-share must not silently discard the note you wrote about it. The
  // catalogue can be replaced; what you said about the thing cannot.
  if (at >= 0) items[at] = { ...items[at], ...item, note: item.note || items[at].note };
  else items.unshift(item);
  return { ...shelf, items };
}

export function remove(shelf: Shelf, id: string): Shelf {
  return { ...shelf, items: shelf.items.filter((i) => i.id !== id) };
}

export function patch(shelf: Shelf, id: string, fields: Partial<Item>): Shelf {
  return { ...shelf, items: shelf.items.map((i) => (i.id === id ? { ...i, ...fields } : i)) };
}

/** Filed items on one shelf, newest first. */
export const shelfOf = (shelf: Shelf, list: string): Item[] =>
  shelf.items.filter((i) => i.status === "filed" && i.list === list);

/** Everything still working itself out, or that we could not name. */
export const pileOf = (shelf: Shelf): Item[] =>
  shelf.items.filter((i) => i.status !== "filed");

export const countsOf = (shelf: Shelf): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of shelf.items) if (i.status === "filed") out[i.list] = (out[i.list] ?? 0) + 1;
  return out;
};
