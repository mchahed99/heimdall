# Heimdall DX Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Heimdall from a Claude Code-coupled PoC into a universal, pluggable audit gateway that any agentic system can integrate in 5 minutes.

**Architecture:** Extract interfaces for storage and sinks from the current hardcoded implementations. Build a `Heimdall` SDK class as the unified facade. Add plugin registration for custom conditions/actions. Enhance config with env vars, composition, and sink declarations. Add CLI DX commands and a policy testing framework.

**Tech Stack:** Bun (primary), TypeScript strict, `yaml` parser, `@modelcontextprotocol/sdk`, `@opentelemetry/api` + `@opentelemetry/exporter-trace-otlp-http` (for OTLP sink)

---

## Task 1: Storage Adapter Interface

Extract the `RunechainAdapter` interface from the current monolithic `Runechain` class. This is the foundation — everything else depends on it.

**Files:**
- Create: `packages/core/src/adapters/types.ts`
- Modify: `packages/core/src/types.ts` (re-export adapter types)
- Modify: `packages/core/src/index.ts` (export adapters)

**Step 1: Create the adapter interface**

Create `packages/core/src/adapters/types.ts`:

```typescript
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
```

**Step 2: Create adapter barrel export**

Create `packages/core/src/adapters/index.ts`:

```typescript
export type { RunechainAdapter } from "./types.js";
```

**Step 3: Update core index exports**

Modify `packages/core/src/index.ts` — add:

```typescript
export type { RunechainAdapter } from "./adapters/index.js";
```

**Step 4: Run typecheck**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bunx tsc --noEmit`
Expected: PASS (no errors — we only added types)

**Step 5: Commit**

```
feat(core): add RunechainAdapter interface for pluggable storage backends
```

---

## Task 2: Refactor Runechain as SQLite Adapter

Make the existing `Runechain` class implement `RunechainAdapter`. This is a **pure refactor** — zero behavior change, all existing tests must still pass.

**Files:**
- Create: `packages/core/src/adapters/sqlite.ts` (new file, move Runechain here)
- Modify: `packages/core/src/runechain.ts` (re-export for backwards compat)
- Modify: `packages/core/src/adapters/index.ts` (export SQLiteAdapter)
- Modify: `packages/core/src/index.ts` (export SQLiteAdapter)

**Step 1: Create SQLiteAdapter**

Create `packages/core/src/adapters/sqlite.ts` — copy the entire `Runechain` class from `runechain.ts`, rename to `SqliteAdapter`, and add `implements RunechainAdapter`:

```typescript
import type { RunechainAdapter } from "./types.js";
// ... rest of existing Runechain code with class renamed to SqliteAdapter
export class SqliteAdapter implements RunechainAdapter {
  // ... exact same implementation as current Runechain
}
```

Key changes:
- `class Runechain` → `class SqliteAdapter implements RunechainAdapter`
- Keep ALL existing methods and private helpers intact
- Keep `canonicalize()` and `rowToRune()` as module-level functions
- Keep `RawRuneRow` interface

**Step 2: Replace runechain.ts with re-export**

Replace `packages/core/src/runechain.ts` content with:

```typescript
// Backwards compatibility — Runechain is now SqliteAdapter
export { SqliteAdapter as Runechain } from "./adapters/sqlite.js";
```

**Step 3: Update adapter barrel**

Modify `packages/core/src/adapters/index.ts`:

```typescript
export type { RunechainAdapter } from "./types.js";
export { SqliteAdapter } from "./sqlite.js";
```

**Step 4: Update core index**

Modify `packages/core/src/index.ts` to also export `SqliteAdapter`:

```typescript
export type { RunechainAdapter } from "./adapters/index.js";
export { SqliteAdapter } from "./adapters/index.js";
```

**Step 5: Run existing tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS — zero behavior change, `Runechain` is still exported.

**Step 6: Commit**

```
refactor(core): extract SqliteAdapter from Runechain class
```

---

## Task 3: Memory Adapter

Lightweight in-memory adapter for testing and ephemeral use. No SQLite dependency.

**Files:**
- Create: `packages/core/src/adapters/memory.ts`
- Create: `packages/core/__tests__/memory-adapter.test.ts`
- Modify: `packages/core/src/adapters/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/memory-adapter.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { MemoryAdapter } from "../src/adapters/memory.js";
import type { ToolCallContext, WardEvaluation } from "../src/types.js";

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool_name: "Bash",
    arguments: { command: "echo hello" },
    session_id: "test-session",
    ...overrides,
  };
}

function makeEval(overrides: Partial<WardEvaluation> = {}): WardEvaluation {
  return {
    decision: "PASS",
    matched_wards: [],
    ward_chain: [],
    rationale: "Default pass",
    evaluation_duration_ms: 0.5,
    ...overrides,
  };
}

