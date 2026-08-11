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

**The open question is the one the plan named on day one and nobody measured:
can the server read an Instagram caption from a datacentre IP?** Reels are
arriving and coming back with no names, which is exactly what a blocked scrape
looks like. It is also what a markup change and a caption-less reel look like,
which is why the next action is a measurement and not a guess.

### Do this first

```bash
curl -sS -H "x-shelf-secret: $ADMIN_SECRET" \
  "https://shelf-api-u8xy.onrender.com/api/debug/reel?url=<a reel that came back blank>"
```

The `verdict` field answers it in one line. OPERATIONS §0a has the table of
what each verdict means and what to do. **Do not skip to a fix.** The three
causes need three different fixes and they are indistinguishable from the app.

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

- **Milestone 0 still has no number.** See "Do this first" above. Closes with a
  verdict written into OPERATIONS §0.
- **No provider has ever been called for real.** TMDB's key is set; Google
  Places is not, so restaurants cannot enrich. Enrichment failing is not fatal
  (`enriched:false`), but an un-enriched restaurant has no address. Closes with:
  a Places key, then `GET /api/search?q=…` and reading the rows.
- **The worker has never demonstrably resolved a real reel.** Closes with:
  `select list, title, confidence, resolver from items order by created_at desc`
  — check the TITLES are right, not that rows exist.
- **Automatic OTA publishing is not switched on.** `.eas/workflows/update.yml`
  is committed and correct, but Expo's GitHub App has never been connected
  (expo.dev → Projects → shelf → GitHub → Connect). Until then every push needs
  `npm run update` from `app/`. The GitHub Actions file is only the alarm: it
  goes red when a push needs a rebuild rather than an update.
- **The share extension in its real host, iOS fonts, native scroll and blur**
  remain unverified by anything but a device.

## Traps already paid for

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
