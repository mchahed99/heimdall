import { describe, expect, test } from "bun:test";
import { WebhookSink } from "../src/sinks/webhook.js";
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

describe("WebhookSink", () => {
  test("has correct name", () => {
    const sink = new WebhookSink({ url: "https://example.com/hook" });
    expect(sink.name).toBe("webhook");
  });

  test("sends POST with rune JSON body", async () => {
    let capturedRequest: { url: string; body: string; headers: Record<string, string> } | null = null;

    const sink = new WebhookSink({
      url: "https://example.com/hook",
      fetchFn: async (url, init) => {
        capturedRequest = {
          url: url as string,
          body: init?.body as string,
          headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()),
        };
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe("https://example.com/hook");
    expect(capturedRequest!.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(capturedRequest!.body);
    expect(body.tool_name).toBe("Bash");
    expect(body.decision).toBe("HALT");
  });

  test("includes custom headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const sink = new WebhookSink({
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer token123" },
      fetchFn: async (_url, init) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());
    expect(capturedHeaders["authorization"]).toBe("Bearer token123");
  });

  test("filters by decision", async () => {
    let callCount = 0;

    const sink = new WebhookSink({
      url: "https://example.com/hook",
      events: ["HALT"],
      fetchFn: async () => {
        callCount++;
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune({ decision: "PASS" }));
    expect(callCount).toBe(0);

    await sink.emit(makeRune({ decision: "HALT" }));
    expect(callCount).toBe(1);
  });

  test("does not throw on fetch failure", async () => {
    const sink = new WebhookSink({
      url: "https://example.com/hook",
      fetchFn: async () => {
        throw new Error("Network error");
      },
    });

    // Should not throw -- sinks should be fire-and-forget
    await expect(sink.emit(makeRune())).resolves.toBeUndefined();
  });
});
