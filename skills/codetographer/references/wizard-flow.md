# Codetographer Wizard Flow

Full step-by-step instructions for setting up Codetographer in a new project.

## Step 1: Framework Detection

Detect the project's stack by reading:
- `package.json` → Node.js/TypeScript/JavaScript
- `Cargo.toml` → Rust
- `pyproject.toml` / `setup.py` / `requirements.txt` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java/Kotlin
- `*.csproj` / `*.sln` → C#
- `Gemfile` → Ruby
- `composer.json` → PHP

Extract:
- Primary language(s)
- Framework names (Express, Django, Rails, Gin, Axum, etc.)
- Test framework
- Build/package tool

## Step 2: Domain Discovery

Discover candidate domains by:

1. Read the project's directory structure (top 2 levels)
2. Look for patterns:
   - `src/api/` or `routes/` → "api" domain
   - `src/auth/` or `middleware/` → "auth" domain
   - `src/models/` or `db/` or `schema/` → "models" domain
   - `src/services/` or `lib/` → "services" domain
   - `src/utils/` or `helpers/` → "utils" domain
   - `tests/` or `spec/` or `__tests__/` → "testing" domain
   - `docs/` or `scripts/` → "infra" domain
3. Check package.json scripts for hints (`build`, `test`, `migrate`, `seed`)

**AskUserQuestion prompt:**
```
I've analyzed your project structure. Here are the domains I've identified:

[list discovered domains with path patterns]

Does this look right? You can:
- Confirm as-is
- Add missing domains (e.g., "add: payments")
- Remove domains (e.g., "remove: utils")
- Rename domains (e.g., "rename: services → core")
```

## Step 3: Parallel Domain Exploration

Dispatch one `domain-explorer` agent per domain **in parallel** using the Agent tool:

```
For each domain D:
  Agent(
    subagent_type: "general-purpose",
    prompt: "You are the domain-explorer agent. Explore the [D] domain in this project.

    Domain: [D]
    Path patterns: [patterns]

    Instructions: [paste full domain-explorer.md content here]

    Template to fill: [paste domain-templates.md content here]"
  )
```

Wait for all agents to complete. Each returns a filled domain doc.

## Step 4: Structural Scan

Dispatch `structural-scanner` agent:
```
Agent(
  prompt: "Run the tree-sitter map for this project.
  Project root: [project root path]
  Token budget: 5000

  Instructions: [paste structural-scanner.md content here]"
)
```

## Step 5: Assemble INDEX.md

Build `docs/codetographer/INDEX.md` from the template in `index-template.md`:

1. Fill in Project section (from framework detection)
2. Fill in Commands section (from package.json scripts or Makefile)
3. Fill in Domain Map (from domain docs — one row per domain)
4. Fill in Routing Rules table (file patterns → domain mappings)
5. Fill in Trusted Files (from static analysis: config files, entry points)
6. Leave Recent Activity empty (hooks will fill it)

Write the file atomically.

## Step 6: Install

1. Create `docs/codetographer/` directory
2. Write `docs/codetographer/INDEX.md` (assembled above)
3. Write each domain doc to `docs/codetographer/domains/<name>.md`
4. Write `docs/codetographer/map.md` (from structural-scanner output)
5. Create empty `docs/codetographer/changes.md` with metadata header
6. Deploy hookify rules to the project:
   - Create `.claude/` directory in the project root if it doesn't exist
   - Write `.claude/hookify.commit-before-stop.local.md` with this exact content:
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
   - Write `.claude/hookify.use-codetographer-docs.local.md` with this exact content:
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
   - If these files already exist in the project, skip — do NOT overwrite.

**AskUserQuestion prompt (final confirm):**
```
Codetographer is ready! Here's what was created:

docs/codetographer/
├── INDEX.md          ← injected at every session start
├── map.md            ← tree-sitter structural map ([N] symbols)
├── changes.md        ← hook-maintained change log
└── domains/
    ├── [domain1].md
    ├── [domain2].md
    └── ...

.claude/
├── hookify.commit-before-stop.local.md
└── hookify.use-codetographer-docs.local.md

The hooks will automatically:
- Inject INDEX.md context at session start and after /clear
- Track file changes and commits in changes.md
- Regenerate map.md when you stop a session

Next: I'll update CLAUDE.md with codetographer instructions.
```

## Step 7: Update CLAUDE.md

After all docs and hookify rules are written:

1. Check if `CLAUDE.md` exists in the project root.
2. If it does NOT exist, create it with only the codetographer section below.
3. If it DOES exist, read the file and check if it already contains a `## Codetographer` section.
   - If the section already exists, skip this step.
   - If the section does not exist, append the block below to the end of the file.

Block to append:

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

Tell the user: "Updated CLAUDE.md with codetographer documentation references."

If the user agreed to commit in Step 6, commit all files now (including CLAUDE.md and .claude/ hookify rules).

## Step 8: Verify

Confirm all files exist:
- `docs/codetographer/INDEX.md`
- `docs/codetographer/map.md`
- `docs/codetographer/domains/<each-domain>.md`

If any are missing, re-run the relevant step.

## AskUserQuestion Prompts

**Domain confirmation:**
> "I found these domains: [list]. Confirm or adjust?"

**Exploration progress:**
> "Exploring [N] domains in parallel. This usually takes 2-4 minutes..."

**Completion:**
> "Setup complete! Codetographer will now inject context automatically. Run /codetographer anytime to manage your documentation."
