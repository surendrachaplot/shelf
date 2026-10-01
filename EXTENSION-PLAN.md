# shelf — browser extension: what exists, what is next

Facts, with the check that proves each. Written 2026-10-01. Phase 2 of
`PRODUCT-PLAN.md` lists "Browser extension"; this is that line.

---

## What it is

A toolbar button, a right-click item and a keyboard shortcut. Each one opens
the shelf web app at `<base>/app/?url=<link>&text=<selection>`. The web app
shows its boards ("PUT IT ON → paulgraham.com"); one tap on a shelf, or on
DECIDE FOR ME, files it. The extension holds no shelf, makes no network call
and reads no page.

**Why it works this way.** The shelf is in the web app's localStorage, on the
shelf origin. An extension cannot write there. Opening the app with the link
in the address is the one door that exists today (`app/web/native.js` →
`readShare`).

Everything is in `extension/`. Nothing under `api/` or `app/` was changed. No
dependency was added.

## What was built, with the check that proves each

| # | Thing | Where | Check |
|---|---|---|---|
| 1 | One source, built into a Chromium folder and a Firefox folder | `extension/src/`, `extension/build.mjs` → `extension/chrome/`, `extension/firefox/` | `node extension/selftest.mjs` G1–G4: both folders are byte-for-byte what the build makes from `src/` today |
| 2 | Manifest V3. Chromium loads it with no warning and no error | `src/manifest.json` | `node extension/e2e.mjs` step 1, read from the browser with error collection ON |
| 3 | Permissions: `activeTab`, `contextMenus`, `storage`. No host permissions, no content scripts, no remote code | justified at the top of `src/background.js` | selftest M4, M5, R1–R5. e2e step 1 reads Chromium's own list: **the install prompt shows no permission warning** |
| 4 | Toolbar button saves the tab you are on | `src/background.js` | e2e step 3. The click is the browser's own (`Extensions.triggerAction`), so `tab.url` comes from the activeTab grant. Remove `activeTab` and this step goes red |
| 5 | Right-click saves the link, with the selected text | `src/background.js` | e2e step 4 (handler dispatched; the item's registration is checked in step 1) |
| 6 | Keyboard shortcut, Alt+Shift+S | `_execute_action` in the manifest | e2e step 1: Chromium reports it bound, as `⌥⇧S` on this Mac |
| 7 | The shelf tab is reused, not opened again each time | `src/background.js` | e2e steps 4 and 5 (one load is 2.5 s slow, like Render waking up) |
| 8 | A tab that left shelf is not taken over; a closed one is replaced | `onUpdated` in `src/background.js` | e2e steps 6 and 7 |
| 9 | `chrome://`, `file:` and the like are refused, with the reason on the button | `src/url.js`, `refuse` in `src/background.js` | selftest U11–U14; e2e step 8 |
| 10 | The address builder: encoding, text cut at 1,000 characters and 4,000 encoded bytes, never splits a character | `src/url.js` (pure, no browser API) | selftest U1–U17, B1–B7 |
| 11 | Options page: change the base URL. A bad address is refused and not stored | `src/options.html`, `src/options.js` | e2e step 2. It also MEASURES the design: radius 0 on every element, one family, 3px rules, natural-width buttons, both colour schemes |
| 12 | Icons 16/32/48/128 | `src/icons/`, from `app/assets/icon.png` with `sips -z` | selftest F3 reads each PNG's own size from its header |
| 13 | Bookmarklet: a save button with nothing to install | `extension/bookmarklet.js` → `bookmarkletHref(base)` | selftest K1–K9; e2e step 9 puts it in a real `href="…"` and clicks it |
| 14 | The worker throws nothing through all of the above | — | e2e step 10: Chromium's recorded runtime errors, empty |

```
node extension/build.mjs      →  extension build: extension/chrome/  extension/firefox/
node extension/selftest.mjs   →  extension selftest: all 112 checks passed
node extension/e2e.mjs        →  e2e: all 34 passed, in a real Chromium with the extension loaded unpacked
```

**And once, against the live site** (not in `e2e.mjs`, because it costs a
model call): Chromium with `extension/chrome/` loaded, on
`paulgraham.com/greatwork.html`, toolbar action → a tab opened on
`shelf-api-u8xy.onrender.com/app/`, the boards came up naming
`paulgraham.com`, the address bar was cleaned to `/app/`. One tap on DECIDE
FOR ME → `POST /api/resolve`, and the link was in `shelf.fs:shelf/shelf.json`
in that browser's localStorage, `status: "pending"`.

The options page is on Paper: file "shelf", page "EXTENSION — options page",
light and dark, named layers, read back with `get_tree_summary`.

### What the real browser taught

- **"0 warnings" was false the first time.** Chromium records manifest
  warnings only when Developer mode's error collection is on. With it off the
  list is empty whatever the manifest says. A mutation probe (a bogus manifest
  key that the test did not notice) exposed it. With collection on, the single
  two-key manifest showed `'background.scripts' requires manifest version of 2
  or lower`. That is why there is a build step and two folders.
- **A timer cannot tell whose page load it is.** The first version called a
  "loading" event ours if it came within 2 s of the save. Chromium sends
  "loading" when the response ARRIVES, so a slow server made the extension
  forget its tab every time. It tracks load state now (`pending` →
  `complete`).
- **Chromium styles the body of an extension page itself**
  (`font-family: system-ui; font-size: 75%`). The font must be set on `body`.
  The "one family" check caught it.
- **`/tmp` is a symlink on a Mac.** `build.mjs` compared paths as typed,
  decided it was not the main module when run from a temp folder, and built
  nothing without a word. It compares real paths now.

## The honest limits of v1

1. **Two actions, not one.** The click opens the boards; a tap on a shelf
   files it. That is the web app's own flow and the extension does not skip it.
2. **It hands the link to a tab.** A shelf tab comes to the front on each
   save. There is no background save.
3. **The shelf is per browser.** Chrome on the laptop, Safari on the laptop
   and the phone are three shelves. Nothing syncs until accounts and sync
   exist (`PRODUCT-PLAN.md` §1). The options page says so. Clearing site data
   for the shelf site clears that shelf.
4. **The saved link is in the query string, so the server sees it** in the
   request for `/app/` (Render's request log) before the app sends it to the
   resolver. A fragment (`/app/#url=…`) would keep it off that first request.
   That is a change in `app/web/native.js`, not here.
5. **The toolbar and the shortcut send no selected text.** Only the
   right-click menu does. Reading a selection on a toolbar click needs the
   `scripting` permission.
6. **Reuse covers the tab the extension opened**, not a shelf tab you opened
   by hand. Finding any shelf tab by its address needs the `tabs` permission,
   and that puts "Read your browsing history" on the install prompt. One known
   hole is written at the listener in `src/background.js`.
7. **The bookmarklet is blocked on some sites** by their content security
   policy. The extension is not.
8. **Minimum browsers:** Chrome 111, Firefox 119 (`String.toWellFormed`).

## Not verified, and exactly why

| What | Why not |
|---|---|
| A human click on the toolbar button, the real right-click menu, the real key press | Page automation cannot drive browser chrome. The action ran through the browser's own `Extensions.triggerAction`; the menu handler was dispatched with the `info` a click carries |
| Firefox, at all | No Firefox on this Mac and no Playwright Firefox in `~/Library/Caches/ms-playwright/`. `extension/firefox/` follows Mozilla's documented keys and has never been loaded |
| Edge, Brave, Arc | Same engine as the Chromium 151 that was tested. Not loaded: Arc is the owner's own browser and profile |
| Safari | `xcrun safari-web-extension-converter extension/chrome` runs and makes an Xcode project; its Swift compiles and the `.appex` is produced with the files in it. The build then stops at `ValidateEmbeddedBinary`: it is unsigned. The converter also warns that Safari does not support `background.type` (module) and `open_in_tab`. Never loaded in Safari: that needs the team's signature, or "Allow unsigned extensions" switched on by hand |
| The item reaching `resolved` on the live site | The live check stopped at `pending` with the resolve call sent. What happens next is the app and the API, unchanged |
| `contextMenus.removeAll()` before `create` | A guard for a duplicate-id error on update. Removing it turned no check red: Chromium 151 recorded no error either way |

## What each store needs

**Chrome Web Store** (also serves Brave, Arc, Opera, Vivaldi)
- A developer account: **$5, once.** 2-step verification on the Google account.
- The zip: `cd extension/chrome && zip -r ../../shelf-chrome.zip . -x "*.DS_Store"`
- Listing: description, one screenshot at 1280×800 or 640×400, a 440×280
  promo tile, a category, the "single purpose" line.
- A written reason for each permission. They are at the top of `src/background.js`.
- The data form: it handles the address of the page you save, and text you select.
- **A privacy policy URL.** `https://shelf-api-u8xy.onrender.com/privacy`
  answered 404 on 2026-10-01.
- Review: days, usually. No host permissions and no remote code is the short queue.

**Firefox Add-ons (AMO)**
- Free. A Mozilla account.
- The zip: `cd extension/firefox && zip -r ../../shelf-firefox.zip . -x "*.DS_Store"`
- Mozilla signs it. Without the signature Firefox drops the add-on at restart.
- The add-on id is `shelf@shelf.extension` (`src/manifest.json`). **It cannot
  change after the first upload.**
- `data_collection_permissions` is declared as `browsingActivity` and
  `websiteContent`, because the saved address and the selected text do go to
  the shelf server. Firefox shows this at install. `none` would be quieter and
  not true.
- There is no bundler and no minifier, so no source upload is asked for.

**Edge Add-ons**
- Free. A Partner Center account.
- `shelf-chrome.zip`, unchanged. Its own listing text and screenshots.
- Review: up to about a week.

**Safari**
- Xcode (installed) and the Apple developer account (team `CBFCJ37VBT`).
- `xcrun safari-web-extension-converter extension/chrome --app-name shelf --bundle-identifier <id> --macos-only`
- Sign with the team, build, turn it on in Safari, and run the three saves.
  If Safari will not run a module service worker, add a `safari` target to
  `build.mjs` that joins `url.js` into `background.js`.
- It ships as a Mac app through App Store Connect, with App Review.
- iPhone Safari: the extension would ride inside the iOS app as a new target.
  That is a native build, not an over-the-air update.

## v2 — once sync exists

Do not build these before `PRODUCT-PLAN.md` §1. Without an account there is
nowhere for a background save to go.

1. **Save in the background.** The worker posts the link to the sync API with
   the account's key. No tab opens. Needs one host permission, for the shelf
   API only.
2. **A popup that shows what it became.** "Piranesi · Susanna Clarke · books",
   the shelf it went to, and an undo. The boards move into the popup, so it
   is one click again.
3. **Highlight to quote.** Select a sentence, right-click, and it is a quote
   on the quotes shelf with the page as its source. The menu already carries
   the selection; v2 gives it its own item.
4. **Exact tab reuse**, by the web app answering the extension
   (`externally_connectable`, on the final domain), if a tab is still opened.
5. **Selection from the toolbar and the shortcut** (`scripting` + activeTab).

## The order

1. Owner: load `extension/chrome` unpacked in Arc and use it for a few days
   (`extension/README.md`).
2. Owner: decide the domain and the Firefox add-on id. The domain is one line:
   `DEFAULT_BASE` in `extension/src/url.js`, then `node extension/build.mjs`.
3. A `/privacy` page on the site, from `PRIVACY.md`, with a paragraph on the
   web app and the extension. (`api/`, another session's files.)
4. A page on the site with the bookmarklet as a link to drag. (`api/landing.js`.)
5. Add `node extension/selftest.mjs` to `.github/workflows/checks.yml`, so a
   stale `chrome/` or `firefox/` fails the push.
6. Firefox: install it, load `extension/firefox/manifest.json`, do the three
   saves by hand.
7. Chrome Web Store, then AMO, then Edge.
8. Safari.
9. v2, after sync.

## Only the owner can do these

- Pay the $5 Chrome Web Store fee, and turn on 2-step verification.
- Create the three store accounts and listings (Chrome, Mozilla, Edge).
- Give a privacy policy URL, and stand behind what it says.
- Choose the Firefox add-on id before the first upload.
- Choose the domain.
- Sign and submit the Safari app from the Apple account.
- Take the store screenshots, or approve them.

## The probes

Every assertion was watched to fail by breaking the thing it defends.

**selftest:** 84 one-line mutations of `src/`, `build.mjs` and
`bookmarklet.js`. 83 turned a named assertion red. All 56 assertion ids went
red at least once. The survivor is equivalent: in `bookmarklet.js`, without
`if (!b.ok) throw`, the next line throws anyway with a worse message.
The first run had a second survivor — "refuse plain http pages" passed,
because nothing checked that an http page IS saved. U17 was added for it.

**e2e:** 24 mutations, 23 red.

| Mutation | What went red |
|---|---|
| never reuse the shelf tab | step 4 "the first one was reused", steps 5, 6, 7 |
| never forget a tab that moved on | step 6, both |
| "complete" never clears `pending` | step 6, both |
| `pending` not set on reuse | step 5 (the slow load forgets the tab) |
| refusal shows no badge | step 8 |
| toolbar ignores the tab's address | step 3, all four |
| `activeTab` removed from the manifest | step 3, all four |
| right-click saves the page, not the link | step 4 |
| right-click drops the selection | step 4 |
| menu item never created | step 1 |
| `tabs` permission added | step 1 "NO permission warning" |
| an unknown manifest key | step 1 "no warning and no error" |
| Chromium copy keeps `background.scripts` | step 1 "no warning and no error" |
| worker throws during a save | step 10 |
| no shortcut | step 1 |
| options does not store | step 2 and everything after |
| options stores a bad address | step 2 |
| a rounded button | "radius zero on every element" |
| a stretched button | "buttons are natural width" |
| body font left to Chromium | "one family" |
| a 1px rule | "the rules are 3px" |
| no dark scheme | "dark: #FFFFFF on #0A0A0A" |
| bookmarklet opens the wrong path | step 9 |
| `contextMenus.removeAll()` removed | **nothing** — see "Not verified" |

The probes also found three weak e2e checks, all fixed: the reuse check read
the tab count before a second tab had time to appear; "natural width" allowed
two half-width buttons; and the options checks read the field before the page
had filled it, which failed some runs.
