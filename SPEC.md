# Codetographer — ZeroShot Execution Spec

**Date:** 2026-03-25
**Status:** Ready for execution
**Project Root:** `F:/Tools/Projects/cc-plugins/codetographer/`
**Design Spec:** See `2026-03-25-codetographer-design.md` for full architectural context, document formats, and cross-platform details.

**Problem:** AI coding agents waste tokens re-exploring codebases from scratch. Codetographer is a Claude Code plugin that maps any codebase via tree-sitter + agentic exploration, generates a three-tier documentation structure (INDEX.md routing table → domain docs → structural map), and auto-syncs via hooks.

## Goals

1. Create a Claude Code plugin with: 6 hook scripts, 1 MCP server, 1 skill (wizard), 4 agent definitions
2. Build a tree-sitter pipeline that extracts function/class signatures, ranks files via PageRank, and outputs a token-budgeted structural map
3. All hook scripts and the MCP server must work on both Windows and Linux (see design spec §Cross-Platform Compatibility)
4. Plugin validates with `claude plugin validate .`

## Non-Goals

- No UI / frontend (this is a CLI plugin)
- No runtime daemon — all logic runs in hooks, the MCP server, or the skill wizard
- No support for WSL-specific path handling
- Tree-sitter grammar authoring — we ship existing community `tags.scm` files, not custom ones

## Key Technical Decisions

- **Runtime:** All scripts run via `node` (not Bun). Hook commands use `node ${CLAUDE_PLUGIN_ROOT}/hooks/<script>.js`
- **SQLite:** `better-sqlite3` for the tag cache. JSON file fallback if native compilation fails (see design spec)
- **Tree-sitter:** `web-tree-sitter` (WASM-based, no native bindings). Grammar packages as npm deps
- **All hooks are async** (`"async": true`) to prevent Windows startup hangs
- **Atomic writes:** All file mutations use temp-file-then-rename with Windows EPERM handling
- **Line endings:** LF (`\n`) everywhere, regardless of platform
- **Paths:** `path.join()` / `path.resolve()` everywhere. Forward slashes in generated markdown docs. Normalize incoming paths to forward slashes before domain matching

## Epic Structure

### Epic 0: Project Setup
- Create project directory structure:
  ```
  codetographer/
  ├── .claude-plugin/
  ├── skills/codetographer/references/
  ├── agents/
  ├── hooks/lib/
  ├── scripts/queries/
  ├── mcp/
  └── tests/
  ```
