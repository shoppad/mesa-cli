/**
 * Tests for serializer module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateWorkflowInput,
  serializeWorkflow,
  parseWorkflow,
} from './serializer.js';
import type { MesaAutomation, WorkflowCreateInput } from '../../types/index.js';

describe('serializer', () => {
  describe('validateWorkflowInput', () => {
    it('accepts valid workflow input', () => {
      const input: WorkflowCreateInput = {
        name: 'Test Workflow',
        steps: [
          {
            type: 'trigger',
            app: 'shopify',
            entity: 'order',
            action: 'created',
          },
          {
            type: 'action',
            app: 'slack',
            entity: 'message',
            action: 'send',
            fields: {
              channel: '#orders',
            },
          },
        ],
      };

      // Should not throw
      assert.doesNotThrow(() => validateWorkflowInput(input));
    });

    it('rejects input without name', () => {
      const input = {
        steps: [{ type: 'trigger', app: 'test', entity: 'test', action: 'test' }],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /name.*required/i
      );
    });

    it('rejects input without steps', () => {
      const input = {
        name: 'Test',
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /steps.*required/i
      );
    });

    it('rejects empty steps array', () => {
      const input = {
        name: 'Test',
        steps: [],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /at least one step/i
      );
    });

    it('rejects first step that is not a trigger', () => {
      const input = {
        name: 'Test',
        steps: [
          { type: 'action', app: 'test', entity: 'test', action: 'test' },
        ],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /first step must be a trigger/i
      );
    });

    it('rejects step with invalid type', () => {
      const input = {
        name: 'Test',
        steps: [
          { type: 'invalid', app: 'test', entity: 'test', action: 'test' },
        ],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /type.*must be/i
      );
    });

    it('rejects step without app', () => {
      const input = {
        name: 'Test',
        steps: [
          { type: 'trigger', entity: 'test', action: 'test' },
        ],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /app.*required/i
      );
    });

    it('rejects step without entity', () => {
      const input = {
        name: 'Test',
        steps: [
          { type: 'trigger', app: 'test', action: 'test' },
        ],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /entity.*required/i
      );
    });

    it('rejects step without action', () => {
      const input = {
        name: 'Test',
        steps: [
          { type: 'trigger', app: 'test', entity: 'test' },
        ],
      };

      assert.throws(
        () => validateWorkflowInput(input),
        /action.*required/i
      );
    });
  });

  describe('serializeWorkflow', () => {
    it('serializes a workflow to JSON', () => {
      const workflow: MesaAutomation = {
        key: 'test_workflow',
        name: 'Test Workflow',
        version: '1.0.0',
        enabled: false,
        triggers: [
          {
            key: 'trigger1',
            name: 'Trigger 1',
            type: 'trigger',
            operation_id: 'test_op',
          },
        ],
        actions: [
          {
            key: 'action1',
            name: 'Action 1',
            type: 'action',
            operation_id: 'test_action',
          },
        ],
      };

      const json = serializeWorkflow(workflow, true);
      const parsed = JSON.parse(json);

      assert.strictEqual(parsed.key, 'test_workflow');
      assert.strictEqual(parsed.name, 'Test Workflow');
      assert.strictEqual(parsed.triggers.length, 1);
      assert.strictEqual(parsed.actions.length, 1);
    });

    it('supports compact output', () => {
      const workflow: MesaAutomation = {
        key: 'test',
        name: 'Test',
        version: '1.0.0',
      };

      const pretty = serializeWorkflow(workflow, true);
      const compact = serializeWorkflow(workflow, false);

      // Compact should be shorter (no whitespace)
      assert.ok(compact.length < pretty.length);
      assert.ok(!compact.includes('\n'));
    });
  });

  describe('parseWorkflow', () => {
    it('parses valid workflow JSON', () => {
      const json = JSON.stringify({
        key: 'test_workflow',
        name: 'Test Workflow',
        version: '1.0.0',
        enabled: true,
      });

      const workflow = parseWorkflow(json);

      assert.strictEqual(workflow.key, 'test_workflow');
      assert.strictEqual(workflow.name, 'Test Workflow');
      assert.strictEqual(workflow.version, '1.0.0');
      assert.strictEqual(workflow.enabled, true);
    });

    it('throws on invalid JSON', () => {
      assert.throws(
        () => parseWorkflow('not valid json'),
        /Invalid JSON/i
      );
    });

    it('throws on missing key', () => {
      const json = JSON.stringify({
        name: 'Test',
        version: '1.0.0',
      });

      assert.throws(
        () => parseWorkflow(json),
        /missing.*key/i
      );
    });

    it('throws on missing name', () => {
      const json = JSON.stringify({
        key: 'test',
        version: '1.0.0',
      });

      assert.throws(
        () => parseWorkflow(json),
        /missing.*name/i
      );
    });

    it('throws on missing version', () => {
      const json = JSON.stringify({
        key: 'test',
        name: 'Test',
      });

      assert.throws(
        () => parseWorkflow(json),
        /missing.*version/i
      );
    });
  });
});
