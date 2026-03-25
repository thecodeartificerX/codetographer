import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { matchDomains, getDomainDocPath } from './lib/domain-matcher.js';
import { loadContext } from './lib/context-loader.js';
const SKIP_AGENT_TYPES = new Set(['grader', 'comparator', 'validator', 'judge']);
function readLastLines(filePath, lineCount) {
    if (!existsSync(filePath))
        return [];
    try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        return lines.slice(-lineCount);
    }
    catch {
        return [];
    }
}
async function main() {
    let inputData = {};
    try {
        const stdin = readFileSync(0, 'utf-8');
        inputData = JSON.parse(stdin);
    }
    catch { /* no stdin */ }
    const agentType = inputData['agent_type'] ?? '';
    if (SKIP_AGENT_TYPES.has(agentType.toLowerCase())) {
        process.exit(0);
    }
    const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
    const transcriptPath = inputData['transcript_path'];
    let taskPrompt = '';
    // Try to extract prompt from transcript JSONL
    if (transcriptPath && existsSync(transcriptPath)) {
        try {
            const lastLines = readLastLines(transcriptPath, 50);
            for (let i = lastLines.length - 1; i >= 0; i--) {
                const line = lastLines[i];
                if (!line.trim())
                    continue;
                try {
                    const entry = JSON.parse(line);
                    // Look for Agent tool call
                    if (entry['type'] === 'tool_use' && (entry['name'] === 'Agent' || entry['name'] === 'Bash')) {
                        const input = entry['input'];
                        if (input?.['prompt']) {
                            taskPrompt = String(input['prompt']);
                            break;
                        }
                    }
                    // Look for assistant message with tool_use blocks
                    if (entry['role'] === 'assistant' && Array.isArray(entry['content'])) {
                        for (const block of entry['content']) {
                            const b = block;
                            if (b['type'] === 'tool_use' && b['name'] === 'Agent') {
                                const input = b['input'];
                                if (input?.['prompt']) {
                                    taskPrompt = String(input['prompt']);
                                    break;
                                }
                            }
                        }
                        if (taskPrompt)
                            break;
                    }
                }
                catch { /* skip malformed lines */ }
            }
        }
        catch { /* fallback */ }
    }
    const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
    let contextContent = null;
    if (taskPrompt) {
        const domains = matchDomains(taskPrompt, indexPath);
        if (domains.length > 0) {
            const parts = [];
            for (const domain of domains) {
                const docPath = getDomainDocPath(projectDir, domain);
                if (existsSync(docPath)) {
                    parts.push(readFileSync(docPath, 'utf-8'));
                }
            }
            if (parts.length > 0) {
                contextContent = parts.join('\n\n---\n\n');
            }
        }
    }
    // Fallback to INDEX.md
    if (!contextContent) {
        contextContent = loadContext(projectDir);
    }
    if (!contextContent) {
        process.exit(0);
    }
    const output = {
        hookSpecificOutput: {
            additionalContext: contextContent,
        },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
}
main().catch(() => process.exit(0));
