# Reliability survey (offline / no live Google writes)

This document inventories failure modes and mitigations for **local** operation (encrypted tokens, env boundaries, MCP stdio). It is aimed at contributors and cloud agents validating changes **without** OAuth or Google API calls.

## Verification quick path

| Step | Command | Needs secrets? |
|------|---------|----------------|
| Full offline gate (matches CI intent) | `npm run verify` | No |
| Same steps individually | `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` | No |
| Resolved policy + tool surface | `node dist/index.js config check` | Yes (`.env` + `MASTER_KEY`; no API traffic) |

CI runs on **Node 24** via `.github/workflows/test.yml` (`npm ci` then `npm run verify`).

## Subsystem matrix

| Area | Primary risk | Mitigation | Automated coverage |
|------|--------------|------------|------------------|
| **Token store** (`src/token-store.ts`) | Torn writes, concurrent refresh races, stale locks | Per-alias `link()` lock with dead-PID recovery; temp file + `fsync` + `rename`; `updateToken` merges under lock | `tests/token-store.test.ts` (atomic write, lock recovery, merge) |
| **OAuth client** (`src/client.ts`) | Refresh listener overwriting full token | `updateToken` merges partial `tokens` events | Indirect via token-store tests |
| **Account config** (`src/accounts.ts`) | Path traversal via alias; duplicate aliases | Alias charset `^[a-zA-Z0-9_-]+$`; unique aliases; `encPath` under `TOKEN_STORE_PATH` | `tests/accounts.test.ts` |
| **Scope / admin env** (`src/auth.ts`) | Typos silently widening/narrowing consent | Unknown `GOOGLE_OPTIONAL_SCOPES` bundles and `GOOGLE_ADMIN_ACCOUNTS` aliases logged to stderr and ignored | `tests/auth-env.test.ts` |
| **Toolsets** (`src/toolsets.ts`, `src/index.ts`) | Wrong service enabled; escape hatch bypassing filter | Unknown curated services stderr-warning; empty selection fails fast at boot; optional services need scope gates | `tests/toolsets.test.ts`, registry tests |
| **Escape hatch** (`src/tools/google-api.ts`) | Writes when profile denies; credentials to wrong host; toolset bypass | Per-method CUD + `isAllowed`; `isGoogleApiUrl` host check; `SERVICE_FOR_ALIAS` maps Discovery API → policy namespace | `tests/google-api.test.ts` |
| **Discovery cache** (`src/discovery-client.ts`) | Offline boot; poisoned cache URL | Disk cache 7d, stale-if-offline; untrusted host refused at call time | `tests/discovery-client.test.ts` |
| **Write-control** (`src/write-control.ts`) | Accidental CUD | Deny-by-default profiles + globs; registry wraps CUD handlers | `tests/write-control.test.ts` |
| **Fan-out** (`src/fanout.ts`) | Parallel writes / clobbering paths | Read tools only; file-writing reads excluded | `tests/fanout.test.ts` |
| **Errors** (`src/tools/_errors.ts`) | Token or config leak in responses | Typed taxonomy; no raw `error.response` in tool output | `tests/errors.test.ts` |
| **Token migration** (`src/migrate-tokens.ts`) | One bad plaintext file aborts all aliases | Per-alias try/catch with stderr + continue | `tests/migrate-tokens.test.ts` |

## Env boundaries (expected vs ignored)

| Variable | Invalid input behavior |
|----------|------------------------|
| `GOOGLE_ACCOUNTS` | **Throws** at process start (missing, bad format, bad alias, duplicate) |
| `GOOGLE_OPTIONAL_SCOPES` | Unknown bundle names **ignored** (stderr lists known bundles) |
| `GOOGLE_ADMIN_ACCOUNTS` | Unknown aliases **ignored** (stderr lists configured aliases) |
| `GOOGLE_TOOLSETS` | Unknown curated service names **ignored** (stderr); escape-only names (`slides`, …) enforced in `google_api_*` |
| `MASTER_KEY` | **Throws** on encrypt/decrypt when empty; wrong key fails GCM auth |

## What CI deliberately does *not* cover

- Live `googleapis` calls (handlers are smoke-tested manually per [CONTRIBUTING.md](../CONTRIBUTING.md)).
- OAuth browser flow (`auth` CLI).
- Encrypted token files on a developer machine (unit tests use temp dirs and mocks).

## Related docs

- [AGENTS.md](../AGENTS.md) — repo map and agent-oriented verify steps
- [CLAUDE.md](../CLAUDE.md) — implementation conventions
- [SECURITY.md](../SECURITY.md) — vulnerability reporting
