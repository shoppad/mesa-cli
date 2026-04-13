/**
 * Interactive payload picker for workflow testing
 *
 * Provides interactive selection of test payloads from:
 * - Recent connector records (e.g., last 3 Shopify orders)
 * - Previous task runs
 * - Saved test records (if any)
 */

import { select, input } from '@inquirer/prompts';
import type { MesaClient } from './client.js';
import type { FullAutomationTrigger, TestRecordSummary } from '../types/index.js';

export interface PayloadChoice {
  id: string;
  label: string;
  date: string;
  source: 'saved' | 'connector' | 'task';
  taskId?: string;
}

export interface PickPayloadResult {
  payload: unknown;
  testRecordId?: string;
  record?: { name: string; id: string; date: string };
}

export interface PickPayloadOptions {
  client: MesaClient;
  trigger: FullAutomationTrigger;
  message?: string;
}

/**
 * Interactive payload picker
 *
 * Fetches available payloads and shows them directly for selection,
 * similar to the dashboard UI.
 *
 * @param options - Picker options
 * @returns Selected payload and metadata, or null if no selection
 */
export async function pickPayload(
  options: PickPayloadOptions
): Promise<PickPayloadResult | null> {
  const { client, trigger } = options;

  console.log('Fetching available test payloads...');

  // Fetch live payloads (connector records + recent tasks)
  let livePayloads: PayloadChoice[] = [];
  try {
    const liveResponse = await client.getTestPayloads(trigger.trigger_type, trigger._id);

    // Add connector records
    if (liveResponse.records) {
      for (const record of liveResponse.records) {
        livePayloads.push({
          id: record.id,
          label: record.label,
          date: record.date,
          source: 'connector',
        });
      }
    }

    // Add task records (previous runs)
    if (liveResponse.tasks) {
      for (const task of liveResponse.tasks) {
        livePayloads.push({
          id: task.id,
          label: task.label,
          date: task.date,
          source: 'task',
          taskId: task.task_id,
        });
      }
    }
  } catch {
    // Ignore errors - just won't show live payloads
  }

  // Fetch saved test records
  let savedRecords: TestRecordSummary[] = [];
  try {
    const savedResponse = await client.getTestRecords(trigger.trigger_type, trigger._id);
    savedRecords = savedResponse.records || [];
  } catch {
    // Ignore errors - just won't show saved records
  }

  // Build choices for the selector
  type ChoiceValue = { type: 'default' } | { type: 'live'; payload: PayloadChoice } | { type: 'saved'; record: TestRecordSummary } | { type: 'search' } | { type: 'custom' };

  const choices: Array<{ name: string; value: ChoiceValue; description?: string }> = [];

  // Add live payloads first (most useful)
  if (livePayloads.length > 0) {
    for (const payload of livePayloads) {
      const sourceLabel = payload.source === 'connector' ? '' : ' (previous run)';
      choices.push({
        name: `${payload.label}${sourceLabel}`,
        value: { type: 'live', payload },
        description: `${formatDate(payload.date)} | ID: ${payload.id}`,
      });
    }
  }

  // Add saved records
  if (savedRecords.length > 0) {
    for (const record of savedRecords) {
      choices.push({
        name: `📁 ${record.name || `Saved Record`}`,
        value: { type: 'saved', record },
        description: record.last_run
          ? `Last run: ${formatDate(record.last_run)}`
          : `Created: ${formatDate(record.created_at || '')}`,
      });
    }
  }

  // Add separator and other options
  if (choices.length > 0) {
    choices.push({
      name: '─────────────────────────',
      value: { type: 'default' },
      description: '',
    });
  }

  // Always show default option
  choices.push({
    name: 'Use default (empty) payload',
    value: { type: 'default' },
    description: 'Run with an empty/default payload',
  });

  // Search option if connector supports it
  choices.push({
    name: 'Search for a specific record...',
    value: { type: 'search' },
    description: 'Search by ID or keyword',
  });

  // No payloads available message
  if (livePayloads.length === 0 && savedRecords.length === 0) {
    console.log('No recent test payloads found.');
  }

  // Show the picker
  const selected = await select({
    message: 'Select a test payload:',
    choices,
  });

  // Handle selection
  if (selected.type === 'default') {
    return { payload: {} };
  }

  if (selected.type === 'live') {
    return fetchLivePayload(client, trigger, selected.payload);
  }

  if (selected.type === 'saved') {
    return fetchSavedRecord(client, trigger, selected.record);
  }

  if (selected.type === 'search') {
    return searchAndSelectPayload(client, trigger);
  }

  return null;
}

/**
 * Fetch a live payload (connector or task)
 */
async function fetchLivePayload(
  client: MesaClient,
  trigger: FullAutomationTrigger,
  choice: PayloadChoice
): Promise<PickPayloadResult | null> {
  console.log('Loading payload...');

  try {
    const idType = choice.source === 'connector' ? 'connector' : 'task';
    const fetchId = choice.taskId || choice.id;

    const response = await client.getTestPayload(
      trigger.trigger_type,
      trigger._id,
      fetchId,
      idType
    );

    if (response.error) {
      console.error(`Error loading payload: ${response.error}`);
      return null;
    }

    return {
      payload: response.payload,
      record: {
        name: choice.label,
        id: choice.id,
        date: choice.date,
      },
    };
  } catch (error) {
    console.error('Error loading payload.');
    return null;
  }
}

/**
 * Fetch a saved test record
 */
async function fetchSavedRecord(
  client: MesaClient,
  trigger: FullAutomationTrigger,
  record: TestRecordSummary
): Promise<PickPayloadResult | null> {
  console.log('Loading payload...');

  try {
    const fullRecord = await client.getTestRecord(
      trigger.trigger_type,
      trigger._id,
      record._id
    );

    return {
      payload: fullRecord.payload,
      testRecordId: fullRecord._id,
      record: {
        name: fullRecord.name,
        id: fullRecord.record_id || fullRecord._id,
        date: fullRecord.record_date || fullRecord.created_at || '',
      },
    };
  } catch (error) {
    console.error('Error loading saved record.');
    return null;
  }
}

/**
 * Search for a specific payload
 */
async function searchAndSelectPayload(
  client: MesaClient,
  trigger: FullAutomationTrigger
): Promise<PickPayloadResult | null> {
  const searchTerm = await input({
    message: 'Enter search term (order number, ID, etc.):',
  });

  if (!searchTerm.trim()) {
    console.log('No search term provided.');
    return null;
  }

  console.log('Searching...');

  try {
    const response = await client.getTestPayloads(
      trigger.trigger_type,
      trigger._id,
      searchTerm.trim()
    );

    const results: PayloadChoice[] = [];

    if (response.records) {
      for (const record of response.records) {
        results.push({
          id: record.id,
          label: record.label,
          date: record.date,
          source: 'connector',
        });
      }
    }

    if (response.tasks) {
      for (const task of response.tasks) {
        results.push({
          id: task.id,
          label: task.label,
          date: task.date,
          source: 'task',
          taskId: task.task_id,
        });
      }
    }

    if (results.length === 0) {
      console.log('No results found.');
      return null;
    }

    // Show results
    const choices = results.map((r) => ({
      name: `${r.label} (${formatDate(r.date)})`,
      value: r,
      description: `ID: ${r.id}`,
    }));

    const selected = await select({
      message: 'Select a result:',
      choices,
    });

    return fetchLivePayload(client, trigger, selected);
  } catch (error) {
    console.error('Search failed.');
    return null;
  }
}

/**
 * Format a date string for display
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
