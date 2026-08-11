# Two secrets, once, and then you stop being the network cable

Everything that has needed you to copy a command into a terminal and paste the
output back has needed it for one reason: **the agent sandbox this repo is
written in has an egress policy that denies `onrender.com`, `api.expo.dev` and
`instagram.com` at the gateway.** Not a bug and not something to route around —
the proxy documentation is explicit that a 403 there gets reported, not
retried.

GitHub is not denied. So the fix is to move the running onto a GitHub runner,
whose job logs can be read back through the API. Add these two repository
secrets and that round trip disappears.

**GitHub → the shelf repo → Settings → Secrets and variables → Actions → New
repository secret.** Twice:

| Name | Value | What it unlocks |
|---|---|---|
| `SHELF_ADMIN_SECRET` | the same string as `ADMIN_SECRET` in Render → your service → Environment | Asking the live service what it thinks: health, the last 20 items with why each one did or did not resolve, and running the resolver chain against any reel. No more "run this curl and paste it back". |
| `EXPO_TOKEN` | expo.dev → your avatar → **Account settings** → **Access tokens** → Create token | Every push publishes the update to your phone automatically. No more `npm run update`. |

That is the whole list. Nothing is stored in the repository; both live at
GitHub's end, the same way the Render deploy credential lives at Render's end.

## What each one turns on

**`SHELF_ADMIN_SECRET`** → the *Diagnose the deployed service* workflow
(`.github/workflows/diagnose.yml`), run from the Actions tab or triggered
remotely, with three questions:

- `health` — is it up, is the queue draining, which provider keys are set.
  Needs no secret; it works today.
- `items` — the last 20 rows: status, resolver, attempts, whether a caption
  came back, and `last_error`. Returns no captions, notes or images: the
  question is about the pipeline, and a debug endpoint that hands back what you
  wrote is one that should not exist.
- `reel` — runs the full resolver chain against a URL you give it and reports
  what each step got.

**`EXPO_TOKEN`** → `.github/workflows/eas-update.yml` stops skipping and
publishes. It still refuses to publish a push that changes native code, which
is the point of it: an update that silently omits a native change is far harder
to diagnose than a red tick.

## The one thing neither secret can do

`EXPO_TOKEN` ships JavaScript and assets. A change to `app.json`, a config
plugin, a native dependency or anything under `ios/` needs a **rebuild** —
`npm run ship` from `app/`, then install the new build. The CI job goes red and
says so rather than letting you believe an update carried it.

## Optional, and only if you want it fully hands-off

Expo can watch the repo itself, with no token in GitHub at all:
**expo.dev → Projects → shelf → GitHub → Connect**. That runs
`.eas/workflows/update.yml` on Expo's infrastructure — the same arrangement
Render already uses, where the credential lives at their end. `EXPO_TOKEN` does
the same job in the opposite direction and has one advantage: the publish shows
up in a GitHub job log, so it can be checked without opening a dashboard.
Either is fine. Doing both is harmless; the second publish is a no-op.
