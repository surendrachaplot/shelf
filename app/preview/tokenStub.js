// `?paired=0` renders the pairing screen instead of the shelves.
const paired = typeof location !== "undefined" && new URLSearchParams(location.search).get("paired") !== "0";
export const getToken = async () => (paired ? "shelf_preview" : null);
export const setToken = async () => {};
export const clearToken = async () => {};
export const verifySharedAccess = async () => true;
