# Phase 2: Core Sanity Module

> Load skill: `superpowers:test-driven-development`

## Gotchas
- `generateMap()` is async and can be slow on large projects — it's gated behind the `skipExpensive` flag
- `changes.md` creation (Check 4) gives the file a fresh mtime — Check 9 must detect this and skip map regen to avoid a false positive. Track whether Check 4 just created the file using an internal flag.
- The Domain Map in INDEX.md uses a **markdown table** format (`| Domain | Paths | Description |`), not headings. Parse with the same `|`-split approach as `domain-matcher.ts` and `mcp/server.js`.
- Hookify templates: prefer reading from `CLAUDE_PLUGIN_ROOT/.claude/`, but fall back to hardcoded strings if the template files don't exist (dev environments).
- The `quiet` option is a rendering hint only — it does NOT filter the `checks[]` array. All checks are always present in the report.
- Report status: `healthy` = all pass. `fixed` = some fixed, no fail (warns OK). `needs_attention` = at least one fail.
- `staleDomains` is aggregated across Check 5 (missing domains) and Check 10 (stale domains).

## Files
```
src/
├── sanity.ts            # CREATE — core module with runSanityCheck()
└── types.ts             # unchanged (existing types)
tests/
└── sanity.test.ts       # CREATE — unit tests
```

---

## Task 1: Define interfaces and implement `runSanityCheck` orchestrator

**Description:** Create `src/sanity.ts` with the exported interfaces (`SanityOptions`, `SanityCheckResult`, `SanityReport`) and the `runSanityCheck()` function that orchestrates all checks in order and builds the report.

**Acceptance criteria:**
- Exports `SanityOptions`, `SanityCheckResult`, `SanityReport` interfaces matching the spec
- `SanityOptions` includes: `projectDir`, `pluginRoot`, `pluginData`, `fix`, `quiet`, `skipExpensive`
- `runSanityCheck()` is async, runs checks in order (plugin runtime → target project → staleness), builds and returns `SanityReport`
- Report status logic: `healthy` if all pass; `fixed` if any fixed + no fail; `needs_attention` if any fail
- Summary string: `"healthy (N/N passed)"`, `"fixed (N/N passed, M fixed)"`, `"needs attention (N/N passed, M failed)"`
- Each check is a separate private function for testability

**Files:**
- `src/sanity.ts` — CREATE

**Architecture notes:**

Imports needed:
```ts
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { generateMap } from './map-generator.js';
import { atomicWrite } from './atomic-write.js';
import { updateRecentActivity } from './hooks/lib/recent-activity.js';
```

Check execution order:
1. Env var checks (12-14) — warn-only, no deps
2. Node modules + package.json (15-16) — may spawn install-deps.js
3. Hook scripts exist (17) — fail if missing
4. docs/codetographer/ dir (1) — create if missing
5. INDEX.md exists (2) — fail if missing, short-circuit remaining target checks
6. changes.md exists (4) — create if missing, track if just created
7. map.md exists (3) — regen if missing and not skipExpensive
8. CLAUDE.md section (6) — append if missing
9. Hookify rules (7-8) — copy/create if missing
10. Domain doc alignment (5) — parse INDEX.md table, compare disk
11. map.md staleness (9) — skip if changes.md was just created or skipExpensive
12. Domain staleness (10) — mtime comparison
13. INDEX.md Recent Activity (11) — rebuild from changes.md

**Validation:** `npm run build` succeeds

---

## Task 2: Implement all 17 check functions

**Description:** Implement each of the 17 checks as private functions within `src/sanity.ts`. Each returns a `SanityCheckResult`. When `fix: true`, the check attempts repair before reporting.

**Acceptance criteria:**
- Each check function takes relevant options and returns `SanityCheckResult`
- Fix logic matches the spec exactly (see check catalog in design doc)
- Domain parsing uses table-based approach: scan for `|`-delimited rows, find "Domain" header, extract domain names from data rows
- Hookify rule restoration: read template from `pluginRoot/.claude/<filename>`, fall back to hardcoded content constants
- `changes.md` creation sets an internal flag so map staleness check skips regen
- Map regeneration calls `generateMap({ projectRoot, dataDir, tokenBudget: 5000, changesPath })` + `atomicWrite`
- Recent Activity rebuild calls `updateRecentActivity(indexPath, last5entries)`
- Dep install spawns `install-deps.js` detached with `child.unref()` (same pattern as session-start.ts)

**Files:**
- `src/sanity.ts` — MODIFY (add check implementations)

**Architecture notes:**

Hardcoded hookify rule content (fallback when template files missing):

`commit-before-stop` template:
```
---
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
- If you made significant changes across multiple domains, mention them in the commit message — it helps the sync agent prioritize
```

