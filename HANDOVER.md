# shelf — handover

**Read this first.** Facts, with the check that proves each. Not a summary of a
summary. Replace it wholesale at the end of the next substantial session.

---

## What shelf is

Share an Instagram reel → it lands on one of four shelves (books, restaurants,
movies, recipes). Plus: a person, a public page, and a way to hand a shelf to
somebody. One repo, two folders: `api/` (plain `node:http` + Postgres) and
`app/` (Expo + a share extension).

## Where it actually stands (2026-08-11)

**It is on a phone.** A `preview` EAS build is installed, the shelf has been
claimed, and reels have been shared into it from Instagram. That is further
than any previous handover — everything below is now reported behaviour, not
speculation.

**Reels resolve.** A shared reel gets a caption, a title, a cover and — for
films — a TMDB match, verified on real rows below. Pushes publish themselves to
the phone. The live service can be interrogated without anybody opening a
terminal. What remains is a Places key and a run on the device itself.

### Milestone 0: measured, and the answer was none of the theories (2026-08-11)

Four months of documents said Instagram blocks datacentre IPs. It does not.
Measured from Render against a live reel, seconds apart:

| user agent | bytes | caption |
|---|---|---|
| browser (embed) | 606,013 | **0 chars** |
| browser (canonical) | 605,958 | **0 chars** |
| **crawler (canonical)** | 928,763 | **1,240 chars** + og:image + author |
| **crawler (embed)** | 130,640 | **1,806 chars** |

Not a block — HTTP 200, no wall. Meta renders posts client-side for a browser
(`<title>Instagram</title>`, `data-sjs` bootstrap blobs, **not one og: tag**)
and serves the full metadata to link-preview crawlers, because a reel pasted
into WhatsApp has to draw a card. `viaCrawler` asks as `facebookexternalhit`.
It is Meta's own crawler and the preview metadata every chat client is served.

**READ THE EMBED PAGE, NEVER THE CANONICAL ONE.** The first crawler version
tried the canonical URL first and filed a reel about *Willow and Wind* as
*The Wicker Man* — because that URL returns ~930kB carrying SEVERAL of the
account's posts, and the extractor took the first `"caption"` in document
order: a neighbouring post. `/embed/captioned/` is ~130kB and holds exactly one
post by construction. The canonical page is used only for `og:image`, a
page-level tag that cannot belong to another post.

It was not one bad row. EVERY item resolved through the canonical URL was
wrong, including a restaurant nobody had questioned — its caption went from 46
characters (a neighbour) to 428 (its own). **A wrong resolution is worse than
an empty one: it is confident, well-formed, catalogue-matched and silent.**
`scopeToShortcode` narrows any multi-post page to the requested post and
returns null — never the whole page — when the shortcode is absent.

**Proven end to end on real rows**, after the fix:

```
movies      · 1,805 chars · "Willow and Wind" · 2003 · tmdb 247447 · 0.95 · enriched · cover
restaurants ·   428 chars · "Multi Story" · Peckham Levels Level 6 · 0.95 · cover
```

Share → embed page → caption → classify → TMDB → filed with artwork. The
discarded row was correctly left alone. NOTE: the caption says 1999 and TMDB
says 2003 for that film; unresolved, and small.

### Asking the live service anything — without a laptop

The sandbox this repo is written in has an **egress policy denying
`onrender.com`, `api.expo.dev` and `instagram.com`** at the gateway. Reported,
not routed around. Diagnosis runs on a GitHub runner instead:

