# Phase 1: Extract Shared Utilities

## Gotchas
- `updateRecentActivity` in `stop.ts` uses `atomicWrite` — the extracted module must import it from the correct relative path (`../../atomic-write.js` from `src/hooks/lib/`)
- All imports must use `.js` extensions (NodeNext module resolution)
- The function signature and behavior must remain identical — `stop.ts` must work exactly as before after the refactor

## Files
```
src/hooks/lib/
├── recent-activity.ts   # CREATE — extracted updateRecentActivity()
├── context-loader.ts    # unchanged
├── changes-writer.ts    # unchanged
└── domain-matcher.ts    # unchanged
src/hooks/
└── stop.ts              # MODIFY — import from ./lib/recent-activity.js
```

---

## Task 1: Extract `updateRecentActivity` to shared module

**Description:** Create `src/hooks/lib/recent-activity.ts` containing the `updateRecentActivity` function currently defined in `src/hooks/stop.ts` (lines 35-62). Export it as a named export.

**Acceptance criteria:**
- `updateRecentActivity(indexPath: string, changes: string[]): void` is exported from `src/hooks/lib/recent-activity.ts`
- It imports `atomicWrite` from `../../atomic-write.js` and `readFileSync`, `existsSync` from `fs`
- The function body is identical to the current implementation in `stop.ts`

**Files:**
- `src/hooks/lib/recent-activity.ts` — CREATE: single exported function

**Architecture notes:**
- Function signature: `export function updateRecentActivity(indexPath: string, changes: string[]): void`
- Imports needed: `{ existsSync, readFileSync }` from `'fs'`, `{ atomicWrite }` from `'../../atomic-write.js'`
- Logic: finds `## Recent Activity` section in INDEX.md, replaces with last 5 changes as `- <entry>` lines, writes via atomicWrite only if content changed

**Validation:** `npm run build` succeeds (tsc compiles the new file)

---

## Task 2: Update `stop.ts` to import from shared module

**Description:** Remove the inline `updateRecentActivity` function from `src/hooks/stop.ts` and replace it with an import from `./lib/recent-activity.js`.

**Acceptance criteria:**
- `stop.ts` no longer defines `updateRecentActivity` inline
- `stop.ts` imports `{ updateRecentActivity }` from `'./lib/recent-activity.js'`
- `stop.ts` still imports `{ readFileSync, existsSync, statSync, mkdirSync }` from `'fs'` (it uses these for its own logic)
- Existing behavior is unchanged

**Files:**
- `src/hooks/stop.ts` — MODIFY: remove function definition (lines 35-62), add import

**Validation:**
```bash
npm run build:hooks
```
Build succeeds and `hooks/dist/hooks/lib/recent-activity.js` exists in the output.

---

## Phase Gate
```bash
npm run build:hooks && npm test
```
All existing tests must still pass. The stop hook must still function correctly (manual verification: check that `hooks/dist/hooks/stop.js` has the import rewritten correctly by copy-hooks.js).
