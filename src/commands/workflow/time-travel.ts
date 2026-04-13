/**
 * Workflow Time-Travel (Backfill) Command
 *
 * Check status or start a backfill for a workflow.
 *
 * Usage:
 *   mesa workflow time-travel                         # Interactive: check status
 *   mesa workflow time-travel --workflow-id abc       # Check status for specific workflow
 *   mesa workflow time-travel --from 2024-01-01 --to 2024-01-31  # Start backfill with date range
 */

import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import type {
  GlobalOptions,
  WorkflowTimeTravelOptions,
  AdminAutomation,
} from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { formatDate, formatStatus } from '../../lib/table.js';
import {
  pickWorkflow,
  isInteractive,
  isTimeTravelEligible,
} from '../../lib/workflow-picker.js';

/**
 * Register the time-travel subcommand
 */
export function registerTimeTravelCommand(parent: Command): void {
  parent
    .command('time-travel')
    .description('Check status or start a backfill (time-travel) for a workflow')
    .option('--workflow-id <id>', 'Workflow ID (required in non-interactive mode)')
    .option('--json', 'Output as JSON')
    .option('--from <date>', 'Start date for backfill (YYYY-MM-DD)')
    .option('--to <date>', 'End date for backfill (YYYY-MM-DD)')
    .option('--limit <n>', 'Maximum records to process', parseInt)
    .option('--yes', 'Skip confirmation prompts')
    .action(async (opts, cmd: Command) => {
      const options = getOptions(opts, cmd);

      try {
        await runTimeTravelCommand(options);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(opts: Record<string, unknown>, cmd: Command): WorkflowTimeTravelOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId: typeof opts.workflowId === 'string' ? opts.workflowId : undefined,
    json: Boolean(opts.json),
    from: typeof opts.from === 'string' ? opts.from : undefined,
    to: typeof opts.to === 'string' ? opts.to : undefined,
    limit: typeof opts.limit === 'number' ? opts.limit : undefined,
    yes: Boolean(opts.yes),
  };
}

function getClient(options: GlobalOptions, jsonOutput?: boolean): MesaClient {
  const cwd = process.cwd();
  const loaded = loadConfig(cwd, options.env);

  if (options.verbose && !jsonOutput) {
    console.log(`Loaded config from: ${loaded.source === 'local' ? 'Local' : 'Global'} (${loaded.path})`);
    console.log(`Store UUID: ${loaded.config.uuid}`);
    console.log('');
  }

  return new MesaClient({
    config: loaded.config,
    verbose: options.verbose,
  });
}

function shouldStartBackfill(options: WorkflowTimeTravelOptions): boolean {
  return Boolean(options.from || options.to);
}

async function runTimeTravelCommand(options: WorkflowTimeTravelOptions): Promise<void> {
  const client = getClient(options, options.json);

  // Determine workflow ID
  let workflowId = options.workflowId;
  let selectedAutomation: AdminAutomation | undefined;

  if (!workflowId) {
    // Non-interactive mode requires --workflow-id
    if (!isInteractive()) {
      console.error('Error: --workflow-id is required in non-interactive mode');
      process.exit(1);
    }

    // Interactive: show picker (filtered to eligible workflows only)
    const selected = await pickWorkflow(client, {
      message: 'Select a workflow for time-travel (only eligible workflows shown):',
      filter: isTimeTravelEligible,
    });

    if (!selected) {
      console.log('No eligible workflow selected.');
      return;
    }
    workflowId = selected;
  } else {
    // Verify the workflow exists
    const response = await client.listAdminAutomations();
    selectedAutomation = response.automations.find((a) => a._id === workflowId);

    if (!selectedAutomation) {
      if (options.json) {
        console.log(JSON.stringify({ error: true, message: 'Workflow not found' }));
      } else {
        console.error(`Error: Workflow with ID "${workflowId}" not found.`);
      }
      process.exit(1);
    }

    // Note: Eligibility is checked by the backend when we call the backfill API.
    // The list API doesn't include trigger details needed for client-side eligibility check.
  }

  // Check if we should start a backfill or just show status
  if (shouldStartBackfill(options)) {
    await startBackfill(client, workflowId, options);
  } else {
    await showBackfillStatus(client, workflowId, options);
  }
}

async function showBackfillStatus(
  client: MesaClient,
  workflowId: string,
  options: WorkflowTimeTravelOptions
): Promise<void> {
  const response = await client.getBackfillStatus(workflowId);

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.log('\nTime-Travel Status\n');

  if (response.error) {
    console.log(`Error: ${response.error}`);
    return;
  }

  // Check for no backfill (null, undefined, or empty object)
  const hasActiveBackfill = response.backfill && Object.keys(response.backfill).length > 0;
  if (!hasActiveBackfill) {
    console.log('No active backfill. Workflow is eligible for time-travel.');
    console.log('');
    console.log('To start a backfill, use:');
    console.log(`  mesa workflow time-travel --workflow-id ${workflowId} --from YYYY-MM-DD --to YYYY-MM-DD`);
    return;
  }

  // Show current backfill status (we know backfill exists due to the check above)
  const backfill = response.backfill!;
  console.log(`Backfill ID: ${backfill._id}`);
  console.log(`Status: ${formatStatus(backfill.status)}`);
  console.log(`Progress: ${backfill.records_complete} / ${backfill.records_total} records`);

  if (backfill.searchParams) {
    if (backfill.searchParams.start_date) {
      console.log(`Date Range: ${backfill.searchParams.start_date} to ${backfill.searchParams.end_date ?? 'now'}`);
    }
    if (backfill.searchParams.total) {
      console.log(`Requested Limit: ${backfill.searchParams.total} records`);
    }
  }

  if (backfill.created_at) {
    console.log(`Started: ${formatDate(backfill.created_at)}`);
  }

  if (backfill.updated_at) {
    console.log(`Last Updated: ${formatDate(backfill.updated_at)}`);
  }

  if (backfill.stopped_at) {
    console.log(`Stopped At: ${formatDate(backfill.stopped_at)}`);
  }

  // Show status-specific info
  if (['paused', 'halted'].includes(backfill.status)) {
    console.log('');
    console.log('This backfill is paused. Use the MESA dashboard to resume.');
  }

  if (backfill.status === 'failed') {
    console.log('');
    console.log('This backfill has failed. Check the MESA dashboard for details.');
  }
}

async function startBackfill(
  client: MesaClient,
  workflowId: string,
  options: WorkflowTimeTravelOptions
): Promise<void> {
  // First check if there's already an active backfill
  const statusResponse = await client.getBackfillStatus(workflowId);

  if (statusResponse.backfill && ['ready', 'running', 'processing'].includes(statusResponse.backfill.status)) {
    if (options.json) {
      console.log(JSON.stringify({
        error: true,
        message: 'Backfill already in progress',
        backfill: statusResponse.backfill,
      }));
    } else {
      console.error('Error: A backfill is already in progress for this workflow.');
      console.error(`Status: ${statusResponse.backfill.status}`);
      console.error(`Progress: ${statusResponse.backfill.records_complete} / ${statusResponse.backfill.records_total}`);
    }
    process.exit(1);
  }

  // Build request
  const request: Record<string, unknown> = {};

  if (options.from) {
    request.start_date = options.from;
  }

  if (options.to) {
    request.end_date = options.to;
  }

  if (options.limit) {
    request.total = options.limit;
  }

  // Confirm unless --yes is provided
  if (!options.yes && isInteractive()) {
    console.log('\nAbout to start time-travel with:');
    if (request.start_date) console.log(`  From: ${request.start_date}`);
    if (request.end_date) console.log(`  To: ${request.end_date}`);
    if (request.total) console.log(`  Limit: ${request.total} records`);
    console.log('');

    const confirmed = await confirm({
      message: 'Start time-travel?',
      default: false,
    });

    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  } else if (!options.yes && !isInteractive()) {
    console.error('Error: --yes is required to start time-travel in non-interactive mode');
    process.exit(1);
  }

  // Start backfill
  const response = await client.startBackfill(
    workflowId,
    request as { total?: number; start_date?: string; end_date?: string }
  );

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response.backfill) {
    console.log('\nTime-travel started successfully!');
    console.log(`Backfill ID: ${response.backfill._id}`);
    console.log(`Records to process: ${response.backfill.records_total}`);
    console.log('');
    console.log(`Use \`mesa workflow time-travel --workflow-id ${workflowId}\` to check status.`);
  } else if (response.error) {
    console.error(`Failed to start time-travel: ${response.error}`);
    process.exit(1);
  } else {
    console.error('Failed to start time-travel: Unknown error');
    process.exit(1);
  }
}

function handleError(error: unknown, jsonOutput?: boolean): never {
  if (jsonOutput) {
    const errorObj = {
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
      code: error instanceof ApiError ? error.statusCode : undefined,
    };
    console.error(JSON.stringify(errorObj));
  } else {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      console.error('Run "mesa auth login" to authenticate.');
    } else if (error instanceof ApiError) {
      console.error(`API error (${error.statusCode}): ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unexpected error occurred');
    }
  }
  process.exit(1);
}
