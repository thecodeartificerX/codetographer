# Phase 4: Session-Start Hook Integration

## Gotchas
- The session-start hook has a **5s timeout**. The sanity check MUST pass `skipExpensive: true` to avoid map regeneration timing out.
- The sanity check runs AFTER the dep-check block (`if (pluginData) { ... }` ending with `child.unref()`). If deps are being installed right now, sanity checks that need node_modules will gracefully skip.
- The sanity check runs BEFORE `loadContext()`. If the sanity check creates missing files (like changes.md), `loadContext()` will pick them up.
- If INDEX.md doesn't exist (plugin not initialized), the sanity check will report `fail` for INDEX.md but should NOT block the hook — the current behavior of exiting silently on uninitialized projects must be preserved.
- The sanity warning is prepended to `additionalContext`, not a separate output field. The combined string goes into `hookSpecificOutput.additionalContext`.
- The hook uses `async: true` in hooks.json — it must still write valid JSON to stdout.

## Files
```
src/hooks/
└── session-start.ts     # MODIFY — add sanity check call
```

---

## Task 1: Integrate sanity check into session-start hook

**Description:** Modify `src/hooks/session-start.ts` to call `runSanityCheck()` after the dep-check logic and before context loading. Prepend any warnings or fix notes to the `additionalContext` output.

**Acceptance criteria:**
- Imports `runSanityCheck` from `'../sanity.js'`
- Calls `runSanityCheck({ projectDir, pluginRoot, pluginData: pluginData ?? '', fix: true, quiet: true, skipExpensive: true })`
- If `status === 'needs_attention'`: prepends a warning block listing failed check messages to `additionalContext`
- If `status === 'fixed'`: prepends a one-line note (`"Codetographer sanity: fixed N issue(s). Run /sanity for details."`)
- If `status === 'healthy'`: no extra output
- The existing behavior is preserved: if INDEX.md doesn't exist and sanity didn't fix it, the hook still exits silently (or outputs only the sanity warning if there is one)
- The sanity check is wrapped in a try/catch — if it throws, the hook continues without it (fail-open, don't break session start)
- Output format matches the existing JSON structure: `{ hookSpecificOutput: { additionalContext: string } }`

**Files:**
- `src/hooks/session-start.ts` — MODIFY

**Architecture notes:**

Revised flow of `main()`:
```
1. Parse stdin JSON (existing)
2. Get projectDir (existing)
3. Dep-check block (existing, unchanged)
4. NEW: runSanityCheck({ fix: true, skipExpensive: true, quiet: true })
5. NEW: Build sanityNote string from report
6. loadContext(projectDir) (existing, unchanged)
7. MODIFIED: If no context AND no sanityNote → exit silently
8. MODIFIED: Output additionalContext = sanityNote + (context ?? '')
```

The key change is that `context` being null no longer means immediate exit — if there's a sanity warning, it should still be output even without INDEX.md context.

Warning format:
```
⚠ Codetographer sanity issues:
  - INDEX.md not found — run /codetographer to initialize
  - Hook scripts missing at expected paths
Run /sanity for details.
```

Fix note format:
```
⚠ Codetographer sanity: fixed 2 issue(s). Run /sanity for details.
```

**Validation:**
```bash
npm run build:hooks
```
Build succeeds. Manual verification: the compiled `hooks/session-start.js` should import from `./dist/sanity.js` (after copy-hooks.js patching).

---

## Phase Gate
```bash
npm run build:hooks && npm test
```
Build succeeds, all tests pass. The session-start hook compiles and includes the sanity check import.
