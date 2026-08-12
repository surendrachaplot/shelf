# shelf

Share a reel from Instagram and it lands on a shelf — as a book with a cover, a
restaurant with an address, a film with a trailer, a place with a map pin, or a
quote in the words that were actually said.

Six lists: **books · restaurants · movies · recipes · quotes · travel.**

```
Instagram  ──share──▶  shelf sheet      writes to the shared Keychain,
                            │           closes in ~420ms, no network
                            ▼
                      the app, later     POST /api/resolve
                            │            scrape → Claude → catalogues
                            ▼
                    a shelf on YOUR PHONE
```

**The shelves live on the phone.** One JSON file, written atomically. No
account, no login, no pairing, no server-side rows. The API is a stateless
resolver: you send it a URL, it tells you what that URL is, and it stores
nothing. The only thing it keeps is a snapshot you deliberately publish by
tapping Share — which you can revoke, and revoking is a DELETE.

## Why it is built this way

**Meta has no API for this.** `instagram_business_basic` reads the media of the
business account that authorised your app — not an arbitrary public reel. So
reading a caption is a scrape, and the interesting part is what the scrape
actually returns:

| ask as | what comes back |
|---|---|
| a browser | 600 kB of JavaScript shell — **not one og: tag** |
| **`facebookexternalhit`** | the full metadata every chat client uses to draw a card |

Measured from the server that runs it, not from a laptop. The chain reads
`instagram.com/p/<code>/embed/captioned/` — **one post by construction** — and
touches the canonical URL only for `og:image`. Reading the canonical page for
captions filed a reel about *Willow and Wind* as *The Wicker Man*, because that
page carries several of the account's posts and the first caption in it belongs
to a neighbour.

If nothing can be read, the row keeps your link and says which of the three
causes it was. Sharing a **screenshot** instead of a link goes to vision and
depends on Meta for nothing.

**Your tap wins.** If you picked a list at share time, the model may not
override it — it only fills in the fields. It cannot see the reel; you can.

**Confidence routes, it does not gate.** A thin item waits unshelved with
whatever was salvaged, one tap from filed or binned. Nothing is silently
dropped, and nothing is silently invented.

## Layout

```
api/     node:http. No framework. Postgres only for published links.
  resolve.js      the caption chain              (--selftest, fixtures)
  classify.js     one Claude call, structured    (--selftest)
  enrich/         Open Library · TMDB · OpenStreetMap · schema.org
  resolveRoute.js the whole service, in one request — stores nothing
  publish.js      the snapshots you chose to hand somebody
  probe.js        /api/debug/reel — the instrument, not a feature
app/     Expo. iOS + Android.
  src/ShareBoards.tsx the picker — ONE component, two hosts, no network
  ShareExtension.tsx  the iOS host (12 lines: it passes close())
  App.tsx             six shelves, the pile, your card, the Android host
  store.ts            the shelf, on the phone
```

## Running it

```bash
cd api
npm install
export ANTHROPIC_API_KEY=sk-ant-…
npm run selftest          # every parser, prompt and renderer. No network.
node serve.js             # :8080
```

`DATABASE_URL` is **optional**: attach one if you want `/s/<code>` links to
work. Without it everything else runs and those two routes degrade with a
sentence rather than a stack trace.

Optional keys — each missing one degrades to `enriched: false`, never an error:
`TMDB_API_KEY`, `GOOGLE_PLACES_KEY` (OpenStreetMap covers most of it and needs
no key), `IG_RESOLVER_KEY` + `IG_RESOLVER_URL`, `ADMIN_SECRET` (guards the
probe), `SHELF_APP_KEY`, `SHELF_MODEL`.

```bash
cd app
npm install
npx expo prebuild -p ios       # required — a share extension needs a native target
npx eas build -p ios --profile development
npx eas build -p android --profile preview    # an APK you can just install
```

**Expo Go cannot host a share extension.** The first build is an EAS dev-client
build, not a QR code. Discovering that late costs a rebuild cycle.

Neither build can run from this sandbox — `api.expo.dev` is denied at the
gateway — so **Actions → Build the app** does it on a runner and prints the
install link. Android needs no Apple account and no registered device, which
makes it the short path from a push to something on a phone.

```bash
npm run preflight # the design gate's grep half, ~1s
npm run verify    # the same plus rendering every screen and MEASURING taps
```

`DESIGN.md` is the bar and the rules. shelf is **iOS and Android** — no web
surface, stated explicitly because the standing rule is that every change ships
everywhere unless you say which surface cannot have it.

The two platforms take shares differently and it is worth knowing which you are
looking at. iOS has a share extension: a separate process, over Instagram, that
writes to a shared Keychain and closes in ~420ms. Android has no such thing —
`ACTION_SEND` opens the app itself — so the same picker renders full screen
inside it and writes to the same queue. After the tap the two are identical.

## Asking the live service anything

`GET /api/health` reports which commit is running, what it stores, and which
providers it can reach. Beyond that, **Actions → Diagnose the deployed
service**: `health`, `reel` (the resolver chain out loud for one URL, from the
machine whose IP is the question), or `resolve` (the whole round trip, ending
in a list of what would land on a shelf).

## What is verified, and what is not

Verified: every module selftest, the design gate, 225 tap targets measured off
the live layout, every screen rendered and looked at in both schemes at two
widths — iOS at 375/320 and Android at 412×915 and 360×800 — and, on the live
service, a real post whose caption is nothing but a headline and eight @handles
resolving into eight enriched places. On Android, `expo prebuild` is run and
the generated manifest read, so the intent filter that puts shelf in
Instagram's share sheet is checked rather than assumed.

Not verified from this sandbox — the proxy blocks `instagram.com`,
`onrender.com` and `api.expo.dev`, and there is no iOS toolchain here: anything
needing a built IPA, and the share extension in its real host. `HANDOVER.md`
holds the current open list; `OPERATIONS.md` says what to run first.
