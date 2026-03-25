# INDEX.md Template

This template produces the `docs/codetographer/INDEX.md` file injected into every session.

Keep it under 200 lines. Every line counts — this is injected into every Claude Code session.

## Template

```markdown
# [Project Name] — Codetographer Index

**Stack:** [e.g., Node.js + TypeScript + Express + PostgreSQL]
**Last mapped:** [ISO date]

## Project

[1-2 sentence description of what this project does. Business function, not tech stack.]

**Entry points:**
- [e.g., `src/index.ts` — HTTP server startup]
- [e.g., `src/worker.ts` — Background job processor]

## Commands

| Command | What it does |
|---------|-------------|
| `[command]` | [description] |
| `[command]` | [description] |

(5-10 most important commands: dev server, test, build, migrate, lint, etc.)

## Domain Map

| Domain | Paths | Description |
|--------|-------|-------------|
| [name] | [e.g., src/api/**] | [one-line purpose] |
| [name] | [e.g., src/auth/**] | [one-line purpose] |
| [name] | [e.g., src/models/**] | [one-line purpose] |

(One row per domain. Paths are forward-slash globs from project root.)

## Routing Rules

> When working on a file, read the corresponding domain doc first.

| Domain | File patterns | When to load |
|--------|---------------|--------------|
| [name] | [e.g., src/api/, routes/] | [e.g., building endpoints, modifying responses, adding routes] |
| [name] | [e.g., src/auth/, middleware/] | [e.g., auth logic, token validation, permissions, sessions] |
| [name] | [e.g., src/models/, db/] | [e.g., database schema, migrations, queries, data access] |
| [name] | [e.g., src/services/] | [e.g., business logic, external API calls, background jobs] |

## Trusted Files

> These files are safe to read for cross-cutting context without loading a domain doc.

- `[e.g., src/types.ts]` — shared TypeScript interfaces
- `[e.g., src/config.ts]` — environment configuration
- `[e.g., src/errors.ts]` — error class hierarchy
- `[e.g., src/db.ts]` — database connection pool

## Recent Activity

<!-- This section is auto-updated by the Stop hook -->
<!-- domain-touched: -->
```

## Fill Instructions

**Project section:**
- Name: from package.json name, or directory name
- Stack: infer from dependencies and config files
- Entry points: files imported in npm start / main command

**Commands section:**
- Read package.json scripts (or Makefile, or shell scripts)
- Include: dev, test, build, lint, migrate (if applicable)
- Use actual commands, not descriptions

**Domain Map:**
- One row per domain discovered in wizard step 2
- Paths must be the exact glob patterns used for routing

**Routing Rules:**
- This is the key table used by SubagentStart hook
- "When to load" should be specific keywords/tasks, not generic descriptions
- Good: "adding routes, modifying request validation, changing response format"
- Bad: "when working in the API"

**Trusted Files:**
- 3-6 files that contain shared types, constants, or configuration
- These are files any agent might need regardless of their task domain
