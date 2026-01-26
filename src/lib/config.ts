/**
 * Configuration loading and management for mesa-cli
 *
 * Config files are YAML and can be stored in:
 * 1. Local: ./config/config.yml or ./config/{env}.yml
 * 2. Global: ~/.mesa/config.yml or ~/.mesa/config/{env}.yml
 *
 * The config contains uuid and key for API authentication.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { MesaConfig, StoredCredentials } from '../types/index.js';
import { isObject } from '../types/index.js';

/** Default MESA API URL */
const DEFAULT_API_URL = 'https://api.getmesa.com/v1/admin';

/** Global config directory */
const GLOBAL_CONFIG_DIR = join(homedir(), '.mesa');

/** Config file name */
const CONFIG_FILE = 'config.yml';

/**
 * Error thrown when configuration cannot be loaded
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Result of loading config, includes the source path
 */
export interface LoadedConfig {
  config: MesaConfig;
  source: 'local' | 'global';
  path: string;
}

/**
 * Parse YAML config file and extract environment-specific config
 */
function parseConfigFile(
  content: string,
  env: string | null
): MesaConfig | null {
  const parsed: unknown = parseYaml(content);

  if (!isObject(parsed)) {
    return null;
  }

  // If env is specified, look for that key
  if (env && env in parsed) {
    const envConfig = parsed[env];
    if (isValidConfig(envConfig)) {
      return normalizeConfig(envConfig);
    }
  }

  // Try 'default' environment
  if ('default' in parsed) {
    const defaultConfig = parsed.default;
    if (isValidConfig(defaultConfig)) {
      return normalizeConfig(defaultConfig);
    }
  }

  // Try root level (flat config without environments)
  if (isValidConfig(parsed)) {
    return normalizeConfig(parsed);
  }

  return null;
}

/**
 * Check if a value looks like valid config
 */
function isValidConfig(value: unknown): value is Record<string, unknown> & { uuid: string; key: string } {
  return (
    isObject(value) &&
    typeof value.uuid === 'string' &&
    typeof value.key === 'string'
  );
}

/**
 * Normalize config to ensure required fields
 */
function normalizeConfig(raw: Record<string, unknown>): MesaConfig {
  return {
    uuid: String(raw.uuid),
    key: String(raw.key),
    api_url: typeof raw.api_url === 'string' ? raw.api_url : undefined,
  };
}

/**
 * Try to load config from a specific directory
 */
function tryLoadFromDir(
  baseDir: string,
  env: string | null
): MesaConfig | null {
  // Try environment-specific file first
  if (env) {
    const envPath = join(baseDir, 'config', `${env}.yml`);
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      const config = parseConfigFile(content, env);
      if (config) return config;
    }
  }

  // Try main config file
  const configPath = join(baseDir, 'config', CONFIG_FILE);
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8');
    const config = parseConfigFile(content, env);
    if (config) return config;
  }

  // Try config.yml in base directory
  const rootConfigPath = join(baseDir, CONFIG_FILE);
  if (existsSync(rootConfigPath)) {
    const content = readFileSync(rootConfigPath, 'utf-8');
    const config = parseConfigFile(content, env);
    if (config) return config;
  }

  return null;
}

/**
 * Load configuration from local or global config files
 *
 * Search order:
 * 1. Local ./config/{env}.yml (if env specified)
 * 2. Local ./config/config.yml
 * 3. Local ./config.yml
 * 4. Global ~/.mesa/config/{env}.yml (if env specified)
 * 5. Global ~/.mesa/config/config.yml
 * 6. Global ~/.mesa/config.yml
 *
 * @param cwd - Current working directory
 * @param env - Environment name (optional, can come from ENV env var)
 * @throws ConfigError if no valid config found
 */
export function loadConfig(cwd: string, env?: string | null): LoadedConfig {
  // Use ENV environment variable as fallback
  const resolvedEnv = env ?? process.env.ENV ?? null;

  // Try local config first
  const localConfig = tryLoadFromDir(cwd, resolvedEnv);
  if (localConfig) {
    const localPath = existsSync(join(cwd, 'config', CONFIG_FILE))
      ? join(cwd, 'config', CONFIG_FILE)
      : join(cwd, CONFIG_FILE);
    return {
      config: localConfig,
      source: 'local',
      path: localPath,
    };
  }

  // Try global config
  const globalConfig = tryLoadFromDir(GLOBAL_CONFIG_DIR, resolvedEnv);
  if (globalConfig) {
    const globalPath = existsSync(join(GLOBAL_CONFIG_DIR, 'config', CONFIG_FILE))
      ? join(GLOBAL_CONFIG_DIR, 'config', CONFIG_FILE)
      : join(GLOBAL_CONFIG_DIR, CONFIG_FILE);
    return {
      config: globalConfig,
      source: 'global',
      path: globalPath,
    };
  }

  const configFile = resolvedEnv ?? CONFIG_FILE;
  throw new ConfigError(
    `Could not find ${configFile}. ` +
      `Create one in ./config/ or ~/.mesa/ with uuid and key fields.`
  );
}

/**
 * Get the API URL from config or use default
 */
export function getApiUrl(config: MesaConfig): string {
  return config.api_url ?? DEFAULT_API_URL;
}

/**
 * Get path to global credentials file
 */
export function getCredentialsPath(): string {
  return join(GLOBAL_CONFIG_DIR, CONFIG_FILE);
}

/**
 * Save credentials after successful authentication
 * Creates ~/.mesa/config.yml with uuid and key
 *
 * @param credentials - The credentials to store
 * @param apiUrl - Optional API URL override (for dev environment)
 */
export function saveCredentials(
  credentials: StoredCredentials,
  apiUrl?: string
): string {
  const configDir = GLOBAL_CONFIG_DIR;
  const configPath = join(configDir, CONFIG_FILE);

  // Ensure directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Build config content
  const config: Record<string, unknown> = {
    uuid: credentials.uuid,
    key: credentials.key,
    // Include comment about when this was authenticated
    _authenticated_at: credentials.authenticated_at,
  };

  if (apiUrl) {
    config.api_url = apiUrl;
  }

  const content = stringifyYaml(config, {
    lineWidth: 0, // Don't wrap lines
  });

  // Write with restrictive permissions (owner read/write only)
  writeFileSync(configPath, content, { mode: 0o600 });

  return configPath;
}

/**
 * Check if credentials exist
 */
export function hasCredentials(): boolean {
  const configPath = getCredentialsPath();
  if (!existsSync(configPath)) {
    return false;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed: unknown = parseYaml(content);
    return isValidConfig(parsed);
  } catch {
    return false;
  }
}

/**
 * Clear stored credentials
 */
export function clearCredentials(): boolean {
  const configPath = getCredentialsPath();
  if (existsSync(configPath)) {
    // Instead of deleting, write an empty file or comment
    writeFileSync(
      configPath,
      '# Credentials cleared. Run `mesa auth login` to authenticate.\n',
      { mode: 0o600 }
    );
    return true;
  }
  return false;
}

export { DEFAULT_API_URL, GLOBAL_CONFIG_DIR };
