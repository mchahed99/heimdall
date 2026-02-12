// === Policy Generator Types ===

export interface CollectFilesOptions {
  path: string;
  include?: string[];
  exclude?: string[];
}

export interface CollectedFile {
  relativePath: string;
  content: string;
  sizeBytes: number;
}

export interface GenerateOptions {
  path: string;
  output: string;
  realm?: string;
  model?: string;
  include?: string[];
  exclude?: string[];
}

export interface ExtractResult {
  yaml: string;
  hadFences: boolean;
}

// === Red-Team Types ===

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface RedTeamFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  affected_tool?: string;
  affected_ward?: string;
  recommendation: string;
  agent: string;
  /** The actual payload that bypassed the policy (if verified) */
  bypass_payload?: string;
  /** The ward decision for the bypass payload */
  ward_decision?: string;
}

export interface RedTeamSummary {
  total_findings: number;
  by_severity: Record<FindingSeverity, number>;
  agents_completed: number;
  agents_failed: number;
}

export interface RedTeamReport {
  summary: RedTeamSummary;
  findings: RedTeamFinding[];
  timestamp: string;
  config_realm: string;
  total_payloads_tested?: number;
  total_bypasses?: number;
}

export interface RedTeamOptions {
  config: string;
  output?: string;
  format: "markdown" | "json";
  model?: string;
}

export type RedTeamAgentRole = "injection" | "exfiltration" | "privilege" | "compliance";

// === Adaptive Thinking Types ===

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskAssessment {
  score: number;
  tier: RiskTier;
  factors: string[];
}

export interface ThinkingAnalysis {
  risk_score: number;
  risk_tier: RiskTier;
  reasoning: string;
  recommendation: string;
  thinking_tokens_used: number;
}

export interface AnalyzeOptions {
  tool_name: string;
  arguments_hash: string;
  arguments_summary: string;
  decision: string;
  matched_wards: string[];
  rationale: string;
}
