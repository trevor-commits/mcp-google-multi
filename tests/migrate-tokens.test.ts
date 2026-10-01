import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_CONFIG } from '../src/accounts.js';
import { runMigrateTokens } from '../src/migrate-tokens.js';
import { hasToken, readToken } from '../src/token-store.js';

const KEY = 'migrate-test-key';
const sample = { refresh_token: 'r', access_token: 'a' };

const originalTokenPath = ACCOUNT_CONFIG.test.tokenPath;
const originalEncPath = ACCOUNT_CONFIG.test.encPath;
const cleanupDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  ACCOUNT_CONFIG.test.tokenPath = originalTokenPath;
  ACCOUNT_CONFIG.test.encPath = originalEncPath;
  delete process.env.MASTER_KEY;
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runMigrateTokens', () => {
  it('migrates valid plaintext and skips invalid JSON without aborting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-tokens-'));
    cleanupDirs.push(dir);
    const plainDir = path.join(dir, 'test');
    fs.mkdirSync(plainDir, { recursive: true });
    ACCOUNT_CONFIG.test.tokenPath = path.join(plainDir, 'token.json');
    ACCOUNT_CONFIG.test.encPath = path.join(dir, 'test.enc');
    process.env.MASTER_KEY = KEY;

    fs.writeFileSync(ACCOUNT_CONFIG.test.tokenPath, '{not-json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    runMigrateTokens();

    expect(hasToken('test')).toBe(false);
    expect(stderr.mock.calls.some((c) => String(c[0]).includes('could not parse'))).toBe(true);
    expect(log.mock.calls.some((c) => String(c[0]).includes('0 migrated'))).toBe(true);

    fs.writeFileSync(ACCOUNT_CONFIG.test.tokenPath, JSON.stringify(sample));
    runMigrateTokens();

    expect(readToken('test')).toEqual(sample);
    expect(log.mock.calls.some((c) => String(c[0]).includes('1 migrated'))).toBe(true);
  });
});
