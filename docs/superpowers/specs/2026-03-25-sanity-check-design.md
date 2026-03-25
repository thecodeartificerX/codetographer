# Sanity Check Feature Design

**Date:** 2026-03-25
**Status:** Draft

## Problem

When codetographer is first installed on a project (or after a plugin upgrade), the wizard may not have run or may have partially completed. This leaves the target project in an inconsistent state — missing CLAUDE.md sections, absent hookify rules, stale maps, or missing doc files. There is no way to detect or repair this without manually inspecting every artifact.

During development of the plugin itself, things break frequently. A diagnostic that verifies everything is wired up correctly and auto-repairs what it can would save significant debugging time.

## Solution

A hybrid approach: a core TypeScript module (`src/sanity.ts`) handles all deterministic checks and fixes, integrated at two levels:

1. **Session-start hook** — calls the sanity module with auto-fix enabled and quiet output. Silently repairs what it can, injects warnings for things it couldn't fix.
2. **`/sanity` skill** — runs the full check via a CLI wrapper, displays a formatted report, then dispatches domain-explorer agents for any stale domains. Always shows a summary, even when everything is healthy.
3. **`scripts/sanity.js` CLI** — thin wrapper for manual debugging (`node scripts/sanity.js --project-dir /path`).

## Architecture

### Core Module: `src/sanity.ts`

Exports a single function:

```ts
export interface SanityOptions {
  projectDir: string;       // target project root (CLAUDE_PROJECT_DIR)
  pluginRoot: string;       // CLAUDE_PLUGIN_ROOT
  pluginData: string;       // CLAUDE_PLUGIN_DATA
  fix: boolean;             // attempt auto-fixes (default: true)
  quiet: boolean;           // rendering hint: suppress 'pass' checks in CLI output (default: false)
  skipExpensive: boolean;   // skip map regeneration (default: false, use true in session-start)
}

export interface SanityCheckResult {
  name: string;
  status: 'pass' | 'fixed' | 'warn' | 'fail';
  message: string;
  staleDomains?: string[];  // aggregated across Check 5 (missing) and Check 10 (stale)
}

// quiet is a rendering hint only — it does NOT filter the checks[] array.
// All checks are always included in the report. quiet controls whether
// 'pass' entries are printed to stdout by the CLI wrapper.

export interface SanityReport {
  status: 'healthy' | 'fixed' | 'needs_attention';
  checks: SanityCheckResult[];
  summary: string;          // human-readable one-liner
}

export async function runSanityCheck(options: SanityOptions): Promise<SanityReport>;
```

**Report status logic:**
- `healthy` — all checks returned `pass` (or `pass` + `fixed` with no `fail`)
- `fixed` — some checks returned `fixed`, warnings allowed, but no `fail`
- `needs_attention` — at least one check returned `fail`

A `warn` alongside `fixed` results still counts as `fixed` (not `needs_attention`), since warnings are informational (e.g., missing env vars). Only `fail` escalates to `needs_attention`.

### Check Catalog

Each check is a discrete function. When `fix: true`, the check attempts repair before reporting.

#### Target Project State

| # | Check | Fix Action | Unfixable? |
|---|-------|-----------|------------|
| 1 | `docs/codetographer/` directory exists | Create it | — |
| 2 | `INDEX.md` exists | — | Yes — requires wizard (flag as `fail`) |
| 3 | `map.md` exists | Regenerate via `generateMap()` from `map-generator.ts` | — |
| 4 | `changes.md` exists | Create with metadata header (`<!-- domain-touched: -->`). Note: a freshly created changes.md (metadata line only, no entries) is not considered stale for Check 9 — skip map regen if changes.md was just created by this check. | — |
| 5 | Domain docs match INDEX.md routing table | Parse INDEX.md Domain Map section, compare against `docs/codetographer/domains/*.md` on disk. Report missing/extra. Flag stale domains in `staleDomains`. | Missing domains need agent dispatch (unfixable by module) |
| 6 | `CLAUDE.md` has `## Codetographer` section | Append the standard block (same content as wizard Step 7) | — |
| 7 | `.claude/hookify.commit-before-stop.local.md` exists and matches template | Copy from `CLAUDE_PLUGIN_ROOT/.claude/` template | — |
| 8 | `.claude/hookify.use-codetographer-docs.local.md` exists and matches template | Copy from `CLAUDE_PLUGIN_ROOT/.claude/` template | — |

#### Staleness Detection

| # | Check | Fix Action |
|---|-------|-----------|
| 9 | `map.md` is stale (`changes.md` mtime > `map.md` mtime) | Regenerate map via `generateMap()` |
| 10 | Domain docs are stale (`changes.md` mtime > domain doc mtime) | Report in `staleDomains` for agent dispatch |
| 11 | INDEX.md Recent Activity section is outdated | Rebuild from last 5 entries in `changes.md` (reuse shared `updateRecentActivity` from `src/hooks/lib/recent-activity.ts`) |

#### Plugin Runtime State

