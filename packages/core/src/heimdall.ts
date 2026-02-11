import { WardEngine } from "./ward-engine.js";
import type { RateLimitProvider } from "./ward-engine.js";
import { MemoryAdapter } from "./adapters/memory.js";
import type { RunechainAdapter } from "./adapters/types.js";
import type { HeimdallSink } from "./sinks/types.js";
import type {
  BifrostConfig,
  Rune,
  ToolCallContext,
  ChainStats,
  ChainVerificationResult,
} from "./types.js";

export interface HeimdallOptions {
  /** BifrostConfig object (already parsed). */
  config: BifrostConfig;
  /** Storage adapter — "memory" for built-in, or pass a RunechainAdapter instance. */
  adapter?: "memory" | RunechainAdapter;
  /** Sinks for log drain. */
  sinks?: HeimdallSink[];
  /** Custom rate limit provider. Defaults to adapter-backed. */
  rateLimitProvider?: RateLimitProvider;
}

export interface EvaluateInput {
  sessionId: string;
  tool: string;
  arguments: Record<string, unknown>;
  agentId?: string;
  serverId?: string;
}

export interface EvaluateResult {
  decision: string;
  rationale: string;
  matchedWards: string[];
  reshapedArguments?: Record<string, unknown>;
  rune: Rune;
  evaluationDurationMs: number;
}

/**
 * Heimdall SDK — the unified facade.
 *
 * ```typescript
 * const heimdall = new Heimdall({ config, adapter: "memory" });
 * const result = await heimdall.evaluate({ sessionId, tool, arguments });
 * if (result.decision === "HALT") { // blocked }
 * ```
 */
export class Heimdall {
  private engine: WardEngine;
  private adapter: RunechainAdapter;
  private sinks: HeimdallSink[];

  constructor(options: HeimdallOptions) {
    const adapter =
      options.adapter === "memory" || options.adapter === undefined
        ? new MemoryAdapter()
        : options.adapter;

    const rateLimitProvider =
      options.rateLimitProvider ??
      ((sessionId: string, toolName: string, windowMs: number) =>
        adapter.getRecentCallCount(sessionId, toolName, windowMs));

    this.engine = new WardEngine(options.config, { rateLimitProvider });
    this.adapter = adapter;
    this.sinks = options.sinks ?? [];
  }

  /** Evaluate a tool call against wards, inscribe a rune, and emit to sinks. */
  async evaluate(input: EvaluateInput): Promise<EvaluateResult> {
    const ctx: ToolCallContext = {
      tool_name: input.tool,
      arguments: input.arguments,
      session_id: input.sessionId,
      agent_id: input.agentId,
      server_id: input.serverId,
    };

    const evaluation = this.engine.evaluate(ctx);
    const rune = await this.adapter.inscribeRune(ctx, evaluation);

    // Emit to all sinks (fire-and-forget)
    await Promise.allSettled(this.sinks.map((sink) => sink.emit(rune)));

    return {
      decision: evaluation.decision,
      rationale: evaluation.rationale,
      matchedWards: evaluation.matched_wards,
      reshapedArguments: evaluation.reshaped_arguments,
      rune,
      evaluationDurationMs: evaluation.evaluation_duration_ms,
    };
  }

  /** Update the last rune with response data. */
  async recordResponse(responseSummary: string, durationMs?: number): Promise<Rune | null> {
    return this.adapter.updateLastRuneResponse(responseSummary, durationMs);
  }

  /** Get chain statistics. */
  getStats(): ChainStats {
    return this.adapter.getChainStats();
  }

  /** Verify chain integrity. */
  async verify(): Promise<ChainVerificationResult> {
    return this.adapter.verifyChain();
  }

  /** Get the underlying adapter (for advanced use). */
  getAdapter(): RunechainAdapter {
    return this.adapter;
  }

  /** Gracefully close all resources. */
  close(): void {
    this.adapter.close();
    Promise.allSettled(
      this.sinks
        .filter((s) => s.close)
        .map((s) => s.close!())
    );
  }
}
