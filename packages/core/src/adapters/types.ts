import type {
  Rune,
  RuneFilters,
  ChainVerificationResult,
  ChainStats,
  WardEvaluation,
  ToolCallContext,
  ToolBaseline,
  PendingBaseline,
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

  // --- Optional baseline methods for drift detection ---

  /** Upsert a tool baseline for a server. */
  setBaseline?(serverId: string, toolsHash: string, toolsSnapshot: string): void;

  /** Get the tool baseline for a server. */
  getBaseline?(serverId: string): ToolBaseline | null;

  /** Remove the tool baseline for a specific server. */
  clearBaseline?(serverId: string): void;

  /** Get all stored tool baselines. */
  getAllBaselines?(): ToolBaseline[];

  /** Remove all stored tool baselines. */
  clearAllBaselines?(): void;

  // --- Optional pending baseline methods for drift approval workflow ---

  /** Store a pending baseline awaiting user approval. */
  setPendingBaseline?(serverId: string, toolsHash: string, toolsSnapshot: string): void;

  /** Get a pending baseline for a server. */
  getPendingBaseline?(serverId: string): PendingBaseline | null;

  /** Approve a pending baseline: promote it to the active baseline and remove from pending. */
  approvePendingBaseline?(serverId: string): boolean;

  /** Get all pending baselines. */
  getAllPendingBaselines?(): PendingBaseline[];
}
