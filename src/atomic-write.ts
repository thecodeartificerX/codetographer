import { writeFileSync, renameSync, unlinkSync, existsSync } from 'fs';

/**
 * Atomically write content to filePath.
 * Writes to a .tmp file first, then renames.
 * On Windows, EPERM rename errors are handled by unlink+rename fallback.
 * Always uses LF line endings.
 */
export function atomicWrite(filePath: string, content: string): void {
  // Normalize to LF
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const tmpPath = filePath + '.tmp';

  writeFileSync(tmpPath, normalized, { encoding: 'utf-8' });

  try {
    renameSync(tmpPath, filePath);
  } catch (err: unknown) {
    // Windows EPERM: target file may be locked — unlink first then rename
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') {
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
        renameSync(tmpPath, filePath);
      } catch (err2: unknown) {
        // Last resort: direct write
        writeFileSync(filePath, normalized, { encoding: 'utf-8' });
        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    } else {
      throw err;
    }
  }
}
