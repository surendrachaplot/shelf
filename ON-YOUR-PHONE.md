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
  so the share extension can hand the shared URL to the app — and App Groups
  are unavailable to free personal teams. A free account will build the app and
  produce a share extension whose writes go nowhere.
- An [Expo](https://expo.dev) account (free).
- A [Render](https://render.com) account. A database is **optional**: it backs
  published `/s/<code>` links and nothing else — your shelves live on the
  phone. [Neon](https://neon.tech) free is what §1 assumes if you want them.
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

It checks: reachable, which commit is running, which provider keys are
present, that `POST /api/resolve` — the route the entire app runs on — is
mounted and validating its input, whether the app key is enforced, that an
unknown share link renders the designed 404 rather than a stack trace, and
where your share links will point.

Every check names its own fix. A cold start is called out as a cold start
rather than a failure, and a missing TMDB/Places key is a note rather than a
FAIL, because the app is honest about those being off.

If you would rather look at it raw: `curl -s https://YOUR-API.onrender.com/api/health | jq`.

### Two free-tier facts, so you do not misread them

**Render sleeps the service after ~15 minutes, and Neon suspends after ~5.**
The first request after a quiet spell pays both cold starts — a second or two.
Slow first share, normal afterwards. That is two free tiers stacking, not the
app. Every call in the app has a timeout and says "waking the server" rather
than spinning, because an indefinite spinner under the wordmark was once
reported as "stuck on the splash screen".

**There is no worker and no queue.** Resolving a reel takes three to six
seconds — a scrape, a Claude call and a catalogue lookup — and it happens
inside the request the app makes, with a row on screen saying so. The one
architectural rule is that none of it may happen while the share sheet is
open: the extension writes to the shared Keychain and closes in about 420 ms,
making no network call at all.

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

**The first time only**, because `ship` is itself in the pull you have not done
yet — a script cannot bootstrap the commit that defines it:

```bash
cd ~/shelf && git checkout -- app && git pull && cd app && npm ci && npm run build:preview
```

**Every time after that, from `app/`:**

```bash
npm run ship      # rebuild + install (needed whenever native code changed)
npm run update    # publish over the air, no rebuild
```

That is `git checkout -- app && git pull && npm ci && eas build`. The reset is
not optional: `eas build:configure`, `eas update:configure`, `expo install` and
`expo prebuild` all rewrite `app.json` and `package.json` on the machine that
runs them, so those files are permanently modified and **every `git pull`
aborts**. Worse, when commands are chained with `&&`, the abort sends the rest
of the line into the wrong directory — which produces a confusing `ENOENT:
package.json` from the repository root and looks like a second, unrelated
problem.

Nothing is lost by the reset: everything those tools wrote is committed.

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

## 3b. Make it update itself

Once the `preview` build is on your phone, JavaScript changes reach it over the
air — no rebuild, no reinstall. Two ways:

**By hand — no token, nothing to set up.** From `app/`:

```bash
git pull && npm run push
```

`eas update` runs as you, using the login `eas login` already stored on your
Mac. It works out for itself what the pull brought in (`@{1}..HEAD`, where HEAD
was before it moved) so pulling six commits is checked as correctly as one, and
it refuses to publish if any of them changed native code.

**Automatically, with NO token — the same shape as Render.** Render deploys
atlas and soundcheck by PULLING: you connect the repo once, Render holds the
credential, nothing secret sits in the repository. Expo has the same
arrangement, and `.eas/workflows/update.yml` is written for it:

> expo.dev → Projects → shelf → GitHub → **Connect**

That installs Expo's GitHub App on the repo and is the entire setup. Caveat
worth stating: that file's schema comes from the docs and has never been run
from here, so if EAS rejects it the shape is wrong rather than the idea.

**Automatically, via GitHub Actions — needs one token.** A GitHub runner has no
browser to log in with, so it needs an Expo access token to publish as you.
That is the only reason for it. Once set, I push and your phone updates with
nothing from you:

1. https://expo.dev/settings/access-tokens → create a token
2. GitHub → the repo → Settings → Secrets and variables → Actions → New
   repository secret → name it `EXPO_TOKEN`, paste the token

This is the PUSH direction — a GitHub runner authenticating outwards to Expo —
which is why it needs a credential where the Render integration does not. It is
stored encrypted, only readable by workflows in this repo, and revocable from
that same page at any time. What it can do is publish updates and start
builds on your Expo account — nothing outside it. If that is not a trade you
want, use the by-hand form; it publishes exactly the same update.

The app picks up an update on next launch. To force one immediately, quit it
from the app switcher and reopen.

### What an update CANNOT carry

EAS Update ships JavaScript and assets. Native code needs a build. That covers
`app.json`, anything in `plugins/`, dependencies, `eas.json` and
`metro.config.js` — and the failure is nasty: publishing anyway succeeds, the
app takes the update, and the change is silently absent.

So `native-changed.mjs` classifies every push, and the workflow **refuses to
publish** rather than shipping a half-change. When it stops with that error, run
`npm run build:preview` and install the new build.

One more: `runtimeVersion` is tied to the app version in `app.json`. Bump the
version and existing installs stop receiving updates — deliberately, because a
version bump usually means native changed too.

---

## 4. Open it (0 min)

There is nothing to pair and nothing to sign into. Open the app and your
shelves are there — empty, on your phone. Share a reel from Instagram and it
starts filling.

The app checks one thing for you immediately, on your card: whether the **share
extension can read the shared Keychain**. If it cannot you get a specific
message about the app group entitlement, rather than a mystery where sharing
silently does nothing.

**When you are ready to stop strangers spending your Claude budget:** set
`SHELF_APP_KEY` on Render — but only AFTER a build carrying
`EXPO_PUBLIC_SHELF_KEY` is installed on the phone. In the other order, the
build you are holding starts answering 401 to every share. `npm run ship` does
the build; health reports `app_key_required` so you can see which state you are
in.

---

## 5. The six checks that actually prove it works

A row appearing is not a pass. **Read the titles.**

1. **Share six reels from Instagram**, one per shelf. Look at what landed: the
   titles have to be RIGHT. A row titled "Instagram" on every shelf is a
   working pipeline and a failed feature. There is no database to query — the
   shelf on screen is the record.
2. **Airplane mode → share → back online → open the app.** The item appears.
   The extension writes to the shared Keychain and never touches the network,
   so an offline share is not a special case; this is the check that proves it.
3. **Share the same reel twice.** One row, not two. The id is derived from the
   canonicalised URL, and Instagram hangs tracking junk (`?igsh=…`) off every
   share, so this is a real thing to get wrong.
4. **Share a screenshot** instead of a link. It resolves via the vision path —
   the one path that depends on Meta for nothing.
5. **Share a list post that tags rather than names** — "10 bookshops:
   @a @b @c…". Eight handles should become eight places with map pins, not one
   item called "10 bookshops". Verified on the live service; unverified on a
   phone.
6. **Publish a shelf, open the link on a device that has never seen shelf.**
   Then revoke it and reload. It must go to the same "Nothing here" page an
   invented code gives — any difference between the two is a way to guess codes.

---

## 6. Before trusting the caption path

Nothing to run by hand, and no shell needed — Render's is a paid feature
anyway. **Actions → Diagnose the deployed service:**

- `resolve` with a reel URL — the whole round trip, ending in the list of what
  would land on a shelf. This is the one that answers "does it work".
- `reel` with the same URL — the chain out loud, when the answer is no: HTTP
  status, bytes, whether it was a bot wall, which extractor got the caption.

Read the **deployed commit** the workflow prints before believing either.
Render takes a couple of minutes to ship a push, and a diagnosis run straight
after one measures the previous build.

---

## What is still unverified after all of this

Honestly, so you know what you're looking at:

- **iOS fonts.** Everything was designed against Helvetica and rendered with
  Liberation Sans in Chromium. SF Pro has different metrics; the jacket type
  solver has a deliberate margin but the first device screenshot is the check.
- **Native scroll and blur**, and the share sheet in its real host over
  Instagram rather than in a 420pt box in a browser.
- **Every provider call.** No key has ever been used from here.
- **A caption-less reel.** The unread path has copy and a Read again
  button, and no reel has actually failed since the crawler fix.
