/**
 * Load context from codetographer docs.
 * Returns combined INDEX.md (truncated to 200 lines) + last 10 lines of changes.md.
 * Returns null if codetographer not initialized (no INDEX.md).
 */
export declare function loadContext(projectDir: string): string | null;
