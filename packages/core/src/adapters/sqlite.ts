import { Database } from "bun:sqlite";
import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  Rune,
  RuneFilters,
  WardEvaluation,
  ToolCallContext,
  ChainVerificationResult,
  ChainStats,
  SignedReceipt,
  WardDecision,
  ToolBaseline,
} from "../types.js";
import type { RunechainAdapter } from "./types.js";

const GENESIS_HASH = "GENESIS";
const ARGS_SUMMARY_MAX_LENGTH = 200;

export class SqliteAdapter implements RunechainAdapter {
  private db: Database;
  private sequence: number = 0;
  private lastHash: string = GENESIS_HASH;
  private signingKey: KeyObject | null = null;
  private publicKeyPem: string = "";

  constructor(dbPath: string = "heimdall.sqlite") {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.initKeys(dirname(resolve(dbPath)));
    this.initialize();
  }

  // --- Ed25519 Key Management ---

  private initKeys(keyDir: string): void {
    const privPath = resolve(keyDir, "heimdall.key");
    const pubPath = resolve(keyDir, "heimdall.pub");

    try {
      mkdirSync(keyDir, { recursive: true });
    } catch {
      // directory exists
    }

    try {
      if (existsSync(privPath) && existsSync(pubPath)) {
        this.signingKey = createPrivateKey(readFileSync(privPath, "utf-8"));
        this.publicKeyPem = readFileSync(pubPath, "utf-8");
      } else {
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const privPem = privateKey.export({
          type: "pkcs8",
          format: "pem",
        }) as string;
        const pubPem = publicKey.export({
          type: "spki",
          format: "pem",
        }) as string;
        writeFileSync(privPath, privPem, { mode: 0o600 });
        writeFileSync(pubPath, pubPem);
        this.signingKey = privateKey;
        this.publicKeyPem = pubPem;
      }
    } catch (err) {
      console.error(`[heimdall] Ed25519 key init failed: ${err}`);
      // Continue without signing — signatures will be empty
    }
  }

  private signHash(contentHash: string): string {
    if (!this.signingKey) return "";
    const signature = sign(null, Buffer.from(contentHash), this.signingKey);
    return signature.toString("base64");
  }

  private verifySignature(contentHash: string, sig: string): boolean {
    if (!this.publicKeyPem || !sig) return true; // no key or no sig = skip
    try {
      const pubKey = createPublicKey(this.publicKeyPem);
      return verify(
        null,
        Buffer.from(contentHash),
        pubKey,
        Buffer.from(sig, "base64")
      );
    } catch {
      return false;
    }
  }

  getPublicKey(): string {
    return this.publicKeyPem;
  }

