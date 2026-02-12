import { describe, test, expect } from "bun:test";
import {
  parseFindings,
  computeSummary,
  formatReport,
} from "../src/redteam.js";
import type { RedTeamFinding, RedTeamReport } from "../src/types.js";

// === parseFindings() Tests ===

describe("parseFindings", () => {
  test("parses valid JSON array of findings", () => {
    const response = JSON.stringify([
      {
        id: "INJ-001",
        severity: "critical",
        title: "Prompt injection via tool args",
        description: "The policy does not check for injection patterns",
        affected_tool: "Bash",
        recommendation: "Add argument_contains_pattern for injection strings",
      },
      {
        id: "INJ-002",
        severity: "high",
        title: "XPIA via WebFetch",
        description: "Web content could contain injected instructions",
        affected_tool: "WebFetch",
        recommendation: "Add content inspection ward",
      },
    ]);

    const findings = parseFindings(response, "injection");

    expect(findings).toHaveLength(2);
    expect(findings[0].id).toBe("INJ-001");
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].agent).toBe("injection");
    expect(findings[1].id).toBe("INJ-002");
    expect(findings[1].severity).toBe("high");
  });

  test("maps severity correctly", () => {
    const response = JSON.stringify([
      { id: "F-1", severity: "critical", title: "T", description: "D", recommendation: "R" },
      { id: "F-2", severity: "high", title: "T", description: "D", recommendation: "R" },
      { id: "F-3", severity: "medium", title: "T", description: "D", recommendation: "R" },
      { id: "F-4", severity: "low", title: "T", description: "D", recommendation: "R" },
      { id: "F-5", severity: "info", title: "T", description: "D", recommendation: "R" },
    ]);

    const findings = parseFindings(response, "compliance");
    expect(findings.map((f) => f.severity)).toEqual([
      "critical", "high", "medium", "low", "info",
    ]);
  });

  test("malformed JSON returns empty array", () => {
    const findings = parseFindings("this is not json at all", "injection");
    expect(findings).toEqual([]);
  });

  test("extracts JSON from markdown code block", () => {
    const response = [
      "Here are my findings:",
      "```json",
      JSON.stringify([
        { id: "F-1", severity: "high", title: "T", description: "D", recommendation: "R" },
      ]),
      "```",
    ].join("\n");

    const findings = parseFindings(response, "exfiltration");
    expect(findings).toHaveLength(1);
    expect(findings[0].agent).toBe("exfiltration");
  });

  test("non-array JSON returns empty array", () => {
    const findings = parseFindings('{"not": "an array"}', "injection");
    expect(findings).toEqual([]);
  });
});

// === computeSummary() Tests ===

describe("computeSummary", () => {
  test("correct severity counts from findings array", () => {
    const findings: RedTeamFinding[] = [
      { id: "1", severity: "critical", title: "T", description: "D", recommendation: "R", agent: "injection" },
      { id: "2", severity: "critical", title: "T", description: "D", recommendation: "R", agent: "injection" },
      { id: "3", severity: "high", title: "T", description: "D", recommendation: "R", agent: "exfiltration" },
      { id: "4", severity: "medium", title: "T", description: "D", recommendation: "R", agent: "privilege" },
      { id: "5", severity: "low", title: "T", description: "D", recommendation: "R", agent: "compliance" },
    ];

    const summary = computeSummary(findings, 4, 0);

    expect(summary.total_findings).toBe(5);
    expect(summary.by_severity.critical).toBe(2);
    expect(summary.by_severity.high).toBe(1);
    expect(summary.by_severity.medium).toBe(1);
    expect(summary.by_severity.low).toBe(1);
    expect(summary.by_severity.info).toBe(0);
    expect(summary.agents_completed).toBe(4);
    expect(summary.agents_failed).toBe(0);
  });

  test("empty findings produces zero counts", () => {
    const summary = computeSummary([], 0, 0);

    expect(summary.total_findings).toBe(0);
    expect(summary.by_severity.critical).toBe(0);
    expect(summary.by_severity.high).toBe(0);
    expect(summary.agents_completed).toBe(0);
  });
});

// === formatReport() Tests ===

describe("formatReport", () => {
  const report: RedTeamReport = {
    summary: {
      total_findings: 2,
      by_severity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
      agents_completed: 4,
      agents_failed: 0,
    },
    findings: [
      {
        id: "INJ-001",
        severity: "critical",
        title: "Prompt injection via Bash",
        description: "Bash tool lacks injection pattern detection",
        affected_tool: "Bash",
        recommendation: "Add argument_contains_pattern ward",
        agent: "injection",
      },
      {
        id: "EXFIL-001",
        severity: "high",
        title: "Data exfiltration via WebFetch",
        description: "No DLP controls on web requests",
        affected_tool: "WebFetch",
        recommendation: "Add URL pattern restrictions",
        agent: "exfiltration",
      },
    ],
    timestamp: "2025-01-15T12:00:00.000Z",
    config_realm: "test-realm",
  };

  test("markdown output has correct structure", () => {
    const md = formatReport(report, "markdown");

    expect(md).toContain("# Heimdall Red-Team Report");
    expect(md).toContain("test-realm");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("Prompt injection via Bash");
    expect(md).toContain("Data exfiltration via WebFetch");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Findings");
  });

  test("JSON output is valid and complete", () => {
    const jsonStr = formatReport(report, "json");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.summary.total_findings).toBe(2);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.config_realm).toBe("test-realm");
    expect(parsed.timestamp).toBe("2025-01-15T12:00:00.000Z");
  });

  test("empty findings produces valid clean report", () => {
    const cleanReport: RedTeamReport = {
      summary: {
        total_findings: 0,
        by_severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        agents_completed: 4,
        agents_failed: 0,
      },
      findings: [],
      timestamp: "2025-01-15T12:00:00.000Z",
      config_realm: "clean-realm",
    };

    const md = formatReport(cleanReport, "markdown");
    expect(md).toContain("No findings");

    const jsonStr = formatReport(cleanReport, "json");
    const parsed = JSON.parse(jsonStr);
    expect(parsed.findings).toEqual([]);
  });
});
