import { existsSync, readFileSync, readdirSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { generateMap } from '../hooks/dist/map-generator.js';
import { atomicWrite } from '../hooks/dist/atomic-write.js';
import { updateRecentActivity } from '../hooks/dist/hooks/lib/recent-activity.js';
// ---------------------------------------------------------------------------
// Hardcoded hookify rule templates (fallback when plugin root files missing)
// ---------------------------------------------------------------------------
const COMMIT_BEFORE_STOP_TEMPLATE = `---
name: commit-before-stop
enabled: true
event: stop
pattern: .*
action: warn
---

**Commit and push your work before ending.**

This project uses codetographer to auto-sync codebase documentation. When you commit, the post-commit hook detects changed files and updates the structural map and domain docs accordingly. Uncommitted work means undocumented work — the next session starts with stale navigation context.

- Stage and commit logical units of work before stopping
- Push to remote so the documentation stays in sync for all agents
- If you made significant changes across multiple domains, mention them in the commit message — it helps the sync agent prioritize`;
const USE_CODETOGRAPHER_DOCS_TEMPLATE = `---
name: use-codetographer-docs
enabled: true
event: prompt
pattern: .*
action: warn
---

**This project has codetographer documentation — use it.**

Before exploring the codebase from scratch, check what's already mapped:

- \`docs/codetographer/INDEX.md\` — routing table mapping files to domains, key commands, and architecture overview
- \`docs/codetographer/domains/*.md\` — deep-dive docs per domain (architecture, key files, patterns, gotchas)
- \`docs/codetographer/map.md\` — tree-sitter structural map with ranked function/class signatures

Use the MCP tools for on-demand lookups:
- \`codetographer_search(query)\` — find symbols by name across the codebase
- \`codetographer_domain(name)\` — read a specific domain doc
- \`codetographer_status()\` — check map freshness and domain staleness

These docs are kept in sync automatically. Trust them before grepping around blindly.`;
const CLAUDE_MD_SECTION = `## Codetographer

This project has auto-maintained codebase docs in \`docs/codetographer/\`:
- \`INDEX.md\` — routing table (injected at session start)
- \`domains/*.md\` — deep-dive docs per domain
- \`map.md\` — tree-sitter structural map with ranked signatures
- \`changes.md\` — hook-maintained change log

MCP tools (when codetographer plugin is active):
- \`codetographer_search(query)\` — find symbols by name
- \`codetographer_domain(name)\` — read a domain doc
- \`codetographer_status()\` — check map freshness

Commit work regularly — the post-commit hook updates the change log and the stop hook regenerates map.md.`;
const HOOK_SCRIPTS = [
    'session-start.js',
    'subagent-start.js',
    'post-tool-use.js',
    'post-compact.js',
    'stop.js',
    'subagent-stop.js',
];
// ---------------------------------------------------------------------------
// Domain table parsing (same approach as domain-matcher.ts and mcp/server.js)
// ---------------------------------------------------------------------------
/**
 * Parse the Domain Map table from INDEX.md content.
 * Returns domain names found in the table.
 */
function parseDomainNames(indexContent) {
    const lines = indexContent.split('\n');
    const names = [];
    let inDomainMapSection = false;
    let inTable = false;
    let headerParsed = false;
    let domainCol = -1;
    for (const line of lines) {
        const trimmed = line.trim();
        // Detect ## Domain Map section
        if (/^## Domain Map\s*$/.test(trimmed)) {
            inDomainMapSection = true;
            inTable = false;
            headerParsed = false;
            domainCol = -1;
            continue;
        }
        // Stop at the next ## heading (but not the section we just entered)
        if (inDomainMapSection && /^## /.test(trimmed) && !/^## Domain Map/.test(trimmed)) {
            break;
        }
        if (!inDomainMapSection)
            continue;
        if (trimmed.startsWith('|')) {
            const cells = trimmed.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
            if (!headerParsed) {
                domainCol = cells.findIndex(c => /domain/i.test(c));
                if (domainCol >= 0) {
                    headerParsed = true;
                    inTable = true;
                }
                continue;
            }
            // Skip separator row
            if (cells.every(c => /^[-:|]+$/.test(c)))
                continue;
            if (inTable && domainCol >= 0) {
                const domain = cells[domainCol] ?? '';
                if (domain && domain !== '---') {
                    names.push(domain);
                }
            }
        }
        else if (inTable && trimmed === '') {
            // blank line ends table
            inTable = false;
            headerParsed = false;
        }
    }
    return names;
}
// ---------------------------------------------------------------------------
// Individual check functions
// ---------------------------------------------------------------------------
/**
 * Check 12: CLAUDE_PLUGIN_ROOT env var is set
 */
function checkPluginRootEnv(pluginRoot) {
    const name = 'env:CLAUDE_PLUGIN_ROOT';
    const fromEnv = process.env['CLAUDE_PLUGIN_ROOT'];
    if (!fromEnv) {
        return { name, status: 'warn', message: 'CLAUDE_PLUGIN_ROOT env var is not set — hooks may not locate plugin files' };
    }
    return { name, status: 'pass', message: 'CLAUDE_PLUGIN_ROOT is set' };
}
/**
 * Check 13: CLAUDE_PLUGIN_DATA env var is set
 */
function checkPluginDataEnv(pluginData) {
    const name = 'env:CLAUDE_PLUGIN_DATA';
    const fromEnv = process.env['CLAUDE_PLUGIN_DATA'];
    if (!fromEnv) {
        return { name, status: 'warn', message: 'CLAUDE_PLUGIN_DATA env var is not set — lazy dep install may fail' };
    }
    return { name, status: 'pass', message: 'CLAUDE_PLUGIN_DATA is set' };
}
/**
 * Check 14: CLAUDE_PROJECT_DIR env var is set
 */
function checkProjectDirEnv() {
    const name = 'env:CLAUDE_PROJECT_DIR';
    const fromEnv = process.env['CLAUDE_PROJECT_DIR'];
    if (!fromEnv) {
        return { name, status: 'warn', message: 'CLAUDE_PROJECT_DIR env var is not set — hooks will use cwd as fallback' };
    }
    return { name, status: 'pass', message: 'CLAUDE_PROJECT_DIR is set' };
}
/**
 * Check 15 + 16: node_modules exist and package.json checksums match
 */
function checkNodeModules(pluginRoot, pluginData, fix) {
    const name = 'plugin:node_modules';
    if (!pluginData || !existsSync(pluginData)) {
        return { name, status: 'warn', message: 'CLAUDE_PLUGIN_DATA directory does not exist — skipping dep check' };
    }
    const nodeModulesPath = join(pluginData, 'node_modules');
    if (!existsSync(nodeModulesPath)) {
        if (fix && pluginRoot && existsSync(pluginRoot)) {
            const installScript = join(pluginRoot, 'scripts', 'install-deps.js');
            if (existsSync(installScript)) {
                const child = spawn(process.execPath, [installScript], {
                    detached: true,
                    stdio: 'ignore',
                    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: pluginData },
                });
                child.unref();
                return { name, status: 'fixed', message: 'node_modules missing — spawned install-deps.js to install dependencies' };
            }
        }
        return { name, status: 'warn', message: 'node_modules missing in CLAUDE_PLUGIN_DATA — run install-deps.js manually' };
    }
    // Check package.json checksums (simplified: compare file sizes as proxy)
    if (pluginRoot && existsSync(pluginRoot)) {
        const rootPkg = join(pluginRoot, 'package.json');
        const dataPkg = join(pluginData, 'package.json');
        if (existsSync(rootPkg) && existsSync(dataPkg)) {
            const rootContent = readFileSync(rootPkg, 'utf-8');
            const dataContent = readFileSync(dataPkg, 'utf-8');
            if (rootContent !== dataContent) {
                if (fix) {
                    const installScript = join(pluginRoot, 'scripts', 'install-deps.js');
                    if (existsSync(installScript)) {
                        const child = spawn(process.execPath, [installScript], {
                            detached: true,
                            stdio: 'ignore',
                            env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: pluginData },
                        });
                        child.unref();
                        return { name, status: 'fixed', message: 'package.json changed — spawned install-deps.js to update dependencies' };
                    }
                }
                return { name, status: 'warn', message: 'package.json checksums differ between pluginRoot and pluginData — run install-deps.js' };
            }
        }
    }
    return { name, status: 'pass', message: 'node_modules present and package.json checksums match' };
}
/**
 * Check 17: Hook scripts exist at expected paths in CLAUDE_PLUGIN_ROOT/hooks/
 */
