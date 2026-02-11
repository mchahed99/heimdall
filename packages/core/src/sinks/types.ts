import type { Rune, WardEvaluation } from "../types.js";

/**
 * A sink receives rune events and forwards them to external systems.
 * Implement this to add new log drains (webhook, OTLP, S3, Kafka, etc.).
 */
export interface HeimdallSink {
  /** Human-readable name for diagnostics. */
  readonly name: string;

  /** Emit a rune event to the sink. */
  emit(rune: Rune): Promise<void>;

  /** Flush any buffered events. Called on graceful shutdown. */
  flush?(): Promise<void>;

  /** Release resources. */
  close?(): Promise<void>;
}

/** Configuration for a sink declared in bifrost.yaml. */
export interface SinkConfig {
  type: string;
  /** Only emit runes with these decisions. Empty = all. */
  events?: string[];
  [key: string]: unknown;
}
