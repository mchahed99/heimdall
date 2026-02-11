import { describe, expect, test } from "bun:test";
import { WardEngine } from "../src/ward-engine.js";
import { loadBifrostConfig } from "../src/yaml-loader.js";
import type { BifrostConfig, ToolCallContext } from "../src/types.js";

function makeConfig(yaml: string): BifrostConfig {
  return loadBifrostConfig(yaml);
}

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool_name: "Bash",
    arguments: { command: "echo hello" },
    session_id: "test-session",
    ...overrides,
  };
}

describe("WardEngine", () => {
  describe("tool matching", () => {
    test("exact tool name match", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-bash
    tool: Bash
    action: HALT
    message: Bash blocked
    severity: critical
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("HALT");
      expect(result.matched_wards).toContain("block-bash");
    });

    test("wildcard * matches all tools", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: log-all
    tool: "*"
    when:
      always: true
    action: PASS
    message: Logged
    severity: low
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "anything" }));
      expect(result.decision).toBe("PASS");
      expect(result.matched_wards).toContain("log-all");
    });

    test("prefix glob matching (file_*)", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-file-ops
    tool: "file_*"
    action: HALT
    message: File ops blocked
    severity: high
`);
      const engine = new WardEngine(config);

      const r1 = engine.evaluate(makeCtx({ tool_name: "file_read" }));
      expect(r1.decision).toBe("HALT");

      const r2 = engine.evaluate(makeCtx({ tool_name: "file_write" }));
      expect(r2.decision).toBe("HALT");

      const r3 = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(r3.decision).toBe("PASS"); // default
    });

    test("case insensitive tool matching", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-bash
    tool: bash
    action: HALT
    message: Bash blocked
    severity: critical
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("HALT");
    });

    test("no matching wards returns default PASS", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-fetch
    tool: fetch
    action: HALT
    message: Fetch blocked
    severity: high
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("PASS");
      expect(result.matched_wards).toHaveLength(0);
    });
  });

  describe("condition matching", () => {
    test("argument_matches: regex on specific fields", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-rm
    tool: Bash
    when:
      argument_matches:
        command: "rm -rf"
    action: HALT
    message: rm -rf blocked
    severity: critical
`);
      const engine = new WardEngine(config);

      const r1 = engine.evaluate(
        makeCtx({ arguments: { command: "rm -rf /" } })
      );
      expect(r1.decision).toBe("HALT");

      const r2 = engine.evaluate(
        makeCtx({ arguments: { command: "echo hello" } })
      );
      expect(r2.decision).toBe("PASS");
    });

    test("argument_contains_pattern: regex across serialized args", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-secrets
    tool: "*"
    when:
      argument_contains_pattern: "sk-[a-zA-Z0-9]{20,}"
    action: HALT
    message: Secret detected
    severity: critical
`);
      const engine = new WardEngine(config);

      const r1 = engine.evaluate(
        makeCtx({
          arguments: { prompt: "Use key sk-abc123defghijklmnopqrstuv" },
        })
      );
      expect(r1.decision).toBe("HALT");

      const r2 = engine.evaluate(
        makeCtx({ arguments: { prompt: "Hello world" } })
      );
      expect(r2.decision).toBe("PASS");
    });

    test("always: true matches unconditionally", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: log-everything
    tool: "*"
    when:
      always: true
    action: PASS
    message: Everything logged
    severity: low
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx());
      expect(result.matched_wards).toContain("log-everything");
    });

    test("omitted when = always match", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-all-bash
    tool: Bash
    action: HALT
    message: All Bash blocked
    severity: critical
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("HALT");
    });

    test("multiple argument_matches conditions (AND logic)", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-specific
    tool: api_call
    when:
      argument_matches:
        url: "external[.]com"
        method: "DELETE"
    action: HALT
    message: External DELETE blocked
    severity: high
`);
      const engine = new WardEngine(config);

      // Both match → HALT
      const r1 = engine.evaluate(
        makeCtx({
          tool_name: "api_call",
          arguments: { url: "https://external.com/data", method: "DELETE" },
        })
      );
      expect(r1.decision).toBe("HALT");

      // Only one matches → PASS (AND logic)
      const r2 = engine.evaluate(
        makeCtx({
          tool_name: "api_call",
          arguments: { url: "https://external.com/data", method: "GET" },
        })
      );
      expect(r2.decision).toBe("PASS");
    });
  });

  describe("action priority", () => {
    test("HALT wins over PASS when multiple wards match", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: pass-all
    tool: "*"
    when:
      always: true
    action: PASS
    message: Allow all
    severity: low
  - id: block-bash
    tool: Bash
    action: HALT
    message: Bash blocked
    severity: critical
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("HALT");
      expect(result.matched_wards).toContain("pass-all");
      expect(result.matched_wards).toContain("block-bash");
    });

    test("HALT wins over RESHAPE", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: reshape-args
    tool: Bash
    action: RESHAPE
    message: Reshaped
    severity: medium
    reshape:
      safe: true
  - id: block-bash
    tool: Bash
    action: HALT
    message: Blocked
    severity: critical
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("HALT");
    });

    test("RESHAPE wins over PASS", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: pass-all
    tool: "*"
    when:
      always: true
    action: PASS
    message: Allowed
    severity: low
  - id: reshape-bash
    tool: Bash
    action: RESHAPE
    message: Reshaped
    severity: medium
    reshape:
      safe_mode: true
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(result.decision).toBe("RESHAPE");
      expect(result.reshaped_arguments).toBeDefined();
      expect(result.reshaped_arguments?.safe_mode).toBe(true);
    });
  });

  describe("RESHAPE action", () => {
    test("merges reshape config over original arguments", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: add-flag
    tool: Bash
    action: RESHAPE
    message: Flag added
    severity: medium
    reshape:
      confirm: true
      timeout: 30
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(
        makeCtx({ arguments: { command: "deploy", env: "prod" } })
      );
      expect(result.decision).toBe("RESHAPE");
      expect(result.reshaped_arguments).toEqual({
        command: "deploy",
        env: "prod",
        confirm: true,
        timeout: 30,
      });
    });
  });

  describe("ward_chain trace", () => {
    test("records all evaluated wards, not just matched ones", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: ward-a
    tool: fetch
    action: HALT
    message: Fetch blocked
    severity: high
  - id: ward-b
    tool: Bash
    action: HALT
    message: Bash blocked
    severity: critical
  - id: ward-c
    tool: "*"
    when:
      always: true
    action: PASS
    message: Logged
    severity: low
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx({ tool_name: "Bash" }));

      // Should have 3 entries in ward_chain
      expect(result.ward_chain).toHaveLength(3);

      // ward-a: tool didn't match
      expect(result.ward_chain[0].ward_id).toBe("ward-a");
      expect(result.ward_chain[0].matched).toBe(false);

      // ward-b: matched
      expect(result.ward_chain[1].ward_id).toBe("ward-b");
      expect(result.ward_chain[1].matched).toBe(true);

      // ward-c: matched (wildcard)
      expect(result.ward_chain[2].ward_id).toBe("ward-c");
      expect(result.ward_chain[2].matched).toBe(true);
    });

    test("evaluation_duration_ms is populated", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards: []
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx());
      expect(result.evaluation_duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("custom defaults", () => {
    test("respects custom default action HALT", () => {
      const config = makeConfig(`
version: "1"
realm: test
defaults:
  action: HALT
wards: []
`);
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx());
      expect(result.decision).toBe("HALT");
    });
  });
});
