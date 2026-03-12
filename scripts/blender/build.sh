#!/usr/bin/env bash
# ============================================================
# NovaUniverse — Asset Build Scripts
# ============================================================
# Place this file at: scripts/blender/build.sh
# Make executable: chmod +x scripts/blender/build.sh

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER_SCRIPT="$PROJECT_DIR/scripts/blender/build_world.py"

# ── Detect Blender path ─────────────────────────────────────
if command -v blender &>/dev/null; then
    BLENDER="blender"
elif [ -f "/Applications/Blender.app/Contents/MacOS/Blender" ]; then
    BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
elif [ -f "/usr/bin/blender" ]; then
    BLENDER="/usr/bin/blender"
else
    echo "❌ Blender not found. Install from https://www.blender.org/download/"
    exit 1
fi

echo "Using Blender: $BLENDER"
echo "Project: $PROJECT_DIR"

# ── Run ─────────────────────────────────────────────────────
if [ "$1" == "--zone" ] && [ -n "$2" ]; then
    echo "Building zone: $2"
    "$BLENDER" --background --python "$BLENDER_SCRIPT" -- --zone "$2"
else
    echo "Building ALL zones..."
    "$BLENDER" --background --python "$BLENDER_SCRIPT"
fi

# ── Output summary ───────────────────────────────────────────
echo ""
echo "Generated assets:"
ls -lh "$PROJECT_DIR/public/kenney/models/custom/" 2>/dev/null || echo "(none yet)"

# ============================================================
# PACKAGE.JSON SCRIPTS (add these to NovaUniverse/package.json)
# ============================================================
# "scripts": {
#   "build:assets": "bash scripts/blender/build.sh",
#   "build:assets:zone": "bash scripts/blender/build.sh --zone",
#   "dev": "vite",
#   "build": "tsc && vite build"
# }
#
# Usage:
#   npm run build:assets                       ← all zones
#   npm run build:assets:zone trading_floor    ← one zone
