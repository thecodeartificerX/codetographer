export interface Tag {
  file: string;       // relative path (forward slashes)
  name: string;       // identifier
  line: number;       // 1-based line number
  kind: 'def' | 'ref';
  signature?: string; // full signature line for defs
  scope?: string;     // parent class/module name
}

export interface FileEntry {
  relativePath: string; // forward slashes
  language: string;
  mtime: number;
  tags: Tag[];
}

export interface DiscoveredFile {
  relativePath: string; // forward slashes
  language: string;
  absolutePath: string;
}
