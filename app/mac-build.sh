#!/usr/bin/env bash
#
# mac-build.sh — run the EAS build on this Mac instead of on Expo's servers.
#
# THE SAME BUILD, NOT A DIFFERENT ONE. `eas build --local` reads the same
# eas.json profile the cloud reads: the same channel, the same env baked in, the
# same credentials — the distribution certificate and provisioning profiles
# already on your Expo account, including the share extension's. Nothing about
# the resulting app differs from a cloud build except which machine compiled it.
#
# That last part is the point: a --local build spends NO EAS BUILD QUOTA. The
# free plan's iOS builds ran out on 2026-08-16 and reset on 1 September, and
# this is the way through that fortnight.
#
# WHY NOT `expo run:ios`. It also builds on this Mac, but it is a different
# thing: Xcode signing you have to set by hand on TWO targets, no channel, no
# baked env. Same app, different recipe, and a second recipe is a second set of
# things that can be subtly wrong.
#
# ONE COMMAND, NO PATHS TO REMEMBER:
#
#   curl -fsSL https://raw.githubusercontent.com/surendrachaplot/shelf/main/app/mac-build.sh -o /tmp/shelf-build.sh
#   bash /tmp/shelf-build.sh
#
# It clones the repo itself into ~/shelf-build (or pulls, if it is already
# there). SHELF_DIR=/path/to/shelf builds from a checkout you already have.
#
# SHELF_DRY_RUN=1 walks every check and prints what it would run, changing
# nothing. That is how the flow below is tested off a Mac.
#
# SHELF_DIR=/path/to/shelf skips the search entirely.
#
# PROFILE=development builds the dev client instead of the preview build.
set -uo pipefail

# BUMP THIS whenever the script changes. It is printed on the first line, so
# the output itself says which copy ran — "still the same" and "still running
# the copy in /tmp from twenty minutes ago" look identical without it, and one
# round of that is one round too many.
SCRIPT_VERSION="2026-08-22-e"

