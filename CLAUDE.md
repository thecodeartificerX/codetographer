# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Codetographer is a Claude Code plugin that generates three-tier navigational documentation for codebases: INDEX.md (routing table), domains/*.md (deep-dive docs), and map.md (tree-sitter structural map with PageRank). Output lives in `docs/codetographer/` of the target project. The plugin auto-syncs via 6 hooks and exposes 3 MCP tools.

## Build & Test Commands

```bash
npm install            # install all dependencies (first time / after pulling)
npm run build          # tsc → dist/
npm run build:hooks    # tsc + copy-hooks.js (patches imports, mirrors dist/ into hooks/dist/ and mcp/)
npm test               # Node.js built-in test runner with tsx/esm
```

No lint script exists; TypeScript strict mode is the static checking mechanism.

**Run a single test file:**
```bash
node --import tsx/esm --test tests/pagerank.test.ts
```

## Build System Gotcha: Import Path Patching

TypeScript compiles `src/` → `dist/`, but runtime hooks live in `hooks/`, MCP server in `mcp/`, and CLI in `scripts/`. The `scripts/copy-hooks.js` post-build step:
1. Mirrors the entire `dist/` tree into `hooks/dist/`
2. Copies hook entry points to `hooks/*.js` and patches `../` imports to `./dist/`
3. Patches `hooks/lib/*.js` and `mcp/server.js` similarly
4. Copies `scripts/treesitter-map.js`

**Always run `npm run build:hooks`** (not just `npm run build`) when testing hooks, MCP tools, or the CLI end-to-end. Plain `tsc` output in `dist/` won't be picked up by the runtime entry points.

## Architecture

### Data Pipeline (map generation)

```
file-discovery.ts → tag-extractor.ts → tag-cache.ts → pagerank.ts → map-generator.ts → atomic-write.ts
```

`file-discovery.ts` walks the project tree respecting `.gitignore`/`.codetographignore`. `tag-extractor.ts` uses **web-tree-sitter** (WASM, no native bindings) with per-language `.scm` query files from `scripts/queries/`. `tag-cache.ts` caches tags in SQLite (`better-sqlite3`) with JSON fallback if native compilation fails. `pagerank.ts` runs personalized PageRank on the file reference graph, boosting recently-changed files via `changes.md`. `map-generator.ts` orchestrates the pipeline and renders Aider-style output within a configurable token budget (default 5000, estimated as chars/4).

### Hook System

All 6 hooks are standalone Node.js scripts in `hooks/` that read JSON from stdin and write JSON to stdout (Claude Code hook protocol). They use `CLAUDE_PROJECT_DIR` env var to locate the target project. Context-injecting hooks output via `hookSpecificOutput.additionalContext`.

| Hook | Key behavior |
|------|-------------|
| `session-start` | Injects INDEX.md + changes.md tail; triggers lazy dep install if package.json checksum changed |
| `subagent-start` | Parses transcript JSONL to extract agent prompt, matches domain, injects domain doc or INDEX.md |
| `post-tool-use` | Logs Write/Edit file paths + domain to changes.md |
| `post-compact` | Re-injects INDEX.md after context compaction |
| `stop` | Regenerates map.md if changes.md is newer; updates INDEX.md Recent Activity (60s timeout) |
| `subagent-stop` | Logs first sentence of agent result to changes.md |

### MCP Server

`mcp/server.js` is a stdio MCP server. It parses `map.md` into an in-memory tag index, watches the file for changes (500ms debounce), and exposes `codetographer_search`, `codetographer_domain`, and `codetographer_status` tools.

### Skill & Agent Orchestration

`/codetographer` skill entry point (`skills/codetographer/SKILL.md`) has two modes:
- **Wizard** (no INDEX.md): detect → discover → parallel `domain-explorer` agents → `structural-scanner` agent → assemble INDEX.md
- **Dashboard** (INDEX.md exists): sync/add domains, force-refresh map, view status

Agent specs in `agents/` define system prompts for sub-agents dispatched by the skill.

## Key Conventions

- **ESM throughout**: `"type": "module"` in package.json, `NodeNext` module resolution
- **WASM over native**: tree-sitter uses `web-tree-sitter` (WASM) to avoid native compilation. Only `better-sqlite3` needs native binaries (with JSON fallback)
- **Windows + Linux**: all generated paths use forward slashes, all writes use LF via `atomic-write.ts` (includes Windows EPERM retry for atomic rename)
- **Tests use `node:test`**: built-in Node.js test runner with `tsx` for TypeScript, no Jest/Vitest
- **16 supported languages**: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP, Swift, Kotlin, C#, Scala, Elixir, Lua — each with a `.scm` query file in `scripts/queries/`

## Gotchas

- **Plugin env vars**: Hooks expect `CLAUDE_PLUGIN_ROOT` (plugin install dir) and `CLAUDE_PLUGIN_DATA` (writable data dir with node_modules) set by the Claude Code harness. When debugging hooks manually, set these yourself.
- **`.codetographignore`**: `file-discovery.ts` respects a `.codetographignore` file (same syntax as `.gitignore`) for excluding paths from the tree-sitter map in target projects.
- **Lazy dep install**: `session-start` compares package.json checksums between `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`; on mismatch it spawns `scripts/install-deps.js` detached. First session after a plugin update installs deps non-blocking.
