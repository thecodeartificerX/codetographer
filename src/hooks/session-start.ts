import { readFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadContext } from './lib/context-loader.js';
import { runSanityCheck } from '../sanity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  let inputData: Record<string, unknown> = {};
  try {
    const stdin = readFileSync(0, 'utf-8');
    inputData = JSON.parse(stdin);
  } catch { /* no stdin or invalid JSON */ }

  const projectDir = (process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd());

  const pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'] ?? dirname(dirname(__dirname));
  const pluginData = process.env['CLAUDE_PLUGIN_DATA'];

  // Sanity check — auto-fix silently, skip expensive ops (map regen) to stay within 5s timeout
  // Also handles dep install via check 15/16 (checkNodeModules)
  let sanityNote = '';
  try {
    const sanityReport = await runSanityCheck({
      projectDir,
      pluginRoot,
      pluginData: pluginData ?? '',
      fix: true,
      quiet: true,
      skipExpensive: true,
    });

    if (sanityReport.status === 'needs_attention') {
      const issues = sanityReport.checks
        .filter(c => c.status === 'fail')
        .map(c => `  - ${c.message}`);
      sanityNote = `⚠ Codetographer sanity issues:\n${issues.join('\n')}\nRun /sanity for details.\n\n`;
    } else if (sanityReport.status === 'fixed') {
      const fixCount = sanityReport.checks.filter(c => c.status === 'fixed').length;
      sanityNote = `⚠ Codetographer sanity: fixed ${fixCount} issue(s). Run /sanity for details.\n\n`;
    }
  } catch { /* sanity check failure must not break session start */ }

  const context = loadContext(projectDir);

  if (!context && !sanityNote) {
    // Not initialized and no sanity warnings — exit silently
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      additionalContext: sanityNote + (context ?? ''),
    },
  };

  process.stdout.write(JSON.stringify(output) + '\n');
}

main().catch(() => process.exit(0));
