import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRecorder } from '../../src/report/http_recorder.js';
import { stepKey } from '../../src/report/journey_views.js';
import { REQUIRED_RELATIONS } from '../../src/env/schema_gate.js';
import { runJourney, type StepOutcome } from '../../src/journey/define_journey.js';
import { selectJourneys } from '../../src/journey/select.js';
import { ALL_JOURNEYS } from '../../journeys/index.js';
import { bootStack, teardownStack, type BootedStack } from './boot_stack.js';

/**
 * One stack, every journey.
 *
 * Boot and seed cost ~145s; a journey's own assertions cost seconds. A file
 * per journey would therefore make each new scenario cost a boot, which is
 * precisely the marginal cost the design says must stay near zero. So this
 * file brings the stack up once and iterates the journey registry against
 * it: adding a journey is a line in journeys/index.ts.
 *
 * The negative controls keep their own file because they need a
 * deliberately misconfigured stack.
 */
describe('journeys against a real stack', () => {
  let stack: BootedStack;
  // One recorder for the file: every journey's calls land in it, each
  // attributed to the step that made it, and the whole lot is written out
  // for the report once the stack comes down.
  const recorder = createRecorder();
  // The step trace exists only in this process. Without writing it out, the
  // report can only show the JUnit case name -- one line per journey -- and
  // never the steps inside it.
  const runs: {
    id: string;
    title: string;
    capability: string;
    status: 'passed' | 'failed' | 'not-covered';
    trace: StepOutcome[];
  }[] = [];

  beforeAll(async () => {
    stack = await bootStack({ http: recorder.fetch });
  }, 600_000);

  afterAll(async () => {
    // reports/ is what render_report.ts reads; the recording is useless if
    // it only ever exists inside this process.
    await mkdir('reports', { recursive: true });
    await writeFile('reports/http.json', JSON.stringify(recorder.entries, null, 2));
    await writeFile('reports/journeys.json', JSON.stringify(runs, null, 2));
    // provenance.txt is written before the stack boots, so it can name the
    // image tags but not the digests they resolved to, and nothing there
    // knows what the harness changed while running.
    await writeFile(
      'reports/run_facts.json',
      JSON.stringify(
        { digests: stack?.digests ?? {}, realmMutations: stack?.env?.realmMutations ?? [] },
        null,
        2,
      ),
    );
    await teardownStack(stack);
  });

  describe('The stack the journeys run against', () => {
    test('signals-dpg answers over HTTP', async () => {
      expect((await fetch(`${stack.env.endpoints.signalsApi}/health/live`)).status).toBe(200);
    });

    test('every relation the schema gate requires is present', async () => {
      for (const relation of REQUIRED_RELATIONS) {
        const out = await stack.provider.exec('postgres', [
          'psql', '-U', 'postgres', '-d', 'postgresdb',
          '-tAc', `select to_regclass('public.${relation}')`,
        ]);
        // to_regclass quotes reserved words, so `user` comes back as `"user"`.
        expect(out.trim().replace(/^"|"$/g, ''), `${relation} must exist`).toBe(relation);
      }
    });

    test('the ingest consumer group exists, which the awaiter reads', async () => {
      const out = await stack.provider.exec('redis', [
        'redis-cli',
        // The password the stack actually starts redis with, not a copy of
        // it: the two drifting apart fails here as an auth error that reads
        // like a missing consumer group.
        '-a', stack.stackEnv.REDIS_PASSWORD!,
        '--no-auth-warning',
        'XINFO', 'GROUPS', 'signals:item-events',
      ]);

      expect(out).toContain('signals-search');
    });

    test('publishes no fixed host port, so it coexists with other stacks', () => {
      // Every endpoint, not just signalsApi: the loop used to check all
      // five ports against that one URL, which can only ever carry 2742 --
      // so four of the five iterations could not fail, and searchApi,
      // keycloak, postgres and redis were never checked at all.
      const fixed = [5432, 5555, 6379, 8080, 8025, 2742, 3100];
      for (const [name, url] of Object.entries(stack.env.endpoints)) {
        for (const port of fixed) {
          expect(url, `${name} must not publish the base compose's ${port}`).not.toContain(
            `:${port}`,
          );
        }
      }
    });

    test('the captured api key is accepted by search', async () => {
      const res = await fetch(`${stack.env.endpoints.searchApi}/v1/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': stack.seeded.apiKey },
        body: JSON.stringify({}),
      });

      expect(res.status).not.toBe(401);
    });
  });

  describe('Coverage of the journey registry', () => {
    test('every journey is accounted for as run or skipped', () => {
      const { run, skipped } = selectJourneys(
        ALL_JOURNEYS,
        stack.targetId,
        stack.env.capabilities,
      );

      // A journey that is neither would be missing coverage that the report
      // still counts as a clean run.
      expect(run.length + skipped.length).toBe(ALL_JOURNEYS.length);
      for (const s of skipped) console.log(`NOT COVERED: ${s.id} — ${s.reason}`);
    });
  });

  describe('journeys', () => {
    // One test per journey, all sharing the single stack above. Adding a
    // journey to journeys/index.ts adds a case here automatically.
    for (const journey of ALL_JOURNEYS) {
      test(`${journey.id} — ${journey.title}`, async (ctx) => {
        const { run, skipped } = selectJourneys([journey], stack.targetId, stack.env.capabilities);
        if (run.length === 0) {
          // Recorded, not merely skipped: a journey missing from
          // journeys.json reads to the report as a failure, which is the
          // inverse of what NOT COVERED means.
          runs.push({
            id: journey.id,
            title: journey.title,
            capability: journey.capability,
            status: 'not-covered',
            trace: [],
          });
          console.log(`NOT COVERED: ${journey.id} — ${skipped[0]?.reason ?? 'not selected'}`);
          ctx.skip();
          return;
        }

        const result = await runJourney(
          journey,
          // Seeded per run and printed, so a red run can be replayed exactly.
          { ...stack.baseCtx, state: { seed: stack.seed } },
          // The journey id travels with the label: the report shows one
          // list of requests across every journey in the run.
          { onStep: (label) => recorder.startStep(stepKey(journey.id, label)) },
        );

        runs.push({
          id: journey.id,
          title: journey.title,
          capability: journey.capability,
          status: result.ok ? 'passed' : 'failed',
          trace: result.trace,
        });

        expect(result.ok, JSON.stringify(result.trace, null, 2)).toBe(true);
      });
    }
  });
});