describe("MemoryAdapter", () => {
  test("inscribes genesis rune", async () => {
    const adapter = new MemoryAdapter();
    const rune = await adapter.inscribeRune(makeCtx(), makeEval());
    expect(rune.sequence).toBe(1);
    expect(rune.previous_hash).toBe("GENESIS");
    expect(rune.is_genesis).toBe(true);
    expect(rune.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("chains runes correctly", async () => {
    const adapter = new MemoryAdapter();
    const r1 = await adapter.inscribeRune(makeCtx(), makeEval());
    const r2 = await adapter.inscribeRune(makeCtx(), makeEval());
    expect(r2.previous_hash).toBe(r1.content_hash);
    expect(r2.sequence).toBe(2);
  });

  test("verifyChain passes for valid chain", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx(), makeEval());
    await adapter.inscribeRune(makeCtx(), makeEval());
    const result = await adapter.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.total_runes).toBe(2);
  });

  test("getRunes with filters", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash" }), makeEval({ decision: "HALT" }));
    await adapter.inscribeRune(makeCtx({ tool_name: "Read" }), makeEval({ decision: "PASS" }));

    const haltRunes = adapter.getRunes({ decision: "HALT" });
    expect(haltRunes).toHaveLength(1);
    expect(haltRunes[0].tool_name).toBe("Bash");
  });

  test("getRecentCallCount for rate limiting", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash", session_id: "s1" }), makeEval());
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash", session_id: "s1" }), makeEval());
    await adapter.inscribeRune(makeCtx({ tool_name: "Read", session_id: "s1" }), makeEval());

    expect(adapter.getRecentCallCount("s1", "Bash", 60_000)).toBe(2);
    expect(adapter.getRecentCallCount("s1", "*", 60_000)).toBe(3);
  });

  test("getChainStats", async () => {
    const adapter = new MemoryAdapter();
    await adapter.inscribeRune(makeCtx({ tool_name: "Bash", session_id: "s1" }), makeEval({ decision: "PASS" }));
    await adapter.inscribeRune(makeCtx({ tool_name: "Read", session_id: "s2" }), makeEval({ decision: "HALT" }));

    const stats = adapter.getChainStats();
    expect(stats.total_runes).toBe(2);
    expect(stats.sessions).toBe(2);
    expect(stats.unique_tools).toBe(2);
    expect(stats.decisions.PASS).toBe(1);
    expect(stats.decisions.HALT).toBe(1);
  });

  test("close is a no-op", () => {
    const adapter = new MemoryAdapter();
    expect(() => adapter.close()).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/memory-adapter.test.ts`
Expected: FAIL — `MemoryAdapter` doesn't exist yet.

**Step 3: Implement MemoryAdapter**

Create `packages/core/src/adapters/memory.ts`:

```typescript
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
```

**Step 4: Update exports**

Modify `packages/core/src/adapters/index.ts`:

```typescript
export type { RunechainAdapter } from "./types.js";
export { SqliteAdapter } from "./sqlite.js";
export { MemoryAdapter } from "./memory.js";
```

Modify `packages/core/src/index.ts` — add:

```typescript
export { MemoryAdapter } from "./adapters/index.js";
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS (new + existing)

**Step 6: Commit**

```
feat(core): add MemoryAdapter for testing and ephemeral use
```

---

## Task 4: Sink Interface + Stdout Sink

Create the `HeimdallSink` interface and the first sink implementation (stdout JSON lines).

**Files:**
- Create: `packages/core/src/sinks/types.ts`
- Create: `packages/core/src/sinks/stdout.ts`
- Create: `packages/core/src/sinks/index.ts`
- Create: `packages/core/__tests__/sinks.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Create the sink interface**

Create `packages/core/src/sinks/types.ts`:

```typescript
import type { Rune, WardEvaluation } from "../types.js";

/**
 * A sink receives rune events and forwards them to external systems.
 * Implement this to add new log drains (webhook, OTLP, S3, Kafka, etc.).
 */
export interface HeimdallSink {
  /** Human-readable name for diagnostics. */
  readonly name: string;

  /** Emit a rune event to the sink. */
  emit(rune: Rune): Promise<void>;

  /** Flush any buffered events. Called on graceful shutdown. */
  flush?(): Promise<void>;

  /** Release resources. */
  close?(): Promise<void>;
}

/** Configuration for a sink declared in bifrost.yaml. */
export interface SinkConfig {
  type: string;
  /** Only emit runes with these decisions. Empty = all. */
  events?: string[];
  [key: string]: unknown;
}
```

**Step 2: Write the failing test**

Create `packages/core/__tests__/sinks.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { StdoutSink } from "../src/sinks/stdout.js";
import type { Rune } from "../src/types.js";

function makeRune(overrides: Partial<Rune> = {}): Rune {
  return {
    sequence: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
    session_id: "test-session",
    tool_name: "Bash",
    arguments_hash: "abc123",
    arguments_summary: '{"command":"echo hi"}',
    decision: "PASS",
    matched_wards: [],
    ward_chain: [],
    rationale: "Default pass",
    content_hash: "def456",
    previous_hash: "GENESIS",
    is_genesis: true,
    ...overrides,
  };
}

describe("StdoutSink", () => {
  test("has correct name", () => {
    const sink = new StdoutSink();
    expect(sink.name).toBe("stdout");
  });

  test("emits JSON to provided write function", async () => {
    const lines: string[] = [];
    const sink = new StdoutSink({ writeFn: (line) => lines.push(line) });

    await sink.emit(makeRune());

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.decision).toBe("PASS");
  });

  test("filters by decision when events are specified", async () => {
    const lines: string[] = [];
    const sink = new StdoutSink({
      writeFn: (line) => lines.push(line),
      events: ["HALT"],
    });

    await sink.emit(makeRune({ decision: "PASS" }));
    expect(lines).toHaveLength(0);

    await sink.emit(makeRune({ decision: "HALT" }));
    expect(lines).toHaveLength(1);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/sinks.test.ts`
Expected: FAIL

**Step 4: Implement StdoutSink**

Create `packages/core/src/sinks/stdout.ts`:

```typescript
import type { HeimdallSink } from "./types.js";
import type { Rune } from "../types.js";

export interface StdoutSinkOptions {
  /** Override write function (default: process.stderr — stdout is reserved for MCP). */
  writeFn?: (line: string) => void;
  /** Only emit runes with these decisions. */
  events?: string[];
}

/**
 * Emits runes as JSON lines to stderr (or a custom write function).
 * Useful for piping to jq, fluentd, vector, etc.
 */
export class StdoutSink implements HeimdallSink {
  readonly name = "stdout";
  private writeFn: (line: string) => void;
  private events?: Set<string>;

  constructor(options?: StdoutSinkOptions) {
    this.writeFn = options?.writeFn ?? ((line) => process.stderr.write(line + "\n"));
    this.events = options?.events ? new Set(options.events) : undefined;
  }

  async emit(rune: Rune): Promise<void> {
    if (this.events && !this.events.has(rune.decision)) return;
    this.writeFn(JSON.stringify(rune));
  }
}
```

**Step 5: Create barrel export**

Create `packages/core/src/sinks/index.ts`:

```typescript
export type { HeimdallSink, SinkConfig } from "./types.js";
export { StdoutSink } from "./stdout.js";
```

Modify `packages/core/src/index.ts` — add:

```typescript
export type { HeimdallSink, SinkConfig } from "./sinks/index.js";
export { StdoutSink } from "./sinks/index.js";
```

**Step 6: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 7: Commit**

```
feat(core): add HeimdallSink interface and StdoutSink implementation
```

---

## Task 5: Webhook Sink

POST rune events to a configurable URL.

**Files:**
- Create: `packages/core/src/sinks/webhook.ts`
- Create: `packages/core/__tests__/webhook-sink.test.ts`
- Modify: `packages/core/src/sinks/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/webhook-sink.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { WebhookSink } from "../src/sinks/webhook.js";
import type { Rune } from "../src/types.js";

function makeRune(overrides: Partial<Rune> = {}): Rune {
  return {
    sequence: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
    session_id: "test-session",
    tool_name: "Bash",
    arguments_hash: "abc123",
    arguments_summary: '{"command":"echo hi"}',
    decision: "HALT",
    matched_wards: ["block-bash"],
    ward_chain: [],
    rationale: "Bash blocked",
    content_hash: "def456",
    previous_hash: "GENESIS",
    is_genesis: true,
    ...overrides,
  };
}

describe("WebhookSink", () => {
  test("has correct name", () => {
    const sink = new WebhookSink({ url: "https://example.com/hook" });
    expect(sink.name).toBe("webhook");
  });

  test("sends POST with rune JSON body", async () => {
    let capturedRequest: { url: string; body: string; headers: Record<string, string> } | null = null;

    const sink = new WebhookSink({
      url: "https://example.com/hook",
      fetchFn: async (url, init) => {
        capturedRequest = {
          url: url as string,
          body: init?.body as string,
          headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()),
        };
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe("https://example.com/hook");
    expect(capturedRequest!.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(capturedRequest!.body);
    expect(body.tool_name).toBe("Bash");
    expect(body.decision).toBe("HALT");
  });

  test("includes custom headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const sink = new WebhookSink({
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer token123" },
      fetchFn: async (_url, init) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());
    expect(capturedHeaders["authorization"]).toBe("Bearer token123");
  });

  test("filters by decision", async () => {
    let callCount = 0;

    const sink = new WebhookSink({
      url: "https://example.com/hook",
      events: ["HALT"],
      fetchFn: async () => {
        callCount++;
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune({ decision: "PASS" }));
    expect(callCount).toBe(0);

    await sink.emit(makeRune({ decision: "HALT" }));
    expect(callCount).toBe(1);
  });

  test("does not throw on fetch failure", async () => {
    const sink = new WebhookSink({
      url: "https://example.com/hook",
      fetchFn: async () => {
        throw new Error("Network error");
      },
    });

    // Should not throw — sinks should be fire-and-forget
    await expect(sink.emit(makeRune())).resolves.toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/webhook-sink.test.ts`
Expected: FAIL

**Step 3: Implement WebhookSink**

Create `packages/core/src/sinks/webhook.ts`:

```typescript
import type { HeimdallSink } from "./types.js";
import type { Rune } from "../types.js";

export interface WebhookSinkOptions {
  url: string;
  headers?: Record<string, string>;
  events?: string[];
  /** Override fetch for testing. */
  fetchFn?: typeof fetch;
}

/**
 * Sends rune events as POST requests to a webhook URL.
 * Fire-and-forget — errors are logged to stderr, never thrown.
 */
export class WebhookSink implements HeimdallSink {
  readonly name = "webhook";
  private url: string;
  private headers: Record<string, string>;
  private events?: Set<string>;
  private fetchFn: typeof fetch;

  constructor(options: WebhookSinkOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.events = options.events ? new Set(options.events) : undefined;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async emit(rune: Rune): Promise<void> {
    if (this.events && !this.events.has(rune.decision)) return;

    try {
      await this.fetchFn(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(rune),
      });
    } catch (err) {
      console.error(`[heimdall] webhook sink error: ${err}`);
    }
  }
}
```

**Step 4: Update exports**

Modify `packages/core/src/sinks/index.ts` — add:

```typescript
export { WebhookSink } from "./webhook.js";
```

Modify `packages/core/src/index.ts` — add:

```typescript
export { WebhookSink } from "./sinks/index.js";
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 6: Commit**

```
feat(core): add WebhookSink for HTTP log drain
```

---

## Task 6: OpenTelemetry Sink

Export runes as OTLP spans — connects Heimdall to Datadog, Grafana, Honeycomb, etc.

**Files:**
- Create: `packages/core/src/sinks/opentelemetry.ts`
- Create: `packages/core/__tests__/otel-sink.test.ts`
- Modify: `packages/core/src/sinks/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/otel-sink.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { OpenTelemetrySink } from "../src/sinks/opentelemetry.js";
import type { Rune } from "../src/types.js";

function makeRune(overrides: Partial<Rune> = {}): Rune {
  return {
    sequence: 1,
    timestamp: "2025-01-01T00:00:00.000Z",
    session_id: "test-session",
    tool_name: "Bash",
    arguments_hash: "abc123",
    arguments_summary: '{"command":"echo hi"}',
    decision: "HALT",
    matched_wards: ["block-bash"],
    ward_chain: [],
    rationale: "Bash blocked",
    content_hash: "def456",
    previous_hash: "GENESIS",
    is_genesis: true,
    ...overrides,
  };
}

describe("OpenTelemetrySink", () => {
  test("has correct name", () => {
    const sink = new OpenTelemetrySink({ endpoint: "http://localhost:4318" });
    expect(sink.name).toBe("opentelemetry");
  });

  test("sends OTLP JSON to endpoint", async () => {
    let capturedBody: unknown = null;

    const sink = new OpenTelemetrySink({
      endpoint: "http://localhost:4318",
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as { resourceSpans: unknown[] };
    expect(body.resourceSpans).toBeDefined();
    expect(body.resourceSpans).toHaveLength(1);
  });

  test("includes custom headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const sink = new OpenTelemetrySink({
      endpoint: "http://localhost:4318",
      headers: { "api-key": "secret" },
      fetchFn: async (_url, init) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
        return new Response("ok", { status: 200 });
      },
    });

    await sink.emit(makeRune());
    expect(capturedHeaders["api-key"]).toBe("secret");
  });

  test("does not throw on failure", async () => {
    const sink = new OpenTelemetrySink({
      endpoint: "http://localhost:4318",
      fetchFn: async () => { throw new Error("Network error"); },
    });

    await expect(sink.emit(makeRune())).resolves.toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/otel-sink.test.ts`
Expected: FAIL

**Step 3: Implement OpenTelemetrySink**

Create `packages/core/src/sinks/opentelemetry.ts`:

We implement the OTLP/HTTP JSON protocol directly (no SDK dependency) — zero deps, works everywhere.

```typescript
import type { HeimdallSink } from "./types.js";
import type { Rune } from "../types.js";

export interface OpenTelemetrySinkOptions {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
  events?: string[];
  fetchFn?: typeof fetch;
}

/**
 * Exports runes as OTLP spans via HTTP/JSON.
 * Zero-dependency — implements OTLP protocol directly.
 * Compatible with any OTLP collector (Datadog, Grafana, Honeycomb, etc.).
 */
export class OpenTelemetrySink implements HeimdallSink {
  readonly name = "opentelemetry";
  private endpoint: string;
  private headers: Record<string, string>;
  private serviceName: string;
  private events?: Set<string>;
  private fetchFn: typeof fetch;

  constructor(options: OpenTelemetrySinkOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.headers = options.headers ?? {};
    this.serviceName = options.serviceName ?? "heimdall";
    this.events = options.events ? new Set(options.events) : undefined;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async emit(rune: Rune): Promise<void> {
    if (this.events && !this.events.has(rune.decision)) return;

    const now = Date.now();
    const startNano = BigInt(new Date(rune.timestamp).getTime()) * 1_000_000n;
    const durationNano = BigInt(rune.duration_ms ?? 0) * 1_000_000n;
    const endNano = startNano + durationNano;

    // Generate a trace ID and span ID from rune data
    const traceId = rune.content_hash.slice(0, 32);
    const spanId = rune.content_hash.slice(0, 16);

    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: this.serviceName } },
              { key: "heimdall.realm", value: { stringValue: "default" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "heimdall", version: "0.1.0" },
              spans: [
                {
                  traceId,
                  spanId,
                  name: `heimdall.${rune.decision.toLowerCase()}.${rune.tool_name}`,
                  kind: 1, // SPAN_KIND_INTERNAL
                  startTimeUnixNano: startNano.toString(),
                  endTimeUnixNano: endNano.toString(),
                  attributes: [
                    { key: "heimdall.tool_name", value: { stringValue: rune.tool_name } },
                    { key: "heimdall.decision", value: { stringValue: rune.decision } },
                    { key: "heimdall.rationale", value: { stringValue: rune.rationale } },
                    { key: "heimdall.session_id", value: { stringValue: rune.session_id } },
                    { key: "heimdall.sequence", value: { intValue: rune.sequence.toString() } },
                    { key: "heimdall.content_hash", value: { stringValue: rune.content_hash } },
                    { key: "heimdall.matched_wards", value: { stringValue: JSON.stringify(rune.matched_wards) } },
                  ],
                  status: {
                    code: rune.decision === "HALT" ? 2 : 1, // ERROR or OK
                    message: rune.decision === "HALT" ? rune.rationale : "",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      await this.fetchFn(`${this.endpoint}/v1/traces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(`[heimdall] otel sink error: ${err}`);
    }
  }
}
```

**Step 4: Update exports**

Modify `packages/core/src/sinks/index.ts` — add:

```typescript
export { OpenTelemetrySink } from "./opentelemetry.js";
```

Modify `packages/core/src/index.ts` — add:

```typescript
export { OpenTelemetrySink } from "./sinks/index.js";
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 6: Commit**

```
feat(core): add OpenTelemetrySink for OTLP log drain
```

---

## Task 7: Config Enhancements — Env Vars + Sinks Section

Enhance the YAML loader to support `${VAR}` env interpolation and a `sinks:` config section.

**Files:**
- Modify: `packages/core/src/yaml-loader.ts`
- Modify: `packages/core/src/types.ts` (add `SinkConfig` to `BifrostConfig`)
- Create: `packages/core/__tests__/yaml-loader.test.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/yaml-loader.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { loadBifrostConfig } from "../src/yaml-loader.js";

describe("YAML loader enhancements", () => {
  describe("environment variable interpolation", () => {
    test("replaces ${VAR} with env value", () => {
      process.env.TEST_WEBHOOK_URL = "https://hooks.slack.com/test";
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: webhook
    url: "\${TEST_WEBHOOK_URL}"
`);
      expect(config.sinks).toHaveLength(1);
      expect(config.sinks![0].url).toBe("https://hooks.slack.com/test");
      delete process.env.TEST_WEBHOOK_URL;
    });

    test("supports default values ${VAR:-default}", () => {
      delete process.env.MISSING_VAR;
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: opentelemetry
    endpoint: "\${MISSING_VAR:-http://localhost:4318}"
`);
      expect(config.sinks![0].endpoint).toBe("http://localhost:4318");
    });

    test("leaves unmatched ${VAR} as empty string when no default", () => {
      delete process.env.NONEXISTENT;
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: webhook
    url: "\${NONEXISTENT}"
`);
      expect(config.sinks![0].url).toBe("");
    });
  });

  describe("sinks config section", () => {
    test("parses sinks array from config", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: stdout
    events: [HALT]
  - type: webhook
    url: https://example.com/hook
    headers:
      Authorization: "Bearer token"
`);
      expect(config.sinks).toHaveLength(2);
      expect(config.sinks![0].type).toBe("stdout");
      expect(config.sinks![0].events).toEqual(["HALT"]);
      expect(config.sinks![1].type).toBe("webhook");
      expect(config.sinks![1].url).toBe("https://example.com/hook");
    });

    test("sinks defaults to empty array when absent", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
`);
      expect(config.sinks).toEqual([]);
    });
  });

  describe("storage config section", () => {
    test("parses storage adapter config", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
storage:
  adapter: sqlite
  path: .heimdall/runes.sqlite
`);
      expect(config.storage?.adapter).toBe("sqlite");
      expect(config.storage?.path).toBe(".heimdall/runes.sqlite");
    });

    test("storage defaults to undefined when absent", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
`);
      expect(config.storage).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/yaml-loader.test.ts`
Expected: FAIL

**Step 3: Update BifrostConfig type**

Modify `packages/core/src/types.ts` — add to `BifrostConfig`:

```typescript
export interface StorageConfig {
  adapter: string;
  [key: string]: unknown;
}

export interface BifrostConfig {
  version: string;
  realm: string;
  description?: string;
  wards: Ward[];
  defaults?: {
    action?: WardDecision;
    severity?: WardSeverity;
  };
  sinks?: SinkConfig[];
  storage?: StorageConfig;
  extends?: string[];
}

export interface SinkConfig {
  type: string;
  events?: string[];
  [key: string]: unknown;
}
```

Note: Move `SinkConfig` from `sinks/types.ts` to `types.ts` to avoid circular deps (sinks/types.ts can import from types.ts, and the config parser needs SinkConfig). Update `sinks/types.ts` to re-export from types.ts.

**Step 4: Implement env var interpolation and config parsing**

Modify `packages/core/src/yaml-loader.ts`:

Add `interpolateEnvVars` function before `loadBifrostConfig`:

```typescript
/**
 * Replace ${VAR} and ${VAR:-default} patterns with environment variables.
 */
function interpolateEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...defaultParts] = expr.split(":-");
    const defaultValue = defaultParts.join(":-"); // Handle :- in default values
    const envValue = process.env[varName.trim()];
    if (envValue !== undefined) return envValue;
    if (defaultParts.length > 0) return defaultValue;
    return "";
  });
}
```

Modify `loadBifrostConfig` — add env interpolation at the top and sinks/storage parsing at the bottom:

```typescript
export function loadBifrostConfig(yamlContent: string): BifrostConfig {
  const interpolated = interpolateEnvVars(yamlContent);
  const raw = parse(interpolated);
  // ... existing validation ...

  // After wards parsing, add:
  const sinks: SinkConfig[] = (raw.sinks ?? []).map((s: Record<string, unknown>) => ({
    ...s,
    type: String(s.type),
    events: s.events as string[] | undefined,
  }));

  const storage: StorageConfig | undefined = raw.storage
    ? { ...raw.storage, adapter: String(raw.storage.adapter) }
    : undefined;

  return {
    // ... existing fields ...
    sinks,
    storage,
    extends: raw.extends as string[] | undefined,
  };
}
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 6: Commit**

