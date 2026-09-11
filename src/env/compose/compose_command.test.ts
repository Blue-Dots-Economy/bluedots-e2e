import { describe, expect, test } from 'vitest';
import { composeArgs, projectName } from './compose_command.js';

describe('projectName', () => {
  test('is unique per target so two targets never share containers', () => {
    expect(projectName({ dot: 'blue_dot', instance: 'ka-dhwd' }))
      .toBe('journey-blue-dot-ka-dhwd');
    expect(projectName({ dot: 'purple_dot', instance: null }))
      .toBe('journey-purple-dot');
  });
});

describe('composeArgs', () => {
  const base = '/repo/Signals-DPG/local-setup/docker-compose.yml';
  const overlay = '/run/overlay.yml';

  test('layers the overlay on top of the signals-dpg local-setup compose', () => {
    const a = composeArgs({
      project: 'journey-purple-dot',
      baseFile: base,
      overlayFile: overlay,
      envFile: '/run/.env',
      command: ['up', '-d'],
    });

    expect(a.indexOf('-f')).toBeLessThan(a.indexOf(overlay));
    expect(a.slice(a.indexOf(base), a.indexOf(overlay))).toContain(base);
  });

  test('enables the keycloak and search profiles, which are opt-in', () => {
    const a = composeArgs({
      project: 'p', baseFile: base, overlayFile: overlay,
      envFile: '/run/.env', command: ['up', '-d'],
    });

    expect(a.filter((x) => x === '--profile')).toHaveLength(2);
    expect(a).toContain('keycloak');
    expect(a).toContain('search');
  });

  test('sets the project directory to the base file directory', () => {
    // Relative paths inside the base compose (../infra/keycloak/...) resolve
    // against the project directory, so it must be local-setup's own dir or
    // every bind mount breaks.
    const a = composeArgs({
      project: 'p', baseFile: base, overlayFile: overlay,
      envFile: '/run/.env', command: ['up', '-d'],
    });

    const i = a.indexOf('--project-directory');
    expect(a[i + 1]).toBe('/repo/Signals-DPG/local-setup');
  });
});

describe('projectName suffix', () => {
  test('separates two stacks for the same target', () => {
    // The negative control boots its own stack alongside the real one.
    // Deriving the project from (dot, instance) alone gave both
    // "journey-purple-dot", so the control's `up` reconfigured the real
    // stack's containers onto the decoy consumer group and its `down -v`
    // destroyed the other's volumes. It only ever worked because
    // fileParallelism is off -- a config flag three files away.
    const real = projectName({ dot: 'purple_dot', instance: null });
    const control = projectName({ dot: 'purple_dot', instance: null }, 'control');

    expect(real).not.toBe(control);
    expect(control).toContain('control');
  });

  test('is unchanged without a suffix, so existing projects still match', () => {
    expect(projectName({ dot: 'purple_dot', instance: null })).toBe('journey-purple-dot');
  });
});
