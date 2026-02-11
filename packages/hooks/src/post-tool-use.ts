#!/usr/bin/env bun
/**
 * Heimdall PostToolUse Hook for Claude Code
 *
 * Reads tool result from stdin, updates the last Rune with response data.
 * This hook is informational only — it always allows the result through.
 */

import { Runechain } from "@heimdall/core";
import { resolve } from "path";

async function main() {
  const raw = await Bun.stdin.text();
  let input: {
    tool_name: string;
    tool_output: unknown;
    session_id?: string;
  };

  try {
    input = JSON.parse(raw);
  } catch {
    return; // Nothing to do if we can't parse
  }

  const dbDir = process.env.HEIMDALL_DB_DIR
    || resolve(process.cwd(), ".heimdall");
  const dbPath = resolve(dbDir, "runes.sqlite");

  try {
    const chain = new Runechain(dbPath);
    // The post hook doesn't inscribe a new rune — the pre-hook already did.
    // We could update the last rune with response data in a future version.
    chain.close();
  } catch {
    // Fail silently — post-hook is informational only
  }
}

main().catch(() => {
  // Fail silently
});
