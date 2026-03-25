# Codetographer — Codebase Navigation Plugin for Claude Code

**Date:** 2026-03-25
**Status:** Draft
**Project Root:** `F:/Tools/Projects/cc-plugins/codetographer/`

## Overview

Codetographer is a Claude Code plugin that transforms any codebase into an AI-navigable workspace through guided agentic exploration, tree-sitter structural mapping, and hook-powered auto-sync. It implements a three-tier context architecture (hot/warm/cold) backed by academic research, designed to eliminate blind codebase exploration and reduce token waste in multi-agent orchestration workflows.

### Problem Statement

AI coding agents — especially in parallel orchestration systems like ZeroShot, Claude Code subagents, and agent teams — waste significant tokens re-exploring codebases from scratch. Each agent starts cold, greps around to build understanding, and loads irrelevant files into context. This causes:
- Token waste (agents explore files outside their task scope)
- Context pollution (irrelevant code degrades reasoning quality)
- Redundant work (multiple agents discover the same architecture independently)
- Slower execution (exploration time before productive work begins)

### Solution

A plugin + skill + MCP server that:
1. **Maps** the codebase via deep agentic exploration and tree-sitter parsing
2. **Generates** a three-tier documentation structure (routing table → domain docs → structural map)
3. **Injects** the right context into every agent at spawn time via hooks
4. **Auto-syncs** documentation as code changes via hook-maintained breadcrumbs
5. **Provides** on-demand search via an MCP server for deep dives

### Research Foundation

Based on validated patterns from:
- **Codified Context Infrastructure** (arXiv 2602.20478) — three-tier hot/warm/cold memory model, tested on 283 sessions across a 108K-line codebase
- **Aider repo-map** — tree-sitter signature extraction with PageRank relevance ranking
- **Evaluating AGENTS.md** (arXiv 2602.11988) — generic overviews don't help; routing tables, failure modes, and specific commands do
- **Agent-MCP** — shared knowledge graph pattern for multi-agent context sharing
- **Google ADK production patterns** — hybrid injection + retrieval architecture

## Architecture

### Three-Tier Context Model

```
┌─────────────────────────────────────────────────────────┐
│                    TIER 1 (Hot)                          │
│  SessionStart → inject INDEX.md (<200 lines)            │
│  PostCompact  → re-inject INDEX.md                      │
│  Always in context. Routing table, not encyclopedia.    │
├─────────────────────────────────────────────────────────┤
│                    TIER 2 (Warm)                         │
│  SubagentStart → match task to domain → inject domain   │
│  doc into agent context before it runs a single token.  │
│  "You're in the API layer. Here's what matters..."      │
├─────────────────────────────────────────────────────────┤
│                    TIER 3 (Cold)                         │
│  MCP tools for on-demand deep dives:                    │
│  codetographer_search("auth middleware") → exact files   │
│  codetographer_domain("frontend") → domain context      │
│  Only loaded when agent explicitly needs it.            │
├─────────────────────────────────────────────────────────┤
│                    AUTO-SYNC                             │
│  PostToolUse (Write|Edit) → append to changes.md        │
│  Stop → async tree-sitter map regeneration              │
│  SubagentStop → append work summary to changes.md       │
└─────────────────────────────────────────────────────────┘
```

### Plugin Structure

