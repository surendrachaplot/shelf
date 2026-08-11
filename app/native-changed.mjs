// native-changed.mjs — did this change need a rebuild, or will an OTA do?
//
//   node app/native-changed.mjs <git-range>      e.g. HEAD~1..HEAD
//
// EAS Update ships JAVASCRIPT AND ASSETS. It cannot ship native code. So a
// change to a config plugin, an entitlement, a native dependency or anything
// under ios/ reaches the phone only through a new build — and the failure mode
// is the worst kind: the update publishes, the app takes it, and the thing you
// changed is simply not there. No error, no clue.
//
// This is what the CI workflow consults before telling you an update is live.
import { execSync } from "node:child_process";

const range = process.argv[2] || "HEAD~1..HEAD";

// Paths whose changes CANNOT travel over the air.
const NATIVE = [
  { re: /^app\/app\.json$/, why: "app.json drives the native project — plugins, entitlements, bundle id, name, icons" },
  { re: /^app\/plugins\//, why: "config plugins only run at prebuild, which only happens in a build" },
  { re: /^app\/ios\//, why: "native project files" },
  { re: /^app\/android\//, why: "native project files" },
  { re: /^app\/package\.json$/, why: "a dependency change may add or remove native code" },
  { re: /^app\/package-lock\.json$/, why: "a dependency change may add or remove native code" },
  { re: /^app\/eas\.json$/, why: "build profiles and the env baked into a build" },
  { re: /^app\/metro\.config\.js$/, why: "how the extension's bundle is produced" },
];

let files;
try {
  files = execSync(`git diff --name-only ${range}`, { encoding: "utf8" }).split("\n").filter(Boolean);
} catch (e) {
  console.error(`could not diff ${range}: ${e.message}`);
  process.exit(2);
}

const app = files.filter((f) => f.startsWith("app/"));
if (!app.length) {
  console.log("no app changes in this range — nothing to publish");
  process.exit(3);   // distinct: "nothing to do", not "needs a build"
}

const hits = [];
for (const f of app) {
  const rule = NATIVE.find((r) => r.re.test(f));
  if (rule) hits.push({ f, why: rule.why });
}

if (!hits.length) {
  console.log(`${app.length} app file(s) changed, all JavaScript or assets — an over-the-air update covers this.`);
  process.exit(0);
}

console.error("NATIVE CHANGE — an over-the-air update will NOT deliver this:\n");
for (const h of hits) console.error(`  ${h.f}\n    ${h.why}`);
console.error("\nRun `npm run build:preview` and install the new build. Publishing an update");
console.error("instead is worse than doing nothing: it succeeds, the app takes it, and the");
console.error("change is silently absent.");
process.exit(1);
