import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { loadContext } from './lib/context-loader.js';
import { runSanityCheck } from './dist/sanity.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
async function main() {
    let inputData = {};
    try {
        const stdin = readFileSync(0, 'utf-8');
        inputData = JSON.parse(stdin);
    }
    catch { /* no stdin or invalid JSON */ }
    const projectDir = (process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd());
    // Check if plugin deps need updating
    const pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'] ?? dirname(dirname(__dirname));
    const pluginData = process.env['CLAUDE_PLUGIN_DATA'];
    if (pluginData) {
        const srcPkg = join(pluginRoot, 'package.json');
        const dataPkg = join(pluginData, 'package.json');
        let needsInstall = false;
        if (existsSync(srcPkg)) {
            if (!existsSync(dataPkg)) {
                needsInstall = true;
            }
            else {
                try {
                    const src = readFileSync(srcPkg, 'utf-8');
                    const dst = readFileSync(dataPkg, 'utf-8');
                    needsInstall = src !== dst;
                }
                catch { /* ignore */ }
            }
        }
        if (needsInstall) {
            const installScript = join(pluginRoot, 'scripts', 'install-deps.js');
            if (existsSync(installScript)) {
                const child = spawn(process.execPath, [installScript], {
                    detached: true,
                    stdio: 'ignore',
                    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: pluginData },
                });
                child.unref();
            }
        }
    }
    // Sanity check — auto-fix silently, skip expensive ops (map regen) to stay within 5s timeout
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
        }
        else if (sanityReport.status === 'fixed') {
            const fixCount = sanityReport.checks.filter(c => c.status === 'fixed').length;
            sanityNote = `⚠ Codetographer sanity: fixed ${fixCount} issue(s). Run /sanity for details.\n\n`;
        }
    }
    catch { /* sanity check failure must not break session start */ }
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
