import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const hookScript = join(projectRoot, 'hooks', 'session-start.js');

const tmpDir = join(tmpdir(), 'codetographer-session-test-' + Date.now());

test.before(() => {
  mkdirSync(join(tmpDir, 'docs', 'codetographer'), { recursive: true });
});

test.after(() => {
  try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

test('session-start exits silently without INDEX.md', () => {
  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({ event: 'SessionStart', hook_event_name: 'startup' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: join(tmpDir, 'empty') },
    timeout: 5000,
  });

  assert.equal(result.status, 0, `Should exit 0, got ${result.status}. stderr: ${result.stderr?.toString()}`);
  assert.equal(result.stdout?.toString().trim(), '', 'Should produce no stdout when INDEX.md missing');
});

test('session-start outputs additionalContext when INDEX.md exists', () => {
  const indexPath = join(tmpDir, 'docs', 'codetographer', 'INDEX.md');
  writeFileSync(indexPath, `# Test Project Index\n\n## Domain Map\n\n| Domain | Paths | Description |\n|--------|-------|-------------|\n| api | src/api/ | API routes |\n`);

  const result = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify({ event: 'SessionStart', hook_event_name: 'startup' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    timeout: 5000,
  });

  assert.equal(result.status, 0, `Should exit 0, got ${result.status}. stderr: ${result.stderr?.toString()}`);

  const stdout = result.stdout?.toString().trim();
  assert.ok(stdout.length > 0, 'Should produce stdout with INDEX.md present');

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    assert.fail(`stdout should be valid JSON, got: ${stdout}`);
  }

  assert.ok(parsed.hookSpecificOutput?.additionalContext, 'Should have additionalContext');
  assert.ok(
    parsed.hookSpecificOutput.additionalContext.includes('Test Project Index'),
    'additionalContext should include INDEX.md content'
  );
});
