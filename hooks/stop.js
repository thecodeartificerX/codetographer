import { readFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateMap } from './dist/map-generator.js';
import { atomicWrite } from './dist/atomic-write.js';
import { updateRecentActivity } from './lib/recent-activity.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
function getProjectRoot() {
    return process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
}
function getDataDir() {
    return process.env['CLAUDE_PLUGIN_DATA'] ?? join(getProjectRoot(), '.codetographer-data');
}
function getMtime(filePath) {
    if (!existsSync(filePath))
        return 0;
    try {
        return statSync(filePath).mtimeMs;
    }
    catch {
        return 0;
    }
}
function hasChangesNewerThanMap(changesPath, mapPath) {
    const changesMtime = getMtime(changesPath);
    const mapMtime = getMtime(mapPath);
    // If changes.md doesn't exist or map.md doesn't exist, run anyway
    if (!existsSync(changesPath))
        return false;
    if (!existsSync(mapPath))
        return true;
    // Skip if map was regenerated within the last 60 seconds (e.g. by /sanity)
    if (Date.now() - mapMtime < 60_000)
        return false;
    return changesMtime > mapMtime;
}
async function main() {
    const projectDir = getProjectRoot();
    const dataDir = getDataDir();
    const docsDir = join(projectDir, 'docs', 'codetographer');
    const changesPath = join(docsDir, 'changes.md');
    const mapPath = join(docsDir, 'map.md');
    const indexPath = join(docsDir, 'INDEX.md');
    if (!existsSync(indexPath)) {
        process.exit(0);
    }
    if (!hasChangesNewerThanMap(changesPath, mapPath)) {
        process.exit(0);
    }
    mkdirSync(dataDir, { recursive: true });
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
    }
    catch (err) {
        process.stderr.write(`[codetographer] stop hook error: ${err}\n`);
    }
    process.exit(0);
}
main().catch(() => process.exit(0));
