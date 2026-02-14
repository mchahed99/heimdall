export interface WardEvaluationStep {
  ward_id: string;
  matched: boolean;
  decision: string;
  reason: string;
}

export interface Rune {
  sequence: number;
  timestamp: string;
  session_id: string;
  tool_name: string;
  arguments_hash: string;
  arguments_summary: string;
  decision: "PASS" | "HALT" | "RESHAPE";
  matched_wards: string[];
  ward_chain: WardEvaluationStep[];
  rationale: string;
  response_summary?: string;
  duration_ms?: number;
  content_hash: string;
  previous_hash: string;
  is_genesis: boolean;
  signature?: string;
  risk_score?: number;
  risk_tier?: string;
  ai_reasoning?: string;
}

export interface VerificationResult {
  valid: boolean;
  total_runes: number;
  verified_runes: number;
  broken_at_sequence?: number;
  broken_reason?: string;
  verification_hash: string;
  signatures_verified?: number;
  signatures_missing?: number;
  stats: {
    total_runes: number;
    sessions: number;
    unique_tools: number;
    decisions: Record<string, number>;
    first_rune_timestamp?: string;
    last_rune_timestamp?: string;
  };
}

export interface Filters {
  decision?: string;
  tool_name?: string;
  session_id?: string;
}

export interface DriftChange {
  type: "added" | "removed" | "modified";
  tool_name: string;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
}

export interface DriftAlert {
  server_id: string;
  timestamp: string;
  changes: DriftChange[];
  previous_hash: string;
  current_hash: string;
  action_taken: string;
}
