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
      const pending = runechain.getAllPendingBaselines();

      if (baselines.length === 0 && pending.length === 0) {
        console.log(chalk.dim("No baselines stored."));
        runechain.close();
        return;
      }

      if (baselines.length > 0) {
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
      }

      if (pending.length > 0) {
        console.log(chalk.bold.yellow("Pending drift approvals:\n"));
        for (const p of pending) {
          const tools = JSON.parse(p.tools_snapshot);
          console.log(`  ${chalk.yellow(p.server_id)}`);
          console.log(`    Tools: ${tools.length}`);
          console.log(`    Hash: ${p.tools_hash.slice(0, 16)}...`);
          console.log(`    Detected at: ${p.detected_at}`);
          console.log();
        }
        console.log(chalk.dim(`  Run \`heimdall baseline approve\` to accept pending changes.`));
      }
      break;
    }
    case "approve": {
      if (!options.server) {
        // If no --server, try to approve all pending
        const pending = runechain.getAllPendingBaselines();
        if (pending.length === 0) {
          console.log(chalk.yellow("No pending drift to approve."));
          runechain.close();
          return;
        }
        for (const p of pending) {
          runechain.approvePendingBaseline(p.server_id);
          console.log(chalk.green(`\u2713 Baseline approved for ${p.server_id}`));
        }
        runechain.close();
        return;
      }
      const approved = runechain.approvePendingBaseline(options.server);
      if (approved) {
        console.log(chalk.green(`\u2713 Baseline approved for ${options.server}`));
      } else {
        console.log(chalk.yellow(`No pending drift for: ${options.server}`));
      }
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
