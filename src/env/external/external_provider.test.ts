import { describe, expect, test } from 'vitest';
import { ExternalProvider, parseEnvironmentFile } from './external_provider.js';

const CONFIG = {
  name: 'cluster-dev',
  disposable: false,
  capabilities: ['http'],
  endpoints: {
    signalsApi: 'https://signals.dev.example',
    searchApi: 'https://search.dev.example',
    keycloak: 'https://kc.dev.example',
    postgresUrl: '',
    redisUrl: '',
  },
};

const TARGET = {
  id: 'purple_dot', dot: 'purple_dot', instance: null,
  networkConfigPath: '/schemas/purple_dot/network.json',
  consentPath: null, brandPath: null, servedDomains: 'purple_dot/seeker',
};

describe('parseEnvironmentFile', () => {
  test('reads scheme, host and credentials from config, never from code', () => {
    // http vs https is a field. If pointing at another environment needed a
    // code change, the seam has failed.
    const cfg = parseEnvironmentFile(JSON.stringify(CONFIG));

    expect(cfg.endpoints.signalsApi).toBe('https://signals.dev.example');
  });

  test('rejects a config missing an endpoint rather than defaulting', () => {
    const bad = { ...CONFIG, endpoints: { ...CONFIG.endpoints, searchApi: '' } };

    expect(() => parseEnvironmentFile(JSON.stringify(bad))).toThrow(/searchApi/);
  });

  test('defaults disposable to false, the safe answer', () => {
    const { disposable, ...rest } = CONFIG;
    void disposable;

    expect(parseEnvironmentFile(JSON.stringify(rest)).disposable).toBe(false);
  });
});

describe('ExternalProvider', () => {
  test('boots nothing and resolves no images', async () => {
    const ctx = await new ExternalProvider(TARGET, parseEnvironmentFile(JSON.stringify(CONFIG)), {
      probe: async () => true,
    }).up();

    // It owns no lifecycle. If it ever needs more than a reachability
    // check, something below it was hardcoded.
    expect(ctx.digests).toEqual({});
  });

  test('carries the environment capabilities through unchanged', async () => {
    const ctx = await new ExternalProvider(TARGET, parseEnvironmentFile(JSON.stringify(CONFIG)), {
      probe: async () => true,
    }).up();

    // http-only: a journey needing redis is reported NOT COVERED here
    // rather than silently asserting something weaker.
    expect(ctx.capabilities).toEqual(['http']);
    expect(ctx.disposable).toBe(false);
  });

  test('fails naming the endpoint that did not answer', async () => {
    const p = new ExternalProvider(TARGET, parseEnvironmentFile(JSON.stringify(CONFIG)), {
      probe: async (url) => !url.includes('search'),
    });

    await expect(p.up()).rejects.toThrow(/searchApi/);
  });

  test('tears down nothing, because it started nothing', async () => {
    const p = new ExternalProvider(TARGET, parseEnvironmentFile(JSON.stringify(CONFIG)), {
      probe: async () => true,
    });
    await p.up();

    await expect(p.down()).resolves.toBeUndefined();
  });
});
