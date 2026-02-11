import type {
  BifrostConfig,
  ConditionPlugin,
  Ward,
  WardCondition,
  WardDecision,
  WardEvaluation,
  WardEvaluationStep,
  ToolCallContext,
} from "./types.js";

const ACTION_PRIORITY: Record<WardDecision, number> = {
  PASS: 0,
  RESHAPE: 1,
  HALT: 2,
};

/**
 * Returns the number of calls in the last `windowMs` for a given session+tool.
 * When toolName is "*", returns total calls across all tools for the session.
 */
export type RateLimitProvider = (
  sessionId: string,
  toolName: string,
  windowMs: number
) => number;

export interface WardEngineOptions {
  rateLimitProvider?: RateLimitProvider;
}

/**
 * In-memory sliding window rate limiter.
 * Suitable for long-lived processes (MCP proxy).
 */
export class InMemoryRateLimiter {
  private calls: Map<string, number[]> = new Map();
  private callCounter = 0;
  private readonly GC_INTERVAL = 100;
  private readonly MAX_AGE_MS = 120_000;

  call(sessionId: string, toolName: string): void {
    const key = `${sessionId}:${toolName}`;
    const globalKey = `${sessionId}:*`;
    const now = Date.now();

    for (const k of [key, globalKey]) {
      const timestamps = this.calls.get(k) ?? [];
      timestamps.push(now);
      this.calls.set(k, timestamps);
    }

    if (++this.callCounter % this.GC_INTERVAL === 0) {
      this.gc();
    }
  }

  /** Implement RateLimitProvider */
  getCallCount = (sessionId: string, toolName: string, windowMs: number): number => {
    const key = `${sessionId}:${toolName}`;
    const now = Date.now();
    const timestamps = this.calls.get(key) ?? [];
    const recent = timestamps.filter((t) => now - t < windowMs);
    this.calls.set(key, recent); // gc old entries
    return recent.length;
  };

  private gc(): void {
    const cutoff = Date.now() - this.MAX_AGE_MS;
    for (const [key, timestamps] of this.calls) {
      const recent = timestamps.filter((t) => t > cutoff);
      if (recent.length === 0) this.calls.delete(key);
      else this.calls.set(key, recent);
    }
  }
}

export class WardEngine {
  private config: BifrostConfig;
  private rateLimitProvider?: RateLimitProvider;
  private customConditions: Map<string, ConditionPlugin> = new Map();

  constructor(config: BifrostConfig, options?: WardEngineOptions) {
    this.config = config;
    this.rateLimitProvider = options?.rateLimitProvider;
  }

  registerCondition(plugin: ConditionPlugin): void {
    this.customConditions.set(plugin.name, plugin);
  }

  evaluate(ctx: ToolCallContext): WardEvaluation {
    const startTime = performance.now();
    const wardChain: WardEvaluationStep[] = [];
    let finalDecision: WardDecision = this.config.defaults?.action ?? "PASS";
    let finalRationale = "No wards matched; applying default action.";
    let matchedWards: string[] = [];
    let reshapedArguments: Record<string, unknown> | undefined;

    for (const ward of this.config.wards) {
      const toolMatches = this.toolMatches(ward.tool, ctx.tool_name);

      if (!toolMatches) {
        wardChain.push({
          ward_id: ward.id,
          matched: false,
          decision: ward.action,
          reason: `Tool pattern '${ward.tool}' did not match '${ctx.tool_name}'`,
        });
        continue;
      }

      const conditionMatches = this.conditionMatches(ward.when, ctx, ward.tool);

      if (!conditionMatches) {
        wardChain.push({
          ward_id: ward.id,
          matched: false,
          decision: ward.action,
          reason: `Tool matched but conditions did not apply`,
        });
        continue;
      }

      // Ward matched — record it
      wardChain.push({
        ward_id: ward.id,
        matched: true,
        decision: ward.action,
        reason: ward.message,
      });
      matchedWards.push(ward.id);

      // Apply action priority: most restrictive wins
      if (ACTION_PRIORITY[ward.action] > ACTION_PRIORITY[finalDecision]) {
        finalDecision = ward.action;
        finalRationale = ward.message;

        if (ward.action === "RESHAPE" && ward.reshape) {
          reshapedArguments = this.applyReshape(ctx.arguments, ward);
        }
      }
    }

    if (matchedWards.length > 0 && finalDecision === "PASS") {
      finalRationale = `${matchedWards.length} ward(s) matched with PASS decision.`;
    }

    const evaluationDuration = performance.now() - startTime;

    return {
      decision: finalDecision,
      matched_wards: matchedWards,
      ward_chain: wardChain,
      rationale: finalRationale,
      reshaped_arguments: reshapedArguments,
      evaluation_duration_ms: Math.round(evaluationDuration * 100) / 100,
    };
  }

  /** Convert glob pattern to regex and test against tool name */
  private toolMatches(pattern: string, toolName: string): boolean {
    if (pattern === "*") return true;
    // Convert glob to regex: * → .*, ? → .
    const regexStr =
      "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$";
    return new RegExp(regexStr, "i").test(toolName);
  }

  /** Check if all present conditions match (AND logic) */
  private conditionMatches(
    when: WardCondition | undefined,
    ctx: ToolCallContext,
    wardToolPattern?: string
  ): boolean {
    if (!when) return true;
    if (when.always) return true;

    if (when.argument_matches) {
      for (const [field, pattern] of Object.entries(when.argument_matches)) {
        // Fail-closed: if the field doesn't exist in arguments, the condition
        // does not match. This prevents security rules from being bypassed
        // when tool calls omit expected fields.
        if (!(field in ctx.arguments)) return false;
        const value = String(ctx.arguments[field]);
        if (!new RegExp(pattern, "i").test(value)) return false;
      }
    }

    if (when.argument_contains_pattern) {
      const serialized = JSON.stringify(ctx.arguments);
      if (!new RegExp(when.argument_contains_pattern, "i").test(serialized)) {
        return false;
      }
    }

    if (when.max_calls_per_minute != null) {
      // No provider = rate limit condition cannot be evaluated → doesn't match
      if (!this.rateLimitProvider) return false;
      // For wildcard wards, count all calls; for specific tools, count that tool
      const countTool = wardToolPattern === "*" ? "*" : ctx.tool_name;
      const count = this.rateLimitProvider(ctx.session_id, countTool, 60_000);
      if (count < when.max_calls_per_minute) return false;
    }

    // Check custom conditions
    const builtinKeys = new Set([
      "argument_matches",
      "argument_contains_pattern",
      "always",
      "max_calls_per_minute",
    ]);

    for (const [key, value] of Object.entries(when)) {
      if (builtinKeys.has(key)) continue;
      const plugin = this.customConditions.get(key);
      if (!plugin) return false; // Unknown condition → doesn't match
      if (!plugin.evaluate(value, ctx)) return false;
    }

    return true;
  }

  /** Apply RESHAPE: merge ward's reshape config over original args */
  private applyReshape(
    original: Record<string, unknown>,
    ward: Ward
  ): Record<string, unknown> {
    if (!ward.reshape) return original;

    const result = { ...original };

    for (const [key, value] of Object.entries(ward.reshape)) {
      if (typeof value === "string" && value === "__DELETE__") {
        delete result[key];
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
