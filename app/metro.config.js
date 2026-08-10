// The share extension is a second bundle. Without withShareExtension, metro
// only ever builds the app's, and the extension ships stale or empty JS.
const { getDefaultConfig } = require("expo/metro-config");
const { withShareExtension } = require("expo-share-extension/metro");

module.exports = withShareExtension(getDefaultConfig(__dirname));
