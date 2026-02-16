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

    // === Stage 0: Discover MCP server tools ===
    const serverEntry = resolve(opts.path, "server.ts");
    if (existsSync(serverEntry)) {
      console.error(chalk.blue("\n[0/3] Discovering MCP server tools..."));
      try {
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        const transport = new StdioClientTransport({
          command: "bun",
          args: ["run", serverEntry],
          env: process.env as Record<string, string>,
        });
        const client = new Client({ name: "heimdall-audit", version: "1.0.0" });
        await client.connect(transport);
        const { tools } = await client.listTools();
        console.error(chalk.white(`  Server: ${resolve(opts.path)}`));
        console.error(chalk.white(`  Tools discovered: ${tools.length}\n`));
        for (const tool of tools) {
          const desc = tool.description
            ? tool.description.length > 80
              ? tool.description.slice(0, 77) + "..."
              : tool.description
            : "";
          console.error(`  ${chalk.cyan("●")} ${chalk.bold(tool.name)}  ${chalk.dim(desc)}`);
        }
        console.error("");
        await client.close();
      } catch {
        // Non-fatal — continue without tool discovery
      }
    }

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

IMPORTANT SCHEMA RULES:
- Valid ward actions are ONLY: PASS, HALT, RESHAPE. Do NOT use any other action (no MASK, BLOCK, DENY, ALLOW, etc.).
- HALT = block the tool call entirely.
- RESHAPE = modify tool arguments (requires a "reshape" field with key/value overrides; use "__DELETE__" sentinel to remove keys).
- PASS = explicitly allow.
- Each ward must have: id, tool, when (with argument_matches or argument_contains_pattern or max_calls_per_minute), action, message, severity.
- Valid severity values: critical, high, medium, low, info.
- Tool patterns use glob syntax ("*" for all tools, "export_*" for prefix match).
- Ward conditions use AND logic — all conditions in "when" must match.
- Action priority: HALT > RESHAPE > PASS (most restrictive wins when multiple wards match).

Current policy:
\`\`\`yaml
${policyYaml}
\`\`\`

Red-team findings:
${formatReport(report, "markdown")}

Generate the complete improved bifrost.yaml. Add new wards to close each bypass. Do not remove existing wards. Output ONLY the YAML in \`\`\`yaml fences.`;

      const patchResponse = await client.messages.create({
        model: model ?? "claude-opus-4-6",
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 8000,
        },
        messages: [{ role: "user", content: patchPrompt }],
      });

      const { extractYaml } = await import("@heimdall/ai");
      const { loadBifrostConfig } = await import("@heimdall/core");

      const tryPatch = async (response: typeof patchResponse, attempt: number): Promise<boolean> => {
        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") return false;

        const { yaml: patchedYaml } = extractYaml(textBlock.text);
        try {
          const patched = loadBifrostConfig(patchedYaml);
          writeFileSync(configPath, patchedYaml);
          console.error(chalk.green(`  Policy patched: ${patched.wards.length} wards`));
          console.error(chalk.green(`  Written to ${configPath}`));
          return true;
        } catch (err) {
          if (attempt < 2) {
            console.error(chalk.yellow(`  Attempt ${attempt} validation failed, retrying with feedback...`));
            const retryResponse = await client.messages.create({
              model: model ?? "claude-opus-4-6",
              max_tokens: 16000,
              thinking: { type: "enabled", budget_tokens: 8000 },
              messages: [
                { role: "user", content: patchPrompt },
                { role: "assistant", content: textBlock.text },
                { role: "user", content: `Validation error: ${err}\n\nFix the YAML. Remember: valid actions are ONLY PASS, HALT, RESHAPE. Output the corrected complete YAML in \`\`\`yaml fences.` },
              ],
            });
            return tryPatch(retryResponse, attempt + 1);
          }
          console.error(chalk.yellow(`  Auto-patch validation failed: ${err}`));
          console.error(chalk.yellow(`  Original policy preserved`));
          return false;
        }
      };

      await tryPatch(patchResponse, 1);
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
