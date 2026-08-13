// store-selftest.mjs — the file that holds everything you have saved.
//
// WHY THIS EXISTS, in one sentence: `load` used to end `catch { return
// emptyShelf() }`, so every possible read failure reached the screen as
// "nothing on your shelf", and it took a person on a phone to find out.
//
// Every case below is a way a JSON file on a phone actually goes wrong —
// truncated by a full disk, a key of the wrong type, a field a later version
// added — and the assertion is always the same two things: the app can tell
// what happened, and the bytes are still there afterwards.
//
// It runs the REAL store.ts. esbuild bundles it with `expo-file-system` aliased
// to an in-memory Map (preview/fakeFs.js), so there is no second copy of the
// logic to drift away from the one that ships.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), "shelf-store-")), "store.mjs");

await build({
  entryPoints: [here("./src/store.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent",
  alias: { "expo-file-system": here("./preview/fakeFs.js") },
});

const S = await import(out);
const fs = globalThis.__fs;

let fail = 0;
const ok = (c, label, got) => {
  if (c) return;
  fail++;
  console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`);
};

const item = (id, list = "books", extra = {}) => ({
  id, list, status: "filed", title: id, subtitle: "", note: "", image_url: null,
  canonical: {}, confidence: 1, enriched: true, source_url: null, resolver: "x",
  created_at: "2026-01-01T00:00:00.000Z", ...extra,
});
const shelfOf = (items, extra = {}) => JSON.stringify({
  version: 1, items, profile: { name: "S", bio: "", seed: "s", home_city: "London" }, links: [], ...extra,
});
const fresh = () => { fs.reset(); };

// ── 1. the ordinary path ─────────────────────────────────────────────────────
fresh();
{
  const r = await S.load();
  ok(r.state === "fresh", "an empty documents directory is a FIRST LAUNCH", r);
  ok(r.shelf.items.length === 0, "and an empty shelf");
}

fresh();
fs.put("shelf.json", shelfOf([item("a"), item("b")]));
{
  const r = await S.load();
  ok(r.state === "read" && r.shelf.items.length === 2, "a good file reads back", r.state);
  ok(r.shelf.profile.home_city === "London", "and keeps the profile");
}

// ── 2. THE BUG. A file whose shape is wrong is not an empty shelf ────────────
// `{ ...emptyShelf(), ...parsed }` took `links: null` from the file over the
// `links: []` default, `.map` threw one frame later, and the catch presented
// that as a shelf with nothing on it. Reported as "WTF there is nothing on my
// shelf now?".
for (const [label, bad] of [
  ["links: null", shelfOf([item("a")], { links: null })],
  ["links: a number", shelfOf([item("a")], { links: 7 })],
  ["links: a string", shelfOf([item("a")], { links: "" })],
  ["profile: null", shelfOf([item("a")], { profile: null })],
  ["an item that is null", `{"version":1,"items":[null,${JSON.stringify(item("a"))}],"links":[]}`],
]) {
  fresh();
  fs.put("shelf.json", bad);
  const r = await S.load();
  ok(r.state === "read", `${label} still reads`, r);
  ok(r.shelf.items.length === 1, `${label} keeps the item`, r.shelf.items.length);
  ok(Array.isArray(r.shelf.links), `${label} gets a usable links array`, r.shelf.links);
  ok(typeof r.shelf.profile?.name === "string", `${label} gets a usable profile`, r.shelf.profile);
}

// ── 3. a file we genuinely cannot read is never called empty ─────────────────
fresh();
fs.put("shelf.json", "{ this is not json");
{
  const r = await S.load();
  ok(r.state === "unreadable", "garbage is UNREADABLE, not fresh — the whole point", r.state);
  ok(!!r.note && /Couldn't read/.test(r.note), "and says so, with the reason", r.note);
  ok(fs.get("shelf.broken.json") === "{ this is not json", "the bytes are kept before anything writes");
}

// The app carries on and saves, and the shelf is usable again.
{
  await S.save({ version: 1, items: [item("new")], profile: { name: "", bio: "", seed: "", home_city: "" }, links: [] });
  const r = await S.load();
  ok(r.state === "read" && r.shelf.items.length === 1, "and the shelf is usable again", r);
}

// A SECOND BAD BOOT MUST NOT OVERWRITE THE FIRST RESCUE COPY, which is the
// whole reason the copy is written once rather than every time. Whatever went
// wrong the first time tends to go wrong again, and the second file is the one
// with almost nothing in it — copying that over the good one would turn a
// recoverable morning into a permanent loss.
{
  fs.put("shelf.json", "{ broken again, and this time nearly empty");
  const r = await S.load();
  ok(r.state === "unreadable", "the second bad file is unreadable too", r.state);
  ok(fs.get("shelf.broken.json") === "{ this is not json",
     "and the rescue copy still holds the FIRST file, not the second", fs.get("shelf.broken.json"));
}

// ── 4. salvage: a write cut off by a full disk ───────────────────────────────
// The atomic swap prevents this on the shelf itself; a phone that dies mid
// `writeAsStringAsync` still leaves a valid PREFIX. Every item before the cut
// is intact, and losing 41 books because the 42nd was half-written is a choice.
{
  const whole = shelfOf([item("a"), item("b"), item("c", "books", { title: "A } brace in the title" })]);
  const cut = whole.slice(0, whole.length - 60);
  const got = S.salvage(cut);
  ok(got.length >= 2, "salvage lifts whole items out of truncated JSON", got.map((i) => i.id));
  ok(got.every((i) => i.id), "and every one of them is a real item", got);
  ok(S.salvage(whole).length === 3, "a brace inside a title does not end the scan", S.salvage(whole).length);
  ok(S.salvage("not json at all").length === 0, "and nothing is salvaged from nothing");
}

fresh();
{
  const whole = shelfOf([item("a"), item("b"), item("c")]);
  fs.put("shelf.json", whole.slice(0, whole.length - 40));
  const r = await S.load();
  ok(r.state === "unreadable", "a truncated shelf is unreadable", r.state);
  const back = await S.rescuable();
  ok(back && back.items.length >= 2, "and its items are still recoverable", back?.items?.length);
}

// ── 5. a save that SHRINKS the shelf copies what it replaces ─────────────────
fresh();
fs.put("shelf.json", shelfOf([item("a"), item("b"), item("c")]));
{
  const { shelf } = await S.load();
  await S.save(S.remove(shelf, "b"));
  ok(fs.has("shelf.prev.json"), "removing an item leaves an undo beside the file");
  ok(S.salvage(fs.get("shelf.prev.json")).length === 3, "holding what was there before", S.salvage(fs.get("shelf.prev.json")).length);

  // Growing does not: the common save costs nothing extra.
  fs.drop("shelf.prev.json");
  const after = await S.load();
  await S.save(S.upsert(after.shelf, item("d")));
  ok(!fs.has("shelf.prev.json"), "a save that only adds does not copy anything");
}

// ── 6. THE CASE THAT MATTERS: a wipe, and getting it back ────────────────────
fresh();
fs.put("shelf.json", shelfOf([item("a"), item("b"), item("c")]));
{
  const first = await S.load();
  // Something empties the shelf and saves — a bad migration, a bug written in
  // six months' time. This is the shape of the accident, whatever causes it.
  await S.save({ ...first.shelf, items: [] });
  const after = await S.load();
  ok(after.shelf.items.length === 0, "the shelf is now empty, as it would be");
  const { shelf, added } = await S.rescue(after.shelf);
  ok(added === 3, "and all three come back", added);
  ok(shelf.items.map((i) => i.id).sort().join() === "a,b,c", "with their ids", shelf.items.map((i) => i.id));
}

// A restore MERGES: things saved since the accident are not a second casualty.
fresh();
fs.put("shelf.prev.json", shelfOf([item("a"), item("b")]));
{
  const mine = { version: 1, items: [item("a"), item("z")], profile: { name: "", bio: "", seed: "", home_city: "" }, links: [] };
  const { shelf, added } = await S.rescue(mine);
  ok(added === 1, "only what is missing is put back", added);
  ok(shelf.items.some((i) => i.id === "z"), "and nothing already on the shelf is dropped");
}

// ── 7. the file is GONE, but a copy is not ───────────────────────────────────
// Reporting this as a first launch is how a recoverable problem becomes final.
fresh();
fs.put("shelf.prev.json", shelfOf([item("a"), item("b")]));
{
  const r = await S.load();
  ok(r.state === "unreadable", "a missing shelf next to a backup is a LOSS, not a first launch", r.state);
  ok(/put back/.test(r.note ?? ""), "and offers the way out", r.note);
}

// ── 8. the rename, which is what shipped the day the shelf went empty ────────
{
  const m = S.migrate({ version: 1, items: [item("a", "travel")], profile: {}, links: [{ code: "x", kind: "shelf", target: "travel", title: "t", at: "" }] });
  ok(m.items[0].list === "places", "travel becomes places", m.items[0].list);
  ok(m.links[0].target === "places", "and so does a published link", m.links[0].target);

  // Handed a shelf it did not expect, a migration must not throw. This is the
  // exact line that turned a rename into "there is nothing on my shelf".
  for (const [label, shelf] of [
    ["links missing", { version: 1, items: [item("a", "travel")], profile: {} }],
    ["links null", { version: 1, items: [item("a")], profile: {}, links: null }],
    ["items missing", { version: 1, profile: {}, links: [] }],
    ["an item with no list", { version: 1, items: [{ id: "a" }], profile: {}, links: [] }],
    ["a link with no target", { version: 1, items: [], profile: {}, links: [{ code: "x" }] }],
  ]) {
    let threw = null;
    try { S.migrate(shelf); } catch (e) { threw = e.message; }
    ok(threw === null, `migrate survives: ${label}`, threw);
  }

  // A lookup through Object.prototype: "constructor" is not a rename.
  const weird = S.migrate({ version: 1, items: [item("a", "constructor")], profile: {}, links: [] });
  ok(weird.items[0].list === "constructor", "a shelf key is only renamed by an OWN key of the table", weird.items[0].list);
}

console.log(fail ? `store selftest FAILED (${fail})` : "store selftest ok");
process.exit(fail ? 1 : 0);