```
feat(core): add env var interpolation and sinks/storage config to bifrost.yaml
```

---

## Task 8: Heimdall SDK Class

The unified facade — the "5 lines to audit" experience.

**Files:**
- Create: `packages/core/src/heimdall.ts`
- Create: `packages/core/__tests__/heimdall-sdk.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/heimdall-sdk.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { Heimdall } from "../src/heimdall.js";
import type { HeimdallSink } from "../src/sinks/types.js";
import type { Rune } from "../src/types.js";

describe("Heimdall SDK", () => {
  test("evaluate + record flow with memory adapter", async () => {
    const heimdall = new Heimdall({
      config: {
        version: "1",
        realm: "test",
        wards: [
          {
            id: "block-rm",
            tool: "Bash",
            when: { argument_matches: { command: "rm -rf" } },
            action: "HALT",
            message: "Destructive command blocked",
            severity: "critical",
          },
        ],
      },
      adapter: "memory",
    });

    const result = await heimdall.evaluate({
      sessionId: "s1",
      tool: "Bash",
      arguments: { command: "rm -rf /" },
    });

    expect(result.decision).toBe("HALT");
    expect(result.rationale).toContain("Destructive");
    expect(result.rune.content_hash).toMatch(/^[0-9a-f]{64}$/);

    heimdall.close();
  });

  test("PASS decision works", async () => {
    const heimdall = new Heimdall({
      config: {
        version: "1",
        realm: "test",
        wards: [],
      },
      adapter: "memory",
    });

    const result = await heimdall.evaluate({
      sessionId: "s1",
      tool: "Read",
      arguments: { path: "./src/index.ts" },
    });

    expect(result.decision).toBe("PASS");
    heimdall.close();
  });

  test("sinks receive emitted runes", async () => {
    const emitted: Rune[] = [];
    const testSink: HeimdallSink = {
      name: "test",
      emit: async (rune) => { emitted.push(rune); },
    };

    const heimdall = new Heimdall({
      config: { version: "1", realm: "test", wards: [] },
      adapter: "memory",
      sinks: [testSink],
    });

    await heimdall.evaluate({
      sessionId: "s1",
      tool: "Bash",
      arguments: { command: "echo hello" },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].tool_name).toBe("Bash");
    heimdall.close();
  });

  test("getStats returns chain stats", async () => {
    const heimdall = new Heimdall({
      config: { version: "1", realm: "test", wards: [] },
      adapter: "memory",
    });

    await heimdall.evaluate({ sessionId: "s1", tool: "Bash", arguments: {} });
    await heimdall.evaluate({ sessionId: "s1", tool: "Read", arguments: {} });

    const stats = heimdall.getStats();
    expect(stats.total_runes).toBe(2);
    expect(stats.unique_tools).toBe(2);
    heimdall.close();
  });

  test("verify returns chain verification", async () => {
    const heimdall = new Heimdall({
      config: { version: "1", realm: "test", wards: [] },
      adapter: "memory",
    });

    await heimdall.evaluate({ sessionId: "s1", tool: "Bash", arguments: {} });

    const result = await heimdall.verify();
    expect(result.valid).toBe(true);
    expect(result.total_runes).toBe(1);
    heimdall.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/heimdall-sdk.test.ts`
