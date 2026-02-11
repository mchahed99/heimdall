<div align="center">

# &#9876;&#65039; Heimdall

**The guardian between AI agents and their tools.**

Open-source audit gateway with declarative policy enforcement
and tamper-evident audit trails for AI agent tool calls.

[Quick Start](#quick-start) &middot;
[How It Works](#how-it-works) &middot;
[Ward Reference](#ward-reference) &middot;
[Claude Code Integration](#claude-code-integration) &middot;
[Dashboard](#watchtower-dashboard)

</div>

---

## The Problem: The Lethal Trifecta

Simon Willison [identified](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) three capabilities that, when combined in AI agents, create a critical security vulnerability:

1. **Access to private data** &mdash; files, databases, repos, secrets
2. **Exposure to untrusted content** &mdash; web pages, emails, issues, user input
3. **External communication** &mdash; HTTP requests, email, file writes

When a prompt injection attack is embedded in untrusted content (leg 2), the LLM can be tricked into exfiltrating private data (leg 1) through external channels (leg 3). This has been exploited against Microsoft 365 Copilot, GitHub MCP, GitLab Duo, Slack AI, and more.

Academic research from TU Munich ([Omega, arxiv:2512.05951](https://arxiv.org/abs/2512.05951)) confirms that **declarative policy enforcement reduces these attacks from 99.5% success to 0%**, with rate limiting eliminating multi-tool escalation attacks (90% &rarr; 0%).

**Heimdall breaks the trifecta.** It sits between your AI agent and its tools, enforcing declarative policies that block exfiltration, rate-limit tool calls, and produce tamper-evident audit trails &mdash; all in a single YAML file.

Every automated decision must be:

- **Auditable** &mdash; what tool was called, with what arguments, and what was the outcome?
- **Verifiable** &mdash; can you prove the audit log hasn't been tampered with?
- **Controllable** &mdash; can you block dangerous operations in real-time?
- **Explainable** &mdash; which policy matched, and why was the decision made?

No existing open-source tool combines all four. **Heimdall does.**

## How It Works

Heimdall sits between your AI agent and its tools &mdash; like the Norse guardian at the Bifr&ouml;st bridge. Every tool call passes through three layers:

```
┌──────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  AI Agent    │────▶│  HEIMDALL             │────▶│  Tools       │
│  (Claude,    │◀────│  Ward Engine (policy)  │◀────│  (MCP, CLI)  │
│   etc.)      │     │  Runechain  (audit)    │     │              │
└──────────────┘     └──────────────────────┘     └──────────────┘
```

1. **Ward Engine** &mdash; Declarative YAML rules (`bifrost.yaml`) decide **PASS**, **HALT**, or **RESHAPE** for every tool call
2. **Runechain** &mdash; Every decision is inscribed as a **Rune** (audit record) with full context
3. **Hash Chain** &mdash; SHA-256 links make the Runechain **tamper-evident**. Modify one rune and the entire chain breaks.

### Two Integration Paths

| Path | How | Best for |
|------|-----|----------|
| **MCP Proxy** | `heimdall guard --target <server>` | Any MCP client (Claude Desktop, custom agents) |
| **Claude Code Hooks** | `heimdall hook install` | Native Claude Code integration (zero-config) |

Both paths feed the same Runechain and use the same Ward Engine.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-user/heimdall.git
cd heimdall
bun install

# Initialize Heimdall in your project
bun run heimdall init

# This creates:
#   bifrost.yaml     ← Policy configuration
#   .heimdall/       ← Audit database directory
```

### Option A: Claude Code Hooks (Recommended)

```bash
# Install hooks into Claude Code
bun run heimdall hook install

# That's it! Every tool call is now guarded by Heimdall.
# Check the audit trail:
bun run heimdall runecheck
```

### Option B: MCP Proxy

```bash
# Start the Bifrost proxy in front of any MCP server
bun run heimdall guard --target "npx -y @modelcontextprotocol/server-filesystem ."

# Configure your MCP client to connect to Heimdall instead of the server directly
```

### Verify Audit Integrity

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

### Tamper Detection

If anyone modifies the audit trail, Heimdall detects it:

```
  #  3  ✗  ← TAMPERED   Bash        PASS     d456a890...
       ↑ CHAIN BROKEN: content_hash mismatch
  Result: INVALID — chain broken at rune #3
```

## Ward Reference

Wards are policy rules defined in `bifrost.yaml`. Each ward specifies:

- **tool** &mdash; Which tool(s) to match (supports glob patterns: `"Bash"`, `"file_*"`, `"*"`)
- **when** &mdash; Conditions that must be true (AND logic)
- **action** &mdash; What to do: `PASS`, `HALT`, or `RESHAPE`
- **severity** &mdash; `low`, `medium`, `high`, or `critical`

### Example: bifrost.yaml

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
    message: "Destructive command blocked by Heimdall"
    severity: critical

  # Detect secrets in any tool call
  - id: halt-secrets
    tool: "*"
    when:
      argument_contains_pattern: "(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})"
    action: HALT
    message: "Secret detected in tool arguments"
    severity: critical

  # Reshape: add safety flags
  - id: reshape-deploy
    tool: "Bash"
    when:
      argument_matches:
        command: "deploy"
    action: RESHAPE
    message: "Deploy command reshaped with safety flags"
    severity: medium
    reshape:
      confirm: true
      dry_run: true

defaults:
  action: PASS
  severity: low
```

### Condition Types

| Condition | Description | Example |
|-----------|-------------|---------|
| `argument_matches` | Regex on specific argument fields | `command: "rm\\s+-rf"` |
| `argument_contains_pattern` | Regex across all serialized arguments | `"sk-[a-zA-Z0-9]{20,}"` |
| `max_calls_per_minute` | Rate limit (calls/min per session+tool) | `max_calls_per_minute: 30` |
| `always` | Unconditional match | `always: true` |

### Action Priority

When multiple wards match, the most restrictive action wins:

**HALT** > **RESHAPE** > **PASS**

## Claude Code Integration

Heimdall integrates natively with Claude Code via [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks):

```bash
# Install hooks
bun run heimdall hook install

# This creates .claude/settings.local.json with PreToolUse and PostToolUse hooks
# Every tool call is evaluated against bifrost.yaml before execution
```

### How It Works

1. Claude Code calls a tool (e.g., `Bash` with `rm -rf /`)
2. The `PreToolUse` hook sends the call to Heimdall
3. Heimdall evaluates the call against `bifrost.yaml`
4. If **HALT**: the tool call is blocked and Claude sees the reason
5. If **PASS**: the tool call proceeds normally
6. A **Rune** is inscribed in the Runechain regardless of decision

## Watchtower Dashboard

The Watchtower is a real-time dashboard for monitoring the Runechain:

```bash
bun run heimdall watchtower
# Opens at http://localhost:3000
```

Features:
- Real-time rune timeline with color-coded decisions
- Detailed rune inspection (arguments, ward chain, hash links)
- Runechain integrity verification
- Filters by tool, decision, and session
- Dark theme with gold accents

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
| `heimdall watchtower` | Launch the dashboard |

## Example Policies

Pre-built policies for common industries and threat models:

| Policy | File | Use Case |
|--------|------|----------|
| **Trifecta Defense** | [`examples/bifrost-trifecta.yaml`](examples/bifrost-trifecta.yaml) | Break the [Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) &mdash; anti-exfiltration + rate limiting |
| DevOps | [`examples/bifrost-devops.yaml`](examples/bifrost-devops.yaml) | Block destructive ops, flag privilege escalation |
| Healthcare | [`examples/bifrost-healthcare.yaml`](examples/bifrost-healthcare.yaml) | HIPAA compliance, PHI detection |
| Finance | [`examples/bifrost-finance.yaml`](examples/bifrost-finance.yaml) | SOX audit, PCI DSS, transaction limits |

## Compliance

Heimdall helps meet audit requirements for:

| Framework | Requirement | How Heimdall Helps |
|-----------|-------------|-------------------|
| **SOX** &sect;404 | Audit trail for automated decisions | Runechain with tamper-evident hash chain |
| **GDPR** Art. 30 | Records of processing activities | Every tool call logged with full context |
| **HIPAA** &sect;164.312 | Audit controls | Ward engine blocks PHI exposure |
| **ISO 27001** A.12.4 | Logging and monitoring | Structured Runes with verification |
| **OWASP Top 10 for Agentic** | Tool call governance | Policy enforcement at the proxy layer |

## Architecture

```
heimdall/
├── packages/
│   ├── core/          # Types, WardEngine, Runechain, YAML loader
│   ├── proxy/         # MCP intercept proxy (Bifrost)
│   ├── hooks/         # Claude Code PreToolUse/PostToolUse hooks
│   ├── cli/           # Commander.js CLI
│   └── dashboard/     # React 19 + Vite + Tailwind (Watchtower)
├── examples/          # Industry-specific bifrost.yaml policies
└── docs/              # Documentation
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Storage | SQLite (bun:sqlite) |
| Policy Format | YAML |
| Hash Algorithm | SHA-256 |
| MCP SDK | @modelcontextprotocol/sdk |
| CLI | Commander.js |
| Dashboard | React 19 + Vite + Tailwind CSS v4 |

## Threat Model

Mapped to the [Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) framework and [Omega attack taxonomy](https://arxiv.org/abs/2512.05951):

| Threat | Omega Category | Heimdall Mitigation |
|--------|---------------|-------------------|
| Data Exfiltration (99.5% baseline) | Prompt Injection &rarr; External Comms | Wards block network tools, URL payloads, encoded data |
| Multi-Tool Invocation (90% baseline) | Prompt Injection &rarr; Tool Flooding | `max_calls_per_minute` rate limiting |
| Resource Access Violation | Privilege Escalation | `argument_matches` on paths, permissions |
| Privilege Escalation (99.5% baseline) | Tool Abuse | Tool-specific HALT wards with argument inspection |
| Execution Flow Disruption | Context Hijacking | Ward chain trace + tamper-evident audit |
| Audit Trail Tampering | Log Manipulation | SHA-256 hash chain; `runecheck` detects any modification |
| MCP Server Poisoning | Tool Poisoning | All responses captured in Runes for forensic analysis |

## License

MIT &mdash; guard everything.

---

<div align="center">

*"Heimdall stands at the Bifr&ouml;st. He sees every tool call, hears every decision, and decides what passes."*

**Every call inspected. Every decision proven.**

</div>
