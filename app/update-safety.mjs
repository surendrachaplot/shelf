// update-safety.mjs — can the phone actually RUN the update we are about to
// publish?
//
//   node app/update-safety.mjs <commit-the-last-build-was-made-from>
//
// ── WHY THIS EXISTS, and why native-changed.mjs was not enough ───────────────
//
// On 2026-08-12 an update was published whose JavaScript imports
// `expo-share-intent`. That imports `expo-linking`, whose module does
// `requireNativeModule('ExpoLinking')` at the TOP LEVEL — no optional variant,
// no guard. The installed binary was built before any of those packages
// existed, so the line threw while the bundle was being evaluated, before one
// component rendered.
//
// expo-updates then did the right thing and fell back to the EMBEDDED bundle:
// the JavaScript baked into the binary at build time. That build predated the
// local-first rewrite by four hours, so the app silently reverted to the
// version that fetched shelves from a server — and said "Couldn't reach your
// shelves", because the server had had no shelves since that rewrite.
//
// From the outside it was indistinguishable from losing everything.
//
// ── THE HOLE, precisely ─────────────────────────────────────────────────────
//
// `native-changed.mjs` diffs a COMMIT RANGE, and it worked exactly as written:
// it refused the push that added expo-share-intent. Then the NEXT push had a
// clean range — no package.json in it — so the same guard waved through a
// bundle that imports the package the previous push was refused for.
//
// A range-based guard can only ever say "this push adds native code". The
// question that matters is "does the JS we are about to publish need anything
// the BINARY ON THE PHONE does not have", and that is cumulative. Every commit
// since the last build counts, not just the last one.
//
// So this compares HEAD against the commit the last BUILD was made from. That
// commit is not in git anywhere — it is a fact about a binary — so it is
// passed in, read from `eas build:list` by the caller.
//
// UNKNOWN IS NOT SAFE. With no base commit this exits non-zero and says so,
// rather than assuming the best about somebody else's phone.
import { execSync } from "node:child_process";
import { nativeHits, depDrift, EXEMPT } from "./native-rules.mjs";

const base = process.argv[2];

const die = (code, ...lines) => { console.error(lines.join("\n")); process.exit(code); };

if (!base) {
  die(2,
    "update-safety: no base commit given.",
    "",
    "Pass the commit the INSTALLED BUILD was made from:",
    "  eas build:list --limit 1 --status finished --non-interactive --json | jq -r '.[0].gitCommitHash'",
    "",
    "Refusing rather than guessing: an update that a binary cannot run does not",
    "fail loudly on the phone, it silently reverts the app to whatever was baked",
    "in at build time.");
}

const at = (ref, path) => {
  try { return JSON.parse(execSync(`git show ${ref}:${path}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (_) { return null; }
};

if (!at(base, "app/package.json")) {
  die(2,
    `update-safety: cannot read app/package.json at ${base}.`,
    "",
    "Either that commit is not in this clone (fetch-depth: 0 on the checkout),",
    "or the build was made from a commit that no longer exists. Unknown is not safe.");
}

let changed;
try {
  changed = execSync(`git diff --name-only ${base}..HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean);
} catch (e) {
  die(2, `update-safety: could not diff ${base}..HEAD — ${e.message}`);
}

// ── 1. dependencies, which is the one that broke ────────────────────────────
const drift = depDrift(at(base, "app/package.json"), at("HEAD", "app/package.json"));

// ── 2. everything else a build bakes in ─────────────────────────────────────
// The `scripts`/`owner` exemptions still apply — they cannot reach a binary
// from any distance. A DEPENDENCY change is caught above with a better message,
// so package.json is not reported twice.
const isExempt = (f) => {
  const rule = EXEMPT[f];
  if (!rule) return false;
  const strip = (ref) => { const j = at(ref, f); if (!j) return null; rule.strip(j); return JSON.stringify(j); };
  const a = strip(base), b = strip("HEAD");
  if (a !== null && b !== null && a === b) return true;
  // package.json's remaining difference IS the dependency drift, already said.
  return f === "app/package.json" && drift.any;
};
const hits = nativeHits(changed, isExempt);

// ── the answer ──────────────────────────────────────────────────────────────
console.log(`update-safety: HEAD vs the installed build (${base.slice(0, 7)})`);
console.log(`  ${changed.filter((f) => f.startsWith("app/")).length} app file(s) changed since that build\n`);

if (!drift.any && !hits.length) {
  console.log("The installed binary can run this bundle. Safe to publish.");
  process.exit(0);
}

console.error("THE INSTALLED BUILD CANNOT RUN THIS BUNDLE.\n");

if (drift.any) {
  console.error("  Dependencies differ from the binary on the phone:");
  for (const n of drift.added) console.error(`    + ${n}   NOT in the installed build`);
  for (const n of drift.removed) console.error(`    - ${n}   in the build, gone from the bundle`);
  for (const c of drift.changed) console.error(`    ~ ${c.name}   ${c.from} → ${c.to}`);
  console.error("");
  console.error("  A package added since the build has no native module in that binary.");
  console.error("  If anything in its import chain calls requireNativeModule at the top");
  console.error("  level — expo-linking does — the bundle throws before it renders, and");
  console.error("  the app silently reverts to the JavaScript baked in at build time.");
  console.error("");
}

if (hits.length) {
  console.error("  Baked in at build time, changed since:");
  for (const h of hits) console.error(`    ${h.f}\n      ${h.why}`);
  console.error("");
}

console.error("Build and install first — `npm run build:preview`. Publishing instead");
console.error("does not fail on the phone, it reverts the app to whatever the binary");
console.error("was built with, which is exactly how this outage looked like data loss.");
process.exit(1);
