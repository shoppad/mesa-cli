/**
 * Trigger Registry Service
 *
 * Handles fetching and caching of app/trigger metadata for the workflow create wizard.
 * Provides search functionality for finding apps and their available triggers/actions.
 */

import { search } from '@inquirer/prompts';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  TriggerRegistry,
  TriggerRegistryEntry,
  AppConfig,
} from '../../types/index.js';
import type { MesaClient } from '../client.js';

// Cache configuration
const CACHE_DIR = join(homedir(), '.mesa', 'cache', 'triggers');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Service for managing trigger/app metadata
 */
export class TriggerRegistryService {
  private registry: TriggerRegistry | null = null;
  private appConfigCache: Map<string, AppConfig> = new Map();

  constructor(private client: MesaClient) {}

  /**
   * Load the trigger registry (list of all available apps)
   */
  async loadRegistry(): Promise<TriggerRegistry> {
    if (this.registry) {
      return this.registry;
    }

    // Try cache first
    const cached = this.loadFromCache<TriggerRegistry>('registry');
    if (cached) {
      this.registry = cached;
      return cached;
    }

    // Fetch from API
    try {
      this.registry = await this.client.getTriggerRegistry();
      this.saveToCache('registry', this.registry);
      return this.registry;
    } catch (error) {
      // Try stale cache as fallback
      const staleCache = this.loadFromCache<TriggerRegistry>('registry', true);
      if (staleCache) {
        console.warn('Using stale cache for trigger registry');
        this.registry = staleCache;
        return staleCache;
      }
      throw error;
    }
  }

  /**
   * Get all available inputs (triggers) or outputs (actions)
   */
  async getEntries(type: 'input' | 'output'): Promise<TriggerRegistryEntry[]> {
    const registry = await this.loadRegistry();
    return type === 'input' ? registry.inputs : registry.outputs;
  }

  /**
   * Search for apps interactively
   * @param type - Whether to search inputs (triggers) or outputs (actions)
   * @returns The selected registry entry
   */
  async searchApps(type: 'input' | 'output'): Promise<TriggerRegistryEntry> {
    const entries = await this.getEntries(type);
    const label = type === 'input' ? 'trigger' : 'action';

    // Sort by weight (lower = more popular)
    const sortedEntries = [...entries].sort((a, b) => (a.weight ?? 100) - (b.weight ?? 100));

    const selected = await search<TriggerRegistryEntry>({
      message: `Search for ${label}:`,
      source: async (input) => {
        const term = (input ?? '').toLowerCase();
        const filtered = sortedEntries.filter(
          (e) =>
            e.name.toLowerCase().includes(term) ||
            e.key.toLowerCase().includes(term) ||
            (e.tags ?? []).some((t) => t.toLowerCase().includes(term))
        );

        return filtered.map((e) => ({
          name: e.name,
          value: e,
          description: e.is_pro ? 'Pro' : e.tags?.join(', ') || undefined,
        }));
      },
    });

    return selected;
  }

  /**
   * Get full app configuration with entities and actions
   * @param appKey - The app key (e.g., 'shopify')
   * @param type - Whether this is an input or output
   */
  async getAppConfig(appKey: string, type: 'input' | 'output'): Promise<AppConfig> {
    const cacheKey = `${appKey}:${type}`;

    // Check in-memory cache
    if (this.appConfigCache.has(cacheKey)) {
      return this.appConfigCache.get(cacheKey)!;
    }

    // Check file cache
    const cached = this.loadFromCache<AppConfig>(cacheKey);
    if (cached) {
      this.appConfigCache.set(cacheKey, cached);
      return cached;
    }

    // Fetch from API
    try {
      const config = await this.client.getAppConfig(appKey, type);
      this.appConfigCache.set(cacheKey, config);
      this.saveToCache(cacheKey, config);
      return config;
    } catch (error) {
      // Try stale cache as fallback
      const staleCache = this.loadFromCache<AppConfig>(cacheKey, true);
      if (staleCache) {
        console.warn(`Using stale cache for ${appKey} ${type} config`);
        this.appConfigCache.set(cacheKey, staleCache);
        return staleCache;
      }
      throw error;
    }
  }

  /**
   * Check if an app requires OAuth authentication
   */
  requiresOAuth(config: AppConfig): boolean {
    return config.fields.some(
      (f) => f.type === 'secret' && f.secret_type === 'oauth' && f.oauth_provider
    );
  }

  /**
   * Get the OAuth provider name if the app requires OAuth
   */
  getOAuthProvider(config: AppConfig): string | undefined {
    const oauthField = config.fields.find(
      (f) => f.type === 'secret' && f.secret_type === 'oauth'
    );
    return oauthField?.oauth_provider;
  }

  /**
   * Get available secrets/connections for a secret type
   */
  async getSecrets(secretType: string): Promise<{ _id: string; name: string; is_default?: boolean }[]> {
    try {
      return await this.client.getSecrets(secretType);
    } catch {
      return [];
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.registry = null;
    this.appConfigCache.clear();

    if (existsSync(CACHE_DIR)) {
      const files = readdirSync(CACHE_DIR);
      for (const file of files) {
        unlinkSync(join(CACHE_DIR, file));
      }
    }
  }

  /**
   * Load data from file cache
   */
  private loadFromCache<T>(key: string, ignoreExpiry = false): T | null {
    try {
      const filePath = this.getCacheFilePath(key);
      if (!existsSync(filePath)) {
        return null;
      }

      const content = readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check if cache is expired
      if (!ignoreExpiry && Date.now() - entry.timestamp > CACHE_TTL_MS) {
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Save data to file cache
   */
  private saveToCache<T>(key: string, data: T): void {
    try {
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }

      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
      };

      const filePath = this.getCacheFilePath(key);
      writeFileSync(filePath, JSON.stringify(entry, null, 2));
    } catch {
      // Ignore cache write failures
    }
  }

  /**
   * Get the file path for a cache key
   */
  private getCacheFilePath(key: string): string {
    // Sanitize key for use as filename
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(CACHE_DIR, `${sanitizedKey}.json`);
  }
}
