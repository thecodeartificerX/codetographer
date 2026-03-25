import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface DomainMapping {
  domain: string;
  paths: string[];
  keywords: string[];
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Parse INDEX.md routing rules table.
 * Looks for a markdown table with columns: Domain | Paths/Patterns | When to use
 */
function parseRoutingRules(indexContent: string): DomainMapping[] {
  const mappings: DomainMapping[] = [];
  const lines = indexContent.split('\n');

  let inTable = false;
  let headerParsed = false;
  let domainCol = -1;
  let pathsCol = -1;
  let keywordsCol = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Look for table rows (start with |)
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);

      if (!headerParsed) {
        // Parse header row
        domainCol = cells.findIndex(c => /domain/i.test(c));
        pathsCol = cells.findIndex(c => /path|pattern/i.test(c));
        keywordsCol = cells.findIndex(c => /keyword|when|trigger/i.test(c));
        if (domainCol >= 0) {
          headerParsed = true;
          inTable = true;
        }
        continue;
      }

      // Skip separator row
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (inTable && domainCol >= 0) {
        const domain = cells[domainCol] ?? '';
        if (!domain || domain === '---') continue;

        const pathsRaw = pathsCol >= 0 ? (cells[pathsCol] ?? '') : '';
        const keywordsRaw = keywordsCol >= 0 ? (cells[keywordsCol] ?? '') : '';

        const paths = pathsRaw
          .split(/[,\s]+/)
          .map(p => toForwardSlash(p.trim()))
          .filter(p => p && p !== '-');

        const keywords = keywordsRaw
          .split(/[,\s]+/)
          .map(k => k.trim().toLowerCase())
          .filter(k => k && k !== '-');

        mappings.push({ domain, paths, keywords });
      }
    } else if (inTable && trimmed === '') {
      // blank line ends table
      inTable = false;
      headerParsed = false;
    }
  }

  return mappings;
}

/**
 * Extract file paths from text using regex.
 */
function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  // Match paths like src/foo/bar.ts, ./foo, /absolute/path
  const regex = /(?:^|\s|['"`])((?:\.\.?\/|\/)?[\w\-./]+\/[\w\-./]+\.\w+)/gm;
  let m;
  while ((m = regex.exec(text)) !== null) {
    paths.push(toForwardSlash(m[1].trim()));
  }
  return paths;
}

/**
 * Given a text (task prompt), find the best-matching domain name(s).
 */
export function matchDomains(text: string, indexPath: string): string[] {
  if (!existsSync(indexPath)) return [];

  let indexContent: string;
  try {
    indexContent = readFileSync(indexPath, 'utf-8');
  } catch {
    return [];
  }

  const mappings = parseRoutingRules(indexContent);
  if (mappings.length === 0) return [];

  const normalizedText = toForwardSlash(text.toLowerCase());
  const extractedPaths = extractFilePaths(text);

  const scores = new Map<string, number>();

  for (const mapping of mappings) {
    let score = 0;

    // Check file paths
    for (const filePath of extractedPaths) {
      for (const pattern of mapping.paths) {
        if (filePath.includes(pattern) || pattern.includes(filePath.split('/')[0] ?? '')) {
          score += 3;
        }
      }
    }

    // Check path patterns in text
    for (const pattern of mapping.paths) {
      if (normalizedText.includes(pattern.toLowerCase())) {
        score += 2;
      }
    }

    // Check keywords
    for (const keyword of mapping.keywords) {
      if (normalizedText.includes(keyword)) {
        score += 1;
      }
    }

    if (score > 0) scores.set(mapping.domain, score);
  }

  if (scores.size === 0) return [];

  // Return domains sorted by score, top 2
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([domain]) => domain);
}

export function getDomainDocPath(projectDir: string, domain: string): string {
  return join(projectDir, 'docs', 'codetographer', 'domains', `${domain}.md`);
}
