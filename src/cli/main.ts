#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseArgs } from './args.js';
import { renderTargetList, resolveSelection } from './target_selection.js';
import { listTargets, resolveTarget } from '../targets/targets.js';
import { schemasRoot } from '../config/paths.js';

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

  // Phases 2-5 arrive with #4 onward. Until then, print what a run resolved
  // so the target/schema wiring is verifiable on its own.
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
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    stdout.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