function checkHookScripts(pluginRoot) {
    const name = 'plugin:hook_scripts';
    if (!pluginRoot || !existsSync(pluginRoot)) {
        return { name, status: 'warn', message: 'CLAUDE_PLUGIN_ROOT not found — cannot verify hook scripts' };
    }
    const hooksDir = join(pluginRoot, 'hooks');
    if (!existsSync(hooksDir)) {
        return { name, status: 'fail', message: `hooks/ directory missing at ${hooksDir} — run npm run build:hooks` };
    }
    const missing = [];
    for (const script of HOOK_SCRIPTS) {
        if (!existsSync(join(hooksDir, script))) {
            missing.push(script);
        }
    }
    if (missing.length > 0) {
        return { name, status: 'fail', message: `Missing hook scripts: ${missing.join(', ')} — run npm run build:hooks` };
    }
    return { name, status: 'pass', message: 'All hook scripts present' };
}
/**
 * Check 1: docs/codetographer/ directory exists
 */
function checkDocsDir(projectDir, fix) {
    const name = 'docs/codetographer/';
    const docsDir = join(projectDir, 'docs', 'codetographer');
    if (!existsSync(docsDir)) {
        if (fix) {
            mkdirSync(docsDir, { recursive: true });
            return { name, status: 'fixed', message: 'docs/codetographer/ directory created' };
        }
        return { name, status: 'warn', message: 'docs/codetographer/ directory missing — run /codetographer to initialize' };
    }
    return { name, status: 'pass', message: 'docs/codetographer/ directory exists' };
}
/**
 * Check 2: INDEX.md exists (unfixable — requires wizard)
 */
