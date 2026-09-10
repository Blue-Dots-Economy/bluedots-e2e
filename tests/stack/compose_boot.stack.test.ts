import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposeProvider } from '../../src/env/compose/compose_provider.js';
import { assertBindSources } from '../../src/env/compose/overlay.js';
import { dockerRun } from '../../src/env/compose/docker_runner.js';
import { resolveTarget } from '../../src/targets/targets.js';
import { imageRef, resolveDigests, resolveTags } from '../../src/images/images.js';
import { dockerInspector } from '../../src/images/docker_inspector.js';
import type { EnvironmentContext } from '../../src/env/provider.js';
import { REQUIRED_RELATIONS } from '../../src/env/schema_gate.js';

/**
 * Boots the real stack for purple_dot and asserts the properties every later
 * ticket depends on. Slow by nature; excluded from the unit suite.
 *
 * BLUEDOTS_SCHEMAS_PATH and SIGNALS_DPG_PATH locate the two checkouts.
 */
const schemas =
  process.env.BLUEDOTS_SCHEMAS_PATH ??
  fileURLToPath(new URL('../../../bluedots-schemas', import.meta.url));
const signalsDpg =
  process.env.SIGNALS_DPG_PATH ??
  fileURLToPath(new URL('../../../Signals-DPG', import.meta.url));

describe('compose provider boots a usable stack', () => {
  let provider: ComposeProvider;
  let ctx: EnvironmentContext;

  beforeAll(async () => {
    const target = await resolveTarget(schemas, 'purple_dot', null);
    const tags = resolveTags({ branch: null, imagesFromTag: null });
    const digests = await resolveDigests(
      {
        'signals-dpg': imageRef('signals-dpg', 'api', tags['signals-dpg']),
        'signals-search': imageRef('signals-search', 'api', tags['signals-search']),
      },
      dockerInspector,
    );

    provider = new ComposeProvider(target, {
      run: dockerRun,
      writeFile: async (p, c) => writeFile(p, c),
      assertBindSources,
      digests,
      baseFile: join(signalsDpg, 'local-setup', 'docker-compose.yml'),
      runDir: await mkdtemp(join(tmpdir(), 'journey-')),
    });

    ctx = await provider.up();
  });

  afterAll(async () => {
    await provider?.down();
  });

  test('signals-dpg answers over HTTP', async () => {
    const res = await fetch(`${ctx.endpoints.signalsApi}/health/live`);

    expect(res.status).toBe(200);
  });

  test('signals-search answers over HTTP', async () => {
    // An empty body is rejected by validation, which still proves the service
    // is serving rather than merely listening.
    const res = await fetch(`${ctx.endpoints.searchApi}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBeLessThan(500);
  });

  test('the ingest consumer group exists, which the awaiter reads', async () => {
    const out = await dockerRun([
      'exec', 'signals-redis', 'redis-cli', '-a', 'journey-redis-pw',
      '--no-auth-warning', 'XINFO', 'GROUPS', 'signals:item-events',
    ]);

    expect(out).toContain('signals-search');
  });

  test('item_search exists, which the awaiter asserts on', async () => {
    const out = await dockerRun([
      'exec', 'signals-postgres', 'psql', '-U', 'postgres', '-d', 'postgresdb',
      '-tAc', "select to_regclass('public.item_search')",
    ]);

    expect(out.trim()).toBe('item_search');
  });

  test('every relation the schema gate requires is present', async () => {
    // up() already gated on this; asserting it here means a regression names
    // the schema rather than surfacing as an odd failure in a later journey.
    for (const relation of REQUIRED_RELATIONS) {
      const out = await dockerRun([
        'exec', 'signals-postgres', 'psql', '-U', 'postgres', '-d', 'postgresdb',
        '-tAc', `select to_regclass('public.${relation}')`,
      ]);

      // to_regclass quotes reserved words, so `user` comes back as `"user"`.
      expect(out.trim().replace(/^"|"$/g, ''), `${relation} must exist`).toBe(relation);
    }
  });

  test('publishes no fixed host port, so it coexists with other stacks', () => {
    // The base compose binds 5432/5555/8080/2742/3100 for a single-stack
    // developer. Inheriting those collides with whatever is already running.
    for (const fixed of [5432, 5555, 8080, 2742, 3100]) {
      expect(ctx.endpoints.signalsApi).not.toContain(`:${fixed}`);
      expect(ctx.endpoints.postgresUrl).not.toContain(`:${fixed}/`);
    }
  });

  test('reports the capabilities a journey checks against', () => {
    expect(ctx.capabilities).toEqual(['http', 'redis', 'postgres']);
    expect(ctx.disposable).toBe(true);
  });
});
