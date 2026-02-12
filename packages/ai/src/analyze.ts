import type {
  RiskAssessment,
  RiskTier,
  ThinkingAnalysis,
  AnalyzeOptions,
} from "./types.js";
import { getClient } from "./client.js";
import { ANALYZE_SYSTEM_PROMPT } from "./prompts/analyze-system.js";

// Tool risk tiers (base scores)
const HIGH_RISK_TOOLS = new Set(["Bash", "Shell", "Execute", "RunCommand"]);
const MEDIUM_RISK_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "WebFetch"]);

// Patterns that indicate credential exposure
const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /gho_[a-zA-Z0-9]{36}/,
  /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[bpas]-[a-zA-Z0-9-]+/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN [A-Z]+ PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[\s]*[=:]/i,
  /Bearer\s+[a-zA-Z0-9._-]+/,
];

// Patterns that indicate PII
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // Credit card
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
];

// Patterns that indicate network/exfiltration activity
const NETWORK_PATTERNS = [
  /\b(curl|wget|nc|ncat|netcat|ssh|scp|rsync|ftp)\b/i,
  /https?:\/\/[^\s]+/i,
  /\b(dig|nslookup|host)\b/i,
];

// Patterns that indicate destructive operations
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i,
  /\bmkfs\b/,
  /\bdd\s+if=/,
];

/**
 * Compute a risk score (0-100) for a tool call. Pure function, no API calls.
 */
export function computeRiskScore(options: AnalyzeOptions): RiskAssessment {
  let score = 0;
  const factors: string[] = [];

  // Factor 1: Tool risk level (0-40)
  if (HIGH_RISK_TOOLS.has(options.tool_name)) {
    score += 40;
    factors.push(`high-risk tool: ${options.tool_name}`);
  } else if (MEDIUM_RISK_TOOLS.has(options.tool_name)) {
    score += 20;
    factors.push(`medium-risk tool: ${options.tool_name}`);
  } else {
    score += 5;
  }

  // Factor 2: Ward evaluation decision (0-20)
  if (options.decision === "HALT") {
    score += 20;
    factors.push("HALT decision from ward evaluation");
  } else if (options.decision === "RESHAPE") {
    score += 10;
    factors.push("RESHAPE decision from ward evaluation");
  }

  // Factor 3: Number of matched wards (0-10)
  if (options.matched_wards.length > 0) {
    const wardBoost = Math.min(options.matched_wards.length * 5, 10);
    score += wardBoost;
    factors.push(`${options.matched_wards.length} ward(s) matched`);
  }

  // Factor 4: Credential patterns in summary (0-15)
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(options.arguments_summary)) {
      score += 15;
      factors.push("credential pattern detected in arguments");
      break;
    }
  }

  // Factor 5: PII patterns in summary (0-10)
  for (const pattern of PII_PATTERNS) {
    if (pattern.test(options.arguments_summary)) {
      score += 10;
      factors.push("PII pattern detected in arguments");
      break;
    }
  }

  // Factor 6: Network/exfiltration patterns (0-10)
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(options.arguments_summary)) {
      score += 10;
      factors.push("network/exfiltration pattern detected");
      break;
    }
  }

  // Factor 7: Destructive operation patterns (0-10)
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(options.arguments_summary)) {
      score += 10;
      factors.push("destructive operation pattern detected");
      break;
    }
  }

  // Cap at 100
  score = Math.min(score, 100);

  // Map to tier
  const tier = scoreToTier(score);

  return { score, tier, factors };
}

function scoreToTier(score: number): RiskTier {
  if (score >= 70) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

/**
 * Analyze a high-risk tool call using Claude with extended thinking.
 * Privacy: only receives arguments_hash + arguments_summary, never raw args.
 */
export async function analyzeWithThinking(
  options: AnalyzeOptions,
  budgetTokens: number
): Promise<ThinkingAnalysis> {
  const client = getClient();

  const response = await client.messages.create({
    model: "claude-opus-4-6-20250219",
    max_tokens: 16000,
    thinking: {
      type: "enabled",
      budget_tokens: budgetTokens,
    },
    system: ANALYZE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze this tool call for security risk:

Tool: ${options.tool_name}
Arguments Hash: ${options.arguments_hash}
Arguments Summary: ${options.arguments_summary}
Ward Decision: ${options.decision}
Matched Wards: ${options.matched_wards.join(", ") || "none"}
Rationale: ${options.rationale}`,
      },
    ],
  });

  // Extract thinking and text blocks
  let thinkingTokens = 0;
  let reasoning = "";
  let recommendation = "";

  for (const block of response.content) {
    if (block.type === "thinking") {
      reasoning = block.thinking;
      // Estimate thinking tokens from character count
      thinkingTokens = Math.round(block.thinking.length / 4);
    } else if (block.type === "text") {
      recommendation = block.text;
    }
  }

  // Parse risk assessment from recommendation
  const riskScore = computeRiskScore(options);

  return {
    risk_score: riskScore.score,
    risk_tier: riskScore.tier,
    reasoning,
    recommendation,
    thinking_tokens_used: thinkingTokens,
  };
}
