# shelf — handover

**Read this first.** Facts, with the check that proves each. Not a summary of a
summary. Replace it wholesale at the end of the next substantial session.

---

## What shelf is

Share an Instagram reel → it lands on one of six shelves: **books ·
restaurants · movies · recipes · quotes · places**. (`travel` was renamed to
`places` on 2026-08-12; `store.ts` migrates old items on read and the server
aliases the old name for good. Log excerpts below that say `[travel]` predate
it and are otherwise accurate.) One repo, two folders:
`api/` (plain `node:http`) and `app/` (Expo, **iOS + Android**).

**The shelves live on the phone.** One JSON file, written atomically. No
accounts, no login, no pairing, no server-side rows. The API is a stateless
resolver — you send it a URL, it tells you what that URL is, and stores
nothing. The only thing it keeps is a snapshot you deliberately publish by
tapping Share, which you can revoke (a DELETE, not a flag).

## Where it stands (2026-08-16)

**On a phone, resolving real reels, updating itself over the air.** The
local-first rewrite shipped and was published OTA; quotes and places shipped
after it (EAS Update succeeded 2026-08-11 23:44Z on `efe48a4`).

### THE OUTAGE (2026-08-13) — read this before publishing anything

An update was published whose JavaScript the installed binary could not run.
`App.tsx` imports `expo-share-intent` → `expo-linking` → `requireNativeModule('ExpoLinking')`
**at module top level, no optional variant**. The phone's binary was built from
`63ddec6` (2026-08-11 13:12Z), four hours BEFORE the local-first rewrite, and
contains none of the five packages added since: expo-share-intent, expo-linking,
expo-constants, expo-splash-screen, expo-system-ui.

So the bundle threw during evaluation, `expo-updates` fell back to the EMBEDDED
bundle, and the app became the old **server-backed** version — which asked a
server for shelves that the rewrite had deleted, and said **"Couldn't reach your
shelves"**. Indistinguishable from data loss. Nothing was lost: the code that
reads `shelf.json` never ran.

**Recovered** by republishing update group `b677fb37-618b-4ecb-b7ca-9a218888e8da`
("Sharing your card left two shelves out of it, silently", commit `4d63950`) to
both branches — the last bundle published before the import landed. Confirmed
back on the device.

**Three holes, all closed:**

| Hole | Fix |
|---|---|
| `native-changed.mjs` diffs a COMMIT RANGE. It correctly refused the push that added expo-share-intent, then waved through the NEXT push, whose range was clean, carrying a bundle that imports it. | `app/update-safety.mjs` compares HEAD against the commit the last **finished build** was made from (read from `eas build:list`), cumulatively. No base commit → refuses. Wired into `eas-update.yml` before every publish. |
| `runtimeVersion` was `appVersion`, so it stayed "0.1.0" however much native code changed, and an incompatible update was offered at all. | `{"policy": "fingerprint"}`. Expo hashes the native project; adding a package changes the hash; an old binary stops being offered updates it cannot run. **Needs a build to take effect.** |
| The rules had no test. | `app/native-rules-selftest.mjs` over pure functions in `app/native-rules.mjs`. It found a live bug in its first minute: the share-extension rule matched `.ts`/`.js` but the file it names is `Press.tsx`, so changes to it had never been flagged. |

**Also deleted:** `.eas/workflows/update.yml` — an EAS-side workflow running from
the repo root while the project is in `app/`. It had failed on every push since
2026-08-11 with "Run this command inside a project directory" and had never
published anything. A permanently-red pipeline next to the one that matters is
how a real failure gets ignored.

**Verify the guard:** `cd app && node update-safety.mjs 63ddec6` — must exit 1
and name all five packages.

**START HERE: a shelf came up empty on a device on 2026-08-13** and the app
could not say why, because it was built not to. Read the next section before
anything else — the code is fixed and published, but whether that person's
items came back is the one thing in this file that is still unknown.

### The shelf that would not open (2026-08-13)

Reported, in the only words the app made available: **"WTF there is nothing on
my shelf now?"** — the morning after the `travel` → `places` rename went out
over the air.

`store.ts` ended its read with `catch { return emptyShelf() }`, under a comment
calling it the kind thing to do. It is the opposite. **Every** read failure —
a truncated file, a key of the wrong type, a bug in a migration written months
later, a genuine first launch — drew the identical empty boards and said
nothing. The app knew more than the person did and had no way to tell them.

