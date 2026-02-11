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
}

export interface VerificationResult {
  valid: boolean;
  total_runes: number;
  verified_runes: number;
  broken_at_sequence?: number;
  broken_reason?: string;
  verification_hash: string;
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
