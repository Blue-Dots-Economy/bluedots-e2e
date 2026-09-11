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
  /**
   * Per-service tags, highest precedence.
   *
   * Services are not always cut at the same candidate -- a fix for an issue
   * found in rc1 ships as rc2 for that service alone -- so a release is not
   * always one tag across four repos.
   */
  perService?: Partial<Record<Service, string>>;
}): Record<Service, string> {
  const out = {} as Record<Service, string>;
  for (const service of SERVICES) {
    // Trimmed and emptiness-checked: a dispatch form submits "" for an
    // untouched optional field, and taking that literally resolves an
    // image reference with no tag.
    const override = opts.perService?.[service]?.trim();
    if (override) {
      out[service] = override;
      continue;
    }
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
export const NOT_PUBLISHED = '(not published for this tag)';

/**
 * Resolve every tag to a digest; fail only on the ones this run boots.
 *
 * A release is not always cut across all four repos, and a journey boots
 * two of them. Failing the whole run because a service it never starts has
 * no image for that tag stops the verification that could have happened,
 * and reports nothing. The unresolved ones are recorded as unpublished, so
 * the evidence still says exactly which images were verified and which
 * were not -- without pretending they were.
 *
 * `required` defaults to every service: a caller that has not said what it
 * boots gets the strict behaviour.
 */
export async function resolveDigests(
  refs: Record<string, string>,
  inspect: Inspector,
  opts: { required?: string[] } = {},
): Promise<Record<string, string>> {
  const required = new Set(opts.required ?? Object.keys(refs));
  const out: Record<string, string> = {};
  const missing: string[] = [];

  await Promise.all(
    Object.entries(refs).map(async ([service, ref]) => {
      const digest = await inspect(ref);
      if (digest) out[service] = digest;
      else if (required.has(service)) missing.push(`${service} (${ref})`);
      else out[service] = NOT_PUBLISHED;
    }),
  );

  if (missing.length > 0) {
    throw new Error(`IMAGE_NOT_FOUND: ${missing.sort().join(', ')}`);
  }
  return out;
}
