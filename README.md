# Codetographer

A Claude Code plugin that maps any codebase via tree-sitter + agentic exploration, generates a three-tier documentation structure, and auto-syncs via hooks. Eliminates blind codebase re-exploration and reduces token waste in multi-agent workflows.

## What It Does

Codetographer creates three layers of documentation in `docs/codetographer/`:

- **INDEX.md** — routing table injected at every session start (< 200 lines). Maps files to domains so AI agents know where to look before reading a single line of code.
- **domains/\*.md** — deep-dive docs per domain (API, auth, models, etc.) injected into subagents matching their task.
- **map.md** — tree-sitter structural map with PageRank-ranked function/class signatures, auto-regenerated when sessions end.

## Installation

```bash
# Via Claude Code plugin manager
claude plugin install codetographer

# Or directly
claude --plugin-dir ./codetographer
```

## Usage

Run the wizard in any project:

```
/codetographer
```

The wizard will:
1. Detect your project's framework and language
2. Discover domain boundaries (confirm or adjust)
3. Dispatch parallel AI agents to deeply explore each domain
4. Generate the full documentation structure
5. Set up auto-sync hooks

## Generated Structure

```
docs/codetographer/
├── INDEX.md          ← injected at every session start
├── map.md            ← tree-sitter structural map (auto-updated)
├── changes.md        ← hook-maintained change log
└── domains/
    ├── api.md
    ├── auth.md
    └── models.md
```

## Auto-Sync Hooks

Codetographer installs 6 hooks that run automatically:

| Hook | Event | What it does |
|------|-------|-------------|
| session-start | Session startup | Injects INDEX.md into context |
| subagent-start | Agent spawn | Injects relevant domain doc |
| post-tool-use | File write/edit | Logs file changes |
| post-compact | Context compaction | Re-injects INDEX.md |
| stop | Session end | Regenerates map.md if changed |
| subagent-stop | Agent completes | Logs agent result summary |

## MCP Tools

The codetographer MCP server provides 3 tools:

- `codetographer_search(query, limit?)` — Search function/class names across the codebase
- `codetographer_domain(domain, section?)` — Read domain documentation
- `codetographer_status()` — Check sync status and map age

## Dashboard

Run `/codetographer` in a project that's already set up to access the dashboard:
- Sync a domain (re-explore and update)
- Add a new domain
- Force-refresh the tree-sitter map
- View status

## Uninstall

From the dashboard, select "Uninstall", or:

```bash
rm -rf docs/codetographer/
claude plugin remove codetographer
```

## Cross-Platform

Codetographer runs on Windows and Linux. All generated paths use forward slashes. All file writes use LF line endings. The `better-sqlite3` tag cache falls back to a JSON file cache if native compilation is unavailable.

## Technical Details

- **Tree-sitter**: WASM-based grammar parsing (16 languages: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP, Swift, Kotlin, C#, Scala, Elixir, Lua)
- **PageRank**: File relevance ranking via symbol reference graph
- **Token budget**: Configurable (default 5000) — stops adding files when budget reached
- **Incremental updates**: Only re-parses files changed since last run
