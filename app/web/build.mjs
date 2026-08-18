// web/build.mjs — the app as a static site.
//
// esbuild, not `expo export -p web`. The reason is that this exact swap-based
// bundle has been building and running every screen of this app in Chromium
// for weeks — it is what preview/shoot.mjs photographs. Metro's web target
// would be a second, unproven build system for the same output, introduced on
// the day the thing needs to go live.
//
// The difference between this and the preview harness is what gets swapped in.
// The harness fakes the NETWORK and the STORE, because it is a test rig. This
// fakes neither: the store is real (localStorage, via web/fs.js, driving the
// real store.ts) and the API is the real service. Only the six native modules
// a browser genuinely does not have are replaced.
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { cp, mkdir, writeFile } from "node:fs/promises";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
// SERVED BY THE API, so it is built into the API's own folder and committed.
//
// Render installs `api/` only — `app/node_modules` does not exist on the
// deploy, so esbuild cannot run there and the bundle cannot be built at deploy
// time. A committed build artifact is the honest trade: `checks.yml` rebuilds
// it on every push and fails if what is committed is stale, so it cannot drift
// silently, which is the only real objection to committing one.
const OUT = here("../../api/public/");

// Where the built site will be served from, so a published link points
// somewhere real. Set by the workflow; a local build gets localhost.
const SITE = process.env.SHELF_WEB_URL || "http://localhost:8080";
const API = process.env.SHELF_API_URL || "https://shelf-api-u8xy.onrender.com";
// The share LINK base is the API host, not this site: /s/<code> is rendered by
// the server. A domain can point both at the same name later; until then the
// link has to work, so it names the host that actually serves those pages.
const SHARE = process.env.SHELF_SHARE_URL || API;

const swap = {
  name: "swap",
  setup(b) {
    b.onResolve({ filter: /^react-native$/ }, () => ({ path: here("../node_modules/react-native-web/dist/index.js") }));
    // The store is REAL here. `expo-file-system` becomes localStorage, and
    // store.ts — atomic write, prev/broken backups, salvage, rescue — runs
    // unchanged on top of it.
    b.onResolve({ filter: /^expo-file-system$/ }, () => ({ path: here("./fs.js") }));
    b.onResolve({ filter: /^expo-secure-store$|^expo-share-extension$|^expo-share-intent$|^expo-linear-gradient$/ },
      () => ({ path: here("./native.js") }));
    b.onResolve({ filter: /^expo-image-picker$|^expo-image-manipulator$/ }, () => ({ path: here("./picker.js") }));
    b.onResolve({ filter: /assets-registry/ }, () => ({ path: here("../preview/assetStub.js") }));
  },
};

await mkdir(OUT, { recursive: true });

const result = await esbuild.build({
  entryPoints: [here("./entry.jsx")],
  bundle: true,
  minify: true,
  outfile: OUT + "bundle.js",
  plugins: [swap],
  loader: { ".js": "jsx", ".tsx": "tsx", ".ts": "ts" },
  define: {
    "process.env.NODE_ENV": '"production"',
    __DEV__: "false",
    global: "globalThis",
    // Baked the same way eas.json bakes them into a build.
    "process.env.EXPO_PUBLIC_SHELF_API": JSON.stringify(API),
    "process.env.EXPO_PUBLIC_SHELF_WEB": JSON.stringify(SHARE),
    "process.env.EXPO_PUBLIC_SHELF_KEY": JSON.stringify(process.env.SHELF_APP_KEY || ""),
  },
  jsx: "automatic",
  resolveExtensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
  metafile: true,
  logLevel: "info",
});

await cp(here("./index.html"), OUT + "index.html");
await cp(here("../assets/icon.png"), OUT + "icon.png").catch(() => {});
// GitHub Pages serves a 404 page for any unknown path. Handing it the app
// means /?url=… deep links and a refresh on any path still land in the app
// instead of on GitHub's own 404.
await cp(here("./index.html"), OUT + "404.html");

// The manifest is written rather than copied because `share_target` has to
// name this site's real address, which is only known at build time.
await writeFile(OUT + "manifest.webmanifest", JSON.stringify({
  name: "shelf",
  short_name: "shelf",
  description: "Share a reel, it lands on a shelf.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#FFFFFF",
  theme_color: "#FFFFFF",
  icons: [{ src: "./icon.png", sizes: "1024x1024", type: "image/png", purpose: "any maskable" }],
  // ANDROID CAN SHARE INTO THIS. Installed from Chrome, shelf appears in the
  // system share sheet and a shared reel arrives as ?url=… — which is exactly
  // what web/native.js reads. iOS has no equivalent and pasting is the way in
  // there; saying so is better than a button that does nothing.
  share_target: {
    action: "./",
    method: "GET",
    params: { title: "title", text: "text", url: "url" },
  },
}, null, 2));

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`web build: ${(bytes / 1024).toFixed(0)} kB → ${OUT}`);
console.log(`  api:   ${API}`);
console.log(`  share: ${SHARE}`);
console.log(`  site:  ${SITE}`);
