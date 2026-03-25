import { existsSync, readFileSync, statSync, watchFile, readdirSync } from 'fs';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Tag } from '../types.js';

const PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
const DOCS_DIR = join(PROJECT_DIR, 'docs', 'codetographer');
const DOMAINS_DIR = join(DOCS_DIR, 'domains');
const MAP_PATH = join(DOCS_DIR, 'map.md');
const CHANGES_PATH = join(DOCS_DIR, 'changes.md');
const INDEX_PATH = join(DOCS_DIR, 'INDEX.md');

interface DomainPathMapping { domain: string; paths: string[] }

let allTags: Tag[] = [];
let cachedDomainMap: DomainPathMapping[] | null = null;
let watchDebounce: ReturnType<typeof setTimeout> | null = null;

function parseTagsFromMap(): void {
  if (!existsSync(MAP_PATH)) return;
  try {
    const content = readFileSync(MAP_PATH, 'utf-8');
    const lines = content.split('\n');
    const tags: Tag[] = [];
    let currentFile = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('⋮')) continue;

      if (!trimmed.startsWith('│') && !trimmed.startsWith(' ')) {
        // File path line
        if (trimmed.includes('/') || trimmed.includes('.')) {
          currentFile = trimmed;
        }
      } else if (currentFile && trimmed.startsWith('│')) {
        const sig = trimmed.replace(/^│\s*/, '').trim();
        if (!sig) continue;
        // Extract name from signature
        const nameMatch = sig.match(/(?:function|class|def|func|fn\s+|interface|type|enum|struct)\s+(\w+)/i);
        const name = nameMatch?.[1] ?? sig.split(/[\s(:<{]/)[0] ?? '';
        if (name && name.length > 1) {
          tags.push({ file: currentFile, name, line: 0, kind: 'def', signature: sig });
        }
      }
    }

    allTags = tags;
  } catch { /* ignore */ }
}

function watchMapFile(): void {
  if (!existsSync(MAP_PATH)) return;
  watchFile(MAP_PATH, { interval: 500 }, () => {
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => { parseTagsFromMap(); cachedDomainMap = null; }, 500);
  });
}

function buildDomainMap(): DomainPathMapping[] {
  if (!existsSync(INDEX_PATH)) return [];
  const content = readFileSync(INDEX_PATH, 'utf-8');
  const lines = content.split('\n');
  const mappings: DomainPathMapping[] = [];
  let headerParsed = false;
  let domainCol = -1;
  let pathsCol = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (headerParsed) break;
      continue;
    }
    const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
    if (!headerParsed) {
      domainCol = cells.findIndex(c => /domain/i.test(c));
      pathsCol = cells.findIndex(c => /path|pattern/i.test(c));
      if (domainCol >= 0) headerParsed = true;
      continue;
    }
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    const domain = cells[domainCol] ?? '';
    const pathsRaw = pathsCol >= 0 ? (cells[pathsCol] ?? '') : '';
    if (!domain) continue;
    const paths = pathsRaw.split(/[,\s]+/).map(p => p.replace(/\\/g, '/').trim()).filter(Boolean);
    mappings.push({ domain, paths });
  }
  return mappings;
}

function getDomainForFile(file: string, mappings: DomainPathMapping[]): string | undefined {
  const fwd = file.replace(/\\/g, '/');
  for (const m of mappings) {
    for (const p of m.paths) {
      if (fwd.startsWith(p) || fwd.includes(p)) return m.domain;
    }
  }
  return undefined;
}

