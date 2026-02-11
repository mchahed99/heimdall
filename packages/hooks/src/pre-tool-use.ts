#!/usr/bin/env bun
/**
 * Heimdall PreToolUse Hook for Claude Code
 *
 * Reads tool call JSON from stdin, evaluates against bifrost.yaml wards,
 * inscribes a Rune in the audit chain, and outputs a decision.
 *
 * Output format (Claude Code hook protocol):
 *   { "decision": "allow" }
 *   { "decision": "block", "reason": "..." }
 */

import { WardEngine, Runechain, loadBifrostFile } from "@heimdall/core";
import type { ToolCallContext } from "@heimdall/core";
import { resolve } from "path";

async function main() {
  // Read tool call input from stdin
  const raw = await Bun.stdin.text();
  let input: {
    tool_name: string;
    tool_input: Record<string, unknown>;
    session_id?: string;
  };

  try {
    input = JSON.parse(raw);
  } catch {
    // If we can't parse, allow the call (fail-open for hooks)
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  // Find bifrost.yaml — check env, then cwd, then .heimdall/
  const configPath = process.env.HEIMDALL_CONFIG
    || resolve(process.cwd(), "bifrost.yaml");

  const dbDir = process.env.HEIMDALL_DB_DIR
    || resolve(process.cwd(), ".heimdall");

  const dbPath = resolve(dbDir, "runes.sqlite");

  // Ensure .heimdall directory exists
  const { mkdirSync } = await import("fs");
  try {
    mkdirSync(dbDir, { recursive: true });
  } catch {
    // ignore if exists
  }

  let config;
  try {
    config = await loadBifrostFile(configPath);
  } catch {
    // No config = no policy enforcement, allow everything
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  const engine = new WardEngine(config);
  const chain = new Runechain(dbPath);

  const ctx: ToolCallContext = {
    tool_name: input.tool_name,
    arguments: input.tool_input ?? {},
    session_id: input.session_id ?? process.env.CLAUDE_SESSION_ID ?? "unknown",
    agent_id: "claude-code",
    server_id: "claude-code-hooks",
  };

  const evaluation = engine.evaluate(ctx);
  await chain.inscribeRune(ctx, evaluation);
  chain.close();

  if (evaluation.decision === "HALT") {
    console.log(
      JSON.stringify({
        decision: "block",
        reason: `[HEIMDALL] ${evaluation.rationale}`,
      })
    );
  } else {
    console.log(JSON.stringify({ decision: "allow" }));
  }
}

main().catch((err) => {
  console.error(`[HEIMDALL] Hook error: ${err}`);
  // Fail-open: allow the call if the hook errors
  console.log(JSON.stringify({ decision: "allow" }));
});
