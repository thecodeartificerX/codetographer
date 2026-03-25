#!/usr/bin/env node
/**
 * Copies compiled files from dist/ to their runtime locations.
 *
 * Structure:
 *   dist/*.js          → hooks/dist/*.js  (shared modules - hooks import from ../dist/)
 *   dist/hooks/*.js    → hooks/           (hook entry points)
 *   dist/hooks/lib/    → hooks/lib/       (hook lib files)
 *   dist/mcp/          → mcp/             (MCP server)
 *   dist/treesitter-map.js → scripts/treesitter-map.js
 *
 * However, because compiled TypeScript imports use relative paths,
 * we need to replicate the dist/ structure alongside the hooks.
 * Strategy: copy the full dist/ tree into hooks/dist/, and patch
 * imports in hook entry points to use ./dist/ prefix.
 *
 * Actually simplest: copy all dist files into the hooks/ directory
 * so relative imports resolve correctly.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function copyDir(src, dst) {
  ensureDir(dst);
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

const distDir = join(projectRoot, 'dist');
const hooksDir = join(projectRoot, 'hooks');
const mcpDir = join(projectRoot, 'mcp');

ensureDir(hooksDir);
ensureDir(mcpDir);

// Copy the entire dist/ tree into hooks/dist/
// This preserves all relative imports from hook files
const hooksDist = join(hooksDir, 'dist');
if (existsSync(hooksDist)) {
  // Remove old dist copy
  for (const entry of readdirSync(hooksDist)) {
    const p = join(hooksDist, entry);
    if (statSync(p).isDirectory()) {
      copyDir(join(distDir, entry), p);
    } else {
      copyFileSync(join(distDir, entry), p);
    }
  }
}
copyDir(distDir, hooksDist);
console.log('copied: dist/ → hooks/dist/');

// Copy hook entry points to hooks/ root and patch their imports
// The compiled hooks in dist/hooks/*.js import from '../...' (relative to dist/hooks/)
// When moved to hooks/, those same relative paths go to hooks/../... = project root
// Since we also copied dist/ to hooks/dist/, we need to patch: '../xxx' → './dist/xxx'
// But actually the entry points import: './lib/context-loader.js' (same hooks/lib)
// and the stop.ts imports: '../map-generator.js' → '../../dist/map-generator.js' when in hooks/

// Simplest approach: copy dist/hooks/*.js → hooks/ AND patch '../' → './dist/' in those files
for (const entry of readdirSync(join(distDir, 'hooks'))) {
  const srcPath = join(distDir, 'hooks', entry);
  const stat = statSync(srcPath);
  if (stat.isFile() && entry.endsWith('.js')) {
    const content = readFileSync(srcPath, 'utf-8');
    // Patch imports: '../xxx.js' → './dist/xxx.js' (one level up goes to dist/)
    const patched = content.replace(/from '\.\.\/([^']+)'/g, "from './dist/$1'");
    writeFileSync(join(hooksDir, entry), patched);
    console.log(`copied+patched: dist/hooks/${entry} → hooks/${entry}`);
  }
}

// Copy dist/hooks/lib/ → hooks/lib/ AND patch their imports
// hooks/lib files import '../../atomic-write.js' which from hooks/lib/ would go to codetographer root
// We need to patch: '../../xxx.js' → '../dist/xxx.js'
const distHooksLib = join(distDir, 'hooks', 'lib');
const hooksLib = join(hooksDir, 'lib');
ensureDir(hooksLib);
for (const entry of readdirSync(distHooksLib)) {
  const srcPath = join(distHooksLib, entry);
  if (entry.endsWith('.js')) {
    const content = readFileSync(srcPath, 'utf-8');
    // Patch: '../../xxx.js' → '../dist/xxx.js'
    const patched = content.replace(/from '\.\.\/\.\.\/([^']+)'/g, "from '../dist/$1'");
    writeFileSync(join(hooksLib, entry), patched);
    console.log(`copied+patched: dist/hooks/lib/${entry} → hooks/lib/${entry}`);
  }
}

// Copy mcp/server.js AND patch imports: '../xxx.js' → '../hooks/dist/xxx.js'
const distMcp = join(distDir, 'mcp');
for (const entry of readdirSync(distMcp)) {
  if (entry.endsWith('.js')) {
    const content = readFileSync(join(distMcp, entry), 'utf-8');
    // mcp/server.js imports '../tag-cache.js' etc → '../hooks/dist/tag-cache.js'
    const patched = content.replace(/from '\.\.\/([^']+)'/g, "from '../hooks/dist/$1'");
    writeFileSync(join(mcpDir, entry), patched);
    console.log(`copied+patched: dist/mcp/${entry} → mcp/${entry}`);
  }
}

// Copy scripts/treesitter-map.js
const distMapSrc = join(distDir, 'treesitter-map.js');
if (existsSync(distMapSrc)) {
  const content = readFileSync(distMapSrc, 'utf-8');
  // scripts/treesitter-map.js imports './map-generator.js', './atomic-write.js'
  // When moved to scripts/, '../dist/' is the right location
  const patched = content.replace(/from '\.\/([^']+)'/g, "from '../hooks/dist/$1'");
  writeFileSync(join(projectRoot, 'scripts', 'treesitter-map.js'), patched);
  console.log('copied+patched: dist/treesitter-map.js → scripts/treesitter-map.js');
}

// Copy scripts/sanity.js
const distSanitySrc = join(distDir, 'sanity.js');
if (existsSync(distSanitySrc)) {
  const content = readFileSync(distSanitySrc, 'utf-8');
  // scripts/sanity.js imports './map-generator.js', './atomic-write.js', './hooks/lib/recent-activity.js'
  // When moved to scripts/, '../hooks/dist/' is the right location.
  // The single regex handles both './map-generator.js' and './hooks/lib/recent-activity.js'
  // because both match /from '\.\/([^']+)'/ and become '../hooks/dist/<rest>'
  const patched = content.replace(/from '\.\/([^']+)'/g, "from '../hooks/dist/$1'");
  writeFileSync(join(projectRoot, 'scripts', 'sanity.js'), patched);
  console.log('copied+patched: dist/sanity.js → scripts/sanity.js');
}

console.log('Build complete.');
