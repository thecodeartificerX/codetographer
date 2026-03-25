# Domain Documentation Template

Use this template for every domain doc. Fill every section — do not leave placeholders.

## Template

```markdown
# [Domain Name] Domain

**Last updated:** [ISO date]
**Path patterns:** [comma-separated globs, e.g., src/api/**, routes/**]

## Purpose

[1-2 sentences: what this domain does and why it exists. Focus on business function, not technical description. Bad: "This contains the Express routes." Good: "Handles all external HTTP API contracts — request validation, auth enforcement, and response serialization."]

## Architecture

[3-5 sentences explaining the design. WHY were key decisions made? What constraints shaped the design? Examples:
- "Routes are split by resource type (users, orders, products) not by HTTP method, because resources change independently."
- "All request validation happens in middleware before handlers, to keep handlers thin and testable."
- "We chose repository pattern over direct ORM calls to isolate database logic from business rules."]

## Key Files

| File | Role |
|------|------|
| [path] | [one-line description of what it does and why it matters] |
| [path] | [one-line description] |

(List 3-8 most important files. Exclude test files unless a test helper is critical.)

## Patterns & Conventions

- [Pattern name]: [How it's used and why. E.g., "Error handling: All errors thrown as AppError subclasses — never raw Error. Reason: unified error serialization in the global error middleware."]
- [Pattern name]: [description]
- [Naming convention]: [e.g., "Handler files: <resource>-handler.ts — lowercase, hyphenated"]
- [Data flow convention]: [e.g., "All mutations go through service layer — never direct DB calls from handlers"]

(List 4-8 patterns that a new developer needs to know before touching this domain.)

## External Dependencies

| Package/Service | Version | Why |
|----------------|---------|-----|
| [name] | [version or "see package.json"] | [one-line reason it's used] |

(List direct dependencies that are specific to this domain. Skip ubiquitous ones like lodash unless they're used in a non-obvious way.)

## Gotchas

> ⚠️ This section is MANDATORY. Generic advice is not acceptable. Each gotcha must be a specific failure mode you actually discovered in this codebase.

- **[Specific issue]**: [Exact failure mode + root cause + how to avoid it. E.g., "Passing unsanitized user input to the search query builder will silently truncate results — the builder uses LIKE matching but doesn't escape % characters. Always call sanitizeSearchInput() first."]
- **[Specific issue]**: [description]
- **[Specific issue]**: [description]

(Minimum 2 gotchas. If you can't find real ones, describe edge cases you noticed during exploration.)
```

## Fill Instructions for domain-explorer Agent

When filling this template:

1. **Purpose**: Read the domain's entry point file first. The purpose statement should match what you'd say to a new engineer on day 1.

2. **Architecture**: Look for architectural decisions, not just descriptions. Check git log, README, or inline comments for WHY decisions were made. If unclear, infer from the structure.

3. **Key Files**: Read every file. Only include files that are load-bearing — files you'd need to read to understand how the domain works. Sort by importance.

4. **Patterns**: These must be actionable. Each pattern should tell the reader what to do (or not do) and why. Look for repeated patterns across files.

5. **Dependencies**: Run `grep -r "import\|require" src/<domain>/ | grep "from '" | sort | uniq` to enumerate dependencies.

6. **Gotchas**: Read every comment that says "TODO", "FIXME", "HACK", "NOTE", "WARNING". Read error handling. Look for surprising edge cases. These are your gotchas.
