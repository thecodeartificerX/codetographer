import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { generateMap } from './map-generator.js';
import { atomicWrite } from './atomic-write.js';

function parseArgs(): { root: string; output: string; budget: number } {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let output = '';
  let budget = 5000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = resolve(args[++i]);
    } else if (args[i] === '--output' && args[i + 1]) {
      output = resolve(args[++i]);
    } else if (args[i] === '--budget' && args[i + 1]) {
      budget = parseInt(args[++i], 10);
    } else if (!args[i].startsWith('--')) {
      root = resolve(args[i]);
    }
  }

  if (!output) {
    output = join(root, 'docs', 'codetographer', 'map.md');
  }

  return { root, output, budget };
}

async function main(): Promise<void> {
  const { root, output, budget } = parseArgs();

  const dataDir = process.env['CLAUDE_PLUGIN_DATA'] ?? join(root, '.codetographer-data');
  const changesPath = join(root, 'docs', 'codetographer', 'changes.md');

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const mapContent = await generateMap({
    projectRoot: root,
    dataDir,
    tokenBudget: budget,
    changesPath: existsSync(changesPath) ? changesPath : undefined,
  });

  const outputDir = join(output, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  atomicWrite(output, mapContent);
  process.stdout.write(`[codetographer] map.md written to ${output}\n`);
}

main().catch(err => {
  process.stderr.write(`[codetographer] Fatal: ${err}\n`);
  process.exit(1);
});
