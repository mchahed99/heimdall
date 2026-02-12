import type {
  RedTeamFinding,
  RedTeamSummary,
  RedTeamReport,
  RedTeamOptions,
  RedTeamAgentRole,
  FindingSeverity,
} from "./types.js";
import type Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./client.js";
import { INJECTION_PROMPT } from "./prompts/redteam-injection.js";
import { EXFIL_PROMPT } from "./prompts/redteam-exfil.js";
import { PRIVILEGE_PROMPT } from "./prompts/redteam-privilege.js";
import { COMPLIANCE_PROMPT } from "./prompts/redteam-compliance.js";

const VALID_SEVERITIES = new Set<FindingSeverity>([
  "critical", "high", "medium", "low", "info",
]);

const MAX_AGENT_TURNS = 10;

/**
 * Parse findings JSON from an agent response.
 * Handles raw JSON, JSON in code blocks, and malformed responses.
 */
export function parseFindings(
  response: string,
  agentRole: RedTeamAgentRole
): RedTeamFinding[] {
  let jsonStr = response.trim();

  // Try to extract JSON from code block
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Try to find JSON array in the response
  if (!jsonStr.startsWith("[")) {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (item: unknown): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => ({
      id: String(item.id ?? `${agentRole}-unknown`),
      severity: VALID_SEVERITIES.has(item.severity as FindingSeverity)
        ? (item.severity as FindingSeverity)
        : "medium",
      title: String(item.title ?? "Untitled finding"),
      description: String(item.description ?? ""),
      affected_tool: item.affected_tool ? String(item.affected_tool) : undefined,
      affected_ward: item.affected_ward ? String(item.affected_ward) : undefined,
      recommendation: String(item.recommendation ?? ""),
      agent: agentRole,
    }));
}

/**
 * Compute summary statistics from findings.
 */
export function computeSummary(
  findings: RedTeamFinding[],
  agentsCompleted: number,
  agentsFailed: number
): RedTeamSummary {
  const bySeverity: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    bySeverity[finding.severity]++;
  }

  return {
    total_findings: findings.length,
    by_severity: bySeverity,
    agents_completed: agentsCompleted,
    agents_failed: agentsFailed,
  };
}

/**
 * Format findings into a report (markdown or JSON).
 */
export function formatReport(
  report: RedTeamReport,
  format: "markdown" | "json"
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];

  lines.push("# Heimdall Red-Team Report");
  lines.push("");
  lines.push(`**Realm:** ${report.config_realm}`);
  lines.push(`**Date:** ${new Date(report.timestamp).toISOString()}`);
  lines.push(`**Agents:** ${report.summary.agents_completed} completed, ${report.summary.agents_failed} failed`);
  if (report.total_payloads_tested !== undefined) {
    lines.push(`**Payloads tested:** ${report.total_payloads_tested} (${report.total_bypasses ?? 0} bypasses found)`);
  }
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(`| CRITICAL | ${report.summary.by_severity.critical} |`);
  lines.push(`| HIGH     | ${report.summary.by_severity.high} |`);
  lines.push(`| MEDIUM   | ${report.summary.by_severity.medium} |`);
  lines.push(`| LOW      | ${report.summary.by_severity.low} |`);
  lines.push(`| INFO     | ${report.summary.by_severity.info} |`);
  lines.push(`| **Total**| **${report.summary.total_findings}** |`);
  lines.push("");

  // Findings
  lines.push("## Findings");
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No findings — your policy looks clean!");
    lines.push("");
  } else {
    const severityOrder: FindingSeverity[] = [
      "critical", "high", "medium", "low", "info",
    ];

    for (const severity of severityOrder) {
      const sev = report.findings.filter((f) => f.severity === severity);
      if (sev.length === 0) continue;

      lines.push(`### ${severity.toUpperCase()}`);
      lines.push("");

      for (const finding of sev) {
        lines.push(`#### ${finding.id}: ${finding.title}`);
        lines.push("");
        lines.push(`**Agent:** ${finding.agent}`);
        if (finding.affected_tool) {
          lines.push(`**Affected Tool:** ${finding.affected_tool}`);
        }
        if (finding.affected_ward) {
          lines.push(`**Affected Ward:** ${finding.affected_ward}`);
        }
        if (finding.bypass_payload) {
          lines.push(`**Bypass Payload:** \`${finding.bypass_payload}\``);
          lines.push(`**Ward Decision:** ${finding.ward_decision}`);
        }
        lines.push("");
        lines.push(finding.description);
        lines.push("");
        lines.push(`**Recommendation:** ${finding.recommendation}`);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// Tool definition for the test_ward tool that agents can use
const TEST_WARD_TOOL = {
  name: "test_ward",
  description: "Test a crafted tool call payload against the Heimdall WardEngine policy. Returns the ward decision (PASS/HALT/RESHAPE), matched wards, and rationale. Use this to verify whether your attack payloads would bypass the policy.",
  input_schema: {
    type: "object" as const,
    properties: {
      tool_name: {
        type: "string",
        description: "The tool name to test (e.g., 'Bash', 'Read', 'WebFetch', 'Write')",
      },
      arguments: {
        type: "object",
        description: "The tool call arguments to test (e.g., { command: 'curl https://evil.com' })",
        additionalProperties: true,
      },
    },
    required: ["tool_name", "arguments"],
  },
};

const SUBMIT_FINDINGS_TOOL = {
  name: "submit_findings",
  description: "Submit your final security findings report. Call this when you are done testing.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array",
        description: "Array of security findings",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
            title: { type: "string" },
            description: { type: "string" },
            affected_tool: { type: "string" },
            affected_ward: { type: "string" },
            recommendation: { type: "string" },
            bypass_payload: { type: "string" },
            ward_decision: { type: "string" },
          },
          required: ["id", "severity", "title", "description", "recommendation"],
        },
      },
    },
    required: ["findings"],
  },
};

