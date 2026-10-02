# shelf, in Swift

Decided by Suren, 2026-10-02: the app is rewritten in native Swift. This folder
is that app. The Expo app in `../app` stays the reference until this one has
everything it has; `../api` is unchanged and serves both.

## The three rules of this rewrite

1. **Same bundle id, same file.** `com.surendrachaplot.shelf`. Installed over
   the Expo app it opens the same Documents folder and the same `shelf.json`.
   Nothing is migrated because nothing moved. So every key the Expo app wrote
   must survive a load and a save here (`Models.swift` keeps unknown keys).
2. **Parity is proven, not claimed.** Each pure module in `../app/src/*.js` is
   ported and checked against GOLDEN FILES: a node script runs the real JS over
   fixtures and writes its answers to JSON; the Swift test runs the port over
   the same inputs and must give the same answers. `tools/golden/*.mjs` write
   them, `Core/Tests/ShelfCoreTests/Fixtures/*.json` hold them.
3. **The design does not change.** Tokens are GENERATED from
   `../app/src/design.js` (`node tools/gen-tokens.mjs` → `Tokens.swift`), never
   typed. Radius zero. One sans family. No emoji. 44pt touch targets. Paper
   (file "shelf") and `../app/preview/shots/*.png` are what each screen must
   look like; `../DESIGN.md` is the rules.

## Layout

```
swift/
  project.yml              XcodeGen. `xcodegen generate` writes shelf.xcodeproj (not committed).
  Core/                    A Swift package, so it tests on the Mac with NO simulator:
    Sources/ShelfCore/       `cd Core && swift test`. Foundation only — no SwiftUI, no UIKit.
      Models.swift           Item, Shelf, Board, JSONValue          (done)
      ShareQueue.swift       what the share extension leaves        (done)
      Store.swift            load / save / salvage / migrate        (port of app/src/store.ts)
      API.swift              the resolver's client                  (port of app/src/api.ts)
      Drain.swift            queue → pending rows → resolved        (App.tsx drainShares/readLink + resume.js)
      Facts.swift Find.swift Tags.swift Links.swift ListsLogic.swift
      Serendipity.swift Export.swift DesignMath.swift ExLibris.swift
    Tests/ShelfCoreTests/
  Sources/                 The app target (SwiftUI). Core's sources are compiled INTO it — no module import.
    App/                     entry, AppModel
    Design/                  Tokens.swift (generated), Theme.swift
    Components/              Press, rules, labels, jackets
    Screens/                 one file per screen
  ShareExtension/          The picker over Instagram. Shares Design/ and ShareQueue.swift.
  Tests/                   App-hosted tests (need a simulator; keep these few).
  tools/                   gen-tokens.mjs, golden/
```

Types in Core are `internal` (no `public`): the app compiles the same files,
and the package tests use `@testable import ShelfCore`.

## Screens to reach parity (each has a shot in `../app/preview/shots/`)

Home bookcase (rail of nine, band, jackets on boards, empty boards, pinned row,
the "saved a year ago" strip), the pile ("Not shelved"), the item page (facts,
links, price block, note, move shelf, actions), Find, Add by name, Import
screenshots, Tags and one tag, Lists (index, pictures, rows, add to a list),
the note writer, the Reader, Your card (plate, counts, links handed out, where
things live, take a copy), the share sheet (publish a shelf / an item / the
card), and the share extension's picker.

## What the Swift app adds that Expo could not

A real share extension in Swift (no frozen JavaScript bundle), location for
"near you / open now" (`CoreLocation`, no extra module), system share for the
export, Dynamic Type later.

## Building

```
node tools/gen-tokens.mjs            # after any change to app/src/design.js
cd Core && swift test                # all logic, on the Mac, seconds
xcodegen generate
xcodebuild -project shelf.xcodeproj -scheme shelf -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

A simulator is ONE AT A TIME on this Mac: `~/gitrepo/tools/device.sh ios`
takes the lock and boots one, `device.sh release` frees it. Launch muted.
A real phone: open the project in Xcode, pick the phone, Run (team CBFCJ37VBT).

## Status

See the table at the end of `../V1-PLAN.md` ("Swift app").
