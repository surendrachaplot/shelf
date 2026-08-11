// smoke.mjs — is this deploy actually working?
//
//   node api/smoke.mjs https://shelf-api.onrender.com
//
// Every check here is one somebody would otherwise do by eye with curl and jq,
// and every one of them has a failure mode that looks fine in a browser. It
// reports in sentences, because "db: false" is a fact and "DATABASE_URL did not
// attach" is the thing you needed to know.
//
// It touches nothing: no rows are written, no pairing code is spent. The one
// mutating-looking call is a deliberately invalid pair redemption, which is how
// you prove the router, the database and auth are all alive without side
// effects.
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

// ── 2. the database ──────────────────────────────────────────────────────────
console.log("\ndatabase");
const h = health.json;
if (h.db) {
  ok("DATABASE_URL is attached and migrations ran");
} else {
  no("DATABASE_URL is not set or did not attach",
     "paste the Neon connection string into shelf-api's environment, keeping ?sslmode=require");
}
if (h.queue) {
  ok(`queue readable — ${h.queue.filed} filed, ${h.queue.inbox} in the inbox, ${h.queue.pending} pending`);
  if (h.queue.stuck > 0) {
    meh(`${h.queue.stuck} share(s) have failed 4 times and stopped retrying`,
        "they are in the Inbox with whatever we got — check last_error on those rows");
  }
} else if (h.db) {
  no("the database is attached but the queue could not be read", `db_error: ${h.db_error ?? "unknown"}`);
}

// ── 3. what it can actually do ───────────────────────────────────────────────
console.log("\nproviders");
const p = h.providers ?? {};
if (p.claude) ok(`Claude key present (model ${h.model})`);
else no("no ANTHROPIC_API_KEY — shared reels will land in the Inbox with no title",
        "everything else still works; add the key when you want the reel path");
for (const [key, what] of [["tmdb", "Movies search"], ["places", "Restaurants search"]]) {
  if (p[key]) ok(`${what} is on`);
  else meh(`${what} is off (no key)`, "the Add screen says so out loud rather than returning nothing");
}

// ── 4. the worker ────────────────────────────────────────────────────────────
console.log("\nworker");
if (h.worker) ok(`drain arrangement: ${h.worker}`);
else meh("this build predates the worker-mode report", "redeploy from main");
if (h.warn) {
  no(h.warn, h.worker === "in-process"
    ? "read the Render logs for a failing resolve"
    : "set WORKER_IN_PROCESS=1 on shelf-api — the free tier has no worker service");
}

// ── 5. the routes the app will actually call ─────────────────────────────────
console.log("\nrouting");
const auth = await get("/api/items?list=books");
if (auth.status === 401) ok("an unauthenticated read is refused (auth is live)");
else no(`GET /api/items returned ${auth.status}, expected 401`, "the router or auth is not wired as expected");

const pair = await get("/api/pair/redeem", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "NOPE", device: "smoke" }),
});
if (pair.status === 401 && /bad or expired/.test(pair.text)) {
  ok("a bad pairing code is refused — router, database and auth are all live");
} else if (pair.status >= 500) {
  no(`POST /api/pair/redeem returned ${pair.status}`, "almost always the database not attaching — check DATABASE_URL");
} else {
  no(`POST /api/pair/redeem returned ${pair.status}: ${pair.text.slice(0, 120)}`);
}

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
console.log("Next: node api/auth.js --pair you@email.com in the Render shell, then pair the app.");
