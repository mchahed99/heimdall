#!/usr/bin/env bun
import { program } from "commander";
import { initCommand } from "./commands/init.js";
import { guardCommand } from "./commands/guard.js";
import { runecheckCommand } from "./commands/runecheck.js";
import { hookCommand } from "./commands/hook.js";
import { exportCommand } from "./commands/export.js";
import { watchtowerCommand } from "./commands/watchtower.js";
import { logCommand } from "./commands/log.js";

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
  .action(watchtowerCommand);

program.parse();
