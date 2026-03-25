import { readFileSync } from 'fs';
import { loadContext } from './lib/context-loader.js';
async function main() {
    try {
        const stdin = readFileSync(0, 'utf-8');
        JSON.parse(stdin); // consume stdin
    }
    catch { /* ignore */ }
    const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
    const context = loadContext(projectDir);
    if (!context) {
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
