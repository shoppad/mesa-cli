/**
 * Workflow Serializer
 *
 * Handles conversion between different workflow representations:
 * - WorkflowCreateInput (non-interactive JSON input)
 * - WorkflowBuilderState (internal wizard state)
 * - MesaAutomation (final output format)
 */

import type {
  WorkflowCreateInput,
  WorkflowStepInput,
  MesaAutomation,
  AutomationStep,
  WorkflowStep,
  WorkflowBuilderState,
} from '../../types/index.js';
import { TriggerRegistryService } from './trigger-registry.js';
import { buildStepFromInput } from './step-builder.js';
import { validateTokenReferences } from './token-picker.js';

/**
 * Build a workflow from non-interactive JSON input
 */
export async function buildWorkflowFromInput(
  input: WorkflowCreateInput,
  registry: TriggerRegistryService
): Promise<MesaAutomation> {
  // Validate input
  validateWorkflowInput(input);

  // Generate key if not provided
  const key = input.key ?? generateKey(input.name);

  // Build steps
  const steps: WorkflowStep[] = [];
  const existingKeys = new Set<string>();

  for (const stepInput of input.steps) {
    const step = await buildStepFromInput(registry, stepInput, existingKeys);
    steps.push(step);
    existingKeys.add(step.key);
  }

  // Validate token references
  const stepKeys = steps.map((s) => s.key);
  for (const step of steps) {
    for (const [fieldKey, value] of Object.entries(step.field_values)) {
      if (typeof value === 'string') {
        const validation = validateTokenReferences(value, stepKeys);
        if (!validation.valid) {
          throw new Error(
            `Invalid token reference in step "${step.key}" field "${fieldKey}": ${validation.invalidTokens.join(', ')}`
          );
        }
      }
    }
  }

  // Build automation in config.inputs/outputs format for API import
  const inputs = steps
    .filter((s) => s.type === 'trigger')
    .map((s, i) => stepToConfigStep(s, i));

  const outputs = steps
    .filter((s) => s.type === 'action')
    .map((s, i) => stepToConfigStep(s, inputs.length + i));

  const requiresSetup = steps.some((s) => s.requires_oauth);

  return {
    key,
    name: input.name,
    version: '1.0.0',
    enabled: input.enabled ?? false,
    setup: requiresSetup ? false : undefined,
    config: {
      inputs,
      outputs,
    },
  };
}

/**
 * Validate workflow input structure
 */
export function validateWorkflowInput(input: unknown): asserts input is WorkflowCreateInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid input: expected an object');
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new Error('Invalid input: "name" is required and must be a non-empty string');
  }

  if (!Array.isArray(obj.steps)) {
    throw new Error('Invalid input: "steps" is required and must be an array');
  }

  if (obj.steps.length === 0) {
    throw new Error('Invalid input: "steps" must contain at least one step');
  }

  // Validate each step
  for (let i = 0; i < obj.steps.length; i++) {
    validateStepInput(obj.steps[i], i);
  }

  // Validate that first step is a trigger
  const firstStep = obj.steps[0] as WorkflowStepInput;
  if (firstStep.type !== 'trigger') {
    throw new Error('Invalid input: first step must be a trigger');
  }
}

/**
 * Validate a single step input
 */
function validateStepInput(step: unknown, index: number): asserts step is WorkflowStepInput {
  if (!step || typeof step !== 'object') {
    throw new Error(`Invalid step at index ${index}: expected an object`);
  }

  const obj = step as Record<string, unknown>;

  if (obj.type !== 'trigger' && obj.type !== 'action') {
    throw new Error(
      `Invalid step at index ${index}: "type" must be "trigger" or "action"`
    );
  }

  if (typeof obj.app !== 'string' || obj.app.length === 0) {
    throw new Error(
      `Invalid step at index ${index}: "app" is required and must be a non-empty string`
    );
  }

  // Require either operation_id OR (entity AND action)
  const hasOperationId = typeof obj.operation_id === 'string' && obj.operation_id.length > 0;
  const hasEntityAction = (
    typeof obj.entity === 'string' && obj.entity.length > 0 &&
    typeof obj.action === 'string' && obj.action.length > 0
  );

  if (!hasOperationId && !hasEntityAction) {
    throw new Error(
      `Invalid step at index ${index}: either "operation_id" or both "entity" and "action" are required`
    );
  }

  if (obj.key !== undefined && (typeof obj.key !== 'string' || obj.key.length === 0)) {
    throw new Error(
      `Invalid step at index ${index}: "key" must be a non-empty string if provided`
    );
  }

  if (obj.fields !== undefined && (typeof obj.fields !== 'object' || obj.fields === null)) {
    throw new Error(
      `Invalid step at index ${index}: "fields" must be an object if provided`
    );
  }
}