function checkIndexMd(projectDir) {
    const name = 'INDEX.md';
    const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
    if (!existsSync(indexPath)) {
        return { name, status: 'fail', message: 'INDEX.md missing — run /codetographer wizard to initialize the project' };
    }
    return { name, status: 'pass', message: 'INDEX.md exists' };
}
/**
 * Check 4: changes.md exists (create if missing; track if just created)
 * Returns { result, justCreated }
 */
function checkChangesMd(projectDir, fix) {
    const name = 'changes.md';
    const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
    if (!existsSync(changesPath)) {
        if (fix) {
            // Ensure parent dir exists
            mkdirSync(join(projectDir, 'docs', 'codetographer'), { recursive: true });
            atomicWrite(changesPath, '<!-- domain-touched: -->\n');
            return {
                result: { name, status: 'fixed', message: 'changes.md created with metadata header' },
                justCreated: true,
            };
        }
        return {
            result: { name, status: 'warn', message: 'changes.md missing — will be created on next file edit' },
            justCreated: false,
        };
    }
    return { result: { name, status: 'pass', message: 'changes.md exists' }, justCreated: false };
}
/**
 * Check 3: map.md exists (regenerate if missing and not skipExpensive)
 */
async function checkMapMd(projectDir, pluginData, fix, skipExpensive, nodeModulesAvailable) {
    const name = 'map.md';
    const mapPath = join(projectDir, 'docs', 'codetographer', 'map.md');
    const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
    if (!existsSync(mapPath)) {
        if (skipExpensive) {
            return { name, status: 'warn', message: 'map.md missing — run /sanity (without skipExpensive) to regenerate' };
        }
        if (!fix || !nodeModulesAvailable) {
            return { name, status: 'warn', message: 'map.md missing — fix or nodeModules not available for regen' };
        }
        try {
            const dataDir = existsSync(pluginData) ? pluginData : join(projectDir, '.codetographer-cache');
            mkdirSync(dataDir, { recursive: true });
            const mapContent = await generateMap({
                projectRoot: projectDir,
                dataDir,
                tokenBudget: 5000,
                changesPath: existsSync(changesPath) ? changesPath : undefined,
            });
            mkdirSync(join(projectDir, 'docs', 'codetographer'), { recursive: true });
            atomicWrite(mapPath, mapContent);
            return { name, status: 'fixed', message: 'map.md regenerated' };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { name, status: 'warn', message: `map.md missing — regeneration failed: ${msg}` };
        }
    }
    return { name, status: 'pass', message: 'map.md exists' };
}
/**
 * Check 6: CLAUDE.md has ## Codetographer section
 */
