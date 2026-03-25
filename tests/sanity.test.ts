import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runSanityCheck } from '../src/sanity.js';
import type { SanityOptions } from '../src/sanity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), 'sanity-test-'));
}

/**
 * Create a minimal but "healthy" project layout:
 *   projectDir/
 *     docs/codetographer/
 *       INDEX.md          (with Domain Map table)
 *       map.md
 *       changes.md
 *       domains/
 *         auth.md
 *         api.md
 *     CLAUDE.md           (with ## Codetographer section)
 *     .claude/
 *       hookify.commit-before-stop.local.md
 *       hookify.use-codetographer-docs.local.md
 */
function createHealthyProject(dir: string): void {
  mkdirSync(join(dir, 'docs', 'codetographer', 'domains'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });

  const indexContent = `# Project Index\n\n## Domain Map\n\n| Domain | Paths | Description |\n|--------|-------|-------------|\n| auth   | src/auth/** | Authentication |\n| api    | src/api/**  | API endpoints |\n\n## Recent Activity\n\n- some change\n`;
  writeFileSync(join(dir, 'docs', 'codetographer', 'INDEX.md'), indexContent);
  writeFileSync(join(dir, 'docs', 'codetographer', 'map.md'), '# map\n');
  writeFileSync(join(dir, 'docs', 'codetographer', 'changes.md'), '<!-- domain-touched: -->\n');
  writeFileSync(join(dir, 'docs', 'codetographer', 'domains', 'auth.md'), '# auth\n');
  writeFileSync(join(dir, 'docs', 'codetographer', 'domains', 'api.md'), '# api\n');

  const claudeMd = `# Project\n\n## Codetographer\n\nThis project has auto-maintained codebase docs in \`docs/codetographer/\`:\n- \`INDEX.md\` — routing table (injected at session start)\n`;
  writeFileSync(join(dir, 'CLAUDE.md'), claudeMd);

  // Use the exact template content (matches COMMIT_BEFORE_STOP_TEMPLATE in sanity.ts)
  const commitBeforeStop = `---\nname: commit-before-stop\nenabled: true\nevent: stop\npattern: .*\naction: warn\n---\n\n**Commit and push your work before ending.**\n\nThis project uses codetographer to auto-sync codebase documentation. When you commit, the post-commit hook detects changed files and updates the structural map and domain docs accordingly. Uncommitted work means undocumented work — the next session starts with stale navigation context.\n\n- Stage and commit logical units of work before stopping\n- Push to remote so the documentation stays in sync for all agents\n- If you made significant changes across multiple domains, mention them in the commit message — it helps the sync agent prioritize`;
  writeFileSync(join(dir, '.claude', 'hookify.commit-before-stop.local.md'), commitBeforeStop);
  // Use the exact template content (matches USE_CODETOGRAPHER_DOCS_TEMPLATE in sanity.ts)
  const useCodetographer = `---\nname: use-codetographer-docs\nenabled: true\nevent: prompt\npattern: .*\naction: warn\n---\n\n**This project has codetographer documentation — use it.**\n\nBefore exploring the codebase from scratch, check what's already mapped:\n\n- \`docs/codetographer/INDEX.md\` — routing table mapping files to domains, key commands, and architecture overview\n- \`docs/codetographer/domains/*.md\` — deep-dive docs per domain (architecture, key files, patterns, gotchas)\n- \`docs/codetographer/map.md\` — tree-sitter structural map with ranked function/class signatures\n\nUse the MCP tools for on-demand lookups:\n- \`codetographer_search(query)\` — find symbols by name across the codebase\n- \`codetographer_domain(name)\` — read a specific domain doc\n- \`codetographer_status()\` — check map freshness and domain staleness\n\nThese docs are kept in sync automatically. Trust them before grepping around blindly.`;
  writeFileSync(join(dir, '.claude', 'hookify.use-codetographer-docs.local.md'), useCodetographer);
}

