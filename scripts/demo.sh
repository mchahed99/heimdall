#!/usr/bin/env bash
set -euo pipefail

# Heimdall Hackathon Demo Launcher
# Usage: ./scripts/demo.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Heimdall Demo ==="
echo ""

# Clean previous demo state
rm -f "$PROJECT_DIR/.heimdall/runes.sqlite"
rm -f "$PROJECT_DIR/.heimdall/runes.sqlite-wal"
rm -f "$PROJECT_DIR/.heimdall/runes.sqlite-shm"

# Ensure .heimdall directory exists
mkdir -p "$PROJECT_DIR/.heimdall"

# Build dashboard
echo "[1/4] Building dashboard..."
(cd "$PROJECT_DIR/packages/dashboard" && bun run build 2>/dev/null)

# Start the Watchtower dashboard API server (background)
echo "[2/4] Starting Watchtower dashboard..."
HEIMDALL_API_TOKEN=demo-token bun run "$PROJECT_DIR/packages/cli/src/index.ts" watchtower \
  --port 3000 \
  --db "$PROJECT_DIR/.heimdall/runes.sqlite" &
WATCHTOWER_PID=$!

sleep 2

echo "[3/4] Starting Bifrost proxy with demo MCP server..."
echo ""
echo "  Dashboard: http://localhost:3000?token=demo-token"
echo ""

# Start the Bifrost proxy
bun run "$PROJECT_DIR/packages/cli/src/index.ts" guard \
  --target "bun run $PROJECT_DIR/packages/demo-server/src/index.ts" \
  --config "$PROJECT_DIR/examples/bifrost-demo.yaml" \
  --db "$PROJECT_DIR/.heimdall/runes.sqlite" \
  --ws-port 3001 &
BIFROST_PID=$!

sleep 1

echo "[4/4] Demo ready!"
echo ""
echo "  To trigger drift (in another terminal):"
echo "    kill -USR1 \$(pgrep -f demo-server)"
echo ""
echo "  To verify chain:"
echo "    bun run heimdall runecheck --db ./.heimdall/runes.sqlite"
echo ""
echo "  Press Ctrl+C to stop."

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $WATCHTOWER_PID 2>/dev/null || true
  kill $BIFROST_PID 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT

wait $BIFROST_PID 2>/dev/null || true