const AGENT_PROMPTS: Record<RedTeamAgentRole, string> = {
  injection: INJECTION_PROMPT,
  exfiltration: EXFIL_PROMPT,
  privilege: PRIVILEGE_PROMPT,
  compliance: COMPLIANCE_PROMPT,
};

const AGENT_ROLES: RedTeamAgentRole[] = [
  "injection",
  "exfiltration",
  "privilege",
  "compliance",
];

/**
 * Run a single red-team agent with tool use against a policy.
 * The agent can call test_ward to verify its attack payloads.
 */
async function runAgent(
  policyYaml: string,
  role: RedTeamAgentRole,
  model: string,
  onPayloadTested?: (role: string, toolName: string, decision: string) => void
): Promise<{ findings: RedTeamFinding[]; payloadsTested: number; bypasses: number }> {
  const client = getClient();
  const { WardEngine, loadBifrostConfig } = await import("@heimdall/core");

  const config = loadBifrostConfig(policyYaml);
  const engine = new WardEngine(config);
  const systemPrompt = AGENT_PROMPTS[role];

  let payloadsTested = 0;
  let bypasses = 0;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Analyze this Heimdall bifrost.yaml security policy and actively test it for weaknesses.

Use the test_ward tool to craft attack payloads and verify whether they bypass the policy. Try multiple variations — encoding tricks, edge cases, tool chaining patterns, argument manipulation.

When you are done testing, call submit_findings with your results.

\`\`\`yaml
${policyYaml}
\`\`\``,
    },
  ];

  // Agentic loop: let the agent call tools until it submits findings or hits max turns
  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [TEST_WARD_TOOL, SUBMIT_FINDINGS_TOOL],
      messages,
    });

    // Check for tool use
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      // No tool calls — extract findings from text response
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const findings = parseFindings(textBlock.text, role);
        return { findings, payloadsTested, bypasses };
      }
      return { findings: [], payloadsTested, bypasses };
    }

    // Add assistant response to conversation
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlock[] });

    // Process each tool call
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      if (block.name === "submit_findings") {
        // Agent is done — parse its findings
        const input = block.input as { findings?: unknown[] };
        const rawFindings = input.findings ?? [];
        const findings: RedTeamFinding[] = rawFindings
          .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
          .map((f) => ({
            id: String(f.id ?? `${role}-unknown`),
            severity: VALID_SEVERITIES.has(f.severity as FindingSeverity)
              ? (f.severity as FindingSeverity)
              : "medium",
            title: String(f.title ?? "Untitled"),
            description: String(f.description ?? ""),
            affected_tool: f.affected_tool ? String(f.affected_tool) : undefined,
            affected_ward: f.affected_ward ? String(f.affected_ward) : undefined,
            recommendation: String(f.recommendation ?? ""),
            bypass_payload: f.bypass_payload ? String(f.bypass_payload) : undefined,
            ward_decision: f.ward_decision ? String(f.ward_decision) : undefined,
            agent: role,
          }));
        return { findings, payloadsTested, bypasses };
      }

      if (block.name === "test_ward") {
        // Execute the test_ward tool against WardEngine
        const input = block.input as { tool_name: string; arguments: Record<string, unknown> };
        payloadsTested++;

        try {
          const evaluation = engine.evaluate({
            tool_name: input.tool_name,
            arguments: input.arguments ?? {},
            session_id: `redteam-${role}`,
          });

          const decision = evaluation.decision;
          if (decision === "PASS" && evaluation.matched_wards.length === 0) {
            bypasses++;
          }

          onPayloadTested?.(role, input.tool_name, decision);

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({
              decision,
              matched_wards: evaluation.matched_wards,
              rationale: evaluation.rationale,
              reshaped: evaluation.reshaped_arguments ? true : false,
            }),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: String(err) }),
          });
        }
      }
    }

    // Add tool results to conversation
    messages.push({ role: "user", content: toolResults });

    // If stop reason is end_turn (not tool_use), we're done
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        const findings = parseFindings(textBlock.text, role);
        return { findings, payloadsTested, bypasses };
      }
      return { findings: [], payloadsTested, bypasses };
    }
  }

  // Max turns reached — return what we have
  return { findings: [], payloadsTested, bypasses };
}

