// spike-ig.mjs — the measurement OPERATIONS.md §0 asks for, as a command.
//
//   node spike-ig.mjs urls.txt          # one reel URL per line, # for comments
//   node spike-ig.mjs urls.txt --json   # machine-readable, for pasting into a doc
//
// RUN THIS FROM THE SERVER, NOT YOUR LAPTOP. Datacentre IPs are blocked far
// more aggressively than residential ones, and a spike that passes at home and
// is never repeated from Render is the classic way this ships working-in-dev
// and empty-in-prod. The script prints which IP class it thinks it is on so a
// pasted result cannot be ambiguous about where it was taken.
//
// It reports, per resolver, how often a caption came back AND how usable it
// was — a 100% hit rate of 12-character truncated og: descriptions is not a
// working caption path, and a bare success count would hide that.
import { readFile } from "node:fs/promises";
import { fetchT, BROWSER_HEADERS, isBotWall } from "./net.js";
import { parseInstagramUrl, embedUrl, extractInstagram } from "./resolve.js";

const JSON_OUT = process.argv.includes("--json");
const file = process.argv[2];

if (!file || file.startsWith("--")) {
  console.error("usage: node spike-ig.mjs <urls.txt> [--json]");
  process.exit(1);
}

// Enough to name a thing and say something about it. Below this the caption is
// technically present and practically useless, which is the distinction the
// whole spike exists to make.
const USABLE_CHARS = 25;

async function probe(url, label, ms = 15000) {
  const t0 = Date.now();
  try {
    const r = await fetchT(url, { headers: BROWSER_HEADERS, redirect: "follow" }, ms);
    const html = await r.text();
    const ms_ = Date.now() - t0;
    if (isBotWall(r.status, html)) return { label, outcome: "blocked", status: r.status, ms: ms_ };
    const got = extractInstagram(html);
    if (!got.caption) return { label, outcome: "empty", status: r.status, ms: ms_, bytes: html.length };
    return {
      label,
      outcome: got.caption.length >= USABLE_CHARS ? "usable" : "thin",
      status: r.status, ms: ms_, via: got.via,
      chars: got.caption.length,
      hasImage: !!got.imageUrl, hasLocation: !!got.locationTag, hasAuthor: !!got.authorHandle,
      sample: got.caption.replace(/\s+/g, " ").slice(0, 70),
    };
  } catch (e) {
    return { label, outcome: "error", error: e.name === "AbortError" ? "timeout" : e.message, ms: Date.now() - t0 };
  }
}

const raw = await readFile(file, "utf8");
const urls = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
if (!urls.length) { console.error("no urls in " + file); process.exit(1); }

// Where am I? A result without this is not interpretable.
let egress = { ip: null, org: null };
try {
  const r = await fetchT("https://ipinfo.io/json", { headers: { Accept: "application/json" } }, 8000);
  const j = await r.json();
  egress = { ip: j.ip, org: j.org || j.asn?.name || null };
} catch (_) { /* no network metadata; the run still means something */ }

const results = [];
for (const u of urls) {
  const ig = parseInstagramUrl(u);
  if (!ig) { results.push({ url: u, skipped: "not an instagram url" }); continue; }
  const embed = await probe(embedUrl(ig), "embed");
  // Only spend the second request when the first failed — that is the real
  // chain's behaviour, and measuring anything else measures a system we do not
  // ship.
  const canonical = embed.outcome === "usable"
    ? { label: "canonical", outcome: "not attempted" }
    : await probe(`https://www.instagram.com/${ig.kind === "p" ? "p" : "reel"}/${ig.shortcode}/`, "canonical");
  const winner = embed.outcome === "usable" ? "embed"
    : canonical.outcome === "usable" ? "canonical"
    : embed.outcome === "thin" || canonical.outcome === "thin" ? "thin-only"
    : "none";
  results.push({ url: u, shortcode: ig.shortcode, embed, canonical, winner });
  if (!JSON_OUT) {
    const w = winner.padEnd(11);
    const detail = embed.outcome === "usable" ? embed : canonical.outcome === "usable" ? canonical : embed;
    console.log(`${w} ${ig.shortcode.padEnd(14)} embed=${embed.outcome.padEnd(8)} canon=${canonical.outcome.padEnd(13)} ${detail.sample ? '"' + detail.sample + '"' : (detail.error || "")}`);
  }
  await new Promise((r) => setTimeout(r, 1200)); // do not hammer; a burst is its own reason to get blocked
}

const attempted = results.filter((r) => !r.skipped);
const tally = (pred) => attempted.filter(pred).length;
const pct = (n) => attempted.length ? Math.round((n / attempted.length) * 100) : 0;

const summary = {
  taken_from: egress,
  urls: attempted.length,
  embed_usable: tally((r) => r.embed.outcome === "usable"),
  embed_blocked: tally((r) => r.embed.outcome === "blocked"),
  canonical_rescued: tally((r) => r.embed.outcome !== "usable" && r.canonical.outcome === "usable"),
  chain_usable: tally((r) => r.winner === "embed" || r.winner === "canonical"),
  thin_only: tally((r) => r.winner === "thin-only"),
  nothing: tally((r) => r.winner === "none"),
  with_location_tag: tally((r) => r.embed.hasLocation || r.canonical.hasLocation),
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  console.log("\n─── summary ───────────────────────────────────────────");
  console.log(`taken from       ${egress.ip || "unknown ip"}  ${egress.org || ""}`);
  if (!egress.org) {
    console.log("  ⚠ could not determine the egress network, so this run cannot vouch");
    console.log("    for where it was taken. Confirm you are on the Render box.");
  } else if (!/amazon|google|microsoft|digitalocean|hetzner|ovh|linode|render|fly\.io|cloudflare/i.test(egress.org)) {
    console.log("  ⚠ this does NOT look like a datacentre IP — a pass here does not");
    console.log("    predict production. Re-run from the Render box before trusting it.");
  }
  console.log(`urls tried       ${summary.urls}`);
  console.log(`embed usable     ${summary.embed_usable}  (${pct(summary.embed_usable)}%)   blocked: ${summary.embed_blocked}`);
  console.log(`canonical saved  ${summary.canonical_rescued}`);
  console.log(`CHAIN USABLE     ${summary.chain_usable}  (${pct(summary.chain_usable)}%)   ← the number to write down`);
  console.log(`thin only        ${summary.thin_only}`);
  console.log(`nothing at all   ${summary.nothing}`);
  console.log(`location tagged  ${summary.with_location_tag}`);
  console.log("");
  // A verdict on zero samples is worse than no verdict: it reads like a
  // measurement and is not one.
  if (!attempted.length) {
    console.log("→ No Instagram URLs were measured, so there is nothing to conclude.");
    console.log("  Put real reel URLs in the file and run it again.");
    process.exit(0);
  }
  if (pct(summary.chain_usable) >= 70) {
    console.log("→ Free chain carries it. Ship without a paid resolver; leave IG_RESOLVER_* unset.");
  } else if (pct(summary.chain_usable) >= 30) {
    console.log("→ Partial. Keep the free chain first and set IG_RESOLVER_* as the fallback.");
  } else {
    console.log("→ Free chain is dead from here. Either lead with a paid resolver, or lean on");
    console.log("  the screenshot path — it depends on Meta for nothing and always works.");
  }
  console.log("\nWrite the CHAIN USABLE percentage and this date into OPERATIONS.md §0.");
}

process.exit(0);
