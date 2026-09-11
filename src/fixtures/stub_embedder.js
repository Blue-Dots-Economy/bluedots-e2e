// Plain JavaScript on purpose.
//
// This file IS what runs in the container: the provider copies it into the
// run directory and mounts it, and the tests import this same file. An
// earlier version kept a TypeScript implementation for the tests and a
// separate copy embedded in a string for the container, which meant the
// tested code was not the running code and the two could drift apart
// silently.
//
// Only node builtins, since it executes inside an image pulled for another
// purpose -- a dependency here would mean another image to build and pull,
// which is the cost the stub exists to avoid.

/** FNV-1a, so a given text always yields the same vector. */
function hash(text, salt) {
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
 * deterministic because content_hash derives from the vector -- a stub that
 * varied would make every re-index look like a change.
 *
 * Mapped into [-1, 1) rather than [0, 1): an all-positive vector puts every
 * fixture in the same orthant and collapses the distances between them.
 */
export function embeddingFor(text, dim) {
  const raw = [];
  for (let i = 0; i < dim; i++) raw.push((hash(text, i) / 0xffffffff) * 2 - 1);
  let norm = 0;
  for (const x of raw) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return raw.map((x) => x / norm);
}

export function createServer(http, dim) {
  return http.createServer((req, res) => {
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
      res.end(
        JSON.stringify({ data: input.map((t) => ({ embedding: embeddingFor(String(t), dim) })) }),
      );
    });
  });
}

// Entry point when run directly in the container.
if (process.argv[1] && process.argv[1].endsWith('stub_embedder.js')) {
  const http = await import('node:http');
  const dim = Number(process.env.EMBEDDING_DIM || 1024);
  createServer(http.default, dim).listen(80, () =>
    console.log(`stub embedder on :80, dim=${dim}`),
  );
}
