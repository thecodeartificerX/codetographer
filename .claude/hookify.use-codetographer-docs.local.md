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
