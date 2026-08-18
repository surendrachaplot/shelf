#!/usr/bin/env bash
#
# mac-build.sh — build shelf onto the iPhone plugged into this Mac.
#
# ONE COMMAND, NO PATHS TO REMEMBER. It finds the repo (or clones it), checks
# every tool it needs BEFORE doing anything slow, checks the phone is actually
# connected and unlocked, and then builds. Every failure it can foresee is
# printed as a sentence saying what to do, not as an Xcode stack trace.
#
# It spends NO EAS BUILD QUOTA. Xcode does the work on this machine, which is
# the whole point: the free plan's iOS builds ran out on 2026-08-16 and reset
# on 1 September.
#
#   curl -fsSL https://raw.githubusercontent.com/surendrachaplot/shelf/main/app/mac-build.sh -o /tmp/shelf-build.sh
#   bash /tmp/shelf-build.sh
#
# Or, from anywhere inside a checkout: bash app/mac-build.sh
#
# SHELF_DRY_RUN=1 walks every check and prints what it would run, changing
# nothing. That is how the flow below is tested off a Mac.
set -uo pipefail

DRY="${SHELF_DRY_RUN:-}"
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  note  %s\n' "$*"; }
die()  { printf '\n\033[1mSTOPPED: %s\033[0m\n' "$1"; shift; [ $# -gt 0 ] && printf '%s\n' "$@"; exit 1; }
run()  { if [ -n "$DRY" ]; then printf '  would run: %s\n' "$*"; else "$@"; fi; }

# ── 1. is this even a Mac ────────────────────────────────────────────────────
say "1/8  This machine"
if [ "$(uname -s)" != "Darwin" ]; then
  [ -n "$DRY" ] || die "this only builds on a Mac — an iPhone app needs Xcode, which is macOS only." \
    "On anything else, use the web version instead."
  warn "not macOS — continuing because SHELF_DRY_RUN is set"
else
  ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"
fi

# ── 2. find the repo, or clone it ────────────────────────────────────────────
# Nobody should have to remember where they cloned something a month ago.
say "2/8  Where shelf is"
REPO=""
looks_right() { [ -f "$1/app/app.json" ] && [ -d "$1/api" ]; }

# a. Running from inside a checkout? Walk up from this script and from $PWD.
for start in "$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" "$PWD"; do
  d="$start"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if looks_right "$d"; then REPO="$d"; break 2; fi
    d="$(dirname "$d")"
  done
done

# b. Otherwise look for it. Depth 6 covers ~/Developer/shelf, ~/code/x/shelf and
#    the like without walking the whole disk; Library and node_modules are
#    pruned because that is where a search like this otherwise spends a minute.
if [ -z "$REPO" ]; then
  while IFS= read -r cand; do
    [ -n "$cand" ] || continue
    if looks_right "$cand"; then REPO="$cand"; break; fi
  done < <(find "$HOME" -maxdepth 6 -type d -name shelf \
             \( -path '*/node_modules/*' -o -path "$HOME/Library/*" \) -prune -o \
             -type d -name shelf -print 2>/dev/null)
fi

# c. Still nothing: clone it. The repo is public, so this needs no credentials.
if [ -z "$REPO" ]; then
  REPO="$HOME/Developer/shelf"
  warn "no checkout found — cloning into $REPO"
  run mkdir -p "$HOME/Developer"
  run git clone https://github.com/surendrachaplot/shelf.git "$REPO" \
    || die "could not clone the repo." "Check the network, then run this again."
fi
ok "$REPO"
APP="$REPO/app"
[ -n "$DRY" ] || [ -d "$APP" ] || die "found $REPO but it has no app/ folder — that is not the shelf repo."

# ── 3. the tools ─────────────────────────────────────────────────────────────
# All of them, BEFORE the slow parts. Failing on a missing tool twenty minutes
# in is the thing this section exists to prevent.
say "3/8  Tools"
if [ "$(uname -s)" = "Darwin" ]; then
  command -v xcodebuild >/dev/null 2>&1 || die "Xcode is not installed." \
    "Install Xcode from the App Store (it is large — start it now), open it once so it installs its components, then run this again."
  DEVDIR="$(xcode-select -p 2>/dev/null || true)"
  case "$DEVDIR" in
    *CommandLineTools*) die "only Xcode's command line tools are installed, not Xcode itself." \
      "Install Xcode from the App Store, then run:" "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" ;;
    "") die "Xcode's path is not set." "Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" ;;
  esac
  ok "Xcode $(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}') at $DEVDIR"
fi

command -v node >/dev/null 2>&1 || die "Node is not installed." \
  "Install it with: brew install node@20     (or from https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || die "Node $(node -v) is too old — Expo SDK 52 needs 18 or newer." \
  "brew install node@20 && brew link --overwrite node@20"
