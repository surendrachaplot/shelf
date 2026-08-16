// screenshots.ts — a picture on this phone becomes a thing on a shelf.
//
// ── WHY THIS PATH MATTERS MOST ──────────────────────────────────────────────
//
// Every other route into shelf goes through Instagram: share a reel, we scrape
// the caption, Claude reads it. That route is a scrape, and scrapes break —
// Meta has already served this service a login wall from one IP and a bot wall
// from another, and it will do it again.
//
// A screenshot does not depend on Meta's cooperation at all. You screenshot the
// post, share the picture, and the model reads the caption and the on-screen
// text straight off the pixels. When the scrape is blocked, this is the app.
//
// It was also, until now, entirely theoretical. `ShareBoards` read the shared
// image, labelled the sheet "Screenshot", and then `save()` bailed with
// "Nothing to save — share a link". The one route that always works was the
// one route that never ran.
//
// ── WHY THE BYTES ARE NOT IN THE QUEUE ──────────────────────────────────────
//
// The share extension and the app are two processes. What they share is a
// Keychain group (for the queue) and an App Group container (for files).
// A screenshot is one to three megabytes; Keychain items are for secrets, not
// payloads. So the queue carries the PATH, expo-share-extension has already
// copied the file into the App Group container, and this module reads it there
// when the app gets round to resolving.
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { clearAppGroupContainer } from "expo-share-extension";
import { resolveImage, type ListName } from "./api";

/**
 * THE SIZE PROBLEM, and why this file does arithmetic.
 *
 * `/api/resolve/image` refuses a base64 payload over 6 MB, and base64 is 4/3
 * the size of the bytes it encodes — so the ceiling is really about 4.5 MB of
 * image. A modern phone screenshot is a PNG: an iPhone 15 Pro screenshot of a
 * dense Instagram post runs 2–4 MB and can exceed it outright.
 *
 * A rejected screenshot would be indistinguishable, on the shelf, from one the
 * model could not read — an unnamed row, no explanation. So anything close to
 * the ceiling is re-encoded as JPEG at a smaller size before it is sent.
 *
 * 1600px on the long edge is deliberate: text on a phone screenshot is legible
 * well below the source resolution, and the vision API bills by pixel area, so
 * halving the edge quarters the cost of reading it. Quality 0.75 is the usual
 * JPEG knee — visibly identical for screen text, roughly a fifth of the bytes.
 */
const SEND_CEILING = 3_500_000;   // base64 chars we are comfortable posting
const LONG_EDGE = 1600;
const QUALITY = 0.75;

/** Base64 of a file, or null if it cannot be read. */
async function readB64(uri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    return null;
  }
}

/**
 * The media type, from the path.
 *
 * The API needs one and gets it wrong at its peril — but this is a file we
 * were handed by the OS, not fetched from a stranger's CDN, so the extension
 * is trustworthy here in a way a Content-Type header is not. Anything
 * unrecognised is called JPEG, which is what a phone camera roll is full of.
 */
export function mediaTypeOf(uri: string): string {
  const ext = String(uri).toLowerCase().split("?")[0].split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

/** Is this payload small enough to post as it is? */
export const withinCeiling = (b64: string) => b64.length <= SEND_CEILING;

/** Resolve one screenshot into items, shrinking first when the file is large. */
export async function resolveScreenshot(uri: string, list: ListName) {
  let b64 = await readB64(uri);
  if (!b64) throw new Error("that screenshot is no longer on this phone");
  let mediaType = mediaTypeOf(uri);

  // HEIC is what an iPhone actually stores. The vision API does not take it,
  // so it is converted whatever its size — not only when it is too big.
  if (!withinCeiling(b64) || mediaType === "image/heic") {
    const smaller = await shrink(uri).catch(() => null);
    if (smaller) {
      b64 = smaller;
      mediaType = "image/jpeg";
    } else if (mediaType === "image/heic") {
      // Nothing to be gained by posting bytes the API will refuse.
      throw new Error("this phone stores photos in a format the reader can't open (HEIC)");
    }
  }

  if (!withinCeiling(b64)) {
    throw new Error("that picture is too large to read — try a screenshot rather than a photo");
  }
  return resolveImage(b64, mediaType, list);
}

async function shrink(uri: string): Promise<string | null> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: LONG_EDGE } }], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return out.base64 ?? null;
}

/**
 * Tidy the App Group container once a screenshot has been read.
 *
 * The extension copies every shared image in there and nothing else ever
 * removes them, so without this the container grows by a screenshot per share
 * forever — invisible to the person, counted against the app's storage, and
 * eventually the reason a share fails on a full phone.
 *
 * Best effort and iOS-only: the module does not exist on Android, where the
 * app received the intent itself and the file is in its own cache.
 */
export async function forgetSharedImages(): Promise<void> {
  try {
    // `cleanUpBefore: now` means "everything already in there", which is
    // exactly right at the end of a drain: every file has just been read.
    await clearAppGroupContainer({ cleanUpBefore: new Date() });
  } catch {
    /* not iOS, or the module is not in this build — nothing to clean either way */
  }
}