```
codetographer/
├── .claude-plugin/
│   └── plugin.json                    ← name, version, description, author, mcpServers
│
├── skills/
│   └── codetographer/
│       ├── SKILL.md                   ← main wizard entry point (/codetographer)
│       └── references/
│           ├── wizard-flow.md         ← detailed wizard state machine
│           ├── domain-templates.md    ← templates for domain doc generation
│           └── index-template.md      ← template for INDEX.md generation
│
├── agents/
│   ├── domain-explorer.md             ← sub-agent: deep-dives a single domain
│   ├── structural-scanner.md          ← sub-agent: tree-sitter map generation
│   ├── domain-router.md               ← sub-agent: matches task → domain
│   └── sync-agent.md                  ← sub-agent: re-explores stale domains
│
├── hooks/
│   ├── hooks.json                     ← hook event registrations
│   ├── lib/
│   │   └── context-loader.js          ← shared: read INDEX.md + changes.md tail
│   ├── session-start.js               ← inject INDEX.md as additionalContext
│   ├── subagent-start.js              ← match task → domain → inject context
│   ├── post-tool-use.js               ← append file changes to changes.md
│   ├── post-compact.js                ← re-inject INDEX.md after compression
│   ├── stop.js                        ← async: regenerate tree-sitter map
│   └── subagent-stop.js               ← append work summary to changes.md
│
├── scripts/
│   ├── treesitter-map.js              ← tree-sitter signature extractor
│   ├── pagerank.js                    ← file relevance ranking
│   ├── install-deps.js                ← first-run dependency installer
│   └── queries/                       ← tree-sitter tag queries per language
│       ├── typescript/tags.scm
│       ├── javascript/tags.scm
│       ├── python/tags.scm
│       ├── go/tags.scm
│       ├── rust/tags.scm
│       ├── java/tags.scm
│       ├── c/tags.scm
│       ├── cpp/tags.scm
│       ├── ruby/tags.scm
│       ├── php/tags.scm
│       ├── swift/tags.scm
│       ├── kotlin/tags.scm
│       ├── csharp/tags.scm
│       ├── scala/tags.scm
│       ├── elixir/tags.scm
│       └── lua/tags.scm
│
├── mcp/
│   └── server.js                      ← MCP server for on-demand queries
│
├── package.json                       ← web-tree-sitter, grammar deps, better-sqlite3 (installed to CLAUDE_PLUGIN_DATA)
└── README.md
```

### Generated Files (in user's project)

```
<project-root>/
├── docs/
│   └── codetographer/
│       ├── INDEX.md              ← Tier 1: routing table (<200 lines)
│       ├── map.md                ← tree-sitter structural map
│       ├── changes.md            ← recent changes breadcrumb trail (gitignored)
│       ├── domains/
│       │   ├── <domain-1>.md     ← Tier 2: agent-curated domain docs
│       │   ├── <domain-2>.md
│       │   └── ...
│       └── .backup/              ← pre-install snapshots for undo (gitignored)
│           ├── CLAUDE.md.bak
│           ├── .gitignore.bak
│           └── manifest.json     ← tracks all modifications made
```

**Git strategy:**
- Committed: `INDEX.md`, `map.md`, `domains/*.md` (valuable for all collaborators)
- Gitignored: `changes.md` (session-specific), `.backup/` (per-machine install state)

## Wizard Flow

### Entry Point: `/codetographer`

Single slash command. Reads project state, routes to the appropriate mode.

```
/codetographer
     │
     ▼
  Read project state:
  - docs/codetographer/ exists?
  - INDEX.md present + fresh?
  - domains/ populated?
  - map.md age vs last commit?
     │
  ┌──┴──┐
  │     │
 NEW  EXISTS
  │     │
  ▼     ▼
WIZARD  DASHBOARD
```

### Wizard Mode (first-time setup)

**Step 1 — Framework Detection.**
Quick structural scan: glob for known patterns (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `*.sln`), check for framework indicators (`next.config.*`, `svelte.config.*`, `angular.json`, `manage.py`, `Gemfile`). Present findings to user for confirmation.

**Step 2 — Domain Discovery.**
Dispatch a fast Explore sub-agent to identify natural module boundaries: top-level directories, import clusters, entry points, clear separation of concerns. Present discovered domains to user via `AskUserQuestion`. User can rename, merge, split, or add domains.

**Step 3 — Parallel Deep-Dive.**
Dispatch one `domain-explorer` sub-agent per domain, all in parallel. Each agent:
- Reads every file in its domain
- Maps the dependency graph (what imports what)
- Identifies public interfaces, key patterns, and architectural decisions
- Notes known issues, gotchas, and non-obvious behavior
- Produces a structured domain doc

If a domain explorer agent fails (timeout, error, crash), log the failure and mark that domain as "unmapped" in INDEX.md. The wizard continues with successfully mapped domains and reports partial failures to the user, offering to retry failed domains individually.

Simultaneously, dispatch the `structural-scanner` agent to run the tree-sitter pipeline and generate `map.md`.

