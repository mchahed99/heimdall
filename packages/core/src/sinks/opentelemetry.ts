import type { HeimdallSink } from "./types.js";
import type { Rune } from "../types.js";

export interface OpenTelemetrySinkOptions {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
  events?: string[];
  fetchFn?: typeof fetch;
}

/**
 * Exports runes as OTLP spans via HTTP/JSON.
 * Zero-dependency -- implements OTLP protocol directly.
 * Compatible with any OTLP collector (Datadog, Grafana, Honeycomb, etc.).
 */
export class OpenTelemetrySink implements HeimdallSink {
  readonly name = "opentelemetry";
  private endpoint: string;
  private headers: Record<string, string>;
  private serviceName: string;
  private events?: Set<string>;
  private fetchFn: typeof fetch;

  constructor(options: OpenTelemetrySinkOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.headers = options.headers ?? {};
    this.serviceName = options.serviceName ?? "heimdall";
    this.events = options.events ? new Set(options.events) : undefined;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async emit(rune: Rune): Promise<void> {
    if (this.events && !this.events.has(rune.decision)) return;

    const startNano = BigInt(new Date(rune.timestamp).getTime()) * 1_000_000n;
    const durationNano = BigInt(rune.duration_ms ?? 0) * 1_000_000n;
    const endNano = startNano + durationNano;

    // Generate a trace ID and span ID from rune data
    const traceId = rune.content_hash.slice(0, 32);
    const spanId = rune.content_hash.slice(0, 16);

    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: this.serviceName } },
              { key: "heimdall.realm", value: { stringValue: "default" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "heimdall", version: "0.1.0" },
              spans: [
                {
                  traceId,
                  spanId,
                  name: `heimdall.${rune.decision.toLowerCase()}.${rune.tool_name}`,
                  kind: 1, // SPAN_KIND_INTERNAL
                  startTimeUnixNano: startNano.toString(),
                  endTimeUnixNano: endNano.toString(),
                  attributes: [
                    { key: "heimdall.tool_name", value: { stringValue: rune.tool_name } },
                    { key: "heimdall.decision", value: { stringValue: rune.decision } },
                    { key: "heimdall.rationale", value: { stringValue: rune.rationale } },
                    { key: "heimdall.session_id", value: { stringValue: rune.session_id } },
                    { key: "heimdall.sequence", value: { intValue: rune.sequence.toString() } },
                    { key: "heimdall.content_hash", value: { stringValue: rune.content_hash } },
                    { key: "heimdall.matched_wards", value: { stringValue: JSON.stringify(rune.matched_wards) } },
                  ],
                  status: {
                    code: rune.decision === "HALT" ? 2 : 1, // ERROR or OK
                    message: rune.decision === "HALT" ? rune.rationale : "",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      await this.fetchFn(`${this.endpoint}/v1/traces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(`[heimdall] otel sink error: ${err}`);
    }
  }
}
