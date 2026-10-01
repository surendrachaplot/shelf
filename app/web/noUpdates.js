// web/noUpdates.js — expo-updates, in a browser: there is none.
//
// It THROWS on load, on purpose. `native.ts` fetches the module inside a
// try/catch and treats a failure as "this platform has no such thing", so the
// Version block simply does not render on the web — which is the honest
// answer. A stub that resolved would draw a button that does nothing.
throw new Error("no over-the-air updates on the web");
