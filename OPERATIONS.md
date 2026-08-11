# shelf — operations

Read before touching the build, a deploy, a scheduled job, or a third-party
API. Same convention as soundcheck: every rule names the failure that produced
it, because that is what makes a rule survive contact with a deadline.

## 0. The spike that decides everything — do it first

Nothing downstream changes shape based on the answer, but the **order of the
resolver chain** does, and so does whether the paid resolver is a fallback or
the primary. Until this has a number, the caption path is a guess.

Put ~20 real reel URLs (spread across the four categories, mixing big accounts
with small — reach correlates with how aggressively Meta serves the embed page)
in a file, then, **on the Render box**:

```bash
node spike-ig.mjs urls.txt
```

It runs the real chain in the real order — embed page first, canonical `og:`
only when the embed fails — and prints a **CHAIN USABLE** percentage plus a
recommendation. Write that number and the date into this section.

It distinguishes *usable* from *thin*: a 100% hit rate of 12-character
truncated `og:` descriptions is not a working caption path, and a bare success
count would hide exactly that. It also reports its own egress IP and warns when
that is not a datacentre network, so a pasted result can never be ambiguous
about where it was taken.

- **Datacentre IPs are blocked far more aggressively than residential ones.** A
  spike that passes from a laptop and is never repeated from the server is the
  classic way this ships broken: it works in development, works in the demo,
  and returns nothing in production, and the code is identical in all three.
- The agent sandbox this repo was written in has `instagram.com` blocked by the
  proxy (`CONNECT tunnel failed, 403`), so the numbers were never taken. Do not
  read the resolver order in `resolve.js` as evidence that it was measured.

## 1. The request path

**Nothing slow happens while the share sheet is on screen.** `POST /api/ingest`
writes one row and returns. Resolution, Claude, and provider lookups are the
worker's job, always.

This is soundcheck's "never call YouTube from a request path" rule with the
names changed, and it is here for a sharper reason: the iOS share sheet is a
modal over *another app*. A user waiting on Instagram's servers inside a sheet
they cannot dismiss is a worse experience than any latency you can measure.

If `/api/ingest` ever grows a `fetch`, that is the bug.

## 2. Third-party limits

- **Google Places is the only metered provider.** `provider_cache` stores the
  MISS as well as the HIT — `found = false` with a null payload is a real,
  reusable answer. Not caching negatives is how soundcheck doubled its YouTube
  bill; the lesson is provider-agnostic and it cost a day.
- **A provider FAILURE is not a cached miss.** A network error or a 500 must
  never be written to the cache, or one bad afternoon becomes a permanently
  empty field. `cached()` returns null on a throw without storing anything, so
  the next attempt retries.
- **City is part of the Places cache key.** "Ganapati" exists in several
  cities; keying on the name alone reuses the wrong answer forever.
- Open Library and schema.org recipe parsing need no key. TMDB needs a free
  one. Everything degrades to `enriched: false` rather than failing the ingest —
  an item Claude named correctly is already useful without a cover image.

## 3. Claude

- `claude-opus-5`, `effort: low` — this is short structured extraction, not
  reasoning work. Override with `SHELF_MODEL` if you want Sonnet.
- **Thinking stays on.** It is the default on Opus 5, and disabling it invites
  the failure where a tool call is written into visible text instead of being
  emitted as a call — the turn succeeds, nothing runs, nothing errors.
- `max_tokens` caps thinking *and* output together. 8000 is headroom, not a
  target.
- Output is constrained by `output_config.format` (JSON schema), so there is no
  "it wrapped the JSON in a fence again" path to defend against. The schema
  guarantees **shape**, never **sense** — `coerceItems()` clamps confidence,
  truncates titles, and drops nameless items before anything reaches the DB.

## 4. iOS

- **Expo Go cannot host a share extension.** Prebuild plus an EAS dev-client
  build from the start.
- **The Keychain access group is the silent failure.** The app and the extension
  are separate processes. If the group is misconfigured, `getToken()` in the
  extension returns null, every share 401s, and the app looks perfectly healthy.
  `verifySharedAccess()` runs at pairing and says so on screen — that check is
  the whole reason this is not a week-long mystery.
- **A failed URL share is queued, a failed image share is not.** The queue lives
  in the shared Keychain and the app flushes it on launch. Images are excluded
  on purpose: the shared file lives in a temporary container that is gone by
  the time the app next opens, so queueing one would guarantee a broken retry.
- `index.share.js` and the component name `shareExtension` are both load-bearing
  — rename either and the extension builds fine and launches to a blank sheet.
