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

The hooks will automatically:
- Inject INDEX.md context at session start
- Track file changes in changes.md
- Regenerate map.md when you stop a session

Shall I commit this to git? (yes/no)
```

## Step 7: Verify

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
