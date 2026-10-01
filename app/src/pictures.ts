// pictures.ts — a picture you chose, kept.
//
// The picker hands back a pointer into somebody else's storage: a photo-
// library asset on a phone, a blob URL in a browser. Both stop working — the
// blob at the next reload, the asset whenever iOS feels like it. A moodboard
// whose pictures are grey boxes the next morning is worse than no moodboard,
// so the bytes are copied to where the shelf itself lives.
//
//   phone → a JPEG in the app's documents folder, next to shelf.json.
//   web   → a data URL inside the item (web/picker.js draws it on a canvas).
//
// ponytail: on the web that is localStorage, about 5 MB for the whole shelf,
// so each picture is cut to 900px (roughly 100 kB) and a shelf holds a few
// dozen. web/fs.js says so out loud when the budget runs out. IndexedDB is
// the upgrade when somebody keeps more.
import * as FileSystem from "expo-file-system";
import { imageManipulator } from "./native";

const EDGE = 900;
const QUALITY = 0.7;
const DIR = () => `${FileSystem.documentDirectory}pictures/`;

/** The kept copy's address, or null when this build cannot make one. */
export async function keepPicture(uri: string, id: string): Promise<string | null> {
  const M = imageManipulator();
  if (!M) return null;
  const out = await M.manipulateAsync(uri, [{ resize: { width: EDGE } }], {
    compress: QUALITY, format: M.SaveFormat.JPEG,
  });
  if (out.uri.startsWith("data:")) return out.uri;   // the web: the picture IS the string

  await FileSystem.makeDirectoryAsync(DIR(), { intermediates: true }).catch(() => {});
  const to = `${DIR()}${id}.jpg`;
  await FileSystem.copyAsync({ from: out.uri, to });
  return to;
}

/**
 * iOS can move the app's container — after a restore, sometimes after an
 * update — and an absolute path saved last month then points at nothing. The
 * file is still there, under the NEW documents folder, so the saved path is
 * re-pointed at wherever that is today. Pure, so it can be tested.
 */
export function rebasePicture(url: string | null | undefined, documents: string | null): string | null {
  if (!url) return url ?? null;
  const at = url.lastIndexOf("/pictures/");
  if (!documents || at < 0 || !url.startsWith("file:")) return url;
  return `${documents}pictures/${url.slice(at + "/pictures/".length)}`;
}
