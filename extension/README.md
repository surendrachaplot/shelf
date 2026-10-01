# shelf — browser extension

Saves the page or the link you are looking at to your shelf.

It opens the shelf web app at `/app/?url=…`, which does the saving. The shelf
is kept in that browser. It does not sync with your phone yet.

## Three ways to save

- **Toolbar button.** Saves the page you are on.
- **Right-click → Save to shelf.** On a link, it saves the link. Anywhere else,
  it saves the page. Text you selected goes with it.
- **Keyboard.** Alt + Shift + S. On a Mac, Option + Shift + S.

If a page cannot be saved (a `chrome://` page, a file on your disk), the button
shows `!`. Hold the pointer over it to read why.

## Load it — Chrome, Edge, Brave, Arc

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave:
   `brave://extensions`, Arc: `arc://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose this folder: `shelf/extension/chrome`.
5. Pin it: click the puzzle icon in the toolbar, then the pin next to shelf.

The source is `extension/src/`. After you change a file there, run
`node extension/build.mjs`, then click the reload arrow on the shelf card.

## Load it — Firefox

Firefox 119 or later.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**
3. Choose `shelf/extension/firefox/manifest.json`.

Firefox removes a temporary add-on when it closes. To keep it, the add-on must
be signed by Mozilla. See `EXTENSION-PLAN.md`.

## Safari

Not yet. It needs Xcode and a wrapper app. See `EXTENSION-PLAN.md`. Until then,
use the bookmark below. It works in Safari.

## Change the shelf address

Chrome: right-click the toolbar button → **Options**. Firefox: `about:addons` →
shelf → **Preferences**. Type the address, click **Save**.
The default is `https://shelf-api-u8xy.onrender.com`. It is one constant, in
`src/url.js`.

## No install: a bookmark that saves

```
node extension/build.mjs --bookmarklet
```

This prints one long line that starts with `javascript:`. Make a new bookmark,
and paste that line where the address goes. Click the bookmark on any page to
save it. For a different shelf address: `node extension/build.mjs --bookmarklet https://your.domain`

Some sites block bookmarks like this one (their security policy stops the
script). The extension works on those sites.

## Checks

```
node extension/build.mjs        # src/ → chrome/ and firefox/
node extension/selftest.mjs     # no browser needed
node extension/e2e.mjs          # real Chromium, chrome/ loaded unpacked
```

`e2e.mjs` uses the `playwright-core` in `app/node_modules` and the Chromium in
`~/Library/Caches/ms-playwright/`. Set `SHELF_CHROMIUM` to use another binary,
`SHELF_E2E_SHOW=1` to watch it.

## Files

| File | What it is |
|---|---|
| `src/manifest.json` | The one manifest. It names the background file for both engines |
| `src/background.js` | The button, the menu, the shortcut. Permissions are justified at the top |
| `src/url.js` | Builds the address to open. Pure. The base URL constant is here |
| `src/options.html`, `src/options.js` | The options page |
| `src/icons/` | Made from `app/assets/icon.png` with `sips -z` |
| `build.mjs` | Copies `src/` to `chrome/` and `firefox/`. Each gets a manifest with only its own background key |
| `chrome/`, `firefox/` | Build output. This is what a browser loads. Do not edit by hand: the selftest fails if they differ from `src/` |
| `bookmarklet.js` | `bookmarkletHref(base)` |
| `selftest.mjs`, `e2e.mjs` | The checks. Not shipped |

## Make the zips for the stores

```
node extension/build.mjs
cd extension/chrome  && zip -r ../../shelf-chrome.zip  . -x "*.DS_Store"
cd ../firefox        && zip -r ../../shelf-firefox.zip . -x "*.DS_Store"
```

Chrome Web Store and Edge take `shelf-chrome.zip`. Firefox takes `shelf-firefox.zip`.
