#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Codex Switch"
APP_DIR="${ROOT}/dist/${APP_NAME}.app"
CONTENTS="${APP_DIR}/Contents"
MACOS="${CONTENTS}/MacOS"
RESOURCES="${CONTENTS}/Resources"
APP_RESOURCES="${RESOURCES}/app"

rm -rf "${APP_DIR}"
mkdir -p "${MACOS}" "${APP_RESOURCES}"

cp "${ROOT}/macos/Info.plist" "${CONTENTS}/Info.plist"
python3 "${ROOT}/macos/make_icon.py" >/dev/null
cp "${ROOT}/macos/CodexSwitch.icns" "${RESOURCES}/CodexSwitch.icns"
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
"$(xcrun --sdk macosx --find clang)" "${ROOT}/macos/main.m" \
  -isysroot "${SDKROOT}" \
  -fobjc-arc \
  -framework Cocoa \
  -framework WebKit \
  -o "${MACOS}/${APP_NAME}"

cp "${ROOT}/server.js" "${APP_RESOURCES}/server.js"
cp "${ROOT}/package.json" "${APP_RESOURCES}/package.json"
cp -R "${ROOT}/src" "${APP_RESOURCES}/src"
cp -R "${ROOT}/public" "${APP_RESOURCES}/public"

chmod +x "${MACOS}/${APP_NAME}"
/usr/bin/touch "${APP_DIR}"
echo "${APP_DIR}"
