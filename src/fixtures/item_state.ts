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

  const handle = isolatingHandle(schema, out);
  if (handle) out[handle] = valueFor(handle, schema.properties![handle]!, seed);

  return out;
}

/**
 * One extra field, only when nothing required can isolate the item.
 *
 * A journey finds its own item by filtering on a seed-distinct value, and
 * signals-dpg masks the domain's contact fields on the way in -- search
 * holds "j***", never what was written. blue_dot/ka-dhwd requires exactly
 * `name` and `phone`, which are exactly its contact_fields, so a fixture of
 * required fields alone left that target with no handle at all and J2 could
 * assert nothing there.
 *
 * Vectorized first: that marker is the network's own declaration that a
 * field is searchable text, and in no target so far is a vectorized field
 * also a contact field. An enum cannot carry a seed-distinct value and a
 * pattern needs a generator, so both are skipped.
 *
 * Returns undefined when a required field already serves, because emitting
 * more than the schema requires is surface the journey does not need.
 */
function isolatingHandle(
  schema: JsonSchema,
  emitted: Record<string, unknown>,
): string | undefined {
  const usable = (prop: PropSchema | undefined) =>
    prop?.type === 'string' && !prop.enum && !prop.pattern;

  // Judged on `vectorize`, not on shape: whether a field survives indexing
  // is signals-dpg's business, and nothing in the item schema says which
  // ones it masks. The network's own searchable-text marker is the closest
  // thing to a guarantee the schema offers.
  const alreadyHasOne = Object.entries(emitted).some(
    ([k]) => usable(schema.properties?.[k]) && schema.properties?.[k]?.vectorize,
  );
  if (alreadyHasOne) return undefined;

  const candidates = Object.entries(schema.properties ?? {}).filter(
    ([name, prop]) => !(name in emitted) && usable(prop),
  );
  // A schema declaring no vectorized text at all falls back to any plain
  // string. That may itself be masked, and the search step says so by name
  // rather than failing blank.
  return candidates.find(([, prop]) => prop.vectorize)?.[0] ?? candidates[0]?.[0];
}
