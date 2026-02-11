/**
 * Heimdall + Vercel AI SDK Integration Example
 *
 * Wraps Vercel AI SDK tool calls with Heimdall policy enforcement.
 *
 * Usage:
 *   import { withHeimdall } from "./vercel-ai.js";
 *   const heimdall = new Heimdall({ config, adapter: "memory" });
 *   const protectedTool = withHeimdall(heimdall, "myTool", myToolFn);
 */

import { Heimdall } from "@heimdall/core";

export function withHeimdall<T extends (...args: unknown[]) => unknown>(
  heimdall: Heimdall,
  toolName: string,
  toolFn: T,
  sessionId?: string
): T {
  return (async (...args: unknown[]) => {
    const toolArgs = (args[0] as Record<string, unknown>) ?? {};
    const result = await heimdall.evaluate({
      sessionId: sessionId ?? crypto.randomUUID(),
      tool: toolName,
      arguments: toolArgs,
    });

    if (result.decision === "HALT") {
      throw new Error(`[HEIMDALL] Tool call blocked: ${result.rationale}`);
    }

    const effectiveArgs = result.reshapedArguments ?? toolArgs;
    const startTime = performance.now();
    const output = await toolFn(effectiveArgs, ...args.slice(1));
    const duration = Math.round(performance.now() - startTime);

    await heimdall.recordResponse(
      JSON.stringify(output).slice(0, 200),
      duration
    );

    return output;
  }) as T;
}
