#!/bin/zsh
# Ad-hoc PREVIEW .ipa of the Swift app, for the phones on the EAS ad-hoc
# profiles. Runs on the EAS builder (.eas/build/ios-preview.yml) after
# eas/configure_ios_credentials has put the distribution certificate in a
# keychain and BOTH profiles in place: the app's and the share extension's.
#
# It builds unsigned and signs by hand, inside out: the extension first, then
# the app. Each is signed with the entitlements ITS OWN profile grants (read
# out of the profile, so nothing here can ask for more than Apple allowed):
# the App Group is what lets the share sheet hand a link to the app.
# Out: build/preview/shelf.ipa
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/preview DD=.build/preview TEAM=CBFCJ37VBT
APP_ID=com.surendrachaplot.shelf EXT_ID=com.surendrachaplot.shelf.ShareExtension
rm -rf $OUT && mkdir -p $OUT/Payload

xcodebuild -project shelf.xcodeproj -scheme shelf -configuration Release \
  -destination generic/platform=iOS -derivedDataPath $DD CODE_SIGNING_ALLOWED=NO build \
  > $OUT/build.log 2>&1 || { grep -E "error:" $OUT/build.log | head -20; tail -5 $OUT/build.log; exit 1; }

APP=$OUT/Payload/shelf.app
cp -R $DD/Build/Products/Release-iphoneos/shelf.app $APP
EXT=$APP/PlugIns/ShelfShare.appex
[[ -d "$EXT" ]] || { echo "✗ the share extension is not in the app"; exit 1; }
[[ "${SIGN:-1}" == 0 ]] && { echo "✓ built unsigned: $APP"; exit 0; }

# The profile whose application-identifier is EXACTLY this id (the app's id is
# a prefix of the extension's, so a loose match would pick the wrong one).
profile_for() {
  for p in ~/Library/MobileDevice/Provisioning\ Profiles/*.mobileprovision(N); do
    id=$(security cms -D -i "$p" 2>/dev/null | plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null || true)
    [[ "$id" == "$TEAM.$1" ]] && { echo "$p"; return 0; }
  done
  return 1
}
entitlements_of() { security cms -D -i "$1" | plutil -extract Entitlements xml1 -o "$2" -; }

APP_PROFILE=${APP_PROFILE:-$(profile_for $APP_ID)} || { echo "✗ no ad-hoc profile for $APP_ID installed"; exit 1; }
EXT_PROFILE=${EXT_PROFILE:-$(profile_for $EXT_ID)} || { echo "✗ no ad-hoc profile for $EXT_ID installed"; exit 1; }
ID=$(security find-identity -v -p codesigning | awk "/$TEAM/ {print \$2; exit}")
[[ -n "$ID" ]] || { echo "✗ no $TEAM signing identity in the keychain"; exit 1; }

entitlements_of "$APP_PROFILE" $OUT/app.entitlements
entitlements_of "$EXT_PROFILE" $OUT/ext.entitlements
# The share sheet is useless without the App Group. Say so here, in words,
# rather than shipping a build whose share sheet silently saves nothing.
for e in app ext; do
  grep -q "group.com.surendrachaplot.shelf" $OUT/$e.entitlements || { echo "✗ the $e profile does not grant the App Group"; exit 1; }
done

cp "$EXT_PROFILE" $EXT/embedded.mobileprovision
cp "$APP_PROFILE" $APP/embedded.mobileprovision
for f in $EXT/Frameworks/*(N) $APP/Frameworks/*(N); do codesign -f -s "$ID" "$f"; done
codesign -f -s "$ID" --entitlements $OUT/ext.entitlements --generate-entitlement-der $EXT
codesign -f -s "$ID" --entitlements $OUT/app.entitlements --generate-entitlement-der $APP
codesign --verify --deep --strict $APP
codesign -d --entitlements - $APP | head -20
(cd $OUT && zip -qry shelf.ipa Payload)
# EAS's upload step looks for the path from the REPOSITORY root, not from this
# folder: the first signed build was made and then not found. A copy in both
# places means the same path works wherever the step looks.
mkdir -p ../build/preview && cp $OUT/shelf.ipa ../build/preview/shelf.ipa
echo "✓ $OUT/shelf.ipa"
