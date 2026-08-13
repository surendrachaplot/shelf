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
//
// ── READING IS THE DANGEROUS HALF, and this file learned it the hard way ─────
//
// `load` used to end `catch { return emptyShelf() }`, with a comment saying a
// shelf that cannot be read is an empty shelf rather than a crash. That reads
// as defensive and is the opposite: it means EVERY failure — a truncated file,
// a key of the wrong type, a bug in a migration written months later — arrives
// on the screen as the single most alarming thing this app can say, which is
// "everything you saved is gone", with no way to tell that from the truth.
//
// It was reported exactly that way: "WTF there is nothing on my shelf now?"
//
// Three rules came out of it, and they are why this file is longer than a
// read and a write:
//
//   1. AN EMPTY SHELF AND AN UNREADABLE ONE ARE DIFFERENT ANSWERS. `load`
//      returns which, and the app says so. A first launch and a lost file must
//      never look alike.
//   2. NOTHING IS OVERWRITTEN UNTIL IT HAS BEEN COPIED. A file we could not
//      parse is kept verbatim before the app is allowed to write over it, and
//      a save that SHRINKS the shelf copies what it is replacing first.
//   3. A BACKUP NOBODY CAN RESTORE IS NOT A BACKUP. `rescue` reads those
//      copies back — including salvaging whole items out of a file whose JSON
//      is truncated — and the app offers it on screen.
//
// None of it is exotic. It is the difference between losing a shelf and
// having a bad afternoon.
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
// Taken before a save that writes back FEWER items than the file holds — the
// only kind of save that can lose something. One deletion deep, which is also
// exactly the undo you want after binning the wrong thing.
const PREV = FileSystem.documentDirectory + "shelf.prev.json";
// The bytes of a file we could not turn into a shelf, kept before the app is
// allowed to write over it. Written once and never replaced: a second bad boot
// must not overwrite the good copy the first one saved.
const BROKEN = FileSystem.documentDirectory + "shelf.broken.json";

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

/**
 * `fresh` nothing has ever been saved on this phone.
 * `read` the file opened and this is what was in it.
 * `unreadable` there IS a file and we could not use it. Never say "fresh".
 */
export type ShelfState = "fresh" | "read" | "unreadable";
export type Loaded = { shelf: Shelf; state: ShelfState; note: string | null };

// Items in the file as of the last successful read or write. `save` compares
// against it to know whether it is about to shrink the shelf.
let onDisk = 0;

/**
 * TRUST NO KEY OF A FILE ON DISK.
 *
 * The line this replaces was `{ ...emptyShelf(), ...parsed }`, which reads
 * like it fills in the gaps and does not: a spread does not skip a key whose
 * value is wrong, it takes it. `links: null` in the file beat the `links: []`
 * default, `.map` threw one frame later, and the catch turned that into an
 * empty shelf. Every field is now checked for the shape the code expects
 * rather than for being present.
 *
 * Returns null only when there is no items array at all — that is not a shelf
 * with a bad field, it is not a shelf.
 */
function normalise(raw: unknown): Shelf | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.items)) return null;
  const base = emptyShelf();
  const profile = o.profile && typeof o.profile === "object" ? (o.profile as Partial<Profile>) : {};
  return {
    version: 1,
    items: o.items.filter((i): i is Item => !!i && typeof i === "object"),
    profile: { ...base.profile, ...profile },
    links: Array.isArray(o.links) ? o.links.filter((l): l is Link => !!l && typeof l === "object") : [],
  };
}

/** Never throws, and never mistakes a file it could not read for an empty one. */
export async function load(): Promise<Loaded> {
  let bytes = 0;
  try {
    const info = await FileSystem.getInfoAsync(FILE, { size: true });
    if (!info.exists) {
      // A missing file is a first launch — UNLESS a copy is sitting beside it,
      // in which case something removed the shelf and this is a loss, not a
      // beginning. Reporting it as a first launch is how a recoverable
      // problem becomes a permanent one.
      const back = await rescuable();
      if (back) {
        return { shelf: emptyShelf(), state: "unreadable", note: `The shelf file isn't there any more. ${count(back.items.length)} can be put back.` };
      }
      return { shelf: emptyShelf(), state: "fresh", note: null };
    }
    bytes = (info as { size?: number }).size ?? 0;
    const shelf = normalise(JSON.parse(await FileSystem.readAsStringAsync(FILE)));
    if (!shelf) throw new Error("no items array");
    const migrated = migrate(shelf);
    onDisk = migrated.items.length;
    return { shelf: migrated, state: "read", note: null };
  } catch (e) {
    // THE FILE IS THERE AND WE COULD NOT USE IT. Keep the bytes before the app
    // does anything else, then say so in a sentence that names the cause —
    // "nothing on your shelf" is not a diagnosis.
    await keepBroken();
    onDisk = 0;
    const back = await rescuable();
    const why = `Couldn't read your shelf file (${bytes} bytes): ${(e as Error).message}.`;
    return {
      shelf: emptyShelf(),
      state: "unreadable",
      note: back ? `${why} ${count(back.items.length)} can be put back.` : `${why} Nothing has been deleted — the file has been kept.`,
    };
  }
}

