# Where your things are

**On your phone.** One JSON file in the app's own storage
(`app/src/store.ts`). Not in an account, not in a database, not synced.

There is no sign-up, no login, no pairing code and no password, because there
is nothing to sign in to. Install it and it is yours.

## What the server is for

Three jobs a phone cannot do alone, and it keeps nothing from any of them:

| It does | It stores |
|---|---|
| **Resolve** a shared link — fetch the caption, read it with Claude, match it to a catalogue | nothing |
| **Search** the same catalogues when you add something by name | nothing |
| **Host** a snapshot when you tap Share | that snapshot, until you turn it off |

`POST /api/resolve` takes a URL and returns what it is. No row is written. It
does not know which phone asked, and there is no id to correlate on.

## The one exception, and it is yours to make

Tapping **Share** uploads a frozen copy of exactly what you are sharing — that
item, or that shelf, or your card — so a link opens for somebody with no app.

- **Frozen.** The page shows what you published, not what you have now. A link
  somebody saved should not change under them, and a live view would mean the
  server holding your current shelves.
- **Only that.** One item means one item. Your other shelves, your notes on
  other things, and everything you never shared are not in the payload.
- **Revocable, properly.** Turning a link off **deletes the row**. Not a flag,
  not a tombstone. "Off" has to mean the bytes are gone.
- **Listed.** Every link you have made is on your card with how many times it
  has been opened.

## What this costs you

**If you delete the app, your shelves are gone.** No account means no recovery.
That is the honest price of the rest of this page, and it is stated on the card
rather than buried here.

## The app key

Builds carry `SHELF_APP_KEY` and the server checks it. It is **not** a user
credential — it identifies the build, not you, it can read nothing, and losing
it exposes no data because there is no data to expose.

It exists because every resolve spends money (a Claude call, then metered
catalogue lookups). Without it the URL alone is a free API for anyone who finds
it, and the first sign would be the bill.

## Third parties, named

A resolve sends the shared URL to Instagram (to fetch the page) and the caption
text to Anthropic (to read it). A catalogue lookup sends the title — and, for a
restaurant, the city — to TMDB, Open Library or OpenStreetMap. Nothing else is
sent, and none of it is stored here.
