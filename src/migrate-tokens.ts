import fs from 'node:fs';
import { ACCOUNTS, ACCOUNT_CONFIG } from './accounts.js';
import { writeToken, hasToken } from './token-store.js';

export function runMigrateTokens(): void {
  let migrated = 0;
  let skipped = 0;
  for (const alias of ACCOUNTS) {
    const plain = ACCOUNT_CONFIG[alias].tokenPath;
    if (!fs.existsSync(plain)) continue;
    if (hasToken(alias)) {
      console.log(`• ${alias}: encrypted token already exists, skipping`);
      skipped++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(plain, 'utf8'));
    } catch (err) {
      process.stderr.write(
        `✗ ${alias}: could not parse ${plain} — ${(err as Error).message}; skipping\n`,
      );
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      process.stderr.write(`✗ ${alias}: expected a JSON object in ${plain}; skipping\n`);
      continue;
    }
    writeToken(alias, parsed as object);
    console.log(`✓ ${alias}: migrated ${plain} → encrypted store`);
    migrated++;
  }
  console.log(
    `Done. ${migrated} migrated, ${skipped} skipped. ` +
      'Delete the plaintext tokens/<alias>/token.json once verified.',
  );
}
