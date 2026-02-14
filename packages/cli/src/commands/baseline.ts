import chalk from "chalk";
import { Runechain } from "@heimdall/core";
import { existsSync } from "fs";

export async function baselineCommand(
  action: "list" | "approve" | "reset",
  options: { db: string; server?: string }
): Promise<void> {
  if (!existsSync(options.db)) {
    console.log(chalk.yellow("No audit database found at: " + options.db));
    return;
  }

  const runechain = new Runechain(options.db);

  switch (action) {
    case "list": {
      const baselines = runechain.getAllBaselines();
      if (baselines.length === 0) {
        console.log(chalk.dim("No baselines stored."));
        return;
      }
      console.log(chalk.bold("Stored baselines:\n"));
      for (const b of baselines) {
        const tools = JSON.parse(b.tools_snapshot);
        console.log(`  ${chalk.cyan(b.server_id)}`);
        console.log(`    Tools: ${tools.length}`);
        console.log(`    Hash: ${b.tools_hash.slice(0, 16)}...`);
        console.log(`    First seen: ${b.first_seen}`);
        console.log(`    Last verified: ${b.last_verified}`);
        console.log();
      }
      break;
    }
    case "approve": {
      if (!options.server) {
        console.log(chalk.red("Error: --server <id> required for approve"));
        return;
      }
      const baseline = runechain.getBaseline(options.server);
      if (!baseline) {
        console.log(chalk.yellow(`No baseline found for: ${options.server}`));
        return;
      }
      console.log(chalk.green(`Baseline approved for ${options.server}`));
      break;
    }
    case "reset": {
      if (options.server) {
        runechain.clearBaseline(options.server);
        console.log(chalk.yellow(`Baseline cleared for ${options.server}`));
      } else {
        runechain.clearAllBaselines();
        console.log(chalk.yellow("All baselines cleared"));
      }
      break;
    }
  }

  runechain.close();
}
