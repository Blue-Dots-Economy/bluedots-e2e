/**
 * A deterministic stand-in for the TEI embedding server.
 *
 * Real TEI with bge-m3 baked in is a 3-5 GB pull whose fp32 warmup is the
 * slowest thing in a boot, which is untenable on a 2 vCPU / 8 GB runner with
 * 14 GB of disk. The stub preserves every contract the gate cares about --
 * the embedder wire shape, the vector dimension, the index upsert and
 * retrievability -- while removing the pull and the warmup entirely.
 *
 * What it does NOT preserve is ranking quality: these vectors correspond to
 * nothing deployed, so relevance is an offline evaluation rather than
 * something a journey can assert. J2 asserts set membership, never rank, so
 * it is unaffected.
 */

/** FNV-1a, so a given text always yields the same vector. */
function hash(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A deterministic unit vector for a piece of text.
 *
 * Unit-normalised because search ranks by cosine distance, and
 * deterministic because `content_hash` derives from the vector -- a stub
 * that varied would make every re-index look like a change.
 */
export function embeddingFor(text: string, dim: number): number[] {
  const raw = Array.from({ length: dim }, (_, i) => {
    // Map the hash into [-1, 1) rather than [0, 1): an all-positive vector
    // puts every fixture in the same orthant and collapses the distances
    // between them.
    return (hash(text, i) / 0xffffffff) * 2 - 1;
  });

  const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1;
  return raw.map((x) => x / norm);
}

/**
 * The server, as source, so it can be written into the run directory and
 * executed by an image already pulled for another purpose. Written with no
 * imports beyond node's builtins for exactly that reason -- anything else
 * would mean another image to build and pull, which is what this avoids.
 */
export const STUB_EMBEDDER_SOURCE = `
const http = require('node:http');

const DIM = Number(process.env.EMBEDDING_DIM || 1024);

function hash(text, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embeddingFor(text) {
  const raw = [];
  for (let i = 0; i < DIM; i++) raw.push((hash(text, i) / 0xffffffff) * 2 - 1);
  let norm = 0;
  for (const x of raw) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return raw.map((x) => x / norm);
}

http
  .createServer((req, res) => {
    if (!req.url.endsWith('/embeddings')) {
      res.writeHead(404).end('{"error":"not found"}');
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let input = [];
      try {
        const parsed = JSON.parse(body || '{}');
        input = Array.isArray(parsed.input) ? parsed.input : [parsed.input || ''];
      } catch {
        res.writeHead(400).end('{"error":"bad json"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: input.map((t) => ({ embedding: embeddingFor(String(t)) })) }));
    });
  })
  .listen(80, () => console.log('stub embedder on :80, dim=' + DIM));
`;
