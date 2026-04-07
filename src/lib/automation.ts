/**
 * Automation utilities for mesa-cli
 *
 * Handles reading mesa.json files and extracting automation keys.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MesaAutomation } from '../types/index.js';
import { isObject } from '../types/index.js';

/**
 * Error thrown when automation operations fail
 */
export class AutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationError';
  }
}

/**
 * Parse mesa.json content and validate structure
 */
function parseMesaJson(content: string): MesaAutomation | null {
  try {
    const parsed: unknown = JSON.parse(content);

    if (!isObject(parsed)) {
      return null;
    }

    // Minimal validation - must have key
    if (typeof parsed.key !== 'string') {
      return null;
    }

    // Build the automation object with defaults
    return {
      key: parsed.key,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.key,
      version: typeof parsed.version === 'string' ? parsed.version : '1.0.0',
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      config: isObject(parsed.config) ? (parsed.config as MesaAutomation['config']) : undefined,
      triggers: Array.isArray(parsed.triggers) ? (parsed.triggers as MesaAutomation['triggers']) : undefined,
      actions: Array.isArray(parsed.actions) ? (parsed.actions as MesaAutomation['actions']) : undefined,
      readme: typeof parsed.readme === 'string' ? parsed.readme : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Load mesa.json from a directory
 */
export function loadMesaJson(dir: string): MesaAutomation | null {
  // Try mesa.json first
  const mesaJsonPath = join(dir, 'mesa.json');
  if (existsSync(mesaJsonPath)) {
    const content = readFileSync(mesaJsonPath, 'utf-8');
    return parseMesaJson(content);
  }

  // Fall back to mesa-collection.json
  const collectionPath = join(dir, 'mesa-collection.json');
  if (existsSync(collectionPath)) {
    const content = readFileSync(collectionPath, 'utf-8');
    return parseMesaJson(content);
  }

  return null;
}

/**
 * Get automation key from various sources
 *
 * Priority:
 * 1. Explicit automation option from CLI
 * 2. mesa.json in the same directory as the file
 * 3. mesa.json in the current working directory
 *
 * @param explicitKey - Automation key from CLI option
 * @param filepath - Path to a file being operated on
 * @param cwd - Current working directory
 */
export function getAutomationKey(
  explicitKey: string | undefined,
  filepath: string | undefined,
  cwd: string
): string {
  // Use explicit key if provided
  if (explicitKey) {
    return explicitKey;
  }

  // Try directory of the file first
  if (filepath) {
    const fileDir = dirname(filepath);
    const mesa = loadMesaJson(fileDir);
    if (mesa?.key) {
      return mesa.key;
    }
  }

  // Try current working directory
  const cwdMesa = loadMesaJson(cwd);
  if (cwdMesa?.key) {
    return cwdMesa.key;
  }

  throw new AutomationError(
    'Could not determine automation key. ' +
      'Specify with -a option or ensure mesa.json exists with a "key" field.'
  );
}

/**
 * Read mesa.json and optionally include README.md content
 */
export function readMesaJsonWithReadme(
  filepath: string
): Record<string, unknown> | null {
  if (!existsSync(filepath)) {
    return null;
  }

  const content = readFileSync(filepath, 'utf-8');
  let mesa: Record<string, unknown>;

  try {
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed)) {
      return null;
    }
    mesa = parsed;
  } catch {
    return null;
  }

  // Try to include README.md
  const dir = dirname(filepath);
  const readmePath = join(dir, 'README.md');
  if (existsSync(readmePath)) {
    try {
      const readme = readFileSync(readmePath, 'utf-8');
      mesa.readme = readme;
    } catch {
      // Ignore README read errors
    }
  }

  return mesa;
}

/**
 * Discover script files referenced from mesa.json's
 * config.{inputs,outputs}[*].metadata.script and resolve them to absolute paths
 * relative to the directory containing mesa.json.
 *
 * Missing files are warned about and skipped, not thrown — this lets push
 * succeed when a workflow has not-yet-uploaded script references.
 */
export function discoverReferencedScripts(mesaJsonPath: string): string[] {
  const mesa = readMesaJsonWithReadme(mesaJsonPath);
  if (!mesa || !isObject(mesa.config)) {
    return [];
  }

  const dir = dirname(mesaJsonPath);
  const filenames = new Set<string>();

  for (const triggerType of ['inputs', 'outputs'] as const) {
    const triggers = mesa.config[triggerType];
    if (!Array.isArray(triggers)) continue;
    for (const trigger of triggers) {
      if (!isObject(trigger)) continue;
      const metadata = trigger.metadata;
      if (!isObject(metadata)) continue;
      const script = metadata.script;
      if (typeof script === 'string' && script.length > 0) {
        filenames.add(script);
      }
    }
  }

  const resolved: string[] = [];
  for (const filename of filenames) {
    const filepath = join(dir, filename);
    if (existsSync(filepath)) {
      resolved.push(filepath);
    } else {
      console.warn(
        `Warning: script "${filename}" referenced in mesa.json but not found on disk; skipping.`
      );
    }
  }

  return resolved;
}

/**
 * Check if a file is a mesa.json file
 */
export function isMesaJsonFile(filename: string): boolean {
  return filename.includes('mesa.json') || filename.includes('mesa-collection.json');
}

/**
 * Check if a file is a script file (.js)
 */
export function isScriptFile(filename: string): boolean {
  return filename.endsWith('.js');
}

/**
 * Check if a file should be processed by the CLI
 */
export function isProcessableFile(filename: string): boolean {
  return isScriptFile(filename) || isMesaJsonFile(filename);
}
