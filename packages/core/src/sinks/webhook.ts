import type { HeimdallSink } from "./types.js";
import type { Rune } from "../types.js";

export interface WebhookSinkOptions {
  url: string;
  headers?: Record<string, string>;
  events?: string[];
  /** Override fetch for testing. */
  fetchFn?: typeof fetch;
}

/**
 * Sends rune events as POST requests to a webhook URL.
 * Fire-and-forget -- errors are logged to stderr, never thrown.
 */
export class WebhookSink implements HeimdallSink {
  readonly name = "webhook";
  private url: string;
  private headers: Record<string, string>;
  private events?: Set<string>;
  private fetchFn: typeof fetch;

  constructor(options: WebhookSinkOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.events = options.events ? new Set(options.events) : undefined;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async emit(rune: Rune): Promise<void> {
    if (this.events && !this.events.has(rune.decision)) return;

    try {
      await this.fetchFn(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(rune),
      });
    } catch (err) {
      console.error(`[heimdall] webhook sink error: ${err}`);
    }
  }
}