Expected: FAIL

**Step 3: Implement Heimdall SDK class**

Create `packages/core/src/heimdall.ts`:

```typescript
import { WardEngine } from "./ward-engine.js";
import type { RateLimitProvider } from "./ward-engine.js";
import { MemoryAdapter } from "./adapters/memory.js";
import type { RunechainAdapter } from "./adapters/types.js";
import type { HeimdallSink } from "./sinks/types.js";
import type {
  BifrostConfig,
  Rune,
  ToolCallContext,
  WardEvaluation,
  ChainStats,
  ChainVerificationResult,
} from "./types.js";

export interface HeimdallOptions {
  /** BifrostConfig object (already parsed). */
  config: BifrostConfig;
  /** Storage adapter — "memory" for built-in, or pass a RunechainAdapter instance. */
  adapter?: "memory" | RunechainAdapter;
  /** Sinks for log drain. */
  sinks?: HeimdallSink[];
  /** Custom rate limit provider. Defaults to adapter-backed. */
  rateLimitProvider?: RateLimitProvider;
}

export interface EvaluateInput {
  sessionId: string;
  tool: string;
  arguments: Record<string, unknown>;
  agentId?: string;
  serverId?: string;
}

export interface EvaluateResult {
  decision: string;
  rationale: string;
  matchedWards: string[];
  reshapedArguments?: Record<string, unknown>;
  rune: Rune;
  evaluationDurationMs: number;
}

/**
 * Heimdall SDK — the unified facade.
 *
 * ```typescript
 * const heimdall = new Heimdall({ config, adapter: "memory" });
 * const result = await heimdall.evaluate({ sessionId, tool, arguments });
 * if (result.decision === "HALT") { /* blocked *\/ }
 * ```
 */
export class Heimdall {
  private engine: WardEngine;
  private adapter: RunechainAdapter;
  private sinks: HeimdallSink[];

  constructor(options: HeimdallOptions) {
    const adapter =
      options.adapter === "memory" || options.adapter === undefined
        ? new MemoryAdapter()
        : options.adapter;

    const rateLimitProvider =
      options.rateLimitProvider ??
      ((sessionId: string, toolName: string, windowMs: number) =>
        adapter.getRecentCallCount(sessionId, toolName, windowMs));

    this.engine = new WardEngine(options.config, { rateLimitProvider });
    this.adapter = adapter;
    this.sinks = options.sinks ?? [];
  }

  /** Evaluate a tool call against wards, inscribe a rune, and emit to sinks. */
  async evaluate(input: EvaluateInput): Promise<EvaluateResult> {
    const ctx: ToolCallContext = {
      tool_name: input.tool,
      arguments: input.arguments,
      session_id: input.sessionId,
      agent_id: input.agentId,
      server_id: input.serverId,
    };

    const evaluation = this.engine.evaluate(ctx);
    const rune = await this.adapter.inscribeRune(ctx, evaluation);

    // Emit to all sinks (fire-and-forget)
    await Promise.allSettled(this.sinks.map((sink) => sink.emit(rune)));

    return {
      decision: evaluation.decision,
      rationale: evaluation.rationale,
      matchedWards: evaluation.matched_wards,
      reshapedArguments: evaluation.reshaped_arguments,
      rune,
      evaluationDurationMs: evaluation.evaluation_duration_ms,
    };
  }

  /** Update the last rune with response data. */
  async recordResponse(responseSummary: string, durationMs?: number): Promise<Rune | null> {
    return this.adapter.updateLastRuneResponse(responseSummary, durationMs);
  }

  /** Get chain statistics. */
  getStats(): ChainStats {
    return this.adapter.getChainStats();
  }

  /** Verify chain integrity. */
  async verify(): Promise<ChainVerificationResult> {
    return this.adapter.verifyChain();
  }

  /** Get the underlying adapter (for advanced use). */
  getAdapter(): RunechainAdapter {
    return this.adapter;
  }

  /** Gracefully close all resources. */
  close(): void {
    this.adapter.close();
    Promise.allSettled(
      this.sinks
        .filter((s) => s.close)
        .map((s) => s.close!())
    );
  }
}
```

**Step 4: Update core index**

Modify `packages/core/src/index.ts` — add:

```typescript
export { Heimdall } from "./heimdall.js";
export type { HeimdallOptions, EvaluateInput, EvaluateResult } from "./heimdall.js";
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 6: Commit**

```
feat(core): add Heimdall SDK class as unified facade
```

---

## Task 9: Custom Conditions Plugin System

Allow `engine.registerCondition()` for user-defined ward conditions.

**Files:**
- Modify: `packages/core/src/ward-engine.ts`
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/__tests__/custom-conditions.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/custom-conditions.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { WardEngine } from "../src/ward-engine.js";
import { loadBifrostConfig } from "../src/yaml-loader.js";
import type { ConditionPlugin, ToolCallContext } from "../src/types.js";

function makeCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    tool_name: "Bash",
    arguments: { command: "echo hello" },
    session_id: "test-session",
    ...overrides,
  };
}

