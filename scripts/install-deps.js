#!/usr/bin/env node
/**
 * Copies package.json from CLAUDE_PLUGIN_ROOT to CLAUDE_PLUGIN_DATA
 * and runs npm install --production.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'];
const pluginData = process.env['CLAUDE_PLUGIN_DATA'];

if (!pluginRoot || !pluginData) {
  process.stderr.write('[codetographer] install-deps: CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA must be set\n');
  process.exit(1);
}

const srcPkg = join(pluginRoot, 'package.json');
const dstPkg = join(pluginData, 'package.json');

if (!existsSync(srcPkg)) {
  process.stderr.write(`[codetographer] install-deps: package.json not found at ${srcPkg}\n`);
  process.exit(1);
}

if (!existsSync(pluginData)) {
  mkdirSync(pluginData, { recursive: true });
}

// Copy package.json
copyFileSync(srcPkg, dstPkg);

// Run npm install
try {
  execSync('npm install --production --legacy-peer-deps', {
    cwd: pluginData,
    stdio: 'inherit',
  });
} catch (err) {
  // Check if better-sqlite3 compilation failed
  const nodeModules = join(pluginData, 'node_modules');
  const betterSqlite = join(nodeModules, 'better-sqlite3');

  if (!existsSync(betterSqlite)) {
    const platform = process.platform;
    const arch = process.arch;
    process.stderr.write(
      `[codetographer] Warning: better-sqlite3 native compilation failed on ${platform}/${arch}.\n` +
      `  This requires build tools: Visual Studio Build Tools (Windows) or build-essential (Linux).\n` +
      `  Codetographer will fall back to JSON file cache — functionality is identical but slower for large repos.\n`
    );
  }

  // Don't exit 1 just because better-sqlite3 failed
  // Check if other deps installed correctly
  const mcp = join(nodeModules, '@modelcontextprotocol');
  if (!existsSync(mcp)) {
    process.stderr.write(`[codetographer] install-deps: critical dependency installation failed\n`);
    process.exit(1);
  }
}

process.stdout.write('[codetographer] install-deps: complete\n');
process.exit(0);
