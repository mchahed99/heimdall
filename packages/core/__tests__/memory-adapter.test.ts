import { describe, expect, test } from "bun:test";
import { MemoryAdapter } from "../src/adapters/memory.js";
import type { ToolCallContext, WardEvaluation } from "../src/types.js";

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool_name: "Bash",
    arguments: { command: "echo hello" },
    session_id: "test-session",
    ...overrides,
  };
}

function makeEval(overrides: Partial<WardEvaluation> = {}): WardEvaluation {
  return {
    decision: "PASS",
    matched_wards: [],
    ward_chain: [],
    rationale: "Default pass",
    evaluation_duration_ms: 0.5,
    ...overrides,
  };
}

describe("MemoryAdapter", () => {
  test("inscribes genesis rune", async () => {
    const adapter = new MemoryAdapter();
    const rune = await adapter.inscribeRune(makeCtx(), makeEval());
    expect(rune.sequence).toBe(1);
    expect(rune.previous_hash).toBe("GENESIS");
    expect(rune.is_genesis).toBe(true);
    expect(rune.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("chains runes correctly", async () => {
    const adapter = new MemoryAdapter();
    const r1 = await adapter.inscribeRune(makeCtx(), makeEval());
    const r2 = await adapter.inscribeRune(makeCtx(), makeEval());
    expect(r2.previous_hash).toBe(r1.content_hash);
    expect(r2.sequence).toBe(2);
  });

  test("verifyChain passes for valid chain", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx(), makeEval());
    await adapter.inscribeRune(makeCtx(), makeEval());
    const result = await adapter.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.total_runes).toBe(2);
  });

  test("getRunes with filters", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash" }), makeEval({ decision: "HALT" }));
    await adapter.inscribeRune(makeCtx({ tool_name: "Read" }), makeEval({ decision: "PASS" }));

    const haltRunes = adapter.getRunes({ decision: "HALT" });
    expect(haltRunes).toHaveLength(1);
    expect(haltRunes[0].tool_name).toBe("Bash");
  });

  test("getRecentCallCount for rate limiting", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash", session_id: "s1" }), makeEval());
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash", session_id: "s1" }), makeEval());
    await adapter.inscribeRune(makeCtx({ tool_name: "Read", session_id: "s1" }), makeEval());

    expect(adapter.getRecentCallCount("s1", "Bash", 60_000)).toBe(2);
    expect(adapter.getRecentCallCount("s1", "*", 60_000)).toBe(3);
  });

  test("getChainStats", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash", session_id: "s1" }), makeEval({ decision: "PASS" }));
    await adapter.inscribeRune(makeCtx({ tool_name: "Read", session_id: "s2" }), makeEval({ decision: "HALT" }));

    const stats = adapter.getChainStats();
    expect(stats.total_runes).toBe(2);
    expect(stats.sessions).toBe(2);
    expect(stats.unique_tools).toBe(2);
    expect(stats.decisions.PASS).toBe(1);
    expect(stats.decisions.HALT).toBe(1);
  });

  test("close is a no-op", () => {
    const adapter = new MemoryAdapter();
    expect(() => adapter.close()).not.toThrow();
  });
});
