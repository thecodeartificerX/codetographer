import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const hookScript = join(projectRoot, 'hooks', 'post-tool-use.js');

const tmpDir = join(tmpdir(), 'codetographer-post-tool-test-' + Date.now());

test.before(() => {
  mkdirSync(join(tmpDir, 'docs', 'codetographer'), { recursive: true });
  mkdirSync(join(tmpDir, 'src', 'api'), { recursive: true });
});

test.after(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

test('post-tool-use creates changes.md and appends file path', () => {
  const changesPath = join(tmpDir, 'docs', 'codetographer', 'changes.md');
  assert.ok(!existsSync(changesPath), 'changes.md should not exist initially');

  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({
      event: 'PostToolUse',
      tool_name: 'Write',
      tool_input: {
        file_path: join(tmpDir, 'src', 'api', 'server.ts'),
      },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    timeout: 5000,
  });

  assert.equal(result.status, 0, `Should exit 0, got ${result.status}. stderr: ${result.stderr?.toString()}`);
  assert.ok(existsSync(changesPath), 'changes.md should be created');

  const content = readFileSync(changesPath, 'utf-8');
  assert.ok(content.includes('server.ts') || content.includes('api'), `changes.md should contain file reference, got:\n${content}`);
  assert.ok(!content.includes('\r\n'), 'changes.md should use LF not CRLF');
});

test('post-tool-use appends to existing changes.md', () => {
  const changesPath = join(tmpDir, 'docs', 'codetographer', 'changes.md');

  const before = readFileSync(changesPath, 'utf-8');
  const linesBefore = before.split('\n').filter(l => l.trim()).length;

  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({
      event: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {
        file_path: join(tmpDir, 'src', 'api', 'middleware.ts'),
      },
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    timeout: 5000,
  });

  assert.equal(result.status, 0);

  const after = readFileSync(changesPath, 'utf-8');
  const linesAfter = after.split('\n').filter(l => l.trim()).length;

  assert.ok(linesAfter > linesBefore, `New line should be appended, ${linesBefore} → ${linesAfter}`);
});
