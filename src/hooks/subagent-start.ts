import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { matchDomains, getDomainDocPath } from './lib/domain-matcher.js';
import { loadContext } from './lib/context-loader.js';

const SKIP_AGENT_TYPES = new Set(['grader', 'comparator', 'validator', 'judge']);

function readLastLines(filePath: string, lineCount: number): string[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-lineCount);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  let inputData: Record<string, unknown> = {};
  try {
    const stdin = readFileSync(0, 'utf-8');
    inputData = JSON.parse(stdin);
  } catch { /* no stdin */ }

  const agentType = (inputData['agent_type'] as string | undefined) ?? '';
  if (SKIP_AGENT_TYPES.has(agentType.toLowerCase())) {
    process.exit(0);
  }

  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const transcriptPath = inputData['transcript_path'] as string | undefined;

  let taskPrompt = '';

  // Try to extract prompt from transcript JSONL
  if (transcriptPath && existsSync(transcriptPath)) {
    try {
      const lastLines = readLastLines(transcriptPath, 50);
      for (let i = lastLines.length - 1; i >= 0; i--) {
        const line = lastLines[i];
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          // Look for Agent tool call
          if (entry['type'] === 'tool_use' && (entry['name'] === 'Agent' || entry['name'] === 'Bash')) {
            const input = entry['input'] as Record<string, unknown> | undefined;
            if (input?.['prompt']) {
              taskPrompt = String(input['prompt']);
              break;
            }
          }
          // Look for assistant message with tool_use blocks
          if (entry['role'] === 'assistant' && Array.isArray(entry['content'])) {
            for (const block of entry['content'] as unknown[]) {
              const b = block as Record<string, unknown>;
              if (b['type'] === 'tool_use' && b['name'] === 'Agent') {
                const input = b['input'] as Record<string, unknown> | undefined;
                if (input?.['prompt']) {
                  taskPrompt = String(input['prompt']);
                  break;
                }
              }
            }
            if (taskPrompt) break;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* fallback */ }
  }

  const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');

  let contextContent: string | null = null;

  if (taskPrompt) {
    const domains = matchDomains(taskPrompt, indexPath);
    if (domains.length > 0) {
      const parts: string[] = [];
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
