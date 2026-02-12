import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface GenerateOpts {
  path: string;
  output: string;
  realm?: string;
  model?: string;
  include?: string;
  exclude?: string;
}

export async function generateCommand(opts: GenerateOpts): Promise<void> {
  const chalk = (await import("chalk")).default;

  try {
    const { generatePolicy } = await import("@heimdall/ai");

    const include = opts.include ? opts.include.split(",").map((s) => s.trim()) : undefined;
    const exclude = opts.exclude ? opts.exclude.split(",").map((s) => s.trim()) : undefined;

    const yaml = await generatePolicy({
      path: resolve(opts.path),
      output: resolve(opts.output),
      realm: opts.realm,
      model: opts.model,
      include,
      exclude,
    });

    const outputPath = resolve(opts.output);
    writeFileSync(outputPath, yaml);
    console.error(chalk.green(`\n✓ Policy written to ${outputPath}`));
  } catch (err) {
    console.error(chalk.red(`\n✗ ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}
