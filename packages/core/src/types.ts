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
  /** Allow custom condition keys from plugins. */
  [key: string]: unknown;
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

export interface SinkConfig {
  type: string;
  events?: string[];
  [key: string]: unknown;
}

export interface StorageConfig {
  adapter: string;
  [key: string]: unknown;
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
  sinks?: SinkConfig[];
  storage?: StorageConfig;
  extends?: string[];
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

/** Plugin for custom ward conditions. */
export interface ConditionPlugin {
  /** The condition name as used in bifrost.yaml `when:` blocks. */
  name: string;
  /** Evaluate the condition. Returns true if the condition matches. */
  evaluate: (value: unknown, ctx: ToolCallContext) => boolean;
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
  /** Ed25519 signature of content_hash (base64) */
  signature?: string;
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
  /** Number of runes with valid Ed25519 signatures */
  signatures_verified?: number;
  /** Number of runes without signatures (legacy/unsigned) */
  signatures_missing?: number;
}

/** Self-contained, independently verifiable proof of a tool-call decision */
export interface SignedReceipt {
  version: string;
  rune: {
    sequence: number;
    timestamp: string;
    tool_name: string;
    decision: WardDecision;
    rationale: string;
    matched_wards: string[];
    arguments_hash: string;
    content_hash: string;
    previous_hash: string;
    is_genesis: boolean;
  };
  chain_position: {
    chain_length: number;
  };
  signature: string;
  public_key: string;
}