- `metro.config.js` must wrap `withShareExtension`, or metro only ever builds
  the app bundle and the extension ships stale JS.

## 4b. The public web surface

Three URL shapes, and they are short because they get read aloud and typed off
a screenshot:

```
/s/<code>        a link somebody made and can revoke
/@handle         a profile, only if its owner turned their shelves public
/@handle/books   one shelf of that profile
```

**The API deploy needs the REPOSITORY ROOT, not `api/`.** `api/page.js` renders
those pages from `app/src/design.js` and `app/src/exlibris.js` — the same files
the app imports, which is the only arrangement where a link you send somebody
looks like the app it came from. `render.yaml` used to say `rootDir: api`, which
would have shipped a server that dies on its first import. It now builds with
`cd api && npm ci` and starts `node api/serve.js`, and
`node api/page.js --selftest` fails if anyone puts `rootDir: api` back.

**A revoked link and a link that never existed must render identically.** Any
difference between the two is an oracle for guessing codes. `renderGone()` takes
no argument for exactly that reason.

**`SHELF_WEB_BASE` is an override, not a requirement.** The server falls back to
`RENDER_EXTERNAL_URL`, which Render sets to the service's own address — so the
ordinary deploy needs no configuration for this at all. That is deliberate: the
host is not knowable until after the first deploy, so a required value here is
one you would be typing in while links were already being handed out. Set it
only for a custom domain, full origin, no trailing slash.

**If neither is known, no `og:url` is emitted at all.** A preview card with no
canonical address merely degrades; one pointing at the wrong host is a link that
quietly sends people somewhere else.

## 4c. Search providers

| List | Provider | Key | Notes |
|---|---|---|---|
| Books | Open Library | none | Works out of the box. |
| Movies & TV | TMDB | `TMDB_API_KEY` | Free. Without it the Add screen SAYS films are switched off rather than returning nothing. |
| Restaurants | Google Places Text Search | `GOOGLE_PLACES_KEY` | **Paid and metered.** |
| Recipes | schema.org off the page itself | none | The query is a URL; pasting one is the interaction. |

**Search results are cached, MISSES INCLUDED.** A search box is the worst thing
to leave uncached against a metered provider: every keystroke past the debounce
is a paid question, and "nothing matched 'ganapat'" is a real, reusable answer.
This is the same omission that doubled soundcheck's YouTube bill (§10 there),
arriving in a new shape.

**Places results deliberately carry no photo.** A Places photo is a second
billed request per result, and eight of those per keystroke is how a search box
becomes a line item. The typographic jacket is the designed answer.

## 4a. Sharing a database with another project

Render allows exactly **one free Postgres per account**, so the realistic setup
is shelf living in a database that already belongs to something else. Doing
that naively is destructive in a way that looks like success:

- shelf's first migration is called `001_init.sql`. So is nearly everybody's.
  If the database already records that name, shelf **skips every migration**,
  creates no tables, and boots with a green health check.
- shelf has a `users` table. So does almost every app. `create table if not
  exists` then quietly no-ops and shelf starts writing rows into the other
  application's users.

**Set `DB_SCHEMA=shelf`.** Every shelf table — `schema_migrations` included —
then lives in its own namespace, and the connection's `search_path` is that
schema ALONE. Not `shelf,public`: including public would let shelf see the
other application's `users` again, which is the entire thing being prevented.
shelf uses no extensions, so it needs nothing from `public`.

**And if you forget, it refuses to boot.** `guardSharedDatabase()` looks for a
`001_init.sql` that shelf did not write and stops with a message naming the
fix. A server that will not start is a far better outcome than one that starts
and writes into somebody else's rows.

Verified against a stand-in for a populated foreign database: without
`DB_SCHEMA` it refuses; with it, all 62 end-to-end checks pass and the other
application's users, events and migration rows are byte-for-byte untouched.

## 4c2. After any deploy

```bash
node api/smoke.mjs https://shelf-api.onrender.com
```

Read-only — no rows written, no pairing code spent. The one mutating-looking
call is a deliberately invalid pair redemption, which proves the router, the
database and auth are all alive in a single request without side effects.

It exists because every one of those checks has a failure mode that looks fine
in a browser, and because "db: false" is a fact while "DATABASE_URL did not
attach" is the thing you needed to know.

It was written against a running server and then run against four deliberately
broken ones — no DATABASE_URL, nothing listening, a typo'd host, and a healthy
one — so its failure messages are ones that have actually been seen. Writing it
also caught two things: an over-long fake share code falls through the 4–16
character route to the generic JSON 404 (so the check was wrong, not the
server), and `/api/health` had no way to report where share links point, which
made a derived, invisible, easily-wrong value unverifiable. It reports
`web_base` now.

