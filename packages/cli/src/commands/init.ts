import chalk from "chalk";
import { existsSync, mkdirSync } from "fs";

const DEFAULT_BIFROST = `# Heimdall Policy Configuration
# "The guardian between AI agents and their tools"
#
# Each ward defines a policy rule that is evaluated against tool calls.
# Wards are evaluated in order. The most restrictive decision wins:
#   HALT > RESHAPE > PASS

version: "1"
realm: "default"

defaults:
  action: PASS
  severity: low

wards:
  # Block destructive shell commands
  - id: halt-destructive-commands
    description: "Prevent rm -rf, format, and other destructive operations"
    tool: "Bash"
    when:
      argument_matches:
        command: "(rm\\\\s+-rf|rm\\\\s+-r\\\\s+/|mkfs|format\\\\s+[A-Z]:|dd\\\\s+if=)"
    action: HALT
    message: "Destructive command halted by Heimdall"
    severity: critical

  # Block privilege escalation
  - id: halt-privilege-escalation
    description: "Prevent sudo, su, and permission changes"
    tool: "Bash"
    when:
      argument_matches:
        command: "(sudo\\\\s|su\\\\s+-|chmod\\\\s+777|chown\\\\s+root)"
    action: HALT
    message: "Privilege escalation blocked"
    severity: critical

  # Flag external network calls
  - id: flag-network-calls
    description: "Flag curl, wget, and network commands for audit"
    tool: "Bash"
    when:
      argument_matches:
        command: "(curl\\\\s|wget\\\\s|nc\\\\s|ncat\\\\s)"
    action: PASS
    message: "Network command logged"
    severity: medium

  # Detect secrets in arguments
  - id: detect-secrets
    description: "Detect API keys and tokens in tool arguments"
    tool: "*"
    when:
      argument_contains_pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16})"
    action: HALT
    message: "Potential secret detected in tool arguments"
    severity: critical
`;

export async function initCommand(options: { force?: boolean }): Promise<void> {
  const configPath = "./bifrost.yaml";
  const heimdallDir = "./.heimdall";

  // Create .heimdall directory
  if (!existsSync(heimdallDir)) {
    mkdirSync(heimdallDir, { recursive: true });
    console.log(chalk.green("  Created .heimdall/ directory"));
  }

  // Create bifrost.yaml
  if (existsSync(configPath) && !options.force) {
    console.log(chalk.yellow("  bifrost.yaml already exists (use --force to overwrite)"));
  } else {
    await Bun.write(configPath, DEFAULT_BIFROST);
    console.log(chalk.green("  Created bifrost.yaml with default wards"));
  }

  // Add .heimdall to .gitignore if present
  const gitignorePath = "./.gitignore";
  if (existsSync(gitignorePath)) {
    const content = await Bun.file(gitignorePath).text();
    if (!content.includes(".heimdall")) {
      await Bun.write(gitignorePath, content.trimEnd() + "\n.heimdall/\n");
      console.log(chalk.green("  Added .heimdall/ to .gitignore"));
    }
  }

  console.log();
  console.log(chalk.bold("Heimdall initialized."));
  console.log();
  console.log("  Edit " + chalk.cyan("bifrost.yaml") + " to configure your wards.");
  console.log("  Run " + chalk.cyan("heimdall hook install") + " to add Claude Code hooks.");
  console.log("  Run " + chalk.cyan("heimdall runecheck") + " to verify audit integrity.");
}
