import chalk from "chalk";
import { Runechain } from "@heimdall/core";
import type { ChainVerificationResult } from "@heimdall/core";
import { existsSync } from "fs";
import { formatDecision } from "../utils/format.js";

export async function runecheckCommand(options: {
  db: string;
  json?: boolean;
}): Promise<void> {
  if (!existsSync(options.db)) {
    if (options.json) {
      console.log(
        JSON.stringify({
          valid: true,
          total_runes: 0,
          message: "No audit database found",
        })
      );
    } else {
      console.log(chalk.yellow("No audit database found at: " + options.db));
      console.log("Run " + chalk.cyan("heimdall init") + " to get started.");
    }
    return;
  }

  const chain = new Runechain(options.db);

  console.log(chalk.bold("\n  Heimdall Runechain Verification"));
  console.log(chalk.dim("  " + "━".repeat(40)));

  const result = await chain.verifyChain();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    chain.close();
    return;
  }

  // Show rune-by-rune verification
  const runes = chain.getRunes({ limit: 100 });
  const runesAsc = [...runes].reverse();

  for (const rune of runesAsc) {
    const isBroken =
      !result.valid && result.broken_at_sequence === rune.sequence;
    const icon = isBroken ? chalk.red("✗") : chalk.green("✓");
    const seq = chalk.dim(`#${rune.sequence.toString().padStart(3)}`);
    const link = rune.is_genesis
      ? chalk.dim("[GENESIS]")
      : chalk.dim(`← ${rune.previous_hash.slice(0, 8)}`);
    const decision = formatDecision(rune.decision);
    const tool = chalk.white(rune.tool_name);
    const hash = chalk.dim(rune.content_hash.slice(0, 12) + "...");

    console.log(`  ${seq}  ${icon}  ${link.padEnd(22)}  ${tool.padEnd(20)} ${decision}  ${hash}`);

    if (isBroken) {
      console.log(chalk.red(`       ↑ CHAIN BROKEN: ${result.broken_reason}`));
    }
  }

  console.log(chalk.dim("  " + "━".repeat(40)));

  if (result.valid) {
    const sigInfo = result.signatures_verified
      ? `, ${result.signatures_verified} signatures verified (Ed25519)`
      : "";
    console.log(
      chalk.green(
        `\n  Result: VALID — ${result.total_runes} runes verified${sigInfo}`
      )
    );
  } else {
    console.log(
      chalk.red(
        `\n  Result: INVALID — chain broken at rune #${result.broken_at_sequence}`
      )
    );
  }

  // Stats
  const s = result.stats;
  console.log(
    chalk.dim(
      `  Total: ${s.total_runes} | Sessions: ${s.sessions} | Tools: ${s.unique_tools}`
    )
  );
  console.log(
    chalk.dim(
      `  PASS: ${s.decisions.PASS} | HALT: ${s.decisions.HALT} | RESHAPE: ${s.decisions.RESHAPE}`
    )
  );
  console.log(
    chalk.dim(`  Verification hash: ${result.verification_hash.slice(0, 16)}...`)
  );
  if (result.signatures_verified) {
    console.log(
      chalk.dim(`  Signing: Ed25519 | Signed: ${result.signatures_verified} | Unsigned: ${result.signatures_missing ?? 0}`)
    );
  }
  console.log();

  chain.close();

  if (!result.valid) {
    process.exit(1);
  }
}

