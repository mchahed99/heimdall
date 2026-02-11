import { Database } from "bun:sqlite";
import type {
  Rune,
  RuneFilters,
  WardEvaluation,
  ToolCallContext,
  ChainVerificationResult,
  ChainStats,
  WardDecision,
} from "./types.js";

const GENESIS_HASH = "GENESIS";
const ARGS_SUMMARY_MAX_LENGTH = 200;

export class Runechain {
  private db: Database;
  private sequence: number = 0;
  private lastHash: string = GENESIS_HASH;

  constructor(dbPath: string = "heimdall.sqlite") {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS runes (
        sequence         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp        TEXT    NOT NULL,
        session_id       TEXT    NOT NULL,
        tool_name        TEXT    NOT NULL,
        arguments_hash   TEXT    NOT NULL,
        arguments_summary TEXT   NOT NULL,
        decision         TEXT    NOT NULL,
        matched_wards    TEXT    NOT NULL,
        ward_chain       TEXT    NOT NULL,
        rationale        TEXT    NOT NULL,
        response_summary TEXT,
        duration_ms      INTEGER,
        content_hash     TEXT    NOT NULL UNIQUE,
        previous_hash    TEXT    NOT NULL,
        is_genesis       INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_session ON runes(session_id)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_tool ON runes(tool_name)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_decision ON runes(decision)"
    );

    // Restore state from existing chain
    const last = this.db
      .query("SELECT sequence, content_hash FROM runes ORDER BY sequence DESC LIMIT 1")
      .get() as { sequence: number; content_hash: string } | null;

    if (last) {
      this.sequence = last.sequence;
      this.lastHash = last.content_hash;
    }
  }

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

    // We need the sequence number. Use a transaction to get it atomically.
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

    const rune: Rune = { ...runeData, content_hash: contentHash };

    this.db
      .prepare(
        `INSERT INTO runes (
          sequence, timestamp, session_id, tool_name,
          arguments_hash, arguments_summary, decision,
          matched_wards, ward_chain, rationale,
          response_summary, duration_ms,
          content_hash, previous_hash, is_genesis
        ) VALUES (
          $sequence, $timestamp, $session_id, $tool_name,
          $arguments_hash, $arguments_summary, $decision,
          $matched_wards, $ward_chain, $rationale,
          $response_summary, $duration_ms,
          $content_hash, $previous_hash, $is_genesis
        )`
      )
      .run({
        $sequence: rune.sequence,
        $timestamp: rune.timestamp,
        $session_id: rune.session_id,
        $tool_name: rune.tool_name,
        $arguments_hash: rune.arguments_hash,
        $arguments_summary: rune.arguments_summary,
        $decision: rune.decision,
        $matched_wards: JSON.stringify(rune.matched_wards),
        $ward_chain: JSON.stringify(rune.ward_chain),
        $rationale: rune.rationale,
        $response_summary: rune.response_summary ?? null,
        $duration_ms: rune.duration_ms ?? null,
        $content_hash: rune.content_hash,
        $previous_hash: rune.previous_hash,
        $is_genesis: rune.is_genesis ? 1 : 0,
      });

    this.sequence = nextSequence;
    this.lastHash = contentHash;

