// Types for the plain-JS stub. The implementation is deliberately .js so the
// container runs the same file the tests import; this only describes it.
import type { Server } from 'node:http';

export function embeddingFor(text: string, dim: number): number[];
export function createServer(http: typeof import('node:http'), dim: number): Server;
