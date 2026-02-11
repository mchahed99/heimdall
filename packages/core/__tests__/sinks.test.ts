import { describe, expect, test } from "bun:test";
import { StdoutSink } from "../src/sinks/stdout.js";
import type { Rune } from "../src/types.js";

function makeRune(overrides: Partial<Rune> = {}): Rune {
  return {
    sequence: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
    session_id: "test-session",
    tool_name: "Bash",
    arguments_hash: "abc123",
    arguments_summary: '{"command":"echo hi"}',
    decision: "PASS",
    matched_wards: [],
    ward_chain: [],
    rationale: "Default pass",
    content_hash: "def456",
    previous_hash: "GENESIS",
    is_genesis: true,
    ...overrides,
  };
}

describe("StdoutSink", () => {
  test("has correct name", () => {
    const sink = new StdoutSink();
    expect(sink.name).toBe("stdout");
  });

  test("emits JSON to provided write function", async () => {
    const lines: string[] = [];
    const sink = new StdoutSink({ writeFn: (line) => lines.push(line) });

    await sink.emit(makeRune());

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.decision).toBe("PASS");
  });

  test("filters by decision when events are specified", async () => {
    const lines: string[] = [];
    const sink = new StdoutSink({
      writeFn: (line) => lines.push(line),
      events: ["HALT"],
    });

    await sink.emit(makeRune({ decision: "PASS" }));
    expect(lines).toHaveLength(0);

    await sink.emit(makeRune({ decision: "HALT" }));
    expect(lines).toHaveLength(1);
  });
});
