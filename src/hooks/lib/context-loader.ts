import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load context from codetographer docs.
 * Returns combined INDEX.md (truncated to 200 lines) + last 10 lines of changes.md.
 * Returns null if codetographer not initialized (no INDEX.md).
 */
export function loadContext(projectDir: string): string | null {
  const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
  if (!existsSync(indexPath)) return null;

  const parts: string[] = [];

  // Read INDEX.md, truncate to 200 lines
  const indexContent = readFileSync(indexPath, 'utf-8');
  const indexLines = indexContent.split('\n');
  const truncated = indexLines.slice(0, 200);
  if (indexLines.length > 200) {
    truncated.push('... (truncated)');
  }
  parts.push(truncated.join('\n'));

  // Append last 10 lines of changes.md
  const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
  if (existsSync(changesPath)) {
    const changesContent = readFileSync(changesPath, 'utf-8');
    const changesLines = changesContent.split('\n').filter(l => l.trim());
    const last10 = changesLines.slice(-10);
    if (last10.length > 0) {
      parts.push('\n## Recent Changes\n' + last10.join('\n'));
    }
  }

  return parts.join('\n');
}