| # | Check | Fix Action | Unfixable? |
|---|-------|-----------|------------|
| 12 | `CLAUDE_PLUGIN_ROOT` env var is set | — | Yes — flag as `warn` |
| 13 | `CLAUDE_PLUGIN_DATA` env var is set | — | Yes — flag as `warn` |
| 14 | `CLAUDE_PROJECT_DIR` env var is set | — | Yes — flag as `warn` |
| 15 | `node_modules` exist in `CLAUDE_PLUGIN_DATA` | Spawn `scripts/install-deps.js` detached | — |
| 16 | `package.json` checksums match (plugin root vs plugin data) | Spawn `scripts/install-deps.js` detached | — |
| 17 | Hook scripts exist at expected paths in `CLAUDE_PLUGIN_ROOT/hooks/` | — | Yes — build issue, flag as `fail` |

**Check ordering:** Plugin runtime checks (12-17) run first. If critical deps are missing (no `node_modules`), checks that depend on them (map regeneration) are skipped and flagged with a `warn` explaining why.

### CLAUDE.md Section Content

The exact block appended when the `## Codetographer` section is missing (matches wizard-flow.md Step 7):

```markdown
## Codetographer

This project has auto-maintained codebase docs in `docs/codetographer/`:
- `INDEX.md` — routing table (injected at session start)
- `domains/*.md` — deep-dive docs per domain
- `map.md` — tree-sitter structural map with ranked signatures
- `changes.md` — hook-maintained change log

MCP tools (when codetographer plugin is active):
- `codetographer_search(query)` — find symbols by name
- `codetographer_domain(name)` — read a domain doc
- `codetographer_status()` — check map freshness

Commit work regularly — the post-commit hook updates the change log and the stop hook regenerates map.md.
```

### Hookify Rule Templates

The plugin repo contains hookify rule files at `.claude/hookify.commit-before-stop.local.md` and `.claude/hookify.use-codetographer-docs.local.md`. These serve as templates. During the sanity check:

1. Read the template content from `CLAUDE_PLUGIN_ROOT/.claude/<rule>.local.md`
2. If the template file doesn't exist at `CLAUDE_PLUGIN_ROOT` (e.g., dev environment without `.claude/`), fall back to **hardcoded content** matching the wizard-flow.md Step 6 definitions. The sanity module embeds these as string constants to guarantee it can always restore hookify rules regardless of plugin root state.
3. Compare against the target project's `.claude/` copies. If the target copy is missing, create it. If it exists but differs, overwrite it.

### INDEX.md Domain Parsing

The INDEX.md Domain Map section uses a markdown table format (matching `index-template.md`):

```
## Domain Map

| Domain | Paths | Description |
|--------|-------|-------------|
| auth   | src/auth/** | Authentication and authorization |
| api    | src/api/**  | REST API endpoints |
```

The sanity module reuses the same table-parsing approach as `buildDomainMap()` in `mcp/server.js`: scan for `|`-delimited rows, find the header row with a "Domain" column, then extract domain names from subsequent data rows (skipping separator rows of `---`).

The extracted domain names are compared against `docs/codetographer/domains/*.md` filenames (stripping `.md`):
- Domains listed in INDEX.md but missing from disk → `fail` (need agent dispatch), added to `staleDomains`
- Domains on disk but not in INDEX.md → `warn` (orphaned docs)

## Integration Points

### Session-Start Hook (`src/hooks/session-start.ts`)

After the existing dep-check block (the `if (pluginData) { ... }` block ending with `child.unref()`), and before the `if (!context)` guard, insert a sanity check call:

```ts
import { runSanityCheck } from '../sanity.js';

// ... existing dep check logic (if (pluginData) { ... }) ...

// Sanity check — auto-fix silently, skip expensive ops (map regen)
const sanityReport = await runSanityCheck({
  projectDir,
  pluginRoot,
  pluginData: pluginData ?? '',
  fix: true,
  quiet: true,
});

// Build sanity warning/note to prepend to context
let sanityNote = '';
if (sanityReport.status === 'needs_attention') {
  const issues = sanityReport.checks
    .filter(c => c.status === 'fail')
    .map(c => `  - ${c.message}`);
  sanityNote = `⚠ Codetographer sanity issues:\n${issues.join('\n')}\nRun /sanity for details.\n\n`;
} else if (sanityReport.status === 'fixed') {
  const fixCount = sanityReport.checks.filter(c => c.status === 'fixed').length;
  sanityNote = `⚠ Codetographer sanity: fixed ${fixCount} issue(s). Run /sanity for details.\n\n`;
}

const context = loadContext(projectDir);

if (!context && !sanityNote) {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    additionalContext: sanityNote + (context ?? ''),
  },
};
```

The sanity check runs after dep install spawn (since dep install is detached/async and won't block). If `node_modules` are being installed, checks that need them are skipped gracefully.

**Timeout consideration:** The session-start hook has a 5s timeout. Map regeneration can take longer on large projects. The sanity module accepts an optional `skipExpensive: boolean` flag (default `false`). In session-start mode, pass `skipExpensive: true` to skip map regeneration — instead flag as `warn` ("map.md is stale — run /sanity to regenerate"). The `/sanity` skill runs with `skipExpensive: false` for the full pipeline.

### `/sanity` Skill (`skills/sanity/SKILL.md`)

The skill:

1. Runs `scripts/sanity.js --project-dir $CLAUDE_PROJECT_DIR --json` and parses the JSON report
2. Displays the full report as a formatted table:
   ```
   Codetographer Sanity Check
   ──────────────────────────
    PASS  docs/codetographer/ exists
    PASS  INDEX.md exists
    FIXED map.md regenerated (was 3h stale)
    PASS  changes.md exists
    PASS  CLAUDE.md has ## Codetographer section
    FIXED hookify rule commit-before-stop.local.md restored
    PASS  hookify rule use-codetographer-docs.local.md exists
    PASS  Environment variables set
    PASS  Dependencies installed
    PASS  Hook scripts present
    WARN  2 stale domains: auth, api → dispatching explorers...

   Status: fixed (11/12 passed, 2 fixed, 1 needs sync)
   ```
3. If `staleDomains` is non-empty, dispatches `domain-explorer` agents in parallel (reusing `agents/domain-explorer.md` spec)
4. After agents complete, re-runs the sanity check to confirm everything is green
5. Displays final status:
   ```
   Re-check after sync:
    PASS  All domain docs fresh

   Final status: healthy (12/12 passed)
   ```

### CLI Wrapper (`scripts/sanity.js`)

Thin entry point for manual debugging:

```
Usage: node scripts/sanity.js [options]

Options:
  --project-dir <path>   Target project root (default: CLAUDE_PROJECT_DIR or cwd)
  --plugin-root <path>   Plugin install dir (default: CLAUDE_PLUGIN_ROOT)
  --plugin-data <path>   Plugin data dir (default: CLAUDE_PLUGIN_DATA)
  --no-fix               Report only, don't attempt repairs
  --quiet                Only show non-pass checks in text output
  --skip-expensive       Skip map regeneration (used by session-start hook)
  --json                 Output as JSON (for skill consumption)
```

Without `--json`, outputs the human-readable formatted report to stdout. Exit codes: 0 = healthy/fixed, 1 = needs_attention.

## File Changes Summary

| File | Action |
|------|--------|
| `src/sanity.ts` | **New** — core sanity check module |
| `src/hooks/lib/recent-activity.ts` | **New** — extracted `updateRecentActivity()` shared by `stop.ts` and `sanity.ts` |
| `scripts/sanity.js` | **New** — CLI wrapper. Compiled from `src/sanity.ts` → `dist/sanity.js`, then copied and import-patched by `copy-hooks.js` (same pattern as `scripts/treesitter-map.js`) |
| `skills/sanity/SKILL.md` | **New** — `/sanity` skill definition |
| `src/hooks/session-start.ts` | **Modified** — add sanity check call after the `if (pluginData)` dep-check block |
| `src/hooks/stop.ts` | **Modified** — import `updateRecentActivity` from `./lib/recent-activity.js` instead of inline definition |
| `scripts/copy-hooks.js` | **Modified** — add copy+patch step for `dist/sanity.js` → `scripts/sanity.js`, mirroring the `treesitter-map.js` pattern |

## Testing

- Unit tests for each check function in `tests/sanity.test.ts` using `node:test`
- Test with a temp directory simulating various broken states (missing files, stale timestamps, wrong CLAUDE.md content)
- No mocks for filesystem — use real temp dirs with real files
- Map regeneration test can use a small fixture project

## Edge Cases

- **No INDEX.md (never initialized):** Session-start sanity check detects this and exits early (same as current behavior — not initialized). The `/sanity` skill reports `fail` for INDEX.md and suggests running `/codetographer` wizard.
- **Plugin data dir doesn't exist yet:** First run scenario. Skip dep-dependent checks, flag as warn.
- **Concurrent sanity + dep install:** Dep install is detached/async. Sanity check should not race with it. If `node_modules` don't exist yet, skip map regen and flag.
- **Session-start timeout:** Skip expensive operations (map regen) in session-start mode. Only the `/sanity` skill runs the full pipeline.
- **Hookify rule customized by user:** If a user intentionally modified a hookify rule, the sanity check would overwrite it. This is acceptable for dev mode — the templates are the source of truth. Users who customize should be aware that `/sanity` resets them.
- **Re-check after agent dispatch shows map as stale:** Domain-explorer agents write domain docs, which triggers `post-tool-use` hooks that append to `changes.md`. This makes `map.md` stale again. The re-check after agent dispatch is expected to show `map.md` as stale — the `/sanity` skill should run a final map regeneration after the re-check if needed, or accept this as expected and display the note.
- **`staleDomains` aggregation:** The `staleDomains` field on `SanityCheckResult` is populated by both Check 5 (domains in INDEX.md but missing from disk) and Check 10 (domains on disk but stale). The `/sanity` skill unions both lists before dispatching domain-explorer agents.
