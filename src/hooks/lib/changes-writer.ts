import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { atomicWrite } from '../../atomic-write.js';

const MAX_LINES = 200;

/**
 * Append a change entry to changes.md with LF line endings.
 * Updates domain-touched metadata comment at top.
 * Trims to MAX_LINES if exceeded.
 */
export function appendChange(
  projectDir: string,
  filePath: string,
  domain?: string,
  timestamp?: string
): void {
  const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
  const changesDir = dirname(changesPath);

  if (!existsSync(changesDir)) {
    mkdirSync(changesDir, { recursive: true });
  }

  const ts = timestamp ?? new Date().toISOString();
  const domainTag = domain ? ` [${domain}]` : '';
  const entry = `- ${ts}${domainTag} ${filePath}`;

  let existing: string[] = [];
  if (existsSync(changesPath)) {
    const content = readFileSync(changesPath, 'utf-8');
    existing = content.split('\n');
  }

  // Find or create metadata comment at top
  let metadataIdx = -1;
  const metadataPrefix = '<!-- domain-touched:';
  for (let i = 0; i < Math.min(5, existing.length); i++) {
    if (existing[i].startsWith(metadataPrefix)) {
      metadataIdx = i;
      break;
    }
  }

  // Extract existing domains touched
  const domainsTouched = new Set<string>();
  if (metadataIdx >= 0) {
    const m = existing[metadataIdx].match(/<!-- domain-touched: (.*?) -->/);
    if (m) {
      m[1].split(',').map(d => d.trim()).filter(Boolean).forEach(d => domainsTouched.add(d));
    }
    existing.splice(metadataIdx, 1);
  }

  if (domain) domainsTouched.add(domain);

  const metadata = `<!-- domain-touched: ${Array.from(domainsTouched).join(', ')} -->`;

  // Build new content
  const contentLines = existing.filter(l => l.trim() !== '');
  contentLines.push(entry);

  // Trim to MAX_LINES
  if (contentLines.length > MAX_LINES) {
    contentLines.splice(0, contentLines.length - MAX_LINES);
  }

  const newContent = [metadata, '', ...contentLines].join('\n') + '\n';
  atomicWrite(changesPath, newContent);
}

export function appendCommitSummary(
  projectDir: string,
  hash: string,
  subject: string,
  domains: string[]
): void {
  appendChange(projectDir, `[commit:${hash}] ${subject}`, domains[0]);
}
