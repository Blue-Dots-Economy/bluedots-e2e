/**
 * Where each service's committed OpenAPI spec lives.
 *
 * The specs are fetched at the ref a run resolved, never vendored into this
 * repository. Vendoring lets them drift silently, which is the same argument
 * the design makes against baking network schemas.
 */
export const SPEC_SOURCES = {
  'signals-dpg': { repo: 'Blue-Dots-Economy/signals-dpg', path: 'openapi.json' },
  'aggregator-dpg': { repo: 'Blue-Dots-Economy/aggregator-dpg', path: 'openapi.json' },
  'signals-search': { repo: 'Blue-Dots-Economy/signals-search', path: 'openapi.json' },
} as const;

export type SpecService = keyof typeof SPEC_SOURCES;

/**
 * notification-service publishes no openapi.json. Recorded here rather than
 * merely omitted, so nobody "fixes" the gap by vendoring a hand-written spec
 * that would then drift from the service with nothing to catch it.
 */
export const specsWithoutOpenapi = ['notification-service'] as const;

export type SpecFetcher = {
  /** Resolve a branch or tag to the commit sha it currently points at. */
  resolveSha: (repo: string, ref: string) => Promise<string>;
  /** Read a file at a pinned sha, or null when it does not exist. */
  readFile: (repo: string, path: string, sha: string) => Promise<string | null>;
};

export type FetchedSpec = { sha: string; body: string };

/**
 * Fetch each spec at a pinned commit.
 *
 * A branch ref moves, so generating from `develop` twice could yield
 * different clients with no record of why. Resolving to a sha first makes the
 * generated client attributable to an exact revision.
 */
export async function fetchSpecs(
  refs: Partial<Record<SpecService, string>>,
  fetcher: SpecFetcher,
): Promise<Partial<Record<SpecService, FetchedSpec>>> {
  const out: Partial<Record<SpecService, FetchedSpec>> = {};
  const missing: string[] = [];

  for (const [service, ref] of Object.entries(refs) as [SpecService, string][]) {
    const source = SPEC_SOURCES[service];
    const sha = await fetcher.resolveSha(source.repo, ref);
    const body = await fetcher.readFile(source.repo, source.path, sha);
    if (body === null) {
      missing.push(`${service} (${source.repo}@${sha}:${source.path})`);
      continue;
    }
    out[service] = { sha, body };
  }

  if (missing.length > 0) {
    throw new Error(`SPEC_NOT_FOUND: ${missing.join(', ')}`);
  }
  return out;
}
