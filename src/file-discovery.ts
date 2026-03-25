import { readFileSync, statSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import type { DiscoveredFile } from './types.js';

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.scala': 'scala',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.lua': 'lua',
};

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.svn', '.hg',
  '__pycache__', '.cache', '.next', '.nuxt', 'build',
  'target', 'vendor', '.venv', 'venv', 'env',
  'coverage', '.nyc_output', '.tox',
  'worktrees', '.worktrees',
  '.codetographer-data',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib',
  '.bin', '.wasm', '.pyc', '.class',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.ttf', '.woff', '.woff2', '.eot',
]);

const LOCKFILE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock',
  'composer.lock',
]);

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function parseIgnoreFile(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function matchesIgnorePattern(relativePath: string, patterns: string[]): boolean {
  const fwd = toForwardSlash(relativePath);
  for (const pattern of patterns) {
    // Simple glob matching: support * and leading/trailing **
    const normalized = pattern.replace(/\\/g, '/');
    // If pattern has no /, match basename
    if (!normalized.includes('/')) {
      const basename = fwd.split('/').pop() ?? '';
      if (matchGlob(basename, normalized)) return true;
    } else {
      if (matchGlob(fwd, normalized) || matchGlob(fwd, '**/' + normalized)) return true;
    }
  }
  return false;
}

function matchGlob(str: string, pattern: string): boolean {
  const regexStr = '^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*') + '$';
  try {
    return new RegExp(regexStr).test(str);
  } catch {
    return false;
  }
}

export function discoverFiles(projectRoot: string): DiscoveredFile[] {
  const gitignorePatterns = parseIgnoreFile(join(projectRoot, '.gitignore'));
  const codetographignorePatterns = parseIgnoreFile(join(projectRoot, '.codetographignore'));
  const ignorePatterns = [...gitignorePatterns, ...codetographignorePatterns];

  const results: DiscoveredFile[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }

      const relPath = toForwardSlash(relative(projectRoot, absPath));

      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        if (matchesIgnorePattern(relPath, ignorePatterns)) continue;
        walk(absPath);
      } else if (stat.isFile()) {
        if (LOCKFILE_NAMES.has(entry)) continue;
        const lastDot = entry.lastIndexOf('.');
        if (lastDot === -1) continue;
        const ext = entry.slice(lastDot).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        const language = EXTENSION_MAP[ext];
        if (!language) continue;
        if (matchesIgnorePattern(relPath, ignorePatterns)) continue;
        results.push({ relativePath: relPath, language, absolutePath: absPath });
      }
    }
  }

  walk(projectRoot);
  return results;
}
