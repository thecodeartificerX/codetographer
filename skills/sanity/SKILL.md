---
name: sanity
description: "Use when: user says /sanity, sanity check, health check, verify codetographer, docs are stale, or codetographer seems broken. Also use when session-start reported fixed issues and user wants details."
---

# Sanity Skill

Run a full codetographer diagnostic, auto-repair what can be fixed, dispatch domain-explorer agents for stale domains, and display a clean status report.

## Entry Point

Check for INDEX.md first:

```
1. If docs/codetographer/INDEX.md does NOT exist → suggest wizard instead
2. If INDEX.md exists → run full sanity check
```

**If INDEX.md is missing:**
```
Codetographer has not been initialized for this project yet.
Run /codetographer to set it up.
```

## Step 1: Run Sanity Check

Run the CLI via Bash tool:

```bash
node $CLAUDE_PLUGIN_ROOT/scripts/sanity.js --project-dir $CLAUDE_PROJECT_DIR --json
```

Parse the JSON output as a `SanityReport`:
```ts
interface SanityReport {
  status: 'healthy' | 'fixed' | 'needs_attention';
  checks: Array<{
    name: string;
    status: 'pass' | 'fixed' | 'warn' | 'fail';
    message: string;
    staleDomains?: string[];
  }>;
  summary: string;
}
```

## Step 2: Display Report

Format and display the report table:

```
Codetographer Sanity Check
──────────────────────────
 PASS  docs/codetographer/ exists
 PASS  INDEX.md exists
 FIXED map.md regenerated (was 3h stale)
 PASS  changes.md exists
 PASS  CLAUDE.md has ## Codetographer section
 FIXED hookify rule commit-before-stop.local.md restored
 PASS  hookify rule use-codetographer-docs.local.md exists
 PASS  Environment variables set
 PASS  Dependencies installed
 PASS  Hook scripts present
 WARN  2 stale domains: auth, api → dispatching explorers...

Status: fixed (11/12 passed, 2 fixed, 1 needs sync)
```

Status badge rules:
- `pass` → ` PASS ` (no highlight needed)
- `fixed` → ` FIXED` (auto-repaired)
- `warn` → ` WARN ` (informational, no action needed)
- `fail` → ` FAIL ` (needs manual intervention)

**If status is `healthy`:** Display the report and stop. No agents needed.

## Step 3: Collect Stale Domains (if any)

Union the `staleDomains` arrays from all check results into a single deduplicated list. These come from:
- Check 5 (domains listed in INDEX.md but missing from disk)
- Check 10 (domain docs on disk but older than changes.md)

If the list is empty, skip to Step 6.

## Step 4: Dispatch Domain-Explorer Agents

For each stale/missing domain, dispatch a `domain-explorer` agent **in parallel** using the Agent tool:

```
For each domain D in staleDomains:
  Agent(
    subagent_type: "general-purpose",
    model: "sonnet",
    prompt: "You are the domain-explorer agent. Explore the [D] domain in this project.

    Domain: [D]
    Path patterns: [patterns from INDEX.md Domain Map for domain D]
    Project root: $CLAUDE_PROJECT_DIR

    Instructions: [paste full agents/domain-explorer.md content here]

    Template to fill: [paste skills/codetographer/references/domain-templates.md content here]

    Write the completed domain doc to:
    $CLAUDE_PROJECT_DIR/docs/codetographer/domains/[D].md"
  )
```

Read the domain path patterns from the INDEX.md Domain Map table:
```
## Domain Map

| Domain | Paths | Description |
|--------|-------|-------------|
| auth   | src/auth/**  | Authentication and authorization |
```

Wait for all agents to complete.

## Step 5: Re-run Sanity Check

After all agents have written their domain docs, re-run the check:

```bash
node $CLAUDE_PLUGIN_ROOT/scripts/sanity.js --project-dir $CLAUDE_PROJECT_DIR --json
```

**If map.md is stale in the re-check**, run map regeneration:

```bash
node $CLAUDE_PLUGIN_ROOT/scripts/treesitter-map.js \
  --root $CLAUDE_PROJECT_DIR \
  --output docs/codetographer/map.md \
  --budget 5000
```

## Step 6: Display Final Status

```
Re-check after sync:
 PASS  All domain docs fresh
 PASS  map.md regenerated

Final status: healthy (12/12 passed)
```

If any `fail` checks remain after the re-check, list them explicitly:

```
Issues requiring manual attention:
 FAIL  INDEX.md missing — run /codetographer to initialize
 FAIL  Hook scripts missing — run npm run build:hooks in plugin root
```

## Key Files Referenced

- `scripts/sanity.js` — CLI entry point (compiled from `src/sanity.ts`)
- `scripts/treesitter-map.js` — map regeneration CLI
- `agents/domain-explorer.md` — agent spec for domain doc generation
- `skills/codetographer/references/domain-templates.md` — domain doc template
- `docs/codetographer/INDEX.md` — routing table (parsed for domain path patterns)
- `docs/codetographer/domains/<name>.md` — per-domain deep dives
