// tokenStore.ts — the device token, readable by BOTH the app and the share
// extension.
//
// These are two separate processes with separate sandboxes. A token written by
// the app is invisible to the extension unless it is stored in a Keychain
// access group they share — and when that is misconfigured, nothing throws:
// `getToken()` in the extension simply returns null, every share 401s, and the
// symptom is "sharing silently does nothing" with a perfectly healthy-looking
// app. That is why `verifySharedAccess()` exists and why the app shows its
// result on the settings screen instead of assuming it worked.
import * as SecureStore from "expo-secure-store";

const KEY = "shelf.device.token";
const PROBE = "shelf.group.probe";

// Must match ios.entitlements.keychain-access-groups in app.json. The
// $(AppIdentifierPrefix) is substituted by Xcode at build time; at runtime the
// group name is the resolved team-prefixed string, so the raw bundle id is what
// SecureStore wants here.
const ACCESS_GROUP = "com.surendrachaplot.shelf";

// The option name for the Keychain access group has moved between
// expo-secure-store versions (`accessGroup` vs `keychainAccessGroup`). Sending
// both is harmless — an unknown key is ignored — and means an upgrade of the
// package cannot quietly sever the app from its own extension.
const opts = {
  accessGroup: ACCESS_GROUP,
  keychainAccessGroup: ACCESS_GROUP,
  keychainService: "shelf",
} as unknown as SecureStore.SecureStoreOptions;

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY, opts);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, opts);
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, opts);
  } catch {
    /* already gone */
  }
}

// Called from the app's settings screen. Writing a probe value the extension
// can read is the only way to know the access group is really shared before
// you find out by losing a share.
export async function verifySharedAccess(): Promise<boolean> {
  try {
    const stamp = String(Math.random());
    await SecureStore.setItemAsync(PROBE, stamp, opts);
    return (await SecureStore.getItemAsync(PROBE, opts)) === stamp;
  } catch {
    return false;
  }
}
