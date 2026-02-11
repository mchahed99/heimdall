# Heimdall — Development Guide

## Project Overview

Heimdall is an open-source audit gateway for AI agent tool calls. It intercepts tool calls via MCP proxy or Claude Code hooks, enforces declarative YAML policies (bifrost.yaml), and produces a tamper-evident SHA-256 audit trail (Runechain).

## Architecture

Monorepo with Bun workspaces:

- `packages/core` — Types, WardEngine (policy), Runechain (audit), YAML loader
- `packages/proxy` — MCP intercept proxy (Bifrost)
- `packages/hooks` — Claude Code PreToolUse/PostToolUse hooks
- `packages/cli` — Commander.js CLI (`heimdall` command)
- `packages/dashboard` — React 19 + Vite + Tailwind v4 (Watchtower)
- `examples/` — Industry-specific bifrost.yaml policies

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun run heimdall init    # Create bifrost.yaml + .heimdall/
bun run heimdall guard --target "<cmd>"  # Start MCP proxy
bun run heimdall hook install            # Install Claude Code hooks
bun run heimdall runecheck               # Verify audit chain integrity
```

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat` — New feature (e.g., `feat(ward-engine): add max_calls_per_minute condition`)
- `fix` — Bug fix (e.g., `fix(runechain): correct hash chain linkage on state recovery`)
- `refactor` — Code restructure without behavior change
- `test` — Adding or updating tests
- `docs` — Documentation only changes
- `chore` — Build, CI, dependency updates
- `perf` — Performance improvement

### Scopes

Use the package name as scope: `core`, `proxy`, `hooks`, `cli`, `dashboard`, `examples`.

### Rules

- Use imperative mood in the description: "add feature" not "added feature"
- Do not capitalize the first letter of the description
- No period at the end of the description
- Breaking changes: add `!` after type/scope (e.g., `feat(core)!: change WardCondition interface`) and add `BREAKING CHANGE:` footer
- Keep description under 72 characters

### Examples

```
feat(core): add rate limiting via max_calls_per_minute condition
fix(hooks): resolve fail-open behavior when config is missing
test(core): add ward engine rate limiting test coverage
docs: update README with Lethal Trifecta positioning
chore: upgrade @modelcontextprotocol/sdk to 1.12.0
refactor(proxy): extract rate limiter into standalone class
```

## Code Style

- Runtime: Bun (TypeScript strict)
- All Heimdall logs go to `stderr` (never stdout — reserved for MCP JSON-RPC and hook protocol)
- Security-first: fail-closed for policy enforcement, fail-open for hooks (don't break the agent if Heimdall errors)
- Ward conditions use AND logic — all present conditions must match
- Action priority: HALT > RESHAPE > PASS (most restrictive wins)
- Hash chain: SHA-256 with alphabetically sorted keys for deterministic serialization

## Key Design Decisions

- **RateLimitProvider** is injectable: `InMemoryRateLimiter` for the MCP proxy (long-lived process), `Runechain.getRecentCallCount()` for hooks (fresh process per invocation)
- **Ward tool patterns** use glob syntax (`*`, `?`, `file_*`), converted to regex internally
- **Runechain** uses SQLite via `bun:sqlite` — first rune's `previous_hash` is `"GENESIS"`
- **RESHAPE** merges ward's `reshape` config over original arguments; `"__DELETE__"` sentinel removes keys
