// native-rules-selftest.mjs — the two questions that decide whether an update
// is safe to publish.
//
// These rules had no test until the day they let an unrunnable bundle through.
// Both functions are pure, so every branch is driven with fixtures here rather
// than with a repository — which means this runs in milliseconds and can sit in
// `npm run preflight`.
import { nativeHits, depDrift, NATIVE, EXEMPT } from "./native-rules.mjs";

let fail = 0;
const ok = (c, label, got) => {
  if (c) return;
  fail++;
  console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`);
};

// ── nativeHits: what needs a build ──────────────────────────────────────────
ok(nativeHits(["app/src/App.tsx", "app/src/store.ts"]).length === 0,
   "ordinary JavaScript travels over the air");
ok(nativeHits(["api/serve.js", "README.md"]).length === 0,
   "nothing outside app/ is the app's problem");

for (const f of [
  "app/app.json", "app/package.json", "app/package-lock.json", "app/eas.json",
  "app/metro.config.js", "app/plugins/withThing.js", "app/ios/Podfile",
  "app/android/build.gradle", "app/ShareExtension.tsx", "app/index.share.js",
  "app/src/ShareBoards.tsx", "app/src/api.ts", "app/src/theme.ts",
  "app/src/Press.tsx", "app/src/design.js",
]) {
  ok(nativeHits([f]).length === 1, `${f} needs a build`, nativeHits([f]));
}

// The share extension's imports are a DELIBERATE subset. Over-reporting trains
// you to ignore the answer, so a file it does not render must not fire.
ok(nativeHits(["app/src/Reveal.tsx"]).length === 0,
   "a src file the extension does not render is not native");

ok(nativeHits(["app/app.json"], (f) => f === "app/app.json").length === 0,
   "the exemption callback can clear a file");

// Every rule carries a reason. A guard that says "no" without saying why gets
// overridden by whoever is in a hurry, which is always.
for (const r of NATIVE) ok(typeof r.why === "string" && r.why.length > 20, `every rule explains itself: ${r.re}`, r.why);
for (const [f, r] of Object.entries(EXEMPT)) {
  ok(typeof r.strip === "function", `${f} exemption can strip`, r);
  ok(typeof r.why === "string" && r.why.length > 10, `${f} exemption explains itself`, r.why);
}

// The exemptions must be NARROW. Stripping the exempt keys from a real change
// must still leave a difference.
{
  const app = (extra) => JSON.parse(JSON.stringify({ expo: { name: "shelf", owner: "x", extra: { eas: 1 }, ...extra } }));
  const strip = (j) => { EXEMPT["app/app.json"].strip(j); return JSON.stringify(j); };
  ok(strip(app({})) === strip(app({ owner: "y", extra: { eas: 2 } })),
     "app.json: owner/extra alone is not a native change");
  ok(strip(app({})) !== strip(app({ name: "other" })),
     "app.json: anything else still is");

  const pkg = (extra) => JSON.parse(JSON.stringify({ dependencies: { expo: "52" }, scripts: { a: "1" }, ...extra }));
  const stripP = (j) => { EXEMPT["app/package.json"].strip(j); return JSON.stringify(j); };
  ok(stripP(pkg({})) === stripP(pkg({ scripts: { a: "1", b: "2" } })),
     "package.json: scripts alone is not a native change");
  ok(stripP(pkg({})) !== stripP(pkg({ dependencies: { expo: "52", "expo-linking": "7" } })),
     "package.json: a dependency still is");
}

// ── depDrift: THE ONE THAT WOULD HAVE STOPPED THE OUTAGE ────────────────────
// The binary was built 2026-08-11. `expo-share-intent` and `expo-linking` were
// added on 2026-08-12. The bundle published after that imported them, and
// expo-linking calls requireNativeModule at the top level, so it threw before
// rendering and the app reverted to the JS baked in at build time.
{
  const built = { dependencies: { expo: "~52.0.0", "expo-file-system": "~18.0.0" } };
  const now = {
    dependencies: {
      expo: "~52.0.0", "expo-file-system": "~18.0.0",
      "expo-share-intent": "^3.1.0", "expo-linking": "~7.0.5",
    },
  };
  const d = depDrift(built, now);
  ok(d.any, "a package added since the build is caught");
  ok(d.added.join() === "expo-linking,expo-share-intent", "and both are named", d.added);
  ok(!d.removed.length && !d.changed.length, "with nothing invented", d);
}

ok(!depDrift({ dependencies: { a: "1" } }, { dependencies: { a: "1" } }).any,
   "an identical dependency set is safe");
ok(depDrift({ dependencies: { a: "1" } }, { dependencies: { a: "2" } }).changed.length === 1,
   "a VERSION bump counts — a different version can carry different native code");
ok(depDrift({ dependencies: { a: "1" } }, { dependencies: {} }).removed.join() === "a",
   "and a removal counts, because the bundle may still import it");

// devDependencies never reach a bundle, so they must never block a publish.
ok(!depDrift({ dependencies: { a: "1" }, devDependencies: { esbuild: "1" } },
             { dependencies: { a: "1" }, devDependencies: { esbuild: "2", playwright: "1" } }).any,
   "devDependencies do not block an update");

// Missing or malformed input must not throw. This runs in the path that
// decides whether to publish; a crash here is a publish that does not happen
// or, worse, a guard that is switched off to get past it.
for (const [label, a, b] of [
  ["both null", null, null],
  ["no deps key", {}, {}],
  ["base null", null, { dependencies: { a: "1" } }],
  ["head null", { dependencies: { a: "1" } }, null],
]) {
  let threw = null;
  try { depDrift(a, b); } catch (e) { threw = e.message; }
  ok(threw === null, `depDrift survives: ${label}`, threw);
}
ok(depDrift(null, { dependencies: { a: "1" } }).added.join() === "a",
   "an unreadable base still reports what the bundle needs");

console.log(fail ? `native-rules selftest FAILED (${fail})` : "native-rules selftest ok");
process.exit(fail ? 1 : 0);
