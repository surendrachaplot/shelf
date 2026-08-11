# shelf — handover

**Read this first.** Facts, with the check that proves each. Not a summary of a
summary. Replace it wholesale at the end of the next substantial session.

---

## What shelf is

Share an Instagram reel → it lands on one of four shelves (books, restaurants,
movies, recipes). Plus: a person, a public page, and a way to hand a shelf to
somebody. One repo, two folders: `api/` (plain `node:http` + Postgres) and
`app/` (Expo + a share extension).

## Shipped and verified

| Thing | The check that proves it |
|---|---|
| Ingest, resolve, classify, enrich | `node api/resolve.js --selftest`, `classify.js`, `items.js`, `search.js`, `profile.js`, `page.js` — all green |
| The whole API, against real Postgres | `node api/e2e.mjs` → **62 checks**. Mutation-tested three ways (see OPERATIONS §4d) |
| The design system | `node app/verify-design.mjs` → **20 rules + the theme bridge**; `--selftest` proves every one fires on a deliberate violation AND stays quiet on clean input |
| Every screen, looked at | `node app/preview/shoot.mjs` → 25 PNGs, 320 + 375, both schemes |
| The public pages, looked at | `node app/preview/shoot-public.mjs` → 10 PNGs, 320 + 390, both schemes, horizontal overflow MEASURED |
| Tap targets | `node app/preview/measure.mjs` → **201 controls**, smallest effective 52pt, across every screen including the four that only open on a tap |

## Open, with the check that would close it

- **Nothing has ever run on a device.** No iOS toolchain here. iOS fonts, native
  scroll and blur, and the share extension in its real host are all unverified.
  Closes with: an EAS dev-client build, then the six checks in README §Verification.
- **Milestone 0 has never been run.** The caption hit-rate spike (`node
  api/spike-ig.mjs urls.txt`) must run **from Render**, not a laptop — datacentre
  IPs get blocked far more aggressively. Until it has a number, the resolver
  order is a guess. Closes with: a hit rate written into OPERATIONS §0.
- **No provider has ever been called for real.** TMDB and Places are written and
  gated on env keys; neither key is set. Closes with: a key, then `GET
  /api/search?q=…` and reading the rows.
- **The worker has never drained a real reel.** Closes with: share four reels,
  one per category, then `select list, title, confidence, resolver from items` —
  check the TITLES are right, not that rows exist.

## Traps already paid for

- **`rootDir: api` breaks the deploy.** `api/page.js` renders the public pages
  from `app/src/design.js` — the same file the app imports, which is the only
  arrangement where a shared link looks like the app it came from. Pinned by
  `node api/page.js --selftest`.
- **`--selftest` leaks across imports.** `process.argv` is global, so an
  imported module's selftest block fires and calls `process.exit(0)`, and the
  suite prints a pass having run nothing. `api/ismain.js` exists for this.
- **An empty `onError` is not an image fallback.** It passes a grep and leaves
  the hole. The gate now rejects the empty form specifically.
- **A test harness that dies is worse than one that fails.** e2e used to end on
  a stack trace and skip every later check — indistinguishable from passing.
- **A rule nobody has watched fail is a comment.** Every gate rule has a probe;
  every e2e claim has a mutation.

## Standing rules this session added

- **One generator, two renderers.** The ex-libris plate returns a description;
  the app draws it with react-native-svg and the server draws it into the page.
  A mark that differs between the two is not an identity.
- **Name the absence.** "No films matched" and "films are switched off because
  nobody set a key" must not render the same way. Same rule as zero-vs-couldn't-look.
- **Derive, then check the floor.** The placeholder mix was guessed at 0.42 and
  the gate rejected it at 2.3:1 on red and green; 0.26 is the answer, and 3:1 is
  the bar because placeholder text is not essential content.
- **Measure the screens that only open on a tap.** Four whole screens were
  unverified the moment they were written.
