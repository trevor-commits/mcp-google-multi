import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseGoogleAccounts } from '../src/accounts.js';

const tokenDir = '/tmp/mcp-google-multi-tokens';

describe('parseGoogleAccounts', () => {
  it('parses alias:email pairs and builds token paths under tokenDir', () => {
    const { aliases, configs } = parseGoogleAccounts(
      'work:you@co.com, personal:you@gmail.com',
      tokenDir,
    );
    expect(aliases).toEqual(['work', 'personal']);
    expect(configs.work.email).toBe('you@co.com');
    expect(configs.work.encPath).toBe(path.join(tokenDir, 'work.enc'));
    expect(configs.personal.tokenPath).toBe(path.join(tokenDir, 'personal', 'token.json'));
  });

  it('rejects path-traversal aliases', () => {
    expect(() => parseGoogleAccounts('../../evil:foo@bar.com', tokenDir)).toThrow(/Invalid alias/);
  });

  it('rejects duplicate aliases', () => {
    expect(() => parseGoogleAccounts('work:a@b.com,work:c@d.com', tokenDir)).toThrow(/Duplicate alias/);
  });

  it('rejects entries without a colon separator', () => {
    expect(() => parseGoogleAccounts('workonly', tokenDir)).toThrow(/Expected format: alias:email/);
  });

  it('requires at least one non-empty entry', () => {
    expect(() => parseGoogleAccounts('  ,  ', tokenDir)).toThrow(/at least one account/);
    expect(() => parseGoogleAccounts('', tokenDir)).toThrow(/GOOGLE_ACCOUNTS is not set/);
  });
});
