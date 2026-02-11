import type {
  BifrostConfig,
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

export class WardEngine {
  private config: BifrostConfig;

  constructor(config: BifrostConfig) {
    this.config = config;
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

      const conditionMatches = this.conditionMatches(ward.when, ctx);

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
    ctx: ToolCallContext
  ): boolean {
    if (!when) return true;
    if (when.always) return true;

    if (when.argument_matches) {
      for (const [field, pattern] of Object.entries(when.argument_matches)) {
        const value = String(ctx.arguments[field] ?? "");
        if (!new RegExp(pattern, "i").test(value)) return false;
      }
    }

    if (when.argument_contains_pattern) {
      const serialized = JSON.stringify(ctx.arguments);
      if (!new RegExp(when.argument_contains_pattern).test(serialized)) {
        return false;
      }
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
