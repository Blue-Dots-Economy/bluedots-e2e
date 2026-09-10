import { describe, expect, test } from 'vitest';
import { assertBindSources, renderOverlay } from './overlay.js';

const TARGET = {
  id: 'purple_dot', dot: 'purple_dot', instance: null,
  networkConfigPath: '/schemas/purple_dot/network.json',
  consentPath: null, brandPath: null,
  servedDomains: 'purple_dot/seeker',
};
const OPTS = {
  target: TARGET,
  digests: { 'signals-dpg': 'sha256:a', 'signals-search': 'sha256:b' },
  timing: { SWEEP_INTERVAL_MS: '3600000', CACHE_TTL_SECONDS: '0', PEL_MIN_IDLE_MS: '5000' },
};

describe('renderOverlay', () => {
  test('publishes no fixed host port', () => {
    // The base compose publishes 5432, 5555, 8080, 8025, 2742 and 3100 for a
    // developer running ONE stack. A harness must coexist with whatever the
    // developer already has up -- and with a run for another target -- so
    // every published port is ephemeral and discovered after boot.
    const yaml = renderOverlay(OPTS);

    for (const port of ['5432:', '5555:', '8080:', '8025:', '2742:', '3100:']) {
      expect(yaml, `must not bind host ${port}`).not.toContain(`"${port}`);
    }
  });

  test('replaces the port list rather than appending to it', () => {
    // Compose MERGES sequences by default, so without an explicit override
    // the base file's fixed ports survive alongside the ephemeral ones.
    const yaml = renderOverlay(OPTS);

    expect(yaml).toContain('ports: !override');
  });

  test('leaves the bootstrap image to the base compose build', () => {
    // Naming an image no registry has makes compose try to pull it before
    // falling back to build, which fails the run.
    expect(renderOverlay(OPTS)).not.toContain('bootstrap:local');
  });

  test('pins the service images by digest', () => {
    const yaml = renderOverlay(OPTS);

    expect(yaml).toContain('signals-dpg/api@sha256:a');
    expect(yaml).toContain('signals-search@sha256:b');
  });
});

describe('assertBindSources', () => {
  test('accepts a path that is a real file', async () => {
    await expect(assertBindSources([import.meta.filename])).resolves.toBeUndefined();
  });

  test('refuses a missing path rather than letting Docker invent a directory', async () => {
    // Docker CREATES a missing bind source as an empty directory. The
    // container then reads a directory and dies with EISDIR, far from the
    // typo that caused it.
    await expect(assertBindSources(['/no/such/network.json'])).rejects.toThrow(
      /\/no\/such\/network\.json/,
    );
  });

  test('refuses a directory where a file is required', async () => {
    await expect(assertBindSources([import.meta.dirname])).rejects.toThrow(/not a file/);
  });
});

describe('mailpit healthcheck', () => {
  test('replaces the base healthcheck, which can never pass', () => {
    // The base uses /dev/tcp/127.0.0.1/8025 -- a bash builtin. The mailpit
    // image has sh but no bash, so CMD-SHELL can never satisfy it and the
    // container sits permanently unhealthy. Invisible until something waits
    // on health, which `up --wait` does.
    const yaml = renderOverlay(OPTS);

    expect(yaml).toContain('mailpit:');
    expect(yaml).toContain('healthcheck:');
    expect(yaml).toContain('wget');
  });
});
