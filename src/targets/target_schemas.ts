export type ItemSchema = { required?: string[]; properties?: Record<string, unknown> };

export type NetworkConfig = {
  id: string;
  domains: { id: string; item_schemas: Record<string, unknown> }[];
};

export type TargetSchemas = {
  network: string;
  domains: string[];
  schemaFor(domain: string): { itemType: string; itemSchema: ItemSchema };
};

/**
 * The target's schemas, resolved per domain rather than pinned to one.
 *
 * A step declares which domain it acts as (`createProfile({ as: 'provider' })`)
 * and the fixture it builds has to come from THAT domain's schema. Carrying a
 * single {itemType, itemSchema} on the context meant the domain came from the
 * step while the fields came from whichever domain the spec happened to
 * hardcode -- so anything but a seeker sent the wrong fields and was rejected
 * for additional properties, with the error pointing at the generator.
 *
 * Built from network.json, so a second target and a second domain are
 * configuration rather than test code.
 */
export function buildTargetSchemas(config: NetworkConfig): TargetSchemas {
  return {
    network: config.id,
    domains: config.domains.map((d) => d.id),

    schemaFor(domain: string) {
      const found = config.domains.find((d) => d.id === domain);
      if (!found) {
        throw new Error(
          `TARGET_UNUSABLE: ${config.id} serves no "${domain}" domain ` +
            `(it serves ${config.domains.map((d) => d.id).join(', ')}). ` +
            `A step acting as "${domain}" cannot run against this target.`,
        );
      }

      const [itemType] = Object.keys(found.item_schemas);
      if (!itemType) {
        throw new Error(
          `TARGET_UNUSABLE: ${config.id}'s "${domain}" domain declares no item schema, ` +
            `so there is nothing to build a fixture from.`,
        );
      }

      return { itemType, itemSchema: found.item_schemas[itemType] as ItemSchema };
    },
  };
}
