/**
 * Tests for token-picker module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractAvailableTokens,
  hasTokenReferences,
  extractTokenReferences,
  validateTokenReferences,
} from './token-picker.js';
import type { WorkflowStep } from '../../types/index.js';

describe('token-picker', () => {
  describe('extractAvailableTokens', () => {
    it('extracts tokens from simple response example', () => {
      const steps: WorkflowStep[] = [
        {
          key: 'shopify_order',
          name: 'Shopify - Order Created',
          type: 'trigger',
          app_key: 'shopify',
          entity_key: 'order',
          action_key: 'created',
          operation_id: 'orders_create',
          metadata: {},
          fields: [],
          field_values: {},
          response_example: {
            order: {
              id: 123456,
              name: '#1001',
              email: 'customer@example.com',
            },
          },
        },
      ];

      const tokens = extractAvailableTokens(steps);

      assert.ok(tokens.length > 0, 'Should extract tokens');

      // Check for specific tokens
      const idToken = tokens.find((t) => t.path === 'order.id');
      assert.ok(idToken, 'Should have order.id token');
      assert.strictEqual(idToken?.full_token, '{{shopify_order.order.id}}');

      const emailToken = tokens.find((t) => t.path === 'order.email');
      assert.ok(emailToken, 'Should have order.email token');
      assert.strictEqual(emailToken?.full_token, '{{shopify_order.order.email}}');
    });

    it('handles nested objects', () => {
      const steps: WorkflowStep[] = [
        {
          key: 'step1',
          name: 'Test Step',
          type: 'trigger',
          app_key: 'test',
          entity_key: 'test',
          action_key: 'test',
          operation_id: 'test',
          metadata: {},
          fields: [],
          field_values: {},
          response_example: {
            customer: {
              first_name: 'John',
              address: {
                city: 'New York',
                zip: '10001',
              },
            },
          },
        },
      ];

      const tokens = extractAvailableTokens(steps);

      const cityToken = tokens.find((t) => t.path === 'customer.address.city');
      assert.ok(cityToken, 'Should have nested city token');
      assert.strictEqual(cityToken?.full_token, '{{step1.customer.address.city}}');
    });

    it('handles arrays', () => {
      const steps: WorkflowStep[] = [
        {
          key: 'step1',
          name: 'Test Step',
          type: 'trigger',
          app_key: 'test',
          entity_key: 'test',
          action_key: 'test',
          operation_id: 'test',
          metadata: {},
          fields: [],
          field_values: {},
          response_example: {
            line_items: [
              {
                sku: 'SKU001',
                quantity: 2,
              },
            ],
          },
        },
      ];

      const tokens = extractAvailableTokens(steps);

      // Should have array item tokens
      const skuToken = tokens.find((t) => t.path === 'line_items.0.sku');
      assert.ok(skuToken, 'Should have array item sku token');
      assert.strictEqual(skuToken?.full_token, '{{step1.line_items.0.sku}}');

      // Should also have array token
      const arrayToken = tokens.find((t) => t.path === 'line_items');
      assert.ok(arrayToken, 'Should have array token');
    });

    it('returns empty array for steps without response_example', () => {
      const steps: WorkflowStep[] = [
        {
          key: 'step1',
          name: 'Test Step',
          type: 'trigger',
          app_key: 'test',
          entity_key: 'test',
          action_key: 'test',
          operation_id: 'test',
          metadata: {},
          fields: [],
          field_values: {},
        },
      ];

      const tokens = extractAvailableTokens(steps);
      assert.strictEqual(tokens.length, 0);
    });
  });

  describe('hasTokenReferences', () => {
    it('returns true for strings with tokens', () => {
      assert.strictEqual(hasTokenReferences('Hello {{step.name}}'), true);
      assert.strictEqual(hasTokenReferences('{{a.b}} and {{c.d}}'), true);
      assert.strictEqual(hasTokenReferences('{{step.order.id}}'), true);
    });

    it('returns false for strings without tokens', () => {
      assert.strictEqual(hasTokenReferences('Hello World'), false);
      assert.strictEqual(hasTokenReferences('No tokens here'), false);
      assert.strictEqual(hasTokenReferences('{ not a token }'), false);
      assert.strictEqual(hasTokenReferences(''), false);
    });
  });

  describe('extractTokenReferences', () => {
    it('extracts all token references', () => {
      const refs = extractTokenReferences('Hello {{step1.name}}, your order {{step2.order.id}} is ready');
      assert.strictEqual(refs.length, 2);
      assert.ok(refs.includes('{{step1.name}}'));
      assert.ok(refs.includes('{{step2.order.id}}'));
    });

    it('returns empty array for no tokens', () => {
      const refs = extractTokenReferences('No tokens here');
      assert.strictEqual(refs.length, 0);
    });
  });

  describe('validateTokenReferences', () => {
    it('validates tokens against available steps', () => {
      const result = validateTokenReferences(
        'Order {{step1.id}} from {{step2.customer}}',
        ['step1', 'step2']
      );
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.invalidTokens.length, 0);
    });

    it('detects invalid token references', () => {
      const result = validateTokenReferences(
        'Order {{step1.id}} from {{unknown.customer}}',
        ['step1', 'step2']
      );
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.invalidTokens.length, 1);
      assert.ok(result.invalidTokens.includes('{{unknown.customer}}'));
    });

    it('handles strings without tokens', () => {
      const result = validateTokenReferences('No tokens', ['step1']);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.invalidTokens.length, 0);
    });
  });
});
