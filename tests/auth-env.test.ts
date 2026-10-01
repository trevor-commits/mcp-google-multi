import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAdminAccounts, getOptionalBundles } from '../src/auth.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getOptionalBundles', () => {
  it('returns known bundles and ignores unknown keys with stderr notice', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const bundles = getOptionalBundles({ GOOGLE_OPTIONAL_SCOPES: 'forms,chat,nope,forms' });
    expect(bundles).toEqual(['forms', 'chat']);
    expect(stderr.mock.calls.some((c) => String(c[0]).includes('unknown bundle "nope"'))).toBe(true);
  });
});

describe('getAdminAccounts', () => {
  it('keeps configured aliases and ignores unknown ones with stderr notice', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const admins = getAdminAccounts({ GOOGLE_ADMIN_ACCOUNTS: 'test,bogus,test' });
    expect(admins).toEqual(['test']);
    expect(stderr.mock.calls.some((c) => String(c[0]).includes('unknown alias "bogus"'))).toBe(true);
  });
});