- `git init && git add -A && git commit -m "epic-0: empty project scaffold"`
- Create `package.json` with these dependencies (use exact versions — research latest via `npm info` before writing):
  - `web-tree-sitter`
  - `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `tree-sitter-c`, `tree-sitter-cpp`, `tree-sitter-ruby`, `tree-sitter-php`, `tree-sitter-swift`, `tree-sitter-kotlin`, `tree-sitter-c-sharp`, `tree-sitter-scala`, `tree-sitter-elixir`, `tree-sitter-lua`
  - `better-sqlite3`
  - `@anthropic-ai/sdk` (for MCP server — use `createSdkMcpServer` or the official MCP SDK; research latest API before coding)
  - Dev deps: `typescript`, `@types/node`, `@types/better-sqlite3`
- Use sub-agents to research latest docs for `web-tree-sitter`, `better-sqlite3`, and the Claude Code MCP server SDK before coding — no conjecture from training data
- `npm install`
- Create `tsconfig.json` — strict mode, target ES2022, module NodeNext, outDir `dist/`
- Create `.gitignore`: `node_modules/`, `dist/`, `*.js.map`
- Create `.claude-plugin/plugin.json`:
  ```json
  {
    "name": "codetographer",
    "version": "1.0.0",
    "description": "Three-tier codebase navigation via tree-sitter mapping, agentic exploration, and hook-powered auto-sync",
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
- `git add -A && git commit -m "epic-0: project setup with deps and plugin manifest"`

### Epic 1: Tree-Sitter Tag Extraction Pipeline
- Use sub-agents to research `web-tree-sitter` WASM loading API — how to initialize the parser, load `.wasm` grammar files, and run tree-sitter queries. Research how npm grammar packages expose their `.wasm` files (path conventions vary between packages)
- Create `scripts/queries/` directory with `tags.scm` files for all 16 languages. These define `name.definition.*` and `name.reference.*` captures. Source them from the Aider project's `aider/queries/` directory (MIT licensed) — use sub-agents to fetch the raw files from GitHub: `https://github.com/Aider-AI/aider/tree/main/aider/queries`. For languages where Aider doesn't have reference captures, provide definition captures only
- Create `src/types.ts` — shared TypeScript types:
  ```typescript
  export interface Tag {
    file: string;       // relative path (forward slashes)
    name: string;       // identifier
    line: number;       // 1-based line number
    kind: 'def' | 'ref';
    signature?: string; // full signature line for defs
    scope?: string;     // parent class/module name
  }

  export interface FileEntry {
    relativePath: string; // forward slashes
    language: string;
    mtime: number;
    tags: Tag[];
  }
  ```
- Create `src/file-discovery.ts` — walks project tree, respects `.gitignore` + `.codetographignore`, detects language by extension, skips binaries/node_modules/dist/.git/lockfiles. Returns array of `{ relativePath, language, absolutePath }`. Uses `path.join()` for all path construction. Normalizes all paths to forward slashes for consistency
- Create `src/tag-extractor.ts` — loads `web-tree-sitter`, initializes parser with the correct WASM grammar for each language, runs `tags.scm` queries, extracts `Tag[]` per file. Handles missing grammars gracefully (returns empty tags, logs warning). Extracts full signature lines for definitions (reads the source line at the tag's line number)
- Create `src/tag-cache.ts` — SQLite-backed cache using `better-sqlite3`. Schema: `CREATE TABLE tags (file TEXT PRIMARY KEY, mtime REAL, tags_json TEXT)`. Methods: `get(file, mtime)`, `set(file, mtime, tags)`, `clear()`. If `better-sqlite3` import fails, fall back to a JSON file cache at `${dataDir}/treesitter-cache/tags.json` with the same interface
- Compile: `npx tsc --noEmit` — zero errors
- Write unit test `tests/tag-extractor.test.ts`: create a small TypeScript file in a temp dir, run tag extraction, verify it finds function and class definitions with correct signatures. Run with `node --test tests/tag-extractor.test.ts`
- `git add -A && git commit -m "epic-1: tree-sitter tag extraction pipeline with cache"`

### Epic 2: PageRank and Map Generation
- Create `src/pagerank.ts` — lightweight iterative PageRank implementation (~50 lines of matrix math). Input: directed graph as adjacency list `Map<string, Map<string, number>>` (node → { neighbor → weight }). Optional personalization weights `Map<string, number>`. Output: `Map<string, number>` (node → score). Converges in ~20 iterations with damping factor 0.85
- Create `src/map-generator.ts` — the full pipeline orchestrator:
  1. Call file-discovery to get all source files
  2. For each file, check tag-cache by mtime — extract tags only for changed files
  3. Build reference graph: for each identifier that appears as `def` in file A and `ref` in file B, add edge B→A with weight 1.0. Self-loops at weight 0.1 for defs with no references
  4. Run PageRank with personalization (recently-touched files from changes.md get 10x weight)
  5. Sort files by score descending
  6. Render output in Aider-style format: file headers, `│` scope markers, `⋮...` omission markers, full signature lines for defs
  7. Enforce hard token budget (default 5000, configurable). Estimate tokens as `chars / 4`. Stop adding files when budget reached
  8. Return the rendered markdown string
- Create `src/atomic-write.ts` — cross-platform atomic write utility. Writes to `.tmp` then renames. Handles Windows EPERM by unlink-then-rename (see design spec §Atomic File Writes)
- Create `scripts/treesitter-map.js` — CLI entry point that imports the pipeline, reads config (project root, changes.md path, token budget) from CLI args or env vars, runs the generator, writes output atomically to `map.md`
- Write unit test `tests/pagerank.test.ts`: small 4-node graph with known expected ranks. Run with `node --test`
- Write unit test `tests/map-generator.test.ts`: create a temp directory with 3 TypeScript files that import each other, run the full pipeline, verify the output contains signatures ordered by PageRank score, verify token budget is enforced
- `git add -A && git commit -m "epic-2: pagerank ranking and map generation pipeline"`

### Epic 3: Hook Scripts
- Create `src/hooks/lib/context-loader.ts` — shared function `loadContext(projectDir: string): string | null`. Reads `docs/codetographer/INDEX.md` (if exists), appends last 10 lines of `changes.md` (if exists). Returns combined string or null if codetographer not initialized. Truncates INDEX.md to 200 lines if larger
- Create `src/hooks/lib/domain-matcher.ts` — parses INDEX.md routing rules table to extract domain→path mappings. Given a text string (agent task prompt), extracts file paths via regex and keyword matching, returns the best-matching domain name(s). Normalizes all paths to forward slashes before matching
- Create `src/hooks/lib/changes-writer.ts` — appends a line to `changes.md`, updates the `domain-touched` metadata comment at top, trims to 200 lines if exceeded. All writes use LF line endings
- Create `src/hooks/session-start.ts` — reads JSON from stdin, calls `loadContext()`, also runs a fast `diff` of `${CLAUDE_PLUGIN_ROOT}/package.json` vs `${CLAUDE_PLUGIN_DATA}/package.json` and spawns background `install-deps.js` if they differ (using `child_process.spawn({ detached: true, stdio: 'ignore' })` + `child.unref()`). Outputs `hookSpecificOutput.additionalContext` JSON to stdout. Exits silently if codetographer not initialized
- Create `src/hooks/subagent-start.ts` — reads JSON from stdin (gets `transcript_path`, `agent_type`). Reads last entries of transcript JSONL to find the Agent tool call that spawned this subagent. Extracts the `prompt` field. Runs domain-matcher to find relevant domain. Reads domain doc file. Outputs as `additionalContext`. Falls back to INDEX.md if no domain match. Skips configurable agent types (`grader`, `comparator`)
- Create `src/hooks/post-tool-use.ts` — reads JSON from stdin (gets `tool_input.file_path`). Calls changes-writer to append entry. No stdout output needed (async hook)
- Create `src/hooks/post-compact.ts` — identical to session-start minus the dep-check logic. Calls `loadContext()`, outputs as `additionalContext`
- Create `src/hooks/stop.ts` — reads JSON from stdin. Checks changes.md for entries newer than map.md's mtime. If no changes, exits. Otherwise runs the treesitter-map pipeline (incremental — only re-parses changed files). Writes map.md atomically. Updates INDEX.md "Recent Activity" section atomically. Updates domain doc "Recent Changes" sections
- Create `src/hooks/subagent-stop.ts` — reads JSON from stdin (gets `last_assistant_message`). Extracts first sentence or first 150 chars. Calls changes-writer to append entry
- Compile all hooks: `npx tsc`
- Create `hooks/hooks.json` with the exact registry from the design spec (all async, SessionStart matcher `startup|resume`, PostToolUse matcher `Write|Edit`, Stop timeout 60s, all others timeout 5s)
- Copy compiled JS from `dist/hooks/` to `hooks/` as flat files (session-start.js, subagent-start.js, etc.) and `hooks/lib/` for shared modules. Ensure import paths in compiled output resolve correctly
- Write test `tests/hooks/session-start.test.ts`: create a temp project dir with a mock `docs/codetographer/INDEX.md`, pipe mock stdin JSON to session-start, verify stdout contains the additionalContext JSON
- Write test `tests/hooks/post-tool-use.test.ts`: create a temp project dir with `docs/codetographer/changes.md`, pipe mock PostToolUse stdin, verify the file path was appended to changes.md with correct format
- `git add -A && git commit -m "epic-3: all 6 hook scripts with shared lib and tests"`

### Epic 4: MCP Server
- Use sub-agents to research the latest Claude Code MCP server SDK (check `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, or whatever the current recommended package is for building MCP servers in Node.js). Get exact API: how to define tools, handle requests, and start the server. Do NOT guess the API — fetch real docs
- Create `src/mcp/server.ts` — MCP server exposing 3 tools:
  - `codetographer_search(query: string, limit?: number)` — tokenizes query into keywords, matches against the tag cache (function names, class names, type names) and file paths. Returns results ranked by: exact name match > partial name > file path match. Each result includes file path, line number, signature, and domain attribution. Default limit: 10
  - `codetographer_domain(domain: string, section?: string)` — reads the domain doc file from `docs/codetographer/domains/<domain>.md`. If `section` specified, extracts just that section (purpose, architecture, key-files, patterns, dependencies, gotchas). Returns the content as text
  - `codetographer_status()` — reads all domain docs, changes.md, and map.md. Returns JSON with: per-domain last sync timestamp vs last change timestamp, map.md age, total symbols in cache, changes.md last-modified as proxy for hook activity
- The server resolves the project root from `CLAUDE_PROJECT_DIR` env var (set by Claude Code). Joins with `docs/codetographer` to get absolute path. Falls back to `process.cwd()` if env var not set
- The server loads the tag cache and map.md on startup. Watches map.md with a debounced file watcher (500ms debounce) to re-index when the stop hook regenerates it
- Compile: `npx tsc --noEmit`
- Copy compiled output to `mcp/server.js`
- Write test `tests/mcp/server.test.ts`: create a temp project with mock codetographer docs and a populated tag cache, start the MCP server, call each tool via the SDK client, verify responses. If MCP SDK testing is complex, test the underlying handler functions directly instead
- `git add -A && git commit -m "epic-4: MCP server with search, domain, and status tools"`

### Epic 5: Skill, Agents, and References
- Create `skills/codetographer/SKILL.md` — the main wizard entry point. Frontmatter:
  ```yaml
  name: codetographer
  description: "Map and navigate any codebase with three-tier documentation. Use when: user says /codetographer, mentions codebase mapping, asks about code navigation, wants to set up codebase docs, or asks to sync/refresh codebase documentation."
  ```
  Body: The full wizard flow logic (read project state → route to wizard or dashboard mode). Reference the `wizard-flow.md`, `domain-templates.md`, and `index-template.md` files. The skill dispatches sub-agents for exploration. See design spec §Wizard Flow for the complete state machine
- Create `skills/codetographer/references/wizard-flow.md` — detailed step-by-step instructions for the wizard: framework detection patterns, domain discovery logic, how to dispatch parallel domain-explorer agents, how to assemble INDEX.md, the install sequence with backup, and the verify step. Include the exact AskUserQuestion prompts for each user interaction
- Create `skills/codetographer/references/domain-templates.md` — the exact domain doc markdown template (from design spec §Domain Docs). Include instructions for the domain-explorer agent on how to fill each section
- Create `skills/codetographer/references/index-template.md` — the exact INDEX.md markdown template (from design spec §INDEX.md). Include placeholders for Project, Commands, Domain Map, Routing Rules, Trusted Files, Recent Activity sections
- Create `agents/domain-explorer.md` — sub-agent instructions for deep-diving a single domain. The agent receives: domain name, path patterns, and the domain doc template. It reads every file, maps dependencies, identifies patterns, finds gotchas, and produces the filled-in domain doc. Emphasize: the Architecture section must explain WHY, not just WHAT. The Gotchas section is mandatory and must contain specific failure modes, not generic advice
- Create `agents/structural-scanner.md` — sub-agent that runs `scripts/treesitter-map.js` via Bash and verifies the output. Receives: project root path, token budget. Returns: confirmation of map.md generation with symbol count
- Create `agents/domain-router.md` — sub-agent that given a task description and the INDEX.md routing rules, returns the most relevant domain name(s). Used by the SubagentStart hook's fallback logic (when transcript parsing fails)
- Create `agents/sync-agent.md` — sub-agent for re-exploring a specific domain. Same as domain-explorer but reads the existing domain doc first and produces a diff-aware update rather than a full rewrite
- Create `scripts/install-deps.js` — copies `package.json` from plugin root to `CLAUDE_PLUGIN_DATA` dir and runs `npm install --production`. Detects `better-sqlite3` compilation failure and logs clear diagnostic. Exits 0 on success, 1 on failure
- Validate plugin structure: `claude plugin validate .` (or simulate by checking all files exist in expected locations)
- `git add -A && git commit -m "epic-5: skill wizard, agent definitions, and reference templates"`

### Epic 6: Build Pipeline and Distribution
- Create build script in `package.json`:
  ```json
  {
    "scripts": {
      "build": "tsc",
      "build:hooks": "tsc && node scripts/copy-hooks.js",
      "test": "node --test tests/**/*.test.ts"
    }
  }
  ```
- Create `scripts/copy-hooks.js` — copies compiled hook JS files from `dist/hooks/` to `hooks/` (flat structure), resolving import paths so they work when executed by Claude Code. Also copies `dist/hooks/lib/` to `hooks/lib/`. Also copies `dist/mcp/` to `mcp/`
- Run `npm run build:hooks` — verify all compiled JS files land in the correct locations
- Verify `hooks/hooks.json` references match the actual compiled file paths
- Run all tests: `npm test` — all must pass
- Create `README.md`:
  - What Codetographer does (one paragraph)
  - Installation: `claude plugin install codetographer` or `claude --plugin-dir ./codetographer`
  - Usage: run `/codetographer` in any project
  - What it creates: `docs/codetographer/` directory structure
  - How auto-sync works (hooks summary)
  - How to uninstall (via dashboard or remove plugin)
  - Cross-platform notes (Windows + Linux)
- Run `claude plugin validate .` — must pass with no errors
- `git add -A && git commit -m "epic-6: build pipeline, tests passing, plugin validated"`

### Epic 7: Integration Verification
- Create a test fixture: a small multi-file TypeScript project in `tests/fixtures/sample-project/` with:
  - `src/api/server.ts` (Express-like routes)
  - `src/api/middleware.ts` (auth middleware)
  - `src/models/user.ts` (data model)
  - `src/utils/helpers.ts` (utility functions)
  - `package.json`, `tsconfig.json`
  - Files should import each other to create a meaningful reference graph
- Run the tree-sitter pipeline against the fixture: `node scripts/treesitter-map.js --root tests/fixtures/sample-project --output tests/fixtures/sample-project/map.md --budget 3000`
- Verify map.md was generated, contains signatures from all 4 source files, is ordered by PageRank (server.ts or middleware.ts should rank highest since they're most referenced), and stays under 3000 tokens
- Test the MCP server against the fixture: start the server with `CLAUDE_PROJECT_DIR=tests/fixtures/sample-project`, call `codetographer_search("middleware")`, verify it returns `src/api/middleware.ts` with the correct line numbers
- Test hook scripts against the fixture:
  - Pipe mock SessionStart JSON to `hooks/session-start.js` with the fixture as project dir — should exit silently (no INDEX.md exists yet)
  - Create a mock `docs/codetographer/INDEX.md` in the fixture, re-run — should output additionalContext
  - Pipe mock PostToolUse JSON (simulating an edit to `src/api/server.ts`) to `hooks/post-tool-use.js` — verify `changes.md` was created/appended
- Verify cross-platform path handling: all paths in generated map.md use forward slashes. All paths in changes.md use forward slashes
- Grep the entire `src/` directory for any hardcoded path separators (`\\` or bare `/` in path construction) — must find zero instances outside of regex patterns and string formatting
- Grep for any `os.EOL` usage — must be zero (we use `\n` everywhere)
- Grep for any `fs.renameSync` or `fs.rename` calls that don't have the Windows EPERM fallback — must be zero (all should use `atomic-write.ts`)
- `git add -A && git commit -m "epic-7: integration verification complete"`

## Risks

1. **`web-tree-sitter` WASM loading** — grammar packages expose `.wasm` files at different paths. Mitigation: research actual npm package structure before coding; have a lookup table of `language → wasm path` that's tested per package
2. **`better-sqlite3` compilation failure** — native deps can fail on systems without build tools. Mitigation: JSON file fallback cache (automatic, no user action needed)
3. **SubagentStart transcript parsing** — the JSONL format may change between Claude Code versions. Mitigation: fallback to INDEX.md injection if parsing fails; log the error for debugging
4. **Large repos (10K+ files)** — PageRank computation and file walking may be slow. Mitigation: incremental approach (only re-parse changed files), configurable `.codetographignore`, token budget cap on output
5. **Hook timeout on cold cache** — first `stop.js` run parses all files, may exceed 60s on very large repos. Mitigation: atomic writes prevent corruption; next run picks up where it left off