function checkClaudeMd(projectDir, fix) {
    const name = 'CLAUDE.md:codetographer_section';
    const claudePath = join(projectDir, 'CLAUDE.md');
    if (!existsSync(claudePath)) {
        if (fix) {
            atomicWrite(claudePath, CLAUDE_MD_SECTION + '\n');
            return { name, status: 'fixed', message: 'CLAUDE.md created with ## Codetographer section' };
        }
        return { name, status: 'warn', message: 'CLAUDE.md missing — ## Codetographer section not added' };
    }
    const content = readFileSync(claudePath, 'utf-8');
    if (!content.includes('## Codetographer')) {
        if (fix) {
            const appended = content.trimEnd() + '\n\n' + CLAUDE_MD_SECTION + '\n';
            atomicWrite(claudePath, appended);
            return { name, status: 'fixed', message: '## Codetographer section appended to CLAUDE.md' };
        }
        return { name, status: 'warn', message: 'CLAUDE.md missing ## Codetographer section — run /sanity with fix to append' };
    }
    return { name, status: 'pass', message: 'CLAUDE.md has ## Codetographer section' };
}
/**
 * Check 7 + 8: Hookify rules exist and match template
 */
function checkHookifyRule(projectDir, pluginRoot, ruleName, fallbackContent, fix) {
    const fileName = `hookify.${ruleName}.local.md`;
    const name = `hookify:${ruleName}`;
    const targetPath = join(projectDir, '.claude', fileName);
    // Determine template content
    let templateContent = fallbackContent;
    if (pluginRoot && existsSync(pluginRoot)) {
        const templatePath = join(pluginRoot, '.claude', fileName);
        if (existsSync(templatePath)) {
            try {
                templateContent = readFileSync(templatePath, 'utf-8');
            }
            catch { /* fall back to hardcoded */ }
        }
    }
    if (!existsSync(targetPath)) {
        if (fix) {
            mkdirSync(join(projectDir, '.claude'), { recursive: true });
            atomicWrite(targetPath, templateContent);
            return { name, status: 'fixed', message: `${fileName} created from template` };
        }
        return { name, status: 'warn', message: `${fileName} missing — run /sanity with fix to restore` };
    }
    // Check if content matches template
    const existing = readFileSync(targetPath, 'utf-8').replace(/\r\n/g, '\n');
    const expected = templateContent.replace(/\r\n/g, '\n');
    if (existing.trim() !== expected.trim()) {
        if (fix) {
            atomicWrite(targetPath, templateContent);
            return { name, status: 'fixed', message: `${fileName} restored to template content` };
        }
        return { name, status: 'warn', message: `${fileName} differs from template — run /sanity with fix to restore` };
    }
    return { name, status: 'pass', message: `${fileName} exists and matches template` };
}
/**
 * Check 5: Domain docs match INDEX.md routing table
 * Returns { result, missingDomains, extraDomains }
 */
