import chalk from "chalk";
import { installHooks, uninstallHooks } from "@heimdall/hooks";
import { resolve } from "path";

export async function hookCommand(
  action: "install" | "uninstall",
  options: { dir: string }
): Promise<void> {
  const dir = resolve(options.dir);

  if (action === "install") {
    const result = installHooks(dir);
    if (result.created) {
      console.log(chalk.green(`  Created ${result.settingsPath}`));
    } else if (result.updated) {
      console.log(chalk.green(`  Updated ${result.settingsPath}`));
    }
    console.log();
    console.log(chalk.bold("Heimdall hooks installed."));
    console.log(
      "  PreToolUse and PostToolUse hooks are now active."
    );
    console.log(
      "  Every tool call will be evaluated against " + chalk.cyan("bifrost.yaml")
    );
    console.log(
      "  Audit trail: " + chalk.cyan(".heimdall/runes.sqlite")
    );
  } else {
    const removed = uninstallHooks(dir);
    if (removed) {
      console.log(chalk.green("  Heimdall hooks removed."));
    } else {
      console.log(chalk.yellow("  No hooks found to remove."));
    }
  }
}
