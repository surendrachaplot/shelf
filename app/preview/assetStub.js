// @react-native/assets-registry ships Flow-typed .js that esbuild cannot parse.
// Nothing in this harness registers a bundled asset, so a stub is honest.
export function registerAsset() { return 0; }
export function getAssetByID() { return null; }
export default { registerAsset, getAssetByID };
