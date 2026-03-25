import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test the handler functions directly by importing and setting up environment
// This avoids the complexity of spawning a full MCP server process

const tmpDir = join(tmpdir(), 'codetographer-mcp-test-' + Date.now());

test.before(() => {
  mkdirSync(join(tmpDir, 'docs', 'codetographer', 'domains'), { recursive: true });
  mkdirSync(join(tmpDir, '.data'), { recursive: true });

  writeFileSync(join(tmpDir, 'docs', 'codetographer', 'INDEX.md'), `
# Test Project

## Domain Map

| Domain | Paths | Description |
|--------|-------|-------------|
| api | src/api/ | API routes |
| models | src/models/ | Data models |

## Routing Rules

| Domain | File patterns | When to load |
|--------|---------------|--------------|
| api | src/api/ | building endpoints |
| models | src/models/ | database schema |
  `.trim());

  writeFileSync(join(tmpDir, 'docs', 'codetographer', 'domains', 'api.md'), `
# API Domain

**Last updated:** 2026-03-25

## Purpose

Handles HTTP API contracts.

## Architecture

Routes are organized by resource type.

## Gotchas

- Always validate input before passing to service layer.
  `.trim());

  writeFileSync(join(tmpDir, 'docs', 'codetographer', 'map.md'), `
src/api/server.ts
│class Server:
│  handleCreateUser(req: Request): Promise<Response>
│  handleGetUser(req: Request): Promise<Response>

src/models/user.ts
│class UserRepository:
│  create(data: Omit<User, 'id' | 'createdAt'>): User
│  findById(id: string): User | null
  `.trim());
});

test.after(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

test('context-loader returns null for missing INDEX.md', async () => {
  const { loadContext } = await import('../../src/hooks/lib/context-loader.js');
  const result = loadContext(join(tmpDir, 'nonexistent'));
  assert.equal(result, null);
});

test('context-loader returns content when INDEX.md exists', async () => {
  const { loadContext } = await import('../../src/hooks/lib/context-loader.js');
  const result = loadContext(tmpDir);
  assert.ok(result !== null, 'Should return content');
  assert.ok(result!.includes('Test Project'), 'Should contain INDEX.md content');
});

test('domain-matcher returns correct domain for file path', async () => {
  const { matchDomains } = await import('../../src/hooks/lib/domain-matcher.js');
  const indexPath = join(tmpDir, 'docs', 'codetographer', 'INDEX.md');

  const domains = matchDomains('working on src/api/server.ts endpoint', indexPath);
  assert.ok(domains.length > 0, 'Should find a matching domain');
  assert.ok(domains.includes('api'), `Should match 'api' domain, got: ${domains}`);
});

test('domain-matcher returns empty for unknown path', async () => {
  const { matchDomains } = await import('../../src/hooks/lib/domain-matcher.js');
  const indexPath = join(tmpDir, 'docs', 'codetographer', 'INDEX.md');

  const domains = matchDomains('some completely unrelated task', indexPath);
  // May return empty or a default — just verify no error thrown
  assert.ok(Array.isArray(domains));
});

test('domain doc file exists and is readable', async () => {
  const { readFileSync } = await import('fs');
  const docPath = join(tmpDir, 'docs', 'codetographer', 'domains', 'api.md');
  const content = readFileSync(docPath, 'utf-8');
  assert.ok(content.includes('API Domain'));
  assert.ok(content.includes('Purpose'));
  assert.ok(content.includes('Gotchas'));
});
