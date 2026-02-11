<div align="center">

<br>

```
    ╱╲
   ╱  ╲      ██╗  ██╗███████╗██╗███╗   ███╗██████╗  █████╗ ██╗     ██╗
  ╱ ⟁  ╲     ██║  ██║██╔════╝██║████╗ ████║██╔══██╗██╔══██╗██║     ██║
 ╱  ██  ╲    ███████║█████╗  ██║██╔████╔██║██║  ██║███████║██║     ██║
╱  ╱  ╲  ╲   ██╔══██║██╔══╝  ██║██║╚██╔╝██║██║  ██║██╔══██║██║     ██║
╲  ╲  ╱  ╱   ██║  ██║███████╗██║██║ ╚═╝ ██║██████╔╝██║  ██║███████╗███████╗
 ╲  ╲╱  ╱    ╚═╝  ╚═╝╚══════╝╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝
  ╲    ╱
   ╲  ╱     The audit gateway for AI agent tool calls
    ╲╱
```

**One YAML file. Every tool call inspected. Every decision cryptographically proven.**

[![License: MIT](https://img.shields.io/badge/License-MIT-4A8FD4.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-129_passing-3D9970.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-4A8FD4.svg)](#)
[![Runtime](https://img.shields.io/badge/runtime-Bun-f5f5f5.svg)](#)

[Quick Start](#-quick-start) · [SDK Integration](#-sdk-integration) · [Policies](#-writing-policies) · [Sinks](#-sinks--observability) · [CLI](#-cli-reference) · [Dashboard](#-watchtower-dashboard)

</div>

---

## What is Heimdall?

Heimdall sits between your AI agent and its tools. It intercepts every tool call, evaluates it against declarative YAML policies, and produces a tamper-evident SHA-256 audit trail.

```
                    bifrost.yaml
                        │
┌──────────┐    ┌───────▼────────┐    ┌──────────┐
│ AI Agent │───▶│   HEIMDALL     │───▶│  Tools   │
│          │◀───│                │◀───│          │
└──────────┘    │  ┌───────────┐ │    └──────────┘
                │  │ Runechain │ │
                │  │ ■→■→■→■   │ │──▶ Sinks (webhook, OTLP, stdout)
                │  └───────────┘ │
                └────────────────┘
```

Three things happen on every tool call:

| Step | What happens | Output |
|------|-------------|--------|
| **Check** | Declarative YAML wards decide `PASS`, `HALT`, or `RESHAPE` | Policy decision |
| **Record** | The decision is inscribed as a **Rune** with full context | Audit record |
| **Link** | Each Rune is hash-chained to the previous one | Tamper-evident trail |

---

## ⚡ Quick Start

### Install

```bash
bun install
```

### Option A: Claude Code (zero-config)

```bash
bun run heimdall init            # creates bifrost.yaml + .heimdall/
bun run heimdall hook install    # installs PreToolUse/PostToolUse hooks
```

Done. Every Claude Code tool call is now governed.

### Option B: MCP Proxy (any agent)

```bash
bun run heimdall init
bun run heimdall guard --target "npx -y @modelcontextprotocol/server-filesystem ."
```

Heimdall sits as a transparent proxy between your MCP client and any MCP server.

### Option C: SDK (embed in your code)

```bash
bun add @heimdall/core
```

```typescript
import { Heimdall, loadBifrostConfig } from "@heimdall/core";

const config = await loadBifrostConfig("bifrost.yaml");
const heimdall = new Heimdall({ config, adapter: "memory" });

const result = await heimdall.evaluate({
  sessionId: "session-1",
  tool: "Bash",
  arguments: { command: "rm -rf /" },
});

if (result.decision === "HALT") {
  console.error(`Blocked: ${result.rationale}`);
}

await heimdall.close();
```

### Verify the audit trail

```bash
bun run heimdall runecheck
```

```
Heimdall Runechain Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  1  ✓  [GENESIS]    Bash        PASS     a3f2c891...
#  2  ✓  ← a3f2c891   Read        PASS     b7d1e234...
#  3  ✓  ← b7d1e234   Bash        HALT     c912f567...
#  4  ✓  ← c912f567   Write       PASS     d456a890...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Result: VALID — 4 runes verified, Ed25519 signed
```

---

## 🔌 SDK Integration

The `Heimdall` class is the main entry point for embedding policy enforcement in any TypeScript application.

### Basic usage

```typescript
import { Heimdall, loadBifrostConfig } from "@heimdall/core";

const config = await loadBifrostConfig("bifrost.yaml");
const heimdall = new Heimdall({
  config,
  adapter: "memory",         // or pass a RunechainAdapter instance
  sinks: [new StdoutSink()], // optional: log drain
});

// Evaluate a tool call
const result = await heimdall.evaluate({
  sessionId: "agent-session-42",
  tool: "database_query",
  arguments: { sql: "DROP TABLE users" },
});

// result.decision → "HALT" | "PASS" | "RESHAPE"
// result.rationale → "Destructive SQL blocked"
// result.rune → full audit record with hash chain

// Record the tool response (completes the audit record)
await heimdall.recordResponse("Query blocked", 12);

// Verify chain integrity
const verification = await heimdall.verify();
console.log(verification.valid); // true

await heimdall.close();
```

### With Vercel AI SDK

```typescript
import { Heimdall } from "@heimdall/core";
import { withHeimdall } from "./integrations/vercel-ai.js";

const heimdall = new Heimdall({ config, adapter: "memory" });
const protectedTool = withHeimdall(heimdall, "myTool", myToolFn);
// All calls to protectedTool are now audited and policy-enforced
```

### With LangChain

```typescript
import { Heimdall } from "@heimdall/core";
import { HeimdallCallbackHandler } from "./integrations/langchain.js";

const heimdall = new Heimdall({ config, adapter: "memory" });
const handler = new HeimdallCallbackHandler(heimdall);
// Pass handler to your LangChain agent's callbacks
```

### Custom storage adapter

Implement `RunechainAdapter` to use any database:

```typescript
import type { RunechainAdapter } from "@heimdall/core";

class PostgresAdapter implements RunechainAdapter {
  async inscribeRune(ctx, evaluation, response?, duration?) { /* ... */ }
  async verifyChain() { /* ... */ }
  // ... see RunechainAdapter interface for full contract
}

const heimdall = new Heimdall({
  config,
  adapter: new PostgresAdapter(connectionString),
});
```

Built-in adapters:

| Adapter | Use case |
|---------|----------|
| `"memory"` | Testing, short-lived processes |
| `SqliteAdapter` | Persistent storage (default for CLI) |

### Custom conditions

Extend the policy engine with custom ward conditions:

```typescript
import { WardEngine } from "@heimdall/core";

const engine = new WardEngine(config);

engine.registerCondition("business_hours_only", (value, ctx) => {
  const hour = new Date().getHours();
  return hour >= 9 && hour < 17;
});
```

```yaml
wards:
  - id: office-hours
    tool: "*"
    when:
      business_hours_only: true
    action: HALT
    message: "Tool calls blocked outside business hours"
```

---

## 📜 Writing Policies

Policies live in `bifrost.yaml`. Each **ward** is a rule that matches tool calls and decides what happens.

```yaml
version: "1"
realm: "production"

wards:
  # ── HALT: Block dangerous operations ──
  - id: halt-destructive
    tool: "Bash"
    when:
      argument_matches:
        command: "(rm\\s+-rf|DROP TABLE|mkfs)"
    action: HALT
    message: "Destructive command blocked"
    severity: critical

  # ── HALT: Detect secrets in any tool ──
  - id: halt-secrets
    tool: "*"
    when:
      argument_contains_pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})"
    action: HALT
    message: "Secret detected in tool arguments"
    severity: critical

  # ── HALT: Rate limit against prompt injection escalation ──
  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 30
    action: HALT
    message: "Rate limit exceeded"
    severity: high

  # ── RESHAPE: Make it safe instead of blocking ──
  - id: safe-deploy
    tool: "Bash"
    when:
      argument_matches:
        command: "deploy"
    action: RESHAPE
    message: "Deploy reshaped with safety flags"
    severity: medium
    reshape:
      confirm: true
      dry_run: true

defaults:
  action: PASS
  severity: low
```

### Conditions

| Condition | What it does | Example |
|-----------|-------------|---------|
| `argument_matches` | Regex on a specific argument field | `command: "rm\\s+-rf"` |
| `argument_contains_pattern` | Regex across all serialized arguments | `"sk-[a-zA-Z0-9]{20,}"` |
| `max_calls_per_minute` | Rate limit per session | `30` |
| `always` | Matches unconditionally | `true` |
| *Custom* | Your own via `registerCondition()` | Any logic |

All present conditions must match (**AND** logic). When multiple wards match, the most restrictive action wins: **HALT > RESHAPE > PASS**.

### Tool patterns

| Pattern | Matches |
|---------|---------|
| `"Bash"` | Exact match |
| `"file_*"` | `file_read`, `file_write`, etc. |
| `"*"` | Every tool |

### Environment variables

Use `${VAR}` or `${VAR:-default}` in any config value:

```yaml
sinks:
  - type: webhook
    url: "${WEBHOOK_URL}"
    headers:
      Authorization: "Bearer ${API_TOKEN:-dev-token}"
```

### Policy composition

Split policies across files with `extends`:

```yaml
extends:
  - ./base-security.yaml
  - ./team-policies.yaml

wards:
  # Local wards are evaluated after extended wards
  - id: project-specific
    tool: "Bash"
    when:
      argument_matches:
        command: "npm publish"
    action: HALT
    message: "Publishing blocked in this project"
```

### Pre-built policies

| Policy | File | Protects against |
|--------|------|-----------------|
| **Lethal Trifecta** | [`bifrost-trifecta.yaml`](examples/bifrost-trifecta.yaml) | Data exfiltration, prompt injection, secret leakage |
| **DevOps** | [`bifrost-devops.yaml`](examples/bifrost-devops.yaml) | `rm -rf`, privilege escalation, pipe-to-shell |
| **Healthcare** | [`bifrost-healthcare.yaml`](examples/bifrost-healthcare.yaml) | PHI exposure, unauthorized access (HIPAA) |
| **Finance** | [`bifrost-finance.yaml`](examples/bifrost-finance.yaml) | Large transactions, bulk exports (SOX/PCI) |

### Validate before deploying

```bash
bun run heimdall validate
```

```
Heimdall Policy Validation
━━━━━━━━━━━━━━━━━━━━━━━━━
Config: bifrost.yaml
Realm:  production

Wards (6):
  ✓ halt-destructive     Bash    HALT     critical
  ✓ halt-secrets         *       HALT     critical
  ✓ rate-limit           *       HALT     high
  ✓ safe-deploy          Bash    RESHAPE  medium
  ✓ flag-network         Bash    PASS     medium
  ✓ office-hours         *       HALT     low

Result: VALID — 6 wards, 0 warnings
```

---

## 📡 Sinks & Observability

Sinks forward audit events to external systems. Configure them in `bifrost.yaml`:

```yaml
sinks:
  # JSON lines to stderr
  - type: stdout

  # HTTP webhook (fire-and-forget)
  - type: webhook
    url: "${WEBHOOK_URL}"
    headers:
      Authorization: "Bearer ${WEBHOOK_TOKEN}"
    events: [HALT]  # only send HALT decisions

  # OpenTelemetry (OTLP/HTTP)
  - type: opentelemetry
    endpoint: "${OTEL_ENDPOINT:-http://localhost:4318}"
    headers:
      x-api-key: "${OTEL_API_KEY:-dev}"
    serviceName: heimdall-prod
```

### Build your own sink

Implement the `HeimdallSink` interface:

```typescript
import type { HeimdallSink, Rune } from "@heimdall/core";

class KafkaSink implements HeimdallSink {
  readonly name = "kafka";

  async emit(rune: Rune): Promise<void> {
    await producer.send({ topic: "audit", messages: [{ value: JSON.stringify(rune) }] });
  }

  async flush(): Promise<void> { /* flush buffered messages */ }
  async close(): Promise<void> { /* disconnect */ }
}
```

Pass custom sinks to the SDK:

```typescript
const heimdall = new Heimdall({
  config,
  sinks: [new KafkaSink(), new StdoutSink()],
});
```

### Built-in sinks

| Sink | Transport | Use case |
|------|-----------|----------|
| `StdoutSink` | JSON lines → stderr | Local dev, log aggregators |
| `WebhookSink` | HTTP POST | Slack, PagerDuty, custom APIs |
| `OpenTelemetrySink` | OTLP/HTTP JSON | Datadog, Grafana, Honeycomb, Jaeger |

---

## 🔗 Tamper-Evident Audit Trail

Every tool call produces a **Rune** — an audit record containing the tool name, arguments hash, policy decision, matched wards, and evaluation chain. Each Rune includes a SHA-256 content hash and a link to the previous Rune's hash, forming an append-only hash chain.

```
     ┌────────────┐    ┌────────────┐    ┌────────────┐
     │  Rune #1   │    │  Rune #2   │    │  Rune #3   │
     │            │    │            │    │            │
     │ GENESIS  ──┼───▶│ prev: a3f2 ┼───▶│ prev: b7d1 │
     │ hash: a3f2 │    │ hash: b7d1 │    │ hash: c912 │
     │ sig: Ed25519│    │ sig: Ed25519│    │ sig: Ed25519│
     └────────────┘    └────────────┘    └────────────┘
```

Modify any Rune — change a decision, delete a record, alter the order — and the chain breaks:

```
#  3  ✗  ← TAMPERED   Bash        PASS     d456a890...
     ↑ CHAIN BROKEN: content_hash mismatch
Result: INVALID — chain broken at rune #3
```

Each rune is also **Ed25519 signed** for non-repudiation. Export signed receipts for compliance:

```bash
bun run heimdall export --format json
```

---

## 🧪 Testing Policies

The `@heimdall/testing` package provides a DSL for policy testing:

```typescript
import { testPolicy } from "@heimdall/testing";

const { pass, halt, reshape } = await testPolicy(`
  version: "1"
  realm: test
  wards:
    - id: block-rm
      tool: Bash
      when:
        argument_matches:
          command: "rm\\\\s+-rf"
      action: HALT
      message: "Blocked"
      severity: critical
`);

// Assert decisions
halt("Bash", { command: "rm -rf /" });
pass("Bash", { command: "ls -la" });
pass("Read", { path: "/etc/hosts" });
```

Run with `--dry-run` to test policies against live traffic without blocking:

```bash
bun run heimdall guard --target "your-server" --dry-run
```

---

## 🖥 CLI Reference

| Command | Description |
|---------|-------------|
| `heimdall init` | Create `bifrost.yaml` and `.heimdall/` directory |
| `heimdall guard --target <cmd>` | Start MCP proxy in front of a server |
| `heimdall guard --target <cmd> --dry-run` | Proxy in observation mode (log but don't block) |
| `heimdall hook install` | Install Claude Code hooks |
| `heimdall hook uninstall` | Remove Claude Code hooks |
| `heimdall validate` | Validate `bifrost.yaml` without starting |
| `heimdall doctor` | Diagnostic health check (config, DB, sinks) |
| `heimdall runecheck` | Verify Runechain integrity |
| `heimdall replay --policy <file>` | Replay audit trail against a new policy |
| `heimdall log` | Query the audit trail |
| `heimdall export --format json\|csv` | Export runes for compliance |
| `heimdall watchtower` | Launch the real-time dashboard |

---

## 📊 Watchtower Dashboard

A real-time monitoring dashboard built with React 19, Vite, and Tailwind CSS v4.

```bash
bun run heimdall watchtower
# Opens at http://localhost:3000
```

<!-- Dark slate UI with Palantir-style blue accent, real-time WebSocket feed -->

- **Live activity feed** — rune decisions stream in via WebSocket as they happen
- **Decision status tags** — color-coded: <span style="color:#3D9970">PASS</span> · <span style="color:#C24242">HALT</span> · <span style="color:#C28B2E">RESHAPE</span>
- **HALT alert pulse** — screen-edge flash on blocked calls
- **Rune detail drawer** — click any row to inspect arguments, matched wards, evaluation chain, hash linkage, and Ed25519 signature
- **Chain integrity pill** — one-click verification in the header
- **Sidebar filters** — filter by decision, tool, or session
- **Animated metrics** — counters with smooth transitions

The dashboard is fully optional — Heimdall works entirely from the CLI and SDK.

---

## 🏗 Architecture

```
heimdall/
├── packages/
│   ├── core/           # WardEngine, Runechain adapters, sinks, Heimdall SDK
│   ├── proxy/          # MCP intercept proxy (Bifrost)
│   ├── hooks/          # Claude Code PreToolUse/PostToolUse hooks
│   ├── cli/            # Commander.js CLI
│   ├── dashboard/      # React 19 + Vite + Tailwind v4 (Watchtower)
│   └── testing/        # Policy testing framework
├── examples/           # Pre-built policies + framework integrations
├── schemas/            # JSON Schema for bifrost.yaml
└── Dockerfile          # Production container image
```

| Layer | What it does |
|-------|-------------|
| **WardEngine** | Evaluates tool calls against YAML wards. AND logic, glob matching, regex conditions, rate limiting, custom plugins. |
| **RunechainAdapter** | Pluggable storage for the audit hash chain. Built-in: SQLite, Memory. Implement the interface for Postgres, Turso, etc. |
| **HeimdallSink** | Pluggable log drain. Built-in: stdout, webhook, OpenTelemetry. Implement the interface for Kafka, S3, etc. |
| **Heimdall SDK** | Unified facade. Wraps engine + adapter + sinks into one class. |
| **Bifrost Proxy** | Transparent MCP proxy. Intercepts `tools/call`, applies wards, inscribes runes. |
| **Hooks** | Claude Code integration. `PreToolUse` for policy, `PostToolUse` for response capture. Fail-open: if Heimdall errors, the agent continues. |
| **Watchtower** | Real-time dashboard. WebSocket feed, chain verification, rune inspection. |

### Design principles

- **Fail-closed for policy** — if a ward can't be evaluated, default to the most restrictive action
- **Fail-open for hooks** — if Heimdall itself errors, don't break the agent
- **stdout is sacred** — all Heimdall output goes to stderr (stdout reserved for MCP JSON-RPC)
- **Deterministic hashing** — keys alphabetically sorted before SHA-256 for reproducible hashes
- **Action priority** — `HALT > RESHAPE > PASS` (most restrictive wins when multiple wards match)
- **`__DELETE__` sentinel** — use `"__DELETE__"` in reshape configs to remove keys from arguments

---

## 🐳 Docker

```bash
docker build -t heimdall .
docker run -v $(pwd)/bifrost.yaml:/app/bifrost.yaml heimdall guard --target "your-server"
```

---

## 🛡 Threat Model

| Threat | How Heimdall stops it |
|--------|-----------------------|
| **Data exfiltration** via network tools | Wards block `curl`, `wget`, URL payloads, base64-encoded data |
| **Multi-tool escalation** from prompt injection | `max_calls_per_minute` rate limiting |
| **Secret leakage** in tool arguments | Pattern matching on API keys, tokens, credentials |
| **Privilege escalation** | Tool-specific HALT wards with argument inspection |
| **Audit trail tampering** | SHA-256 hash chain + Ed25519 signatures; `runecheck` detects any modification |
| **MCP server poisoning** | All responses captured in Runes for forensic analysis |

## 📋 Compliance

| Framework | How Heimdall helps |
|-----------|--------------------|
| **SOX** §404 | Tamper-evident audit chain for every automated decision |
| **GDPR** Art. 30 | Complete records of processing activities |
| **HIPAA** §164.312 | Ward engine blocks PHI exposure; audit controls |
| **ISO 27001** A.12.4 | Structured logging with cryptographic verification |
| **OWASP Agentic Top 10** | Policy enforcement at the MCP protocol layer |

---

## 📦 Packages

| Package | npm | Description |
|---------|-----|-------------|
| `@heimdall/core` | [![npm](https://img.shields.io/badge/npm-@heimdall/core-4A8FD4.svg)](#) | WardEngine, adapters, sinks, SDK |
| `@heimdall/cli` | [![npm](https://img.shields.io/badge/npm-@heimdall/cli-4A8FD4.svg)](#) | CLI tool |
| `@heimdall/proxy` | [![npm](https://img.shields.io/badge/npm-@heimdall/proxy-4A8FD4.svg)](#) | MCP intercept proxy |
| `@heimdall/hooks` | [![npm](https://img.shields.io/badge/npm-@heimdall/hooks-4A8FD4.svg)](#) | Claude Code hooks |
| `@heimdall/testing` | [![npm](https://img.shields.io/badge/npm-@heimdall/testing-4A8FD4.svg)](#) | Policy testing DSL |

---

## Contributing

```bash
bun install         # install dependencies
bun test            # run all tests (129 passing)
bun run typecheck   # strict TypeScript
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add rate limiting condition
fix(proxy): resolve dry-run double inscription
test(core): add Ed25519 signature verification tests
```

## License

MIT

---

<div align="center">

**Every call inspected. Every decision proven.**

[Quick Start](#-quick-start) · [SDK](#-sdk-integration) · [Policies](#-writing-policies) · [Sinks](#-sinks--observability) · [Dashboard](#-watchtower-dashboard)

</div>
