import type { HeimdallSink, SinkConfig } from "./types.js";
import { StdoutSink } from "./stdout.js";
import { WebhookSink } from "./webhook.js";
import { OpenTelemetrySink } from "./opentelemetry.js";

/**
 * Create sink instances from bifrost.yaml sink configurations.
 */
export function createSinks(configs: SinkConfig[]): HeimdallSink[] {
  return configs.map((config) => {
    switch (config.type) {
      case "stdout":
        return new StdoutSink({
          events: config.events as string[] | undefined,
        });

      case "webhook":
        return new WebhookSink({
          url: config.url as string,
          headers: config.headers as Record<string, string> | undefined,
          events: config.events as string[] | undefined,
        });

      case "opentelemetry":
        return new OpenTelemetrySink({
          endpoint: config.endpoint as string,
          headers: config.headers as Record<string, string> | undefined,
          serviceName: config.serviceName as string | undefined,
          events: config.events as string[] | undefined,
        });

      default:
        throw new Error(`Unknown sink type: ${config.type}`);
    }
  });
}
