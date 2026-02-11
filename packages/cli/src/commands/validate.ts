import chalk from "chalk";
import { loadBifrostFile } from "@heimdall/core";

export async function validateCommand(options: { config: string }): Promise<void> {
  try {
    const config = await loadBifrostFile(options.config);

    console.log(chalk.green("✓") + " bifrost.yaml is valid\n");
    console.log(`  Realm:   ${chalk.cyan(config.realm)}`);
    console.log(`  Version: ${config.version}`);
    console.log(`  Wards:   ${config.wards.length}`);

    const actions: Record<string, number> = {};
    for (const ward of config.wards) {
      actions[ward.action] = (actions[ward.action] ?? 0) + 1;
    }

    for (const [action, count] of Object.entries(actions)) {
      const color = action === "HALT" ? chalk.red : action === "RESHAPE" ? chalk.yellow : chalk.green;
      console.log(`           ${color(action)}: ${count}`);
    }

    if (config.sinks && config.sinks.length > 0) {
      console.log(`  Sinks:   ${config.sinks.length}`);
      for (const sink of config.sinks) {
        console.log(`           ${chalk.blue(sink.type)}`);
      }
    }

    if (config.extends && config.extends.length > 0) {
      console.log(`  Extends: ${config.extends.join(", ")}`);
    }

    // Warnings
    const warnings: string[] = [];

    const ids = config.wards.map((w) => w.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      warnings.push(`Duplicate ward IDs: ${dupes.join(", ")}`);
    }

    for (let i = 0; i < config.wards.length; i++) {
      const ward = config.wards[i];
      if (ward.tool === "*" && ward.action === "HALT" && ward.when?.always) {
        const after = config.wards.slice(i + 1);
        if (after.some((w) => w.action === "PASS")) {
          warnings.push(`Ward "${ward.id}" (HALT *) may shadow subsequent PASS wards`);
        }
      }
    }

    if (warnings.length > 0) {
      console.log();
      for (const w of warnings) {
        console.log(chalk.yellow("⚠ ") + w);
      }
    }
  } catch (err) {
    console.error(chalk.red("✗") + ` Invalid configuration: ${err}`);
    process.exit(1);
  }
}