describe("Custom Conditions", () => {
  test("registerCondition adds a custom condition", () => {
    const config = loadBifrostConfig(`
version: "1"
realm: test
wards:
  - id: after-hours
    tool: "*"
    when:
      outside_business_hours: true
    action: HALT
    message: "Blocked outside business hours"
    severity: high
`);

    const plugin: ConditionPlugin = {
      name: "outside_business_hours",
      evaluate: (_value, _ctx) => {
        // Simulate: always "outside hours" for test
        return true;
      },
    };

    const engine = new WardEngine(config);
    engine.registerCondition(plugin);

    const result = engine.evaluate(makeCtx());
    expect(result.decision).toBe("HALT");
    expect(result.matched_wards).toContain("after-hours");
  });

  test("custom condition receives the config value", () => {
    const config = loadBifrostConfig(`
version: "1"
realm: test
wards:
  - id: custom-threshold
    tool: "*"
    when:
      cost_exceeds: 100
    action: HALT
    message: "Cost limit exceeded"
    severity: high
`);

    let receivedValue: unknown;
    const plugin: ConditionPlugin = {
      name: "cost_exceeds",
      evaluate: (value, _ctx) => {
        receivedValue = value;
        return true;
      },
    };

    const engine = new WardEngine(config);
    engine.registerCondition(plugin);
    engine.evaluate(makeCtx());

    expect(receivedValue).toBe(100);
  });

  test("unregistered custom condition is ignored (fail-open)", () => {
    const config = loadBifrostConfig(`
version: "1"
realm: test
wards:
  - id: unknown-cond
    tool: "*"
    when:
      some_unknown_condition: true
    action: HALT
    message: "Should not match"
    severity: high
`);

    const engine = new WardEngine(config);
    const result = engine.evaluate(makeCtx());
    // Unknown conditions should not match → PASS
    expect(result.decision).toBe("PASS");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/custom-conditions.test.ts`
Expected: FAIL

**Step 3: Add ConditionPlugin type**

Modify `packages/core/src/types.ts` — add:

```typescript
/** Plugin for custom ward conditions. */
export interface ConditionPlugin {
  /** The condition name as used in bifrost.yaml `when:` blocks. */
  name: string;
  /** Evaluate the condition. Returns true if the condition matches. */
  evaluate: (value: unknown, ctx: ToolCallContext) => boolean;
}
```

**Step 4: Implement registerCondition in WardEngine**

Modify `packages/core/src/ward-engine.ts`:

Add to the class:

```typescript
private customConditions: Map<string, ConditionPlugin> = new Map();

registerCondition(plugin: ConditionPlugin): void {
  this.customConditions.set(plugin.name, plugin);
}
```

Modify `conditionMatches` method — after the `max_calls_per_minute` block and before `return true`, add:

```typescript
// Check custom conditions
const builtinKeys = new Set([
  "argument_matches",
  "argument_contains_pattern",
  "always",
  "max_calls_per_minute",
]);

for (const [key, value] of Object.entries(when)) {
  if (builtinKeys.has(key)) continue;
  const plugin = this.customConditions.get(key);
  if (!plugin) return false; // Unknown condition → doesn't match
  if (!plugin.evaluate(value, ctx)) return false;
}
```

**Step 5: Update exports**

Modify `packages/core/src/index.ts` — add:

```typescript
export type { ConditionPlugin } from "./types.js";
```

**Step 6: Update WardCondition type to allow arbitrary keys**

Modify `packages/core/src/types.ts` — add index signature to `WardCondition`:

```typescript
export interface WardCondition {
  argument_matches?: Record<string, string>;
  argument_contains_pattern?: string;
  always?: boolean;
  max_calls_per_minute?: number;
  /** Allow custom condition keys from plugins. */
  [key: string]: unknown;
}
```

**Step 7: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 8: Commit**

```
feat(core): add custom condition plugin system via registerCondition()
```

---

## Task 10: Policy Composition (extends)

Allow bifrost.yaml to compose from local files.

**Files:**
- Modify: `packages/core/src/yaml-loader.ts`
- Create: `packages/core/__tests__/policy-composition.test.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/policy-composition.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadBifrostFile } from "../src/yaml-loader.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";

const TEST_DIR = "/tmp/heimdall-compose-test";

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe("Policy Composition", () => {
  beforeEach(setup);
  afterEach(teardown);

  test("extends merges wards from local files", async () => {
    // Base policy
    writeFileSync(`${TEST_DIR}/base.yaml`, `
version: "1"
realm: base
wards:
  - id: base-ward
    tool: Bash
    action: HALT
    message: Base ward
    severity: high
`);

    // Main policy extends base
    writeFileSync(`${TEST_DIR}/bifrost.yaml`, `
version: "1"
realm: myproject
extends:
  - ./base.yaml
wards:
  - id: local-ward
    tool: Read
    action: PASS
    message: Local ward
    severity: low
`);

    const config = await loadBifrostFile(`${TEST_DIR}/bifrost.yaml`);

    // Should have wards from base + local
    expect(config.wards).toHaveLength(2);
    expect(config.wards.map((w) => w.id)).toContain("base-ward");
    expect(config.wards.map((w) => w.id)).toContain("local-ward");
  });

  test("local wards come after extended wards (local overrides)", async () => {
    writeFileSync(`${TEST_DIR}/base.yaml`, `
version: "1"
realm: base
wards:
  - id: ward-a
    tool: "*"
    when:
      always: true
    action: PASS
    message: Base pass
    severity: low
`);

    writeFileSync(`${TEST_DIR}/bifrost.yaml`, `
version: "1"
realm: test
extends:
  - ./base.yaml
wards:
  - id: ward-b
    tool: Bash
    action: HALT
    message: Local halt
    severity: critical
`);

    const config = await loadBifrostFile(`${TEST_DIR}/bifrost.yaml`);
    // Extended wards first, then local wards
    expect(config.wards[0].id).toBe("ward-a");
    expect(config.wards[1].id).toBe("ward-b");
  });

  test("missing extends file throws", async () => {
    writeFileSync(`${TEST_DIR}/bifrost.yaml`, `
version: "1"
realm: test
extends:
  - ./nonexistent.yaml
wards: []
`);

    expect(loadBifrostFile(`${TEST_DIR}/bifrost.yaml`)).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/policy-composition.test.ts`
Expected: FAIL

**Step 3: Implement extends in loadBifrostFile**

Modify `packages/core/src/yaml-loader.ts` — update `loadBifrostFile`:

```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

export async function loadBifrostFile(path: string): Promise<BifrostConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`bifrost.yaml not found at: ${path}`);
  }
  const content = await file.text();
  const config = loadBifrostConfig(content);

  // Handle extends — resolve relative to the config file's directory
  if (config.extends && config.extends.length > 0) {
    const baseDir = dirname(resolve(path));
    const extendedWards: Ward[] = [];

    for (const extPath of config.extends) {
      const resolvedPath = resolve(baseDir, extPath);
      const extContent = readFileSync(resolvedPath, "utf-8");
      const extConfig = loadBifrostConfig(extContent);
      extendedWards.push(...extConfig.wards);
    }

    // Extended wards first, then local wards
    config.wards = [...extendedWards, ...config.wards];
  }

  return config;
}
```

**Step 4: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 5: Commit**

```
feat(core): add policy composition via extends in bifrost.yaml
```

---

## Task 11: JSON Schema for bifrost.yaml

Enable autocomplete in any editor that supports JSON Schema for YAML.

**Files:**
- Create: `schemas/bifrost.schema.json`

**Step 1: Create the JSON Schema**

Create `schemas/bifrost.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://heimdall.dev/schemas/bifrost.schema.json",
  "title": "Heimdall Bifrost Configuration",
  "description": "Policy configuration for Heimdall AI agent audit gateway",
  "type": "object",
  "required": ["version", "realm"],
  "properties": {
    "version": {
      "type": "string",
      "description": "Config version",
      "enum": ["1"]
    },
    "realm": {
      "type": "string",
      "description": "Project or environment identifier"
    },
    "description": {
      "type": "string",
      "description": "Human-readable description of this policy"
    },
    "extends": {
      "type": "array",
      "description": "Paths to base policy files to inherit wards from",
      "items": { "type": "string" }
    },
    "defaults": {
      "type": "object",
      "properties": {
        "action": { "$ref": "#/$defs/action" },
        "severity": { "$ref": "#/$defs/severity" }
      }
    },
    "wards": {
      "type": "array",
      "description": "Policy rules evaluated against tool calls",
      "items": { "$ref": "#/$defs/ward" }
    },
    "sinks": {
      "type": "array",
      "description": "Log drain configurations",
      "items": { "$ref": "#/$defs/sink" }
    },
    "storage": {
      "type": "object",
      "description": "Storage adapter configuration",
      "properties": {
        "adapter": {
          "type": "string",
          "enum": ["sqlite", "memory", "postgres"],
          "description": "Storage backend type"
        }
      },
      "required": ["adapter"]
    }
  },
  "$defs": {
    "action": {
      "type": "string",
      "enum": ["PASS", "HALT", "RESHAPE"],
      "description": "Ward decision action"
    },
    "severity": {
      "type": "string",
      "enum": ["low", "medium", "high", "critical"],
      "description": "Ward severity level"
    },
    "ward": {
      "type": "object",
      "required": ["tool", "action", "message", "severity"],
      "properties": {
        "id": { "type": "string", "description": "Unique ward identifier" },
        "description": { "type": "string" },
        "tool": {
          "type": "string",
          "description": "Glob pattern for tool matching (*, file_*, Bash)"
        },
        "when": {
          "type": "object",
          "description": "Conditions (AND logic — all must match)",
          "properties": {
            "argument_matches": {
              "type": "object",
              "additionalProperties": { "type": "string" },
              "description": "Regex patterns matched against specific argument fields"
            },
            "argument_contains_pattern": {
              "type": "string",
              "description": "Regex matched against serialized arguments JSON"
            },
            "always": {
              "type": "boolean",
              "description": "Unconditional match"
            },
            "max_calls_per_minute": {
              "type": "integer",
              "minimum": 1,
              "description": "Rate limit: max calls per minute per session+tool"
            }
          },
          "additionalProperties": true
        },
        "action": { "$ref": "#/$defs/action" },
        "message": { "type": "string", "description": "Human-readable reason" },
        "severity": { "$ref": "#/$defs/severity" },
        "reshape": {
          "type": "object",
          "description": "Argument transformations for RESHAPE action",
          "additionalProperties": true
        }
      }
    },
    "sink": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "type": "string",
          "enum": ["stdout", "webhook", "opentelemetry"],
          "description": "Sink type"
        },
        "events": {
          "type": "array",
          "items": { "$ref": "#/$defs/action" },
          "description": "Only emit runes with these decisions"
        },
        "url": { "type": "string", "description": "Webhook URL" },
        "endpoint": { "type": "string", "description": "OTLP endpoint" },
        "headers": {
          "type": "object",
          "additionalProperties": { "type": "string" },
          "description": "HTTP headers"
        }
      }
    }
  }
}
```

**Step 2: Commit**

```
feat: add JSON Schema for bifrost.yaml autocomplete
```

---

## Task 12: CLI — `heimdall validate`

Validate bifrost.yaml without starting the proxy.

**Files:**
- Create: `packages/cli/src/commands/validate.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Implement validate command**