function searchTags(query: string, limit = 10): Array<{
  file: string; line: number; name: string; signature?: string; kind: string; domain?: string;
}> {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!keywords.length) return [];

  if (!cachedDomainMap) cachedDomainMap = buildDomainMap();
  const domainMap = cachedDomainMap;

  const results: Array<{ file: string; line: number; name: string; signature?: string; kind: string; domain?: string; score: number }> = [];

  for (const tag of allTags) {
    if (tag.kind !== 'def') continue;
    let score = 0;
    const nameLower = tag.name.toLowerCase();
    const fileLower = tag.file.toLowerCase();
    for (const kw of keywords) {
      if (nameLower === kw) score += 10;
      else if (nameLower.includes(kw)) score += 5;
      else if (fileLower.includes(kw)) score += 2;
      else if (tag.signature?.toLowerCase().includes(kw)) score += 3;
    }
    if (score > 0) {
      results.push({ ...tag, domain: getDomainForFile(tag.file, domainMap), score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _s, ...r }) => r);
}

function readDomainDoc(domain: string, section?: string): string | null {
  const docPath = join(DOMAINS_DIR, `${domain}.md`);
  if (!existsSync(docPath)) return null;
  const content = readFileSync(docPath, 'utf-8');
  if (!section) return content;

  const sectionRegex = new RegExp(`(## [^\n]*${section}[^\n]*\n[\\s\\S]*?)(?=\n## |$)`, 'i');
  const m = content.match(sectionRegex);
  return m ? m[1] : null;
}

function listDomains(): string[] {
  if (!existsSync(DOMAINS_DIR)) return [];
  try {
    return readdirSync(DOMAINS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
  } catch { return []; }
}

async function main(): Promise<void> {
  parseTagsFromMap();
  watchMapFile();

  const server = new McpServer({ name: 'codetographer', version: '1.0.0' });

  server.registerTool(
    'codetographer_search',
    {
      title: 'Search codebase symbols',
      description: 'Search for functions, classes, and types by name or keyword.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default: 10)'),
      }),
    },
    async ({ query, limit }) => {
      const results = searchTags(query, limit ?? 10);
      if (!results.length) {
        return { content: [{ type: 'text' as const, text: `No results for: ${query}` }] };
      }
      const text = results.map(r =>
        `${r.file}:${r.line} [${r.kind}] ${r.name}${r.domain ? ` (${r.domain})` : ''}\n  ${r.signature ?? ''}`
      ).join('\n\n');
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.registerTool(
    'codetographer_domain',
    {
      title: 'Get domain documentation',
      description: 'Read documentation for a code domain, optionally a specific section.',
      inputSchema: z.object({
        domain: z.string().describe('Domain name'),
        section: z.string().optional().describe('Section: purpose, architecture, key-files, patterns, dependencies, gotchas'),
      }),
    },
    async ({ domain, section }) => {
      const content = readDomainDoc(domain, section);
      if (!content) {
        const available = listDomains().join(', ') || 'none';
        return {
          content: [{
            type: 'text' as const,
            text: `Domain "${domain}"${section ? ` section "${section}"` : ''} not found. Available: ${available}`,
          }],
        };
      }
      return { content: [{ type: 'text' as const, text: content }] };
    }
  );

  server.registerTool(
    'codetographer_status',
    {
      title: 'Codetographer status',
      description: 'Returns sync status, map.md age, and total symbol count.',
      inputSchema: z.object({}),
    },
    async () => {
      const mapMtime = existsSync(MAP_PATH) ? statSync(MAP_PATH).mtimeMs : 0;
      const changesMtime = existsSync(CHANGES_PATH) ? statSync(CHANGES_PATH).mtimeMs : 0;

      const domainStatus = listDomains().map(domain => {
        const docPath = join(DOMAINS_DIR, `${domain}.md`);
        const docMtime = existsSync(docPath) ? statSync(docPath).mtimeMs : 0;
        return {
          domain,
          lastSync: new Date(docMtime).toISOString(),
          stale: changesMtime > docMtime,
        };
      });

      const status = {
        mapAge: mapMtime ? new Date(mapMtime).toISOString() : null,
        changesMtime: changesMtime ? new Date(changesMtime).toISOString() : null,
        totalSymbols: allTags.filter(t => t.kind === 'def').length,
        domains: domainStatus,
        initialized: existsSync(INDEX_PATH),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`[codetographer-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