/**
 * Generate a workflow key from name
 */
function generateKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * For schema 5 operations with OpenAPI, field values need to be nested under
 * a 'body' key in metadata. This detects the body wrapper pattern and
 * restructures flat field values accordingly.
 */
function wrapFieldValuesForBody(
  fieldValues: Record<string, unknown>,
  fields: import('../../types/index.js').TriggerField[]
): Record<string, unknown> {
  const bodyField = fields.find(
    (f) => f.key === 'body' && f.type === 'object' && f.fields && f.fields.length > 0
  );

  if (!bodyField) {
    // No body wrapper — schema 4 style, return flat values
    return fieldValues;
  }

  // If user already provided a nested body object, pass through unchanged
  if (fieldValues.body && typeof fieldValues.body === 'object' && !Array.isArray(fieldValues.body)) {
    return fieldValues;
  }

  // Separate field values into body vs top-level
  const bodyFieldKeys = new Set(
    (bodyField.fields ?? []).map((f) => f.key)
  );

  const bodyValues: Record<string, unknown> = {};
  const otherValues: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fieldValues)) {
    if (bodyFieldKeys.has(key)) {
      bodyValues[key] = value;
    } else {
      otherValues[key] = value;
    }
  }

  if (Object.keys(bodyValues).length > 0) {
    return { ...otherValues, body: bodyValues };
  }

  return fieldValues;
}

/**
 * Convert WorkflowStep to AutomationStep for config.inputs/outputs format
 * This is the format expected by the MESA import API
 */
function stepToConfigStep(step: WorkflowStep, weight: number): AutomationStep {
  const fieldValues = wrapFieldValuesForBody(step.field_values, step.fields);

  return {
    key: step.key,
    name: step.name,
    // trigger_type is 'input' for triggers, 'output' for actions
    trigger_type: step.type === 'trigger' ? 'input' : 'output',
    // type is the connector/app key (e.g., 'shopify', 'email')
    type: step.app_key,
    // Include version so the backend loads the correct versioned config (e.g., email/v2 not email/v1)
    version: step.version,
    operation_id: step.operation_id,
    metadata: {
      ...step.metadata,
      ...fieldValues,
    },
    weight,
  };
}

/**
 * Convert a WorkflowBuilderState to a MesaAutomation
 * Uses config.inputs/outputs format for API import
 */
export function stateToAutomation(state: WorkflowBuilderState): MesaAutomation {
  const inputs = state.steps
    .filter((s) => s.type === 'trigger')
    .map((s, i) => stepToConfigStep(s, i));

  const outputs = state.steps
    .filter((s) => s.type === 'action')
    .map((s, i) => stepToConfigStep(s, inputs.length + i));

  const requiresSetup = state.steps.some((s) => s.requires_oauth);

  return {
    key: state.key,
    name: state.name,
    version: '1.0.0',
    enabled: false,
    setup: requiresSetup ? false : undefined,
    config: {
      inputs,
      outputs,
    },
  };
}

/**
 * Serialize a MesaAutomation to JSON string
 */
export function serializeWorkflow(workflow: MesaAutomation, pretty = true): string {
  return JSON.stringify(workflow, null, pretty ? 2 : 0);
}

/**
 * Parse a workflow from JSON string
 */
export function parseWorkflow(json: string): MesaAutomation {
  try {
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON: expected an object');
    }

    // Validate required fields
    if (typeof parsed.key !== 'string') {
      throw new Error('Invalid workflow: missing "key"');
    }
    if (typeof parsed.name !== 'string') {
      throw new Error('Invalid workflow: missing "name"');
    }
    if (typeof parsed.version !== 'string') {
      throw new Error('Invalid workflow: missing "version"');
    }

    return parsed as MesaAutomation;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}
