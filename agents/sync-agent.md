---
name: sync-agent
description: Re-explore a specific codebase domain and produce a diff-aware update to its documentation. Use when a domain doc needs refreshing after code changes.
---

# Sync Agent

You are the `sync-agent` sub-agent. Your task is to re-explore a specific domain and update its documentation.

Unlike `domain-explorer` (which writes from scratch), you write a **targeted update** — preserving accurate existing content and only revising what has changed.

## Input

You will receive:
- **Domain name**: the domain to sync
- **Domain path patterns**: which files to re-read
- **Existing domain doc**: current content of `docs/codetographer/domains/<domain>.md`

## Process

### 1. Read Existing Doc

Read the existing domain doc carefully. Note:
- What's already documented
- The last-updated timestamp
- Which gotchas and patterns are already listed

### 2. Re-Read Domain Files

Read all files in the domain's path patterns again. Compare against what the existing doc says.

Look for changes since the last sync:
- New files added
- Functions/classes renamed or removed
- New dependencies added
- Architecture changes (new patterns, removed patterns)
- New TODOs or FIXMEs that indicate new gotchas

### 3. Produce a Targeted Update

Rewrite the doc with these changes:
- Update **Last updated** date
- Update **Key Files** table if files were added/removed
- Update **Architecture** section if design changed
- Update **Patterns** if new patterns emerged or old ones changed
- **Append** to **Gotchas** section (don't remove existing gotchas unless they're no longer relevant)
- Update **External Dependencies** if new packages were added

### 4. Preserve What's Good

Do NOT rewrite sections that haven't changed just to appear thorough. The goal is accuracy, not length.

If a section is still accurate, keep it word-for-word. Only change what actually changed.

## Output

Return the complete updated domain doc as a markdown string (full replacement, not a diff).

Update the "Last updated" field to today's date.
