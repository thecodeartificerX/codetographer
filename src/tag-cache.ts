import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { atomicWrite } from './atomic-write.js';
import type { Tag } from './types.js';

interface CacheEntry {
  mtime: number;
  tags: Tag[];
}

interface TagCache {
  get(file: string, mtime: number): Tag[] | null;
  set(file: string, mtime: number, tags: Tag[]): void;
  clear(): void;
  close(): void;
}

// SQLite cache implementation
class SqliteTagCache implements TagCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        file TEXT PRIMARY KEY,
        mtime REAL NOT NULL,
        tags_json TEXT NOT NULL
      )
    `);
  }

  get(file: string, mtime: number): Tag[] | null {
    const row = this.db.prepare('SELECT mtime, tags_json FROM tags WHERE file = ?').get(file);
    if (!row) return null;
    if (Math.abs((row as { mtime: number }).mtime - mtime) > 0.001) return null;
    try {
      return JSON.parse((row as { tags_json: string }).tags_json) as Tag[];
    } catch {
      return null;
    }
  }

  set(file: string, mtime: number, tags: Tag[]): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO tags (file, mtime, tags_json) VALUES (?, ?, ?)'
    ).run(file, mtime, JSON.stringify(tags));
  }

  clear(): void {
    this.db.exec('DELETE FROM tags');
  }

  close(): void {
    this.db.close();
  }
}

// JSON file fallback cache
class JsonFileTagCache implements TagCache {
  private filePath: string;
  private data: Map<string, CacheEntry>;
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = new Map();
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
        for (const [k, v] of Object.entries(parsed)) {
          this.data.set(k, v);
        }
      } catch { /* start fresh */ }
    }
  }

  get(file: string, mtime: number): Tag[] | null {
    const entry = this.data.get(file);
    if (!entry) return null;
    if (Math.abs(entry.mtime - mtime) > 0.001) return null;
    return entry.tags;
  }

  set(file: string, mtime: number, tags: Tag[]): void {
    this.data.set(file, { mtime, tags });
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of this.data) obj[k] = v;
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    atomicWrite(this.filePath, JSON.stringify(obj));
    this.dirty = false;
  }

  clear(): void {
    this.data.clear();
    this.dirty = true;
    this.flush();
  }

  close(): void {
    this.flush();
  }
}

export async function createTagCache(dataDir: string): Promise<TagCache> {
  const dbPath = join(dataDir, 'treesitter-cache', 'tags.db');
  const dbDir = dirname(dbPath);

  mkdirSync(dbDir, { recursive: true });

  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath);
    return new SqliteTagCache(db);
  } catch {
    // Native compilation failed — fall back to JSON cache
    process.stderr.write('[codetographer] better-sqlite3 unavailable, using JSON cache\n');
    const jsonPath = join(dataDir, 'treesitter-cache', 'tags.json');
    return new JsonFileTagCache(jsonPath);
  }
}

export type { TagCache };
