import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { appendChange } from './lib/changes-writer.js';
import { matchDomains } from './lib/domain-matcher.js';

async function main(): Promise<void> {
  let inputData: Record<string, unknown> = {};
  try {
    const stdin = readFileSync(0, 'utf-8');
    inputData = JSON.parse(stdin);
  } catch { /* no stdin */ }

  const toolInput = inputData['tool_input'] as Record<string, unknown> | undefined;
  const filePath = (toolInput?.['file_path'] as string | undefined) ?? '';

  if (!filePath) {
    process.exit(0);
  }

  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

  // Normalize to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Try to determine domain
  const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
  let domain: string | undefined;
  if (existsSync(indexPath)) {
    const domains = matchDomains(normalizedPath, indexPath);
    domain = domains[0];
  }

  appendChange(projectDir, normalizedPath, domain);
  process.exit(0);
}

main().catch(() => process.exit(0));
