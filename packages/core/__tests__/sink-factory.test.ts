import { describe, expect, test } from "bun:test";
import { createSinks } from "../src/sinks/factory.js";
import { StdoutSink } from "../src/sinks/stdout.js";
import { WebhookSink } from "../src/sinks/webhook.js";
import { OpenTelemetrySink } from "../src/sinks/opentelemetry.js";
import type { SinkConfig } from "../src/sinks/types.js";

describe("createSinks factory", () => {
  test("creates StdoutSink from config", () => {
    const configs: SinkConfig[] = [{ type: "stdout" }];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("stdout");
  });

  test("creates WebhookSink from config", () => {
    const configs: SinkConfig[] = [
      { type: "webhook", url: "https://example.com/hook" },
    ];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("webhook");
  });

  test("creates OpenTelemetrySink from config", () => {
    const configs: SinkConfig[] = [
      { type: "opentelemetry", endpoint: "http://localhost:4318" },
    ];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("opentelemetry");
  });

  test("creates multiple sinks", () => {
    const configs: SinkConfig[] = [
      { type: "stdout" },
      { type: "webhook", url: "https://example.com" },
    ];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(2);
  });

  test("throws on unknown sink type", () => {
    const configs: SinkConfig[] = [{ type: "unknown" }];
    expect(() => createSinks(configs)).toThrow("Unknown sink type: unknown");
  });

  test("empty array returns empty", () => {
    const sinks = createSinks([]);
    expect(sinks).toHaveLength(0);
  });

  test("throws when webhook missing url", () => {
    expect(() => createSinks([{ type: "webhook" }])).toThrow(
      "WebhookSink requires a 'url' string"
    );
  });

  test("throws when opentelemetry missing endpoint", () => {
    expect(() => createSinks([{ type: "opentelemetry" }])).toThrow(
      "OpenTelemetrySink requires an 'endpoint' string"
    );
  });

  test("throws on invalid events filter", () => {
    expect(() =>
      createSinks([{ type: "stdout", events: ["INVALID"] }])
    ).toThrow("invalid events: INVALID");
  });

  test("accepts valid events filter", () => {
    const sinks = createSinks([
      { type: "stdout", events: ["HALT", "RESHAPE"] },
    ]);
    expect(sinks).toHaveLength(1);
  });
});