const count = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/** Copy an unreadable file aside, once. A later boot must not overwrite it. */
async function keepBroken(): Promise<void> {
  try {
    if ((await FileSystem.getInfoAsync(BROKEN)).exists) return;
    if (!(await FileSystem.getInfoAsync(FILE)).exists) return;
    await FileSystem.copyAsync({ from: FILE, to: BROKEN });
  } catch { /* best effort: this must never be the reason a launch fails */ }
}

/**
 * PULL WHOLE ITEMS OUT OF BROKEN JSON.
 *
 * The failure the atomic write exists to prevent still happens on a phone that
 * runs out of disk mid-`writeAsStringAsync`: the temp file is a valid prefix
 * of a shelf and `JSON.parse` refuses all of it. Every item BEFORE the cut is
 * intact, though, and a brace counter can lift them out — so 40 of 41 books
 * come back instead of none.
 *
 * Deliberately dumb: walk the items array, take each balanced `{...}`, stop at
 * the first one that does not close. String-aware, because a title containing
 * a brace would otherwise end the scan early.
 */
export function salvage(raw: unknown): Item[] {
  // A recovery path is reached by definition when something has already gone
  // wrong, so it takes whatever it is handed. Throwing here would make the
  // rescue itself the thing that fails.
  if (typeof raw !== "string") return [];
  const at = raw.indexOf('"items"');
  if (at < 0) return [];
  const open = raw.indexOf("[", at);
  if (open < 0) return [];
  const out: Item[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const o = JSON.parse(raw.slice(start, i + 1));
          if (o && typeof o === "object" && o.id) out.push(o as Item);
        } catch { /* an item that will not parse is one item, not the file */ }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}

async function itemsIn(path: string): Promise<Item[]> {
  try {
    if (!(await FileSystem.getInfoAsync(path)).exists) return [];
    const raw = await FileSystem.readAsStringAsync(path);
    const shelf = normalise(JSON.parse(raw));
    return shelf ? migrate(shelf).items : salvage(raw);
  } catch {
    // Unparseable. One more try, per item.
    try { return salvage(await FileSystem.readAsStringAsync(path)); } catch { return []; }
  }
}

/** What is recoverable from the copies beside the shelf, deduplicated. */
export async function rescuable(): Promise<{ items: Item[] } | null> {
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const path of [PREV, BROKEN]) {
    for (const it of await itemsIn(path)) {
      if (!it?.id || seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
  }
  return items.length ? { items } : null;
}

/**
 * Put the copies back, without touching what is already here. Merging rather
 * than replacing matters: by the time somebody taps this they may have added
 * things to the shelf they were handed, and a restore that discards those is
 * a second loss dressed as a fix.
 */
export async function rescue(current: Shelf): Promise<{ shelf: Shelf; added: number }> {
  const got = await rescuable();
  if (!got) return { shelf: current, added: 0 };
  const have = new Set(current.items.map((i) => i.id));
  const add = got.items.filter((i) => !have.has(i.id));
  if (!add.length) return { shelf: current, added: 0 };
  return { shelf: { ...current, items: [...add, ...current.items] }, added: add.length };
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

// `RENAMED[k]` on a raw string is a lookup through Object.prototype: an item
// whose list said "constructor" would come back with a FUNCTION as its shelf.
// Own keys only.
const renamedTo = (k: unknown): string | null =>
  typeof k === "string" && Object.prototype.hasOwnProperty.call(RENAMED, k) ? RENAMED[k] : null;

/** Total, because a migration must survive being handed a shelf it did not expect. */
export function migrate(shelf: Shelf): Shelf {
  const before = { items: Array.isArray(shelf.items) ? shelf.items : [], links: Array.isArray(shelf.links) ? shelf.links : [] };
  let touched = before.items !== shelf.items || before.links !== shelf.links;
  const items = before.items.map((it) => {
    const to = renamedTo(it?.list);
    if (!to) return it;
    touched = true;
    return { ...it, list: to };
  });
  // The published links carry a shelf name too — a card shared as "travel"
  // should still say what it was.
  const links = before.links.map((l) => {
    const to = renamedTo(l?.target);
    if (!to) return l;
    touched = true;
    return { ...l, target: to };
  });
  return touched ? { ...shelf, items, links } : shelf;
}

export async function save(shelf: Shelf): Promise<void> {
  const n = shelf.items.length;
  // THE ONLY SAVE THAT CAN LOSE ANYTHING is one writing back fewer items than
  // the file already holds. Copy first. It costs one file copy on the rare
  // save that shrinks, and nothing at all on the common one that grows.
  if (n < onDisk) {
    try { await FileSystem.copyAsync({ from: FILE, to: PREV }); } catch { /* nothing to copy is fine */ }
  }
  const body = JSON.stringify({ ...shelf, version: 1 });
  await FileSystem.writeAsStringAsync(TMP, body);
  // Atomic swap. See the header — this is the difference between a bad write
  // and a lost shelf.
  await FileSystem.moveAsync({ from: TMP, to: FILE });
  onDisk = n;
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
