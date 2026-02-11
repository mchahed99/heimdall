// === Ward (Policy) Types ===

export type WardDecision = "PASS" | "HALT" | "RESHAPE";

export type WardSeverity = "low" | "medium" | "high" | "critical";

export interface WardCondition {
  /** Regex patterns matched against specific argument fields */
  argument_matches?: Record<string, string>;
  /** Regex pattern matched against serialized arguments JSON */
  argument_contains_pattern?: string;
  /** Unconditional match */
  always?: boolean;
  /**
   * Rate limit: max tool calls per minute for this session+tool combo.
   * Inspired by Omega's numCalls() predicate (arxiv:2512.05951) —
   * reduces multi-tool-invocation attacks from 90% to 0%.
   */
  max_calls_per_minute?: number;
}

export interface Ward {
  id: string;
  description?: string;
  /** Glob pattern for tool matching ("Bash", "file_*", "*") */
  tool: string;
  /** Conditions for this ward to trigger. Omit = always match. */
  when?: WardCondition;
  action: WardDecision;
  message: string;
  severity: WardSeverity;
  /** Argument transformations for RESHAPE action */
  reshape?: Record<string, unknown>;
}

export interface BifrostConfig {
  version: string;
  realm: string;
  description?: string;
  wards: Ward[];
  defaults?: {
    action?: WardDecision;
    severity?: WardSeverity;
  };
}

// === Evaluation Types ===

export interface WardEvaluationStep {
  ward_id: string;
  matched: boolean;
  decision: WardDecision;
  reason: string;
}

export interface WardEvaluation {
  decision: WardDecision;
  matched_wards: string[];
  ward_chain: WardEvaluationStep[];
  rationale: string;
  reshaped_arguments?: Record<string, unknown>;
  evaluation_duration_ms: number;
}

export interface ToolCallContext {
  tool_name: string;
  arguments: Record<string, unknown>;
  session_id: string;
  agent_id?: string;
  server_id?: string;
}

// === Rune (Audit Record) Types ===

export interface Rune {
  sequence: number;
  timestamp: string;
  session_id: string;
  tool_name: string;
  /** SHA-256 hash of the arguments (privacy-preserving) */
  arguments_hash: string;
  /** Truncated human-readable summary of arguments */
  arguments_summary: string;
  decision: WardDecision;
  matched_wards: string[];
  ward_chain: WardEvaluationStep[];
  rationale: string;
  response_summary?: string;
  duration_ms?: number;
  /** SHA-256 hash of this rune's content */
  content_hash: string;
  /** Hash linking to the previous rune ("GENESIS" for first) */
  previous_hash: string;
  is_genesis: boolean;
}

export interface RuneFilters {
  session_id?: string;
  tool_name?: string;
  decision?: WardDecision;
  limit?: number;
  offset?: number;
}

export interface ChainStats {
  total_runes: number;
  sessions: number;
  unique_tools: number;
  decisions: Record<WardDecision, number>;
  first_rune_timestamp?: string;
  last_rune_timestamp?: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  total_runes: number;
  verified_runes: number;
  broken_at_sequence?: number;
  broken_reason?: string;
  /** Hash of the verification result itself (provenance) */
  verification_hash: string;
  stats: ChainStats;
}
