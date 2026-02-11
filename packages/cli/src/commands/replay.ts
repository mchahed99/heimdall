import chalk from "chalk";
import { loadBifrostFile, Runechain, WardEngine } from "@heimdall/core";
import type { ToolCallContext } from "@heimdall/core";

export async function replayCommand(options: {
  config: string;
  db: string;
}): Promise<void> {
  const config = await loadBifrostFile(options.config);
  const engine = new WardEngine(config);
  const chain = new Runechain(options.db);

  const runes = chain.getRunes(); // All runes, newest first
  runes.reverse(); // Process in chronological order

  let changed = 0;
  let total = 0;

  for (const rune of runes) {
    total++;

    // Reconstruct tool call context (we don't have original args, only hash + summary)
    const ctx: ToolCallContext = {
      tool_name: rune.tool_name,
      arguments: {}, // We can't recover original args from hash — evaluate tool match only
      session_id: rune.session_id,
    };

    const newEval = engine.evaluate(ctx);

    if (newEval.decision !== rune.decision) {
      changed++;
      const oldColor = rune.decision === "HALT" ? chalk.red : rune.decision === "RESHAPE" ? chalk.yellow : chalk.green;
      const newColor = newEval.decision === "HALT" ? chalk.red : newEval.decision === "RESHAPE" ? chalk.yellow : chalk.green;

      console.log(
        `  #${rune.sequence} ${chalk.dim(rune.tool_name)} ` +
        `${oldColor(rune.decision)} → ${newColor(newEval.decision)} ` +
        chalk.dim(`(${newEval.rationale})`)
      );
    }
  }

  console.log();
  if (changed === 0) {
    console.log(chalk.green(`✓ No changes — all ${total} runes would have the same decision.`));
  } else {
    console.log(chalk.yellow(`⚠ ${changed}/${total} runes would change decision with the new policy.`));
  }

  chain.close();
}
