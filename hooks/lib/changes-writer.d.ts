/**
 * Append a change entry to changes.md with LF line endings.
 * Updates domain-touched metadata comment at top.
 * Trims to MAX_LINES if exceeded.
 */
export declare function appendChange(projectDir: string, filePath: string, domain?: string, timestamp?: string): void;
