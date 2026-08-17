// web/native.js — the native modules, as a browser can honestly provide them.
//
// Four packages are swapped here, and the rule for each is the same: do the
// real thing where a browser CAN, and do nothing quietly where it cannot. What
// is not allowed is pretending — a shim that resolves as though it worked
// produces a screen that says a thing was saved when nothing was.
//
//   expo-secure-store       → localStorage. NOT a keychain, and the comment
//                             below says what that costs.
//   expo-share-extension    → nothing. A website cannot be in the iOS share
//                             sheet. The URL bar is the way in instead.
//   expo-share-intent       → the query string. `?url=…` IS a share on the
//                             web, and it is what a PWA share target posts to.
//   expo-linear-gradient    → a flat View, same as the render harness.
import React from "react";
import { View } from "react-native";

// ── expo-secure-store ────────────────────────────────────────────────────────
//
// On the phone this is the Keychain, and it holds the queue the share
// extension writes into. In a browser there is no Keychain and no second
// process: localStorage is the whole of what is available. It is readable by
// any script on this origin — which is fine for what actually goes in it (a
// list of URLs waiting to be resolved) and would NOT be fine for a credential.
// There are no credentials in shelf, and that is not an accident.
export async function getItemAsync(k) {
  try { return globalThis.localStorage?.getItem("shelf.secure:" + k) ?? null; } catch (_) { return null; }
}
export async function setItemAsync(k, v) {
  try { globalThis.localStorage?.setItem("shelf.secure:" + k, v); } catch (_) { /* blocked storage */ }
}
export async function deleteItemAsync(k) {
  try { globalThis.localStorage?.removeItem("shelf.secure:" + k); } catch (_) { /* blocked storage */ }
}

// ── expo-share-extension ─────────────────────────────────────────────────────
export const close = () => {};
export const openHostApp = () => {};
export const clearAppGroupContainer = async () => {};

// ── expo-share-intent ────────────────────────────────────────────────────────
//
// THE WEB HAS A SHARE, it just arrives differently. On a phone the OS hands
// the app a payload; here the payload is in the address bar:
//
//   /?url=https://www.instagram.com/reel/DAbCdEf/
//   /?text=…                     (whatever was on the clipboard or shared)
//
// which is exactly the shape a PWA `share_target` posts, so the same code path
// serves both a pasted link and Android's real share sheet.
//
// The URL is cleaned up on reset. Leaving it there means a refresh re-shares
// the same reel, which is how you end up with the same thing on a shelf twice.
const readShare = () => {
  try {
    const q = new URLSearchParams(globalThis.location?.search || "");
    const url = q.get("url") || q.get("link");
    const text = q.get("text") || q.get("title");
    if (!url && !text) return null;
    return { webUrl: url || null, text: text || null, files: [] };
  } catch (_) {
    return null;
  }
};

export function useShareIntent() {
  const [intent, setIntent] = React.useState(readShare);
  const resetShareIntent = React.useCallback(() => {
    setIntent(null);
    try {
      const u = new URL(globalThis.location.href);
      for (const k of ["url", "link", "text", "title"]) u.searchParams.delete(k);
      globalThis.history?.replaceState({}, "", u.pathname + (u.search || "") + u.hash);
    } catch (_) { /* no history API, no cleanup — harmless */ }
  }, []);
  return { hasShareIntent: !!intent, shareIntent: intent, resetShareIntent, error: null };
}

// ── expo-linear-gradient ─────────────────────────────────────────────────────
export const LinearGradient = ({ style, children }) => React.createElement(View, { style }, children);
