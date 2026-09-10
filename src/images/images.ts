import { SERVICES, ALL_SERVICES, type Service } from '../cli/args.js';

const REGISTRY = 'ghcr.io/blue-dots-economy';

/**
 * Registry layout is NOT uniform across the fleet, so this is a lookup rather
 * than a formula:
 *
 *   signals-dpg           /<component>   matrix is api, ui
 *   aggregator-dpg        /<component>   matrix is api, web, worker (no "ui")
 *   signals-search        (none)         ONE image for api and worker
 *   notification-service  (none)         no matrix
 */
const PER_COMPONENT: Record<Service, boolean> = {
  'signals-dpg': true,
  'aggregator-dpg': true,
  'signals-search': false,
  'notification-service': false,
};

/**
 * Default tag per service.
 *
 * `develop` is published only after CI passes, so it is never a red build.
 * notification-service is the exception: its build workflow triggers on
 * `main` and `feature` only, so it publishes no `:develop` at all.
 */
const DEFAULT_TAG: Record<Service, string> = {
  'signals-dpg': 'develop',
  'aggregator-dpg': 'develop',
  'signals-search': 'develop',
  'notification-service': 'main',
};

export function imageRef(service: Service, component: string, tag: string): string {
  const path = PER_COMPONENT[service] ? `${service}/${component}` : service;
  return `${REGISTRY}/${path}:${tag}`;
}

export function resolveTags(opts: {
  branch: Record<string, string> | null;
  imagesFromTag: string | null;
}): Record<Service, string> {
  const out = {} as Record<Service, string>;
  for (const service of SERVICES) {
    if (opts.imagesFromTag) {
      out[service] = opts.imagesFromTag;
      continue;
    }
    const all = opts.branch?.[ALL_SERVICES];
    out[service] = opts.branch?.[service] ?? all ?? DEFAULT_TAG[service];
  }
  return out;
}

/** Returns the digest for a reference, or null when it does not exist. */
export type Inspector = (ref: string) => Promise<string | null>;

/**
 * Pin every reference to a digest.
 *
 * Branch tags are mutable, so what a run verified is only knowable if the
 * digest is recorded. A missing image fails loudly naming the service — a
 * silent fallback to some other tag would mean reporting a green run against
 * images nobody chose.
 */
export async function resolveDigests(
  refs: Record<string, string>,
  inspect: Inspector,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];

  await Promise.all(
    Object.entries(refs).map(async ([service, ref]) => {
      const digest = await inspect(ref);
      if (digest) out[service] = digest;
      else missing.push(`${service} (${ref})`);
    }),
  );

  if (missing.length > 0) {
    throw new Error(`IMAGE_NOT_FOUND: ${missing.sort().join(', ')}`);
  }
  return out;
}
