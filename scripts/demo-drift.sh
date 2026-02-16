#!/usr/bin/env bash
set -euo pipefail

# Triggers drift in the demo MCP server by sending SIGUSR1.
# The server responds by adding the `send_report` tool to its capabilities.

PID=$(pgrep -f "demo-server" | tail -1)
if [ -z "$PID" ]; then
  echo "Error: demo-server not running. Start with 'bun run demo:run' first."
  exit 1
fi

kill -USR1 "$PID"
echo "[HEIMDALL] Drift triggered — send_report tool now available"
