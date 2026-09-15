import { describe, expect, test } from 'vitest';
import { SEARCH_CALLER_API_KEY, grantSearchCallerKey, hashApiKey } from './search_api_key.js';

describe('hashApiKey', () => {
  test('matches better-auth: unpadded base64url of the sha-256', () => {
    // signals-search reads the same column better-auth writes, so a padded
    // or hex digest silently authenticates nobody.
    const hashed = hashApiKey('sk_signals_example');

    expect(hashed).not.toContain('=');
    expect(hashed).not.toMatch(/[+/]/);
    expect(hashed).toHaveLength(43);
  });
});

describe('grantSearchCallerKey', () => {
  test('inserts the hash, never the raw key', async () => {
    const sent: string[] = [];

    await grantSearchCallerKey({
      exec: async (_svc, cmd) => {
        sent.push(cmd.join(' '));
        return 'INSERT 0 1';
      },
      userId: 'usr_1',
    });

    expect(sent[0]).toContain(hashApiKey(SEARCH_CALLER_API_KEY));
    expect(sent[0]).not.toContain(`'${SEARCH_CALLER_API_KEY}'`);
  });

  test('fails loudly rather than leaving the API unable to call search', async () => {
    await expect(
      grantSearchCallerKey({ exec: async () => 'ERROR:  relation "apikey" does not exist', userId: 'u' }),
    ).rejects.toThrow(/SEED_FAILED/);
  });
});