**The line that did it** was `{ ...emptyShelf(), ...parsed }`. It reads like it
fills in gaps and does not: a spread does not skip a key whose value is wrong,
it takes it. A stored `links: null` beat the `links: []` default, `migrate`
called `.map` on it one frame later, and the catch turned that throw into an
empty shelf. The rename shipped `shelf.links.map` with nothing between it and
somebody's books.

**Reproduced in a test, not argued about.** `app/store-selftest.mjs` bundles
the REAL `store.ts` against an in-memory `expo-file-system`
(`preview/fakeFs.js`) with esbuild, so there is no second copy of the logic to
drift. With the old code restored it fails with the exact message the phone
could not show:

```
Couldn't read your shelf file (315 bytes): Cannot read properties of null (reading 'map').
```

**Fixed in three rules, `91012c0`, published OTA:**

| Rule | What it means |
|---|---|
| An empty shelf and an unreadable one are different answers | `load` returns `fresh` / `read` / `unreadable`, and the app prints the byte count and the real error on screen. A missing file next to a backup is a loss, not a first launch. |
| Nothing is overwritten until it has been copied | A file that will not parse is kept verbatim as `shelf.broken.json` **once**, so a second bad boot cannot replace the good copy. A save that SHRINKS the shelf copies what it replaces to `shelf.prev.json` first — the only save that can lose anything, and also the undo you want after binning the wrong thing. |
| A backup nobody can restore is not a backup | A **Put N back** button, which MERGES rather than replaces — by the time somebody taps it they may have added things to the shelf they were handed. |

Plus `salvage()`, for the failure the atomic write cannot prevent: a phone that
dies mid-write leaves a valid PREFIX, and a brace counter lifts whole items out
of it. 41 books survive the 42nd being half-written.

Plus `normalise()`, which checks every field of a file on disk for the SHAPE
the code expects rather than for being present.

**Six probes.** Each defence was removed in turn and the suite watched to fail.
One assertion passed with its guard removed — it staged one bad boot where the
guard is about the second — and was rewritten until it failed for the right
reason. A test that has never failed is a test that proves nothing.

**The state has a picture now**, light and dark:
`preview/shots/app-unreadable-375-{light,dark}.png`, via `?broken=1` in the
store stub. Part of why this shipped is that the empty state and the broken
state were the same screenshot, so nobody had ever looked at one of them.

**What is NOT known:** whether the reporter's own items came back. Three
outcomes are consistent with what was reported and they are distinguishable on
the device, not from here:

1. The file was intact and the migration threw — the fix alone restores it.
2. The file was damaged — **Put N back** appears with a count, and tapping it
   is the fix.
3. It was a fresh install of the new Android build. Shelves are local-only and
   do not sync, so a second device legitimately starts empty. That is the
   design working, and it is indistinguishable from a loss without looking.

**The check that closes it:** open the app after the update. Either the shelf
is there, or a notice names the file and the byte count and offers the items
back, or it says nothing — and "nothing" now means case 3.

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
Those two were **not the same failure**, which is the whole reason this entry
is long. "Book Bar UK" was the classifier keeping a suffix off the handle; the
map then found nothing, so the row was visibly thin and harmless. "The Book and
Record Bar" was the classifier asking correctly for "Book Bar" and the
GEOCODER substituting a neighbour — its name AND its coordinates. One is a
prompt problem; the other is not. From outside they looked identical.

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

### Android (2026-08-12)

**shelf is two platforms now.** The work was not "port the extension" — Android
has no extension to port. `ACTION_SEND` opens the app itself, so the app grew a
second front door and both platforms share one picker.

| | iOS | Android |
|---|---|---|
| How a share arrives | a share extension: separate process, over Instagram | `ACTION_SEND` opens the app |
| Plugin | `expo-share-extension` | `expo-share-intent` **with `disableIOS: true`** |
| Who writes the queue | the extension, then it closes | the app, from the intent |
| After that | identical — `drainShares` never knew the difference | identical |

`src/ShareBoards.tsx` is the picker; `ShareExtension.tsx` is twelve lines that
pass it `close()`. **`disableIOS` is load-bearing**: both packages build an iOS
share-extension target, and two of them is an iOS build failure caused by an
Android change. Preflight refuses a config without it.

**Two real defects, both found by rendering rather than reasoning:**

