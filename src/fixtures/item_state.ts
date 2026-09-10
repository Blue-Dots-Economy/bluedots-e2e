type JsonSchema = {
  required?: string[];
  properties?: Record<string, PropSchema>;
};

type PropSchema = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  pattern?: string;
  minItems?: number;
  items?: PropSchema;
  vectorize?: boolean;
};

/** Small deterministic hash, so a seed reproduces a fixture exactly. */
function hash(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function digits(seed: string, count: number): string {
  let out = '';
  let h = hash(seed);
  while (out.length < count) {
    out += String(h % 10);
    h = Math.floor(h / 10) || hash(out + seed);
  }
  return out.slice(0, count);
}

function valueFor(name: string, prop: PropSchema, seed: string): unknown {
  const s = `${seed}:${name}`;

  if (prop.enum && prop.enum.length > 0) {
    return prop.enum[hash(s) % prop.enum.length];
  }

  switch (prop.type) {
    case 'integer':
    case 'number': {
      const min = prop.minimum ?? 1;
      const max = prop.maximum ?? min + 50;
      return min + (hash(s) % Math.max(1, max - min + 1));
    }
    case 'boolean':
      return true;
    case 'array': {
      const item = prop.items ?? { type: 'string' };
      const count = Math.max(1, prop.minItems ?? 1);
      return Array.from({ length: count }, (_, i) => valueFor(`${name}[${i}]`, item, s));
    }
    default: {
      // Patterns here are simple enough to satisfy directly; anything more
      // would need a generator, and a wrong guess fails validation loudly
      // rather than silently.
      if (prop.pattern === '^[0-9]{10}$') return digits(s, 10);
      if (prop.pattern) {
        throw new Error(`FIXTURE_UNSUPPORTED: no generator for pattern ${prop.pattern}`);
      }
      // Every generated string is seed-distinct, not just vectorized ones.
      // Search filters target `item_state.<field>`, so a journey isolates
      // its own item by matching one of these -- and two runs sharing a
      // value would make that assertion ambiguous about which item matched.
      return prop.vectorize
        ? `journey fixture ${seed} ${name}`
        : `journey-${name}-${seed}`;
    }
  }
}

/**
 * Build a valid `item_state` from a network's own item schema.
 *
 * Per-network by construction: purple_dot/seeker declares ten required
 * fields including enums and a ten-digit pattern, and another target
 * declares something else entirely. Hardcoding a body would mean test code
 * per target, which is exactly what the design says adding a target must
 * not cost.
 *
 * Only required fields are emitted. The route rejects unknown keys with
 * "Invalid item_state: must NOT have additional properties", so a generator
 * that helpfully adds extras breaks every journey.
 */
export function buildItemState(
  schema: JsonSchema,
  seed = 'journey',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const prop = schema.properties?.[name];
    if (!prop) throw new Error(`FIXTURE_INVALID: required field ${name} has no schema`);
    out[name] = valueFor(name, prop, seed);
  }
  return out;
}
