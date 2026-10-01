# Reliability survey (offline / no live Google writes)

This document inventories failure modes and mitigations for **local** operation (encrypted tokens, env boundaries, MCP stdio). It is aimed at contributors and cloud agents validating changes **without** OAuth or Google API calls.

## Open draft PR survey

Survey date: **2026-10-01** (last deeper pass: same day, usage-burn draft-only). Goal: one canonical reliability/docs draft — extend in place, no merge without maintainer review, **no live Google writes** during validation.

| PR | Branch | State | Scope | Action |
|----|--------|-------|-------|--------|
| [#1](https://github.com/trevor-commits/mcp-google-multi/pull/1) | `cursor/harden-boundaries-da19` | **DRAFT** | Token-store locking, env boundaries, escape-hatch toolsets, `migrate-tokens` resilience, this survey + offline verify | **Canonical** — all deeper reliability/docs work lands here |
| — | — | — | No other open drafts | Do not open a second parallel reliability PR |

**Survey method (repeatable):** `gh pr list --draft --state open` on `trevor-commits/mcp-google-multi`. As of the last pass, only **#1** matched; extend it rather than opening a sibling draft.

## Verification quick path

**Prerequisites:** Node **20+** (`package.json` `engines`); clean tree after `git clone` / checkout.

```bash
npm ci
npm run verify
```

| Step | Command | Needs secrets? | Touches Google APIs? |
|------|---------|----------------|----------------------|
| Full offline gate (matches CI) | `npm run verify` | No | No |
| Same steps individually | `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` | No | No |
| Resolved policy + tool surface | `node dist/index.js config check` | Yes (`.env` + `MASTER_KEY` for decrypt paths only) | No |

**Expected success (test stage):** Vitest ends with `Test Files  19 passed (19)` and `Tests  273 passed (273)`. Build emits `dist/index.js` (executable).

**Expected success (full verify):** exit code `0` after typecheck, eslint, tests, and `tsc` build with no errors.

CI runs on **Node 24** via `.github/workflows/test.yml` (`npm ci` then `npm run verify`). Local Node 20–23 is supported; use Node 24 when reproducing CI-only quirks.

### Verify transcript (what “green” looks like)

After `npm run test`, the last lines should match:

```text
Test Files  19 passed (19)
     Tests  273 passed (273)
```

After `npm run build`, `dist/index.js` exists and is executable (`chmod +x` in the build script).

Full `npm run verify` prints four stages in order with no non-zero exit:

1. `tsc --noEmit` (silent on success)
2. `eslint .` (silent on success)
3. Vitest summary above
4. `tsc` emit + `chmod +x dist/index.js`

**Do not** run `node dist/index.js auth`, handler smoke against real accounts, or `google_api_call` as part of this offline gate unless a maintainer explicitly asks for live validation.

### Optional local smoke (still offline for Google)

After `npm run build`, with developer `.env` already configured (same as daily MCP use):

```bash
node dist/index.js config check
```

Prints write-control profile, registered services, and discover/escape tool counts. Does **not** start MCP stdio, refresh OAuth tokens, or call `googleapis`.

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
| **Server boot** (`src/index.ts`) | Empty tool surface; meta tools masking misconfig | `buildRegistry()` throws if `registry.services()` is empty **before** discover/escape register; stderr hints for disabled `forms`/`chat`/`admin` | Indirect via `tests/toolsets.test.ts`, integration in registry tests |
| **CUD classification** (`src/registry.ts`) | Mis-gated writes or false denials | Verb-regex `inferCud` + `CUD_OVERRIDES` (`drive_untrash`, `drive_transfer`); registry wraps every CUD handler with `isAllowed` | `tests/registry.test.ts` (inference + `drive_transfer` move gate) |
| **MCP stdio** (handlers) | Broken MCP channel; log leakage | No `console.log` in tool paths; JSON text content blocks only; errors via `_errors.ts` shims | Convention + `tests/errors.test.ts` |
| **Discovery cache dir** (`DISCOVERY_CACHE_PATH`) | Stale/corrupt REST discovery JSON | 7-day disk cache, stale-if-offline; escape call tool rejects non-Google hosts | `tests/discovery-client.test.ts` |
| **Response compaction** (`GOOGLE_TRIM`) | Accidental huge payloads when trim disabled | Default on; `GOOGLE_TRIM=off` skips `compactResult` only (per-tool caps still apply) | `tests/trim.test.ts` |

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

## Write-control precedence (CUD tools)

Policy is resolved once at boot (`resolvePolicy()`). For each **non-read** tool, the registry wrapper calls `isAllowed({ name, service, cud }, policy)` before the handler runs. Order of evaluation (`src/write-control.ts`):

| Step | Condition | Verdict |
|------|-----------|---------|
| 1 | `cud === 'read'` | **Allow** (reads are never gated) |
| 2 | `GOOGLE_READ_ONLY` truthy | **Deny** |
| 3 | `GOOGLE_WRITE_DENY` glob matches `service:cud` or `service:operation` | **Deny** |
| 4 | `GOOGLE_WRITE_ALLOW` glob matches | **Allow** |
| 5 | Profile default | `read-only` → deny all CUD; `safe-writes` → allow create/update only; `full-writes` → allow all CUD |

Glob patterns use `*` segments (e.g. `gmail:send`, `drive:*`). Invalid `GOOGLE_PROFILE` values fall back to **`read-only`**.

**Sanctioned self-checks** (registry cud is `read` but side effects exist):

- `google_api_call` — derives CUD from Discovery HTTP verb per call.
- `drive_transfer` with `move: true` — delete-classified side effect checked against policy.

## CUD classification (`inferCud`)

Tool names drive write-control unless listed in `CUD_OVERRIDES` (`src/registry.ts`):

| Override | Effective `cud` | Why |
|----------|-----------------|-----|
| `drive_untrash` | `update` | Restore, not create |
| `drive_transfer` | `create` | Copy/create path; `move` self-checks delete |

Otherwise: delete/remove/trash verbs → `delete`; create/send/upload/… → `create`; update/patch/move/… → `update`; default → `read`.

Misclassified verbs are fixed in `CUD_OVERRIDES` or the regex buckets — do not add per-handler write gates in service files.

## Discover-first visibility

All tools **register eagerly** (always dispatchable). `tools/list` is customized in `installListHandler()`:

```text
Initially visible: meta tools only (account_list, {service}_discover, google_api_*, …)
Hidden until reveal: curated per-service tools for that service namespace
Reveal trigger:     {service}_discover handler → registry.reveal(service) → tools/list_changed
```

Clients that never call `{service}_discover` still **can** invoke a tool by name if they know it (graceful dispatch). `config check` prints eager / revealed / hidden counts for sanity checks.

## Fan-out reads (multi-account)

Read tools with a plain `account` enum may accept `"*"`, a single alias, or a CSV of aliases (`fanoutAccountField`). Rules (`src/fanout.ts`, wired in `registry.ts`):

- **Concurrency:** at most **5** accounts in parallel (`FANOUT_CONCURRENCY`).
- **Envelope:** `{ results: FanoutEntry[], partial?: true }` when any account fails; payloads are parsed objects, not embedded JSON strings.
- **Never fan-out:** meta tools; any CUD tool; `FANOUT_EXCLUDE` (`gmail_download_attachment`, `drive_download`, `drive_export`) — local paths would clobber across accounts.
- **Invalid CSV alias:** validation error listing valid aliases (no API call).

## Server boot ordering (`buildRegistry`)

Fail-fast sequence in `src/index.ts`:

```text
1. Parse GOOGLE_ACCOUNTS (throws on bad config — import side effect)
2. resolvePolicy()
3. Filter SERVICES by GOOGLE_TOOLSETS + optional scope/admin gates (stderr hints)
4. If registry.services() is empty → throw BEFORE discover/escape/meta register
5. registerDiscoverTools + registerEscapeTools + registerAccountTools
6. installListHandler() then connect stdio transport
```

An empty curated toolset must **not** still expose escape meta tools — the empty-services throw runs before escape registration.

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
| `TOKEN_STORE_PATH` | Override token dir; aliases still constrained by charset (no `..` in alias) |
| `DISCOVERY_CACHE_PATH` | Override discovery cache root; corrupt file → delete cache dir and retry (see escape-hatch hint) |
| `GOOGLE_TRIM` | `off` / `0` / `false` / `no` disables JSON compaction on registry output |
| `GOOGLE_READ_ONLY` | `true` hard-blocks all CUD regardless of profile |
| `GOOGLE_WRITE_ALLOW` / `GOOGLE_WRITE_DENY` | Glob overrides on tool names; evaluated after profile |

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
| `verify` fails on `lint` only locally | Editor/ESLint version skew | Match CI: Node 24 + `npm ci` (lockfile-pinned eslint) |
| Vitest count drift vs this doc | New tests landed on `dev` | Re-run `npm run test`; update inventory table + PR body counts |
| `config check` throws on boot | `GOOGLE_ACCOUNTS` / `GOOGLE_TOOLSETS` invalid at import | Fix env before CLI; unit tests avoid real `.env` via `tests/setup.ts` |
| Escape hatch 403/404 with good creds | Toolset filtered API id | Ensure API alias maps via `SERVICE_FOR_ALIAS` in `google-api.ts` |
| Fan-out returns `partial: true` | One or more accounts failed | Inspect per-entry `error` in `results`; fix token or alias for failing account |
| Tool works but never appears in list | Discover-first hiding | Call `{service}_discover` once, or use `config check` hidden count |
| `write_disabled` on expected write | Profile or glob | See write-control precedence table; `config check` shows profile + enabled CUD tools |

## Change checklist (reliability/docs passes)

1. Survey open **draft** PRs; extend the canonical draft (#1) instead of opening duplicates.
2. Run `npm ci && npm run verify` — no OAuth, no handler smoke against live accounts unless explicitly requested.
3. Update this file if subsystems, env boundaries, or test inventory changed.
4. Update [AGENTS.md](../AGENTS.md) verify section if the gate command or expected counts changed.

## Related docs

- [AGENTS.md](../AGENTS.md) — repo map and agent-oriented verify steps
- [CLAUDE.md](../CLAUDE.md) — implementation conventions
- [SECURITY.md](../SECURITY.md) — vulnerability reporting
