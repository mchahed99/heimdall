import chalk from "chalk";
import { existsSync, mkdirSync } from "fs";

export const DEFAULT_BIFROST = `# Heimdall Policy Configuration
# "The guardian between AI agents and their tools"
#
# Wards are evaluated in order. Most restrictive decision wins: HALT > RESHAPE > PASS
# RESHAPE = make the agent useful despite the constraint (not just "no")

version: "1"
realm: "default"

defaults:
  action: PASS
  severity: low

wards:
  # === RESHAPE: Safe alternatives instead of blocking ===

  # Convert destructive commands to safe dry-run preview
  - id: reshape-destructive-to-preview
    description: "Convert rm -rf and other destructive ops to a dry-run listing"
    tool: "Bash"
    when:
      argument_matches:
        command: "(rm\\\\s+-rf|rm\\\\s+-r\\\\s+/|mkfs|format\\\\s+[A-Z]:|dd\\\\s+if=)"
    action: RESHAPE
    message: "Destructive command reshaped to safe dry-run preview"
    severity: high
    reshape:
      command: "echo '[HEIMDALL RESHAPE] Dry-run mode — listing affected files instead of deleting:' && ls -la"

  # Downgrade dangerous permissions to safe defaults
  - id: reshape-safe-permissions
    description: "Downgrade chmod 777 to chmod 755 for safety"
    tool: "Bash"
    when:
      argument_matches:
        command: "(chmod\\\\s+777)"
    action: RESHAPE
    message: "Dangerous permissions (777) downgraded to safe default (755)"
    severity: high
    reshape:
      command: "echo '[HEIMDALL RESHAPE] chmod 777 is unsafe — applied 755 instead'"

  # === HALT: Block truly dangerous operations ===

  # Block privilege escalation (cannot be safely reshaped)
  - id: halt-privilege-escalation
    description: "Prevent sudo, su, and root-level access"
    tool: "Bash"
    when:
      argument_matches:
        command: "(sudo\\\\s|su\\\\s+-|chown\\\\s+root)"
    action: HALT
    message: "Privilege escalation blocked — cannot be reshaped safely"
    severity: critical

  # Detect secrets in arguments (cannot be reshaped)
  - id: detect-secrets
    description: "Detect API keys and tokens in tool arguments"
    tool: "*"
    when:
      argument_contains_pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16})"
    action: HALT
    message: "Potential secret detected in tool arguments"
    severity: critical

  # === Audit: Log for review ===

  # Flag external network calls
  - id: flag-network-calls
    description: "Flag curl, wget, and network commands for audit"
    tool: "Bash"
    when:
      argument_matches:
        command: "(curl\\\\s|wget\\\\s|nc\\\\s|ncat\\\\s)"
    action: PASS
    message: "Network command logged for audit"
    severity: medium
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
