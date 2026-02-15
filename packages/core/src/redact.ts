/**
 * Redact known secret patterns from text before storage or transmission.
 * Applied as defense-in-depth to arguments_summary and response_summary.
 *
 * These patterns match the detection rules in bifrost-trifecta.yaml
 * but operate at the storage layer as a safety net — even if no ward
 * matches, secrets never persist in plaintext.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,           // Anthropic API keys
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub personal access tokens
  /gho_[a-zA-Z0-9]{36}/g,           // GitHub OAuth tokens
  /AKIA[0-9A-Z]{16}/g,              // AWS access key IDs
  /xox[bpas]-[a-zA-Z0-9-]+/g,       // Slack tokens
  /glpat-[a-zA-Z0-9_-]{20,}/g,      // GitLab tokens
  /npm_[a-zA-Z0-9]{36}/g,           // npm tokens
  /sk-proj-[a-zA-Z0-9-_]{20,}/g,    // OpenAI project keys
  /eyJ[a-zA-Z0-9_-]{50,}/g,         // JWTs (base64-encoded JSON)
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
