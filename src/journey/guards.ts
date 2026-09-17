/**
 * The five declared capabilities. Closed on purpose: the evidence sheet
 * groups by capability, so an open set means the business-facing report
 * grows categories nobody agreed to.
 */
export const CAPABILITIES = [
  'participant-onboarding',
  'search-and-discovery',
  'notifications',
  'consent-and-data-disclosure',
  'voice-assistant',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type GuardResult = { ok: true } | { ok: false; reason: string };

const SERVICE_NAMES = [
  'signals-dpg',
  'signals-search',
  'aggregator-dpg',
  'notification-service',
  'keycloak',
  'postgres',
  'redis',
];

/**
 * A scenario title and a step label must read as prose.
 *
 * The label written beside a step IS the line the report prints -- nothing is
 * translated at render time. That is what stops the business-facing report
 * drifting from what the tests assert, and it only holds if the labels are
 * readable by the people the report is for.
 */
export function checkLabel(label: string): GuardResult {
  if (label.trim().length === 0) return { ok: false, reason: 'label is empty' };

  if (/(^|\s)\/[a-z0-9]/i.test(label) || /\b(GET|POST|PUT|PATCH|DELETE)\b/.test(label)) {
    return { ok: false, reason: `label contains a route path or HTTP method: "${label}"` };
  }

  const service = SERVICE_NAMES.find((s) => label.toLowerCase().includes(s));
  if (service) {
    return { ok: false, reason: `label names a service ("${service}"): "${label}"` };
  }

  // snake_case or camelCase tokens are identifiers, not prose.
  if (/\b[a-z]+_[a-z_]+\b/.test(label) || /\b[a-z]+[A-Z][a-zA-Z]*\b/.test(label)) {
    return { ok: false, reason: `label contains an identifier: "${label}"` };
  }

  return { ok: true };
}

export function checkCapabilitySlug(slug: string): GuardResult {
  if ((CAPABILITIES as readonly string[]).includes(slug)) return { ok: true };
  return {
    ok: false,
    reason: `unknown capability "${slug}". Declared: ${CAPABILITIES.join(', ')}`,
  };
}
