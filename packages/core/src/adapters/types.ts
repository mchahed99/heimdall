import type {
  Rune,
  RuneFilters,
  ChainVerificationResult,
  ChainStats,
  WardEvaluation,
  ToolCallContext,
} from "../types.js";

/**
 * Storage backend interface for the Runechain audit trail.
 * Implement this to add new storage backends (Postgres, Turso, etc.).
 */
export interface RunechainAdapter {
  /** Append a new rune to the chain. Returns the inscribed rune with computed hashes. */
  inscribeRune(
    ctx: ToolCallContext,
    evaluation: WardEvaluation,
    responseSummary?: string,
    durationMs?: number
  ): Promise<Rune>;

  /** Update the last rune's response data. Returns null if update is not safe. */
  updateLastRuneResponse(
    responseSummary: string,
    durationMs?: number
  ): Promise<Rune | null>;

  /** Verify the entire hash chain integrity. */
  verifyChain(): Promise<ChainVerificationResult>;

  /** Query runes with optional filters. */
  getRunes(filters?: RuneFilters): Rune[];

  /** Get a single rune by sequence number. */
  getRuneBySequence(sequence: number): Rune | null;

  /** Get aggregate statistics about the chain. */
  getChainStats(): ChainStats;

  /** Get total number of runes. */
  getRuneCount(): number;

  /** Get the last sequence number. */
  getLastSequence(): number;

  /** Count recent calls for rate limiting. */
  getRecentCallCount(
    sessionId: string,
    toolName: string,
    windowMs: number
  ): number;

  /** Get the public key used for signing (empty string if no signing). */
  getPublicKey(): string;

  /** Export a signed receipt for a specific rune. */
  exportReceipt(sequence: number): import("../types.js").SignedReceipt | null;

  /** Close the adapter and release resources. */
  close(): void;
}
