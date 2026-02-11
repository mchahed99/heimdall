import { describe, expect, test } from "bun:test";
import { WardEngine } from "../src/ward-engine.js";
import { loadBifrostConfig } from "../src/yaml-loader.js";
import type { ConditionPlugin, ToolCallContext } from "../src/types.js";

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool_name: "Bash",
    arguments: { command: "echo hello" },
    session_id: "test-session",
    ...overrides,
  };
}

describe("Custom Conditions", () => {
  test("registerCondition adds a custom condition", () => {
    const config = loadBifrostConfig(`
version: "1"
realm: test
wards:
  - id: after-hours
    tool: "*"
    when:
      outside_business_hours: true
    action: HALT
    message: "Blocked outside business hours"
    severity: high
`);

    const plugin: ConditionPlugin = {
      name: "outside_business_hours",
      evaluate: (_value, _ctx) => {
        // Simulate: always "outside hours" for test
        return true;
      },
    };

    const engine = new WardEngine(config);
    engine.registerCondition(plugin);

    const result = engine.evaluate(makeCtx());
    expect(result.decision).toBe("HALT");
    expect(result.matched_wards).toContain("after-hours");
  });

  test("custom condition receives the config value", () => {
    const config = loadBifrostConfig(`
version: "1"
realm: test
wards:
  - id: custom-threshold
    tool: "*"
    when:
      cost_exceeds: 100
    action: HALT
    message: "Cost limit exceeded"
    severity: high
`);

    let receivedValue: unknown;
    const plugin: ConditionPlugin = {
      name: "cost_exceeds",
      evaluate: (value, _ctx) => {
        receivedValue = value;
        return true;
      },
    };

    const engine = new WardEngine(config);
    engine.registerCondition(plugin);
    engine.evaluate(makeCtx());

    expect(receivedValue).toBe(100);
  });

  test("unregistered custom condition is ignored (fail-open)", () => {
    const config = loadBifrostConfig(`
version: "1"
realm: test
wards:
  - id: unknown-cond
    tool: "*"
    when:
      some_unknown_condition: true
    action: HALT
    message: "Should not match"
    severity: high
`);

    const engine = new WardEngine(config);
    const result = engine.evaluate(makeCtx());
    // Unknown conditions should not match -> PASS
    expect(result.decision).toBe("PASS");
  });
});