- **Android paints its status bar; iOS floats it.** The generated theme
  hardcodes it opaque white, so dark mode had a pale strip above a near-black
  app. Now set from the scheme in JS — which also means it reaches an installed
  phone over the air, where a `values-night` change would not.
- **`expo-system-ui` was missing**, so `userInterfaceStyle: automatic` was
  silently ignored on Android. Every screen in this app is designed twice and
  dark mode would simply never have turned on. `prebuild` says so in one grey
  line and the build succeeds; preflight now fails instead.

**What is actually checked, on a Linux box with no Android toolchain:**
`expo prebuild -p android` runs and the generated `AndroidManifest.xml` is
read — `ACTION_SEND` for `text/*` and `image/*`, `launchMode="singleTask"` so a
share into a running app does not stack a second copy. The Android host is
rendered at 412×915 and 360×800 in both schemes, and its 7 controls are
measured (225 across the app, all clear of 44pt). 360×800 is the tight case,
not the Pixel.

**Building it:** Actions → **Build the app** → `platform=android`,
`profile=preview`. **The first build was accepted and queued** — status
`IN_QUEUE`, build `a8fcfdfe-5d5f-4aa2-8199-27dd85932ff4`, which is proof that
credentials resolved (EAS generated the Android keystore without a prompt) and
that nothing in the config was rejected. The free-tier queue is the only thing
between that and an APK.

**An EAS build runs on Expo's servers, not on the runner.** A runner timeout
does not cancel it. `what=status` asks Expo what actually happened in about
forty seconds, which is the difference between knowing and starting a second
build to find out. The sandbox cannot reach `api.expo.dev`, same as
`onrender.com`. Both Android profiles build an **APK, not an AAB** — an AAB is
a Play upload format that downloads fine and cannot be installed, with no error
saying why. Preflight checks that too.

### Sharing was quietly dropping two shelves (fixed, `4d63950`)

Asked whether profiles worked. They did not, in three ways, none of which
errored:

| Where | What happened |
|---|---|
| `ShareSheet.tsx` | Publishing your card sent `["books","restaurants","movies","recipes"]` — a hand-written list. Quotes and travel were **silently left out of every shared card**. |
| `api/page.js` | `LIST_LABEL`/`LIST_N` were four-entry objects, so a published quote or place rendered under the heading **"Unsorted"**, with no colour of its own, on the one surface built for someone without the app. The link preview also described "books, restaurants, movies and recipes" whatever was on the card. |
| `api/page.js` | A shared quote was **severed mid-sentence with no ellipsis** — "…even if you win" then a wall of colour — while the full text sat in the block below it. |

All three are derived from one source now (`LISTS` / `D.LIST_KEYS`), and quotes
on a jacket use the app's own `excerpt` rule. Rendered and looked at: the card
shows all six shelves in their own colours, and a shared travel place says
**TRAVEL · 06**.

**The class is closed, not just the instances.** A new design-gate rule
(`no-hardcoded-lists`, 24 rules now) fires on any hand-written run of shelf
names, with `// deliberate subset` as an explicit opt-out so a real subset —
`KEEPS_CAPTION` is one — declares itself instead of looking out of date.
`page.js --selftest` (35 assertions) asserts every shelf has a heading and a
colour, and that no real shelf ever renders as Unsorted.

**Why nobody saw it:** the public fixture in `preview/shoot-public.mjs` also
stopped at four shelves, so a card with a quote on it had never once been
rendered — and the shot was 1200px tall, which cut off after the second shelf
anyway. Both fixed; that harness is the only thing that would have caught any
of this.

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

### Screenshots, camera roll, and Find (2026-08-16)

Three things were asked for and three shipped: a screenshot ingestor that
works, importing screenshots from the camera roll, and a search across every
shelf. Commits `1e76e22` and `3e1e0bb` on `main`.

**Sharing a screenshot did nothing, and had never worked.** `ShareBoards` read
the shared image, labelled the sheet "Screenshot", and then `save()` bailed
with "Nothing to save — share a link" — the one route into the app that does
not depend on Meta's cooperation was the one route that never ran. Android
dropped `shareIntent.files` entirely. The queue now carries the PATH, not the
bytes (a 1 MB base64 PNG in a Keychain value is between "slow" and "refused"),
`src/screenshots.ts` reads it out of the App Group container, shrinks anything
over the send ceiling or in HEIC, and `forgetSharedImages()` empties a
container nothing had ever cleaned.

