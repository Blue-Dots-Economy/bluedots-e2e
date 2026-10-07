import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { listTargets, resolveTarget } from './target_discovery.js';

const SCHEMAS = fileURLToPath(new URL('../../tests/fixtures/schemas', import.meta.url));

describe('listTargets', () => {
  test('lists a dot with no instances as a bare target', async () => {
    const targets = await listTargets(SCHEMAS);

    expect(targets.map((t) => t.id)).toContain('purple_dot');
  });

  test('lists each instance of a dot, and not the dot itself', async () => {
    const targets = await listTargets(SCHEMAS);
    const ids = targets.map((t) => t.id);

    expect(ids).toContain('blue_dot/ka-dhwd');
    expect(ids).toContain('blue_dot/up-gzb');
    // A dot that HAS instances is not itself a target: no deployment runs the
    // dot-level config, so offering it would invite testing a config that
    // ships nowhere.
    expect(ids).not.toContain('blue_dot');
  });
});

describe('resolveTarget', () => {
  test('resolves an instance target to the instance network config', async () => {
    const t = await resolveTarget(SCHEMAS, 'blue_dot', 'ka-dhwd');

    expect(t.networkConfigPath).toBe(`${SCHEMAS}/blue_dot/ka-dhwd/network.json`);
  });

  test('falls back to the dot-level brand when the instance has none', async () => {
    const t = await resolveTarget(SCHEMAS, 'blue_dot', 'ka-dhwd');

    expect(t.consentPath).toBe(`${SCHEMAS}/blue_dot/ka-dhwd/consent.json`);
    expect(t.brandPath).toBe(`${SCHEMAS}/blue_dot/brand.json`);
  });

  test('derives SERVED_DOMAINS from the resolved config, not the dot', async () => {
    const instance = await resolveTarget(SCHEMAS, 'blue_dot', 'ka-dhwd');
    const purple = await resolveTarget(SCHEMAS, 'purple_dot', null);

    // ka-dhwd carries a third domain the dot-level config does not.
    expect(instance.servedDomains).toBe(
      'blue_dot/seeker,blue_dot/provider,blue_dot/service_provider',
    );
    expect(purple.servedDomains).toBe('purple_dot/seeker,purple_dot/provider');
  });

  test('reads the network id from the resolved config', async () => {
    const t = await resolveTarget(SCHEMAS, 'blue_dot', 'ka-dhwd');

    // NS_NETWORK must equal the id the catalogue's rows are seeded under,
    // which is the config's own id, not the directory name.
    expect(t.networkId).toBe('blue_dot');
  });

  test('resolves the instance catalogue for notification-service', async () => {
    const t = await resolveTarget(SCHEMAS, 'blue_dot', 'ka-dhwd');

    expect(t.cataloguePath).toBe(`${SCHEMAS}/blue_dot/ka-dhwd/ns-catalogue.json`);
  });

  test('a dot target uses the dot catalogue', async () => {
    const t = await resolveTarget(SCHEMAS, 'purple_dot', null);

    expect(t.cataloguePath).toBe(`${SCHEMAS}/purple_dot/ns-catalogue.json`);
  });

  test('an instance never falls back to the dot catalogue', async () => {
    // blue_dot/ns-catalogue.json exists in the fixtures, up-gzb has none of
    // its own. Seeding never overwrites, so a fallback would pin the dot's
    // copy on the instance for good; the deployed chart refuses it too.
    const t = await resolveTarget(SCHEMAS, 'blue_dot', 'up-gzb');

    expect(t.cataloguePath).toBeNull();
  });

  test('refuses a dot that has instances, naming what is available', async () => {
    await expect(resolveTarget(SCHEMAS, 'blue_dot', null)).rejects.toThrow(
      /blue_dot\/ka-dhwd/,
    );
  });

  test('refuses an unknown target rather than guessing', async () => {
    await expect(resolveTarget(SCHEMAS, 'blue_dot', 'nope')).rejects.toThrow(/nope/);
  });
});

describe('path resolution', () => {
  test('returns absolute paths even when given a relative schemas root', async () => {
    // Compose resolves relative bind sources against the project directory,
    // which is signals-dpg's local-setup, not this repo. A relative path here
    // silently mounts a nonexistent location -- Docker CREATES it as an empty
    // directory, and the service dies with EISDIR at runtime rather than
    // failing with a missing-file error.
    const t = await resolveTarget('tests/fixtures/schemas', 'purple_dot', null);

    expect(t.networkConfigPath.startsWith('/')).toBe(true);
  });
});
