import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractTags } from '../src/tag-extractor.js';

const tmpDir = join(tmpdir(), 'codetographer-test-' + Date.now());

test.before(() => {
  mkdirSync(tmpDir, { recursive: true });
});

test.after(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

test('extracts function and class definitions from TypeScript', async () => {
  const tsFile = join(tmpDir, 'sample.ts');
  writeFileSync(tsFile, `
export class MyService {
  getData(): string {
    return 'hello';
  }
}

export function processData(input: string): number {
  return input.length;
}

interface MyInterface {
  name: string;
}
  `.trim());

  const tags = await extractTags(tsFile, 'sample.ts', 'typescript');

  // Should find class definition
  const classDef = tags.find(t => t.name === 'MyService' && t.kind === 'def');
  assert.ok(classDef, `Should find MyService class definition, got: ${JSON.stringify(tags.map(t => ({ name: t.name, kind: t.kind })))}`);

  // Should find function definition
  const funcDef = tags.find(t => t.name === 'processData' && t.kind === 'def');
  assert.ok(funcDef, `Should find processData function, got: ${JSON.stringify(tags.map(t => t.name))}`);

  // Functions should have signatures
  assert.ok(funcDef!.signature, 'processData should have a signature line');
  assert.ok(funcDef!.signature!.includes('processData'), 'Signature should contain function name');

  // Line numbers should be 1-based positive integers
  assert.ok(classDef!.line >= 1, `Line number should be >= 1, got ${classDef!.line}`);
  assert.ok(funcDef!.line >= 1, `Line number should be >= 1, got ${funcDef!.line}`);
});

test('returns empty array for unknown language', async () => {
  const tmpFile = join(tmpDir, 'test.unknown');
  writeFileSync(tmpFile, 'content');
  const tags = await extractTags(tmpFile, 'test.unknown', 'unknownlang');
  assert.deepEqual(tags, []);
});

test('returns empty array for missing file', async () => {
  const tags = await extractTags('/nonexistent/file.ts', 'file.ts', 'typescript');
  assert.deepEqual(tags, []);
});
