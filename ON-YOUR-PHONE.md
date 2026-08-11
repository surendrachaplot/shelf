# Getting shelf onto your phone

Everything below is a step **you** have to take, because it needs an Apple
account, a Render account or a real network — none of which exist in the
sandbox this was built in. The code is done and verified as far as a Linux box
can verify it; this is the part that has never run.

Read `OPERATIONS.md` alongside this. Where the two disagree, OPERATIONS wins.

---

## 0. What you need first

- **A paid Apple Developer account ($99/yr).** Not optional here, and not for
  the usual reason. shelf uses an **App Group** and a **Keychain access group**
  so the share extension and the app can pass a token between them — and App
  Groups are unavailable to free personal teams. A free account will build the
  app and produce a share extension that cannot read your login.
- An [Expo](https://expo.dev) account (free).
- A [Render](https://render.com) account, plus a Postgres somewhere that is
  *not* Render — [Neon](https://neon.tech) free is what §1 assumes. The
  blueprint declares no database on purpose; see §1.
- An Anthropic API key.
- Optional now, easy later: a TMDB key (free) and a Google Places key (paid).
  Without them the app works and *says* those two shelves aren't searchable.

---

## 1. Put the API up (~10 min)

The blueprint declares **one free web service and no database**. The database
is external and you paste its connection string in — Render allows one free
Postgres per account, so a blueprint that declares its own cannot be imported
by anybody who already has one.

1. **Make a Postgres first.** [Neon](https://neon.tech) free tier, two minutes.
   Copy the connection string; keep `?sslmode=require` on it. Take the
   **pooled** endpoint (`-pooler` in the hostname) — it is the better default
   for a persistent pool, and the direct one is needed only in the
   share-a-database case (OPERATIONS §4a).
2. In Render: **New → Blueprint**, point it at `surendrachaplot/shelf`, branch
   `main`. It proposes exactly one service, `shelf-api`. Apply.
3. Fill in the variables it asks for:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Neon string |
   | `ANTHROPIC_API_KEY` | your key |
   | `ADMIN_SECRET` | any long random string |
   | `TMDB_API_KEY`, `GOOGLE_PLACES_KEY` | optional, leave blank for now |

   `WORKER_IN_PROCESS` is already set to `1`. `SHELF_WEB_BASE` and `DB_SCHEMA`
   are deliberately absent — the first defaults to Render's own
   `RENDER_EXTERNAL_URL`, the second is only for sharing a database with
   another project (OPERATIONS §4a).

**Do not skip this check.** One command, and it reports in sentences:

```bash
node api/smoke.mjs https://YOUR-API.onrender.com
```

It checks: reachable, database attached and migrated, queue readable, which
provider keys are present, which drain arrangement is running, that an
unauthenticated read is refused, that a bad pairing code is refused (which
proves the router, database and auth are all live at once), that an unknown
share link renders the designed 404 rather than a stack trace, and where your
share links will point.

Every check names its own fix. A cold start is called out as a cold start
rather than a failure, and a missing TMDB/Places key is a note rather than a
FAIL, because the app is honest about those being off.

If you would rather look at it raw: `curl -s https://YOUR-API.onrender.com/api/health | jq`.

### Two free-tier facts, so you do not misread them

**Render sleeps the service after ~15 minutes, and Neon suspends after ~5.**
The first request after a quiet spell pays both cold starts — a second or two.
Slow first share, normal afterwards. That is two free tiers stacking, not the
app.

**There is no worker service.** Render's free tier has none, so the same drain
runs on a 15-second timer inside the web process. That does not break the one
architectural rule here — nothing slow may happen **on the request path**, and
a timer is not the request path. When you outgrow it, uncomment the worker in
`render.yaml` and set `WORKER_IN_PROCESS=0`; `for update skip locked` makes
running both at once safe, so there is no window to get wrong.

---

## 2. Point the app at your API (1 min)

`app/eas.json` has the URL in two places (`development` and `preview`). Change
both to your Render URL:

```json
"env": { "EXPO_PUBLIC_SHELF_API": "https://YOUR-API.onrender.com" }
```

Share links default to the same host, because the same process serves them.
Only set `EXPO_PUBLIC_SHELF_WEB` if you later put the pages on a custom domain.

---

## 3. Build the app (~20 min, mostly waiting)

**Expo Go cannot host a share extension.** This has to be a real build.

**Build the `preview` profile, not `development`.** Both are real native builds
of shelf — same code, same share extension, same entitlements. The difference
is where the JavaScript comes from: `development` loads it from a dev server on
your Mac, so opening it without one running shows the Expo launcher screen and
looks like an empty app. `preview` embeds the bundle, so it opens straight into
shelf and keeps working with your laptop shut.

Use `development` only when you want to edit code and see it reload.

```bash
cd app
npm ci                                     # NOT `npm install` — ci is what EAS runs
npx --yes eas-cli@latest login
npx --yes eas-cli@latest build:configure   # writes the projectId into app.json, once
npm run build:preview
```

`npm run build:preview` runs `preflight.mjs` first and refuses to upload if
anything is wrong. Every check in it is one that has already cost a failed
remote build: the expo-share-extension major against the Expo SDK, the Swift
import that produces `no such module 'ReactAppDependencyProvider'`, a lockfile
out of sync with package.json (EAS runs `npm ci`, which errors rather than
reconciles), the config-plugin order that decides whether the share extension
can read your login, the entry-point name the native side loads by string, and
whether eas.json and api.ts agree on which server to talk to.

**`npm ci`, not `npm install`.** `ci` installs strictly from the lockfile,
which is what EAS does; `install` will happily resolve something else and leave
you debugging a build that used different versions than your machine.

**Not `npx eas`** — the package is `eas-cli` and the binary it installs is
`eas`, so `npx eas` hunts for a package called "eas" and dies with "could not
determine executable to run".

**And not `npm install -g eas-cli`** either, unless you know `/usr/local/lib`
is writable by your user — on a stock macOS node install it is not, and you get
an EACCES wall of text. `npx --yes` needs no install and no permissions.

EAS will ask to create credentials — say yes, let it manage them. It will
register the App Group and Keychain group from `app.json` automatically.

When it finishes, open the build page on your phone and install. You will need
to trust the profile: **Settings → General → VPN & Device Management**.

Then, from the same folder, start the bundler and open the app:

```bash
npx expo start --dev-client
```

### Packages EAS will pull in, and why

`eas.json` names an update channel for the development profile, so `eas build`
installs **expo-updates** the first time and asks you to re-run. expo-updates
in turn needs **expo-asset**, which it does not pull in itself — the failure is
`The required package expo-asset cannot be found` after a successful-looking
configure step. Both are pinned in `package.json` now at the versions Expo SDK
52 specifies, so a fresh clone never sees either.

expo-updates in a share extension would crash it —
`AppController.sharedInstace was called before the module was initialized` —
but `expo-share-extension` excludes it from the extension target
unconditionally, in its own Podfile writer. Nothing to configure.

### If the first build fails

The likely three, in order:

1. **`no such module 'ReactAppDependencyProvider'`.** This one already
   happened. `expo-share-extension` 5.x targets Expo SDK 54 and its Swift
   imports a React Native 0.77+ module; this project is SDK 52 / RN 0.76.5. The
   package's own README has the table — SDK 52 wants **3.x**, which is pinned
   now. If you ever bump the Expo SDK, bump this together with it.
2. **`newArchEnabled: true` vs expo-share-extension.** If the extension target
   still fails to compile, set it to `false` in `app.json` and rebuild.
3. **App Group not provisioned.** Means the account is free, not paid. See §0.
   The extension needs `keychain-access-groups` as well as the app group, and
   `expo-share-extension` does not write it — `plugins/withShareExtensionKeychain.js`
   adds it, and must stay listed BEFORE the share-extension plugin in
   `app.json`. Without it the app builds, installs, pairs, and then every share
   silently does nothing.
4. **A native module missing from the extension bundle.** `metro.config.js`
   already wraps the config in `withShareExtension`; if a package still can't
   resolve, add it to `excludedPackages` in the plugin options.

---

## 4. Pair the phone (2 min)

The app opens on a pairing screen. Mint a code:

```bash
curl -s -X POST https://YOUR-API.onrender.com/api/admin/pair \
  -H "x-shelf-secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@email.com"}'
```

Type the 8 characters into the app. Single use, 30 minutes.

There is a CLI form — `node api/auth.js --pair you@email.com` — but it needs a
shell on the server, and **Render's Shell is a paid feature**. On the free tier
that route does not exist, which would leave no way to sign in at all. Hence
the endpoint: same `ADMIN_SECRET` guard as the worker route, same single-use
short-lived code.

The email is not verified and nothing is sent to it. It is the account's
identity — the same address always reaches the same shelves, which is what lets
you re-pair a replacement phone.

The app checks one thing for you immediately: whether the **share extension can
read the Keychain**. If it can't, you get a specific message about the app
group entitlement rather than a mystery where sharing silently does nothing.

---

## 5. The six checks that actually prove it works

A row appearing is not a pass. Read the titles.

1. **Share four reels from Instagram**, one per category. Then:
   ```sql
   select list, title, confidence, resolver from items order by created_at desc limit 10;
   ```
   You are checking the **titles are right**. A row saying "Instagram" in every
   title is a passing insert and a failed feature.
2. **Airplane mode → share → back online → open the app.** The item appears.
   Proves the App Group flush; an offline share must never be a lost share.
3. **Share the same reel twice.** One row, `attempts` incremented.
4. **Share a screenshot** instead of a link. It resolves via the vision path —
   the one path that depends on Meta for nothing.
5. **Search and add**: open Add, type a book, shelve it. Then check the Places
   call count against what you'd predict after ~20 searches. A mismatch means
   the cache isn't caching.
6. **Share a shelf, open the link on a phone that has never seen shelf.** Then
   revoke it and reload. It must go to the same "Nothing here" page an invented
   code gives.

---

## 6. The one thing to run before trusting the caption path

**From Render, not your laptop.** Datacentre IPs get blocked far more
aggressively than residential ones, and a spike that passes at home and is
never repeated from the server is the classic way this ships broken.

```bash
# Render → shelf-api → Shell
node api/spike-ig.mjs urls.txt     # ~20 real reel URLs, one per line
```

Write the hit rate into `OPERATIONS.md` §0. It decides whether the paid
resolver is a fallback or the primary — the only thing downstream that changes
shape based on the answer.

---

## What is still unverified after all of this

Honestly, so you know what you're looking at:

- **iOS fonts.** Everything was designed against Helvetica and rendered with
  Liberation Sans in Chromium. SF Pro has different metrics; the jacket type
  solver has a deliberate margin but the first device screenshot is the check.
- **Native scroll and blur**, and the share sheet in its real host over
  Instagram rather than in a 420pt box in a browser.
- **Every provider call.** No key has ever been used from here.
- **The worker draining a real reel.** It has drained fixtures only.