## 4d. The end-to-end suite

```bash
createdb shelf_e2e
DATABASE_URL='postgres://…/shelf_e2e' PORT=8791 node api/e2e.mjs
```

62 checks against real Postgres, through the real HTTP server, with bearer
tokens — then it reads the ROWS rather than the status codes. It refuses to run
against a `DATABASE_URL` whose name does not contain `e2e`/`test`/`scratch`,
because a suite that can be pointed at production by a typo eventually is, and
it truncates every table on the way in so a count assertion means what it says.

**It has been mutation-tested.** Deliberately breaking the user filter on the
list query, the catalogue dedupe, and the "who sent me this" field each produce
named failures. A suite nobody has watched fail is a suite nobody should trust,
and two real defects fell out of doing this:

- The groups let an exception escape, so one unexpected shape ended the run with
  a stack trace and silently skipped every check after it — indistinguishable
  from those checks passing.
- An assertion that dereferenced `json.items.length` turned a clear FAIL into a
  crash the moment the endpoint returned an error body instead of a list.

**`db.js` only demands TLS off-box.** Managed Postgres requires it; a unix
socket or loopback has nothing on the wire to protect and refuses the
handshake outright, which is what stopped this suite running at all.

## 4e. The blueprint

`render.yaml` declares **one free web service and nothing else** — no database,
no worker. Both omissions are deliberate and both are about the import
succeeding for the person most likely to be running it:

- **No database.** Render allows one free Postgres per account, so a blueprint
  that declares its own cannot be imported by anybody who already has one.
  `DATABASE_URL` is pasted in and points at Neon, Supabase or anything that
  speaks Postgres. It also means the database survives deleting and re-importing
  the blueprint, which is exactly what iterating on it does.
- **No worker.** The free tier has no background workers, so the service would
  fail to create. `WORKER_IN_PROCESS=1` is the default in the blueprint instead.

Both are commented back in, in place, for when you outgrow them.
`api/page.js --selftest` fails if either reappears uncommented, along with the
`rootDir` trap — the deploy config is checked like anything else here.

## 4f. Getting a pairing code without a shell

```bash
curl -s -X POST $BASE/api/admin/pair -H "x-shelf-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" -d '{"email":"you@email.com"}'
```

`node auth.js --pair` is the same thing from a shell — but Render's Shell is a
PAID feature, so on the free tier there is otherwise no way to mint a first
code and the app cannot be signed into at all.

Guarded by `ADMIN_SECRET`, exactly like `POST /api/worker/run`. If that variable
is unset the route answers 403 and says so, rather than minting codes for
anybody who finds it. The code it returns is still single-use and expires in 30
minutes, so the endpoint is not a standing key to the account.

## 5. Deploy

- API on Render: `node serve.js` as the web service, `node worker.js` as a
  background worker. If a background worker is not available, run the drain from
  cron against `POST /api/worker/run` with `ADMIN_SECRET`.
- **`GET /api/health` goes 503 when the oldest pending share is over 10
  minutes old.** That is the check that catches a dead worker — an API that
  answers every request while nothing resolves is otherwise indistinguishable
  from a healthy one, and the app shows "Working it out…" forever.
- Migrations run at boot (`migrate()` in `serve.js`). They are additive and
  recorded in `schema_migrations`; nothing here drops or sweeps anything.

## 6. Traps already paid for

- **`rootDir: api` breaks the public pages.** See §4b. Caught by a selftest, not
  by a deploy.
- **An empty `onError` is not an image fallback.** It passes a grep and leaves
  the hole exactly where it was. The design gate now rejects the empty form
  specifically, because the full form shipped in the Add screen's thumbnails.
- **A placeholder in the full label colour reads as a typed value.** Derived by
  mixing toward the field; the mix is solved against a 3:1 floor, not chosen.


- **`process.argv` is global, so `--selftest` leaks across imports.** Every
  module here ends with a selftest block; `node items.js --selftest` imported
  `auth.js`, which saw the flag, ran *its* tests and called `process.exit(0)`.
  The suite printed "auth selftest ok" and exited green **without running a
  single items.js assertion** — a test suite passing by not running, which
  looks exactly like success. Guard every such block with
  `isMain(import.meta.url)`.
- **Instagram share URLs carry tracking junk** (`?igsh=…`). Canonicalise before
  the deterministic id or the same reel makes a new row every time you share it.
- A screenshot's base64 sits in `items.raw_image_b64` only until the worker
  reads it, then it is nulled. It is a queue slot, not storage — leaving it
  would make every list query drag megabytes along.