**`src/Import.tsx`** picks up to 20 from the camera roll. Permission is asked
at the tap, never at launch; iOS "limited" is a success, not a refusal.

**`src/Find.tsx` + `src/find.js`** — one box across all six shelves. Titles,
authors, cities, cuisines, years, and the notes you typed. Accents and case
fold, one wrong letter in a long word still lands, every typed word must match
something (two words narrow, never widen), and a row whose TITLE does not hold
the query says which field did, with the words around it. The catalogue search
follows underneath, debounced, with anything already shelved removed.

Ranking lives in a pure module because **order is invisible to every other
check here**: "the right book is fourth" and "the right book is first" look
identical in a screenshot. `node app/find-selftest.mjs` asserts each claim and
probing it (AND→OR, no phrase bonus, no word-boundary snapping, shelf names
matching on prefix) fails it every time. Two probes passed silently at first —
both fixtures were staging the wrong scenario — and fixing the second exposed
a real leak: `canonical.key` was being indexed, so one catalogue id matched
every book on the shelf.

**Also shipped: `api/search.js` gained a keyless places provider.** Restaurants
fall back to OpenStreetMap when `GOOGLE_PLACES_KEY` is absent, `places` became
a searchable shelf for the first time, and neither ever reports "switched off"
now. `search selftest ok — 34 assertions`.

### THE HARNESS HAD STOPPED LOOKING (2026-08-16) — the expensive half

Everything below was green, and none of it was true.

| What was silently not happening | Why | Fix |
|---|---|---|
| `verify-design.mjs` never read `Find.tsx`. It printed "design gate clean" having never opened the file. | `SOURCES` was a hand-written list of files. The newest screen is the one nobody remembers to add. | The list is now the **directory**: `readdir(src/)` + `App.tsx` + `ShareExtension.tsx`. 15 files instead of 11. Probed: a raw `fontSize` in `Find.tsx` is now caught. |
| **No screenshots were being taken at all**, of any screen, since the screenshot commit. | `preview/stubs.js` was missing three exports `api.ts` had gained (`queueImage`, `isImageShare`, `shareRef`), so the esbuild bundle failed. That is why `Import.tsx` shipped unrendered. | Stubs added. Anything `api.ts` exports and a screen imports must exist there. |
| Every screen died on `process is not defined` once the bundle built. | `expo-image-picker` and `expo-image-manipulator` were not in `build.mjs`'s native-module swap, so the real packages went into a web bundle. | Both added to the swap; stubs in `nativeStubs.js`. |
| `Import.tsx`'s Close button shipped at **15pt painted / 31pt effective**, under the 44pt floor. | `measure.mjs` never opened the Import screen. `size={TOUCH_MIN}` sets hit slop, it does not make the box 44pt. | `closeBtn: { minHeight: TOUCH_MIN }`. Find and Import are both in the audit now — **Find with a query typed in**, because its chips and rows do not exist until there is one. |

347 controls clear the floor. A screen that is only reachable by a tap is a
screen the audit never saw unless somebody adds the tap.

### shelf runs in a browser now (2026-08-17)

**`https://surendrachaplot.github.io/shelf/`** — free, live, no quota, no
signing. The same `App.tsx`, six native modules swapped in `app/web/`. Full
detail in OPERATIONS §4b2.

Verified by `cd app && npm run web:check`, which is not "did it build": it
serves the real output, loads it in Chromium, seeds a shelf, reloads, **edits a
note through the app** and reloads again — the real `save()`, temp file and
rename, over localStorage. Probed: make `writeAsStringAsync` drop its bytes and
the check fails. Stated limit: reversing the two lines of the fake rename still
passes, because only a crash between them would show it.

`api/http.js` gained CORS for this, and it is **live and verified from
outside**: Actions → Diagnose → `health` on 2026-08-17 against deployed commit
`7c3b916` printed `HTTP/2 204`, `access-control-allow-origin: *` and
`access-control-allow-headers: content-type, x-shelf-key`. That check is part
of `what=health` now, because a browser blocks a call BEFORE sending it — the
failure never reaches a server log, and without the check the only symptom is
somebody's console saying "blocked by CORS policy".

