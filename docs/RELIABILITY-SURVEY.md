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
| **Registry** (`src/registry.ts`) | Hidden tools never callable; writes slip through | Eager registration (always dispatchable); discover-first `tools/list`; CUD wrappers + `compactResult` | `tests/registry.test.ts` |
| **Discover meta** (`src/discover.ts`) | Client never learns service tools | `{service}_discover` reveals catalog + emits `tools/list_changed` | `tests/discover.test.ts` |
| **Response trim** (`src/trim.ts`) | Huge JSON/tool bodies blow context | `compactResult` on registry output; `GOOGLE_TRIM=off` opts out; per-tool caps (`capText`, `sliceClean`) | `tests/trim.test.ts` |
| **Client arg coercion** (`src/tools/_coerce.ts`) | MCP clients send JSON as strings | `coerceArray` / `coerceJson` / `coerceBoolean` on tool schemas | `tests/coerce.test.ts` |
| **Local download paths** (`drive.ts`, `gmail.ts`) | Traversal via `filename` / `savePath` | `path.basename` on caller filenames before `path.join` | `tests/path-safety.test.ts` |
| **Account health** (`src/tools/accounts-tool.ts`) | Refresh side effects during listing | Reads token store directly (no `getClient`); per-alias decrypt errors isolated | `tests/accounts-tool.test.ts` |
| **Drive transfer** (`drive_transfer`) | Delete when profile denies | `move` path checks `isAllowed` for delete-classified side effect | `tests/drive-transfer.test.ts` |
| **Sheets/Docs masks** (`drive.ts` helpers) | Wildcard `fields` over-fetch or break batchUpdate | Masks computed from input keys only | `tests/field-mask-helpers.test.ts` |
| **Gmail MIME** (`src/tools/gmail.ts`) | Malformed MIME crashes handler | Defensive parse boundaries | `tests/gmail-mime.test.ts` |

## Test file inventory (offline)

Run `npm run test` (or `npm run verify`) — **19** files, **273** tests as of this survey. Each file is self-contained (mocks Discovery, token I/O, or pure helpers).

| Test file | Focus |
|-----------|--------|
| `accounts.test.ts` | `GOOGLE_ACCOUNTS` parsing, alias charset, paths |
| `accounts-tool.test.ts` | `deriveAccountHealth` statuses and hints |
| `auth-env.test.ts` | Unknown optional-scope bundles and admin aliases |
| `coerce.test.ts` | String-encoded tool arguments |
| `discover.test.ts` | Meta-tool catalog + reveal behavior |
| `discovery-client.test.ts` | Method index, host guard, stale cache |
| `drive-transfer.test.ts` | Transfer + `move` write-control gate |
| `errors.test.ts` | Error taxonomy, no credential leak |
| `fanout.test.ts` | Multi-account reads, exclusions |
| `field-mask-helpers.test.ts` | Sheets/Docs `fields` builders |
| `gmail-mime.test.ts` | MIME decode edge cases |
| `google-api.test.ts` | Escape hatch URL guard, toolsets, CUD |
| `migrate-tokens.test.ts` | Per-alias migration failures |
| `path-safety.test.ts` | `path.basename` contract for downloads |
| `registry.test.ts` | CUD inference, write gates, list visibility |
| `token-store.test.ts` | Crypto, locks, atomic write, `updateToken` |
| `toolsets.test.ts` | `GOOGLE_TOOLSETS` parsing |
| `trim.test.ts` | Compaction and character caps |
| `write-control.test.ts` | Profiles, globs, deny-by-default |

## Token store concurrency (mental model)

```text
readToken()        — no lock (read-only; may see slightly stale data)
writeToken()       — per-alias lock → temp file → fsync → rename → 0600
updateToken()      — same lock; merges partial OAuth refresh fields under lock
```

Multiple MCP host processes refreshing the **same** alias contend on `{alias}.enc.lock` (5s timeout, dead-PID recovery). Prefer one server instance per machine, or stagger accounts, if you see `Timed out waiting for token lock`.

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

## Troubleshooting (local, no Google API)

| Symptom | Likely cause | What to check |
|---------|----------------|---------------|
| `account_list` shows `decrypt_error` | Wrong or rotated `MASTER_KEY` | Same key used to encrypt; re-auth or restore key from backup |
| `Timed out waiting for token lock` | Two processes writing the same alias | Single MCP server; kill stale process holding lock |
| Server exits: no services registered | `GOOGLE_TOOLSETS` filtered everything | stderr warnings for unknown names; use `all` or fix CSV |
| Optional Forms/Chat tools missing | Bundle not enabled | Set `GOOGLE_OPTIONAL_SCOPES=forms,chat` and re-auth |
| Admin tools 403 on personal Gmail | Expected | `GOOGLE_ADMIN_ACCOUNTS` only for Workspace accounts with admin consent |
| `migrate-tokens` skips an alias | Bad plaintext JSON or non-object | stderr per alias; fix `tokens/<alias>/token.json` or re-auth |
| Writes blocked with policy message | Deny-by-default profile | `GOOGLE_PROFILE`, `GOOGLE_WRITE_ALLOW` / `DENY` — run `config check` |

## Related docs

- [AGENTS.md](../AGENTS.md) — repo map and agent-oriented verify steps
- [CLAUDE.md](../CLAUDE.md) — implementation conventions
- [SECURITY.md](../SECURITY.md) — vulnerability reporting
