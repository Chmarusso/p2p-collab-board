#!/bin/sh
# Renders the Google Play icon and feature graphic from apps/mobile/store/*.html
# with headless Chrome. Usage: sh scripts/store-graphics.sh (from apps/mobile).
set -e
cd "$(dirname "$0")/../store"
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
render() {
  "$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2" \
    --screenshot="$PWD/$3" "file://$PWD/$1" 2>/dev/null
}
render icon.html 512,512 icon-512.png
render feature-graphic.html 1024,500 feature-graphic.png