Create `packages/cli/src/commands/validate.ts`:

```typescript
import chalk from "chalk";
import { loadBifrostFile } from "@heimdall/core";

export async function validateCommand(options: { config: string }): Promise<void> {
  try {
    const config = await loadBifrostFile(options.config);

    console.log(chalk.green("✓") + " bifrost.yaml is valid\n");
    console.log(`  Realm:   ${chalk.cyan(config.realm)}`);
    console.log(`  Version: ${config.version}`);
    console.log(`  Wards:   ${config.wards.length}`);

    // Count by action
    const actions: Record<string, number> = {};
    for (const ward of config.wards) {
      actions[ward.action] = (actions[ward.action] ?? 0) + 1;
    }

    for (const [action, count] of Object.entries(actions)) {
      const color = action === "HALT" ? chalk.red : action === "RESHAPE" ? chalk.yellow : chalk.green;
      console.log(`           ${color(action)}: ${count}`);
    }

    // Sinks
    if (config.sinks && config.sinks.length > 0) {
      console.log(`  Sinks:   ${config.sinks.length}`);
      for (const sink of config.sinks) {
        console.log(`           ${chalk.blue(sink.type)}`);
      }
    }

    // Extends
    if (config.extends && config.extends.length > 0) {
      console.log(`  Extends: ${config.extends.join(", ")}`);
    }

    // Warnings
    const warnings: string[] = [];

    // Check for duplicate ward IDs
    const ids = config.wards.map((w) => w.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      warnings.push(`Duplicate ward IDs: ${dupes.join(", ")}`);
    }

    // Check for unreachable wards (wildcard HALT before specific PASS)
    for (let i = 0; i < config.wards.length; i++) {
      const ward = config.wards[i];
      if (ward.tool === "*" && ward.action === "HALT" && ward.when?.always) {
        const after = config.wards.slice(i + 1);
        if (after.some((w) => w.action === "PASS")) {
          warnings.push(`Ward "${ward.id}" (HALT *) may shadow subsequent PASS wards`);
        }
      }
    }

    if (warnings.length > 0) {
      console.log();
      for (const w of warnings) {
        console.log(chalk.yellow("⚠ ") + w);
      }
    }
  } catch (err) {
    console.error(chalk.red("✗") + ` Invalid configuration: ${err}`);
    process.exit(1);
  }
}
```

**Step 2: Register in CLI**

Modify `packages/cli/src/index.ts` — add import and command:

```typescript
import { validateCommand } from "./commands/validate.js";

program
  .command("validate")
  .description("Validate bifrost.yaml configuration")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .action(validateCommand);
```

**Step 3: Test manually**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun run heimdall validate --config bifrost.yaml`
Expected: Shows ✓ valid with ward summary

**Step 4: Commit**

```
feat(cli): add validate command for bifrost.yaml
```

---

## Task 13: CLI — `heimdall doctor`

Diagnostic command to check config, DB, and sink health.

**Files:**
- Create: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Implement doctor command**

Create `packages/cli/src/commands/doctor.ts`:

```typescript
import chalk from "chalk";
import { existsSync } from "fs";
import { loadBifrostFile, Runechain } from "@heimdall/core";

export async function doctorCommand(options: {
  config: string;
  db: string;
}): Promise<void> {
  let hasErrors = false;

  // Check config
  try {
    const config = await loadBifrostFile(options.config);
    console.log(chalk.green("✓") + ` Config: ${options.config} loaded (${config.wards.length} wards)`);
  } catch (err) {
    console.log(chalk.red("✗") + ` Config: ${err}`);
    hasErrors = true;
  }

  // Check DB
  if (existsSync(options.db)) {
    try {
      const chain = new Runechain(options.db);
      const count = chain.getRuneCount();
      console.log(chalk.green("✓") + ` Storage: SQLite connected (${count} runes)`);

      // Check chain integrity
      const verification = await chain.verifyChain();
      if (verification.valid) {
        console.log(chalk.green("✓") + ` Chain: Integrity verified (${verification.verified_runes} runes)`);
      } else {
        console.log(chalk.red("✗") + ` Chain: ${verification.broken_reason}`);
        hasErrors = true;
      }

      chain.close();
    } catch (err) {
      console.log(chalk.red("✗") + ` Storage: ${err}`);
      hasErrors = true;
    }
  } else {
    console.log(chalk.yellow("○") + ` Storage: No database at ${options.db} (will be created on first use)`);
  }

  // Check .heimdall directory
  if (existsSync(".heimdall")) {
    console.log(chalk.green("✓") + " Directory: .heimdall/ exists");
  } else {
    console.log(chalk.yellow("○") + ' Directory: .heimdall/ missing (run "heimdall init")');
  }

  // Check Ed25519 keys
  if (existsSync(".heimdall/heimdall.key") && existsSync(".heimdall/heimdall.pub")) {
    console.log(chalk.green("✓") + " Keys: Ed25519 signing keys present");
  } else {
    console.log(chalk.yellow("○") + " Keys: No signing keys (will be generated on first use)");
  }

  console.log();
  if (hasErrors) {
    console.log(chalk.red("Issues found. Fix the errors above."));
    process.exit(1);
  } else {
    console.log(chalk.green("All checks passed."));
  }
}
```

**Step 2: Register in CLI**

Modify `packages/cli/src/index.ts` — add import and command:

```typescript
import { doctorCommand } from "./commands/doctor.js";

program
  .command("doctor")
  .description("Check Heimdall health: config, database, chain integrity")
  .option("--config <path>", "Path to bifrost.yaml", "./bifrost.yaml")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action(doctorCommand);
```

**Step 3: Test manually**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun run heimdall doctor`

**Step 4: Commit**

```
feat(cli): add doctor command for health diagnostics
```

---

## Task 14: CLI — `--dry-run` Flag on Guard

Evaluate policies but don't block — log what would happen.

**Files:**
- Modify: `packages/proxy/src/bifrost.ts` (add `dryRun` option)
- Modify: `packages/cli/src/commands/guard.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Add dryRun to BifrostOptions**

Modify `packages/proxy/src/bifrost.ts`:

Add `dryRun?: boolean;` to `BifrostOptions`.

In the `CallToolRequestSchema` handler, when `dryRun` is true and decision is HALT:

```typescript
if (evaluation.decision === "HALT") {
  const rune = await runechain.inscribeRune(ctx, evaluation);
  wsBridge.broadcast(rune);
  options.onRune?.(rune);

  if (options.dryRun) {
    console.error(`[HEIMDALL] DRY-RUN HALT: ${toolName} — ${evaluation.rationale} (would block, allowing)`);
    // Fall through to forward the call
  } else {
    console.error(`[HEIMDALL] HALT: ${toolName} — ${evaluation.rationale}`);
    return {
      content: [{ type: "text" as const, text: `[HEIMDALL] Tool call blocked: ${evaluation.rationale}` }],
      isError: true,
    };
  }
}
```

**Step 2: Wire up CLI flag**

Modify `packages/cli/src/index.ts` — add `--dry-run` to guard command:

```typescript
.option("--dry-run", "Evaluate policies but don't block (audit-only mode)")
```

Modify `packages/cli/src/commands/guard.ts` — pass `dryRun`:

```typescript
dryRun: options.dryRun,
```

**Step 3: Commit**

```
feat(proxy): add --dry-run flag for audit-only mode
```

---

## Task 15: CLI — `heimdall replay`

Replay an audit trail against a new policy to see what would change.

**Files:**
- Create: `packages/cli/src/commands/replay.ts`
- Modify: `packages/cli/src/index.ts`

**Step 1: Implement replay command**

Create `packages/cli/src/commands/replay.ts`:

```typescript
import chalk from "chalk";
import { loadBifrostFile, Runechain, WardEngine } from "@heimdall/core";
import type { ToolCallContext } from "@heimdall/core";

export async function replayCommand(options: {
  config: string;
  db: string;
}): Promise<void> {
  const config = await loadBifrostFile(options.config);
  const engine = new WardEngine(config);
  const chain = new Runechain(options.db);

  const runes = chain.getRunes(); // All runes, newest first
  runes.reverse(); // Process in chronological order

  let changed = 0;
  let total = 0;

  for (const rune of runes) {
    total++;

    // Reconstruct tool call context (we don't have original args, only hash + summary)
    const ctx: ToolCallContext = {
      tool_name: rune.tool_name,
      arguments: {}, // We can't recover original args from hash — evaluate tool match only
      session_id: rune.session_id,
    };

    const newEval = engine.evaluate(ctx);

    if (newEval.decision !== rune.decision) {
      changed++;
      const oldColor = rune.decision === "HALT" ? chalk.red : rune.decision === "RESHAPE" ? chalk.yellow : chalk.green;
      const newColor = newEval.decision === "HALT" ? chalk.red : newEval.decision === "RESHAPE" ? chalk.yellow : chalk.green;

      console.log(
        `  #${rune.sequence} ${chalk.dim(rune.tool_name)} ` +
        `${oldColor(rune.decision)} → ${newColor(newEval.decision)} ` +
        chalk.dim(`(${newEval.rationale})`)
      );
    }
  }

  console.log();
  if (changed === 0) {
    console.log(chalk.green(`✓ No changes — all ${total} runes would have the same decision.`));
  } else {
    console.log(chalk.yellow(`⚠ ${changed}/${total} runes would change decision with the new policy.`));
  }

  chain.close();
}
```

**Step 2: Register in CLI**

Modify `packages/cli/src/index.ts`:

```typescript
import { replayCommand } from "./commands/replay.js";

