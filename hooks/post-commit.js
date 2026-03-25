import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { appendCommitSummary } from './lib/changes-writer.js';
import { matchDomains } from './lib/domain-matcher.js';
async function main() {
    let inputData = {};
    try {
        const stdin = readFileSync(0, 'utf-8');
        inputData = JSON.parse(stdin);
    }
    catch { /* no stdin */ }
    const toolInput = inputData['tool_input'];
    const command = toolInput?.['command'] ?? '';
    // Fast exit for non-commit commands — this fires on every Bash call
    if (!command.includes('git commit')) {
        process.exit(0);
    }
    const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
    const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
    if (!existsSync(indexPath)) {
        process.exit(0);
    }
    // Get commit hash and subject
    const logResult = spawnSync('git', ['log', '-1', '--format=%H %s'], {
        cwd: projectDir,
        encoding: 'utf-8',
    });
    if (logResult.status !== 0 || !logResult.stdout.trim()) {
        process.exit(0);
    }
    const logLine = logResult.stdout.trim();
    const hash = logLine.slice(0, 8);
    const subject = logLine.slice(41).trim(); // skip full 40-char hash + space
    // Get changed files — diff-tree works for first commits too
    const diffResult = spawnSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
        cwd: projectDir,
        encoding: 'utf-8',
    });
    const changedFiles = (diffResult.stdout ?? '')
        .split('\n')
        .map(f => f.trim().replace(/\\/g, '/'))
        .filter(Boolean);
    // Cross-reference with domains
    const domainSet = new Set();
    for (const file of changedFiles) {
        const domains = matchDomains(file, indexPath);
        if (domains[0])
            domainSet.add(domains[0]);
    }
    appendCommitSummary(projectDir, hash, subject, Array.from(domainSet));
    process.exit(0);
}
main().catch(() => process.exit(0));
