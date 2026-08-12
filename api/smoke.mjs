// smoke.mjs — is this deploy actually working?
//
//   node api/smoke.mjs https://shelf-api.onrender.com
//
// Every check here is one somebody would otherwise do by eye with curl and jq,
// and every one of them has a failure mode that looks fine in a browser. It
// reports in sentences, because "db: false" is a fact and "DATABASE_URL did not
// attach" is the thing you needed to know.
//
// It touches nothing: no rows are written. There is nothing to write — the
// service holds published snapshots and nothing else, and the shelves live on
// the phone. What is left to check after a deploy is whether the process is up,
// which providers it can actually reach, and whether the routes the app calls
// are mounted.
const BASE = (process.argv[2] || process.env.SHELF_BASE || "").replace(/\/+$/, "");
if (!BASE) {
  console.error("usage: node api/smoke.mjs https://your-api.onrender.com");
  process.exit(2);
}

let bad = 0, warn = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const no = (msg, fix) => { bad++; console.error(`  FAIL  ${msg}${fix ? `\n        → ${fix}` : ""}`); };
const meh = (msg, fix) => { warn++; console.log(`  note  ${msg}${fix ? `\n        → ${fix}` : ""}`); };

async function get(path, opts = {}) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { ...opts, signal: AbortSignal.timeout(90_000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* html, on purpose */ }
    return { status: res.status, json, text, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, error: e.message, ms: Date.now() - started };
  }
}

console.log(`\nshelf smoke test → ${BASE}\n`);

// ── 1. is it there at all ────────────────────────────────────────────────────
console.log("reachable");
const health = await get("/api/health");
if (!health.status) {
  no(`could not reach it at all (${health.error})`,
     "check the URL, and that the Render service finished deploying");
  console.log(`\n${bad} failed — nothing else can be checked until it answers.`);
  process.exit(1);
}
ok(`answered in ${(health.ms / 1000).toFixed(1)}s`);
if (health.ms > 20_000) {
  meh("that was a cold start (Render sleeps after ~15 min, Neon suspends after ~5)",
      "run it again — the second call is the honest one");
}
if (!health.json) {
  no("/api/health did not return JSON", "the process is probably crash-looping; read the Render logs");
  process.exit(1);
}

// ── 2. which build, and what it holds ────────────────────────────────────────
console.log("\nbuild");
const h = health.json;
if (h.commit) ok(`running ${h.commit}`);
else meh("this build does not report its commit", "redeploy from main — otherwise a fix and the code answering cannot be told apart");

// A DATABASE IS NO LONGER REQUIRED FOR THE APP TO WORK. It backs published
// links only, so `db: false` degrades one feature rather than breaking the
// product — and saying that plainly is the difference between a smoke test and
// an alarm nobody can act on.
if (h.db) {
  ok(`published links are readable — ${h.published?.links ?? 0} live, opened ${h.published?.opened ?? 0} times`);
} else {
  meh("no database attached — resolving and shelving still work, publishing a link does not",
      "set DATABASE_URL if you want /s/<code> links; leave it unset if you do not");
}

// ── 3. what it can actually do ───────────────────────────────────────────────
console.log("\nproviders");
const p = h.providers ?? {};
if (p.claude) ok(`Claude key present (model ${h.model})`);
else no("no ANTHROPIC_API_KEY — shared reels will land in the Inbox with no title",
        "everything else still works; add the key when you want the reel path");
if (p.tmdb) ok("Movies search is on");
else meh("Movies search is off (no TMDB_API_KEY)", "the Add screen says so out loud rather than returning nothing");
// PLACES HAS TWO PROVIDERS AND ONE OF THEM IS FREE. Reporting only the paid one
// would say "restaurants are off" about a service that geocodes them fine.
if (p.places_osm) ok(`Places: OpenStreetMap${p.places_google ? " + Google (metered)" : " only — free, keyless, no billing account"}`);
else no("no place provider at all", "OSM needs no key; if it is reporting false, the build is wrong");

// There is no worker section any more, and no queue behind it. Resolution
// happens inside the request the app makes, with a row on screen saying so.

// ── 5. the routes the app will actually call ─────────────────────────────────
console.log("\nrouting");
// THE ROUTE THE WHOLE APP RUNS ON, asked a question it must refuse. A missing
// url is a 400 from resolveRoute itself, so a 400 here proves the router
// reached it — without spending a Claude call or a scrape on a smoke test.
const resolve = await get("/api/resolve", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
});
if (resolve.status === 400 && /url is required/.test(resolve.text)) {
  ok("POST /api/resolve is mounted and validates its input");
} else if (resolve.status === 401) {
  meh("POST /api/resolve wants an app key", h.app_key_required
    ? "expected — SHELF_APP_KEY is set, so only a build carrying it can resolve"
    : "unexpected: health says no key is required. Something is inconsistent.");
} else {
  no(`POST /api/resolve returned ${resolve.status}: ${resolve.text.slice(0, 120)}`,
     "the app cannot do anything at all if this route is not answering");
}

if (h.app_key_required) ok("the app key is enforced — only builds carrying it can spend money here");
else meh("no SHELF_APP_KEY set: anybody who finds this URL can spend your Claude budget",
         "set it AFTER a build carrying EXPO_PUBLIC_SHELF_KEY is installed, or the app you have gets 401s");

// ── 6. the public surface ────────────────────────────────────────────────────
console.log("\npublic pages");
// A plausible code, not a long one: the route matches 4–16 characters, so an
// over-long string falls through to the generic JSON 404 and this check would
// fail against a perfectly healthy server. (It did, the first time it ran.)
const gone = await get("/s/notarealx");
if (gone.status === 404 && /Nothing here/.test(gone.text)) {
  ok("an unknown share code renders the designed 404, not a stack trace");
} else {
  no(`GET /s/<unknown> returned ${gone.status}`, "the public page router is not mounted");
}
// NOT by looking for og:url on the page above — a dead link deliberately has
// none. Ask the server where it thinks its links point.
if (h.web_base) {
  ok(`share links will point at ${h.web_base}`);
  if (!h.web_base.startsWith("https://")) {
    meh(`that is not https`, "fine locally; on Render it should be the service's own https URL");
  }
} else if (h.web_base === "") {
  meh("the server does not know its own public address",
      "on Render this comes from RENDER_EXTERNAL_URL automatically; set SHELF_WEB_BASE only for a custom domain");
} else {
  meh("this build predates the web_base report", "redeploy from main");
}

// ── verdict ──────────────────────────────────────────────────────────────────
console.log("");
if (bad) {
  console.error(`${bad} failed${warn ? `, ${warn} to note` : ""}. Fix the FAILs above, then run this again.`);
  process.exit(1);
}
console.log(`All checks passed${warn ? `, ${warn} thing(s) to note` : ""}.`);
console.log("Next: share a reel into the app. There is nothing to sign into.");
