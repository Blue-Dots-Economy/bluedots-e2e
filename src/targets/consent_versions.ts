/**
 * The consent versions a target declares.
 *
 * From the target's own consent.json in bluedots-schemas -- the same source
 * signals resolves them from -- rather than a number written down here. The
 * accept route demands a version per item and the ledger stores what it is
 * given, so a hardcoded one records an acceptance of a document nobody is
 * being shown the moment the network publishes a new revision.
 */
export type ConsentVersions = { versionFor: (category: string) => number };

type ConsentDoc = {
  documents?: Record<string, { current_version?: number }>;
};

export function readConsentVersions(raw: string): ConsentVersions {
  const doc = JSON.parse(raw) as ConsentDoc;
  return {
    versionFor(category) {
      const version = doc.documents?.[category]?.current_version;
      if (typeof version !== 'number') {
        throw new Error(
          `TARGET_UNUSABLE: this target's consent document declares no current version for ` +
            `"${category}". It offers: ${Object.keys(doc.documents ?? {}).join(', ') || 'nothing'}.`,
        );
      }
      return version;
    },
  };
}