program
  .command("replay")
  .description("Replay audit trail against a new policy to preview changes")
  .option("--config <path>", "Path to new bifrost.yaml", "./bifrost.yaml")
  .option("--db <path>", "Path to SQLite database", "./.heimdall/runes.sqlite")
  .action(replayCommand);
```

**Step 3: Commit**

```
feat(cli): add replay command for policy change preview
```

---

## Task 16: Policy Testing Framework

A `testPolicy()` DSL for asserting ward behavior.

**Files:**
- Create: `packages/testing/package.json`
- Create: `packages/testing/src/index.ts`
- Create: `packages/testing/__tests__/testing-framework.test.ts`

**Step 1: Create package**

Create `packages/testing/package.json`:

```json
{
  "name": "@heimdall/testing",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@heimdall/core": "workspace:*"
  }
}
```

**Step 2: Write the failing test**

Create `packages/testing/__tests__/testing-framework.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { testPolicy } from "../src/index.js";

describe("testPolicy DSL", () => {
  test("toBeHalted assertion works", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards:
  - id: block-rm
    tool: Bash
    when:
      argument_matches:
        command: "rm -rf"
    action: HALT
    message: Blocked
    severity: critical
`, (t) => {
      t.expect("Bash", { command: "rm -rf /" }).toBeHalted();
    });

    expect(results.passed).toBe(1);
    expect(results.failed).toBe(0);
  });

  test("toPass assertion works", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards: []
`, (t) => {
      t.expect("Bash", { command: "echo hello" }).toPass();
    });

    expect(results.passed).toBe(1);
    expect(results.failed).toBe(0);
  });

  test("failed assertion is recorded", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards: []
`, (t) => {
      t.expect("Bash", { command: "echo hello" }).toBeHalted();
    });

    expect(results.passed).toBe(0);
    expect(results.failed).toBe(1);
    expect(results.failures[0]).toContain("expected HALT");
  });

  test("toBeReshaped assertion works", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards:
  - id: reshape-bash
    tool: Bash
    action: RESHAPE
    message: Reshaped
    severity: medium
    reshape:
      safe: true
`, (t) => {
      t.expect("Bash", { command: "deploy" }).toBeReshaped();
    });

    expect(results.passed).toBe(1);
  });

  test("multiple assertions in one policy", () => {
    const results = testPolicy(`
version: "1"
realm: test
wards:
  - id: block-rm
    tool: Bash
    when:
      argument_matches:
        command: "rm -rf"
    action: HALT
    message: Blocked
    severity: critical
`, (t) => {
      t.expect("Bash", { command: "rm -rf /" }).toBeHalted();
      t.expect("Bash", { command: "echo hello" }).toPass();
      t.expect("Read", { path: "./file.ts" }).toPass();
    });

    expect(results.passed).toBe(3);
    expect(results.failed).toBe(0);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/testing/__tests__/testing-framework.test.ts`
Expected: FAIL

**Step 4: Implement the testing framework**

Create `packages/testing/src/index.ts`:

```typescript
import { WardEngine, loadBifrostConfig } from "@heimdall/core";
import type { BifrostConfig, ToolCallContext, WardDecision } from "@heimdall/core";

export interface PolicyTestResults {
  passed: number;
  failed: number;
  total: number;
  failures: string[];
}

interface Assertion {
  toolName: string;
  args: Record<string, unknown>;
  toBeHalted: () => void;
  toPass: () => void;
  toBeReshaped: () => void;
}

class PolicyTestContext {
  private engine: WardEngine;
  private results: PolicyTestResults = { passed: 0, failed: 0, total: 0, failures: [] };

  constructor(config: BifrostConfig) {
    this.engine = new WardEngine(config);
  }

  expect(toolName: string, args: Record<string, unknown>): Assertion {
    const ctx: ToolCallContext = {
      tool_name: toolName,
      arguments: args,
      session_id: "test",
    };
    const evaluation = this.engine.evaluate(ctx);

    const assert = (expected: WardDecision) => {
      this.results.total++;
      if (evaluation.decision === expected) {
        this.results.passed++;
      } else {
        this.results.failed++;
        this.results.failures.push(
          `${toolName}(${JSON.stringify(args)}): expected ${expected}, got ${evaluation.decision}`
        );
      }
    };

    return {
      toolName,
      args,
      toBeHalted: () => assert("HALT"),
      toPass: () => assert("PASS"),
      toBeReshaped: () => assert("RESHAPE"),
    };
  }

  getResults(): PolicyTestResults {
    return this.results;
  }
}

/**
 * Test a policy against expected tool call decisions.
 *
 * ```typescript
 * const results = testPolicy(yamlContent, (t) => {
 *   t.expect("Bash", { command: "rm -rf /" }).toBeHalted();
 *   t.expect("Read", { path: "./file.ts" }).toPass();
 * });
 * ```
 */
export function testPolicy(
  yamlOrConfig: string | BifrostConfig,
  fn: (t: PolicyTestContext) => void
): PolicyTestResults {
  const config =
    typeof yamlOrConfig === "string"
      ? loadBifrostConfig(yamlOrConfig)
      : yamlOrConfig;

  const ctx = new PolicyTestContext(config);
  fn(ctx);
  return ctx.getResults();
}
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 6: Commit**

```
feat(testing): add policy testing framework with testPolicy() DSL
```

---

## Task 17: Sink Factory — Wire Sinks from Config

Create a factory that instantiates sinks from bifrost.yaml config.

**Files:**
- Create: `packages/core/src/sinks/factory.ts`
- Create: `packages/core/__tests__/sink-factory.test.ts`
- Modify: `packages/core/src/sinks/index.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

Create `packages/core/__tests__/sink-factory.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createSinks } from "../src/sinks/factory.js";
import { StdoutSink } from "../src/sinks/stdout.js";
import { WebhookSink } from "../src/sinks/webhook.js";
import { OpenTelemetrySink } from "../src/sinks/opentelemetry.js";
import type { SinkConfig } from "../src/types.js";

describe("createSinks factory", () => {
  test("creates StdoutSink from config", () => {
    const configs: SinkConfig[] = [{ type: "stdout" }];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("stdout");
  });

  test("creates WebhookSink from config", () => {
    const configs: SinkConfig[] = [
      { type: "webhook", url: "https://example.com/hook" },
    ];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("webhook");
  });

  test("creates OpenTelemetrySink from config", () => {
    const configs: SinkConfig[] = [
      { type: "opentelemetry", endpoint: "http://localhost:4318" },
    ];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(1);
    expect(sinks[0].name).toBe("opentelemetry");
  });

  test("creates multiple sinks", () => {
    const configs: SinkConfig[] = [
      { type: "stdout" },
      { type: "webhook", url: "https://example.com" },
    ];
    const sinks = createSinks(configs);
    expect(sinks).toHaveLength(2);
  });

  test("throws on unknown sink type", () => {
    const configs: SinkConfig[] = [{ type: "unknown" }];
    expect(() => createSinks(configs)).toThrow("Unknown sink type: unknown");
  });

  test("empty array returns empty", () => {
    const sinks = createSinks([]);
    expect(sinks).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test packages/core/__tests__/sink-factory.test.ts`
Expected: FAIL

**Step 3: Implement the factory**

Create `packages/core/src/sinks/factory.ts`:

```typescript
import type { HeimdallSink, SinkConfig } from "./types.js";
import { StdoutSink } from "./stdout.js";
import { WebhookSink } from "./webhook.js";
import { OpenTelemetrySink } from "./opentelemetry.js";

/**
 * Create sink instances from bifrost.yaml sink configurations.
 */
export function createSinks(configs: SinkConfig[]): HeimdallSink[] {
  return configs.map((config) => {
    switch (config.type) {
      case "stdout":
        return new StdoutSink({
          events: config.events as string[] | undefined,
        });

      case "webhook":
        return new WebhookSink({
          url: config.url as string,
          headers: config.headers as Record<string, string> | undefined,
          events: config.events as string[] | undefined,
        });

      case "opentelemetry":
        return new OpenTelemetrySink({
          endpoint: config.endpoint as string,
          headers: config.headers as Record<string, string> | undefined,
          serviceName: config.serviceName as string | undefined,
          events: config.events as string[] | undefined,
        });

      default:
        throw new Error(`Unknown sink type: ${config.type}`);
    }
  });
}
```

**Step 4: Update exports**

Modify `packages/core/src/sinks/index.ts` — add:

```typescript
export { createSinks } from "./factory.js";
```

Modify `packages/core/src/index.ts` — add:

```typescript
export { createSinks } from "./sinks/index.js";
```

**Step 5: Run tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 6: Commit**

```
feat(core): add sink factory to create sinks from bifrost.yaml config
```

---

## Task 18: Wire Sinks into Bifrost Proxy

Connect the sink system to the MCP proxy so runes flow to configured sinks.

**Files:**
- Modify: `packages/proxy/src/bifrost.ts`

**Step 1: Wire sinks into startBifrost**

Modify `packages/proxy/src/bifrost.ts`:

Add import:

```typescript
import { createSinks } from "@heimdall/core";
import type { HeimdallSink } from "@heimdall/core";
```

After loading config, create sinks:

```typescript
const sinks: HeimdallSink[] = createSinks(config.sinks ?? []);
if (sinks.length > 0) {
  console.error(`[HEIMDALL] Sinks: ${sinks.map((s) => s.name).join(", ")}`);
}
```

After each `wsBridge.broadcast(rune)`, add sink emission:

```typescript
await Promise.allSettled(sinks.map((s) => s.emit(rune)));
```

In the shutdown handler, flush sinks:

```typescript
const shutdown = async () => {
  console.error(`[HEIMDALL] Shutting down...`);
  await Promise.allSettled(sinks.filter((s) => s.flush).map((s) => s.flush!()));
  await Promise.allSettled(sinks.filter((s) => s.close).map((s) => s.close!()));
  wsBridge.stop();
  runechain.close();
  process.exit(0);
};
```

**Step 2: Run existing tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 3: Commit**

```
feat(proxy): wire sink system into Bifrost MCP proxy
```

---

## Task 19: Wire Sinks into Hooks

Connect sinks to Claude Code hooks.

**Files:**
- Modify: `packages/hooks/src/pre-tool-use.ts`
- Modify: `packages/hooks/src/post-tool-use.ts`

**Step 1: Update pre-tool-use hook**

Modify `packages/hooks/src/pre-tool-use.ts`:

After loading config, create sinks and emit after inscribing:

```typescript
import { createSinks } from "@heimdall/core";

// After loadBifrostFile:
const sinks = createSinks(config.sinks ?? []);

// After inscribeRune:
const rune = await chain.inscribeRune(ctx, evaluation);
await Promise.allSettled(sinks.map((s) => s.emit(rune)));
```

**Step 2: Run existing tests**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 3: Commit**

```
feat(hooks): wire sink system into Claude Code hooks
```

---

## Task 20: npm Publish Configuration

Prepare all packages for npm publication.

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/core/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/proxy/package.json`
- Modify: `packages/hooks/package.json`
- Modify: `packages/testing/package.json`

**Step 1: Update all package.json files**

Root — remove `private: true`, add publishConfig:

```json
{
  "private": true,
  "workspaces": ["packages/*"]
}
```

For each publishable package, add:

```json
{
  "publishConfig": {
    "access": "public"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/heimdall"
  },
  "keywords": ["ai", "agent", "audit", "mcp", "security", "policy"]
}
```

**Step 2: Commit**

```
chore: configure npm publish for all packages
```

---

## Task 21: Dockerfile for Proxy

**Files:**
- Create: `Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/core/package.json packages/core/
COPY packages/proxy/package.json packages/proxy/
COPY packages/cli/package.json packages/cli/
COPY packages/hooks/package.json packages/hooks/

RUN bun install --frozen-lockfile

COPY packages/core/ packages/core/
COPY packages/proxy/ packages/proxy/
COPY packages/cli/ packages/cli/
COPY packages/hooks/ packages/hooks/

ENTRYPOINT ["bun", "run", "packages/cli/src/index.ts"]
CMD ["guard", "--help"]
```

**Step 2: Commit**

```
chore: add Dockerfile for Bifrost proxy deployment
```

---

## Task 22: Framework Integration Stubs

Minimal stubs showing how to integrate Heimdall with LangChain and Vercel AI SDK.

**Files:**
- Create: `examples/integrations/langchain.ts`
- Create: `examples/integrations/vercel-ai.ts`

**Step 1: Create LangChain integration example**

Create `examples/integrations/langchain.ts`:

```typescript
/**
 * Heimdall + LangChain Integration Example
 *
 * Uses the Heimdall SDK as a LangChain callback handler to audit
 * all tool calls made by a LangChain agent.
 *
 * Usage:
 *   import { HeimdallCallbackHandler } from "./langchain.js";
 *   const agent = new AgentExecutor({ callbacks: [new HeimdallCallbackHandler()] });
 */

import { Heimdall } from "@heimdall/core";
import type { EvaluateResult } from "@heimdall/core";

export class HeimdallCallbackHandler {
  private heimdall: Heimdall;

  constructor(heimdall: Heimdall) {
    this.heimdall = heimdall;
  }

  async handleToolStart(
    tool: { name: string },
    input: string,
    runId: string
  ): Promise<EvaluateResult> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(input);
    } catch {
      args = { input };
    }

    return this.heimdall.evaluate({
      sessionId: runId,
      tool: tool.name,
      arguments: args,
    });
  }

  async handleToolEnd(output: string): Promise<void> {
    await this.heimdall.recordResponse(
      output.slice(0, 200)
    );
  }
}
```

**Step 2: Create Vercel AI SDK integration example**

Create `examples/integrations/vercel-ai.ts`:

```typescript
/**
 * Heimdall + Vercel AI SDK Integration Example
 *
 * Wraps Vercel AI SDK tool calls with Heimdall policy enforcement.
 *
 * Usage:
 *   import { withHeimdall } from "./vercel-ai.js";
 *   const protectedTool = withHeimdall(heimdall, myTool);
 */

import { Heimdall } from "@heimdall/core";

export function withHeimdall<T extends (...args: unknown[]) => unknown>(
  heimdall: Heimdall,
  toolName: string,
  toolFn: T,
  sessionId?: string
): T {
  return (async (...args: unknown[]) => {
    const toolArgs = args[0] as Record<string, unknown> ?? {};
    const result = await heimdall.evaluate({
      sessionId: sessionId ?? crypto.randomUUID(),
      tool: toolName,
      arguments: toolArgs,
    });

    if (result.decision === "HALT") {
      throw new Error(`[HEIMDALL] Tool call blocked: ${result.rationale}`);
    }

    const effectiveArgs = result.reshapedArguments ?? toolArgs;
    const startTime = performance.now();
    const output = await toolFn(effectiveArgs, ...args.slice(1));
    const duration = Math.round(performance.now() - startTime);

    await heimdall.recordResponse(
      JSON.stringify(output).slice(0, 200),
      duration
    );

    return output;
  }) as T;
}
```

**Step 3: Commit**

```
docs: add LangChain and Vercel AI SDK integration examples
```

---

## Task 23: Final Integration Test + Typecheck

Run the full test suite and typecheck to ensure everything works together.

**Files:** None (validation only)

**Step 1: Run full test suite**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun test --recursive`
Expected: ALL PASS

**Step 2: Run typecheck**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bunx tsc --noEmit`
Expected: No errors

**Step 3: Run validate command**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun run heimdall validate`

**Step 4: Run doctor command**

Run: `cd /Users/mchahed/Documents/Dev/heimdall && bun run heimdall doctor`

**Step 5: Commit any remaining fixes**

---

## Summary

| Task | What | Package | Depends On |
|------|------|---------|------------|
| 1 | RunechainAdapter interface | core | — |
| 2 | SQLite adapter refactor | core | 1 |
| 3 | Memory adapter | core | 1 |
| 4 | Sink interface + StdoutSink | core | — |
| 5 | WebhookSink | core | 4 |
| 6 | OpenTelemetrySink | core | 4 |
| 7 | Config: env vars + sinks section | core | 4 |
| 8 | Heimdall SDK class | core | 2, 3, 4 |
| 9 | Custom conditions plugin | core | — |
| 10 | Policy composition (extends) | core | 7 |
| 11 | JSON Schema | schemas | — |
| 12 | `heimdall validate` | cli | 7 |
| 13 | `heimdall doctor` | cli | — |
| 14 | `--dry-run` flag | proxy | — |
| 15 | `heimdall replay` | cli | — |
| 16 | Policy testing framework | testing | — |
| 17 | Sink factory | core | 4, 5, 6 |
| 18 | Wire sinks into proxy | proxy | 17 |
| 19 | Wire sinks into hooks | hooks | 17 |
| 20 | npm publish config | all | — |
| 21 | Dockerfile | infra | — |
| 22 | Integration examples | examples | 8 |
| 23 | Final integration test | all | all |

**Parallelizable groups:**
- Group A (independent): Tasks 1, 4, 9, 11, 13, 14, 15, 16, 20, 21
- Group B (after 1): Tasks 2, 3
- Group C (after 4): Tasks 5, 6, 7, 17
- Group D (after 2+3+4): Task 8
- Group E (after 7): Tasks 10, 12
- Group F (after 17): Tasks 18, 19
- Group G (after 8): Task 22
- Final: Task 23