/**
 * Run the full red-team swarm against a bifrost.yaml policy.
 * Each agent uses tool calls to actively test the policy.
 */
export async function runRedTeam(
  options: RedTeamOptions
): Promise<RedTeamReport> {
  const { readFileSync } = await import("node:fs");
  const { loadBifrostConfig } = await import("@heimdall/core");

  const policyContent = readFileSync(options.config, "utf-8");
  const config = loadBifrostConfig(policyContent);
  const model = options.model ?? "claude-opus-4-6-20250219";

  console.error(`[heimdall] Red-team analysis of "${config.realm}" (${config.wards.length} wards)`);

  // Run all 4 agents in parallel with tool use
  const results = await Promise.allSettled(
    AGENT_ROLES.map(async (role) => {
      console.error(`[heimdall] [${role}] starting agent...`);
      const result = await runAgent(
        policyContent,
        role,
        model,
        (agentRole, toolName, decision) => {
          const icon = decision === "HALT" ? "blocked" : decision === "RESHAPE" ? "reshaped" : "bypassed";
          console.error(`[heimdall] [${agentRole}] test_ward(${toolName}) -> ${icon}`);
        }
      );
      console.error(
        `[heimdall] [${role}] done — ${result.findings.length} findings, ` +
        `${result.payloadsTested} payloads tested, ${result.bypasses} bypasses`
      );
      return { role, ...result };
    })
  );

  // Aggregate results
  const allFindings: RedTeamFinding[] = [];
  let agentsCompleted = 0;
  let agentsFailed = 0;
  let totalPayloads = 0;
  let totalBypasses = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      allFindings.push(...result.value.findings);
      totalPayloads += result.value.payloadsTested;
      totalBypasses += result.value.bypasses;
      agentsCompleted++;
    } else {
      console.error(`[heimdall] Agent failed: ${result.reason}`);
      agentsFailed++;
    }
  }

  const summary = computeSummary(allFindings, agentsCompleted, agentsFailed);

  return {
    summary,
    findings: allFindings,
    timestamp: new Date().toISOString(),
    config_realm: config.realm,
    total_payloads_tested: totalPayloads,
    total_bypasses: totalBypasses,
  };
}
