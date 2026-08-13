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

// Default: everything the last `git pull` brought in. `@{1}` is where HEAD was
// before it moved, so this covers a pull of six commits as correctly as one —
// `HEAD~1..HEAD` would silently miss five of them and tell you an update was
// safe when a native change came in four commits ago.
function defaultRange() {
  try {
    execSync("git rev-parse --verify --quiet @{1}", { stdio: "ignore" });
    return "@{1}..HEAD";
  } catch (_) {
    return "HEAD~1..HEAD";   // no reflog entry yet (a fresh clone)
  }
}
const range = process.argv[2] || defaultRange();

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
  { re: /^app\/src\/(api|theme|Press|design)\.(ts|js)$/, why: "the share extension renders this, and its bundle does not update over the air" },
];

let files;
try {
  files = execSync(`git diff --name-only ${range}`, { encoding: "utf8" }).split("\n").filter(Boolean);
} catch (e) {
  console.error(`could not diff ${range}: ${e.message}`);
  process.exit(2);
}

/**
 * TWO FILES ARE ON THE NATIVE LIST FOR MOST OF THEIR CONTENT, NOT ALL OF IT.
 *
 * app.json, because almost everything in it — plugins, entitlements, bundle
 * id, icons — is baked at prebuild. But `owner` and `extra` only tell EAS
 * which account and project this is, and changing them changes nothing a
 * build produces.
 *
 * package.json, because a dependency change may add or remove native code.
 * But `scripts` are commands that run on a laptop. Adding a selftest to
 * `npm run preflight` cannot alter a binary, and being sent on a twenty-minute
 * TestFlight round trip for it — while a fix somebody is waiting for sits
 * unpublished — is precisely how a guard stops being read.
 *
 * Worth the special cases because the alternative is worse than it sounds:
 * `owner` had to be added for a robot access token to publish at all, and
 * without this, adding it would have blocked the very publish it enables, with
 * "run a full rebuild" as the advice. A guard that fires on a change it knows
 * to be harmless teaches you to ignore the guard — and the one time it is
 * right is the time it matters.
 *
 * Everything ELSE in both files still counts. When a file cannot be read from
 * either side, it counts too: unknown is not safe.
 */
const EXEMPT = {
  "app/app.json": { keys: "`owner`/`extra`", why: "EAS account routing, not the native project",
                    strip: (j) => { delete j?.expo?.owner; delete j?.expo?.extra; } },
  "app/package.json": { keys: "`scripts`", why: "commands that run on a laptop, not code that ships",
                        strip: (j) => { delete j?.scripts; } },
};

function onlyExemptKeysChanged(file, range) {
  const rule = EXEMPT[file];
  if (!rule) return false;
  const [base, head] = String(range).split("..");
  if (!base || !head) return false;
  const at = (ref) => {
    try {
      const j = JSON.parse(execSync(`git show ${ref}:${file}`, { encoding: "utf8" }));
      rule.strip(j);
      return JSON.stringify(j);
    } catch (_) { return null; }
  };
  const a = at(base), b = at(head);
  return a !== null && b !== null && a === b;
}

const app = files.filter((f) => f.startsWith("app/"));
if (!app.length) {
  console.log("no app changes in this range — nothing to publish");
  process.exit(3);   // distinct: "nothing to do", not "needs a build"
}

const hits = [];
for (const f of app) {
  const rule = NATIVE.find((r) => r.re.test(f));
  if (!rule) continue;
  if (onlyExemptKeysChanged(f, range)) {
    const { keys, why } = EXEMPT[f];
    console.log(`${f.replace("app/", "")} changed, but only ${keys} — ${why}`);
    continue;
  }
  hits.push({ f, why: rule.why });
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
