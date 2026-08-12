# shelf — operations

Read before touching the build, a deploy, a scheduled job, or a third-party
API. Same convention as soundcheck: every rule names the failure that produced
it, because that is what makes a rule survive contact with a deadline.

## 0. How a reel is actually read — measured, not assumed

This section used to describe a spike to run "before anything downstream". The
spike was never run; the measurement got taken a different way, and the answer
is below. `spike-ig.mjs` has been deleted — it asked with a browser user agent,
which we now know is the one that gets nothing, so running it would have
produced a confident 0%.

**Meta serves link-preview crawlers and starves browsers.** Measured from
Render against a live reel, seconds apart:

| user agent | bytes | caption |
|---|---|---|
| browser (embed) | 606,013 | **0 chars** |
| browser (canonical) | 605,958 | **0 chars** |
| **crawler (canonical)** | 928,763 | **1,240 chars** + og:image + author |
| **crawler (embed)** | 130,640 | **1,806 chars** |

Not a block — HTTP 200, no wall. A browser gets a JavaScript shell
(`<title>Instagram</title>`, `data-sjs` bootstrap blobs, not one og: tag); a
crawler gets the metadata every chat client needs to draw a card. `viaCrawler`
asks as `facebookexternalhit`.

**The datacentre-IP theory was wrong, and it was written down three times.**
The plan, this file and two handovers all said Render's IP would be blocked
harder than a laptop's. It is not, for posts. One probe settled it. (It IS
true for PROFILE pages — see §0b — which is the sort of split you only find by
measuring both.)

**READ THE EMBED PAGE, NEVER THE CANONICAL ONE.** The canonical URL returns
~930 kB carrying SEVERAL of the account's posts, and an extractor taking the
first `"caption"` in document order gets a neighbour's. That filed a reel about
*Willow and Wind* as *The Wicker Man* — and it was not one bad row: every item
resolved through the canonical URL was wrong, including a restaurant nobody had
questioned, whose caption went from 46 characters to 428 once scoped.
`/embed/captioned/` holds exactly one post by construction; the canonical page
is used only for `og:image`, which is page-level and cannot belong to another
post. `scopeToShortcode` returns null rather than the whole page when the
shortcode is absent.

**A wrong resolution is worse than an empty one:** it is confident,
well-formed, catalogue-matched and silent.

### 0a. Asking the live service, without a laptop

The sandbox this repo is written in has an egress policy denying
`onrender.com`, `api.expo.dev` and `instagram.com` at the gateway. Reported,
not routed around. So diagnosis runs on a GitHub runner, whose job logs are
readable through the API:

**Actions → Diagnose the deployed service →** `health` · `reel` · `resolve`.

- `health` — needs no secret. Reports the **deployed commit**, which providers
  are reachable, and whether the app key is enforced.
- `reel` — the resolver chain out loud for one URL, from the machine whose IP
  address is the entire question. Per link: HTTP status, bytes, whether it was
  a bot wall, how many characters of caption came out, which extractor got
  them, and a one-line `verdict`. Needs `SHELF_ADMIN_SECRET`.
  **A profile URL is accepted too** and probes that instead — see §0b.
- `resolve` — the whole round trip exactly as the phone makes it, ending in a
  list of what would land on a shelf. `reel` answers "did the caption arrive";
  only this answers "did eight tagged bookshops become eight rows".

| `verdict` | What it means | What to do |
|---|---|---|
| `readable — …` | The chain works from this IP. | Thin items are a classifier or enrichment problem, not a scrape problem. |
| `BLOCKED — …` | Meta served this server a wall, not a page. | Set `IG_RESOLVER_KEY` + `IG_RESOLVER_URL`, or use the screenshot path. Nothing in `resolve.js` can fix this. |
| `JAVASCRIPT SHELL` | A browser user agent got the client-rendered page. | Ask as `facebookexternalhit`. This is §0. |
| `no caption — …` | The pages fetched; nothing we know how to parse was in them. | Meta moved the markup. Add a fixture, fix `extractInstagram`, `--selftest`. |

**Always read the deployed commit before believing the answer.** Render takes a
couple of minutes to ship a push, so a diagnosis triggered straight after one
measures the PREVIOUS build. This happened twice in a row to the same change.
`health` reports `commit`; the workflow prints it next to the commit it was
triggered from and warns when they differ.

**The screenshot path does not depend on Meta at all.** Share a screenshot
instead of the link and it goes straight to vision (`POST /api/resolve/image`).
When the verdict is `BLOCKED`, that is the working answer today, not a
workaround to apologise for.

