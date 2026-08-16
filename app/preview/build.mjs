// Bundle the REAL components through react-native-web, swapping only the four
// native modules and the network layer.
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const swap = {
  name: "swap",
  setup(b) {
    b.onResolve({ filter: /^react-native$/ }, () => ({ path: here("../node_modules/react-native-web/dist/index.js") }));
    b.onResolve({ filter: /^expo-linear-gradient$|^expo-share-extension$|^expo-share-intent$|^expo-file-system$|^expo-secure-store$|^expo-image-picker$|^expo-image-manipulator$/ }, () => ({ path: here("./nativeStubs.js") }));
    // Both spellings: App.tsx imports "./src/api", every component inside
    // src/ imports "./api". Matching only the first one is how a new screen
    // silently reaches the real network in a harness that has none.
    b.onResolve({ filter: /^\.{1,2}\/(?:src\/)?api(\.[tj]s)?$/ }, () => ({ path: here("./stubs.js") }));
    // The store is a FILE on the device. A browser has no documents
    // directory, so the harness swaps in an in-memory shelf with real fixtures
    // — same shape, same pure operations, no filesystem.
    b.onResolve({ filter: /^\.{1,2}\/(?:src\/)?store(\.[tj]s)?$/ }, () => ({ path: here("./storeStub.js") }));
    // SafeAreaView's insets are `env(safe-area-inset-*)`, which is ZERO in a
    // browser — which is exactly how the header shipped underneath the status
    // bar with a clean contact sheet behind it. Swapped for a stub carrying an
    // iPhone's real numbers.
    b.onResolve({ filter: /^\.{1,2}\/(?:src\/)?Screen(\.[tj]sx?)?$/ }, () => ({ path: here("./screenStub.jsx") }));
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
