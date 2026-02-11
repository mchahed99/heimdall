import { describe, expect, test } from "bun:test";
import { OpenTelemetrySink } from "../src/sinks/opentelemetry.js";
import type { Rune } from "../src/types.js";

function makeRune(overrides: Partial<Rune> = {}): Rune {
  return {
    sequence: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
    session_id: "test-session",
    tool_name: "Bash",
    arguments_hash: "abc123",
    arguments_summary: '{"command":"echo hi"}',
    decision: "HALT",
    matched_wards: ["block-bash"],
    ward_chain: [],
    rationale: "Bash blocked",
    content_hash: "def456",
    previous_hash: "GENESIS",
    is_genesis: true,
    ...overrides,
  };
}

describe("OpenTelemetrySink", () => {
  test("has correct name", () => {
    const sink = new OpenTelemetrySink({ endpoint: "http://localhost:4318" });
    expect(sink.name).toBe("opentelemetry");
  });

  test("sends OTLP JSON to endpoint", async () => {
    let capturedBody: unknown = null;

    const sink = new OpenTelemetrySink({
      endpoint: "http://localhost:4318",
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as { resourceSpans: unknown[] };
    expect(body.resourceSpans).toBeDefined();
    expect(body.resourceSpans).toHaveLength(1);
  });

  test("includes custom headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const sink = new OpenTelemetrySink({
      endpoint: "http://localhost:4318",
      headers: { "api-key": "secret" },
      fetchFn: async (_url, init) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());
    expect(capturedHeaders["api-key"]).toBe("secret");
  });

  test("does not throw on failure", async () => {
    const sink = new OpenTelemetrySink({
      endpoint: "http://localhost:4318",
      fetchFn: async () => { throw new Error("Network error"); },
    });

    await expect(sink.emit(makeRune())).resolves.toBeUndefined();
  });
});