### 0b. Profile pages are gated differently from posts (2026-08-12)

A caption that lists places by TAGGING them — "Bookshops featured: @a @b @c" —
was going to be resolved by reading each profile. Measured, in this order:

| asked from | user agent | result |
|---|---|---|
| GitHub runner | crawler | 200, og:description = "…videos from Backstory \| independent bookshop (@backstory.london)" — a name and a descriptor |
| **Render** | browser | **HTTP 429**, 0 bytes |
| **Render** | crawler | 200, 617 kB, **no og:description at all** — a login wall |

So the path was built on a measurement taken from the wrong machine. In
production it fetched eight profiles and returned eight nothings, and
`tagged_accounts: 0` in the response said so. It is deleted.

**Nothing replaced it, because nothing was needed:** all eight bookshops
resolved correctly anyway — the classifier reads `@funnyweatherbooks` as "Funny
Weather" and the geocoder confirms or drops it. `classify.js` now states that
rule instead of asking for names that never arrive.

`probeProfile` stays as the instrument: `?url=` a profile on the `reel`
diagnosis and it reports what that page gives up today.

## 1. The request path

**Nothing slow happens while the share sheet is on screen.** The share
extension writes the URL to the shared Keychain and closes in about 420 ms. It
makes no network call at all — it cannot fail on a bad signal, so a share is
never lost to one.

The four seconds of scrape + Claude + catalogue happen in the APP, on
`POST /api/resolve`, with a row on screen saying what is happening. They did
not disappear; they moved somewhere a person can see them, instead of behind a
queue that needed a database to hold your shelves.

This is soundcheck's "never call YouTube from a request path" rule with the
names changed, and it is here for a sharper reason: the iOS share sheet is a
modal over *another app*. Somebody waiting on Instagram's servers inside a
sheet they cannot dismiss is worse than any latency you can measure.

**If the share extension ever grows a `fetch`, that is the bug.**

## 2. Third-party limits

- **Google Places is the only metered provider, and it is now the FALLBACK.**
  OpenStreetMap (Nominatim) is asked first: free, keyless, no billing account,
  and it carries the address, coordinates, website, phone and opening hours for
  most independent places. Google is only reached for what OSM does not know,
  and only when `GOOGLE_PLACES_KEY` is set. It is currently unset, and
  restaurants and travel still enrich.
- `provider_cache` stores the MISS as well as the HIT — `found = false` with a null payload is a real,
  reusable answer. Not caching negatives is how soundcheck doubled its YouTube
  bill; the lesson is provider-agnostic and it cost a day.
- **A provider FAILURE is not a cached miss.** A network error or a 500 must
  never be written to the cache, or one bad afternoon becomes a permanently
  empty field. `cached()` returns null on a throw without storing anything, so
  the next attempt retries.
- **THE CACHE KEY CARRIES A SHAPE VERSION.** `SHAPE = "v3"` in `cacheKey()`.
  A cache is keyed on the question and stores the answer, so widening what an
  enricher returns does not change the key — new code reads old, thin answers
  back and looks broken. Bump `SHAPE` whenever the returned object grows a
  field. This cost a confusing hour when trailers and opening hours shipped and
  nothing appeared.
- **A place provider returns its best guess, never "not found".** Nominatim
  answered a search for "Book Bar" with "The Book and Record Bar" — a real
  bookshop in another borough — and the enricher adopted its name AND its
  coordinates. HTTP 200, no score, nothing to catch. `nameFound()` now requires
  the returned name to CONTAIN the asked-for name as a contiguous phrase:
  "Funny Weather Books" → "Funny Weather books + coffee" passes, "Book Bar" →
  "Book and Record Bar" does not. A refused match keeps the honest map-search
  link. `canonical.asked_as` records the difference on the ones that pass, and
  the `resolve` diagnosis prints it.
- **City is part of the Places cache key.** "Ganapati" exists in several
  cities; keying on the name alone reuses the wrong answer forever.
- Open Library and schema.org recipe parsing need no key. TMDB needs a free
  one. Everything degrades to `enriched: false` rather than failing the share —
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
- **The Keychain access group IS the hand-off.** The app and the extension are
  separate processes, and the extension does no network at all: it writes the
  shared URL into the shared Keychain and closes. If the group is misconfigured
  the write goes nowhere, every share vanishes, and the app looks perfectly
  healthy. `sharedKeychainOk()` is rendered on the card for exactly that reason
  — a diagnostic nobody can see is not a diagnostic.
