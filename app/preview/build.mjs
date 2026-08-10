// Bundle the REAL components through react-native-web, swapping only the four
// native modules and the network layer.
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const swap = {
  name: "swap",
  setup(b) {
    b.onResolve({ filter: /^react-native$/ }, () => ({ path: here("../node_modules/react-native-web/dist/index.js") }));
    b.onResolve({ filter: /^expo-linear-gradient$|^expo-share-extension$|^expo-file-system$|^expo-secure-store$/ }, () => ({ path: here("./nativeStubs.js") }));
    // Both spellings: App.tsx imports "./src/api", every component inside
    // src/ imports "./api". Matching only the first one is how a new screen
    // silently reaches the real network in a harness that has none.
    b.onResolve({ filter: /^\.{1,2}\/(?:src\/)?api(\.[tj]s)?$/ }, () => ({ path: here("./stubs.js") }));
    b.onResolve({ filter: /^\.{1,2}\/(?:src\/)?tokenStore(\.[tj]s)?$/ }, () => ({ path: here("./tokenStub.js") }));
    b.onResolve({ filter: /assets-registry/ }, () => ({ path: here("./assetStub.js") }));
  },
};

await esbuild.build({
  entryPoints: [here("./entry.jsx")],
  bundle: true,
  outfile: here("./bundle.js"),
  plugins: [swap],
  loader: { ".js": "jsx", ".tsx": "tsx", ".ts": "ts" },
  define: { "process.env.NODE_ENV": '"development"', __DEV__: "true", global: "globalThis" },
  jsx: "automatic",
  // react-native-svg ships .web.js variants; RNW projects resolve these first.
  resolveExtensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
  logLevel: "info",
});
