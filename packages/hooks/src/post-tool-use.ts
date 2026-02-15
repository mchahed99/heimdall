#!/usr/bin/env bun
/**
 * Heimdall PostToolUse Hook for Claude Code
 *
 * Reads tool result from stdin and updates the last Rune with response data.
 * This completes the audit record started by the PreToolUse hook.
 */

import { Runechain, redactSecrets } from "@heimdall/core";
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

    // Summarize the tool output (truncate for storage)
    const responseSummary = redactSecrets(
      JSON.stringify(input.tool_output ?? "")
    ).slice(0, 500);

    // Update the last rune with response data
    await chain.updateLastRuneResponse(responseSummary);

    chain.close();
  } catch {
    // Fail silently — post-hook is informational
  }
}

main().catch(() => {
  // Fail silently
});
