import type { RunechainAdapter } from "./types.js";
import type {
  Rune,
  RuneFilters,
  ChainVerificationResult,
  ChainStats,
  WardEvaluation,
  ToolCallContext,
  WardDecision,
  SignedReceipt,
} from "../types.js";

const GENESIS_HASH = "GENESIS";
const ARGS_SUMMARY_MAX_LENGTH = 200;

/**
 * In-memory storage adapter. No persistence — suitable for testing and
 * short-lived processes where audit durability is not required.
 */
export class MemoryAdapter implements RunechainAdapter {
  private runes: Rune[] = [];
  private sequence = 0;
  private lastHash = GENESIS_HASH;

  async inscribeRune(
    ctx: ToolCallContext,
    evaluation: WardEvaluation,
    responseSummary?: string,
    durationMs?: number
  ): Promise<Rune> {
    const isGenesis = this.sequence === 0;
    const previousHash = this.lastHash;
    const timestamp = new Date().toISOString();
    const argumentsHash = await this.hashData(JSON.stringify(ctx.arguments));
    const argumentsSummary = this.summarizeArguments(ctx.arguments);
    const nextSequence = this.sequence + 1;

    const runeData = {
      sequence: nextSequence,
      timestamp,
      session_id: ctx.session_id,
      tool_name: ctx.tool_name,
      arguments_hash: argumentsHash,
      arguments_summary: argumentsSummary,
      decision: evaluation.decision,
      matched_wards: evaluation.matched_wards,
      ward_chain: evaluation.ward_chain,
      rationale: evaluation.rationale,
      response_summary: responseSummary,
      duration_ms: durationMs,
      previous_hash: previousHash,
      is_genesis: isGenesis,
    };

    const contentHash = await this.computeContentHash(runeData);

    const rune: Rune = {
      ...runeData,
      content_hash: contentHash,
    };

    this.runes.push(rune);
    this.sequence = nextSequence;
    this.lastHash = contentHash;

    return rune;
  }

  async updateLastRuneResponse(
    responseSummary: string,
    durationMs?: number
  ): Promise<Rune | null> {
    if (this.runes.length === 0) return null;

    const last = this.runes[this.runes.length - 1];

    // Guard: only allow updating if this is truly the latest rune
    // (matches SqliteAdapter behavior — protects chain integrity)
    if (last.sequence !== this.sequence) {
      console.error(
        `[heimdall] Cannot update rune #${last.sequence}: sequence mismatch. Skipping update.`
      );
      return null;
    }

    const updated = {
      ...last,
      response_summary: responseSummary,
      duration_ms: durationMs ?? last.duration_ms,
    };

    const newHash = await this.computeContentHash(updated);
    updated.content_hash = newHash;

    this.runes[this.runes.length - 1] = updated;
    this.lastHash = newHash;

    return updated;
  }

  async verifyChain(): Promise<ChainVerificationResult> {
    const stats = this.computeStats();

    if (this.runes.length === 0) {
      return {
        valid: true,
        total_runes: 0,
        verified_runes: 0,
        verification_hash: await this.hashData("EMPTY_CHAIN"),
        stats,
      };
    }

    let expectedPreviousHash = GENESIS_HASH;
    let verifiedCount = 0;

    for (const rune of this.runes) {
      if (rune.previous_hash !== expectedPreviousHash) {
        return {
          valid: false,
          total_runes: this.runes.length,
          verified_runes: verifiedCount,
          broken_at_sequence: rune.sequence,
          broken_reason: `Chain linkage broken at rune #${rune.sequence}`,
          verification_hash: await this.hashData(`BROKEN:${rune.sequence}:linkage`),
          stats,
        };
      }

      const computedHash = await this.computeContentHash(rune);
      if (computedHash !== rune.content_hash) {
        return {
          valid: false,
          total_runes: this.runes.length,
          verified_runes: verifiedCount,
          broken_at_sequence: rune.sequence,
          broken_reason: `Content hash mismatch at rune #${rune.sequence}`,
          verification_hash: await this.hashData(`BROKEN:${rune.sequence}:hash`),
          stats,
        };
      }

      expectedPreviousHash = rune.content_hash;
      verifiedCount++;
    }

    return {
      valid: true,
      total_runes: this.runes.length,
      verified_runes: verifiedCount,
      verification_hash: await this.hashData(`VALID:${this.runes.length}:${expectedPreviousHash}`),
      stats,
    };
  }

