# shelf v1 — everything mymind has

Decided by Suren, 2026-10-01: **version 1 has everything mymind has.** Not a
later phase. This file is the checklist. `PRODUCT-PLAN.md` holds the argument
and the pricing; this holds what is done and what is left. Keep it honest: a
row is DONE only when its check has been run.

mymind's feature list was read off mymind.com on 2026-10-01.

## The checklist

| mymind has | shelf | State | The check |
|---|---|---|---|
| Save links | Share sheet, web `?url=`, Add by name | DONE | share a link on the phone |
| Save from Instagram | reels and posts | DONE | Diagnose → resolve |
| Save from YouTube, Reddit | own readers in `api/resolve.js`, no keys | DONE, live | 3 videos + 4 threads resolved live |
| Knows what a link is (article, product, book, recipe) | six shelves + classifier + `api/product.js` | DONE, live | two real shop pages returned name, brand, price |
| Read articles without clutter | `api/article.js`, Reader | DONE, live | essay + review resolved live |
| AI summaries | `classify.js` summarize | DONE, live | same |
| Search everything | `find.js` (titles, facts, notes, tags, article, screenshot text) | DONE | `find-selftest.mjs` |
| No tagging by hand | `tags.js` | DONE | `tags-selftest.mjs` |
| Linking | `links.js`, automatic | DONE (automatic only; no hand-made links) | `links-selftest.mjs` |
| Serendipity | `serendipity.js`, home strip | DONE; near/open-now needs a build | `serendipity-selftest.mjs` |
| Text recognition in pictures | `canonical.ocr_text` | BUILT, not proven live | share a screenshot, search a word in it |
| Export | JSON + HTML | DONE | `preview/phase2.mjs` |
| Browser extension | `extension/` | BUILDING (2026-10-01) | `extension/e2e.mjs` |
| **Products with prices (wishlist)** | price on the item, in rows, in a list's total. Lands in "Not shelved" until the build | DONE (the pink Wishlist SHELF needs the build) | `preview/phase2.mjs` |
| **Save pictures** | Add pictures on any list (`pictures.ts`), kept as files | DONE on web; **not yet tried on a phone** | `preview/phase2.mjs` (web) |
| **Collections / Spaces ("lists")** | `lists.js`, `ListsScreen.tsx`; Find → Your lists | DONE (a saved search can be stored but there is no screen to set one yet) | `lists-selftest.mjs`, `preview/phase2.mjs` |
| **Moodboards** | a List in "pictures" view | DONE | `preview/phase2.mjs` |
| **Notes** (quick notes, focus mode) | Write a note on any list; it is an item | DONE (no focus mode; the Notes SHELF needs the build) | `preview/phase2.mjs` |
| **Top of Mind** (pinned items) | Pin on the item page, a row on home | DONE | `preview/phase2.mjs` |
| **Highlights** (save a selected passage) | extension sends selected text | PARTLY (lands as a quote) | — |
| **Everything view** (one visual board of all items) | the first list, "Everything" | DONE | `preview/phase2.mjs` |
| **Same Vibe** (similar pictures) | — | **NOT BUILT** — needs image embeddings | — |
| **Search by colour** | — | **NOT BUILT** — needs a palette per picture | — |
| **PDFs** | — | **NOT BUILT** | — |
| **Sync across devices** | — | **NOT BUILT** — needs accounts, a database, a decision on encryption (PRODUCT-PLAN §1) | — |
| Android app | builds fail (`EAS_BUILD_UNKNOWN_GRADLE_ERROR`) | BLOCKED until the log is read | — |
| macOS app | the web app | PARTLY | — |

## Designs (Paper, file "shelf")

Page "NEXT — phase 2 screens": Wishlist shelf (07, pink `#D4107A`, white label
5.05:1), a thing to buy with its price, List open as pictures (moodboard), List
open as rows with a total, Add to a list. "Lists" is the word on screen for
what mymind calls Spaces and the older board here calls Boards.

Also there: Notes shelf (08, paper white) with the note writer, and the pinned row on home.

## Build order, with the reason for each

1. **Wishlist with prices.** `api/product.js` (parser, being written) → wire
   into the resolve route → a 7th list everywhere (`LISTS` in classify.js,
   `LIST_KEYS` + colour in design.js, theme.ts, the share picker) → price on
   the jacket, the item page and the list total.
2. **Lists** (`boards` in shelf.json: name, pinned ids, optional saved search)
   with the two views. Moodboards and wishlists are both this.
3. **Pictures as items**: a shared or picked image that names nothing is kept
   as a picture (file copied into the app's documents on the phone; a
   downscaled data URL on the web).
4. **Notes** and **Top of Mind** (small: a note is an item with text and no
   source; a pin is a flag).
5. **Everything view.**
6. **Sync + accounts.** The big one. Blocks "synced across devices" and the
   extension saving without opening a tab.
7. **Same Vibe, colour search, PDFs.**

## What needs a NEW BUILD on the phone (cannot go over the air)

`design.js`, `theme.ts`, `ShareBoards.tsx` and `package.json` are baked into
the build (see `native-rules.mjs` and the fingerprint trap in HANDOVER). So the
7th shelf, the reading type step and anything with a new native module
(location for "near you", sharing files on Android) all land together in ONE
build. Batch them, then build once.

## Only Suren can do

- Say yes to the Wishlist name and the pink, or pick another.
- Decide sync: end-to-end encrypted (recommended in PRODUCT-PLAN §1) or plain
  accounts. It needs a database URL either way.
- Chrome Web Store fee, store listings (see `EXTENSION-PLAN.md`).
- Install the next build.