- **A queue receipt you did not verify is a lie.** The share sheet used to say
  "Queued" when the write had failed. `queueShare` reads its own write back.
- **A failed URL share is queued, a failed image share is not.** Images are
  excluded on purpose: the shared file lives in a temporary container that is
  gone by the time the app next opens, so queueing one guarantees a broken
  retry.
- **iOS does not remount a backgrounded app.** Anything fetched on mount runs
  once, at cold start, and never again — so after sharing from Instagram and
  coming back, the screen shows what it showed an hour ago. This shipped, and
  was reported as "nothing is coming to the shelf when I share". `AppState` +
  pull-to-refresh. Any new screen that loads on mount has this bug until it
  handles `active`.
- `index.share.js` and the component name `shareExtension` are both load-bearing
  — rename either and the extension builds fine and launches to a blank sheet.
- `metro.config.js` must wrap `withShareExtension`, or metro only ever builds
  the app bundle and the extension ships stale JS.

## 4b. The public web surface

ONE URL shape, because it is the only one that still means anything:

```
/s/<code>        a link somebody deliberately published, and can revoke
```

`/@handle` and `/@handle/books` are gone. A handle was a lookup into a users
table; there is no users table. A profile page is now just another published
snapshot — the same `/s/<code>` with `kind: "profile"` inside it.

**A deploy with no `DATABASE_URL` is legitimate.** Resolving and shelving need
no database at all; only published links do. So `/s/<code>` renders the
designed "nothing here" page when there is no database, rather than a 500, and
`POST /api/publish` answers 503 with a sentence saying publishing is switched
off on this server. Both were stack traces until `smoke.mjs` was run against a
server without one.

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
`DB_SCHEMA` it refuses; with it, the suite passed and the other application's
rows were byte-for-byte untouched. That verification was taken against the old
schema — the guard itself is unchanged, but the only table left to protect now
is `published`.

## 4c2. After any deploy

```bash
node api/smoke.mjs https://shelf-api-u8xy.onrender.com
```

Read-only — nothing is written. There is nothing to write: the service holds
published snapshots and nothing else. What is left to check after a deploy is
which commit is answering, which providers it can actually reach, and whether
the route the entire app runs on is mounted. It asks `POST /api/resolve` with
an empty body and expects a 400 — proof the router reached the handler, without
spending a Claude call on a smoke test.

Every check here has a failure mode that looks fine in a browser, and it
reports in sentences, because "db: false" is a fact while "publishing is off,
shelving still works" is the thing you needed to know.

**It earns its keep.** Run against a server with no `DATABASE_URL` it caught
two 500s on paths a stranger can reach — `/s/<code>` and `POST /api/publish` —
both of which are now designed degradations. It has also been run against four
deliberately broken servers (no database, nothing listening, a typo'd host, a
healthy one), so its failure messages are ones that have actually been seen.

## 4d. What replaced the end-to-end suite

`api/e2e.mjs` is deleted. It drove 62 checks through real Postgres with bearer
tokens against `items`, `users` and `pair_codes` — three tables and an auth
model that the local-first rewrite removed. It had stopped even importing
(`Cannot find module './auth.js'`), which is the only reason anybody noticed:
nothing was running it.

What holds the line now, in the order you should reach for it:

| Check | Covers | Cost |
|---|---|---|
| `cd api && npm run selftest` | Every parser, prompt, clamp, cache key and renderer, over saved fixtures. Offline. | ~2 s |
| `cd app && npm run preflight` | The design gate's grep half + build config traps | ~1 s |
| `cd app && npm run verify` | The same, plus rendering every screen in Chromium and MEASURING tap targets | ~40 s |
| `node api/smoke.mjs <url>` | A deploy: commit, providers, routing, public pages | one request each |
| Actions → Diagnose → `resolve` | The whole real round trip, ending in what would land on a shelf | a real Claude call |
| **Sharing a reel on the phone** | The share extension, the Keychain hand-off, iOS fonts, native scroll | the only thing that proves them |

**The gap this leaves, named:** nothing exercises publish → read → revoke
against a real Postgres any more. `publish.js --selftest` covers the snapshot
building and the allow-list; the database round trip is unproven since the
rewrite. Closing it needs a scratch Postgres, which this sandbox does not have
— so it is written down rather than quietly assumed.

**Every one of the automated checks above was green when this was written.**

## 4e. The blueprint

`render.yaml` declares **one free web service and nothing else** — no database,
no worker. Both omissions are deliberate and both are about the import
succeeding for the person most likely to be running it:

