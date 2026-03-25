import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { Tag } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Map language → wasm filename in the grammar npm package
const LANGUAGE_WASM_MAP: Record<string, { pkg: string; wasmFile: string }> = {
  typescript: { pkg: 'tree-sitter-typescript', wasmFile: 'tree-sitter-typescript.wasm' },
  javascript: { pkg: 'tree-sitter-javascript', wasmFile: 'tree-sitter-javascript.wasm' },
  python:     { pkg: 'tree-sitter-python',     wasmFile: 'tree-sitter-python.wasm' },
  go:         { pkg: 'tree-sitter-go',         wasmFile: 'tree-sitter-go.wasm' },
  rust:       { pkg: 'tree-sitter-rust',       wasmFile: 'tree-sitter-rust.wasm' },
  java:       { pkg: 'tree-sitter-java',       wasmFile: 'tree-sitter-java.wasm' },
  c:          { pkg: 'tree-sitter-c',          wasmFile: 'tree-sitter-c.wasm' },
  cpp:        { pkg: 'tree-sitter-cpp',        wasmFile: 'tree-sitter-cpp.wasm' },
  ruby:       { pkg: 'tree-sitter-ruby',       wasmFile: 'tree-sitter-ruby.wasm' },
  php:        { pkg: 'tree-sitter-php',        wasmFile: 'tree-sitter-php.wasm' },
  swift:      { pkg: 'tree-sitter-swift',      wasmFile: 'tree-sitter-swift.wasm' },
  kotlin:     { pkg: 'tree-sitter-kotlin',     wasmFile: 'tree-sitter-kotlin.wasm' },
  csharp:     { pkg: 'tree-sitter-c-sharp',    wasmFile: 'tree-sitter-c_sharp.wasm' },
  scala:      { pkg: 'tree-sitter-scala',      wasmFile: 'tree-sitter-scala.wasm' },
  elixir:     { pkg: 'tree-sitter-elixir',     wasmFile: 'tree-sitter-elixir.wasm' },
  lua:        { pkg: 'tree-sitter-lua',        wasmFile: 'tree-sitter-lua.wasm' },
};

let parserInitialized = false;
import type { Parser as ParserType, Language as LanguageType } from 'web-tree-sitter';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ParserClass: typeof ParserType | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const languageCache = new Map<string, LanguageType | null>();

// Find project root by searching upwards for package.json
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'scripts', 'queries'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume one or two levels up
  const up1 = join(startDir, '..');
  const up2 = join(startDir, '..', '..');
  return existsSync(join(up1, 'scripts', 'queries')) ? up1 : up2;
}

// Queries directory (relative to compiled output)
function getQueriesDir(): string {
  const projectRoot = findProjectRoot(__dirname);
  return join(projectRoot, 'scripts', 'queries');
}

function resolveWasmPath(language: string): string | null {
  const info = LANGUAGE_WASM_MAP[language];
  if (!info) return null;

  // Try multiple path conventions
  const require = createRequire(import.meta.url);
  const projectRoot = findProjectRoot(__dirname);

  const candidates: Array<string | null> = [
    // Standard: use require.resolve to find the package
    (() => {
      try {
        const pkgDir = dirname(require.resolve(`${info.pkg}/package.json`));
        return join(pkgDir, info.wasmFile);
      } catch { return null; }
    })(),
    // Direct path from project root node_modules
    join(projectRoot, 'node_modules', info.pkg, info.wasmFile),
    // CLAUDE_PLUGIN_DATA node_modules
    (() => {
      const pluginData = process.env['CLAUDE_PLUGIN_DATA'];
      return pluginData ? join(pluginData, 'node_modules', info.pkg, info.wasmFile) : null;
    })(),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

async function getParser(): Promise<typeof ParserType> {
  if (!parserInitialized) {
    const { Parser } = await import('web-tree-sitter');
    await Parser.init();
    ParserClass = Parser;
    parserInitialized = true;
  }
  return ParserClass!;
}

async function getLanguage(language: string): Promise<LanguageType | null> {
  if (languageCache.has(language)) return languageCache.get(language) ?? null;

  const wasmPath = resolveWasmPath(language);
  if (!wasmPath) {
    process.stderr.write(`[codetographer] Warning: no WASM path for language ${language}\n`);
    languageCache.set(language, null);
    return null;
  }

  try {
    const { Language } = await import('web-tree-sitter');
    const lang = await Language.load(wasmPath);
    languageCache.set(language, lang);
    return lang;
  } catch (err) {
    process.stderr.write(`[codetographer] Warning: failed to load grammar for ${language}: ${err}\n`);
    languageCache.set(language, null);
    return null;
  }
}

function loadQueryFile(language: string): string | null {
  const queriesDir = getQueriesDir();
  const queryPath = join(queriesDir, language, 'tags.scm');
  if (!existsSync(queryPath)) return null;
  return readFileSync(queryPath, 'utf-8');
}

export async function extractTags(
  absolutePath: string,
  relativePath: string,
  language: string
): Promise<Tag[]> {
  const Parser = await getParser();
  const lang = await getLanguage(language);
  if (!lang) return [];

  const querySource = loadQueryFile(language);
  if (!querySource) return [];

  let source: string;
  try {
    source = readFileSync(absolutePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = source.split('\n');

  const { Query } = await import('web-tree-sitter');
  let query;
  try {
    query = new Query(lang, querySource);
  } catch (err) {
    process.stderr.write(`[codetographer] Warning: failed to compile query for ${language}: ${err}\n`);
    return [];
  }

  const parser = new Parser();
  parser.setLanguage(lang);

  let tree;
  try {
    tree = parser.parse(source);
  } catch {
    return [];
  }

  if (!tree) return [];

  const tags: Tag[] = [];
  const matches = query.matches(tree.rootNode);

  for (const match of matches) {
    // Look for name capture (e.g. @name.definition.function) and outer capture
    let nameCapture = null;
    let outerCapture = null;

    for (const capture of match.captures) {
      if (capture.name.startsWith('name.definition.') || capture.name.startsWith('name.reference.')) {
        nameCapture = capture;
      } else if (capture.name.startsWith('definition.') || capture.name.startsWith('reference.')) {
        outerCapture = capture;
      }
    }

    if (!nameCapture) continue;

    const node = nameCapture.node;
    const line = node.startPosition.row + 1; // 1-based
    const name = node.text;
    const isRef = nameCapture.name.startsWith('name.reference.');
    const kind: 'def' | 'ref' = isRef ? 'ref' : 'def';

    // Extract signature: the full line for defs
    let signature: string | undefined;
    let scope: string | undefined;
    if (kind === 'def') {
      const lineText = lines[line - 1]?.trim();
      signature = lineText;

      // Try to extract scope from outer capture context
      if (outerCapture) {
        // Walk up to find parent class/module
        let parent = node.parent;
        while (parent) {
          const type = parent.type;
          if (type === 'class_declaration' || type === 'class_body' ||
              type === 'class' || type === 'module' || type === 'impl_item' ||
              type === 'interface_declaration' || type === 'struct_item' ||
              type === 'trait_item' || type === 'class_definition') {
            // Find the name of this parent
            for (let i = 0; i < parent.childCount; i++) {
              const child = parent.child(i);
              if (child && (child.type === 'identifier' || child.type === 'type_identifier')) {
                scope = child.text;
                break;
              }
            }
            break;
          }
          parent = parent.parent;
        }
      }
    }

    tags.push({ file: relativePath, name, line, kind, signature, scope });
  }

  return tags;
}