    return rune;
  }

  async verifyChain(): Promise<ChainVerificationResult> {
    const rows = this.db
      .query("SELECT * FROM runes ORDER BY sequence ASC")
      .all() as RawRuneRow[];

    const stats = this.computeStats(rows);

    if (rows.length === 0) {
      const verificationHash = await this.hashData("EMPTY_CHAIN");
      return {
        valid: true,
        total_runes: 0,
        verified_runes: 0,
        verification_hash: verificationHash,
        stats,
      };
    }

    let expectedPreviousHash = GENESIS_HASH;
    let verifiedCount = 0;

    for (const row of rows) {
      // Check chain linkage
      if (row.previous_hash !== expectedPreviousHash) {
        const verificationHash = await this.hashData(
          `BROKEN:${row.sequence}:linkage`
        );
        return {
          valid: false,
          total_runes: rows.length,
          verified_runes: verifiedCount,
          broken_at_sequence: row.sequence,
          broken_reason: `Chain linkage broken: expected previous_hash '${expectedPreviousHash.slice(0, 12)}...', got '${row.previous_hash.slice(0, 12)}...'`,
          verification_hash: verificationHash,
          stats,
        };
      }

      // Recompute content hash
      const runeData = {
        sequence: row.sequence,
        timestamp: row.timestamp,
        session_id: row.session_id,
        tool_name: row.tool_name,
        arguments_hash: row.arguments_hash,
        arguments_summary: row.arguments_summary,
        decision: row.decision,
        matched_wards: JSON.parse(row.matched_wards),
        ward_chain: JSON.parse(row.ward_chain),
        rationale: row.rationale,
        response_summary: row.response_summary,
        duration_ms: row.duration_ms,
        previous_hash: row.previous_hash,
        is_genesis: row.is_genesis === 1,
      };

      const computedHash = await this.computeContentHash(runeData);

      if (computedHash !== row.content_hash) {
        const verificationHash = await this.hashData(
          `BROKEN:${row.sequence}:hash`
        );
        return {
          valid: false,
          total_runes: rows.length,
          verified_runes: verifiedCount,
          broken_at_sequence: row.sequence,
          broken_reason: `Content hash mismatch at rune #${row.sequence}: stored '${row.content_hash.slice(0, 12)}...', computed '${computedHash.slice(0, 12)}...'`,
          verification_hash: verificationHash,
          stats,
        };
      }

      expectedPreviousHash = row.content_hash;
      verifiedCount++;
    }

    const verificationHash = await this.hashData(
      `VALID:${rows.length}:${expectedPreviousHash}`
    );

    return {
      valid: true,
      total_runes: rows.length,
      verified_runes: verifiedCount,
      verification_hash: verificationHash,
      stats,
    };
  }

  getRunes(filters?: RuneFilters): Rune[] {
    let sql = "SELECT * FROM runes WHERE 1=1";
    const params: Record<string, unknown> = {};

    if (filters?.session_id) {
      sql += " AND session_id = $session_id";
      params.$session_id = filters.session_id;
    }
    if (filters?.tool_name) {
      sql += " AND tool_name = $tool_name";
      params.$tool_name = filters.tool_name;
    }
    if (filters?.decision) {
      sql += " AND decision = $decision";
      params.$decision = filters.decision;
    }

    sql += " ORDER BY sequence DESC";

    if (filters?.limit) {
      sql += " LIMIT $limit";
      params.$limit = filters.limit;
    }
    if (filters?.offset) {
      sql += " OFFSET $offset";
      params.$offset = filters.offset;
    }

    const rows = this.db.prepare(sql).all(params) as RawRuneRow[];
    return rows.map(rowToRune);
  }

  getRuneBySequence(sequence: number): Rune | null {
    const row = this.db
      .query("SELECT * FROM runes WHERE sequence = $sequence")
      .get({ $sequence: sequence }) as RawRuneRow | null;
    return row ? rowToRune(row) : null;
  }

  getChainStats(): ChainStats {
    const rows = this.db
      .query("SELECT * FROM runes ORDER BY sequence ASC")
      .all() as RawRuneRow[];
    return this.computeStats(rows);
  }

  getRuneCount(): number {
    const result = this.db
      .query("SELECT COUNT(*) as count FROM runes")
      .get() as { count: number };
    return result.count;
  }

  getLastSequence(): number {
    return this.sequence;
  }

  close(): void {
    this.db.close();
  }

  // --- Private helpers ---

  private async computeContentHash(
    data: Omit<Rune, "content_hash">
  ): Promise<string> {
    const payload = {
      sequence: data.sequence,
      timestamp: data.timestamp,
      session_id: data.session_id,
      tool_name: data.tool_name,
      arguments_hash: data.arguments_hash,
      decision: data.decision,
      matched_wards: data.matched_wards,
      ward_chain: data.ward_chain,
      rationale: data.rationale,
      previous_hash: data.previous_hash,
    };
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return this.hashData(canonical);
  }

  private async hashData(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(data)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private summarizeArguments(args: Record<string, unknown>): string {
    const summary = JSON.stringify(args);
    if (summary.length <= ARGS_SUMMARY_MAX_LENGTH) return summary;
    return summary.slice(0, ARGS_SUMMARY_MAX_LENGTH - 3) + "...";
  }

  private computeStats(rows: RawRuneRow[]): ChainStats {
    const sessions = new Set<string>();
    const tools = new Set<string>();
    const decisions: Record<WardDecision, number> = {
      PASS: 0,
      HALT: 0,
      RESHAPE: 0,
    };

    for (const row of rows) {
      sessions.add(row.session_id);
      tools.add(row.tool_name);
      decisions[row.decision as WardDecision] =
        (decisions[row.decision as WardDecision] ?? 0) + 1;
    }

    return {
      total_runes: rows.length,
      sessions: sessions.size,
      unique_tools: tools.size,
      decisions,
      first_rune_timestamp: rows[0]?.timestamp,
      last_rune_timestamp: rows[rows.length - 1]?.timestamp,
    };
  }
}

// --- Row <-> Rune conversion ---

interface RawRuneRow {
  sequence: number;
  timestamp: string;
  session_id: string;
  tool_name: string;
  arguments_hash: string;
  arguments_summary: string;
  decision: string;
  matched_wards: string;
  ward_chain: string;
  rationale: string;
  response_summary: string | null;
  duration_ms: number | null;
  content_hash: string;
  previous_hash: string;
  is_genesis: number;
}

function rowToRune(row: RawRuneRow): Rune {
  return {
    sequence: row.sequence,
    timestamp: row.timestamp,
    session_id: row.session_id,
    tool_name: row.tool_name,
    arguments_hash: row.arguments_hash,
    arguments_summary: row.arguments_summary,
    decision: row.decision as WardDecision,
    matched_wards: JSON.parse(row.matched_wards),
    ward_chain: JSON.parse(row.ward_chain),
    rationale: row.rationale,
    response_summary: row.response_summary ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    content_hash: row.content_hash,
    previous_hash: row.previous_hash,
    is_genesis: row.is_genesis === 1,
  };
}
