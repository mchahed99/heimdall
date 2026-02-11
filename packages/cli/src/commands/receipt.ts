import chalk from "chalk";
import { Runechain } from "@heimdall/core";
import { existsSync, writeFileSync } from "fs";

export async function receiptCommand(
  sequence: string,
  options: { db: string; output?: string }
): Promise<void> {
  if (!existsSync(options.db)) {
    console.error(chalk.red("No audit database found at: " + options.db));
    process.exit(1);
  }

  const chain = new Runechain(options.db);
  const seq = parseInt(sequence, 10);

  if (isNaN(seq)) {
    console.error(chalk.red("Invalid sequence number: " + sequence));
    chain.close();
    process.exit(1);
  }

  const receipt = chain.exportReceipt(seq);
  chain.close();

  if (!receipt) {
    console.error(chalk.red(`No rune found with sequence #${seq}`));
    process.exit(1);
  }

  const json = JSON.stringify(receipt, null, 2);

  if (options.output) {
    writeFileSync(options.output, json + "\n");
    console.error(chalk.green(`  Signed receipt exported to ${options.output}`));
    console.error(chalk.dim(`  Rune #${seq} | ${receipt.rune.decision} | ${receipt.rune.tool_name}`));
    console.error(chalk.dim(`  Signature: ${receipt.signature.slice(0, 32)}...`));
    console.error(chalk.dim(`  Verify with: openssl dgst -verify heimdall.pub -signature <sig> <hash>`));
  } else {
    // Output to stdout for piping
    console.log(json);
  }
}
