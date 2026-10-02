#!/usr/bin/env bash
# shots.sh — a picture of every screen of the Swift app, on the fixture shelf.
#
# ONE simulator at a time on this Mac: this takes the shared lock
# (~/gitrepo/tools/device.sh), boots one iPhone, and ALWAYS releases it, also
# when a step fails. The app is launched with the DebugLaunch arguments (see
# Sources/App/ShelfApp.swift), so no screen is reached by tapping.
#
#   tools/shots.sh            → shots/*.png  (compare with ../app/preview/shots/)
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/shots"; mkdir -p "$OUT"; rm -f "$OUT"/*.png
DEVICE="${DEVICE:-iPhone 17}"
ID=com.surendrachaplot.shelf
# HAVE_LOCK=1 when this shell already holds the lock (a run that was cut short).
[ -n "${HAVE_LOCK:-}" ] && ~/gitrepo/tools/device.sh touch >/dev/null || ~/gitrepo/tools/device.sh ios "$DEVICE" || exit 1
trap '~/gitrepo/tools/device.sh release >/dev/null 2>&1' EXIT

xcodegen generate >/dev/null
xcodebuild -project shelf.xcodeproj -scheme shelf -destination "platform=iOS Simulator,name=$DEVICE" \
  -derivedDataPath build build CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|BUILD" | head -5
xcrun simctl uninstall booted "$ID" >/dev/null 2>&1
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/shelf.app || exit 1
xcrun simctl status_bar booted override --time "15:48" --batteryState charged --batteryLevel 100 >/dev/null 2>&1

shot() { # name, appearance, launch args…
  local name="$1" look="$2"; shift 2
  xcrun simctl ui booted appearance "$look" >/dev/null 2>&1
  xcrun simctl terminate booted "$ID" >/dev/null 2>&1
  # A launch that hangs must not hold the one simulator for ten minutes (it
  # did, once): give it 25 seconds, then say so and move on.
  xcrun simctl launch booted "$ID" -ShelfFixture 1 "$@" >/dev/null 2>&1 & local lp=$!
  ( sleep 25; kill "$lp" 2>/dev/null ) & local wp=$!
  if ! wait "$lp"; then echo "HANG $name (launch did not return)"; fi
  kill "$wp" 2>/dev/null
  sleep 3
  xcrun simctl io booted screenshot "$OUT/$name.png" >/dev/null 2>&1 && echo "ok   $name" || echo "FAIL $name"
}

for tab in books restaurants movies recipes quotes places wishlist notes unsorted; do shot "home-$tab-light" light -ShelfTab "$tab"; done
shot home-books-dark dark -ShelfTab books
shot home-wishlist-dark dark -ShelfTab wishlist
shot home-notes-dark dark -ShelfTab notes
shot item-book-light light -ShelfOpen books-0
shot item-book-dark dark -ShelfOpen books-0
shot item-restaurant-light light -ShelfOpen restaurants-2
shot item-movie-light light -ShelfOpen movies-0
shot item-product-light light -ShelfOpen w1
shot item-note-light light -ShelfOpen n1
shot item-article-light light -ShelfOpen p4
shot reader-light light -ShelfRead p4
shot reader-dark dark -ShelfRead p4
shot find-light light -ShelfScreen find
shot add-light light -ShelfScreen add
shot import-light light -ShelfScreen import
shot profile-light light -ShelfScreen profile
shot profile-dark dark -ShelfScreen profile
shot tags-light light -ShelfScreen tags
shot tags-dark dark -ShelfScreen tags
shot tag-open-light light -ShelfScreen tags -ShelfTag "city:lisbon"
shot lists-light light -ShelfScreen lists
shot lists-dark dark -ShelfScreen lists
shot list-pictures-light light -ShelfScreen lists -ShelfList l-outfit
shot list-rows-light light -ShelfScreen lists -ShelfList l-lisbon
shot list-add-light light -ShelfScreen lists -ShelfAdding books-0
shot note-writer-light light -ShelfWrite 1
shot share-shelf-light light -ShelfShare shelf:books
xcrun simctl ui booted appearance light >/dev/null 2>&1
echo "wrote $(ls "$OUT" | wc -l | tr -d ' ') shots to $OUT"
