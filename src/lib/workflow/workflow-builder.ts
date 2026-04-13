/**
 * Workflow Builder
 *
 * Main orchestrator for the interactive workflow creation wizard.
 * Manages the state machine for building multi-step workflows.
 */

import { input, confirm, select } from '@inquirer/prompts';
import type {
  WorkflowBuilderState,
  WorkflowStep,
  MesaAutomation,
  AutomationStep,
} from '../../types/index.js';
import { TriggerRegistryService } from './trigger-registry.js';
import { StepBuilder } from './step-builder.js';

export type WorkflowOutputAction = 'save' | 'push' | 'print' | 'cancel';

export interface WorkflowBuilderResult {
  workflow: MesaAutomation | null;
  action: WorkflowOutputAction;
}

/**
 * Interactive workflow builder wizard
 */
export class WorkflowBuilder {
  private state: WorkflowBuilderState;

  constructor(private registry: TriggerRegistryService) {
    this.state = {
      name: '',
      key: '',
      steps: [],
    };
  }

  /**
   * Run the interactive workflow builder
   * @returns The built workflow and the user's chosen action
   */
  async build(): Promise<WorkflowBuilderResult> {
    console.log('');
    console.log('=== MESA Workflow Builder ===');
    console.log('');

    // 1. Get workflow name
    this.state.name = await input({
      message: 'Workflow name:',
      validate: (v) => (v.length > 0 ? true : 'Name is required'),
    });

    this.state.key = this.generateKey(this.state.name);

    // 2. Build first step (must be a trigger)
    console.log('');
    console.log('=== Step 1: Add Trigger ===');
    console.log('');

    const trigger = await this.buildStep('trigger');
    this.state.steps.push(trigger);
    console.log(`Trigger added: ${trigger.key}`);

    // 3. Build additional steps (actions)
    let stepNumber = 2;
    while (true) {
      console.log('');
      console.log(`=== Step ${stepNumber}: Add Action ===`);
      console.log('');

      const addMore = await confirm({
        message: 'Add another step?',
        default: stepNumber === 2, // Default to yes for first action
      });

      if (!addMore) break;

      const step = await this.buildStep('action');
      this.state.steps.push(step);
      console.log(`Action added: ${step.key}`);
      stepNumber++;
    }

    // 4. Validate we have at least one action
    const actionCount = this.state.steps.filter((s) => s.type === 'action').length;
    if (actionCount === 0) {
      console.log('');
      console.log('Warning: Workflow has no actions. Adding at least one action is recommended.');

      const addAction = await confirm({
        message: 'Add an action now?',
        default: true,
      });

      if (addAction) {
        const action = await this.buildStep('action');
        this.state.steps.push(action);
        console.log(`Action added: ${action.key}`);
      }
    }

    // 5. Show summary and get final action
    this.showSummary();

    const outputAction = await select<WorkflowOutputAction>({
      message: 'What would you like to do?',
      choices: [
        { name: 'Save to file (mesa.json)', value: 'save' },
        { name: 'Push to MESA', value: 'push' },
        { name: 'Print JSON to stdout', value: 'print' },
        { name: 'Cancel', value: 'cancel' },
      ],
    });

    if (outputAction === 'cancel') {
      return { workflow: null, action: 'cancel' };
    }

    return {
      workflow: this.toAutomation(),
      action: outputAction,
    };
  }

  /**
   * Build a single step
   */
  private async buildStep(type: 'trigger' | 'action'): Promise<WorkflowStep> {
    const builder = new StepBuilder(this.registry, this.state.steps);
    return builder.buildStep(type);
  }

  /**
   * Generate a workflow key from the name
   */
  private generateKey(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Show workflow summary
   */
  private showSummary(): void {
    console.log('');
    console.log('=== Summary ===');
    console.log(`Workflow: ${this.state.name}`);
    console.log(`Key: ${this.state.key}`);
    console.log('');
    console.log('Steps:');

    this.state.steps.forEach((step, i) => {
      const typeLabel = step.type === 'trigger' ? 'Trigger' : 'Action';
      const oauthNote = step.requires_oauth ? ' (requires OAuth)' : '';
      console.log(`  ${i + 1}. [${typeLabel}] ${step.name} (${step.key})${oauthNote}`);
    });

    // Check for OAuth requirements
    const oauthSteps = this.state.steps.filter((s) => s.requires_oauth);
    if (oauthSteps.length > 0) {
      console.log('');
      console.log('Note: Some steps require OAuth setup in MESA UI:');
      oauthSteps.forEach((s) => {
        console.log(`  - ${s.name}`);
      });
    }

    console.log('');
  }

  /**
   * Convert the builder state to a MesaAutomation
   * Uses config.inputs/outputs format for API import
   */
  private toAutomation(): MesaAutomation {
    const inputs = this.state.steps
      .filter((s) => s.type === 'trigger')
      .map((s, i) => this.stepToAutomationStep(s, i));

    const outputs = this.state.steps
      .filter((s) => s.type === 'action')
      .map((s, i) => this.stepToAutomationStep(s, inputs.length + i));

    // Check if any step requires OAuth
    const requiresSetup = this.state.steps.some((s) => s.requires_oauth);

    return {
      key: this.state.key,
      name: this.state.name,
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
   * Convert a WorkflowStep to an AutomationStep for config.inputs/outputs format
   */
  private stepToAutomationStep(step: WorkflowStep, weight: number): AutomationStep {
    return {
      key: step.key,
      name: step.name,
      // trigger_type is 'input' for triggers, 'output' for actions
      trigger_type: step.type === 'trigger' ? 'input' : 'output',
      // type is the connector/app key (e.g., 'shopify', 'email')
      type: step.app_key,
      // version is the connector version (e.g., 'v2', 'v3')
      version: step.version,
      operation_id: step.operation_id,
      metadata: {
        ...step.metadata,
        ...step.field_values,
      },
      weight,
    };
  }

  /**
   * Get the current state (for serialization)
   */
  getState(): WorkflowBuilderState {
    return { ...this.state };
  }
}

/**
 * Build a workflow from existing state (for resuming)
 * Uses config.inputs/outputs format for API import
 */
export function workflowFromState(
  state: WorkflowBuilderState
): MesaAutomation {
  const inputs = state.steps
    .filter((s) => s.type === 'trigger')
    .map((s, i): AutomationStep => ({
      key: s.key,
      name: s.name,
      trigger_type: 'input',
      type: s.app_key,
      version: s.version,
      operation_id: s.operation_id,
      metadata: {
        ...s.metadata,
        ...s.field_values,
      },
      weight: i,
    }));

  const outputs = state.steps
    .filter((s) => s.type === 'action')
    .map((s, i): AutomationStep => ({
      key: s.key,
      name: s.name,
      trigger_type: 'output',
      type: s.app_key,
      version: s.version,
      operation_id: s.operation_id,
      metadata: {
        ...s.metadata,
        ...s.field_values,
      },
      weight: inputs.length + i,
    }));

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
