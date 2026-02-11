/**
 * Heimdall + LangChain Integration Example
 *
 * Uses the Heimdall SDK as a LangChain callback handler to audit
 * all tool calls made by a LangChain agent.
 *
 * Usage:
 *   import { HeimdallCallbackHandler } from "./langchain.js";
 *   const heimdall = new Heimdall({ config, adapter: "memory" });
 *   const handler = new HeimdallCallbackHandler(heimdall);
 *   // Pass handler to your LangChain agent callbacks
 */

import { Heimdall } from "@heimdall/core";
import type { EvaluateResult } from "@heimdall/core";

export class HeimdallCallbackHandler {
  private heimdall: Heimdall;

  constructor(heimdall: Heimdall) {
    this.heimdall = heimdall;
  }

  async handleToolStart(
    tool: { name: string },
    input: string,
    runId: string
  ): Promise<EvaluateResult> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(input);
    } catch {
      args = { input };
    }

    return this.heimdall.evaluate({
      sessionId: runId,
      tool: tool.name,
      arguments: args,
    });
  }

  async handleToolEnd(output: string): Promise<void> {
    await this.heimdall.recordResponse(output.slice(0, 200));
  }
}
