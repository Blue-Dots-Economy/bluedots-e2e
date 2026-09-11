import { describe, expect, test } from 'vitest';
import { imageRef, resolveTags, resolveDigests } from './image_resolution.js';

describe('imageRef', () => {
  test('gives signals-dpg a per-component path', () => {
    expect(imageRef('signals-dpg', 'api', 'develop'))
      .toBe('ghcr.io/blue-dots-economy/signals-dpg/api:develop');
  });

  test('gives signals-search a single path with no component suffix', () => {
    // One image serves both api and worker; only the entrypoint differs.
    expect(imageRef('signals-search', 'api', 'develop'))
      .toBe('ghcr.io/blue-dots-economy/signals-search:develop');
    expect(imageRef('signals-search', 'worker', 'develop'))
      .toBe('ghcr.io/blue-dots-economy/signals-search:develop');
  });
});

describe('resolveTags', () => {
  test('defaults to develop, except notification-service which has none', () => {
    const tags = resolveTags({ branch: null, imagesFromTag: null });

    expect(tags['signals-dpg']).toBe('develop');
    // notification-service builds on main and feature only.
    expect(tags['notification-service']).toBe('main');
  });

  test('a release tag applies to every service', () => {
    const tags = resolveTags({ branch: null, imagesFromTag: '202608-s2-rc1' });

    expect(new Set(Object.values(tags))).toEqual(new Set(['202608-s2-rc1']));
  });

  test('a bare branch moves every service', () => {
    const tags = resolveTags({ branch: { __all__: 'feat/x' }, imagesFromTag: null });

    expect(tags['signals-search']).toBe('feat/x');
  });

  test('a per-service branch moves one and leaves the others on their default', () => {
    const tags = resolveTags({ branch: { 'signals-dpg': 'feat/x' }, imagesFromTag: null });

    expect(tags['signals-dpg']).toBe('feat/x');
    expect(tags['signals-search']).toBe('develop');
    expect(tags['notification-service']).toBe('main');
  });
});

describe('resolveDigests', () => {
  test('pins every reference to a digest', async () => {
    const inspect = async (ref: string) =>
      ref.includes('signals-search') ? 'sha256:aaa' : 'sha256:bbb';

    const out = await resolveDigests(
      { 'signals-search': 'ghcr.io/x/signals-search:develop' },
      inspect,
    );

    expect(out['signals-search']).toBe('sha256:aaa');
  });

  test('fails naming the service when an image is missing, never falls back', async () => {
    const inspect = async () => null;

    await expect(
      resolveDigests({ 'notification-service': 'ghcr.io/x/n:develop' }, inspect),
    ).rejects.toThrow(/IMAGE_NOT_FOUND.*notification-service/s);
  });
});

describe('resolveTags with per-service overrides', () => {
  test('a per-service tag wins over the release tag', () => {
    // Services are not always cut at the same candidate: a fix for an issue
    // found in rc1 ships as rc2 for that service alone.
    const tags = resolveTags({
      branch: null,
      imagesFromTag: '202609-s1-rc1',
      perService: { 'signals-dpg': '202609-s1-rc2' },
    });

    expect(tags['signals-dpg']).toBe('202609-s1-rc2');
    expect(tags['signals-search']).toBe('202609-s1-rc1');
  });

  test('per-service tags alone leave the rest on their defaults', () => {
    const tags = resolveTags({
      branch: null,
      imagesFromTag: null,
      perService: { 'signals-search': '202609-s1-rc3' },
    });

    expect(tags['signals-search']).toBe('202609-s1-rc3');
    expect(tags['signals-dpg']).toBe('develop');
    expect(tags['notification-service']).toBe('main');
  });

  test('an empty override is ignored rather than blanking the tag', () => {
    // A dispatch form submits "" for an untouched optional field; taking
    // that literally would resolve `image:` with no tag.
    const tags = resolveTags({
      branch: null,
      imagesFromTag: '202609-s1-rc1',
      perService: { 'signals-dpg': '' },
    });

    expect(tags['signals-dpg']).toBe('202609-s1-rc1');
  });
});
