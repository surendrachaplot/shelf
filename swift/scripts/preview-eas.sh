#!/bin/zsh
# Queue the ad-hoc PREVIEW build of the Swift app on EAS, from a clean clone of
# origin/main so nobody's uncommitted work goes into it. eas-cli needs the
# `expo` package only to read app.json; it is installed in the throwaway clone.
set -euo pipefail
T=$(mktemp -d)
git clone -q "$(git -C "$(dirname "$0")/.." remote get-url origin)" $T/shelf
cd $T/shelf/swift
npm i -s --no-save --no-package-lock expo
EAS_BUILD_SKIP_LOCKFILE_CHECK=1 npx -y eas-cli build -p ios -e ios-preview --non-interactive --no-wait