  // --- Schema ---

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
        is_genesis       INTEGER NOT NULL DEFAULT 0,
        signature        TEXT
      )
    `);

    // Migration: add signature column to pre-existing DBs
    try {
      this.db.run("ALTER TABLE runes ADD COLUMN signature TEXT");
    } catch {
      // Column already exists
    }

    // Migration: add risk analysis columns
    for (const col of ["risk_score INTEGER", "risk_tier TEXT", "ai_reasoning TEXT"]) {
      try {
        this.db.run(`ALTER TABLE runes ADD COLUMN ${col}`);
      } catch {
        // Column already exists
      }
    }

    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_session ON runes(session_id)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_tool ON runes(tool_name)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_decision ON runes(decision)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_runes_session_tool_ts ON runes(session_id, tool_name, timestamp)"
    );

    // --- Baselines table for drift detection ---
    this.db.run(`
      CREATE TABLE IF NOT EXISTS baselines (
        server_id      TEXT PRIMARY KEY,
        tools_hash     TEXT NOT NULL,
        tools_snapshot TEXT NOT NULL,
        first_seen     TEXT NOT NULL,
        last_verified  TEXT NOT NULL
      )
    `);

    // Restore state from existing chain
    const last = this.db
      .query(
        "SELECT sequence, content_hash FROM runes ORDER BY sequence DESC LIMIT 1"
      )
      .get() as { sequence: number; content_hash: string } | null;

    if (last) {
      this.sequence = last.sequence;
      this.lastHash = last.content_hash;
    }
  }

  // --- Inscribe ---

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
    const signature = this.signHash(contentHash);

    const rune: Rune = {
      ...runeData,
      content_hash: contentHash,
      signature: signature || undefined,
    };

    this.db
      .prepare(
        `INSERT INTO runes (
          sequence, timestamp, session_id, tool_name,
          arguments_hash, arguments_summary, decision,
          matched_wards, ward_chain, rationale,
          response_summary, duration_ms,
          content_hash, previous_hash, is_genesis, signature,
          risk_score, risk_tier, ai_reasoning
        ) VALUES (
          $sequence, $timestamp, $session_id, $tool_name,
          $arguments_hash, $arguments_summary, $decision,
          $matched_wards, $ward_chain, $rationale,
          $response_summary, $duration_ms,
          $content_hash, $previous_hash, $is_genesis, $signature,
          $risk_score, $risk_tier, $ai_reasoning
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
        $signature: rune.signature ?? null,
        $risk_score: rune.risk_score ?? null,
        $risk_tier: rune.risk_tier ?? null,
        $ai_reasoning: rune.ai_reasoning ?? null,
      });

    this.sequence = nextSequence;
    this.lastHash = contentHash;

    return rune;
  }

  // --- Verify ---

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
    let signaturesVerified = 0;
    let signaturesMissing = 0;

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
          signatures_verified: signaturesVerified,
          signatures_missing: signaturesMissing,
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
        decision: row.decision as import("../types.js").WardDecision,
        matched_wards: JSON.parse(row.matched_wards),
        ward_chain: JSON.parse(row.ward_chain),
        rationale: row.rationale,
        response_summary: row.response_summary ?? undefined,
        duration_ms: row.duration_ms ?? undefined,
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
          signatures_verified: signaturesVerified,
          signatures_missing: signaturesMissing,
        };
      }

      // Verify Ed25519 signature
      if (row.signature) {
        if (!this.verifySignature(row.content_hash, row.signature)) {
          const verificationHash = await this.hashData(
            `BROKEN:${row.sequence}:signature`
          );
          return {
            valid: false,
            total_runes: rows.length,
            verified_runes: verifiedCount,
            broken_at_sequence: row.sequence,
            broken_reason: `Invalid Ed25519 signature at rune #${row.sequence}`,
            verification_hash: verificationHash,
            stats,
            signatures_verified: signaturesVerified,
            signatures_missing: signaturesMissing,
          };
        }
        signaturesVerified++;
      } else {
        signaturesMissing++;
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
      signatures_verified: signaturesVerified,
      signatures_missing: signaturesMissing,
    };
  }

  // --- Receipts ---

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
      chain_position: {
        chain_length: this.sequence,
      },
      signature: rune.signature ?? "",
      public_key: this.publicKeyPem,
    };
  }

  // --- Queries ---

  getRunes(filters?: RuneFilters): Rune[] {
    let sql = "SELECT * FROM runes WHERE 1=1";
    const params: Record<string, string | number> = {};

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

  /**
   * Count recent tool calls for rate limiting.
   * When toolName is "*", counts all calls for the session.
   */
  getRecentCallCount(
    sessionId: string,
    toolName: string,
    windowMs: number
  ): number {
    const cutoff = new Date(Date.now() - windowMs).toISOString();

    if (toolName === "*") {
      const result = this.db
        .query(
          "SELECT COUNT(*) as count FROM runes WHERE session_id = $sid AND timestamp > $cutoff"
        )
        .get({ $sid: sessionId, $cutoff: cutoff }) as { count: number };
      return result.count;
    }

    const result = this.db
      .query(
        "SELECT COUNT(*) as count FROM runes WHERE session_id = $sid AND tool_name = $tool AND timestamp > $cutoff"
      )
      .get({ $sid: sessionId, $tool: toolName, $cutoff: cutoff }) as {
      count: number;
    };
    return result.count;
  }

  /**
   * Update the last rune's response_summary and duration_ms.
   * Re-computes content hash and re-signs.
   */
  async updateLastRuneResponse(
    responseSummary: string,
    durationMs?: number
  ): Promise<Rune | null> {
    if (this.sequence === 0) return null;

    const row = this.db
      .query("SELECT * FROM runes WHERE sequence = $seq")
      .get({ $seq: this.sequence }) as RawRuneRow | null;
    if (!row) return null;

    // Guard: only allow updating the truly last rune.
    const nextRow = this.db
      .query("SELECT sequence FROM runes WHERE sequence > $seq LIMIT 1")
      .get({ $seq: row.sequence }) as { sequence: number } | null;
    if (nextRow) {
      console.error(
        `[heimdall] Cannot update rune #${row.sequence}: rune #${nextRow.sequence} already references its hash. Skipping update.`
      );
      return null;
    }

    const runeData: Omit<Rune, "content_hash"> = {
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
      response_summary: responseSummary,
      duration_ms: durationMs ?? row.duration_ms ?? undefined,
      previous_hash: row.previous_hash,
      is_genesis: row.is_genesis === 1,
    };

    const newHash = await this.computeContentHash(runeData);
    const signature = this.signHash(newHash);

    this.db
      .prepare(
        `UPDATE runes SET response_summary = $resp, duration_ms = $dur,
         content_hash = $hash, signature = $sig WHERE sequence = $seq`
      )
      .run({
        $resp: responseSummary,
        $dur: durationMs ?? row.duration_ms ?? null,
        $hash: newHash,
        $sig: signature || null,
        $seq: this.sequence,
      });

    this.lastHash = newHash;

    return { ...runeData, content_hash: newHash, signature: signature || undefined };
  }

  // --- Baseline methods for drift detection ---

  setBaseline(serverId: string, toolsHash: string, toolsSnapshot: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO baselines (server_id, tools_hash, tools_snapshot, first_seen, last_verified)
         VALUES ($server_id, $tools_hash, $tools_snapshot, $now, $now)
         ON CONFLICT(server_id) DO UPDATE SET
           tools_hash = $tools_hash,
           tools_snapshot = $tools_snapshot,
           last_verified = $now`
      )
      .run({
        $server_id: serverId,
        $tools_hash: toolsHash,
        $tools_snapshot: toolsSnapshot,
        $now: now,
      });
  }

  getBaseline(serverId: string): ToolBaseline | null {
    const row = this.db
      .query("SELECT * FROM baselines WHERE server_id = $server_id")
      .get({ $server_id: serverId }) as RawBaselineRow | null;
    return row ? rowToBaseline(row) : null;
  }

  clearBaseline(serverId: string): void {
    this.db
      .prepare("DELETE FROM baselines WHERE server_id = $server_id")
      .run({ $server_id: serverId });
  }

  getAllBaselines(): ToolBaseline[] {
    const rows = this.db
      .query("SELECT * FROM baselines ORDER BY server_id ASC")
      .all() as RawBaselineRow[];
    return rows.map(rowToBaseline);
  }

  clearAllBaselines(): void {
    this.db.run("DELETE FROM baselines");
  }

  close(): void {
    this.db.close();
  }

  // --- Private helpers ---

  private async computeContentHash(
    data: Omit<Rune, "content_hash">
  ): Promise<string> {
    // ALL fields (except signature) are included — modifying any field breaks the chain.
    // Keys are listed alphabetically for determinism.
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
  signature: string | null;
  risk_score: number | null;
  risk_tier: string | null;
  ai_reasoning: string | null;
}

/**
 * Recursively sort all object keys for deterministic JSON serialization.
 * Arrays preserve order (position is semantically meaningful).
 * Primitives pass through unchanged.
 */
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

interface RawBaselineRow {
  server_id: string;
  tools_hash: string;
  tools_snapshot: string;
  first_seen: string;
  last_verified: string;
}

function rowToBaseline(row: RawBaselineRow): ToolBaseline {
  return {
    server_id: row.server_id,
    tools_hash: row.tools_hash,
    tools_snapshot: row.tools_snapshot,
    first_seen: row.first_seen,
    last_verified: row.last_verified,
  };
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
    signature: row.signature ?? undefined,
    risk_score: row.risk_score ?? undefined,
    risk_tier: row.risk_tier ?? undefined,
    ai_reasoning: row.ai_reasoning ?? undefined,
  };
}
