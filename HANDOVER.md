# shelf — handover

**Read this first.** Facts, with the check that proves each. Not a summary of a
summary. Replace it wholesale at the end of the next substantial session.

---

## What shelf is

Share an Instagram reel → it lands on one of six shelves: **books ·
restaurants · movies · recipes · quotes · travel**. One repo, two folders:
`api/` (plain `node:http`) and `app/` (Expo + a share extension).

**The shelves live on the phone.** One JSON file, written atomically. No
accounts, no login, no pairing, no server-side rows. The API is a stateless
resolver — you send it a URL, it tells you what that URL is, and stores
nothing. The only thing it keeps is a snapshot you deliberately publish by
tapping Share, which you can revoke (a DELETE, not a flag).

## Where it stands (2026-08-12)

**On a phone, resolving real reels, updating itself over the air.** The
local-first rewrite shipped and was published OTA; quotes and travel shipped
after it (EAS Update succeeded 2026-08-11 23:44Z on `efe48a4`).

### Verified today, on the live service

A real post — `instagram.com/p/DboDS-UAJEb/`, a caption whose entire content is
a headline and eight @handles — resolved into **eight travel items, every one
enriched**:

```
resolver=crawler-embed-html  caption_chars=604  tagged_handles=8  items=8
  [travel] Backstory — Balham · London                       conf 0.8   OSM
  [travel] Funny Weather books + coffee — Dartmouth Park     conf 0.7   OSM
  [travel] Fable and Falcon — Chalk Farm · London            conf 0.8   OSM
  [travel] Main Character Books — London                     conf 0.8   search
  [travel] Book Bar — London                                 conf 0.8   search
  [travel] Poetry Pharmacy — London                          conf 0.8   search
  [travel] Lala Books — Camberwell · London                  conf 0.7   OSM
  [travel] The Book Elephant — Elephant and Castle           conf 0.8   OSM
```

Five carry coordinates, address and area from OpenStreetMap — two of them
opening hours, three a website — and get a `geo:` link that opens the pin.
Three are not on the map and fall back to a SEARCH url, marked
`located: false`, so the jacket says **Find on map** rather than pretending to
a pin. Twelve to fifteen seconds end to end.

**`@bookbaruk` was the defect in that list**, and it is the interesting one.
Across three runs it came back as "Book Bar UK" once and **"The Book and
Record Bar" twice** — a real bookshop, in West Norwood, with a real address and
a real pin, and NOT the shop in the post (which is Book Bar, in Bounds Green).
The model was picking between two wrong answers depending on the roll, and the
second kind is the dangerous one: a wrong place that geocodes cannot be told
from a right one by anything downstream.

**Three prompt edits failed to shift it** — the third measured against a
confirmed-deployed build (`deployed commit: 3d5f8b9 · this workflow: 3d5f8b9`)
— because the prompt was never the problem. None of the three established
which LAYER produced the name, and the two candidates were indistinguishable
from outside: the classifier guessing "The Book and Record Bar", or the
classifier asking for "Book Bar" and Nominatim handing back a neighbour.

**`canonical.asked_as` (`4bc8cd7`) settled it on the first run:**

```
[travel] The Book and Record Bar — West Norwood · London   ⟵ ASKED FOR: Book Bar
[travel] Funny Weather books + coffee — Dartmouth Park     ⟵ ASKED FOR: Funny Weather Books
```

The classifier had it right every time. `enrichTravel` was adopting a fuzzy
match's name **and its coordinates**, so the row was wrong in both of the ways
that matter and looked perfect in every way anyone could see.

**Fixed in the layer that was wrong (`1cc939a`).** The discriminator is
CONTIGUITY, not similarity: a map that EXTENDS the name found your place
("Funny Weather Books" → "Funny Weather books + coffee"); one that INTERLEAVES
other words found a different one ("Book Bar" → "Book and Record Bar"). Both
share every token — only the first keeps them adjacent. `nameFound()` refuses
the second, on restaurants as well as travel, and the place keeps its honest
search link. Not a similarity score: a threshold needs examples nobody has and
fails silently in the middle.

