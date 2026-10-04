#!/bin/zsh
# TestFlight build on THIS Mac. No Expo, no EAS.
#
# Archives a clean clone of origin/main (the API key signs the archive for
# development; no Apple account in Xcode is needed), signs it for the App Store
# at export, and uploads.
#
# Needs, outside the repo: ~/keys/asc.env (ASC_KEY_ID, ASC_ISSUER_ID) and
# ~/keys/AuthKey_<ASC_KEY_ID>.p8, ~/keys/build-keychain.pw, and the profiles
# "shelf App Store" / "shelf share App Store" (copies in ~/keys/shelf-*.mobileprovision). And ONCE, by hand on appstoreconnect.apple.com:
# the app record for com.surendrachaplot.shelf — Apple's API cannot make one.
#
#   scripts/testflight.sh              archive, export, upload
#   NO_UPLOAD=1 scripts/testflight.sh  archive and export only (proves signing)
set -euo pipefail
source ~/keys/asc.env
: ${ASC_KEY_ID:?} ${ASC_ISSUER_ID:?}
AUTH=(-allowProvisioningUpdates -authenticationKeyPath ~/keys/AuthKey_$ASC_KEY_ID.p8
      -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID)
T=$(mktemp -d)
git clone -q "$(git -C "$(dirname "$0")/.." remote get-url origin)" $T/shelf
cd $T/shelf/swift
BN=$(date +%Y%m%d%H%M)                       # build number: unique and rising
sed -i '' "s/CFBundleVersion: \"1\"/CFBundleVersion: \"$BN\"/g" project.yml
xcodegen generate --quiet
mkdir -p build
echo "▸ archive $(git log -1 --format=%h) as 1.0.0 ($BN)"
xcodebuild archive -project shelf.xcodeproj -scheme shelf -configuration Release \
  -destination generic/platform=iOS -archivePath build/shelf.xcarchive "${AUTH[@]}" > build/archive.log 2>&1 \
  || { grep -E "error:" build/archive.log | head -20; echo "log: $PWD/build/archive.log"; exit 1; }
# Signed BY HAND at export: the API key may not use Apple's cloud signing
# ("Cloud signing permission error"), so the two App Store profiles were made
# once with the API (names below) and the "Apple Distribution" key is in the
# build keychain.
security unlock-keychain -p "$(cat ~/keys/build-keychain.pw)" soundcheck-build.keychain
DEST=upload; [[ -n "${NO_UPLOAD:-}" ]] && DEST=export
cat > build/export.plist <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>CBFCJ37VBT</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict>
    <key>com.surendrachaplot.shelf</key><string>shelf App Store</string>
    <key>com.surendrachaplot.shelf.ShareExtension</key><string>shelf share App Store</string>
  </dict>
  <key>destination</key><string>$DEST</string>
</dict></plist>
P
echo "▸ $DEST"
xcodebuild -exportArchive -archivePath build/shelf.xcarchive -exportPath build/export \
  -exportOptionsPlist build/export.plist -authenticationKeyPath ~/keys/AuthKey_$ASC_KEY_ID.p8 \
  -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID > build/export.log 2>&1 \
  || { grep -E "error:|Error" build/export.log | head -20; echo "log: $PWD/build/export.log"; exit 1; }
tail -3 build/export.log; ls build/export 2>/dev/null || true; echo "✓ build $BN"