  getRunes(filters?: RuneFilters): Rune[] {
    let result = [...this.runes];

    if (filters?.session_id) {
      result = result.filter((r) => r.session_id === filters.session_id);
    }
    if (filters?.tool_name) {
      result = result.filter((r) => r.tool_name === filters.tool_name);
    }
    if (filters?.decision) {
      result = result.filter((r) => r.decision === filters.decision);
    }

    result.sort((a, b) => b.sequence - a.sequence);

    if (filters?.offset) {
      result = result.slice(filters.offset);
    }
    if (filters?.limit) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  getRuneBySequence(sequence: number): Rune | null {
    return this.runes.find((r) => r.sequence === sequence) ?? null;
  }

  getChainStats(): ChainStats {
    return this.computeStats();
  }

  getRuneCount(): number {
    return this.runes.length;
  }

  getLastSequence(): number {
    return this.sequence;
  }

  getRecentCallCount(sessionId: string, toolName: string, windowMs: number): number {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    return this.runes.filter((r) => {
      if (r.session_id !== sessionId) return false;
      if (r.timestamp <= cutoff) return false;
      if (toolName !== "*" && r.tool_name !== toolName) return false;
      return true;
    }).length;
  }

  getPublicKey(): string {
    return "";
  }

  exportReceipt(sequence: number): SignedReceipt | null {
    const rune = this.getRuneBySequence(sequence);
    if (!rune) return null;
    return {
      version: "1",
      rune: {
        sequence: rune.sequence,
        timestamp: rune.timestamp,
        tool_name: rune.tool_name,
        decision: rune.decision,
        rationale: rune.rationale,
        matched_wards: rune.matched_wards,
        arguments_hash: rune.arguments_hash,
        content_hash: rune.content_hash,
        previous_hash: rune.previous_hash,
        is_genesis: rune.is_genesis,
      },
      chain_position: { chain_length: this.sequence },
      signature: "",
      public_key: "",
    };
  }

  close(): void {
    // no-op
  }

  // --- Private helpers (same hashing logic as SqliteAdapter) ---

  private async computeContentHash(data: Omit<Rune, "content_hash"> & { content_hash?: string }): Promise<string> {
    const payload = {
      arguments_hash: data.arguments_hash,
      arguments_summary: data.arguments_summary,
      decision: data.decision,
      duration_ms: data.duration_ms ?? null,
      is_genesis: data.is_genesis,
      matched_wards: data.matched_wards,
      previous_hash: data.previous_hash,
      rationale: data.rationale,
      response_summary: data.response_summary ?? null,
      sequence: data.sequence,
      session_id: data.session_id,
      timestamp: data.timestamp,
      tool_name: data.tool_name,
      ward_chain: data.ward_chain,
    };
    const canonical = JSON.stringify(canonicalize(payload));
    return this.hashData(canonical);
  }

  private async hashData(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private summarizeArguments(args: Record<string, unknown>): string {
    const summary = JSON.stringify(args);
    if (summary.length <= ARGS_SUMMARY_MAX_LENGTH) return summary;
    return summary.slice(0, ARGS_SUMMARY_MAX_LENGTH - 3) + "...";
  }

  private computeStats(): ChainStats {
    const sessions = new Set<string>();
    const tools = new Set<string>();
    const decisions: Record<WardDecision, number> = { PASS: 0, HALT: 0, RESHAPE: 0 };

    for (const rune of this.runes) {
      sessions.add(rune.session_id);
      tools.add(rune.tool_name);
      decisions[rune.decision] = (decisions[rune.decision] ?? 0) + 1;
    }

    return {
      total_runes: this.runes.length,
      sessions: sessions.size,
      unique_tools: tools.size,
      decisions,
      first_rune_timestamp: this.runes[0]?.timestamp,
      last_rune_timestamp: this.runes[this.runes.length - 1]?.timestamp,
    };
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
