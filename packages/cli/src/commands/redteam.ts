import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface RedTeamOpts {
  config: string;
  output?: string;
  format: string;
  model?: string;
}

export async function redteamCommand(opts: RedTeamOpts): Promise<void> {
  const chalk = (await import("chalk")).default;

  try {
    const { runRedTeam, formatReport } = await import("@heimdall/ai");

    const report = await runRedTeam({
      config: resolve(opts.config),
      output: opts.output ? resolve(opts.output) : undefined,
      format: opts.format as "markdown" | "json",
      model: opts.model,
    });

    const output = formatReport(report, opts.format as "markdown" | "json");

    if (opts.output) {
      writeFileSync(resolve(opts.output), output);
      console.error(chalk.green(`\n✓ Report written to ${opts.output}`));
    } else {
      console.log(output);
    }

    // Summary on stderr
    const s = report.summary;
    const severity = s.by_severity;
    console.error(
      chalk.bold(`\nFindings: ${s.total_findings} total`) +
      (severity.critical > 0 ? chalk.red(` | ${severity.critical} critical`) : "") +
      (severity.high > 0 ? chalk.yellow(` | ${severity.high} high`) : "") +
      (severity.medium > 0 ? ` | ${severity.medium} medium` : "") +
      (severity.low > 0 ? ` | ${severity.low} low` : "")
    );
  } catch (err) {
    console.error(chalk.red(`\n✗ ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}
