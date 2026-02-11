import type { HeimdallSink } from "./types.js";
import type { Rune } from "../types.js";

export interface StdoutSinkOptions {
  /** Override write function (default: process.stderr -- stdout is reserved for MCP). */
  writeFn?: (line: string) => void;
  /** Only emit runes with these decisions. */
  events?: string[];
}

/**
 * Emits runes as JSON lines to stderr (or a custom write function).
 * Useful for piping to jq, fluentd, vector, etc.
 */
export class StdoutSink implements HeimdallSink {
  readonly name = "stdout";
  private writeFn: (line: string) => void;
  private events?: Set<string>;

  constructor(options?: StdoutSinkOptions) {
    this.writeFn = options?.writeFn ?? ((line) => process.stderr.write(line + "\n"));
    this.events = options?.events ? new Set(options.events) : undefined;
  }

  async emit(rune: Rune): Promise<void> {
    if (this.events && !this.events.has(rune.decision)) return;
    this.writeFn(JSON.stringify(rune));
  }
}