**Confirmed on the live service** (`a83e38f`), same post, all eight items:

```
[travel] Book Bar — London                                    conf 0.8
[travel] Funny Weather books + coffee — Dartmouth Park · London  ⟵ ASKED FOR: Funny Weather Books
```

The wrong bookshop is gone; the legitimate fuller name is kept, with the
difference recorded rather than hidden. The five OSM-located shops are
unaffected.

**Reproduce it:** Actions → *Diagnose the deployed service* → `what=resolve`,
`url=<the post>`. It prints the whole JSON and then a one-line-per-item summary.

### The thing that was built and then measured away

The plan for that post was to fetch each tagged profile and turn `@handle` into
a name. **It does not work from the machine it runs on.** From a GitHub runner
a profile gives up an og:description with a name and descriptor; from Render,
a browser UA gets **HTTP 429 and zero bytes** and a crawler UA gets 200 and
617 kB of login wall with **no og:description at all**. In production it
fetched eight profiles and returned eight nothings — `tagged_accounts: 0`.

It is deleted. Nothing replaced it, because all eight bookshops resolved
correctly without it: the classifier reads `@funnyweatherbooks` as "Funny
Weather" and the geocoder confirms or drops it. `classify.js` now states that
rule out loud instead of asking for names that never arrive. `probeProfile`
stays as the instrument — `?url=` a profile on the `reel` diagnosis.

**Live health, 2026-08-12:** `stores: "published snapshots only — no accounts,
no shelves"`, `app_key_required: false`, `claude: true`, `tmdb: true`,
`places_osm: true`, `places_google: false`.

## Shipped and verified

| Thing | The check that proves it |
|---|---|
| Every parser, prompt, clamp, cache key, renderer | `cd api && npm run selftest` — 9 files, all green |
| The design gate | `cd app && npm run preflight`; full `npm run verify` renders every screen |
| Tap targets | `node app/preview/measure.mjs` → 201 controls, smallest effective 52pt |
| Every screen, looked at | `node app/preview/shoot.mjs` → 320 + 375, both schemes, including quotes and travel |
| A deploy | `node api/smoke.mjs <url>` — commit, providers, routing, public pages |
| The real round trip | Actions → Diagnose → `resolve` (above) |
| Selftests can't rot again | `.github/workflows/checks.yml` runs them on every push |

## Open, with the check that would close it

- **The repo is still public.** Actions logs are world-readable and have
  carried item titles and captions. Closes with: Settings → General → Change
  visibility. This is the one item on the list that leaks something.
- **`SHELF_APP_KEY` is not set**, so anybody who finds the URL can spend the
  Claude budget. Order matters: `npm run ship`, install the build, THEN set it
  on Render — do it the other way round and the build you are holding 401s on
  every share. Health reports `app_key_required`.
- **The legacy wipe has not been run.** Old server-side rows still exist from
  the account era. Deliberately held until the phone is confirmed to have them
  (`GET /api/legacy/export` pulls them; the wipe needs `ADMIN_SECRET`).
- **Nothing has been watched on the device since quotes and travel shipped.**
  The rows prove the pipeline; they do not prove the share sheet, the refresh,
  or how a wall of quote jackets reads on a real screen at arm's length.
- **No end-to-end coverage of publish → read → revoke against real Postgres.**
  `e2e.mjs` tested the deleted schema and is gone (OPERATIONS §4d). Needs a
  scratch database this sandbox does not have.
- **City filter on travel and restaurants** — asked for as "eventually", not
  built. The data is already there: `city`, `area` and coordinates are on every
  enriched place.
- **`GOOGLE_PLACES_KEY` unset.** OSM covers most of it; the two unlocated
  bookshops above are what the gap looks like.

## Traps already paid for

- **Measure from the machine that will run the code.** The tagged-account path
  was built on a measurement taken on a GitHub runner and shipped dead. The
  same lesson in the opposite direction: the datacentre-IP theory was in the
  plan, in OPERATIONS §0 and in two handovers, and was wrong for posts.
