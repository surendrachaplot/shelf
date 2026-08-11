// preflight.mjs — fail in 2 seconds locally instead of 10 minutes on EAS.
//
// Every check here is one that has ALREADY cost a failed remote build. A build
// that fails on somebody else's machine, ten minutes after upload, with an
// Xcode error naming a Swift module you have never heard of, is the most
// expensive way there is to learn that a package version is wrong.
//
// Runs automatically before `npm run build:dev`.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), "utf8"));

let bad = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const no = (m, fix) => { bad++; console.error(`  FAIL  ${m}${fix ? `\n        → ${fix}` : ""}`); };

const pkg = read("./package.json");
const app = read("./app.json").expo;

console.log("\npreflight\n");

// ── 1. is what is INSTALLED what package.json asks for? ──────────────────────
// The failure this catches: pulling a version bump and building without
// reinstalling. package.json says one thing, node_modules holds another, and
// EAS builds from the lockfile — so the error you get describes a version you
// are not looking at.
const installed = (name) => {
  const p = `./node_modules/${name}/package.json`;
  return existsSync(here(p)) ? read(p).version : null;
};

const expoVersion = installed("expo");
if (!expoVersion) {
  no("expo is not installed", "run `npm ci`");
} else {
  const sdk = Number(expoVersion.split(".")[0]);
  ok(`Expo SDK ${sdk} (expo ${expoVersion})`);

  // ── 2. the one that cost two remote builds ─────────────────────────────────
  // expo-share-extension's Swift imports a React Native module that only
  // exists in newer RN. Its own README carries this table; getting it wrong
  // fails as `no such module 'ReactAppDependencyProvider'` in Xcode, which
  // names neither the package nor the version.
  const NEEDED = { 50: 1, 51: 1, 52: 3, 53: 4, 54: 5 };
  const want = NEEDED[sdk];
  const got = installed("expo-share-extension");
  if (!got) {
    no("expo-share-extension is not installed", "run `npm ci`");
  } else {
    const major = Number(got.split(".")[0]);
    if (want && major !== want) {
      no(`expo-share-extension ${got} against Expo SDK ${sdk} — that combination does not compile`,
         `SDK ${sdk} needs ${want}.x. Set "expo-share-extension": "^${want}.0.0" in package.json, then \`npm install\`.`);
    } else {
      ok(`expo-share-extension ${got} matches SDK ${sdk}`);
    }
  }

  // The direct form of the same check: read the Swift that will be compiled.
  const swift = "./node_modules/expo-share-extension/plugin/swift/ShareExtensionViewController.swift";
  if (existsSync(here(swift))) {
    const src = readFileSync(here(swift), "utf8");
    const rn = installed("react-native");
    const rnMinor = rn ? Number(rn.split(".")[1]) : null;
    if (/import ReactAppDependencyProvider/.test(src) && rnMinor !== null && rnMinor < 77) {
      no(`the share extension's Swift imports ReactAppDependencyProvider, which does not exist in react-native ${rn}`,
         "this is the same version mismatch as above — Xcode will fail with `no such module`");
    } else {
      ok(`the share extension's Swift imports nothing react-native ${rn} lacks`);
    }
  }
}

// ── 3. lockfile in sync ──────────────────────────────────────────────────────
// EAS runs `npm ci`, which refuses to reconcile a lockfile with package.json —
// it errors. Locally `npm install` papers over it, so this only ever surfaces
// remotely, after the upload.
try {
  const lock = read("./package-lock.json").packages[""];
  const drift = [];
  for (const section of ["dependencies", "devDependencies"]) {
    const a = new Set(Object.keys(pkg[section] ?? {}));
    const b = new Set(Object.keys(lock[section] ?? {}));
    for (const k of a) if (!b.has(k)) drift.push(`+${k}`);
    for (const k of b) if (!a.has(k)) drift.push(`-${k}`);
  }
  if (drift.length) no(`package-lock.json is out of sync (${drift.join(" ")})`, "run `npm install` to regenerate it, and commit it");
  else ok("package-lock.json matches package.json");
} catch (_) {
  no("package-lock.json is missing or unreadable", "run `npm install`");
}

// ── 4. plugin order ──────────────────────────────────────────────────────────
// Mods sharing a key wrap each other, so the LAST plugin listed runs FIRST.
// The keychain plugin has to run after the share-extension plugin writes the
// entitlements file, which means being listed before it. Getting this backwards
// builds an app that installs, pairs, and then silently fails every share.
const plugins = (app.plugins ?? []).map((x) => (Array.isArray(x) ? x[0] : x));
const iKey = plugins.findIndex((x) => String(x).includes("withShareExtensionKeychain"));
const iShare = plugins.findIndex((x) => String(x) === "expo-share-extension");
if (iKey === -1) {
  no("withShareExtensionKeychain is not in app.json plugins",
     "without it the share extension cannot read the Keychain and every share silently does nothing");
} else if (iShare === -1) {
  no("expo-share-extension is not in app.json plugins");
} else if (iKey > iShare) {
  no("withShareExtensionKeychain is listed AFTER expo-share-extension",
     "mods run last-listed-first, so it must be listed BEFORE it to run after it");
} else {
  ok("config plugins are in the order that makes the keychain group land");
}

// ── 5. the entry points the native side looks for by name ────────────────────
if (!existsSync(here("./index.share.js"))) {
  no("index.share.js is missing", "metro builds index.share.bundle for the extension by that exact name");
} else if (!/registerComponent\("shareExtension"/.test(readFileSync(here("./index.share.js"), "utf8"))) {
  no("index.share.js does not register a component called \"shareExtension\"",
     "the ViewController loads it with withModuleName: \"shareExtension\" — a rename builds a blank sheet");
} else {
  ok("the extension entry point and component name match the native side");
}

// ── 6. the app knows where the server is ─────────────────────────────────────
try {
  const eas = read("./eas.json");
  const url = eas.build?.development?.env?.EXPO_PUBLIC_SHELF_API;
  const src = readFileSync(here("./src/api.ts"), "utf8");
  const fallback = /EXPO_PUBLIC_SHELF_API \?\? "([^"]+)"/.exec(src)?.[1];
  if (!url) no("eas.json sets no EXPO_PUBLIC_SHELF_API for the development profile");
  else if (url !== fallback) no(`eas.json (${url}) and api.ts (${fallback}) point at different servers`,
                                "they are read on different launch paths — make them agree");
  else ok(`the app will talk to ${url}`);
} catch (_) {
  no("could not read eas.json or src/api.ts");
}

console.log("");
if (bad) {
  console.error(`${bad} problem(s). Fixing them here costs seconds; EAS finds them ten minutes after upload.\n`);
  process.exit(1);
}
console.log("Preflight clean — safe to build.\n");
