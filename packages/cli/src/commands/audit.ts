import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface AuditOpts {
  path: string;
  config: string;
  realm?: string;
  model?: string;
  output?: string;
}

export async function auditCommand(opts: AuditOpts): Promise<void> {
  const chalk = (await import("chalk")).default;

  try {
    const { generatePolicy, runRedTeam, formatReport } = await import("@heimdall/ai");

    const configPath = resolve(opts.config);
    const model = opts.model;

    // === Stage 1: Generate or load policy ===
    let policyYaml: string;

    if (existsSync(configPath)) {
      console.error(chalk.blue("\n[1/3] Loading existing policy..."));
      policyYaml = readFileSync(configPath, "utf-8");
      console.error(chalk.green(`  Loaded ${configPath}`));
    } else {
      console.error(chalk.blue("\n[1/3] Generating security policy from codebase..."));
      policyYaml = await generatePolicy({
        path: resolve(opts.path),
        output: configPath,
        realm: opts.realm,
        model,
      });
      writeFileSync(configPath, policyYaml);
      console.error(chalk.green(`  Policy written to ${configPath}`));
    }

    // === Stage 2: Red-team the policy ===
    console.error(chalk.blue("\n[2/3] Red-teaming policy with 4 parallel agents..."));
    const report = await runRedTeam({
      config: configPath,
      format: "markdown",
      model,
    });

    const s = report.summary;
    console.error(
      chalk.bold(`  Results: ${s.total_findings} findings`) +
      (s.by_severity.critical > 0 ? chalk.red(` | ${s.by_severity.critical} critical`) : "") +
      (s.by_severity.high > 0 ? chalk.yellow(` | ${s.by_severity.high} high`) : "") +
      (report.total_payloads_tested ? ` | ${report.total_payloads_tested} payloads tested` : "") +
      (report.total_bypasses ? chalk.red(` | ${report.total_bypasses} bypasses`) : "")
    );

    // === Stage 3: Auto-patch if bypasses found ===
    if (report.total_bypasses && report.total_bypasses > 0) {
      console.error(chalk.blue("\n[3/3] Auto-patching policy to close gaps..."));

      const { getClient } = await import("@heimdall/ai");
      const client = getClient();

      const patchPrompt = `You are Heimdall's policy auto-patcher. Given the current bifrost.yaml and a red-team report showing bypasses, generate an improved bifrost.yaml that closes all identified gaps.

Current policy:
\`\`\`yaml
${policyYaml}
\`\`\`

Red-team findings:
${formatReport(report, "markdown")}

Generate the complete improved bifrost.yaml. Add new wards to close each bypass. Do not remove existing wards. Output ONLY the YAML in \`\`\`yaml fences.`;

      const patchResponse = await client.messages.create({
        model: model ?? "claude-opus-4-6-20250219",
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 8000,
        },
        messages: [{ role: "user", content: patchPrompt }],
      });

      const textBlock = patchResponse.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const { extractYaml } = await import("@heimdall/ai");
        const { yaml: patchedYaml } = extractYaml(textBlock.text);

        // Validate patched policy
        const { loadBifrostConfig } = await import("@heimdall/core");
        try {
          const patched = loadBifrostConfig(patchedYaml);
          writeFileSync(configPath, patchedYaml);
          console.error(chalk.green(`  Policy patched: ${patched.wards.length} wards (was ${report.summary.total_findings > 0 ? "vulnerable" : "clean"})`));
          console.error(chalk.green(`  Written to ${configPath}`));
        } catch (err) {
          console.error(chalk.yellow(`  Auto-patch validation failed: ${err}`));
          console.error(chalk.yellow(`  Original policy preserved`));
        }
      }
    } else {
      console.error(chalk.green("\n[3/3] No bypasses found — policy is solid!"));
    }

    // === Output report ===
    const reportOutput = formatReport(report, "markdown");
    if (opts.output) {
      writeFileSync(resolve(opts.output), reportOutput);
      console.error(chalk.green(`\nReport written to ${opts.output}`));
    } else {
      console.log(reportOutput);
    }

    console.error(chalk.bold.blue("\nAudit complete."));
  } catch (err) {
    console.error(chalk.red(`\n${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}
