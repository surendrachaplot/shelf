// fakeFs.js — expo-file-system, in a Map, for a node selftest.
//
// `store.ts` is the one file in this app where a bug costs somebody the things
// they saved, and until it lost a shelf it had no test at all — because it
// imports `expo-file-system`, which needs a phone, so testing it "properly"
// looked like it needed a device and therefore never happened.
//
// It needs four calls and a directory string. This is those, over a Map, with
// the same failure semantics that matter: reading something that is not there
// THROWS (rather than returning empty, which would hide the exact class of bug
// the tests are about), and a move is a copy plus a delete rather than an
// atomic primitive, so a half-done write can be simulated.
//
// The selftest swaps it in at bundle time (esbuild `alias`), so the code under
// test is the real store.ts — not a copy of it that can drift.
const files = new Map();

export const documentDirectory = "file:///doc/";

export async function getInfoAsync(uri) {
  const raw = files.get(uri);
  return raw === undefined
    ? { exists: false, uri, isDirectory: false }
    : { exists: true, uri, isDirectory: false, size: Buffer.byteLength(raw, "utf8") };
}

export async function readAsStringAsync(uri) {
  const raw = files.get(uri);
  if (raw === undefined) throw new Error(`ENOENT: ${uri}`);
  return raw;
}

export async function writeAsStringAsync(uri, body) {
  files.set(uri, String(body));
}

export async function copyAsync({ from, to }) {
  const raw = files.get(from);
  if (raw === undefined) throw new Error(`ENOENT: ${from}`);
  files.set(to, raw);
}

export async function moveAsync({ from, to }) {
  const raw = files.get(from);
  if (raw === undefined) throw new Error(`ENOENT: ${from}`);
  files.set(to, raw);
  files.delete(from);
}

// The control surface. On globalThis rather than exported, because esbuild
// inlines this module into the bundle under test — a second `import` of this
// file from the test would be a second, unrelated Map.
globalThis.__fs = {
  put: (name, body) => files.set(documentDirectory + name, body),
  get: (name) => files.get(documentDirectory + name),
  has: (name) => files.has(documentDirectory + name),
  drop: (name) => files.delete(documentDirectory + name),
  reset: () => files.clear(),
  names: () => [...files.keys()].map((k) => k.replace(documentDirectory, "")),
};