Actions → **Diagnose the deployed service** → `health` | `items` | `reel` |
`retry`. `health` needs no secret; the rest need `SHELF_ADMIN_SECRET`
(= Render's `ADMIN_SECRET`). `retry` re-reads every untitled item, so a
resolver fix reaches what is already sitting there. See `SETUP-ONCE.md`.

**Live reading, 2026-08-11 15:16Z:** `db: true`, `worker: "in-process"`,
`claude: true`, `tmdb: true`, **`places: false`**, `ig_resolver: false`.

## Shipped and verified

| Thing | The check that proves it |
|---|---|
| Ingest, resolve, classify, enrich | `node api/resolve.js --selftest`, `classify.js`, `items.js`, `search.js`, `profile.js` — all green |
| `api/page.js --selftest` | Green **only with `SHELF_WEB_BASE` set**. Unset, 2 of 19 fail on `og:url` being relative — correct behaviour (the code refuses to emit a canonical URL it cannot know), confusing to meet cold. On Render `RENDER_EXTERNAL_URL` supplies it. |
| The whole API, against real Postgres | `node api/e2e.mjs` → **62 checks**. Mutation-tested three ways (OPERATIONS §4d) |
| The design system | `node app/verify-design.mjs` → **21 rules + the theme bridge**; `--selftest` proves every one fires on a deliberate violation AND stays quiet on clean input |
| Every screen, looked at | `node app/preview/shoot.mjs` → 29 PNGs, 320 + 375, both schemes |
| The public pages, looked at | `node app/preview/shoot-public.mjs` → 10 PNGs, 320 + 390, both schemes, horizontal overflow MEASURED |
| Tap targets | `node app/preview/measure.mjs` → **201 controls**, smallest effective 52pt |
| The deployed API | health reports `db: true`, `worker: "in-process"`, `web_base` self-resolved, queue zeros |

## Open, with the check that would close it

- **`places: false` on the live service** — confirmed from health, not
  inferred. Restaurants cannot enrich, so they file with a Claude-derived title
  and no address. Not fatal (`enriched:false`), but it is why a restaurant
  looks thinner than a book. Closes with: a `GOOGLE_PLACES_KEY` on Render, then
  `GET /api/search?q=…` and reading the rows.
- **Nobody has watched a reel go in on the phone since the fix.** The rows
  prove the pipeline; they do not prove the share sheet, the refresh, or the
  cover rendering in iOS. Closes with: share one reel per category, then look.
- **A caption-less reel is still untested.** `by_resolver` showed `none: 1` —
  that row was discarded, so it proves nothing either way.
- **The share extension in its real host, iOS fonts, native scroll and blur**
  remain unverified by anything but a device.

## Traps already paid for

- **Four faults can hide behind one symptom.** "The app doesn't auto-update"
  was, in order: no EXPO_TOKEN · `github.event.before` empty on a manual run so
  the range said "nothing changed" · `github.event.head_commit` absent so
  `--message ""` was rejected · a ROBOT token needing an explicit `owner` in
  app.json. Each fix revealed the next. Never conclude from one green fix.
- **A repair tool that only fixes empty rows cannot fix wrong ones.**
  `retry-unread` skipped the mis-filed film because it HAD a title — just a
  different film's. `?resolver=<name>` re-reads everything a named resolver
  produced. It is opt-in because, unlike the default, it can overwrite a title.
- **A guard that blocks its own fix gets bypassed.** `owner` had to go in
  app.json for a robot token to publish, and app.json was on the native list —
  so adding it would have demanded a full rebuild. `native-changed.mjs` now
  parses both sides and ignores `owner`/`extra` specifically.

- **iOS does not remount a backgrounded app.** Every fetch on mount runs once,
  at cold start, and never again — so after sharing from another app and coming
  back, the screen shows what it showed an hour ago. This shipped, and was
  reported as "nothing is coming to the shelf when I share". `AppState` +
  pull-to-refresh. Any future screen that loads on mount has this bug until it
  handles `active`.
- **A boot spinner on this app looks exactly like the splash screen.** The
  pairing screen is the wordmark on white; `serverState()` had no timeout;
  Render's free tier sleeps after ~15 min. Reported as "stuck on the splash
  screen". Every network call now has an `AbortController`, and the screen says
  "waking the server" once it knows that is what is happening.
- **"Couldn't read this one" is not information.** Three different causes, three
  different fixes, one sentence. The row now names the cause and offers **Read
  again** (`POST /api/item/retry`).
- **A queue receipt you did not verify is a lie.** The share sheet said "Queued"
  when the real problem was that the extension had no key — and the queue lives
  in the same Keychain group the key was missing from. `queueShare` now reads
  its write back, and `NOT_PAIRED` is handled separately.
- **An unawaited `setToken` fails silently.** The next launch is back on the
  pairing screen with no explanation.
- **A diagnostic nobody can see is not a diagnostic.** `verifySharedAccess()`
  existed from day one and was rendered nowhere. It is on the card now.
- **`rootDir: api` breaks the deploy.** `api/page.js` renders the public pages
  from `app/src/design.js`. Pinned by `node api/page.js --selftest`.
- **`--selftest` leaks across imports.** `process.argv` is global; `api/ismain.js`
  exists for this.
- **An empty `onError` is not an image fallback.** The gate rejects it.
- **A test harness that dies is worse than one that fails.**
- **A rule nobody has watched fail is a comment.** Every gate rule has a probe;
  every e2e claim has a mutation.

## Standing rules

- **Render the state you are fixing, not the state you have.** The fixtures now
  carry an item Instagram refused to give a caption for, because a row that
  does not exist in `preview/stubs.js` is a row nobody has ever looked at. That
  contact sheet caught a swatch hand-aligned to the two-line case, a label
  riding the top of a centred row, and a spinner centring itself in a column of
  left-aligned text — all in one pass.
- **Reachability is a credential problem.** The device token lives in an iPhone
  Keychain; a curl gets typed on a laptop. Diagnostics take `ADMIN_SECRET` too,
  the same way `POST /api/admin/pair` does, and for the same reason: the free
  tier has no shell.
- **Measure before theorising.** The blocked-datacentre-IP theory was written
  into the plan, into OPERATIONS §0 and into two handovers, and was wrong. One
  probe settled it. When a symptom has three candidate causes, build the
  instrument that separates them before writing the fix for the likeliest.
- **A human relaying terminal output is a broken pipe, not a workflow.** When
  the sandbox cannot reach a host, put the command on a GitHub runner and read
  the job log. `.github/workflows/diagnose.yml`.
- **An entry box may never sit under the keyboard.** `KeyboardSafe` +
  `scrollKeyboardProps`, enforced by the `keyboard-safe` gate rule. (Suren's,
  after the pairing field shipped under it.)
- **One generator, two renderers.** The ex-libris plate returns a description;
  the app draws it with react-native-svg and the server draws it into the page.
- **Name the absence.** "No films matched" and "films are switched off because
  nobody set a key" must not render the same way.
- **Derive, then check the floor.** The placeholder mix was guessed at 0.42 and
  the gate rejected it at 2.3:1; 0.26 is the answer.
- **Measure the screens that only open on a tap.**
