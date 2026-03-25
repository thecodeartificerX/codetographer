import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateMap } from '../src/map-generator.js';

const tmpDir = join(tmpdir(), 'codetographer-mapgen-test-' + Date.now());

test.before(() => {
  mkdirSync(join(tmpDir, 'src'), { recursive: true });
  mkdirSync(join(tmpDir, 'data'), { recursive: true });

  // Create 3 TypeScript files that import each other
  writeFileSync(join(tmpDir, 'src', 'models.ts'), `
export class User {
  constructor(public id: string, public name: string) {}
}

export class Product {
  constructor(public id: string, public price: number) {}
}
  `.trim());

  writeFileSync(join(tmpDir, 'src', 'service.ts'), `
import { User } from './models.js';
import { validateInput } from './utils.js';

export class UserService {
  getUser(id: string): User | null {
    validateInput(id);
    return new User(id, 'test');
  }
}
  `.trim());

  writeFileSync(join(tmpDir, 'src', 'utils.ts'), `
export function validateInput(input: string): void {
  if (!input) throw new Error('Input required');
}

export function formatDate(date: Date): string {
  return date.toISOString();
}
  `.trim());
});

test.after(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

test('generateMap produces non-empty output', async () => {
  const result = await generateMap({
    projectRoot: tmpDir,
    dataDir: join(tmpDir, 'data'),
    tokenBudget: 3000,
  });

  assert.ok(result.length > 0, 'Map output should not be empty');
});

test('generateMap respects token budget', async () => {
  const smallBudget = 100; // very tight budget
  const result = await generateMap({
    projectRoot: tmpDir,
    dataDir: join(tmpDir, 'data'),
    tokenBudget: smallBudget,
  });

  // Estimated tokens = chars / 4
  const estimatedTokens = result.length / 4;
  assert.ok(
    estimatedTokens <= smallBudget + 50, // small tolerance
    `Tokens ${estimatedTokens} should be <= budget ${smallBudget}`
  );
});

test('generateMap contains file paths', async () => {
  const result = await generateMap({
    projectRoot: tmpDir,
    dataDir: join(tmpDir, 'data'),
    tokenBudget: 3000,
  });

  // Should contain at least one of our files
  const hasFile = result.includes('models.ts') || result.includes('service.ts') || result.includes('utils.ts');
  assert.ok(hasFile, `Map should contain file paths, got:\n${result.slice(0, 500)}`);
});