`use-codetographer-docs` template:
```
---
name: use-codetographer-docs
enabled: true
event: prompt
pattern: .*
action: warn
---

**This project has codetographer documentation — use it.**

Before exploring the codebase from scratch, check what's already mapped:

- `docs/codetographer/INDEX.md` — routing table mapping files to domains, key commands, and architecture overview
- `docs/codetographer/domains/*.md` — deep-dive docs per domain (architecture, key files, patterns, gotchas)
- `docs/codetographer/map.md` — tree-sitter structural map with ranked function/class signatures

Use the MCP tools for on-demand lookups:
- `codetographer_search(query)` — find symbols by name across the codebase
- `codetographer_domain(name)` — read a specific domain doc
- `codetographer_status()` — check map freshness and domain staleness

These docs are kept in sync automatically. Trust them before grepping around blindly.
```

CLAUDE.md section to append (when `## Codetographer` not found):
```
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

Domain parsing approach (reuse pattern from `domain-matcher.ts` `parseRoutingRules`):
- Scan INDEX.md for `## Domain Map` section
- Within that section, find `|`-delimited table rows
- Header row: find column index where cell matches `/domain/i`
- Data rows: extract domain name from that column index
- Skip separator rows (`/^[-:]+$/`)
- Stop at blank line or next `## ` heading

**Validation:** `npm run build` succeeds

---

## Task 3: Write unit tests

**Description:** Create `tests/sanity.test.ts` with tests for the sanity check module. Use temp directories with real files to simulate various broken states.

**Acceptance criteria:**
- Tests use `node:test` and `node:assert/strict`
- Import `runSanityCheck` from `../src/sanity.js`
- Each test creates a temp dir (via `mkdtempSync`) and populates it with the needed file structure
- Tests clean up temp dirs in a finally block
- Cover at minimum:
  - All checks pass (healthy project)
  - Missing `docs/codetographer/` dir → auto-created
  - Missing `changes.md` → auto-created with metadata header
  - Missing `CLAUDE.md` section → appended
  - Missing hookify rules → restored
  - Missing INDEX.md → reported as fail
  - Stale map.md (changes.md newer) → flagged (or regenerated if not skipExpensive)
  - Domain in INDEX.md but no doc on disk → reported as fail with staleDomains
  - Domain on disk but not in INDEX.md → reported as warn
  - `skipExpensive: true` skips map regeneration
  - Report status logic: healthy vs fixed vs needs_attention

**Files:**
- `tests/sanity.test.ts` — CREATE

**Architecture notes:**

Test helper pattern:
```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), 'sanity-test-'));
}
```

For domain parsing tests, create a minimal INDEX.md with a Domain Map table:
```markdown
## Domain Map

| Domain | Paths | Description |
|--------|-------|-------------|
| auth   | src/auth/** | Authentication |
| api    | src/api/**  | API endpoints |
```

For map regeneration tests, note that `generateMap()` requires tree-sitter WASM files and grammars. Tests for map regen should either:
- Skip if deps not available (check `existsSync` for node_modules)
- Or test the staleness detection logic without actually calling generateMap (test the check function's logic with `skipExpensive: true`)

**Test descriptions:**

| Test | Behavior to verify |
|------|-------------------|
| `healthy project returns healthy status` | All files present, correct content → status is `healthy`, all checks `pass` |
| `missing docs dir is auto-created` | No `docs/codetographer/` → status `fixed`, dir created on disk |
| `missing changes.md is auto-created` | No changes.md → created with `<!-- domain-touched: -->` header |
| `missing CLAUDE.md section is appended` | CLAUDE.md exists without `## Codetographer` → section appended, original content preserved |
| `CLAUDE.md created if not exists` | No CLAUDE.md → created with only the codetographer section |
| `existing CLAUDE.md section is not duplicated` | CLAUDE.md already has `## Codetographer` → check passes, file unchanged |
| `missing hookify rules are restored` | No `.claude/` hookify files → created from hardcoded templates |
| `missing INDEX.md reported as fail` | No INDEX.md → check status `fail`, overall `needs_attention` |
| `stale domain detected` | changes.md newer than domain doc → `staleDomains` populated |
| `missing domain detected` | Domain in INDEX.md table, no file on disk → `staleDomains` populated |
| `orphaned domain doc warned` | Domain file on disk, not in INDEX.md table → status `warn` |
| `skipExpensive skips map regen` | map.md missing + skipExpensive → status `warn` not `fixed` |
| `report status: fixed + warn = fixed` | Some fixed, some warn, no fail → overall `fixed` |
| `report status: any fail = needs_attention` | At least one fail → overall `needs_attention` |
| `fix: false reports without modifying` | `fix: false` → no files created or modified, issues reported as warn/fail |

**Validation:**
```bash
npm test
```
All tests pass (including existing tests).

---

## Phase Gate
```bash
npm run build && npm test
```
Build succeeds, all tests pass. The `dist/sanity.js` file is produced by tsc.