**ONE SWITCH IS OUTSTANDING AND ONLY THE OWNER CAN FLIP IT.** The first Pages
deploy failed on `actions/configure-pages` with *"Create Pages site failed.
Resource not accessible by integration"* — the workflow token cannot create the
site and no `permissions:` block can grant it. Fix, once:
**Settings → Pages → Build and deployment → Source: GitHub Actions**, then
re-run the "Web app" workflow. The build itself is green up to that step.

**The web shelf is a SEPARATE shelf from the phone's.** No server, no sync —
that is the design, and it is the first thing to say to anybody who asks why
their books are not there.

### "Why is everything stuck on working it out" (2026-08-17)

Reported from the phone. **Not the server** — health that day was green on
`7c3b916` with Claude, TMDB and OSM all up. It was the app, and the state was a
dead end by construction:

- A share becomes a row with `status: "pending"` BEFORE any network. Right, and
  deliberate: the row is the receipt.
- `drainShares` resolves each one. On failure it writes `status: "unread"` with
  the reason, which is the state that carries a **Read again** button.
- **A resolve that neither succeeds nor fails writes nothing at all.** iOS
  suspends the app the moment you switch away, so a drain that is mid-flight
  just stops. No error, no write, row unchanged.
- The next launch reads the QUEUE, which is empty — those shares were taken off
  it. **Nothing anywhere looked at pending rows.**
- And the pending branch of `PileRow` rendered TEXT, not a control: the row
  could not be opened, retried or binned. The only escape was deleting the app.

**Fixed** by `app/src/resume.js` + `resumePending()` in App.tsx, on the rule
that a process which has just started cannot be in the middle of anything —
every pending row seen at launch was interrupted. Links are read again (bounded
to 6 a launch); a screenshot is explained instead, because the picture it came
from was in the App Group container and that is emptied after every drain.
Neither outcome leaves a row claiming to be busy. It runs at launch AND on
returning to the foreground, which is when the interruption actually happens.
The pending row is also openable now, as a belt to those braces.

`node app/resume-selftest.mjs`, in `npm run preflight` and `npm run selftest`.
Probed three ways — drop the overflow, offer a retry for a screenshot, touch
filed rows — each fails the suite.

**The workaround on a build that does not have this yet:** re-share the same
reel from Instagram. `idFor(source_url)` is deterministic and `upsert` merges
by id (keeping your note), so it lands on the SAME row and resolves it. Then
leave the app open until the rows finish.

## Shipped and verified

| Thing | The check that proves it |
|---|---|
| Every parser, prompt, clamp, cache key, renderer | `cd api && npm run selftest` — 9 files, all green |
| The design gate | `cd app && node verify-design.mjs` — every painting file, read off the disk, not a hand-written list; full `npm run verify` renders every screen |
| Build config, facts, the shelf file, the native rules, the ranking | `cd app && npm run preflight` — preflight + facts + store + native-rules + **find** selftests |
| The file that holds everything you saved | `node app/store-selftest.mjs` — real `store.ts` over an in-memory FS, six probes |
| Tap targets | `node app/preview/measure.mjs` → **347** controls, smallest effective 52pt, Find and Import included |
| Every screen, looked at | `node app/preview/shoot.mjs` → 320 + 375 + Android 412/360, both schemes, including the unreadable-shelf state |
| A deploy | `node api/smoke.mjs <url>` — commit, providers, routing, public pages |
| The real round trip | Actions → Diagnose → `resolve` (above) |
| Selftests can't rot again | `.github/workflows/checks.yml` runs them on every push — and now actually runs the design gate, which its "Design rules" step had never done |

## Open, with the check that would close it

- **THE iOS BUILD QUOTA IS SPENT.** The build triggered on 2026-08-16 failed
  in 25 seconds, and not on code: *"This account has used its iOS builds from
  the Free plan this month, which will reset in 15 days (on Tue Sep 01 2026)."*
  Credentials were fine, the project uploaded, EAS refused the build. Three
  ways forward and they are the user's call: pay for an Expo plan, wait until
  1 September, or build locally on the Mac (`cd app && npx expo run:ios
  --configuration Release`, or `eas build --local`), which does not touch the
  quota.
- **Nothing from 2026-08-16 is on a phone yet.** Screenshots, the camera-roll
  import and Find all need a BUILD — `expo-image-picker` and
  `expo-image-manipulator` are native. An iOS preview build was triggered from
  Actions → "Build the app" (ios / preview) at the end of that session; it has
  to finish, be installed, and then the three features have to be tried on the
  device. Until somebody installs it, none of this exists outside CI.
