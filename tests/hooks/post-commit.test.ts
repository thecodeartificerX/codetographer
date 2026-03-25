import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const hookScript = join(projectRoot, 'hooks', 'post-commit.js');

const tmpDir = join(tmpdir(), 'codetographer-commit-test-' + Date.now());

test.before(() => {
  mkdirSync(tmpDir, { recursive: true });
});

test.after(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

test('post-commit exits silently when command is not git commit', () => {
  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    timeout: 5000,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout?.toString().trim(), '');
});

test('post-commit exits silently when not initialized', () => {
  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m "test"' } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    timeout: 5000,
  });

  assert.equal(result.status, 0);
  const changesPath = join(tmpDir, 'docs', 'codetographer', 'changes.md');
  assert.ok(!existsSync(changesPath), 'Should not create changes.md when not initialized');
});
