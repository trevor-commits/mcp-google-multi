# Agent / CI guide (mcp-google-multi)

This file maps the repo for automated contributors and cloud agents. Human-oriented setup remains in [README.md](./README.md) and [CONTRIBUTING.md](./CONTRIBUTING.md). Implementation conventions: [CLAUDE.md](./CLAUDE.md).

## Layout

| Path | Role |
|------|------|
| `src/index.ts` | CLI entry (`auth`, `migrate-tokens`, `config check`) + MCP stdio server |
| `src/accounts.ts` | `GOOGLE_ACCOUNTS` parsing → `ACCOUNTS` / `ACCOUNT_CONFIG` |
| `src/registry.ts` | `ToolRegistry`: CUD inference, write-control wrappers, discover-first `tools/list` |
| `src/discover.ts` | Per-service `{service}_discover` meta tools |
| `src/tools/*.ts` | One Google service per file; handlers use `getClient(account)` |
| `src/token-store.ts` | Encrypted token files (`MASTER_KEY`, AES-256-GCM) |
| `src/write-control.ts` | Deny-by-default CUD policy |
| `src/fanout.ts` | Multi-account read fan-out (`*`, CSV) |
| `src/tools/google-api.ts` | Escape hatch: `google_api_search` / `google_api_call` |
| `tests/` | Vitest unit tests (no live Google credentials in CI) |
| `tests/setup.ts` | Injects `GOOGLE_ACCOUNTS=test:test@example.com` before imports |

## Local verification (no OAuth required)

From the repo root after `npm install`:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

CI runs the same steps on Node 24 (see `.github/workflows/test.yml`). Tests mock Discovery deps, token I/O, and registry handlers where needed; they do **not** call `googleapis` against real accounts.

Optional smoke test (requires your `.env`, `MASTER_KEY`, and `mcp-google-multi auth` per alias):

```bash
node dist/index.js config check
```

## Expected accounts and labels

### `GOOGLE_ACCOUNTS`

- Format: `alias:email` pairs, comma-separated (e.g. `work:you@co.com,personal:you@gmail.com`).
- **Alias rules:** `[a-zA-Z0-9_-]+` only (prevents token-path traversal). Must be unique.
- **Email:** everything after the first `:` (supports subaddresses like `user+tag@domain.com`).
- At runtime, encrypted tokens live at `{TOKEN_STORE_PATH or ~/.config/mcp-google-multi/tokens}/{alias}.enc`.

### Test / CI fixture

Vitest sets `GOOGLE_ACCOUNTS=test:test@example.com` in `tests/setup.ts`. Unit tests that need other aliases pass explicit account lists into helpers (e.g. `parseAccountSelector(..., ['alpha','beta'])`).

### Related env labels

| Variable | Expected values |
|----------|-----------------|
| `GOOGLE_PROFILE` | `read-only` (default), `safe-writes`, `full-writes` |
| `GOOGLE_TOOLSETS` | `all` or CSV of service names (see README); escape-hatch APIs use names like `slides`, `drivelabels` when no curated tools exist |
| `GOOGLE_OPTIONAL_SCOPES` | `forms`, `chat` (unknown keys logged and ignored) |
| `GOOGLE_ADMIN_ACCOUNTS` | CSV of **configured aliases** only (unknown aliases logged and ignored) |

## PR target

Open pull requests against **`dev`**, not `main` or `staging`.
