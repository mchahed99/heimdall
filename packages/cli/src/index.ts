#!/usr/bin/env bun
import { program } from "commander";
import { initCommand } from "./commands/init.js";
import { guardCommand } from "./commands/guard.js";
import { runecheckCommand } from "./commands/runecheck.js";
import { hookCommand } from "./commands/hook.js";
import { exportCommand } from "./commands/export.js";
import { watchtowerCommand } from "./commands/watchtower.js";
import { logCommand } from "./commands/log.js";
import { receiptCommand } from "./commands/receipt.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";
import { replayCommand } from "./commands/replay.js";
import { generateCommand } from "./commands/generate.js";
import { redteamCommand } from "./commands/redteam.js";
import { auditCommand } from "./commands/audit.js";
import { baselineCommand } from "./commands/baseline.js";

program
  .name("heimdall")
  .description(
    "The guardian between AI agents and their tools.\nMCP proxy with declarative policy enforcement and tamper-evident audit trails."
  )
  .version("0.1.0");

program
  .command("init")
  .description("Create a bifrost.yaml policy file and .heimdall/ directory")
  .option("--force", "Overwrite existing bifrost.yaml")
  .action(initCommand);

program
  .command("guard")
  .description("Start the Bifrost MCP proxy")
  .requiredOption("--target <command>", "MCP server command to proxy")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .option("--db <path>", "Path to SQLite database", "./heimdall.sqlite")
  .option("--session <id>", "Session identifier")
  .option("--agent <id>", "Agent identifier")
  .option("--ws-port <port>", "WebSocket port for dashboard", "3001")
  .option("--dry-run", "Evaluate policies but don't block (audit-only mode)")
  .action(guardCommand);

program
  .command("runecheck")
  .description("Verify audit trail integrity (Runechain)")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .option("--json", "Output as JSON")
  .action(runecheckCommand);

const hookCmd = program
  .command("hook")
  .description("Manage Claude Code hooks");

hookCmd
  .command("install")
  .description("Install Heimdall hooks into Claude Code")
  .option("--dir <path>", "Project directory", ".")
  .action((opts) => hookCommand("install", opts));

hookCmd
  .command("uninstall")
  .description("Remove Heimdall hooks from Claude Code")
  .option("--dir <path>", "Project directory", ".")
  .action((opts) => hookCommand("uninstall", opts));

program
  .command("log")
  .description("Query the audit trail")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .option("--session <id>", "Filter by session ID")
  .option("--tool <name>", "Filter by tool name")
  .option("--decision <type>", "Filter by decision (PASS|HALT|RESHAPE)")
  .option("--limit <n>", "Max results", "20")
  .action(logCommand);

program
  .command("export")
  .description("Export audit trail")
  .requiredOption("--format <format>", "Export format: json or csv")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .option("--output <path>", "Output file path (defaults to stdout)")
  .action(exportCommand);

program
  .command("watchtower")
  .description("Launch the Watchtower dashboard")
  .option("--port <port>", "Dashboard port", "3000")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .option("--ws-upstream <url>", "Relay WebSocket messages from upstream (e.g. ws://localhost:3001)")
  .action(watchtowerCommand);

program
  .command("receipt <sequence>")
  .description("Export a signed receipt for a specific rune")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .option("--output <path>", "Output file path (defaults to stdout)")
  .action(receiptCommand);

program
  .command("validate")
  .description("Validate bifrost.yaml configuration")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .action(validateCommand);

program
  .command("doctor")
  .description("Check Heimdall health: config, database, chain integrity")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action(doctorCommand);

program
  .command("replay")
  .description("Replay audit trail against a new policy to preview changes")
  .option("--config <path>", "Path to new bifrost.yaml", "./bifrost.yaml")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action(replayCommand);

program
  .command("generate")
  .description("Generate a bifrost.yaml policy from your codebase using AI")
  .option("--path <dir>", "Path to codebase", ".")
  .option("--output <file>", "Output file path", "./bifrost.yaml")
  .option("--realm <name>", "Realm name for the policy")
  .option("--model <model>", "Claude model to use", "claude-opus-4-6")
  .option("--include <globs>", "Comma-separated include globs (e.g. src/**)")
  .option("--exclude <globs>", "Comma-separated exclude globs (e.g. **/*.test.ts)")
  .action(generateCommand);

program
  .command("redteam")
  .description("Red-team your security policy with parallel AI agents")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .option("--output <file>", "Output report file (defaults to stdout)")
  .option("--format <fmt>", "Report format: markdown or json", "markdown")
  .option("--model <model>", "Claude model to use", "claude-opus-4-6")
  .action(redteamCommand);

program
  .command("audit")
  .description("Full security audit: generate policy + red-team + auto-patch (one command)")
  .option("--path <dir>", "Path to codebase", ".")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .option("--realm <name>", "Realm name for the policy")
  .option("--model <model>", "Claude model to use", "claude-opus-4-6")
  .option("--output <file>", "Output report file")
  .action(auditCommand);

const baselineCmd = program
  .command("baseline")
  .description("Manage MCP server tool baselines for drift detection");

baselineCmd
  .command("list")
  .description("List all stored baselines")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action((opts) => baselineCommand("list", opts));

baselineCmd
  .command("approve")
  .description("Accept pending drift for a server (or all servers if --server omitted)")
  .option("--server <id>", "Server ID to approve (approves all if omitted)")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action((opts) => baselineCommand("approve", opts));

baselineCmd
  .command("reset")
  .description("Clear stored baselines")
  .option("--server <id>", "Clear only this server's baseline")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action((opts) => baselineCommand("reset", opts));

program.parse();
