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

describe('keycloak realm', () => {
  test('imports the prepared copy of aggregator-dpg\'s 8-client realm', () => {
    // The export is read from aggregator-dpg but written out again after
    // prepareRealm fixes what Keycloak cannot import, so the mount points at
    // the run directory rather than the checkout.
    const yaml = renderOverlay({
      ...OPTS,
      aggregatorRoot: '/repo/aggregator-dpg',
      realmDir: '/run/realms',
    });

    expect(yaml).toContain('/run/realms:/opt/keycloak/data/import-template:ro');
  });

  test('renders it with aggregator\'s script, not signals\'', () => {
    // signals' script substitutes 11 placeholders and aggregator's 19, and
    // signals' substitutes NEITHER the realm name NOR any client secret.
    // Rendering the aggregator export through it imports a realm literally
    // named __KEYCLOAK_REALM__ with __*_SECRET__ for secrets.
    const yaml = renderOverlay({ ...OPTS, aggregatorRoot: '/repo/aggregator-dpg' });

    expect(yaml).toContain('/repo/aggregator-dpg/infra/keycloak/render-realm.sh:/opt/keycloak/render-realm.sh:ro');
  });

  test('mounts aggregator\'s themes, which carry the signals login theme', () => {
    // signals-ui in that realm sets login_theme: signals, and that theme
    // exists only under aggregator-dpg. Its themes dir also contains otp, so
    // it is a superset and replaces the mount rather than conflicting.
    const yaml = renderOverlay({ ...OPTS, aggregatorRoot: '/repo/aggregator-dpg' });

    expect(yaml).toContain('/repo/aggregator-dpg/infra/keycloak/themes:/opt/keycloak/themes:ro');
  });
});

describe('keycloak volume replacement', () => {
  test('replaces the volume list rather than appending to it', () => {
    // Compose appends sequences. Without !override, signals' themes and
    // aggregator's themes both target /opt/keycloak/themes and the mounts
    // collide.
    const yaml = renderOverlay({ ...OPTS, aggregatorRoot: '/repo/aggregator-dpg' });

    expect(yaml).toContain('volumes: !override');
    expect(yaml).not.toContain('../infra/keycloak/themes');
  });

  test('keeps the provider jar and the data volume the base declared', () => {
    // !override drops everything the base listed, so anything still needed
    // has to be restated: the OTP authenticator SPI, and the named volume
    // Keycloak stores its dev-mode database in.
    const yaml = renderOverlay({ ...OPTS, aggregatorRoot: '/repo/aggregator-dpg' });

    expect(yaml).toContain('/opt/keycloak/providers:ro');
    expect(yaml).toContain('signals-keycloak-data:/opt/keycloak/data');
  });
});

describe('keycloak container environment', () => {
  test('passes the aggregator render script its own variables', () => {
    // An .env file only feeds compose-file interpolation; it does not reach
    // the container. The base compose's keycloak service passes what SIGNALS'
    // render script needs, and aggregator's script needs more -- notably
    // KEYCLOAK_REALM, which signals' script does not substitute at all.
    const yaml = renderOverlay({ ...OPTS, aggregatorRoot: '/repo/aggregator-dpg' });

    for (const key of [
      'KEYCLOAK_REALM',
      'AGGREGATOR_API_SECRET',
      'AGGREGATOR_PORTAL_SECRET',
      'AGGREGATOR_BFF_SECRET',
      'SIGNALS_API_SECRET',
      'CAMPAIGN_MANAGER_SECRET',
      'VOICE_DPG_SIGNALS_SECRET',
      'SIGNALSTACK_CLIENT_SECRET',
    ]) {
      expect(yaml, `${key} must reach the keycloak container`).toContain(`${key}:`);
    }
  });
});

describe('container naming', () => {
  test('drops the fixed container names the base compose sets', () => {
    // container_name is global to the docker daemon, so a stale run or a
    // second target collides with "The container name /signals-mailpit is
    // already in use". Resetting it lets compose use project-scoped names.
    const yaml = renderOverlay({ ...OPTS, aggregatorRoot: '/repo/agg' });

    for (const service of ['postgres', 'redis', 'keycloak', 'mailpit', 'signals-api']) {
      expect(yaml, `${service} must not keep a fixed container_name`).toContain(
        'container_name: !reset null',
      );
    }
  });
});