function checkDomainAlignment(projectDir) {
    const name = 'domains:alignment';
    const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
    const domainsDir = join(projectDir, 'docs', 'codetographer', 'domains');
    if (!existsSync(indexPath)) {
        return { name, status: 'pass', message: 'Skipped — INDEX.md not found' };
    }
    let indexContent;
    try {
        indexContent = readFileSync(indexPath, 'utf-8');
    }
    catch {
        return { name, status: 'warn', message: 'Could not read INDEX.md' };
    }
    const indexDomains = parseDomainNames(indexContent);
    let diskDomains = [];
    if (existsSync(domainsDir)) {
        try {
            diskDomains = readdirSync(domainsDir)
                .filter(f => f.endsWith('.md'))
                .map(f => f.replace(/\.md$/, ''));
        }
        catch { /* ignore */ }
    }
    const indexSet = new Set(indexDomains);
    const diskSet = new Set(diskDomains);
    const missing = indexDomains.filter(d => !diskSet.has(d)); // in INDEX but not on disk
    const extra = diskDomains.filter(d => !indexSet.has(d)); // on disk but not in INDEX
    const parts = [];
    if (missing.length > 0)
        parts.push(`missing docs: ${missing.join(', ')}`);
    if (extra.length > 0)
        parts.push(`orphaned docs: ${extra.join(', ')}`);
    if (missing.length > 0) {
        const msg = `Domain doc(s) missing from disk: ${missing.join(', ')}${extra.length > 0 ? `; orphaned: ${extra.join(', ')}` : ''} — run /codetographer to generate`;
        return { name, status: 'fail', message: msg, staleDomains: missing };
    }
    if (extra.length > 0) {
        return { name, status: 'warn', message: `Orphaned domain doc(s) on disk (not in INDEX.md): ${extra.join(', ')}` };
    }
    return { name, status: 'pass', message: 'Domain docs match INDEX.md routing table' };
}
/**
 * Check 9: map.md is stale (changes.md mtime > map.md mtime)
 */
async function checkMapStaleness(projectDir, pluginData, fix, skipExpensive, justCreatedChangesMd, nodeModulesAvailable) {
    const name = 'staleness:map.md';
    const mapPath = join(projectDir, 'docs', 'codetographer', 'map.md');
    const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
    if (!existsSync(mapPath) || !existsSync(changesPath)) {
        return { name, status: 'pass', message: 'Skipped — map.md or changes.md not found' };
    }
    // If changes.md was just created by this run, skip regen to avoid false positive
    if (justCreatedChangesMd) {
        return { name, status: 'pass', message: 'Skipped — changes.md was just created (no meaningful entries)' };
    }
    const mapMtime = statSync(mapPath).mtimeMs;
    const changesMtime = statSync(changesPath).mtimeMs;
    if (changesMtime < mapMtime) {
        return { name, status: 'pass', message: 'map.md is up to date' };
    }
    const ageSec = Math.round((changesMtime - mapMtime) / 1000);
    if (skipExpensive) {
        return { name, status: 'warn', message: `map.md is stale (${ageSec}s behind changes.md) — run /sanity to regenerate` };
    }
    if (!fix || !nodeModulesAvailable) {
        return { name, status: 'warn', message: `map.md is stale (${ageSec}s behind changes.md)` };
    }
    try {
        const dataDir = existsSync(pluginData) ? pluginData : join(projectDir, '.codetographer-cache');
        mkdirSync(dataDir, { recursive: true });
        const mapContent = await generateMap({
            projectRoot: projectDir,
            dataDir,
            tokenBudget: 5000,
            changesPath,
        });
        atomicWrite(mapPath, mapContent);
        return { name, status: 'fixed', message: `map.md regenerated (was ${ageSec}s stale)` };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { name, status: 'warn', message: `map.md is stale — regeneration failed: ${msg}` };
    }
}
/**
 * Check 10: Domain docs are stale (changes.md mtime > domain doc mtime)
 */
function checkDomainStaleness(projectDir) {
    const name = 'staleness:domains';
    const domainsDir = join(projectDir, 'docs', 'codetographer', 'domains');
    const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
    if (!existsSync(changesPath) || !existsSync(domainsDir)) {
        return { name, status: 'pass', message: 'Skipped — changes.md or domains/ not found' };
    }
    const changesMtime = statSync(changesPath).mtimeMs;
    let domainFiles = [];
    try {
        domainFiles = readdirSync(domainsDir).filter(f => f.endsWith('.md'));
    }
    catch {
        return { name, status: 'pass', message: 'Skipped — could not read domains/' };
    }
    const stale = [];
    for (const file of domainFiles) {
        const docPath = join(domainsDir, file);
        try {
            const docMtime = statSync(docPath).mtimeMs;
            if (changesMtime > docMtime) {
                stale.push(file.replace(/\.md$/, ''));
            }
        }
        catch { /* ignore */ }
    }
    if (stale.length > 0) {
        return {
            name,
            status: 'warn',
            message: `${stale.length} domain doc(s) stale: ${stale.join(', ')} — run /codetographer or dispatch domain-explorer agents`,
            staleDomains: stale,
        };
    }
    return { name, status: 'pass', message: 'All domain docs are up to date' };
}
/**
 * Check 11: INDEX.md Recent Activity section is outdated — rebuild from last 5 entries
 */
