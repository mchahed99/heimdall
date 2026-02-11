export type { HeimdallSink, SinkConfig } from "./types.js";
export { StdoutSink } from "./stdout.js";
export { WebhookSink } from "./webhook.js";
export { OpenTelemetrySink } from "./opentelemetry.js";
export { createSinks } from "./factory.js";