- **Read which commit is answering before believing a diagnosis.** Render
  deploys a push in a couple of minutes; the tagged-accounts change was
  measured twice against the code it replaced. Health reports `commit` now and
  the workflow warns when it differs from the one it was triggered from.
- **A wrong resolution is worse than an empty one** — confident, well-formed,
  catalogue-matched and silent. The canonical Instagram page returns several
  posts; the first `"caption"` in it belonged to a neighbour, and EVERY item
  resolved that way was wrong. Read the embed page; `scopeToShortcode` returns
  null rather than the whole page.
- **A search provider answers the question it can, not the one you asked.**
  Nominatim never says "I could not find Book Bar"; it returns the closest
  thing and a confidence-free 200. Anything that takes `results[0]` on trust is
  one near-miss away from a confidently wrong row — and here it took the wrong
  shop's coordinates too. Check that what came back is what you asked for,
  every time, for every provider.
- **A test suite with no automatic caller rots.** `npm run selftest` named
  three deleted files for the whole rewrite and nobody saw, because nothing ran
  it. Two `page.js` assertions had never passed without a web host configured.
- **A 500 on a public URL is a design failure, not just a bug.** A deploy with
  no database answered stack traces on `/s/<code>` and `POST /api/publish`.
  Both degrade with a sentence now — found by running `smoke.mjs` against a
  server configured the way a stranger might configure it.
- **iOS does not remount a backgrounded app.** Reported as "nothing is coming
  to the shelf when I share". `AppState` + pull-to-refresh; any new screen that
  loads on mount has this bug until it handles `active`.
- **A boot spinner on this app looks exactly like the splash screen.** Reported
  as "stuck on the splash screen". Every network call has an `AbortController`.
- **A cache is keyed on the question and stores the answer.** Widening an
  enricher's return does not change the key, so new code reads old thin answers
  back. `SHAPE` in `cacheKey()`.
- **A repair tool that only fixes empty rows cannot fix wrong ones.**
- **A diagnostic nobody can see is not a diagnostic.** `sharedKeychainOk()` is
  on the card.
- **`--selftest` leaks across imports** — `process.argv` is global;
  `api/ismain.js` exists for this.
- **`rootDir: api` breaks the deploy**: `api/page.js` renders the public pages
  from `app/src/design.js`. Pinned by a selftest.

## Standing rules

- **A fix you cannot attribute is a guess, however green it looks.** Three
  prompt edits went at a wrong bookshop name before anybody asked which of the
  two layers had produced it — and the answer was unobtainable from outside,
  because both produce the same bytes. Build the thing that tells them apart
  FIRST. This is the same rule as the one below, failed in a fresh way on the
  same day it was written down.
- **Measure before theorising.** When a symptom has three candidate causes,
  build the instrument that separates them before writing the fix for the
  likeliest one. Every instrument here — `/api/debug/reel`, the diagnose
  workflow, `smoke.mjs` — exists because reasoning was tried first and cost a
  day.
- **Delete what the measurement disproved.** The tagged-account fetch was an
  hour of work and it went, rather than staying as an optimistic branch that
  costs eight round trips to return an empty array.
- **A human relaying terminal output is a broken pipe, not a workflow.** The
  sandbox denies `onrender.com`, `api.expo.dev` and `instagram.com`; that is
  reported, not routed around. Put the command on a GitHub runner instead.
- **Render the state you are fixing, not the state you have.** A row that does
  not exist in `preview/stubs.js` is a row nobody has ever looked at.
- **Name the absence.** "No films matched" and "films are off because nobody
  set a key" must not render the same way. `located: false` says **Find on
  map**, not a dead pin.
- **An entry box may never sit under the keyboard.** (Suren's, after the
  pairing field shipped under it.)
- **One generator, two renderers.** The ex-libris plate is described once; the
  app draws it with react-native-svg and the server draws it into the page.
- **Derive, then check the floor.** The placeholder mix was guessed at 0.42 and
  the gate rejected it at 2.3:1; 0.26 is the answer.
