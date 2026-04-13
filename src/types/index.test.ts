/**
 * Basic smoke tests for type guards
 *
 * Uses Node.js built-in test runner (Node 18+)
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isObject,
  isArray,
  isMesaConfig,
  isMesaAutomation,
  isApiError,
} from './index.js';

describe('Type Guards', () => {
  describe('isObject', () => {
    it('returns true for plain objects', () => {
      assert.strictEqual(isObject({}), true);
      assert.strictEqual(isObject({ key: 'value' }), true);
    });

    it('returns false for arrays', () => {
      assert.strictEqual(isObject([]), false);
      assert.strictEqual(isObject([1, 2, 3]), false);
    });

    it('returns false for null', () => {
      assert.strictEqual(isObject(null), false);
    });

    it('returns false for primitives', () => {
      assert.strictEqual(isObject('string'), false);
      assert.strictEqual(isObject(123), false);
      assert.strictEqual(isObject(true), false);
      assert.strictEqual(isObject(undefined), false);
    });
  });

  describe('isArray', () => {
    it('returns true for arrays', () => {
      assert.strictEqual(isArray([]), true);
      assert.strictEqual(isArray([1, 2, 3]), true);
      assert.strictEqual(isArray(['a', 'b']), true);
    });

    it('returns false for objects', () => {
      assert.strictEqual(isArray({}), false);
    });

    it('returns false for primitives', () => {
      assert.strictEqual(isArray('string'), false);
      assert.strictEqual(isArray(123), false);
    });
  });

  describe('isMesaConfig', () => {
    it('returns true for valid config', () => {
      const config = {
        uuid: 'test-uuid',
        key: 'test-key',
      };
      assert.strictEqual(isMesaConfig(config), true);
    });

    it('returns true for config with optional api_url', () => {
      const config = {
        uuid: 'test-uuid',
        key: 'test-key',
        api_url: 'https://api.example.com',
      };
      assert.strictEqual(isMesaConfig(config), true);
    });

    it('returns false for missing uuid', () => {
      const config = { key: 'test-key' };
      assert.strictEqual(isMesaConfig(config), false);
    });

    it('returns false for missing key', () => {
      const config = { uuid: 'test-uuid' };
      assert.strictEqual(isMesaConfig(config), false);
    });

    it('returns false for non-objects', () => {
      assert.strictEqual(isMesaConfig(null), false);
      assert.strictEqual(isMesaConfig('string'), false);
      assert.strictEqual(isMesaConfig([]), false);
    });
  });

  describe('isMesaAutomation', () => {
    it('returns true for valid automation', () => {
      const automation = {
        key: 'my-automation',
        name: 'My Automation',
        version: '1.0.0',
      };
      assert.strictEqual(isMesaAutomation(automation), true);
    });

    it('returns false for missing required fields', () => {
      assert.strictEqual(isMesaAutomation({ key: 'test' }), false);
      assert.strictEqual(isMesaAutomation({ key: 'test', name: 'Test' }), false);
    });

    it('returns false for non-objects', () => {
      assert.strictEqual(isMesaAutomation(null), false);
      assert.strictEqual(isMesaAutomation([]), false);
    });
  });

  describe('isApiError', () => {
    it('returns true for error responses', () => {
      assert.strictEqual(isApiError({ error: 'Something went wrong' }), true);
      assert.strictEqual(isApiError({ message: 'Not found' }), true);
      assert.strictEqual(isApiError({ error: 'Error', status: 500 }), true);
    });

    it('returns false for non-error objects', () => {
      assert.strictEqual(isApiError({}), false);
      assert.strictEqual(isApiError({ success: true }), false);
    });

    it('returns false for non-objects', () => {
      assert.strictEqual(isApiError(null), false);
      assert.strictEqual(isApiError('error'), false);
    });
  });
});