**Step 4 — Generate Files.**
Assemble INDEX.md from the domain summaries (routing table format), write domain docs, write map.md. All written to `docs/codetographer/`.

**Step 5 — Install.**
Full auto-install with backup:
1. Snapshot current state to `docs/codetographer/.backup/` (backs up CLAUDE.md and .gitignore)
2. Add `@docs/codetographer/INDEX.md` as a line in CLAUDE.md (the `@` prefix is Claude Code's import syntax — it loads the referenced file into context automatically, up to 5 levels deep). If no CLAUDE.md exists, create a minimal one with the project name and the import line.
3. Hooks are auto-active via plugin's `hooks/hooks.json` — no manual hook installation needed
4. MCP server is auto-registered via plugin's `plugin.json` `mcpServers` field — no manual config needed
5. Add ephemeral files to `.gitignore` (`docs/codetographer/changes.md`, `docs/codetographer/.backup/`)
6. Write `manifest.json` tracking every modification

**Step 6 — Verify.**
Read back INDEX.md, confirm hooks are firing, test MCP server responds. Print summary with domain count, symbol count, and hook status.

### Dashboard Mode (already set up)

Presented via `AskUserQuestion` (text prompt with numbered options — `AskUserQuestion` does not support multi-select widgets, so present as a numbered list and parse the user's text response):
- **1. Re-sync all** — re-run domain explorers + tree-sitter for stale domains
- **2. Re-explore (fresh)** — wipe and regenerate from scratch (keeps backup)
- **3. Sync specific domain** — pick which domain to refresh
- **4. Staleness report** — compare domain doc timestamps vs `git log` for those files
- **5. Uninstall** — remove generated `docs/codetographer/` directory, restore CLAUDE.md and .gitignore from `.backup/`, remove the `@import` line. Hooks become no-ops automatically (they exit silently when `docs/codetographer/` doesn't exist). MCP server is managed by the plugin system and deactivates when the plugin is uninstalled.

## Document Formats

### INDEX.md — Tier 1 Routing Table

Always loaded. Under 200 lines. Not an encyclopedia — a decision-routing table.

```markdown
# Codetographer Index
<!-- Auto-generated by Codetographer. Last sync: 2026-03-25T14:30:00Z -->
<!-- DO NOT EDIT MANUALLY — run /codetographer to re-sync -->

## Project
- **Type:** SvelteKit 2 + Bun backend
- **Language:** TypeScript (strict)
- **Entry:** src/index.ts (daemon), ui/src/routes/ (frontend)

## Commands
- Build: `bun run build:ui`
- Test: `bun test`
- Dev: `bun run dev:web`

## Domain Map
| Domain | Path(s) | Doc | Description |
|--------|---------|-----|-------------|
| daemon | src/commands/, src/runner.ts | @docs/codetographer/domains/daemon.md | Lifecycle, scheduling |
| frontend | ui/ | @docs/codetographer/domains/frontend.md | SvelteKit, Svelte 5 |

## Routing Rules
When working in a domain, load its doc BEFORE exploring code:
- Touching `ui/**` → read domains/frontend.md first
- Touching `src/commands/**` → read domains/daemon.md first
- Unsure → read this INDEX.md's Domain Map, then the relevant domain doc

## Trusted Files
These files are always authoritative — trust them over exploration:
- CLAUDE.md — coding conventions, runtime rules
- docs/codetographer/INDEX.md — this file (domain routing)
- docs/codetographer/map.md — structural map (auto-generated)
- docs/codetographer/changes.md — recent changes (auto-generated)

## Recent Activity (last 5)
<!-- Auto-updated by hooks -->
- 2026-03-25 14:28 — edited src/runner.ts (daemon domain)
```

### Domain Docs — Tier 2

Each domain doc follows a consistent structure. Generated by the `domain-explorer` agent.

```markdown
# Domain: <Name>
<!-- Codetographer domain doc. Last sync: 2026-03-25T14:30:00Z -->
<!-- Covers: <path patterns> -->

## Purpose
What this domain does and why it exists. 2-3 sentences max.

## Architecture
How the pieces fit together. Key patterns, data flow, component hierarchy.
NOT a file listing — the structural relationships and "why" behind them.

## Key Files
| File | Role | Notes |
|------|------|-------|
| path/to/file.ts | Brief role | Important context |

## Patterns & Conventions
Domain-specific coding patterns, framework conventions, style rules.

## Dependencies
What this domain imports from other domains or external packages.

## Gotchas
Things that will bite you if you don't know them. Specific failure modes,
not generic advice. This is the highest-value section.

## Recent Changes
<!-- Last 3 changes in this domain, populated by the stop.js hook
     which reads domain-scoped entries from changes.md and writes
     them here during map regeneration -->
```

### map.md — Tier 3 Structural Map

Tree-sitter generated. Aider-style format with PageRank ordering.

```markdown
# Codetographer Structural Map
<!-- Auto-generated by tree-sitter. Last sync: 2026-03-25T14:30:00Z -->
<!-- 847 symbols across 63 files. Top 40 by PageRank. -->

src/runner.ts:
⋮...
│export interface RunnerOptions {
│    model: string
│    sessionId?: string
⋮...
│export async function runStreaming(
│    options: RunnerOptions,
│    onEvent?: (event: StreamEvent) => void
│): Promise<RunResult>
⋮...
```

Token budget: configurable, default 5000 tokens. Files ordered by PageRank score descending. Only definition signatures shown, no implementation bodies.

### changes.md — Auto-Sync Breadcrumbs

```markdown
<!-- domain-touched: artificers=2026-03-25T14:28:00Z,frontend=2026-03-25T13:15:00Z -->
# Recent Changes

2026-03-25 14:35 | Agent | Refactored WebSocket reconnect logic | frontend
2026-03-25 14:28 | Edit | src/artificers/manager.ts | artificers
2026-03-25 14:15 | Write | src/artificers/cron.ts | artificers
```

Rolling window: capped at 200 lines, oldest entries trimmed automatically. Hidden metadata line at top tracks per-domain last-touch timestamps for staleness calculations.

## Hook Architecture

Six hooks, each with a single responsibility. All scripts are pre-compiled JS.

### Hook Registry (`hooks/hooks.json`)

**Note:** All hooks use `"async": true` to prevent hard hangs on Windows during event loop initialization. This is safe on all platforms — async hooks run in the background and cannot block, which is acceptable since none of these hooks need to block operations (they only inject context or log changes).

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup|resume",
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js",
        "timeout": 5,
        "async": true
      }]
    }],
    "SubagentStart": [{
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.js",
        "timeout": 5,
        "async": true
      }]
    }],
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js",
        "timeout": 5,
        "async": true
      }]
    }],
    "PostCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-compact.js",
        "timeout": 5,
        "async": true
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.js",
        "timeout": 60,
        "async": true
      }]
    }],
    "SubagentStop": [{
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.js",
        "timeout": 5,
        "async": true
      }]
    }]
  }
}
```

**Matcher notes:**
- `SessionStart` uses `"startup|resume"` to avoid double-firing on `compact` events (PostCompact has its own hook)
- `PostToolUse` uses `"Write|Edit"` — `MultiEdit` is not a confirmed Claude Code tool name

### Hook 1: `session-start.js`

**Event:** SessionStart (matcher: `startup|resume` — excludes `compact` which has its own hook)
**Async:** Yes (Windows safety)
**Purpose:** Inject INDEX.md + recent changes tail as `additionalContext`

Reads `docs/codetographer/INDEX.md` and last 10 lines of `changes.md`. Outputs combined content as `hookSpecificOutput.additionalContext`. If `docs/codetographer/` doesn't exist, exits silently (plugin installed but not initialized).

Shares `loadContext()` implementation with `post-compact.js` via `lib/context-loader.js`.

### Hook 2: `subagent-start.js`

**Event:** SubagentStart
**Async:** Yes (Windows safety)
**Purpose:** Match agent task to domain, inject domain doc

**Accessing the agent's task:** The SubagentStart hook receives `agent_type` in its stdin payload but NOT the agent's task prompt directly. To extract the task context, the hook reads the `transcript_path` JSONL file (provided in stdin) and scans the last few entries for the Agent tool call that spawned this subagent — the `prompt` field in that tool call contains the task description. If the transcript is unavailable or the tool call can't be found, the hook falls back to injecting just INDEX.md.

Routing logic:
1. Read the spawning Agent tool call's `prompt` from transcript
2. Read INDEX.md routing rules
3. Extract file paths from the task prompt (regex: `/(?:src|ui|lib|app|pages|components)\/[\w\/.-]+/g`)
4. Match paths against domain map → load matching domain doc
5. If no path match, scan for domain-specific keywords (configured per-domain in INDEX.md metadata)
6. If multi-domain match, inject condensed summary (Purpose + Architecture sections only)
7. If no match at all, inject just INDEX.md as fallback

Configurable skip list for agent types that shouldn't get injection (e.g., `grader`, `comparator`). Only scans first 2000 chars of the task prompt.

### Hook 3: `post-tool-use.js`

**Event:** PostToolUse (matcher: `Write|Edit`)
**Async:** Yes (Windows safety)
**Purpose:** Append file change breadcrumb to changes.md

Extracts `tool_input.file_path`, matches to domain via path patterns, appends one-line entry to `changes.md`. Updates hidden `domain-touched` metadata line. Trims oldest entries when file exceeds 200 lines.

### Hook 4: `post-compact.js`

**Event:** PostCompact
**Async:** Yes (Windows safety)
**Purpose:** Re-inject INDEX.md after context compression

Same logic as `session-start.js` — calls shared `loadContext()` function.

### Hook 5: `stop.js` (async)

**Event:** Stop
**Async:** Yes
**Purpose:** Incremental tree-sitter map regeneration

Checks if any files changed since last map generation (via changes.md entries vs last sync timestamp). If no changes, skips. Otherwise:
1. Re-parse only changed files + their importers (not full repo)
2. Rebuild PageRank graph (full graph, but with cached tags for unchanged files)
3. Write map.md atomically (write to `.map.md.tmp`, then rename)
4. Update INDEX.md "Recent Activity" section from changes.md tail (also written atomically via temp file)
5. Update domain doc "Recent Changes" sections by reading domain-scoped entries from changes.md

**Timeout handling:** The stop hook has a 60-second timeout. If the tree-sitter pipeline exceeds this, the process is killed. Because map.md is written atomically (temp file → rename, with Windows EPERM handling — see Cross-Platform Compatibility §Atomic File Writes), a timeout cannot produce a corrupt map — either the new map replaces the old one completely, or the old map remains untouched. The same applies to INDEX.md. On next stop, the hook retries with whatever files have changed since.

Tag cache: SQLite at `${CLAUDE_PLUGIN_DATA}/treesitter-cache/tags.db`, keyed by file path + mtime.

### Hook 6: `subagent-stop.js`

**Event:** SubagentStop
**Async:** Yes (Windows safety)
**Purpose:** Append agent work summary to changes.md

Extracts first sentence (or first 150 chars) of `last_assistant_message`. Appends one-line entry to changes.md with agent type and inferred domain. Same 200-line cap.

## MCP Server

### Tools

Tool names use the full `codetographer_` prefix for consistency with the plugin name.

```
codetographer_search(query: string, limit?: number)
  → Matching symbols + file paths + line numbers from tree-sitter index
  → Ranked: exact name match > partial name > file path > doc content
  → Includes domain attribution and suggested reading pointers

codetographer_domain(domain: string, section?: string)
  → Full domain doc content, or a specific section
  → Sections: purpose, architecture, key-files, patterns, dependencies, gotchas

codetographer_status()
  → Staleness report: per-domain last sync vs last change
  → map.md age, total symbols indexed
  → changes.md last-modified timestamp as proxy for hook activity
```

### Implementation

Read-only query interface. Reads:
- `docs/codetographer/map.md` → parsed into in-memory symbol index on startup
- `docs/codetographer/domains/*.md` → loaded for domain queries
- `docs/codetographer/changes.md` → read for staleness calculations
- `${CLAUDE_PLUGIN_DATA}/treesitter-cache/` → raw tag database for search

Watches map.md for changes (regenerated by stop hook) and re-indexes automatically.

**Registration:** The MCP server is declared in `plugin.json` (not in the user's `.claude/settings.json`), so it auto-activates when the plugin is loaded and deactivates when the plugin is uninstalled — no manual config required:

```json
{
  "name": "codetographer",
  "version": "1.0.0",
  "description": "Codebase navigation via three-tier context architecture",
  "author": { "name": "Sakib" },
  "mcpServers": {
    "codetographer": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

The MCP server resolves `CODETOGRAPHER_ROOT` at startup by reading `CLAUDE_PROJECT_DIR` from the environment (set by Claude Code for all hooks and MCP processes) and joining with `docs/codetographer`. This produces an absolute path regardless of the server's working directory.

## Tree-Sitter Pipeline

### Five-Stage Process

**Stage 1 — File Discovery:**
Walk project using glob patterns, respect `.gitignore` + `.codetographignore` (if present in project root — same syntax as `.gitignore`, parsed by `treesitter-map.js`). Detect language per file via extension mapping. Skip binaries, `node_modules/`, `dist/`, `.git/`, lockfiles, images.

**Stage 2 — Tag Extraction:**
Use `web-tree-sitter` (WASM-based, works in Bun/Node). Load language-specific `tags.scm` query files. Extract two tag types: `definition` (function, class, method, type, interface, const) and `reference` (identifiers used/called/imported).

Tag structure:
```
{
  file: string,       // relative path
  name: string,       // identifier
  line: number,       // line number
  kind: "def" | "ref",
  signature?: string, // full signature line for defs
  scope?: string      // parent class/module name
}
```

**Stage 3 — Cache:**
SQLite-backed at `${CLAUDE_PLUGIN_DATA}/treesitter-cache/tags.db`. Key: file path. Value: tags array + file mtime. Incremental runs only re-parse files with changed mtime.

**Stage 4 — PageRank:**
Directed graph: nodes = files, edges = reference relationships (B references def in A → edge B→A, weight 1.0). Self-loops at weight 0.1 for defs with no references. Personalization weights: recently-touched files (from changes.md) get 10x, everything else 1x. The MCP `codetographer_search` tool applies additional per-query personalization at search time (100x for files matching the query's domain), but the stop-hook map generation uses only the recency weights since there is no "current domain" at stop time. Lightweight JS implementation (~50 lines iterative matrix math).

**Stage 5 — Token-Budgeted Output:**
Sort files by PageRank descending. Render definition tags in structural context using scope markers (`│`) and omission markers (`⋮...`). Stop when token budget reached (default 5000, configurable). Write atomically.

### Language Support

| Tier | Languages | Coverage |
|------|-----------|----------|
| Full (def + ref) | TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP | Signatures + reference graph + PageRank |
| Partial (def only) | Swift, Kotlin, C#, Scala, Elixir, Lua | Signatures, no PageRank edges |
| Fallback | Everything else | File-level only (name + path, no signatures) |

Extensible: drop a `tags.scm` into `scripts/queries/<lang>/` and the pipeline picks it up.

### Improvements Over Aider

1. **Incremental** — only re-parses changed files (tracked via changes.md), not full repo
2. **Recency-personalized** — recently-touched files rank higher via changes.md integration
3. **Domain-aware** — can generate per-domain maps on request
4. **No Python dependency** — pure JavaScript (Node.js), runs anywhere Claude Code runs
5. **Hard token cap** — configurable budget with strict enforcement (Aider's is soft and overflows)

## Auto-Install & Undo System

### Backup Manifest (`docs/codetographer/.backup/manifest.json`)

Tracks every modification with type, path, backup location, and undo action:
- `file_created` → `delete_on_uninstall`
- `file_modified` → `restore_on_uninstall` (original backed up to `.backup/`)

### Install Sequence

1. Create `docs/codetographer/.backup/`
2. Snapshot files about to be modified (CLAUDE.md, .gitignore) to `.backup/`
3. Run `install-deps.js` to install tree-sitter dependencies to `${CLAUDE_PLUGIN_DATA}`
4. Generate codetographer files (domain docs, INDEX.md, map.md, changes.md)
5. Add `@docs/codetographer/INDEX.md` line to CLAUDE.md (or create minimal CLAUDE.md)
6. Add ephemeral paths to .gitignore (`docs/codetographer/changes.md`, `docs/codetographer/.backup/`)
7. Write `manifest.json` recording every modification
8. Verify: read back INDEX.md, confirm MCP server responds to `codetographer_status()`

### Uninstall Sequence

1. Read `manifest.json`
2. Process each modification in reverse order (restore CLAUDE.md and .gitignore from backups, delete created files)
3. Confirm with user before deleting `docs/codetographer/` via `AskUserQuestion`
4. Delete `docs/codetographer/` entirely (hooks become no-ops automatically, MCP server deactivates with plugin)
5. Report completion

### Edge Cases

- **CLAUDE.md modified after install** — uninstall removes only the `@import` line, keeps user's other changes
- **User deleted a domain doc** — manifest says created, but already gone — skip silently
- **Project moved directories** — manifest uses relative paths, works if `docs/codetographer/` exists relative to root

### Re-sync vs Re-explore

| Re-sync (incremental) | Re-explore (fresh) |
|---|---|
| Check domain staleness | Wipe domains/ and map.md |
| Re-explore only stale domains | Re-run full wizard steps 1-4 |
| Re-parse only changed files for map.md | Regenerate everything |
| Update INDEX.md recent activity | Update manifest |
| Use when: routine refresh | Use when: project restructured |

## Dependencies

### Plugin Runtime Dependencies (installed to `${CLAUDE_PLUGIN_DATA}`)

- `web-tree-sitter` — WASM-based tree-sitter runtime
- `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `tree-sitter-c`, `tree-sitter-cpp`, `tree-sitter-ruby`, `tree-sitter-php`, `tree-sitter-swift`, `tree-sitter-kotlin`, `tree-sitter-c-sharp`, `tree-sitter-scala`, `tree-sitter-elixir`, `tree-sitter-lua` — grammar packages
- `better-sqlite3` — tag cache (chosen over `bun:sqlite` because hooks run via `node`, not `bun`)

Total install size: ~15MB. One-time cost, installed by the wizard during Step 5 (Install). The wizard runs `install-deps.js` which copies `package.json` to `${CLAUDE_PLUGIN_DATA}` and runs `npm install --production`. Subsequent sessions check freshness: `session-start.js` runs a fast `diff` of `${CLAUDE_PLUGIN_ROOT}/package.json` vs `${CLAUDE_PLUGIN_DATA}/package.json`. If they match, skip (< 50ms). If they differ, spawn the install as a detached background process (see Cross-Platform Compatibility §Background Process Spawning for the cross-platform spawn pattern) — it runs outside the hook's 5s timeout and completes before the next stop hook needs the tree-sitter binaries.

### Plugin Build Dependencies

- Node.js or Bun — for pre-compiling TS to JS
- No user-facing build step — all scripts ship as compiled `.js`

## Configuration

### `.codetographignore` (optional, project root)

Same syntax as `.gitignore`. Excludes paths from tree-sitter scanning:
```
vendor/
generated/
*.min.js
```

### Plugin Settings (future: `${CLAUDE_PLUGIN_DATA}/config.json`)

```json
{
  "tokenBudget": 5000,
  "maxDomains": 20,
  "changesMaxLines": 200,
  "indexMaxLines": 200,
  "skipAgentTypes": ["grader", "comparator"],
  "mapRefreshStrategy": "incremental"
}
```

## Cross-Platform Compatibility

**Target platforms:** Windows 10/11 and Linux (macOS works because it's Unix-like). WSL is NOT a target — the plugin runs natively on whichever OS Claude Code is running on.

### Path Handling

All file path operations MUST use `path.join()` and `path.resolve()` from Node.js `path` module. Never construct paths with string concatenation or hardcoded separators.

| Concern | Solution |
|---------|----------|
| Path separators (`\` vs `/`) | Use `path.join()` everywhere. Never hardcode `/` or `\\` in path construction. |
| `${CLAUDE_PLUGIN_ROOT}` separator style | Claude Code provides this in the OS-native format. Hook scripts receive it correctly on both platforms. |
| `${CLAUDE_PROJECT_DIR}` | Same — OS-native format. The MCP server uses this to resolve absolute paths. |
| Paths in generated docs | Always use forward slashes (`/`) in INDEX.md, domain docs, and map.md — these are for human and agent readability, not OS path resolution. |
| `.codetographignore` patterns | Use forward slashes only (same convention as `.gitignore`). The glob library normalizes internally. |
| Transcript path (SubagentStart hook) | Received from Claude Code in OS-native format. Use `path.resolve()` before reading. |
| Domain routing path matching | Normalize both the routing rules and the incoming `tool_input.file_path` to forward slashes before comparison. |

### Atomic File Writes

On Windows, `fs.rename()` fails if the target file already exists (EPERM). The atomic write pattern must account for this:

```javascript
// Cross-platform atomic write
const tempPath = targetPath + '.tmp';
await fs.writeFile(tempPath, content, 'utf-8');
try {
  await fs.rename(tempPath, targetPath);
} catch (err) {
  if (err.code === 'EPERM' || err.code === 'EEXIST') {
    // Windows: unlink target first, then rename
    await fs.unlink(targetPath);
    await fs.rename(tempPath, targetPath);
  } else {
    throw err;
  }
}
```

This applies to: `map.md`, `INDEX.md` (stop hook), and any future atomically-written files.

### SQLite (better-sqlite3)

`better-sqlite3` requires native compilation via `node-gyp`. This works on both platforms but has prerequisites:
- **Windows:** Requires "Desktop development with C++" workload from Visual Studio Build Tools (most Node.js dev machines have this). If missing, `npm install` will fail with a clear error.
- **Linux:** Requires `build-essential` and `python3` (standard on most distros).

The `install-deps.js` script should detect compilation failure and output a clear diagnostic message pointing to the platform-specific prerequisite.

**Fallback consideration:** If `better-sqlite3` installation fails, the tree-sitter cache falls back to a JSON file-based cache (`${CLAUDE_PLUGIN_DATA}/treesitter-cache/tags.json`). Slower for large repos but zero native dependencies. The fallback is automatic — `treesitter-map.js` checks for `better-sqlite3` availability at import time.

### Background Process Spawning

The dependency re-install in `session-start.js` spawns a background process. This must work on both platforms:

```javascript
// Cross-platform detached spawn
const { spawn } = require('child_process');
const child = spawn('node', [scriptPath], {
  detached: true,
  stdio: 'ignore',
  cwd: pluginDataDir
});
child.unref(); // Allow parent to exit without waiting
```

Do NOT use shell `&` syntax — Claude Code uses bash on Windows but hook scripts run via `node` directly, not through a shell.

### File Watching (MCP Server)

The MCP server watches `map.md` for changes. `fs.watch()` behavior differs between platforms:
- **Linux:** Uses `inotify`. Reliable for single files. May fire duplicate events.
- **Windows:** Uses `ReadDirectoryChangesW`. Reliable but may report the directory instead of the file.

Use a debounced watcher pattern: on any change event, wait 500ms before re-indexing. This handles duplicate events on both platforms.

### Line Endings

All generated files (INDEX.md, domain docs, map.md, changes.md) MUST use LF (`\n`) line endings regardless of platform. This ensures:
- Consistent `git diff` output (no CRLF noise)
- Files are identical across platforms when committed to git
- Token counting is consistent (CRLF adds extra characters)

The hook scripts and treesitter-map.js should write with explicit `\n` joins, never rely on `os.EOL`.

### npm vs Platform Package Managers

The `install-deps.js` script uses `npm install --production`. npm is guaranteed to be available wherever Node.js is installed, on both platforms. Do NOT use `bun install` or `yarn` — we cannot assume these are available.

## Success Criteria

1. **First-time setup completes in under 10 minutes** for a 200-file project
2. **INDEX.md stays under 200 lines** regardless of project size
3. **Every new session and subagent** starts with contextual routing (verified by hook output)
4. **map.md regeneration is incremental** — only changed files re-parsed
5. **Uninstall fully restores** the project to pre-install state
6. **Re-sync updates only stale domains** — no redundant exploration
7. **MCP search returns relevant results** within 200ms
8. **Tree-sitter supports 16 languages** at launch (10 full, 6 partial) with extensible query system
