import chalk from "chalk";
import { Runechain } from "@heimdall/core";
import type { WardDecision, Rune } from "@heimdall/core";
import { existsSync } from "fs";
import { formatDecision } from "../utils/format.js";

export async function logCommand(options: {
  db: string;
  session?: string;
  tool?: string;
  decision?: string;
  limit: string;
}): Promise<void> {
  if (!existsSync(options.db)) {
    console.log(chalk.yellow("No audit database found at: " + options.db));
    return;
  }

  const chain = new Runechain(options.db);

  const runes = chain.getRunes({
    session_id: options.session,
    tool_name: options.tool,
    decision: options.decision as WardDecision | undefined,
    limit: parseInt(options.limit),
  });

  if (runes.length === 0) {
    console.log(chalk.dim("  No runes found matching filters."));
    chain.close();
    return;
  }

  console.log(
    chalk.bold(`\n  Heimdall Audit Log (${runes.length} runes)`)
  );
  console.log(chalk.dim("  " + "━".repeat(60)));

  for (const rune of runes) {
    printRune(rune);
  }

  console.log();
  chain.close();
}

function printRune(rune: Rune): void {
  const time = new Date(rune.timestamp).toLocaleTimeString();
  const decision = formatDecision(rune.decision);
  const tool = chalk.white(rune.tool_name);
  const hash = chalk.dim(rune.content_hash.slice(0, 12));

  console.log(
    `  ${chalk.dim(time)}  ${decision}  ${tool.padEnd(20)}  ${hash}`
  );

  if (rune.matched_wards.length > 0) {
    console.log(
      chalk.dim(`           Wards: ${rune.matched_wards.join(", ")}`)
    );
  }

  if (rune.decision === "HALT") {
    console.log(chalk.red(`           ${rune.rationale}`));
  }
}

