/**
 * Cache command
 *
 * Manages the mesa-cli local cache.
 */

import { Command } from 'commander';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_DIR = join(homedir(), '.mesa', 'cache');

/**
 * Register cache commands
 */
export function registerCacheCommand(program: Command): void {
  const cache = program
    .command('cache')
    .description('Manage mesa-cli cache');

  cache
    .command('clear')
    .description('Clear all cached data (triggers, app configs)')
    .action(() => {
      clearCache();
    });

  cache
    .command('status')
    .description('Show cache status and location')
    .action(() => {
      showCacheStatus();
    });
}

/**
 * Clear all cached data
 */
function clearCache(): void {
  if (!existsSync(CACHE_DIR)) {
    console.log('Cache directory does not exist. Nothing to clear.');
    return;
  }

  try {
    // Remove the entire cache directory
    rmSync(CACHE_DIR, { recursive: true, force: true });
    console.log('Cache cleared successfully.');
    console.log(`Removed: ${CACHE_DIR}`);
  } catch (error) {
    console.error('Failed to clear cache:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Show cache status
 */
function showCacheStatus(): void {
  console.log(`Cache location: ${CACHE_DIR}`);
  console.log('');

  if (!existsSync(CACHE_DIR)) {
    console.log('Cache is empty (directory does not exist).');
    return;
  }

  // Count cached files
  const triggersDir = join(CACHE_DIR, 'triggers');
  let triggerFiles = 0;
  let totalSize = 0;

  if (existsSync(triggersDir)) {
    const files = readdirSync(triggersDir);
    triggerFiles = files.length;

    for (const file of files) {
      try {
        const stats = statSync(join(triggersDir, file));
        totalSize += stats.size;
      } catch {
        // Ignore errors
      }
    }
  }

  console.log('Cached items:');
  console.log(`  Triggers/Apps: ${triggerFiles} files`);
  console.log(`  Total size: ${formatBytes(totalSize)}`);
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
