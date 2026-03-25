import { statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { discoverFiles } from './file-discovery.js';
import { extractTags } from './tag-extractor.js';
import { createTagCache } from './tag-cache.js';
import { pagerank } from './pagerank.js';
import type { Tag, FileEntry } from './types.js';

interface MapGeneratorOptions {
  projectRoot: string;
  dataDir: string;
  tokenBudget?: number;
  changesPath?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parse changes.md to extract recently-touched files.
 * Returns a Map<file, touchCount> for personalization.
 */
function parseRecentFiles(changesPath: string): Map<string, number> {
  const result = new Map<string, number>();
  if (!existsSync(changesPath)) return result;

  try {
    const content = readFileSync(changesPath, 'utf-8');
    const lines = content.split('\n').slice(-50); // last 50 lines
    // Look for file paths in lines like "- edited src/foo.ts"
    const pathRegex = /(?:^|\s)((?:[\w\-./]+\/)?[\w\-./]+\.\w+)/g;
    for (const line of lines) {
      let m;
      while ((m = pathRegex.exec(line)) !== null) {
        const p = m[1].replace(/\\/g, '/');
        result.set(p, (result.get(p) ?? 0) + 1);
      }
    }
  } catch { /* ignore */ }

  return result;
}

/**
 * Render file entries in Aider-style format with │ scope markers and ⋮... omissions.
 */
function renderAiderStyle(entries: Array<{ file: string; tags: Tag[] }>): string {
  const lines: string[] = [];

  for (const { file, tags } of entries) {
    lines.push(file);

    const defs = tags.filter(t => t.kind === 'def');
    if (defs.length === 0) {
      lines.push('⋮...');
      continue;
    }

    let lastScope = '';
    for (const tag of defs) {
      const scope = tag.scope ?? '';
      if (scope && scope !== lastScope) {
        lines.push(`│${scope}:`);
        lastScope = scope;
      } else if (!scope && lastScope) {
        lastScope = '';
      }

      const indent = scope ? '│  ' : '';
      const sig = tag.signature?.trim() ?? tag.name;
      lines.push(`${indent}${sig}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export async function generateMap(opts: MapGeneratorOptions): Promise<string> {
  const { projectRoot, dataDir, tokenBudget = 5000, changesPath } = opts;

  const cache = await createTagCache(dataDir);

  // Discover all source files
  const files = discoverFiles(projectRoot);

  // Extract tags (with cache)
  const fileEntries: FileEntry[] = [];
  for (const file of files) {
    let mtime = 0;
    try {
      mtime = statSync(file.absolutePath).mtimeMs;
    } catch { continue; }

    let tags = cache.get(file.relativePath, mtime);
    if (tags === null) {
      tags = await extractTags(file.absolutePath, file.relativePath, file.language);
      cache.set(file.relativePath, mtime, tags);
    }

    fileEntries.push({
      relativePath: file.relativePath,
      language: file.language,
      mtime,
      tags,
    });
  }

  // Build reference graph for PageRank
  // Edge: file B references a symbol defined in file A → edge B→A
  const defMap = new Map<string, string>(); // symbol name → file
  for (const entry of fileEntries) {
    for (const tag of entry.tags) {
      if (tag.kind === 'def') {
        defMap.set(tag.name, entry.relativePath);
      }
    }
  }

  const graph = new Map<string, Map<string, number>>();

  // Initialize all nodes in graph
  for (const entry of fileEntries) {
    if (!graph.has(entry.relativePath)) {
      graph.set(entry.relativePath, new Map());
    }
    // Self-loop for files with defs but no refs
    const hasDefs = entry.tags.some(t => t.kind === 'def');
    if (hasDefs) {
      const neighbors = graph.get(entry.relativePath)!;
      const current = neighbors.get(entry.relativePath) ?? 0;
      neighbors.set(entry.relativePath, current + 0.1);
    }
  }

  for (const entry of fileEntries) {
    const src = entry.relativePath;
    if (!graph.has(src)) graph.set(src, new Map());

    for (const tag of entry.tags) {
      if (tag.kind === 'ref') {
        const defFile = defMap.get(tag.name);
        if (defFile && defFile !== src) {
          const neighbors = graph.get(src)!;
          neighbors.set(defFile, (neighbors.get(defFile) ?? 0) + 1.0);
        }
      }
    }
  }

  // Build personalization from changes.md
  let personalization: Map<string, number> | undefined;
  if (changesPath) {
    const recent = parseRecentFiles(changesPath);
    if (recent.size > 0) {
      personalization = new Map();
      for (const entry of fileEntries) {
        const touches = recent.get(entry.relativePath) ?? 0;
        personalization.set(entry.relativePath, 1 + touches * 10);
      }
    }
  }

  // Run PageRank
  const scores = pagerank(graph, personalization);

  // Sort files by score descending
  const sorted = fileEntries.sort((a, b) => {
    const sa = scores.get(a.relativePath) ?? 0;
    const sb = scores.get(b.relativePath) ?? 0;
    return sb - sa;
  });

  // Apply token budget
  const selectedEntries: Array<{ file: string; tags: Tag[] }> = [];
  let tokenCount = 0;

  for (const entry of sorted) {
    const defTags = entry.tags.filter(t => t.kind === 'def');
    if (defTags.length === 0) continue; // skip files with no defs

    // Estimate tokens for this file's block
    const block = entry.relativePath + '\n' +
      defTags.map(t => (t.signature?.trim() ?? t.name)).join('\n') + '\n\n';
    const blockTokens = estimateTokens(block);

    if (tokenCount + blockTokens > tokenBudget) break;

    selectedEntries.push({ file: entry.relativePath, tags: defTags });
    tokenCount += blockTokens;
  }

  if (typeof cache.close === 'function') cache.close();

  return renderAiderStyle(selectedEntries);
}
