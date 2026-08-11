// `?paired=0` renders the pairing screen instead of the shelves.
const paired = typeof location !== "undefined" && new URLSearchParams(location.search).get("paired") !== "0";
export const getToken = async () => (paired ? "shelf_preview" : null);
export const setToken = async () => {};
export const clearToken = async () => {};
// `?keychain=0` renders the Profile diagnosis in its FAILING state — the one
// that says the share sheet cannot read this phone's key. That is the state
// worth looking at, and it is the one you can never reach on a healthy device.
export const verifySharedAccess = async () =>
  !(typeof location !== "undefined" && new URLSearchParams(location.search).get("keychain") === "0");