function checkRecentActivity(projectDir, fix) {
    const name = 'INDEX.md:recent_activity';
    const indexPath = join(projectDir, 'docs', 'codetographer', 'INDEX.md');
    const changesPath = join(projectDir, 'docs', 'codetographer', 'changes.md');
    if (!existsSync(indexPath) || !existsSync(changesPath)) {
        return { name, status: 'pass', message: 'Skipped — INDEX.md or changes.md not found' };
    }
    try {
        const changesContent = readFileSync(changesPath, 'utf-8');
        const entries = changesContent
            .split('\n')
            .filter(l => l.startsWith('- '))
            .map(l => l.slice(2).trim())
            .filter(Boolean);
        if (entries.length === 0) {
            return { name, status: 'pass', message: 'No changes to sync to Recent Activity' };
        }
        const last5 = entries.slice(-5);
        if (fix) {
            updateRecentActivity(indexPath, last5);
            return { name, status: 'fixed', message: 'INDEX.md Recent Activity rebuilt from changes.md' };
        }
        return { name, status: 'warn', message: 'INDEX.md Recent Activity may be outdated — run /sanity with fix to rebuild' };
    }
    catch {
        return { name, status: 'pass', message: 'Skipped — could not read changes for Recent Activity' };
    }
}
// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------
function buildReport(checks) {
    const hasAnyFail = checks.some(c => c.status === 'fail');
    const hasAnyFixed = checks.some(c => c.status === 'fixed');
    let status;
    if (hasAnyFail) {
        status = 'needs_attention';
    }
    else if (hasAnyFixed) {
        status = 'fixed';
    }
    else {
        status = 'healthy';
    }
    const passed = checks.filter(c => c.status === 'pass' || c.status === 'fixed' || c.status === 'warn').length;
    const total = checks.length;
    const fixedCount = checks.filter(c => c.status === 'fixed').length;
    const failCount = checks.filter(c => c.status === 'fail').length;
    let summary;
    if (status === 'healthy') {
        summary = `healthy (${passed}/${total} passed)`;
    }
    else if (status === 'fixed') {
        summary = `fixed (${passed}/${total} passed, ${fixedCount} fixed)`;
    }
    else {
        summary = `needs attention (${passed}/${total} passed, ${failCount} failed)`;
    }
    return { status, checks, summary };
}
// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------
export async function runSanityCheck(options) {
    const { projectDir, pluginRoot, pluginData, fix, skipExpensive } = options;
    const checks = [];
    // ── Phase 1: Plugin runtime checks (12–17) ──────────────────────────────
    checks.push(checkPluginRootEnv(pluginRoot));
    checks.push(checkPluginDataEnv(pluginData));
    checks.push(checkProjectDirEnv());
    const nodeModulesResult = checkNodeModules(pluginRoot, pluginData, fix);
    checks.push(nodeModulesResult);
    const nodeModulesAvailable = existsSync(join(pluginData || '', 'node_modules'));
    checks.push(checkHookScripts(pluginRoot));
    // ── Phase 2: Target project state ───────────────────────────────────────
    // Check 1: docs/codetographer/ dir
    const docsDirResult = checkDocsDir(projectDir, fix);
    checks.push(docsDirResult);
    // Check 2: INDEX.md (unfixable)
    const indexResult = checkIndexMd(projectDir);
    checks.push(indexResult);
    // Short-circuit remaining target checks if INDEX.md is missing
    if (indexResult.status === 'fail') {
        return buildReport(checks);
    }
    // Check 4: changes.md (track if just created)
    const { result: changesMdResult, justCreated: justCreatedChangesMd } = checkChangesMd(projectDir, fix);
    checks.push(changesMdResult);
    // Check 3: map.md
    checks.push(await checkMapMd(projectDir, pluginData, fix, skipExpensive, nodeModulesAvailable));
    // Check 6: CLAUDE.md section
    checks.push(checkClaudeMd(projectDir, fix));
    // Check 7: hookify commit-before-stop
    checks.push(checkHookifyRule(projectDir, pluginRoot, 'commit-before-stop', COMMIT_BEFORE_STOP_TEMPLATE, fix));
    // Check 8: hookify use-codetographer-docs
    checks.push(checkHookifyRule(projectDir, pluginRoot, 'use-codetographer-docs', USE_CODETOGRAPHER_DOCS_TEMPLATE, fix));
    // Check 5: Domain alignment
    checks.push(checkDomainAlignment(projectDir));
    // ── Phase 3: Staleness detection ────────────────────────────────────────
    // Check 9: map.md staleness
    checks.push(await checkMapStaleness(projectDir, pluginData, fix, skipExpensive, justCreatedChangesMd, nodeModulesAvailable));
    // Check 10: Domain staleness
    checks.push(checkDomainStaleness(projectDir));
    // Check 11: INDEX.md Recent Activity
    checks.push(checkRecentActivity(projectDir, fix));
    return buildReport(checks);
}
// ---------------------------------------------------------------------------
// CLI formatting helpers
// ---------------------------------------------------------------------------
function formatReport(report, quiet) {
    const lines = [];
    lines.push('Codetographer Sanity Check');
    lines.push('──────────────────────────');
    for (const check of report.checks) {
        if (quiet && check.status === 'pass')
            continue;
        let label;
        switch (check.status) {
            case 'pass':
                label = ' PASS ';
                break;
            case 'fixed':
                label = ' FIXED';
                break;
            case 'warn':
                label = ' WARN ';
                break;
            case 'fail':
                label = ' FAIL ';
                break;
            default: label = '      ';
        }
        let msg = check.message;
        if (check.staleDomains && check.staleDomains.length > 0) {
            msg += ` — ${check.staleDomains.length} stale domains: ${check.staleDomains.join(', ')}`;
        }
        lines.push(` ${label}  ${msg}`);
    }
    lines.push('');
    lines.push(`Status: ${report.summary}`);
    return lines.join('\n') + '\n';
}
// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
async function main() {
    const args = process.argv.slice(2);
    function getArg(name) {
        const idx = args.indexOf(name);
        return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
    }
    const hasFlag = (name) => args.includes(name);
    if (hasFlag('--help') || hasFlag('-h')) {
        process.stdout.write([
            'Usage: node scripts/sanity.js [options]',
            '',
            'Options:',
            '  --project-dir <path>   Target project root (default: CLAUDE_PROJECT_DIR or cwd)',
            '  --plugin-root <path>   Plugin install dir (default: CLAUDE_PLUGIN_ROOT)',
            '  --plugin-data <path>   Plugin data dir (default: CLAUDE_PLUGIN_DATA)',
            '  --no-fix               Report only, do not attempt repairs',
            '  --quiet                Only show non-pass checks in text output',
            '  --skip-expensive       Skip map regeneration (used by session-start hook)',
            '  --json                 Output as JSON (for skill consumption)',
            '',
        ].join('\n'));
        process.exit(0);
    }
    const projectDir = getArg('--project-dir') ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
    const pluginRoot = getArg('--plugin-root') ?? process.env['CLAUDE_PLUGIN_ROOT'] ?? '';
    const pluginData = getArg('--plugin-data') ?? process.env['CLAUDE_PLUGIN_DATA'] ?? '';
    const fix = !hasFlag('--no-fix');
    const quiet = hasFlag('--quiet');
    const skipExpensive = hasFlag('--skip-expensive');
    const jsonOutput = hasFlag('--json');
    const report = await runSanityCheck({ projectDir, pluginRoot, pluginData, fix, quiet, skipExpensive });
    if (jsonOutput) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    else {
        process.stdout.write(formatReport(report, quiet));
    }
    process.exit(report.status === 'needs_attention' ? 1 : 0);
}
// Run only when this file is the entry point
const scriptName = process.argv[1] ?? '';
if (scriptName.endsWith('sanity.js') || scriptName.endsWith('sanity.ts')) {
    main().catch(err => {
        process.stderr.write(`[codetographer] Fatal: ${err}\n`);
        process.exit(1);
    });
}
