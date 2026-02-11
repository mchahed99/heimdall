import chalk from "chalk";
import { existsSync } from "fs";
import { loadBifrostFile, Runechain } from "@heimdall/core";

export async function doctorCommand(options: {
  config: string;
  db: string;
}): Promise<void> {
  let hasErrors = false;

  // Check config
  try {
    const config = await loadBifrostFile(options.config);
    console.log(chalk.green("✓") + ` Config: ${options.config} loaded (${config.wards.length} wards)`);
  } catch (err) {
    console.log(chalk.red("✗") + ` Config: ${err}`);
    hasErrors = true;
  }

  // Check DB
  if (existsSync(options.db)) {
    try {
      const chain = new Runechain(options.db);
      const count = chain.getRuneCount();
      console.log(chalk.green("✓") + ` Storage: SQLite connected (${count} runes)`);

      // Check chain integrity
      const verification = await chain.verifyChain();
      if (verification.valid) {
        console.log(chalk.green("✓") + ` Chain: Integrity verified (${verification.verified_runes} runes)`);
      } else {
        console.log(chalk.red("✗") + ` Chain: ${verification.broken_reason}`);
        hasErrors = true;
      }

      chain.close();
    } catch (err) {
      console.log(chalk.red("✗") + ` Storage: ${err}`);
      hasErrors = true;
    }
  } else {
    console.log(chalk.yellow("○") + ` Storage: No database at ${options.db} (will be created on first use)`);
  }

  // Check .heimdall directory
  if (existsSync(".heimdall")) {
    console.log(chalk.green("✓") + " Directory: .heimdall/ exists");
  } else {
    console.log(chalk.yellow("○") + ' Directory: .heimdall/ missing (run "heimdall init")');
  }

  // Check Ed25519 keys
  if (existsSync(".heimdall/heimdall.key") && existsSync(".heimdall/heimdall.pub")) {
    console.log(chalk.green("✓") + " Keys: Ed25519 signing keys present");
  } else {
    console.log(chalk.yellow("○") + " Keys: No signing keys (will be generated on first use)");
  }

  console.log();
  if (hasErrors) {
    console.log(chalk.red("Issues found. Fix the errors above."));
    process.exit(1);
  } else {
    console.log(chalk.green("All checks passed."));
  }
}
