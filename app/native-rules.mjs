// native-rules.mjs — what cannot travel over the air, and how to compare two
// points in history for it.
//
// Extracted from native-changed.mjs because a SECOND caller was needed, and
// the second caller is the important one. Read the header of update-safety.mjs
// for why the first one was not enough.
//
// Everything here is PURE — it takes file lists and parsed package.json
// objects and returns findings. Nothing shells out, nothing reads git, so
// native-rules-selftest.mjs can drive every branch with fixtures instead of
// with a repository.

/** Paths whose changes CANNOT travel over the air. */
export const NATIVE = [
  { re: /^app\/app\.json$/, why: "app.json drives the native project — plugins, entitlements, bundle id, name, icons" },
  { re: /^app\/plugins\//, why: "config plugins only run at prebuild, which only happens in a build" },
  { re: /^app\/ios\//, why: "the generated Xcode project — anything here exists only in a binary" },
  { re: /^app\/android\//, why: "the generated Gradle project — anything here exists only in a binary" },
  { re: /^app\/package\.json$/, why: "a dependency change may add or remove native code" },
  { re: /^app\/package-lock\.json$/, why: "a dependency change may add or remove native code" },
  { re: /^app\/eas\.json$/, why: "build profiles and the env baked into a build" },
  { re: /^app\/metro\.config\.js$/, why: "how the extension's bundle is produced" },

  // THE SHARE EXTENSION CANNOT BE UPDATED OVER THE AIR. Not "should not" —
  // cannot: expo-share-extension EXCLUDES expo-updates from the extension's
  // bundle by default, because including it crashes the extension. So the
  // sheet you get over Instagram is frozen at whatever the last BUILD
  // contained, no matter how many updates the app itself takes.
  //
  // This shipped and was reported: quotes and travel went out over the air,
  // the app grew two shelves, and the share sheet kept offering four. The app
  // and its own share sheet disagreed about how many shelves exist, and this
  // file — whose entire job is to say "that needs a build" — said nothing,
  // because ShareExtension.tsx is .tsx under app/ and looked like ordinary JS.
  { re: /^app\/ShareExtension\.tsx$/, why: "the iOS share extension: expo-updates is excluded from its bundle, so nothing here travels over the air" },
  { re: /^app\/index\.share\.js$/, why: "the extension's entry point — same bundle, same rule" },
  { re: /^app\/src\/ShareBoards\.tsx$/, why: "the picker the extension renders; a change here is invisible until you build" },
  // What the picker imports. Not everything in src/ — just the files it
  // actually pulls in, because over-reporting trains you to ignore the answer.
  // `.tsx` and `.jsx` are in this list because they were NOT, and Press.tsx is
  // a .tsx — so every change to the button component the share sheet renders
  // sailed past this guard. Found by the selftest on the day it was written,
  // which is the entire argument for writing one.
  { re: /^app\/src\/(api|theme|Press|design)\.(ts|tsx|js|jsx)$/, why: "the share extension renders this, and its bundle does not update over the air" },
];

/**
 * Keys inside otherwise-native files that cannot reach a binary.
 *
 * `owner`/`extra` are EAS account routing. `scripts` are commands run on a
 * laptop. A guard that fires on a change it knows to be harmless teaches you
 * to ignore the guard, and the one time it is right is the time it matters.
 */
export const EXEMPT = {
  "app/app.json": {
    keys: "`owner`/`extra`", why: "EAS account routing, not the native project",
    strip: (j) => { delete j?.expo?.owner; delete j?.expo?.extra; },
  },
  "app/package.json": {
    keys: "`scripts`", why: "commands that run on a laptop, not code that ships",
    strip: (j) => { delete j?.scripts; },
  },
};

/** Which changed files need a build, and why. */
export const nativeHits = (files, isExempt = () => false) =>
  files
    .filter((f) => f.startsWith("app/"))
    .map((f) => ({ f, rule: NATIVE.find((r) => r.re.test(f)) }))
    .filter(({ f, rule }) => rule && !isExempt(f))
    .map(({ f, rule }) => ({ f, why: rule.why }));

/**
 * THE CHECK THAT WOULD HAVE PREVENTED THE OUTAGE.
 *
 * A JavaScript bundle can only use native modules the INSTALLED BINARY
 * contains. So the question is never "did this commit add a dependency" — it
 * is "does the JS about to be published need anything the binary on the phone
 * does not have". Those are different questions, and only the second one is
 * about the phone.
 *
 * Compares the dependency sets at two points and reports every difference.
 * `dependencies` only: devDependencies never reach a bundle.
 */
export function depDrift(basePkg, headPkg) {
  const a = (basePkg && basePkg.dependencies) || {};
  const b = (headPkg && headPkg.dependencies) || {};
  const added = Object.keys(b).filter((k) => !(k in a)).sort();
  const removed = Object.keys(a).filter((k) => !(k in b)).sort();
  const changed = Object.keys(b)
    .filter((k) => k in a && a[k] !== b[k])
    .sort()
    .map((k) => ({ name: k, from: a[k], to: b[k] }));
  return { added, removed, changed, any: added.length + removed.length + changed.length > 0 };
}
