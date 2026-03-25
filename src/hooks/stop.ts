import { readFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateMap } from '../map-generator.js';
import { atomicWrite } from '../atomic-write.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getProjectRoot(): string {
  return process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
}

function getDataDir(): string {
  return process.env['CLAUDE_PLUGIN_DATA'] ?? join(getProjectRoot(), '.codetographer-data');
}

function getMtime(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function hasChangesNewerThanMap(changesPath: string, mapPath: string): boolean {
  const changesMtime = getMtime(changesPath);
  const mapMtime = getMtime(mapPath);
  // If changes.md doesn't exist or map.md doesn't exist, run anyway
  if (!existsSync(changesPath)) return false;
  if (!existsSync(mapPath)) return true;
  return changesMtime > mapMtime;
}

function updateRecentActivity(indexPath: string, changes: string[]): void {
  if (!existsSync(indexPath) || changes.length === 0) return;

  try {
    let content = readFileSync(indexPath, 'utf-8');
    const section = '## Recent Activity';
    const sectionIdx = content.indexOf(section);

    const newSection = section + '\n\n' +
      changes.slice(-5).map(c => `- ${c}`).join('\n') + '\n';

    if (sectionIdx >= 0) {
      // Find end of section (next ## or end of file)
      const nextSection = content.indexOf('\n## ', sectionIdx + 1);
      if (nextSection >= 0) {
        content = content.slice(0, sectionIdx) + newSection + '\n' + content.slice(nextSection);
      } else {
        content = content.slice(0, sectionIdx) + newSection;
      }
    } else {
      content = content + '\n' + newSection;
    }

    atomicWrite(indexPath, content);
  } catch { /* ignore */ }
}

async function main(): Promise<void> {
  try {
    const stdin = readFileSync(0, 'utf-8');
    JSON.parse(stdin);
  } catch { /* ignore */ }

  const projectDir = getProjectRoot();
  const dataDir = getDataDir();
  const docsDir = join(projectDir, 'docs', 'codetographer');
  const changesPath = join(docsDir, 'changes.md');
  const mapPath = join(docsDir, 'map.md');
  const indexPath = join(docsDir, 'INDEX.md');

  // Only run if codetographer is initialized
  if (!existsSync(indexPath)) {
    process.exit(0);
  }

  // Skip if no changes newer than map
  if (!hasChangesNewerThanMap(changesPath, mapPath)) {
    process.exit(0);
  }

  // Ensure data dir exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  try {
    const mapContent = await generateMap({
      projectRoot: projectDir,
      dataDir,
      tokenBudget: 5000,
      changesPath,
    });

    atomicWrite(mapPath, mapContent);

    // Update INDEX.md Recent Activity section
    if (existsSync(changesPath)) {
      const changesContent = readFileSync(changesPath, 'utf-8');
      const recentLines = changesContent
        .split('\n')
        .filter(l => l.startsWith('- ') && !l.startsWith('<!-- '))
        .slice(-5);
      updateRecentActivity(indexPath, recentLines);
    }
  } catch (err) {
    process.stderr.write(`[codetographer] stop hook error: ${err}\n`);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
