#!/bin/sh
# Builds an unsigned (ad-hoc signed) universal Release build and packages it as a DMG.
#
#   scripts/build-release.sh 1.2.0          -> build/release/MacMicFixer-1.2.0.dmg
#
# Expects `bun install` and `pod install` (in macos/) to have run.
set -eu

VERSION="${1:?usage: scripts/build-release.sh <version>}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
DERIVED="$BUILD/DerivedData"
OUT="$BUILD/release"
APP="$DERIVED/Build/Products/Release/MacMicFixer.app"
DMG="$OUT/MacMicFixer-$VERSION.dmg"

rm -rf "$DERIVED" "$OUT"
mkdir -p "$OUT"

xcodebuild \
  -workspace "$ROOT/macos/MacMicFixer.xcworkspace" \
  -scheme MacMicFixer-macOS \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -destination "generic/platform=macOS" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="" \
  build

codesign --verify --deep --strict "$APP"
lipo -archs "$APP/Contents/MacOS/MacMicFixer"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
ditto "$APP" "$STAGING/MacMicFixer.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Mac Mic Fixer" -srcfolder "$STAGING" -ov -format UDZO "$DMG"

echo "$DMG"
