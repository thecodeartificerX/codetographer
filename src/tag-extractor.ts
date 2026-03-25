import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { Tag } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
import type { Parser as ParserType, Language as LanguageType, Query as QueryType } from 'web-tree-sitter';
let ParserClass: typeof ParserType | null = null;
let parserInstance: ParserType | null = null;
const languageCache = new Map<string, LanguageType | null>();
const querySourceCache = new Map<string, string | null>();
const queryCache = new Map<string, QueryType | null>();

// Computed once since __dirname never changes
const projectRoot = findProjectRoot(__dirname);
const queriesDir = join(projectRoot, 'scripts', 'queries');

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'scripts', 'queries'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  const up1 = join(startDir, '..');
  const up2 = join(startDir, '..', '..');
  return existsSync(join(up1, 'scripts', 'queries')) ? up1 : up2;
}

function resolveWasmPath(language: string): string | null {
  const info = LANGUAGE_WASM_MAP[language];
  if (!info) return null;

  const require = createRequire(import.meta.url);

  const candidates: Array<string | null> = [
    (() => {
      try {
        const pkgDir = dirname(require.resolve(`${info.pkg}/package.json`));
        return join(pkgDir, info.wasmFile);
      } catch { return null; }
    })(),
    join(projectRoot, 'node_modules', info.pkg, info.wasmFile),
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

async function getParserInstance(): Promise<ParserType> {
  if (!parserInstance) {
    const Parser = await getParser();
    parserInstance = new Parser();
  }
  return parserInstance;
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

function loadQuerySource(language: string): string | null {
  if (querySourceCache.has(language)) return querySourceCache.get(language) ?? null;
  const queryPath = join(queriesDir, language, 'tags.scm');
  let source: string | null = null;
  try {
    source = readFileSync(queryPath, 'utf-8');
  } catch { /* missing query file */ }
  querySourceCache.set(language, source);
  return source;
}

async function getQuery(language: string, lang: LanguageType): Promise<QueryType | null> {
  if (queryCache.has(language)) return queryCache.get(language) ?? null;

  const querySource = loadQuerySource(language);
  if (!querySource) {
    queryCache.set(language, null);
    return null;
  }

  const { Query } = await import('web-tree-sitter');
  try {
    const query = new Query(lang, querySource);
    queryCache.set(language, query);
    return query;
  } catch (err) {
    process.stderr.write(`[codetographer] Warning: failed to compile query for ${language}: ${err}\n`);
    queryCache.set(language, null);
    return null;
  }
}

export async function extractTags(
  absolutePath: string,
  relativePath: string,
  language: string
): Promise<Tag[]> {
  // Parser.init() must run before Language.load()
  await getParser();

  const lang = await getLanguage(language);
  if (!lang) return [];

  const query = await getQuery(language, lang);
  if (!query) return [];

  let source: string;
  try {
    source = readFileSync(absolutePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = source.split('\n');
  const parser = await getParserInstance();
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
    const line = node.startPosition.row + 1;
    const name = node.text;
    const isRef = nameCapture.name.startsWith('name.reference.');
    const kind: 'def' | 'ref' = isRef ? 'ref' : 'def';

    let signature: string | undefined;
    let scope: string | undefined;
    if (kind === 'def') {
      const lineText = lines[line - 1]?.trim();
      signature = lineText;

      if (outerCapture) {
        let parent = node.parent;
        while (parent) {
          const type = parent.type;
          if (type === 'class_declaration' || type === 'class_body' ||
              type === 'class' || type === 'module' || type === 'impl_item' ||
              type === 'interface_declaration' || type === 'struct_item' ||
              type === 'trait_item' || type === 'class_definition') {
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
