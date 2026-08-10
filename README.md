# shelf

Share a reel from Instagram, pick a list, done. It shows up later as a book
with a cover, a restaurant with an address, a film with a year, or a recipe
with its ingredients.

Four lists: **books · restaurants · movies · recipes.**

```
Instagram  ──share──▶  shelf sheet        (4 buttons, closes in <1s)
                            │
                            ▼
                       POST /api/ingest    (writes one row, returns)
                            │
                            ▼
                        worker            resolve caption → Claude → enrich
                            │
                            ▼
                    a shelf, or the Inbox
```

## Why it is built this way

**Meta has no API for this.** `instagram_business_basic` reads the media of the
business account that authorised your app — not an arbitrary public reel. So
reading a caption is a scrape, scrapes break, and the whole design assumes that
and stays useful when it happens:

| # | Resolver | Cost | Notes |
|---|---|---|---|
| 1 | `instagram.com/p/<code>/embed/captioned/` | free | The default. Verify it from a **datacentre IP**, not your laptop. |
| 2 | `og:` tags on the canonical URL | free | Truncated, usually still enough for a title. |
| 3 | Paid resolver | ~$0.001–0.01/reel | Inert unless `IG_RESOLVER_KEY` **and** `IG_RESOLVER_URL` are both set. |
| 4 | Screenshot + vision | Claude tokens | Share an *image* instead of a link. Depends on Meta for nothing. |
| 5 | Nothing | — | Item lands in the Inbox with your link and your chosen list. Still useful. |

Which link in the chain produced a caption is recorded on every item as
`resolver`, so when items start coming back thin you get a histogram instead of
a hunch.

**Your tap wins.** If you picked a list at share time, the model may not
override it — it only fills in the fields. It cannot see the reel; you can.

**Confidence routes, it does not gate.** Above 0.6 an item files itself. Below,
it waits in the Inbox with whatever was salvaged, one tap from filed or binned.
Nothing is ever silently dropped.

## Layout

```
api/     node:http + Postgres. No framework.
  resolve.js    the caption chain           (--selftest, fixtures)
  classify.js   one Claude call, structured (--selftest)
  enrich/       Open Library · TMDB · Places · schema.org (--selftest)
  ingest.js     the hot path — a row and a return, nothing else
  worker.js     everything slow lives here
app/     Expo + expo-share-extension
  ShareExtension.tsx  the sheet over Instagram
  App.tsx             four shelves + Inbox + pairing
```

## Running it

```bash
cd api
npm install
export DATABASE_URL=postgres://…
export ANTHROPIC_API_KEY=sk-ant-…
npm run migrate
npm run selftest          # 80+ assertions, no network
node serve.js             # :8080
node worker.js            # the drain loop
node auth.js --pair you@example.com   # prints a pairing code for the app
```

Before trusting the caption path, run the spike **from the server** — it is the
one measurement everything else depends on:

```bash
node spike-ig.mjs urls.txt     # ~20 reel URLs, one per line
```

Optional keys — each one missing degrades to `enriched: false`, never an error:
`TMDB_API_KEY`, `GOOGLE_PLACES_KEY`, `IG_RESOLVER_KEY` + `IG_RESOLVER_URL`,
`ADMIN_SECRET` (guards `POST /api/worker/run` for cron), `SHELF_MODEL`.

```bash
cd app
npm install
npx expo prebuild -p ios       # required — a share extension needs a native target
npx eas build -p ios --profile development
```

**Expo Go cannot host a share extension.** The first build is an EAS dev-client
build, not a QR code. Discovering that late costs a rebuild cycle.

## Health

`GET /api/health` reports queue depth and the age of the oldest pending share,
and goes **503 with a plain-English warning** when shares are queuing but not
resolving — the failure that otherwise looks exactly like a working app.

## What is verified, and what is not

Verified here: all module selftests, and 24 end-to-end checks against real
Postgres — pairing, single-use codes, auth gating, the dedup claim (one reel
re-shared with different tracking params = one row), multi-item reels, Inbox
routing, cross-account isolation.

**Not verified from this sandbox** (the agent proxy blocks `instagram.com`, and
there is no iOS toolchain here): live caption extraction, the Claude call, the
provider lookups, and anything requiring a built IPA. `OPERATIONS.md` says what
to run first and in what order.
