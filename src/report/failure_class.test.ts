import { describe, expect, test } from 'vitest';
import { classifyFailure } from './failure_class.js';

describe('classifyFailure', () => {
  test('calls a failed step a product failure', () => {
    // The thing a release manager must act on: the services did not do what
    // the journey asserted.
    expect(classifyFailure('STEP_FAILED: search 400 target must be item_state.<field>')).toBe(
      'product',
    );
  });

  test('calls a dead-letter event a product failure', () => {
    expect(classifyFailure('INGEST_DEAD_LETTER: dead-letter stream grew from 0 to 1')).toBe(
      'product',
    );
  });

  test('calls a stack that would not boot a harness failure', () => {
    // Nothing was verified, so the release is neither proven nor disproven.
    // Reporting it as a product failure sends someone to debug signals-dpg
    // over a compose file.
    expect(classifyFailure('STACK_UNHEALTHY: container signals-mailpit is unhealthy')).toBe(
      'harness',
    );
  });

  test('calls a missing image, an unusable target and a bad fixture harness failures', () => {
    for (const message of [
      'IMAGE_NOT_FOUND: notification-service (ghcr.io/...)',
      'TARGET_UNUSABLE: purple_dot serves no "provider" domain',
      'FIXTURE_UNSUPPORTED: no generator for pattern ^[A-Z]{3}$',
      'SEED_FAILED: apikey already existed',
      'INGEST_PROBE_UNREADABLE: could not read the dead-letter stream',
    ]) {
      expect(classifyFailure(message), message).toBe('harness');
    }
  });

  test('treats anything it does not recognise as a product failure', () => {
    // The safe default. Calling an unknown failure a harness problem would
    // let a real defect be waved through as "the suite's fault".
    expect(classifyFailure('TypeError: cannot read properties of undefined')).toBe('product');
  });
});