- **The Android build still fails**, `EAS_BUILD_UNKNOWN_GRADLE_ERROR`. Run
  `31816033650` errored again on 2026-08-14. The log-capture step now works,
  and the dead build link is fixed: the jq now falls back to `EAS_OWNER` /
  `EAS_SLUG` (job-level env, from app.json) when `.project.ownerAccount.name`
  and `.project.slug` come back null, which is what made the page URL
  `accounts/null/projects/null` and left the Gradle reason unread three times.
  The next Android run prints a link that opens.
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
- **A hand-written list of the lists will be wrong the next time one is added.**
  Two copies survived quotes and travel shipping — one dropped two shelves from
  every shared card, the other labelled them "Unsorted" — and neither errored.
  Derive from `LISTS`/`LIST_KEYS`; the gate now refuses a hand-written run of
  shelf names unless it says `// deliberate subset`.
- **A fixture that stops at four shelves cannot show you the fifth.** The
  public-page harness had books, restaurants, movies and recipes in it, so a
  card carrying a quote had never been rendered anywhere, by anyone. Fixtures
  are not test data — they are the only state most of this code is ever seen in.
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
- **A `catch` that returns a default is a claim about the user's data.**
  `catch { return emptyShelf() }` looked defensive and meant that every read
  failure in `store.ts` told somebody their shelf was empty, silently, with no
  way to tell that from a first launch. If a fallback would assert something
  about what a person owns, it has to say which case it is in — and it must not
  overwrite what it could not read.
- **A spread does not fill gaps, it takes keys.** `{ ...defaults, ...parsed }`
  over a file on disk hands you `links: null` whenever the file says so. Check
  each field for the SHAPE you need, not for being present.
- **A failure state with no picture will ship.** The unreadable shelf and the
  first launch rendered the same screenshot, so one of them had never been
  looked at by anyone. Every state worth handling is worth a frame on the
  contact sheet.
- **A named CI step that does not do what it is named after is worse than no
  step.** The app job's "Design rules" ran `preflight`, which checks package
  versions and plugin order and has never looked at a colour or a type size.
  It read green for weeks. Read what the step RUNS, not what it is called.
- **A guard that fires on a change it knows is harmless gets bypassed.**
  `native-changed.mjs` blocked the empty-shelf fix over a `scripts` edit in
  package.json — the same false positive its own `owner`/`extra` exemption was
  written for. Exempt narrowly, and probe that the exemption does not over-fire.
- **AN UPDATE THE BINARY CANNOT RUN DOES NOT ERROR — IT REVERTS THE APP.**
  `expo-updates` falls back to the JavaScript baked in at build time, which may
  be months old and may talk to services that no longer exist. There is no
  crash, no message, no log. The single most expensive trap in this repo.
- **A guard that diffs a commit range cannot see accumulated drift.** Refused at
  commit N, published at N+1 with a clean range. If the question is about a
  BINARY, the baseline must be the build, not the previous commit.
- **`requireNativeModule` at a module's top level throws on import.** One
  transitive dependency doing that is enough to take the whole bundle down
  before a component renders. `requireOptionalNativeModule` does not.
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
- **Never let an error become a statement about somebody's data.** An app that
  cannot read a file knows something; drawing an empty screen throws that away
  and replaces it with the most frightening thing it could have said. Say which
  failure it is, keep the bytes, offer the way back.
- **A test that has never failed proves nothing.** Every assertion in the store
  selftest was watched to fail with its defence removed. One passed anyway —
  it was staging the wrong scenario — and was rewritten. Probe first, then
  believe it.
- **Ask the person with the device one question before reading the code.**
  "Has this build been getting updates?" would have pointed at the real cause in
  the first minute. Instead: a `store.ts` bug found and blamed, then a channel
  theory asserted from a command that had errored and printed "unavailable".
  Both wrong, an hour gone, and the user's one-line correction is what solved it.
- **Never type a CLI flag from memory in a recovery script.** `eas
  update:republish --group X --branch Y` — mutually exclusive, failed the run,
  while somebody was waiting. `--help` costs ten seconds.
- **Derive, then check the floor.** The placeholder mix was guessed at 0.42 and
  the gate rejected it at 2.3:1; 0.26 is the answer.
