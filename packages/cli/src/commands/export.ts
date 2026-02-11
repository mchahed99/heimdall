import chalk from "chalk";
import { Runechain } from "@heimdall/core";
import { existsSync } from "fs";

export async function exportCommand(options: {
  format: string;
  db: string;
  output?: string;
}): Promise<void> {
  if (!existsSync(options.db)) {
    console.error(chalk.red("No audit database found at: " + options.db));
    process.exit(1);
  }

  const chain = new Runechain(options.db);
  const runes = chain.getRunes();

  let content: string;

  if (options.format === "json") {
    content = JSON.stringify(runes, null, 2);
  } else if (options.format === "csv") {
    const headers = [
      "sequence",
      "timestamp",
      "session_id",
      "tool_name",
      "decision",
      "matched_wards",
      "rationale",
      "arguments_hash",
      "content_hash",
      "previous_hash",
      "duration_ms",
    ];
    const rows = runes.map((r) =>
      headers
        .map((h) => {
          const val = (r as Record<string, unknown>)[h];
          if (Array.isArray(val)) return JSON.stringify(val.join(";"));
          return JSON.stringify(val ?? "");
        })
        .join(",")
    );
    content = [headers.join(","), ...rows].join("\n");
  } else {
    console.error(chalk.red(`Unknown format: ${options.format}. Use 'json' or 'csv'.`));
    process.exit(1);
    return;
  }

  if (options.output) {
    await Bun.write(options.output, content);
    console.error(
      chalk.green(`Exported ${runes.length} runes to ${options.output}`)
    );
  } else {
    console.log(content);
  }

  chain.close();
}
