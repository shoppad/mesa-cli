/**
 * Workflow picker utility
 *
 * Provides interactive workflow selection using @inquirer/prompts search.
 */

import { search } from '@inquirer/prompts';
import type { MesaClient } from './client.js';
import type { AdminAutomation } from '../types/index.js';

export interface WorkflowPickerOptions {
  /** Filter function to include only certain workflows */
  filter?: (automation: AdminAutomation) => boolean;
  /** Message to display in the prompt */
  message?: string;
  /** Include "All workflows" option */
  includeAll?: boolean;
}

/**
 * Check if an automation is eligible for time-travel (backfill)
 *
 * Requirements:
 * - Must be enabled (not disabled)
 * - Must not be deleted
 * - Must have exactly one input trigger
 * - Input trigger must have has_backfill === true
 */
export function isTimeTravelEligible(automation: AdminAutomation): boolean {
  // Must be enabled and not deleted
  if (!automation.enabled || automation.status === 'deleted') {
    return false;
  }

  // Must have triggers array
  if (!automation.triggers || automation.triggers.length === 0) {
    return false;
  }

  // Find input triggers
  const inputTriggers = automation.triggers.filter(
    (t) => t.trigger_type === 'input'
  );

  // Must have exactly one input trigger
  if (inputTriggers.length !== 1) {
    return false;
  }

  // Input trigger must have has_backfill = true
  return inputTriggers[0].has_backfill === true;
}

/**
 * Get reason why automation is not eligible for time-travel
 */
export function getTimeTravelIneligibleReason(automation: AdminAutomation): string {
  if (!automation.enabled) {
    return 'Workflow is disabled';
  }

  if (automation.status === 'deleted') {
    return 'Workflow is deleted';
  }

  if (!automation.triggers || automation.triggers.length === 0) {
    return 'Workflow has no triggers';
  }

  const inputTriggers = automation.triggers.filter(
    (t) => t.trigger_type === 'input'
  );

  if (inputTriggers.length === 0) {
    return 'Workflow has no input trigger';
  }

  if (inputTriggers.length > 1) {
    return 'Workflow has multiple input triggers';
  }

  if (!inputTriggers[0].has_backfill) {
    return 'Input trigger does not support backfill';
  }

  return 'Unknown reason';
}

/**
 * Interactive workflow picker
 *
 * @param client - MesaClient instance
 * @param options - Picker options
 * @returns Selected workflow ID or null if "All" selected or no selection
 */
export async function pickWorkflow(
  client: MesaClient,
  options: WorkflowPickerOptions = {}
): Promise<string | null> {
  const {
    filter,
    message = 'Select a workflow (type to filter):',
    includeAll = false,
  } = options;

  console.log('Fetching workflows...');

  const response = await client.listAdminAutomations();
  let automations = response.automations.filter(
    (a) => a.status !== 'deleted'
  );

  // Apply custom filter if provided
  if (filter) {
    automations = automations.filter(filter);
  }

  if (automations.length === 0) {
    console.log('No workflows found matching the criteria.');
    return null;
  }

  // Build choices for search prompt
  interface WorkflowChoice {
    id: string;
    name: string;
    key: string;
    enabled: boolean;
    updatedAt?: string;
  }

  const choices: WorkflowChoice[] = automations.map((auto) => ({
    id: auto._id,
    name: auto.name,
    key: auto.key,
    enabled: auto.enabled,
    updatedAt: auto.updated_at ?? auto.updated_at_iso,
  }));

  // Sort by name
  choices.sort((a, b) => a.name.localeCompare(b.name));

  const selected = await search<string>({
    message,
    source: async (input) => {
      const term = (input ?? '').toLowerCase();

      const results: Array<{
        name: string;
        value: string;
        description?: string;
      }> = [];

      // Add "All" option if requested
      if (includeAll) {
        results.push({
          name: 'All workflows',
          value: '__all__',
          description: 'Show all workflows',
        });
      }

      // Filter and add workflow choices
      const filtered = choices.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.key.toLowerCase().includes(term) ||
          c.id.toLowerCase().includes(term)
      );

      for (const choice of filtered) {
        const status = choice.enabled ? '\u{1F7E2}' : '\u{26AA}'; // green or white circle emoji
        results.push({
          name: `${status} ${choice.name}`,
          value: choice.id,
          description: `Key: ${choice.key} | ID: ${choice.id}`,
        });
      }

      return results;
    },
  });

  return selected === '__all__' ? null : selected;
}

/**
 * Check if running in interactive mode (TTY)
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
