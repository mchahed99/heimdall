import { WardEngine, loadBifrostConfig } from "@heimdall/core";
import type { BifrostConfig, ToolCallContext, WardDecision } from "@heimdall/core";

export interface PolicyTestResults {
  passed: number;
  failed: number;
  total: number;
  failures: string[];
}

interface Assertion {
  toolName: string;
  args: Record<string, unknown>;
  toBeHalted: () => void;
  toPass: () => void;
  toBeReshaped: () => void;
}

class PolicyTestContext {
  private engine: WardEngine;
  private results: PolicyTestResults = { passed: 0, failed: 0, total: 0, failures: [] };

  constructor(config: BifrostConfig) {
    this.engine = new WardEngine(config);
  }

  expect(toolName: string, args: Record<string, unknown>): Assertion {
    const ctx: ToolCallContext = {
      tool_name: toolName,
      arguments: args,
      session_id: "test",
    };
    const evaluation = this.engine.evaluate(ctx);

    const assert = (expected: WardDecision) => {
      this.results.total++;
      if (evaluation.decision === expected) {
        this.results.passed++;
      } else {
        this.results.failed++;
        this.results.failures.push(
          `${toolName}(${JSON.stringify(args)}): expected ${expected}, got ${evaluation.decision}`
        );
      }
    };

    return {
      toolName,
      args,
      toBeHalted: () => assert("HALT"),
      toPass: () => assert("PASS"),
      toBeReshaped: () => assert("RESHAPE"),
    };
  }

  getResults(): PolicyTestResults {
    return this.results;
  }
}

/**
 * Test a policy against expected tool call decisions.
 *
 * ```typescript
 * const results = testPolicy(yamlContent, (t) => {
 *   t.expect("Bash", { command: "rm -rf /" }).toBeHalted();
 *   t.expect("Read", { path: "./file.ts" }).toPass();
 * });
 * ```
 */
export function testPolicy(
  yamlOrConfig: string | BifrostConfig,
  fn: (t: PolicyTestContext) => void
): PolicyTestResults {
  const config =
    typeof yamlOrConfig === "string"
      ? loadBifrostConfig(yamlOrConfig)
      : yamlOrConfig;

  const ctx = new PolicyTestContext(config);
  fn(ctx);
  return ctx.getResults();
}
