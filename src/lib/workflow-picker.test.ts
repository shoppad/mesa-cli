/**
 * Tests for workflow picker utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isTimeTravelEligible, getTimeTravelIneligibleReason } from './workflow-picker.js';
import type { AdminAutomation, AdminAutomationTrigger } from '../types/index.js';

function createAutomation(overrides: Partial<AdminAutomation> = {}): AdminAutomation {
  return {
    _id: 'test-id',
    key: 'test-key',
    name: 'Test Automation',
    status: 'published',
    enabled: true,
    triggers: [],
    ...overrides,
  };
}

function createTrigger(overrides: Partial<AdminAutomationTrigger> = {}): AdminAutomationTrigger {
  return {
    _id: 'trigger-id',
    key: 'trigger-key',
    name: 'Test Trigger',
    type: 'shopify',
    trigger_type: 'input',
    has_backfill: true,
    ...overrides,
  };
}

describe('isTimeTravelEligible', () => {
  it('returns true for eligible automation', () => {
    const automation = createAutomation({
      enabled: true,
      status: 'published',
      triggers: [
        createTrigger({ trigger_type: 'input', has_backfill: true }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), true);
  });

  it('returns false when disabled', () => {
    const automation = createAutomation({
      enabled: false,
      triggers: [
        createTrigger({ trigger_type: 'input', has_backfill: true }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false when deleted', () => {
    const automation = createAutomation({
      enabled: true,
      status: 'deleted',
      triggers: [
        createTrigger({ trigger_type: 'input', has_backfill: true }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false with no triggers', () => {
    const automation = createAutomation({
      triggers: [],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false with undefined triggers', () => {
    const automation = createAutomation({
      triggers: undefined,
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false with no input triggers', () => {
    const automation = createAutomation({
      triggers: [
        createTrigger({ trigger_type: 'output', has_backfill: true }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false with multiple input triggers', () => {
    const automation = createAutomation({
      triggers: [
        createTrigger({ _id: 't1', trigger_type: 'input', has_backfill: true }),
        createTrigger({ _id: 't2', trigger_type: 'input', has_backfill: true }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false when has_backfill is false', () => {
    const automation = createAutomation({
      triggers: [
        createTrigger({ trigger_type: 'input', has_backfill: false }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns false when has_backfill is undefined', () => {
    const automation = createAutomation({
      triggers: [
        createTrigger({ trigger_type: 'input', has_backfill: undefined }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), false);
  });

  it('returns true with mixed input/output triggers where input has backfill', () => {
    const automation = createAutomation({
      triggers: [
        createTrigger({ _id: 't1', trigger_type: 'input', has_backfill: true }),
        createTrigger({ _id: 't2', trigger_type: 'output', has_backfill: false }),
        createTrigger({ _id: 't3', trigger_type: 'output', has_backfill: true }),
      ],
    });
    assert.strictEqual(isTimeTravelEligible(automation), true);
  });
});

describe('getTimeTravelIneligibleReason', () => {
  it('returns reason for disabled workflow', () => {
    const automation = createAutomation({ enabled: false });
    assert.strictEqual(getTimeTravelIneligibleReason(automation), 'Workflow is disabled');
  });

  it('returns reason for deleted workflow', () => {
    const automation = createAutomation({ status: 'deleted', enabled: true });
    assert.strictEqual(getTimeTravelIneligibleReason(automation), 'Workflow is deleted');
  });

  it('returns reason for no triggers', () => {
    const automation = createAutomation({ triggers: [] });
    assert.strictEqual(getTimeTravelIneligibleReason(automation), 'Workflow has no triggers');
  });

  it('returns reason for no input trigger', () => {
    const automation = createAutomation({
      triggers: [createTrigger({ trigger_type: 'output' })],
    });
    assert.strictEqual(getTimeTravelIneligibleReason(automation), 'Workflow has no input trigger');
  });

  it('returns reason for multiple input triggers', () => {
    const automation = createAutomation({
      triggers: [
        createTrigger({ _id: 't1', trigger_type: 'input' }),
        createTrigger({ _id: 't2', trigger_type: 'input' }),
      ],
    });
    assert.strictEqual(getTimeTravelIneligibleReason(automation), 'Workflow has multiple input triggers');
  });

  it('returns reason for no backfill support', () => {
    const automation = createAutomation({
      triggers: [createTrigger({ trigger_type: 'input', has_backfill: false })],
    });
    assert.strictEqual(getTimeTravelIneligibleReason(automation), 'Input trigger does not support backfill');
  });
});
