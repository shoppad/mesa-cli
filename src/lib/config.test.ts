/**
 * Basic smoke tests for config module
 *
 * Uses Node.js built-in test runner (Node 18+)
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, ConfigError, getCredentialsPath, hasCredentials } from './config.js';

describe('Config Module', () => {
  const testDir = join(tmpdir(), 'mesa-cli-test-' + Date.now());

  // Setup: Create test directory
  it('setup test directory', () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    assert.ok(existsSync(testDir));
  });

  describe('loadConfig', () => {
    it('throws ConfigError when no config file exists (or falls back to global)', () => {
      const emptyDir = join(testDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });

      // loadConfig falls back to global ~/.mesa/config.yml if local doesn't exist
      // So behavior depends on whether global credentials are present
      if (hasCredentials()) {
        // If global credentials exist, loadConfig should return them (not throw)
        const result = loadConfig(emptyDir);
        assert.strictEqual(result.source, 'global');
      } else {
        // If no global credentials, loadConfig should throw
        assert.throws(
          () => loadConfig(emptyDir),
          (err) => err instanceof ConfigError
        );
      }
    });

    it('loads config from config.yml in working directory', () => {
      const configDir = join(testDir, 'with-config');
      mkdirSync(configDir, { recursive: true });

      // Create a config.yml file
      const configContent = `
uuid: test-uuid-12345
key: test-api-key-67890
`;
      writeFileSync(join(configDir, 'config.yml'), configContent);

      const result = loadConfig(configDir);

      assert.strictEqual(result.config.uuid, 'test-uuid-12345');
      assert.strictEqual(result.config.key, 'test-api-key-67890');
      assert.strictEqual(result.source, 'local');
    });

    it('loads config from config/ subdirectory', () => {
      const configDir = join(testDir, 'with-config-subdir');
      mkdirSync(join(configDir, 'config'), { recursive: true });

      const configContent = `
uuid: subdir-uuid
key: subdir-key
api_url: https://custom.api.com
`;
      writeFileSync(join(configDir, 'config', 'config.yml'), configContent);

      const result = loadConfig(configDir);

      assert.strictEqual(result.config.uuid, 'subdir-uuid');
      assert.strictEqual(result.config.key, 'subdir-key');
      assert.strictEqual(result.config.api_url, 'https://custom.api.com');
    });

    it('loads environment-specific config', () => {
      const configDir = join(testDir, 'with-env-config');
      mkdirSync(join(configDir, 'config'), { recursive: true });

      const devConfig = `
uuid: dev-uuid
key: dev-key
`;
      writeFileSync(join(configDir, 'config', 'development.yml'), devConfig);

      const result = loadConfig(configDir, 'development');

      assert.strictEqual(result.config.uuid, 'dev-uuid');
      assert.strictEqual(result.config.key, 'dev-key');
    });
  });

  describe('saveCredentials', () => {
    it('returns path to credentials file', () => {
      // Note: This doesn't actually save since we don't want to modify the real ~/.mesa
      const path = getCredentialsPath();
      assert.ok(path.includes('.mesa'));
      assert.ok(path.includes('config.yml'));
    });
  });

  // Cleanup
  it('cleanup test directory', () => {
    rmSync(testDir, { recursive: true, force: true });
    assert.ok(!existsSync(testDir));
  });
});
