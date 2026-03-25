# Codetographer

**Every AI coding session starts the same way: the agent greps around, reads random files, builds a mental model from scratch, and burns tokens doing work it already did yesterday.**

Codetographer fixes this. It's a Claude Code plugin that maps your codebase once, keeps the map alive automatically, and injects exactly the right context into every session and every subagent — before they read a single line of code.

The result: agents start productive immediately, subagents get the domain knowledge they need without asking, and your token spend drops because nobody's re-exploring the same architecture for the hundredth time.

## How It Works

One command sets everything up:

```
/codetographer
```

The wizard scans your project, identifies logical domains (API, auth, models, etc.), dispatches parallel AI agents to deeply explore each one, and generates a three-tier documentation structure that stays in sync as your code evolves.

### The Three Tiers

```
docs/codetographer/
├── INDEX.md       ← routing table, injected at every session start
├── domains/       ← deep-dive docs per domain, injected into subagents
│   ├── api.md
│   ├── auth.md
│   └── models.md
├── map.md         ← tree-sitter structural map, auto-regenerated
└── changes.md     ← change log, maintained by hooks
```

**Tier 1 (Hot):** `INDEX.md` is injected into context at session start, after `/clear`, and after compaction. Under 200 lines — a routing table, not an encyclopedia.

**Tier 2 (Warm):** When a subagent spawns, codetographer matches its task to a domain and injects that domain's doc. An agent working on auth gets auth context. An agent fixing an API endpoint gets API context. No wasted tokens on irrelevant domains.

**Tier 3 (Cold):** Three MCP tools for on-demand deep dives — search symbols, read domain docs, check sync status. Only loaded when explicitly needed.

## What Stays In Sync (And How)

You don't maintain any of this. Seven hooks run automatically:

| What happens | What codetographer does |
|---|---|
| Session starts, `/clear`, or compaction | Injects INDEX.md into context |
| You edit a file | Logs the change + domain to changes.md |
| A subagent spawns | Injects the relevant domain doc |
| You commit code | Logs the commit, hash, and affected domains |
| A subagent finishes | Logs its result summary |
| Session ends | Regenerates map.md if anything changed |

The tree-sitter map regeneration is incremental — only re-parses files that changed since the last run, ranked by PageRank so the most-referenced files appear first.

## Installation

```bash
# From a marketplace
claude plugin install codetographer@sakib-plugins

# Or point directly at the plugin
claude --plugin-dir /path/to/codetographer
```

Then open any project and run `/codetographer` to start the wizard.

## MCP Tools

Available in any session where the plugin is active:

- `codetographer_search(query)` — find functions, classes, and types by name
- `codetographer_domain(domain, section?)` — read domain documentation
- `codetographer_status()` — check map age, symbol count, domain staleness

## Dashboard

Run `/codetographer` in a project that's already set up:

- Sync a domain (re-explore after major changes)
- Add a new domain
- Force-refresh the tree-sitter map
- View status
- Uninstall

## Language Support

Tree-sitter parsing covers 16 languages: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP, Swift, Kotlin, C#, Scala, Elixir, and Lua. Uses WASM grammars — no native compilation required for the parser.

## Cross-Platform

Works on Windows and Linux. Forward slashes everywhere, LF line endings, atomic file writes with Windows EPERM handling. The SQLite tag cache falls back to JSON if native binaries aren't available.
