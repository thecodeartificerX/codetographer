import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { loadContext } from './lib/context-loader.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
async function main() {
    let inputData = {};
    try {
        const stdin = readFileSync(0, 'utf-8');
        inputData = JSON.parse(stdin);
    }
    catch { /* no stdin or invalid JSON */ }
    const projectDir = (process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd());
    const context = loadContext(projectDir);
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
    if (!context) {
        // Not initialized — exit silently
        process.exit(0);
    }
    const output = {
        hookSpecificOutput: {
            additionalContext: context,
        },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
}
main().catch(() => process.exit(0));
