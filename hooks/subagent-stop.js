import { readFileSync } from 'fs';
import { appendChange } from './lib/changes-writer.js';
async function main() {
    let inputData = {};
    try {
        const stdin = readFileSync(0, 'utf-8');
        inputData = JSON.parse(stdin);
    }
    catch { /* no stdin */ }
    const lastMessage = inputData['last_assistant_message'] ?? '';
    if (!lastMessage) {
        process.exit(0);
    }
    // Extract first sentence or first 150 chars
    let summary = lastMessage.trim();
    const sentenceEnd = summary.search(/[.!?]\s/);
    if (sentenceEnd > 0 && sentenceEnd < 150) {
        summary = summary.slice(0, sentenceEnd + 1);
    }
    else {
        summary = summary.slice(0, 150);
    }
    // Clean up markdown
    summary = summary.replace(/\n+/g, ' ').trim();
    const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
    appendChange(projectDir, `[subagent-result] ${summary}`);
    process.exit(0);
}
main().catch(() => process.exit(0));