ok "Node $(node -v)"
command -v git >/dev/null 2>&1 || die "git is not installed." "Run: xcode-select --install"
ok "git $(git --version | awk '{print $3}')"

# CocoaPods is installed by prebuild if missing, so this is a note, not a stop.
if command -v pod >/dev/null 2>&1; then ok "CocoaPods $(pod --version 2>/dev/null)"; else warn "CocoaPods not found — Expo will install it when it needs it"; fi

# ── 4. latest code ───────────────────────────────────────────────────────────
say "4/8  Latest code"
cd "$APP" 2>/dev/null || { [ -n "$DRY" ] || die "cannot enter $APP"; }
if [ -z "$DRY" ] && [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
  # Never throw away somebody's work to save a step.
  warn "there are uncommitted changes in the repo — NOT pulling, building what is on disk"
  git -C "$REPO" status --short | head -10
else
  run git -C "$REPO" pull --ff-only
fi
run npm ci
ok "dependencies installed"

# ── 5. the two-second checks ─────────────────────────────────────────────────
# preflight has caught version mismatches that otherwise fail ten minutes into
# a build with an Xcode error naming a Swift module nobody has heard of.
say "5/8  Checks before the slow part"
run npm run preflight || die "preflight failed — fix what it names above before building." \
  "This is the same check that runs before every EAS build."

# ── 6. the phone ─────────────────────────────────────────────────────────────
say "6/8  The iPhone"
UDID=""
if [ "$(uname -s)" = "Darwin" ]; then
  # xctrace lists simulators too; a real device has a UDID and no "Simulator".
  DEVLINE="$(xcrun xctrace list devices 2>/dev/null | grep -iv simulator | grep -iE 'iphone|ipad' | head -1)"
  if [ -z "$DEVLINE" ]; then
    die "no iPhone is connected." \
      "  1. Plug it in with a cable." \
      "  2. Unlock it, and tap Trust if it asks." \
      "  3. Settings → Privacy & Security → Developer Mode → on (the phone reboots)." \
      "Then run this again."
  fi
  UDID="$(printf '%s' "$DEVLINE" | sed -n 's/.*(\([0-9A-Fa-f-]\{8,\}\)).*/\1/p' | tail -1)"
  ok "$(printf '%s' "$DEVLINE" | sed 's/ *(.*//')${UDID:+  ($UDID)}"
else
  warn "not macOS — skipping the device check"
fi

# ── 7. the native project ────────────────────────────────────────────────────
# NOT --clean when ios/ already exists: a clean prebuild throws the folder away,
# INCLUDING the signing Team you set in Xcode, and then the next build fails
# for the reason you just fixed. Set FRESH=1 to force it.
say "7/8  The native project"
if [ ! -d "$APP/ios" ] || [ -n "${FRESH:-}" ]; then
  run npx expo prebuild -p ios --clean || die "prebuild failed — see the error above."
  ok "ios/ generated from app.json"
else
  run npx expo prebuild -p ios || die "prebuild failed — see the error above."
  ok "ios/ updated (kept your Xcode signing — FRESH=1 to regenerate from scratch)"
fi

# ── 8. build and install ─────────────────────────────────────────────────────
# RELEASE, always. A Debug build reads its JavaScript from this laptop over the
# network: unplug, and the app is a white screen with a red box on it.
say "8/8  Building — 10-20 minutes the first time"
if [ -n "$UDID" ]; then
  run npx expo run:ios --device "$UDID" --configuration Release
else
  run npx expo run:ios --device --configuration Release
fi
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  cat <<'HELP'

That failed. The overwhelmingly likely reason is SIGNING, and it needs Xcode
once — after which this script works on its own forever.

  1. open ios/shelf.xcworkspace          (from the app folder)
  2. click the "shelf" project, then the "shelf" TARGET
     → Signing & Capabilities → Team → your Apple Developer team
  3. NOW DO THE SAME FOR THE "shelfShareExtension" TARGET.
     This is the one everybody forgets. Miss it and the app installs
     perfectly and the Instagram share sheet does nothing at all.
  4. run this script again.

A paid Apple Developer account is required and there is no way around it: this
app uses an App Group, which is how the share extension hands a reel to the
app, and a free Apple ID cannot create one.

If the error mentions a device instead: unlock the phone, tap Trust, and check
Settings → Privacy & Security → Developer Mode is on.
HELP
  exit "$STATUS"
fi

say "Done"
cat <<'DONE'
shelf is on your phone, built from the latest code:

  · sharing a screenshot works
  · Import brings screenshots in from the camera roll
  · Find searches every shelf at once
  · rows stuck on "Working it out…" heal themselves on this first launch

This build takes no over-the-air updates. To change what is on the phone,
run this script again.
DONE