DRY="${SHELF_DRY_RUN:-}"
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  note  %s\n' "$*"; }
die()  { printf '\n\033[1mSTOPPED: %s\033[0m\n' "$1"; shift; [ $# -gt 0 ] && printf '%s\n' "$@"; exit 1; }
run()  { if [ -n "$DRY" ]; then printf '  would run: %s\n' "$*"; else "$@"; fi; }

# ── 1. is this even a Mac ────────────────────────────────────────────────────
printf '\n\033[2mshelf mac-build.sh  %s\033[0m\n' "$SCRIPT_VERSION"
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
say "2/8  The code"
# NO SEARCHING. The repo is public and its address is known, so where a copy
# might happen to sit on this Mac is not a question worth asking — and asking
# it is what made this step hang: an unpruned walk of a home folder goes
# through iCloud Drive and never comes back.
#
# One known path, cloned if absent, pulled if present. SHELF_DIR overrides it
# for anybody who wants the build to come out of a checkout they are working
# in — but nothing needs that to be true.
# Where to put it. If you keep repositories somewhere in particular, it goes
# there — a build script should not scatter a folder across somebody's home
# directory when they clearly have a place for this kind of thing.
if [ -n "${SHELF_DIR:-}" ]; then REPO="$SHELF_DIR"
else
  REPO="$HOME/shelf-build"
  for home_for_repos in "$HOME/gitrepo" "$HOME/gitrepos" "$HOME/repos" "$HOME/Developer" "$HOME/code" "$HOME/Code" "$HOME/projects" "$HOME/Projects"; do
    [ -d "$home_for_repos" ] && { REPO="$home_for_repos/shelf"; break; }
  done
fi
looks_right() { [ -f "$1/app/app.json" ] && [ -d "$1/api" ]; }

if looks_right "$REPO"; then
  ok "$REPO"
  printf '  · fetching the latest\n'
  if [ -z "$DRY" ] && [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
    # EAS builds from COMMITTED state, so an uncommitted change is a change
    # that will NOT be in the app you install. Never silently thrown away.
    warn "uncommitted changes here — NOT pulling. The build uses committed state, so these will be missing from it:"
    git -C "$REPO" status --short | head -10
  else
    run git -C "$REPO" fetch origin main --quiet
    run git -C "$REPO" reset --hard origin/main --quiet
  fi
elif [ -e "$REPO" ] && [ -n "${SHELF_DIR:-}" ]; then
  die "SHELF_DIR=$REPO is not a shelf checkout." "It needs app/app.json and api/ inside it."
else
  printf '  · cloning github.com/surendrachaplot/shelf into %s\n' "$REPO"
  run rm -rf "$REPO"
  run git clone --depth 50 https://github.com/surendrachaplot/shelf.git "$REPO" \
    || die "could not clone the repo." "Check the network and run this again."
  ok "$REPO"
fi

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

# CocoaPods and fastlane are what an iOS EAS build shells out to. Missing
# CocoaPods is fine — the build installs it. Missing fastlane is NOT: a local
# iOS build fails on it minutes in, with a Ruby error that names neither.
if command -v pod >/dev/null 2>&1; then ok "CocoaPods $(pod --version 2>/dev/null)"; else warn "CocoaPods not found — the build installs it when it needs it"; fi
if [ "$(uname -s)" = "Darwin" ]; then
  if command -v fastlane >/dev/null 2>&1; then
    ok "fastlane $(fastlane --version 2>/dev/null | awk '/fastlane [0-9]/{print $2; exit}')"
  else
    die "fastlane is missing, and a local iOS build needs it." \
      "Install it with:  brew install fastlane" \
      "(Homebrew itself: https://brew.sh — one paste in this terminal.)"
  fi
fi

# ── 4. dependencies ──────────────────────────────────────────────────────────
say "4/8  Dependencies"
cd "$APP" 2>/dev/null || { [ -n "$DRY" ] || die "cannot enter $APP"; }
run npm ci
ok "installed"

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

# ── 7. logged in to Expo ─────────────────────────────────────────────────────
# The build needs the account that holds the certificates. Without this it
# stops half way through and asks, which is a bad place to discover it.
say "7/8  Expo account"
EAS="npx --yes eas-cli@latest"
if [ -n "$DRY" ]; then
  warn "would check: $EAS whoami"
else
  WHO="$($EAS whoami 2>/dev/null | tr -d '\r' | tail -1)"
  if [ -z "$WHO" ] || printf '%s' "$WHO" | grep -qi 'not logged in'; then
    warn "not logged in — opening the Expo login now"
    $EAS login || die "could not log in to Expo." "Run \`npx eas-cli@latest login\` yourself, then run this again."
    WHO="$($EAS whoami 2>/dev/null | tail -1)"
  fi
  ok "logged in as ${WHO:-?}"
fi

# ── 8. the build, here rather than on their servers ──────────────────────────
# --local is the whole point: same eas.json profile, same channel, same
# credentials off the Expo account, compiled on this machine, no quota spent.
PROFILE="${PROFILE:-preview}"
say "8/8  Building profile '$PROFILE' — 15-30 minutes the first time"
OUTDIR="$HOME/Downloads"
run mkdir -p "$OUTDIR"
if [ -n "$DRY" ]; then
  printf '  would run: EAS_LOCAL_BUILD_ARTIFACTS_DIR=%s %s build -p ios --profile %s --local\n' "$OUTDIR" "$EAS" "$PROFILE"
  STATUS=0
else
  # Interactive on purpose: the first local build may ask about credentials,
  # and a --non-interactive run would simply fail instead of asking.
  EAS_LOCAL_BUILD_ARTIFACTS_DIR="$OUTDIR" $EAS build -p ios --profile "$PROFILE" --local
  STATUS=$?
fi

if [ "$STATUS" -ne 0 ]; then
  cat <<'HELP'

The build failed. The three things that cause it, in the order they happen:

  · NOT LOGGED IN / no credentials — run `npx eas-cli@latest login`, then this
    script again. The certificates live on the Expo account, not on this Mac.
  · fastlane or CocoaPods missing — `brew install fastlane cocoapods`.
  · Xcode too old for Expo SDK 52 — open the App Store and update it.

Paste the last 30 lines of the output and I will fix it rather than guess.
HELP
  exit "$STATUS"
fi

# ── install it on the phone ──────────────────────────────────────────────────
say "Installing on the phone"
IPA="$(ls -t "$OUTDIR"/*.ipa 2>/dev/null | head -1)"
if [ -z "$IPA" ] && [ -z "$DRY" ]; then
  warn "the build finished but no .ipa turned up in $OUTDIR — look at the output above for where it was written"
else
  ok "${IPA:-<the .ipa>}"
  if [ -n "$UDID" ] || [ -n "$DRY" ]; then
    run xcrun devicectl device install app --device "${UDID:-<udid>}" "${IPA:-<ipa>}" || {
      cat <<'HELP'

Installing over the cable did not work. Two other ways, both fine:

  · Open Finder, click the iPhone in the sidebar, and drag the .ipa onto it.
  · Or run the build again with `eas build ... ` in the cloud once the quota
    resets on 1 September, and install from the link as usual.
HELP
    }
  else
    warn "no phone connected — the .ipa is in $OUTDIR, install it when you plug in"
  fi
fi

say "Done"
cat <<'DONE'
shelf is on your phone, built from the latest code, on this machine, with no
EAS quota spent:

  · sharing a screenshot works
  · Import brings screenshots in from the camera roll
  · Find searches every shelf at once
  · rows stuck on "Working it out…" heal themselves on this first launch

It is on the same channel as a cloud build of this profile, so `eas update`
reaches it exactly as before.
DONE
