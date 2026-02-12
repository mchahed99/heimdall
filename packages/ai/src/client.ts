import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | null = null;

/**
 * Get or create a shared Anthropic client.
 * Throws a clear error if ANTHROPIC_API_KEY is not set.
 */
export function getClient(): Anthropic {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set ANTHROPIC_API_KEY to use AI features. " +
      "Get your key at https://console.anthropic.com/settings/keys"
    );
  }

  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/**
 * Reset the cached client (for testing).
 */
export function resetClient(): void {
  cachedClient = null;
}
