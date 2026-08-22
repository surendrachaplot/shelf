// native.ts — asking for a native module without betting the app on it.
//
// ── THE OUTAGE, IN ONE SENTENCE ─────────────────────────────────────────────
//
// A JavaScript bundle can only use native modules the INSTALLED BINARY
// contains, and `import * as X from "expo-something"` at the top of a file
// runs `requireNativeModule` at IMPORT time. On a binary that does not have
// it, that throws while the bundle is being evaluated — before any screen
// renders, before any error boundary exists — so expo-updates concludes the
// update is broken and REVERTS to the bundle baked into the binary. Silently.
// The app becomes an old version of itself and nobody can tell why.
//
// That is what "Couldn't reach your shelves" was.
//
// ── WHAT THIS BUYS ──────────────────────────────────────────────────────────
//
// A module fetched THROUGH HERE is fetched when it is first used, inside a
// try/catch, and its absence is a `null` the caller has to handle rather than
// a crash nobody sees. Which means the same JavaScript runs on a binary that
// has the module and on one that does not — and an over-the-air update can
// carry features whose native half is only in a newer build, with those
// features saying so on screen instead of taking the app down.
//
// USE THIS FOR ANYTHING ADDED SINCE THE OLDEST BINARY STILL IN SOMEBODY'S
// POCKET. It costs one function call and it is the difference between a
// feature that is politely unavailable and an app that reverts a week of work.

/**
 * `require` at call time, never at import time, and remembered after the
 * first attempt — including when the answer was "no", so a missing module
 * costs one failed require rather than one per render.
 */
function once<T>(load: () => T): () => T | null {
  let cached: T | null | undefined;
  return () => {
    if (cached !== undefined) return cached;
    try {
      cached = load();
    } catch (_) {
      // The binary does not carry it. That is a fact about the phone, not an
      // error in the code, and the caller decides what to say about it.
      cached = null;
    }
    return cached;
  };
}

/**
 * Picking images from the camera roll. Added 2026-08-16, so every binary built
 * before that lacks it — including the one most likely to be on a phone.
 */
export const imagePicker = once<typeof import("expo-image-picker")>(
  () => require("expo-image-picker")
);

/** Resizing and re-encoding. Added the same day, same story. */
export const imageManipulator = once<typeof import("expo-image-manipulator")>(
  () => require("expo-image-manipulator")
);

/** Can this build bring pictures in from the photo library at all? */
export const canPickPhotos = () => imagePicker() !== null;
