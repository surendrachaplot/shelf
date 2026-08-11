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
- A [Render](https://render.com) account (free tier is fine to start).
- An Anthropic API key.
- Optional now, easy later: a TMDB key (free) and a Google Places key (paid).
  Without them the app works and *says* those two shelves aren't searchable.

---

## 1. Put the API up (~10 min)

1. Push is already done — the repo is `surendrachaplot/shelf`, branch `main`.
2. In Render: **New → Blueprint**, point it at the repo. It reads
   `render.yaml` and creates three things: `shelf-api` (web), `shelf-worker`
   (worker), `shelf-db` (Postgres).
3. Set the secrets on **both** `shelf-api` and `shelf-worker`:
   - `ANTHROPIC_API_KEY` — required, this is what reads captions
   - `ADMIN_SECRET` — any long random string (api only)
   - `TMDB_API_KEY`, `GOOGLE_PLACES_KEY` — optional
4. Set `SHELF_WEB_BASE` on `shelf-api` to whatever Render gives you, e.g.
   `https://shelf-api.onrender.com`. **No trailing slash.** This is the address
   baked into every link the app hands out.

**Do not skip this check.** Migrations run on boot, so:

```bash
curl -s https://YOUR-API.onrender.com/api/health | jq
```

You want `"db": true`, and `providers.claude: true`. A 503 with a plain-English
`warn` means the worker isn't running — that is the check doing its job, not a
bug. `"ok": true` with `"db": false` means `DATABASE_URL` didn't attach.

> **The free Render tier sleeps after ~15 minutes.** The first share after a
> nap will be slow while the service wakes. That is the tier, not the app.

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

## 3. Build a dev client (~20 min, mostly waiting)

**Expo Go cannot host a share extension.** This has to be a real build.

```bash
cd app
npm install
npx eas login
npx eas build:configure          # writes the projectId into app.json, once
npx eas build -p ios --profile development
```

EAS will ask to create credentials — say yes, let it manage them. It will
register the App Group and Keychain group from `app.json` automatically.

When it finishes, open the build page on your phone and install. You will need
to trust the profile: **Settings → General → VPN & Device Management**.

Then, from the same folder, start the bundler and open the app:

```bash
npx expo start --dev-client
```

### If the first build fails

The likely three, in order:

1. **`newArchEnabled: true` vs expo-share-extension.** If the extension target
   fails to compile, set it to `false` in `app.json` and rebuild. This is the
   one I'd bet on and cannot test from here.
2. **App Group not provisioned.** Means the account is free, not paid. See §0.
3. **A native module missing from the extension bundle.** `metro.config.js`
   already wraps the config in `withShareExtension`; if a package still can't
   resolve, add it to `excludedPackages` in the plugin options.

---

## 4. Pair the phone (2 min)

The app opens on a pairing screen. Mint a code on the server:

```bash
# Render → shelf-api → Shell
node api/auth.js --pair you@email.com
```

Type the 8 characters into the app. It is single-use and expires in 30 minutes.

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