/** Build options for a test. pluginRoot and pluginData point to dirs that may or may not exist. */
function makeOpts(projectDir: string, overrides: Partial<SanityOptions> = {}): SanityOptions {
  return {
    projectDir,
    pluginRoot: join(projectDir, '_plugin-root'),   // doesn't exist → env var checks warn
    pluginData: join(projectDir, '_plugin-data'),   // doesn't exist → env var checks warn
    fix: true,
    quiet: false,
    skipExpensive: true,   // always skip map regen in tests (no WASM)
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('healthy project returns healthy status', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);

    const report = await runSanityCheck(makeOpts(dir));

    assert.equal(report.status, 'healthy', `Expected healthy, got ${report.status}. Summary: ${report.summary}`);
    assert.ok(report.summary.includes('healthy'), 'Summary should mention healthy');
    assert.ok(Array.isArray(report.checks), 'checks should be an array');
    assert.ok(report.checks.length > 0, 'checks should be non-empty');
    // All checks should be pass (env var checks may be warn since pluginRoot/pluginData don't exist)
    const failed = report.checks.filter(c => c.status === 'fail');
    assert.equal(failed.length, 0, `No checks should fail: ${failed.map(c => c.name).join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing docs dir is auto-created when fix is true', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    // Remove the entire docs dir
    rmSync(join(dir, 'docs'), { recursive: true });

    const report = await runSanityCheck(makeOpts(dir));

    assert.ok(existsSync(join(dir, 'docs', 'codetographer')), 'docs/codetographer/ should be created');
    const docsCheck = report.checks.find(c => c.name.includes('docs/codetographer'));
    assert.ok(docsCheck, 'Should have a check for docs/codetographer');
    assert.equal(docsCheck!.status, 'fixed', `docs check should be fixed, got ${docsCheck!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing docs dir is reported as warn when fix is false', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'docs'), { recursive: true });

    const report = await runSanityCheck(makeOpts(dir, { fix: false }));

    // With no fix, dir should not be created
    assert.ok(!existsSync(join(dir, 'docs', 'codetographer')), 'docs/codetographer/ should NOT be created when fix:false');
    const docsCheck = report.checks.find(c => c.name.includes('docs/codetographer'));
    assert.ok(docsCheck, 'Should have a check for docs/codetographer');
    // When fix:false, the check reports warn (auto-fixable item reported as warn, not fail)
    assert.ok(
      docsCheck!.status === 'warn' || docsCheck!.status === 'fail',
      `docs check should be warn or fail when fix:false, got ${docsCheck!.status}`
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing changes.md is auto-created with metadata header', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'docs', 'codetographer', 'changes.md'));

    const report = await runSanityCheck(makeOpts(dir));

    const changesPath = join(dir, 'docs', 'codetographer', 'changes.md');
    assert.ok(existsSync(changesPath), 'changes.md should be created');
    const content = readFileSync(changesPath, 'utf-8');
    assert.ok(content.includes('<!-- domain-touched:'), 'changes.md should contain metadata header');

    const check = report.checks.find(c => c.name.includes('changes.md'));
    assert.ok(check, 'Should have a check for changes.md');
    assert.equal(check!.status, 'fixed', `changes.md check should be fixed, got ${check!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing CLAUDE.md section is appended when CLAUDE.md exists', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    // Write CLAUDE.md without the Codetographer section
    writeFileSync(join(dir, 'CLAUDE.md'), '# My Project\n\nSome existing content.\n');

    const report = await runSanityCheck(makeOpts(dir));

    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('## Codetographer'), 'CLAUDE.md should have Codetographer section appended');
    assert.ok(content.includes('My Project'), 'Original content should be preserved');

    const check = report.checks.find(c => c.name.includes('CLAUDE.md'));
    assert.ok(check, 'Should have a check for CLAUDE.md');
    assert.equal(check!.status, 'fixed', `CLAUDE.md check should be fixed, got ${check!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('CLAUDE.md created if it does not exist', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'CLAUDE.md'));

    const report = await runSanityCheck(makeOpts(dir));

    assert.ok(existsSync(join(dir, 'CLAUDE.md')), 'CLAUDE.md should be created');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('## Codetographer'), 'Created CLAUDE.md should contain Codetographer section');

    const check = report.checks.find(c => c.name.includes('CLAUDE.md'));
    assert.ok(check, 'Should have a check for CLAUDE.md');
    assert.equal(check!.status, 'fixed', `CLAUDE.md check should be fixed, got ${check!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('existing CLAUDE.md section is not duplicated', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    // CLAUDE.md already has the section (created by createHealthyProject)

    await runSanityCheck(makeOpts(dir));

    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    const count = (content.match(/## Codetographer/g) ?? []).length;
    assert.equal(count, 1, `## Codetographer should appear exactly once, found ${count}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing hookify rules are restored', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, '.claude', 'hookify.commit-before-stop.local.md'));
    rmSync(join(dir, '.claude', 'hookify.use-codetographer-docs.local.md'));

    const report = await runSanityCheck(makeOpts(dir));

    assert.ok(
      existsSync(join(dir, '.claude', 'hookify.commit-before-stop.local.md')),
      'hookify.commit-before-stop.local.md should be restored'
    );
    assert.ok(
      existsSync(join(dir, '.claude', 'hookify.use-codetographer-docs.local.md')),
      'hookify.use-codetographer-docs.local.md should be restored'
    );

    const hookifyChecks = report.checks.filter(c => c.name.includes('hookify'));
    assert.ok(hookifyChecks.length >= 2, 'Should have at least 2 hookify checks');
    for (const check of hookifyChecks) {
      assert.equal(check.status, 'fixed', `hookify check ${check.name} should be fixed, got ${check.status}`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing INDEX.md reported as fail', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'docs', 'codetographer', 'INDEX.md'));

    const report = await runSanityCheck(makeOpts(dir));

    assert.equal(report.status, 'needs_attention', `Expected needs_attention, got ${report.status}`);
    const indexCheck = report.checks.find(c => c.name.includes('INDEX.md'));
    assert.ok(indexCheck, 'Should have a check for INDEX.md');
    assert.equal(indexCheck!.status, 'fail', `INDEX.md check should fail, got ${indexCheck!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('stale domain detected when changes.md is newer than domain doc', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);

    // Make changes.md newer than domain docs by adjusting mtimes
    const past = new Date(Date.now() - 60_000); // 60 seconds ago
    const domainAuthPath = join(dir, 'docs', 'codetographer', 'domains', 'auth.md');
    const domainApiPath = join(dir, 'docs', 'codetographer', 'domains', 'api.md');
    utimesSync(domainAuthPath, past, past);
    utimesSync(domainApiPath, past, past);
    // changes.md is current (just created by createHealthyProject, so newer)

    const report = await runSanityCheck(makeOpts(dir));

    const staleDomainCheck = report.checks.find(c => c.staleDomains && c.staleDomains.length > 0);
    assert.ok(staleDomainCheck, 'Should have a check with staleDomains populated');
    assert.ok(
      staleDomainCheck!.staleDomains!.includes('auth') || staleDomainCheck!.staleDomains!.includes('api'),
      `staleDomains should include auth or api, got: ${JSON.stringify(staleDomainCheck!.staleDomains)}`
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('missing domain detected when in INDEX.md but no file on disk', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    // Remove auth domain doc — it's listed in INDEX.md but missing from disk
    rmSync(join(dir, 'docs', 'codetographer', 'domains', 'auth.md'));

    const report = await runSanityCheck(makeOpts(dir));

    const domainCheck = report.checks.find(c => c.staleDomains && c.staleDomains.includes('auth'));
    assert.ok(domainCheck, 'Should have a check with auth in staleDomains');
    assert.ok(
      domainCheck!.status === 'fail' || domainCheck!.status === 'warn',
      `Domain check status should be fail or warn, got ${domainCheck!.status}`
    );
    assert.equal(report.status, 'needs_attention', `Expected needs_attention due to missing domain doc`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('orphaned domain doc warned when on disk but not in INDEX.md', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    // Add an extra domain doc not listed in INDEX.md
    writeFileSync(join(dir, 'docs', 'codetographer', 'domains', 'orphan.md'), '# orphan\n');

    const report = await runSanityCheck(makeOpts(dir));

    const orphanCheck = report.checks.find(c => c.message.includes('orphan'));
    assert.ok(orphanCheck, 'Should have a check mentioning orphan domain');
    assert.equal(orphanCheck!.status, 'warn', `Orphan domain should be warned, got ${orphanCheck!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('skipExpensive skips map regen when map.md is missing', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'docs', 'codetographer', 'map.md'));

    const report = await runSanityCheck(makeOpts(dir, { skipExpensive: true }));

    // map.md should NOT be regenerated (skipExpensive)
    assert.ok(!existsSync(join(dir, 'docs', 'codetographer', 'map.md')), 'map.md should NOT be regenerated with skipExpensive');
    const mapCheck = report.checks.find(c => c.name.includes('map.md'));
    assert.ok(mapCheck, 'Should have a check for map.md');
    assert.equal(mapCheck!.status, 'warn', `map.md check should be warn with skipExpensive, got ${mapCheck!.status}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('report status fixed when some checks fixed and no fail', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    // Remove changes.md and a hookify rule → these get fixed
    rmSync(join(dir, 'docs', 'codetographer', 'changes.md'));
    rmSync(join(dir, '.claude', 'hookify.commit-before-stop.local.md'));

    const report = await runSanityCheck(makeOpts(dir));

    const fixedChecks = report.checks.filter(c => c.status === 'fixed');
    const failChecks = report.checks.filter(c => c.status === 'fail');
    assert.ok(fixedChecks.length >= 1, 'Should have at least 1 fixed check');
    assert.equal(failChecks.length, 0, 'Should have no failed checks');
    assert.equal(report.status, 'fixed', `Expected fixed, got ${report.status}`);
    assert.ok(report.summary.includes('fixed'), `Summary should mention fixed, got: ${report.summary}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('report status needs_attention when at least one check fails', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'docs', 'codetographer', 'INDEX.md'));

    const report = await runSanityCheck(makeOpts(dir));

    assert.equal(report.status, 'needs_attention', `Expected needs_attention, got ${report.status}`);
    assert.ok(
      report.summary.includes('needs attention') || report.summary.includes('needs_attention'),
      `Summary should mention needs attention, got: ${report.summary}`
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('fix false reports issues without modifying files', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);
    rmSync(join(dir, 'docs', 'codetographer', 'changes.md'));
    rmSync(join(dir, '.claude', 'hookify.commit-before-stop.local.md'));

    const report = await runSanityCheck(makeOpts(dir, { fix: false }));

    // Files should NOT be created
    assert.ok(!existsSync(join(dir, 'docs', 'codetographer', 'changes.md')), 'changes.md should NOT be created when fix:false');
    assert.ok(!existsSync(join(dir, '.claude', 'hookify.commit-before-stop.local.md')), 'hookify rule should NOT be restored when fix:false');

    // Checks should still be in the report (not filtered by fix:false)
    const changesCheck = report.checks.find(c => c.name.includes('changes.md'));
    assert.ok(changesCheck, 'changes.md check should appear even with fix:false');
    assert.ok(changesCheck!.status !== 'fixed', 'changes.md check should not be fixed with fix:false');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('quiet option does not filter checks array', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);

    const reportQuiet = await runSanityCheck(makeOpts(dir, { quiet: true }));
    const reportVerbose = await runSanityCheck(makeOpts(dir, { quiet: false }));

    assert.equal(
      reportQuiet.checks.length,
      reportVerbose.checks.length,
      'quiet option should not filter checks array'
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('runSanityCheck returns SanityReport with correct shape', async () => {
  const dir = createTempProject();
  try {
    createHealthyProject(dir);

    const report = await runSanityCheck(makeOpts(dir));

    assert.ok('status' in report, 'report should have status');
    assert.ok('checks' in report, 'report should have checks');
    assert.ok('summary' in report, 'report should have summary');
    assert.ok(['healthy', 'fixed', 'needs_attention'].includes(report.status), `status should be valid, got ${report.status}`);
    assert.ok(typeof report.summary === 'string', 'summary should be a string');

    for (const check of report.checks) {
      assert.ok('name' in check, 'check should have name');
      assert.ok('status' in check, 'check should have status');
      assert.ok('message' in check, 'check should have message');
      assert.ok(['pass', 'fixed', 'warn', 'fail'].includes(check.status), `check status should be valid, got ${check.status}`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
