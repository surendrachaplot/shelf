// e2e.mjs — the whole API against a real Postgres, through the real HTTP server.
//
//   node e2e.mjs            (needs DATABASE_URL pointing at a THROWAWAY database)
//
// Why this exists as a checked-in file rather than a session of curl: the
// README claimed "24 end-to-end checks" that nobody else could reproduce, which
// is a claim, not a check. And every rule in OPERATIONS says the same thing —
// a 200 is not a working feature, read the rows. So this drives the server the
// way the app does (bearer tokens, real JSON) and then asserts on what actually
// landed in the database.
//
// It writes to whatever DATABASE_URL points at and drops nothing, so point it
// at a scratch database. It refuses to run against anything whose name does not
// contain "test" or "e2e" — a suite that can be pointed at production by a
// typo eventually is.
import { query, migrate, dbReady } from "./db.js";
import { mintPairCode, userIdFor } from "./auth.js";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:8791";
let pass = 0, fail = 0;

function ok(cond, msg, detail) {
  if (cond) { pass++; return true; }
  fail++;
  console.error(`  FAIL ${msg}${detail === undefined ? "" : `\n        got: ${JSON.stringify(detail)}`}`);
  return false;
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, a);

/**
 * A group that CANNOT take the run down with it.
 *
 * The first version let an exception escape, so a single unexpected shape
 * ended the process with a stack trace and silently skipped every check after
 * it — which looks identical to those checks passing. A crash is a failure of
 * that group and nothing more.
 */
