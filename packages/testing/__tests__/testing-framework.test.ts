import { describe, expect, test } from "bun:test";
import { testPolicy } from "../src/index.js";

describe("testPolicy DSL", () => {
  test("toBeHalted assertion works", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards:
  - id: block-rm
    tool: Bash
    when:
      argument_matches:
        command: "rm -rf"
    action: HALT
    message: Blocked
    severity: critical
`, (t) => {
      t.expect("Bash", { command: "rm -rf /" }).toBeHalted();
    });

    expect(results.passed).toBe(1);
    expect(results.failed).toBe(0);
  });

  test("toPass assertion works", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards: []
`, (t) => {
      t.expect("Bash", { command: "echo hello" }).toPass();
    });

    expect(results.passed).toBe(1);
    expect(results.failed).toBe(0);
  });

  test("failed assertion is recorded", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards: []
`, (t) => {
      t.expect("Bash", { command: "echo hello" }).toBeHalted();
    });

    expect(results.passed).toBe(0);
    expect(results.failed).toBe(1);
    expect(results.failures[0]).toContain("expected HALT");
  });

  test("toBeReshaped assertion works", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards:
  - id: reshape-bash
    tool: Bash
    action: RESHAPE
    message: Reshaped
    severity: medium
    reshape:
      safe: true
`, (t) => {
      t.expect("Bash", { command: "deploy" }).toBeReshaped();
    });

    expect(results.passed).toBe(1);
  });

  test("multiple assertions in one policy", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards:
  - id: block-rm
    tool: Bash
    when:
      argument_matches:
        command: "rm -rf"
    action: HALT
    message: Blocked
    severity: critical
`, (t) => {
      t.expect("Bash", { command: "rm -rf /" }).toBeHalted();
      t.expect("Bash", { command: "echo hello" }).toPass();
      t.expect("Read", { path: "./file.ts" }).toPass();
    });

    expect(results.passed).toBe(3);
    expect(results.failed).toBe(0);
  });
});
