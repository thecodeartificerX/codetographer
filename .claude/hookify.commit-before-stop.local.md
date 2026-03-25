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