async function group(name, fn) {
  console.log(`\n${name}`);
  try { await fn(); }
  catch (e) {
    fail++;
    console.error(`  FAIL ${name} threw before it finished: ${e.message}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* an HTML page, on purpose */ }
  return { status: res.status, json, text };
}

async function pairUser(email) {
  const { code } = await mintPairCode(email);
  const r = await api("/api/pair/redeem", { method: "POST", body: { code, device: "e2e" } });
  if (!r.json?.token) throw new Error(`could not pair ${email}: ${r.text.slice(0, 200)}`);
  return { id: userIdFor(email), token: r.json.token };
}

// ── run ──────────────────────────────────────────────────────────────────────

if (!dbReady()) {
  console.error("DATABASE_URL is not set. Point it at a THROWAWAY database.");
  process.exit(2);
}
if (!/test|e2e|scratch/i.test(process.env.DATABASE_URL)) {
  console.error("Refusing to run: DATABASE_URL does not look like a scratch database.");
  console.error("Name it something containing 'e2e' or 'test'. This suite writes real rows.");
  process.exit(2);
}

await migrate();
// A clean slate, so a count assertion means what it says.
await query("truncate items, sends, share_links, provider_cache, pair_codes, devices, users cascade");

process.env.SHELF_WEB_BASE ??= "https://shelf.test";
const { default: _serve } = await import("./serve.js").then((m) => ({ default: m })).catch(() => ({ default: null }));
// serve.js listens on import; give it a moment and a port it can have.
await new Promise((r) => setTimeout(r, 400));

const me = await pairUser("suren@example.com");
const them = await pairUser("nadia@example.com");

// ── 1. auth is actually load-bearing ─────────────────────────────────────────
await group("auth", async () => {
  const anon = await api("/api/items?list=books");
  ok(anon.status === 401, "an unauthenticated read is refused", anon.status);
  const wrong = await api("/api/items?list=books", { token: "not-a-token" });
  ok(wrong.status === 401, "a made-up token is refused", wrong.status);
  const dup = await api("/api/pair/redeem", { method: "POST", body: { code: "ZZZZZZZZ", device: "x" } });
  ok(dup.status === 401, "an unknown pairing code is refused", dup.status);
});

// ── 2. profile + handles ─────────────────────────────────────────────────────
await group("profile", async () => {
  const fresh = await api("/api/profile", { token: me.token });
  ok(fresh.json?.needs_handle === true, "a new user is reported as needing a handle", fresh.json);
  ok(fresh.json?.profile?.handle == null, "a new user has no handle yet", fresh.json?.profile);

  const bad = await api("/api/profile", { method: "POST", token: me.token, body: { handle: "a" } });
  ok(bad.status === 400, "a one-character handle is refused", bad.status);
  const reserved = await api("/api/profile", { method: "POST", token: me.token, body: { handle: "api" } });
  ok(reserved.status === 400, "a reserved handle is refused", reserved.json);

  const set = await api("/api/profile", {
    method: "POST", token: me.token,
    body: { handle: "  @Suren ", display_name: "Suren Chaplot", bio: "Things I saw at 1am." },
  });
  ok(set.json?.profile?.handle === "suren", "a handle is normalised on the way in", set.json?.profile?.handle);
  ok(set.json?.needs_handle === false, "needs_handle flips once a handle exists", set.json);

  await api("/api/profile", { method: "POST", token: them.token, body: { handle: "nadia" } });
  const taken = await api("/api/profile", { method: "POST", token: them.token, body: { handle: "SUREN" } });
  ok(taken.status === 409, "a handle already taken is refused, case-insensitively", taken.status);

  // The plate must not move when the handle does — people recognise the mark.
  const before = (await query("select plate_seed from users where id = $1", [me.id])).rows[0].plate_seed;
  await api("/api/profile", { method: "POST", token: me.token, body: { handle: "surenc" } });
  const after = (await query("select plate_seed, handle from users where id = $1", [me.id])).rows[0];
  ok(after.handle === "surenc", "the handle changed", after);
  ok(after.plate_seed === before, "the ex-libris seed is PINNED across a rename", after.plate_seed);
  await api("/api/profile", { method: "POST", token: me.token, body: { handle: "suren" } });
});

// ── 3. search and add ────────────────────────────────────────────────────────
let addedId = null;
await group("add", async () => {
  const short = await api("/api/search?q=a", { token: me.token });
  eq(short.json?.results, [], "a one-character query never reaches a provider");

  const noKey = await api("/api/search?q=piranesi&list=movies", { token: me.token });
  ok(Array.isArray(noKey.json?.unavailable), "search reports which providers it could not use", noKey.json);
  if (!process.env.TMDB_API_KEY) {
    ok(noKey.json.unavailable.some((u) => u.list === "movies"),
      "with no TMDB key, films are reported UNAVAILABLE rather than silently empty", noKey.json.unavailable);
  }

  const add = await api("/api/add", {
    method: "POST", token: me.token,
    body: { list: "books", title: "Piranesi", subtitle: "Susanna Clarke", canonical: { key: "books:/works/OL1W" } },
  });
  ok(add.json?.item?.status === "filed", "something you chose yourself is filed, not queued", add.json?.item);
  addedId = add.json.item.id;

  const again = await api("/api/add", {
    method: "POST", token: me.token,
    body: { list: "books", title: "Piranesi (2020)", subtitle: "Susanna Clarke", canonical: { key: "books:/works/OL1W" } },
  });
  ok(again.json?.item?.id === addedId, "adding the same catalogue entry twice UPDATES one row", again.json);
  const count = (await query("select count(*)::int as n from items where user_id = $1 and list = 'books'", [me.id])).rows[0].n;
  ok(count === 1, "…and there is exactly one row to prove it", count);
  ok(again.json?.item?.title === "Piranesi (2020)", "the update actually wrote the new title", again.json?.item?.title);

  const noTitle = await api("/api/add", { method: "POST", token: me.token, body: { list: "books" } });
  ok(noTitle.status === 400, "an item with no title is refused", noTitle.status);
  const noShelf = await api("/api/add", { method: "POST", token: me.token, body: { list: "unsorted", title: "x" } });
  ok(noShelf.status === 400, "adding to the pile by hand is refused — pick a shelf", noShelf.status);
});

// ── 4. links ─────────────────────────────────────────────────────────────────
let shelfCode = null;
await group("links", async () => {
  const share = await api("/api/share", { method: "POST", token: me.token, body: { kind: "shelf", target: "books" } });
  shelfCode = share.json?.share?.code;
  ok(!!shelfCode, "a shelf link is minted", share.json);

  const twice = await api("/api/share", { method: "POST", token: me.token, body: { kind: "shelf", target: "books" } });
  ok(twice.json?.share?.code === shelfCode,
    "re-sharing the same shelf hands back the SAME link — a second one would split the view count and survive revoking the first",
    twice.json?.share?.code);

  const pile = await api("/api/share", { method: "POST", token: me.token, body: { kind: "shelf", target: "unsorted" } });
  ok(pile.status === 400, "the pile is not a shelf you can hand to anyone", pile.status);

  const notMine = await api("/api/share", { method: "POST", token: them.token, body: { kind: "item", target: addedId } });
  ok(notMine.status === 404, "you cannot mint a link to somebody else's item", notMine.status);

  // The public page, through the real router.
  const page = await api(`/s/${shelfCode}`);
  ok(page.status === 200, "the public page renders", page.status);
  ok(/Piranesi/.test(page.text), "…and it contains the actual item, not just a shell");
  ok(/Ex libris/.test(page.text), "…with the owner's plate on it");
  ok(/og:title/.test(page.text), "…and a link preview card");

  const views = (await query("select views from share_links where code = $1", [shelfCode])).rows[0].views;
  ok(views === 1, "opening the page counts a view", views);

  const handlePage = await api("/@suren");
  ok(handlePage.status === 404, "a handle page 404s until its owner turns shelves public", handlePage.status);
  await api("/api/profile", { method: "POST", token: me.token, body: { public_shelves: true } });
  const nowPublic = await api("/@suren");
  ok(nowPublic.status === 200, "…and renders once they do", nowPublic.status);
  ok(/Piranesi/.test(nowPublic.text), "…with their shelves on it");
  const oneShelf = await api("/@suren/books");
  ok(oneShelf.status === 200 && /Piranesi/.test(oneShelf.text), "a single shelf has its own address", oneShelf.status);
  const nonsense = await api("/@suren/nonsense");
  ok(nonsense.status === 404, "an unknown shelf name 404s rather than rendering an empty page", nonsense.status);

  const gone = await api("/s/doesnotexist");
  ok(gone.status === 404, "an unknown code 404s", gone.status);
  await api("/api/share/revoke", { method: "POST", token: me.token, body: { code: shelfCode } });
  const revoked = await api(`/s/${shelfCode}`);
  ok(revoked.status === 404, "a revoked link 404s", revoked.status);
  ok(revoked.text === gone.text,
    "a revoked link and one that never existed render IDENTICALLY — any difference is an oracle for guessing codes");

  const revokeAgain = await api("/api/share/revoke", { method: "POST", token: me.token, body: { code: shelfCode } });
  ok(revokeAgain.json?.ok === true, "revoking a dead link succeeds — the caller wanted it gone and it is gone", revokeAgain.json);
});

// ── 5. sending ───────────────────────────────────────────────────────────────
await group("sending", async () => {
  const nobody = await api("/api/send", { method: "POST", token: me.token, body: { to: "ghost", kind: "item", target: addedId } });
  ok(nobody.status === 404, "sending to a handle nobody owns is refused", nobody.status);

  const self = await api("/api/send", { method: "POST", token: me.token, body: { to: "suren", kind: "item", target: addedId } });
  ok(self.status === 400, "sending to yourself is refused", self.status);

  const sent = await api("/api/send", {
    method: "POST", token: me.token,
    body: { to: "@Nadia", kind: "item", target: addedId, note: "You'll like this one." },
  });
  ok(sent.json?.sent_to === "nadia", "a send resolves the handle, @ and case included", sent.json);

  const dupe = await api("/api/send", { method: "POST", token: me.token, body: { to: "nadia", kind: "item", target: addedId } });
  ok(dupe.json?.duplicate === true, "the same thing sent twice is ONE delivery, not two notifications", dupe.json);

  const mine = await api("/api/received", { token: me.token });
  eq(mine.json?.received, [], "the sender does not see their own send in their inbox");

  const inbox = await api("/api/received", { token: them.token });
  ok(inbox.json?.received?.length === 1, "the recipient has exactly one delivery", inbox.json?.received?.length);
  const delivery = inbox.json.received[0];
  ok(delivery.from_handle === "suren", "the delivery names who sent it", delivery);
  ok(!!delivery.from_seed, "…and carries their plate seed, so the mark can be drawn", delivery);

  const accept = await api("/api/send/act", { method: "POST", token: them.token, body: { id: delivery.id, action: "accept" } });
  ok(accept.json?.copied === 1, "accepting copies one thing", accept.json);

  const theirs = (await query("select * from items where user_id = $1", [them.id])).rows;
  ok(theirs.length === 1, "…onto THEIR shelf as a separate row, not a shared one", theirs.length);
  ok(theirs[0].id !== addedId, "…with its own id", theirs[0]?.id);
  ok(theirs[0].canonical?.from === "suren", "…recording who it came from", theirs[0]?.canonical);
  ok(theirs[0].note == null, "…and NOT carrying the sender's note, which is theirs", theirs[0]?.note);
  ok(theirs[0].status === "filed", "…filed, because a person chose to accept it", theirs[0]?.status);

  const emptied = await api("/api/received", { token: them.token });
  eq(emptied.json?.received, [], "an accepted delivery leaves the inbox");

  const twice = await api("/api/send/act", { method: "POST", token: them.token, body: { id: delivery.id, action: "accept" } });
  ok(twice.status === 404, "the same delivery cannot be accepted twice", twice.status);
});

// ── 6. cross-account isolation ───────────────────────────────────────────────
await group("isolation", async () => {
  // Both accounts now hold a book called Piranesi. The check that matters is
  // that each one sees exactly ONE of them — a query missing its user_id
  // filter would return two here and pass any assertion that only counted.
  // Read defensively. A broken endpoint returns an error body, not a list, and
  // an assertion that dereferences it turns a clear FAIL into a stack trace
  // that skips every check after it.
  const mineOnly = await api("/api/items?list=books", { token: me.token });
  const mineItems = mineOnly.json?.items ?? null;
  ok(mineItems?.length === 1, "my books shelf holds exactly my one book", mineOnly.json);
  ok(mineItems?.[0]?.id === addedId, "…and it is mine", mineItems?.[0]?.id);
  const theirsOnly = await api("/api/items?list=books", { token: them.token });
  const theirItems = theirsOnly.json?.items ?? null;
  ok(theirItems?.length === 1, "their books shelf holds exactly their one book", theirsOnly.json);
  ok(theirItems?.[0]?.id !== undefined && theirItems[0].id !== addedId, "…which is a different row from mine", theirItems?.[0]?.id);
  const rows = (await query("select user_id, count(*)::int as n from items group by user_id")).rows;
  ok(rows.length === 2 && rows.every((r) => r.n === 1), "each account holds exactly its own row", rows);

  const steal = await api("/api/item", { method: "POST", token: them.token, body: { id: addedId, action: "discard" } });
  ok(steal.status === 404 || steal.json?.ok === false, "you cannot act on somebody else's item", steal.status);
  const still = (await query("select status from items where id = $1", [addedId])).rows[0];
  ok(still.status === "filed", "…and it is untouched", still);
});

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} checks passed against real Postgres`);
process.exit(fail ? 1 : 0);