- **No database.** Render allows one free Postgres per account, so a blueprint
  that declares its own cannot be imported by anybody who already has one.
  `DATABASE_URL` is pasted in and points at Neon, Supabase or anything that
  speaks Postgres. It also means the database survives deleting and re-importing
  the blueprint, which is exactly what iterating on it does.
- **No worker.** There is no longer anything to drain — resolution happens
  inside the request the app makes. The free tier has no background workers
  either, so a blueprint declaring one fails to create.

Both are commented back in, in place, for when you outgrow them.
`api/page.js --selftest` fails if either reappears uncommented, along with the
`rootDir` trap — the deploy config is checked like anything else here.

## 4f. There is nothing to sign into

This section used to explain how to mint a pairing code without a shell, since
Render's Shell is a paid feature and the app could not otherwise be signed into
at all. Both the code and the problem are gone: no accounts, no pairing, no
device tokens. Install the build and share a reel.

What replaced the pairing code as the thing guarding the service is
`SHELF_APP_KEY` — **a turnstile, not a lock.** It identifies the build so a
stranger who finds the URL cannot spend the Claude budget. It reads nothing and
protects no data, because there is no data here to protect. It is baked into
the app at build time as `EXPO_PUBLIC_SHELF_KEY`.

**Order matters, and getting it wrong breaks the app you are holding:** build
and install first, THEN set `SHELF_APP_KEY` on Render. Set it first and the
installed build starts answering 401 to every share.

## 5. Deploy

- **API on Render: one free web service, `node api/serve.js`.** No worker, no
  cron, nothing to drain. Pushes to `main` deploy automatically.
- **The deploy needs the REPOSITORY ROOT, not `api/`.** See §4b — `api/page.js`
  renders the public pages from `app/src/design.js`. Pinned by a selftest.
- **`GET /api/health` reports the commit it is running.** Read it before
  concluding anything from a diagnosis; see §0a.
- **A database is optional.** Attach one for published links; without it
  everything else works and the two affected routes degrade with a sentence.
- Migrations run at boot (`migrate()` in `serve.js`), are additive, and are
  recorded in `schema_migrations`. Nothing drops or sweeps.
- **The app updates over the air.** A push touching only JS publishes itself to
  the `preview` EAS branch; `native-changed.mjs` refuses when the change needs
  a rebuild instead. `npm run ship` is the full build.

## 6. Traps already paid for

- **`rootDir: api` breaks the public pages.** See §4b. Caught by a selftest, not
  by a deploy.
- **An empty `onError` is not an image fallback.** It passes a grep and leaves
  the hole exactly where it was. The design gate now rejects the empty form
  specifically, because the full form shipped in the Add screen's thumbnails.
- **A placeholder in the full label colour reads as a typed value.** Derived by
  mixing toward the field; the mix is solved against a 3:1 floor, not chosen.


- **`process.argv` is global, so `--selftest` leaks across imports.** Every
  module here ends with a selftest block; one importing another let the flag
  through, so the imported module ran *its* tests and called `process.exit(0)`.
  The suite printed one "ok" and exited green **without running a single
  assertion from the file being tested** — a test suite passing by not running,
  which looks exactly like success. Guard every block with
  `isMain(import.meta.url)`.
- **A test suite with no automatic caller rots silently.** `npm run selftest`
  spent the whole local-first rewrite naming three deleted files, so it died on
  the first missing one; underneath that, two `page.js` assertions had never
  passed on a machine without a web host configured. Neither is exotic — both
  are what happens when nothing runs the tests. `.github/workflows/checks.yml`
  runs them on every push now.
- **Instagram share URLs carry tracking junk** (`?igsh=…`). Canonicalise before
  the id, or the same reel makes a new row every time you share it.
- **A cache is keyed on the question and stores the answer.** Widening what an
  enricher returns does not change the key, so new code reads old thin answers
  back. `SHAPE` in `cacheKey()` — see §2.
- **A guard that blocks its own fix gets bypassed.** `owner` had to go into
  app.json for a robot Expo token to publish, and app.json was on the native
  list — so the fix would have demanded a full rebuild. `native-changed.mjs`
  parses both sides and ignores `owner`/`extra` specifically.
- **Four faults can hide behind one symptom.** "The app does not auto-update"
  was, in order: no `EXPO_TOKEN` · `github.event.before` empty on a manual run
  so the diff said nothing changed · `github.event.head_commit` absent so
  `--message ""` was rejected · a robot token needing an explicit `owner`. Each
  fix revealed the next. Never conclude from one green fix.
