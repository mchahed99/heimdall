import type { HeimdallSink, SinkConfig } from "./types.js";
import { StdoutSink } from "./stdout.js";
import { WebhookSink } from "./webhook.js";
import { OpenTelemetrySink } from "./opentelemetry.js";

/**
 * Create sink instances from bifrost.yaml sink configurations.
 */
const VALID_EVENTS = new Set(["PASS", "HALT", "RESHAPE"]);

function validateEvents(events: unknown): string[] | undefined {
  if (!events) return undefined;
  if (!Array.isArray(events)) {
    throw new Error(`Sink 'events' must be an array, got: ${typeof events}`);
  }
  const invalid = events.filter((e) => !VALID_EVENTS.has(e));
  if (invalid.length > 0) {
    throw new Error(
      `Sink has invalid events: ${invalid.join(", ")}. Must be PASS, HALT, or RESHAPE.`
    );
  }
  return events as string[];
}

export function createSinks(configs: SinkConfig[]): HeimdallSink[] {
  return configs.map((config) => {
    const events = validateEvents(config.events);

    switch (config.type) {
      case "stdout":
        return new StdoutSink({ events });

      case "webhook": {
        if (!config.url || typeof config.url !== "string") {
          throw new Error(
            `WebhookSink requires a 'url' string, got: ${typeof config.url}`
          );
        }
        return new WebhookSink({
          url: config.url,
          headers: config.headers as Record<string, string> | undefined,
          events,
        });
      }

      case "opentelemetry": {
        if (!config.endpoint || typeof config.endpoint !== "string") {
          throw new Error(
            `OpenTelemetrySink requires an 'endpoint' string, got: ${typeof config.endpoint}`
          );
        }
        return new OpenTelemetrySink({
          endpoint: config.endpoint,
          headers: config.headers as Record<string, string> | undefined,
          serviceName: config.serviceName as string | undefined,
          events,
        });
      }

      default:
        throw new Error(`Unknown sink type: ${config.type}`);
    }
  });
}
