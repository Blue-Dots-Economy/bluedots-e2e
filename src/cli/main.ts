#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stderr, stdin, stdout } from 'node:process';
import { parseArgs } from './args.js';
import { renderTargetList, resolveSelection } from './target_selection.js';
import { listTargets, resolveTarget } from '../targets/targets.js';
import { schemasRoot } from '../config/paths.js';
import { imageRef, resolveDigests, resolveTags } from '../images/images.js';
import { dockerInspector } from '../images/docker_inspector.js';
import { SERVICES } from './args.js';
import { ComposeProvider } from '../env/compose/compose_provider.js';
import { assertBindSources } from '../env/compose/overlay.js';
import { dockerRun } from '../env/compose/docker_runner.js';
import { signalsDpgRoot } from '../config/paths.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function promptForTarget(targets: readonly { id: string }[]): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('Available targets:\n' + renderTargetList(targets as never));
    const answer = await rl.question('Target (dot or dot/instance): ');
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const root = schemasRoot();
  const targets = await listTargets(root);

  if (args.list) {
    stdout.write(renderTargetList(targets));
    return 0;
  }

  const isCI = process.env.CI === 'true' || process.env.CI === '1';
  let selection = resolveSelection(args, targets, { isCI });

  if (selection.kind === 'prompt') {
    const [dot, instance] = (await promptForTarget(targets)).split('/');
    // Re-resolve with isCI: true so an unusable answer errors rather than
    // looping back into another prompt.
    selection = resolveSelection(
      { dot: dot ?? null, instance: instance ?? null },
      targets,
      { isCI: true },
    );
  }

  if (selection.kind !== 'selected') {
    throw new Error('No target selected.');
  }

  const target = await resolveTarget(root, selection.dot, selection.instance);

  stdout.write(
    [
      `target          ${target.id}`,
      `network config  ${target.networkConfigPath}`,
      `consent         ${target.consentPath ?? '(none)'}`,
      `brand           ${target.brandPath ?? '(none)'}`,
      `SERVED_DOMAINS  ${target.servedDomains}`,
      '',
    ].join('\n'),
  );

  // Phase 1 — resolve. Every service image is pinned to a digest before
  // anything boots, because branch tags are mutable and a run must be able to
  // say exactly what it verified.
  const tags = resolveTags({ branch: args.branch, imagesFromTag: args.imagesFromTag });
  const refs: Record<string, string> = {};
  for (const service of SERVICES) {
    refs[service] = imageRef(service, 'api', tags[service]);
  }
  const digests = await resolveDigests(refs, dockerInspector);

  stdout.write('\nresolved images\n');
  for (const service of SERVICES) {
    stdout.write(`  ${service.padEnd(22)} ${tags[service].padEnd(16)} ${digests[service]}\n`);
  }

  // Phase 2 — up. Owned by the environment provider, so phases 3-5 never
  // learn whether a stack was booted here or already existed elsewhere.
  const provider = new ComposeProvider(target, {
    run: dockerRun,
    writeFile: async (path, contents) => writeFile(path, contents),
    assertBindSources,
    digests,
    baseFile: join(signalsDpgRoot(), 'local-setup', 'docker-compose.yml'),
    runDir: await mkdtemp(join(tmpdir(), 'journey-')),
  });

  stdout.write('\nbringing the stack up…\n');
  const ctx = await provider.up();

  stdout.write(
    [
      '',
      'stack ready',
      `  signals api     ${ctx.endpoints.signalsApi}`,
      `  search api      ${ctx.endpoints.searchApi}`,
      `  keycloak        ${ctx.endpoints.keycloak}`,
      `  capabilities    ${ctx.capabilities.join(', ')}`,
      '',
    ].join('\n'),
  );

  // Phases 3-5 arrive with #6 onward.
  if (!args.keepStack) {
    stdout.write('tearing the stack down (pass --keep-stack to leave it up)\n');
    await provider.down();
  } else {
    stdout.write('stack left running (--keep-stack)\n');
  }
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
