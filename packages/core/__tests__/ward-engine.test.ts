import { describe, expect, test } from "bun:test";
import { WardEngine, InMemoryRateLimiter } from "../src/ward-engine.js";
import type { RateLimitProvider } from "../src/ward-engine.js";
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

  describe("fail-closed missing fields", () => {
    test("argument_matches fails when field is absent from arguments", () => {
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
    message: rm blocked
    severity: critical
`);
      const engine = new WardEngine(config);

      // Field present and matching → HALT
      const r1 = engine.evaluate(
        makeCtx({ arguments: { command: "rm -rf /" } })
      );
      expect(r1.decision).toBe("HALT");

      // Field absent entirely → does NOT match (fail-closed)
      const r2 = engine.evaluate(
        makeCtx({ arguments: { prompt: "do something" } })
      );
      expect(r2.decision).toBe("PASS");
      expect(r2.matched_wards).not.toContain("block-rm");
    });

    test("missing field does not trigger HALT ward", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: block-api-key
    tool: "*"
    when:
      argument_matches:
        api_key: "^sk-"
    action: HALT
    message: API key detected
    severity: critical
`);
      const engine = new WardEngine(config);

      // No api_key field → ward should NOT match (fail-closed security)
      const result = engine.evaluate(
        makeCtx({ arguments: { prompt: "hello" } })
      );
      expect(result.decision).toBe("PASS");
    });
  });

  describe("rate limiting (max_calls_per_minute)", () => {
    test("does not trigger when under the limit", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 5
    action: HALT
    message: Rate limit exceeded
    severity: high
`);
      // Provider returns 3 calls (under limit of 5)
      const provider: RateLimitProvider = () => 3;
      const engine = new WardEngine(config, { rateLimitProvider: provider });
      const result = engine.evaluate(makeCtx());
      expect(result.decision).toBe("PASS");
    });

    test("triggers HALT when at or above the limit", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 5
    action: HALT
    message: Rate limit exceeded
    severity: high
`);
      // Provider returns 5 calls (at the limit)
      const provider: RateLimitProvider = () => 5;
      const engine = new WardEngine(config, { rateLimitProvider: provider });
      const result = engine.evaluate(makeCtx());
      expect(result.decision).toBe("HALT");
      expect(result.matched_wards).toContain("rate-limit");
    });

    test("tool-specific rate limit only counts that tool", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: rate-limit-bash
    tool: Bash
    when:
      max_calls_per_minute: 10
    action: HALT
    message: Bash rate limit
    severity: high
`);
      // Provider tracks which tool is being queried
      const provider: RateLimitProvider = (_sid, toolName, _window) => {
        if (toolName === "Bash") return 12; // over limit
        return 2; // other tools under
      };
      const engine = new WardEngine(config, { rateLimitProvider: provider });

      const r1 = engine.evaluate(makeCtx({ tool_name: "Bash" }));
      expect(r1.decision).toBe("HALT");

      // Read tool doesn't match the ward's tool pattern at all
      const r2 = engine.evaluate(makeCtx({ tool_name: "Read" }));
      expect(r2.decision).toBe("PASS");
    });

    test("wildcard ward queries with tool '*' for global count", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: global-limit
    tool: "*"
    when:
      max_calls_per_minute: 20
    action: HALT
    message: Global limit
    severity: high
`);
      let queriedTool = "";
      const provider: RateLimitProvider = (_sid, toolName, _window) => {
        queriedTool = toolName;
        return 25; // over limit
      };
      const engine = new WardEngine(config, { rateLimitProvider: provider });
      engine.evaluate(makeCtx({ tool_name: "Bash" }));
      // For wildcard ward, should query with "*" not the specific tool
      expect(queriedTool).toBe("*");
    });

    test("rate limit ignored when no provider is set", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 5
    action: HALT
    message: Rate limit exceeded
    severity: high
`);
      // No rateLimitProvider — condition should not match
      const engine = new WardEngine(config);
      const result = engine.evaluate(makeCtx());
      expect(result.decision).toBe("PASS");
    });

    test("rate limit combined with argument_matches (AND logic)", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: rate-limit-bash-deploy
    tool: Bash
    when:
      argument_matches:
        command: "deploy"
      max_calls_per_minute: 3
    action: HALT
    message: Deploy rate limited
    severity: high
`);
      const provider: RateLimitProvider = () => 5;
      const engine = new WardEngine(config, { rateLimitProvider: provider });

      // Both conditions match → HALT
      const r1 = engine.evaluate(
        makeCtx({ arguments: { command: "deploy prod" } })
      );
      expect(r1.decision).toBe("HALT");

      // argument doesn't match → PASS (AND logic)
      const r2 = engine.evaluate(
        makeCtx({ arguments: { command: "echo hello" } })
      );
      expect(r2.decision).toBe("PASS");
    });
  });

  describe("InMemoryRateLimiter", () => {
    test("counts calls correctly", () => {
      const limiter = new InMemoryRateLimiter();
      limiter.call("session-1", "Bash");
      limiter.call("session-1", "Bash");
      limiter.call("session-1", "Read");

      expect(limiter.getCallCount("session-1", "Bash", 60_000)).toBe(2);
      expect(limiter.getCallCount("session-1", "Read", 60_000)).toBe(1);
      // Wildcard counts all tools in session
      expect(limiter.getCallCount("session-1", "*", 60_000)).toBe(3);
    });

    test("isolates sessions", () => {
      const limiter = new InMemoryRateLimiter();
      limiter.call("session-1", "Bash");
      limiter.call("session-2", "Bash");

      expect(limiter.getCallCount("session-1", "Bash", 60_000)).toBe(1);
      expect(limiter.getCallCount("session-2", "Bash", 60_000)).toBe(1);
    });

    test("gc cleans up stale entries that are never queried", () => {
      const limiter = new InMemoryRateLimiter();

      // Record a call for a session that will never call getCallCount
      limiter.call("stale-session", "StaleTool");

      // Verify it was recorded
      expect(limiter.getCallCount("stale-session", "StaleTool", 60_000)).toBe(1);

      // Inject an old timestamp directly to simulate staleness
      // We access the private map through a type assertion
      const calls = (limiter as unknown as { calls: Map<string, number[]> }).calls;
      const key = "stale-session:StaleTool";
      calls.set(key, [Date.now() - 300_000]); // 5 minutes ago

      // Fire 100 calls to trigger GC
      for (let i = 0; i < 100; i++) {
        limiter.call("active-session", "Tool");
      }

      // The stale entry should have been cleaned up by gc()
      // (it had only timestamps older than MAX_AGE_MS=120s)
      expect(calls.has(key)).toBe(false);

      // Active session entries should still exist
      expect(limiter.getCallCount("active-session", "Tool", 60_000)).toBe(100);
    });
  });

  describe("argument_contains_pattern case insensitivity", () => {
    test("matches case-insensitively", () => {
      const config = makeConfig(`
version: "1"
realm: test
wards:
  - id: detect-keys
    tool: "*"
    when:
      argument_contains_pattern: "SK-[a-zA-Z0-9]{20,}"
    action: HALT
    message: Secret detected
    severity: critical
`);
      const engine = new WardEngine(config);

      // Pattern is uppercase SK- but input has lowercase sk-
      const result = engine.evaluate(
        makeCtx({
          arguments: { prompt: "Use key sk-abc123defghijklmnopqrstuv" },
        })
      );
      expect(result.decision).toBe("HALT");
    });
  });

  describe("YAML validation", () => {
    test("rejects invalid action values", () => {
      expect(() =>
        makeConfig(`
version: "1"
realm: test
wards:
  - id: bad-ward
    tool: "*"
    action: BLOCK
    message: Should fail
    severity: high
`)
      ).toThrow("invalid action 'BLOCK'");
    });

    test("rejects invalid severity values", () => {
      expect(() =>
        makeConfig(`
version: "1"
realm: test
wards:
  - id: bad-ward
    tool: "*"
    action: HALT
    message: Should fail
    severity: extreme
`)
      ).toThrow("invalid severity 'extreme'");
    });

    test("accepts all valid action values", () => {
      for (const action of ["PASS", "HALT", "RESHAPE"]) {
        expect(() =>
          makeConfig(`
version: "1"
realm: test
wards:
  - id: valid-ward
    tool: "*"
    action: ${action}
    message: Valid
    severity: low
`)
        ).not.toThrow();
      }
    });

    test("accepts all valid severity values", () => {
      for (const severity of ["low", "medium", "high", "critical"]) {
        expect(() =>
          makeConfig(`
version: "1"
realm: test
wards:
  - id: valid-ward
    tool: "*"
    action: PASS
    message: Valid
    severity: ${severity}
`)
        ).not.toThrow();
      }
    });
  });
});
