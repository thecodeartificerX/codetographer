---
name: codetographer
description: "Map and navigate any codebase with three-tier documentation. Use when: user says /codetographer, mentions codebase mapping, asks about code navigation, wants to set up codebase docs, or asks to sync/refresh codebase documentation."
---

# Codetographer Skill

You are the Codetographer skill. Map codebases and generate navigation documentation.

## Entry Point

First, determine the project state:

```
1. Check if docs/codetographer/INDEX.md exists in the project root
2. If NOT exists → WIZARD MODE (new project setup)
3. If EXISTS → DASHBOARD MODE (manage existing setup)
```

## Wizard Mode

See `skills/codetographer/references/wizard-flow.md` for the complete wizard flow.

**Quick summary:**
1. Greet user, explain what Codetographer does
2. Detect project framework from package.json / Cargo.toml / etc.
3. Discover domain boundaries (ask user to confirm)
4. Dispatch parallel `domain-explorer` agents for each domain
5. Assemble `docs/codetographer/INDEX.md` from collected domain docs
6. Run `scripts/treesitter-map.js` via `structural-scanner` agent to generate `map.md`
7. Verify: confirm all files exist, show summary to user

Use the templates in `skills/codetographer/references/domain-templates.md` and `skills/codetographer/references/index-template.md`.

## Dashboard Mode

When INDEX.md exists, show the user a menu:

```
Codetographer is set up for this project.

What would you like to do?
1. Sync a domain (re-explore and update a domain doc)
2. Add a new domain
3. Force-refresh the tree-sitter map
4. View status (map age, domain staleness)
5. Uninstall (remove docs/codetographer/)
```

- **Sync domain**: Dispatch `sync-agent` for the selected domain
- **Add domain**: Run mini-wizard for just the new domain
- **Force-refresh**: Run `structural-scanner` agent with --budget 5000
- **View status**: Call `codetographer_status` MCP tool
- **Uninstall**: Confirm, then remove `docs/codetographer/` directory

## Key Files

- `docs/codetographer/INDEX.md` — routing table injected at session start
- `docs/codetographer/domains/<name>.md` — per-domain deep dives
- `docs/codetographer/map.md` — tree-sitter structural map
- `docs/codetographer/changes.md` — hook-maintained change log
