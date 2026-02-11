import { describe, expect, test } from "bun:test";
import { Heimdall } from "../src/heimdall.js";
import type { HeimdallSink } from "../src/sinks/types.js";
import type { Rune } from "../src/types.js";

describe("Heimdall SDK", () => {
  test("evaluate + record flow with memory adapter", async () => {
    const heimdall = new Heimdall({
      config: {
        version: "1",
        realm: "test",
        wards: [
          {
            id: "block-rm",
            tool: "Bash",
            when: { argument_matches: { command: "rm -rf" } },
            action: "HALT",
            message: "Destructive command blocked",
            severity: "critical",
          },
        ],
      },
      adapter: "memory",
    });

    const result = await heimdall.evaluate({
      sessionId: "s1",
      tool: "Bash",
      arguments: { command: "rm -rf /" },
    });

    expect(result.decision).toBe("HALT");
    expect(result.rationale).toContain("Destructive");
    expect(result.rune.content_hash).toMatch(/^[0-9a-f]{64}$/);

    heimdall.close();
  });

  test("PASS decision works", async () => {
    const heimdall = new Heimdall({
      config: {
        version: "1",
        realm: "test",
        wards: [],
      },
      adapter: "memory",
    });

    const result = await heimdall.evaluate({
      sessionId: "s1",
      tool: "Read",
      arguments: { path: "./src/index.ts" },
    });

    expect(result.decision).toBe("PASS");
    heimdall.close();
  });

  test("sinks receive emitted runes", async () => {
    const emitted: Rune[] = [];
    const testSink: HeimdallSink = {
      name: "test",
      emit: async (rune) => { emitted.push(rune); },
    };

    const heimdall = new Heimdall({
      config: { version: "1", realm: "test", wards: [] },
      adapter: "memory",
      sinks: [testSink],
    });

    await heimdall.evaluate({
      sessionId: "s1",
      tool: "Bash",
      arguments: { command: "echo hello" },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].tool_name).toBe("Bash");
    heimdall.close();
  });

  test("getStats returns chain stats", async () => {
    const heimdall = new Heimdall({
      config: { version: "1", realm: "test", wards: [] },
      adapter: "memory",
    });

    await heimdall.evaluate({ sessionId: "s1", tool: "Bash", arguments: {} });
    await heimdall.evaluate({ sessionId: "s1", tool: "Read", arguments: {} });

    const stats = heimdall.getStats();
    expect(stats.total_runes).toBe(2);
    expect(stats.unique_tools).toBe(2);
    heimdall.close();
  });

  test("verify returns chain verification", async () => {
    const heimdall = new Heimdall({
      config: { version: "1", realm: "test", wards: [] },
      adapter: "memory",
    });

    await heimdall.evaluate({ sessionId: "s1", tool: "Bash", arguments: {} });

    const result = await heimdall.verify();
    expect(result.valid).toBe(true);
    expect(result.total_runes).toBe(1);
    heimdall.close();
  });
});
