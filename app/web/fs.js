// web/fs.js — expo-file-system, for a browser.
//
// THE POINT OF THIS FILE IS THAT store.ts DOES NOT CHANGE. Every rule that
// file learned the hard way — write beside it and rename, copy before you
// shrink, keep the bytes you could not parse, salvage items out of truncated
// JSON — is expressed in terms of six filesystem calls. Implement those six
// over localStorage and the whole of it runs in a browser unaltered, backups
// and rescue included.
//
// The alternative was a second storage layer with its own idea of what a
// shelf is, and a second set of the same bugs. This is eleven functions.
//
// WHY localStorage AND NOT IndexedDB. A shelf is tens of kilobytes of JSON
// read once at launch, which is exactly what localStorage is for. IndexedDB
// buys asynchrony and megabytes that nothing here needs, at the price of a
// schema and a migration path. If a shelf ever outgrows the ~5 MB budget this
// becomes wrong — and `writeAsStringAsync` says so out loud rather than
// failing the way a full disk fails.

const PREFIX = "shelf.fs:";
const key = (uri) => PREFIX + String(uri).replace(/^file:\/\/\//, "");

/** The app only ever joins onto this, so its exact value is arbitrary. */
export const documentDirectory = "file:///shelf/";
export const cacheDirectory = "file:///shelf/cache/";
export const EncodingType = { Base64: "base64", UTF8: "utf8" };

const store = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch (_) {
    // Safari in a blocked third-party frame throws on ACCESS, not on use.
    return null;
  }
};

/** Bytes we were handed by the browser rather than by ourselves. */
const isForeign = (uri) => /^(blob:|data:|https?:)/i.test(String(uri));

export async function getInfoAsync(uri, _opts = {}) {
  if (isForeign(uri)) return { exists: true, uri, size: 0, isDirectory: false };
  const v = store()?.getItem(key(uri));
  return v == null
    ? { exists: false, uri, isDirectory: false }
    // `size` is the JS string length, not bytes on a disk. store.ts uses it
    // for one thing — telling you how big the file it could not read was —
    // and a character count is an honest answer to that.
    : { exists: true, uri, size: v.length, isDirectory: false };
}

export async function readAsStringAsync(uri, opts = {}) {
  // A picked photo is a blob: URL, not something this shim ever wrote. The
  // screenshot path asks for base64 and this is where that has to come from.
  if (isForeign(uri)) {
    const res = await fetch(uri);
    const buf = await res.arrayBuffer();
    return opts.encoding === EncodingType.Base64 || opts.encoding === "base64"
      ? toBase64(new Uint8Array(buf))
      : new TextDecoder().decode(buf);
  }
  const v = store()?.getItem(key(uri));
  if (v == null) throw new Error(`file does not exist: ${uri}`);
  return v;
}

export async function writeAsStringAsync(uri, body, _opts = {}) {
  const s = store();
  if (!s) throw new Error("this browser will not let shelf save anything (storage is blocked)");
  try {
    s.setItem(key(uri), body);
  } catch (e) {
    // QuotaExceededError. Said in words, because the alternative is a save
    // that fails with a DOM exception nobody outside a console will ever see,
    // on a shelf somebody just added something to.
    throw new Error("this browser is out of room for shelf (about 5 MB). Publishing a shelf and clearing old items frees some.");
  }
}

export async function copyAsync({ from, to }) {
  const v = store()?.getItem(key(from));
  if (v == null) throw new Error(`file does not exist: ${from}`);
  await writeAsStringAsync(to, v);
}

/**
 * The atomic swap, as atomic as a browser gets.
 *
 * localStorage has no rename. Two operations is the best available, and the
 * order matters: write the destination FIRST, then drop the source. Crash in
 * between and there is a stale temp file left over, which is harmless. Do it
 * the other way round and the crash loses the shelf.
 *
 * NOT COVERED BY web/check.mjs, and said out loud rather than assumed: the
 * order only shows up if the tab dies BETWEEN these two lines, which a check
 * cannot stage. Reversing them deliberately still passes every assertion.
 * This one is held by reading, not by a test.
 */
export async function moveAsync({ from, to }) {
  const v = store()?.getItem(key(from));
  if (v == null) throw new Error(`file does not exist: ${from}`);
  await writeAsStringAsync(to, v);
  store()?.removeItem(key(from));
}

export async function deleteAsync(uri, opts = {}) {
  const s = store();
  if (!s) return;
  if (!opts.idempotent && s.getItem(key(uri)) == null) throw new Error(`file does not exist: ${uri}`);
  s.removeItem(key(uri));
}

export async function makeDirectoryAsync() { /* no directories here */ }
export async function readDirectoryAsync() {
  const s = store();
  if (!s) return [];
  return Object.keys(s).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}

/**
 * Bytes → base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` on a two-megabyte screenshot spreads two
 * million arguments into one call and overflows the stack. It works on every
 * small test and dies on the first real photograph.
 */
function toBase64(bytes) {
  let s = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(s);
}
