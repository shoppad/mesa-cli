/**
 * Workflow Activity Command
 *
 * Shows recent runs (activity) for a workflow.
 *
 * Usage:
 *   mesa workflow activity                     # Interactive picker
 *   mesa workflow activity --workflow-id abc   # Specific workflow
 *   mesa workflow activity --json              # JSON output
 */

import { Command } from 'commander';
import type { GlobalOptions, WorkflowActivityOptions } from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { renderTable, formatDate, formatStatus, truncate } from '../../lib/table.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';

/**
 * Register the activity subcommand
 */
export function registerActivityCommand(parent: Command): void {
  parent
    .command('activity')
    .description('Show recent activity (runs) for a workflow')
    .option('--workflow-id <id>', 'Workflow ID (required in non-interactive mode)')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Maximum number of results (default: 25)', parseInt)
    .option('--page <n>', 'Page number (1-based)', parseInt)
    .option('--status <status>', 'Filter by status (ready, running, success, fail, pause, skip)')
    .option('--badge <badge>', 'Filter by badge (test, replay, backfill, delayed)')
    .action(async (opts, cmd: Command) => {
      const options = getOptions(opts, cmd);

      try {
        await runActivityCommand(options);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(opts: Record<string, unknown>, cmd: Command): WorkflowActivityOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId: typeof opts.workflowId === 'string' ? opts.workflowId : undefined,
    json: Boolean(opts.json),
    limit: typeof opts.limit === 'number' ? opts.limit : 25,
    page: typeof opts.page === 'number' ? opts.page : 1,
    status: typeof opts.status === 'string' ? opts.status : undefined,
    badge: typeof opts.badge === 'string' ? opts.badge : undefined,
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

async function runActivityCommand(options: WorkflowActivityOptions): Promise<void> {
  const client = getClient(options, options.json);

  // Determine workflow ID
  let workflowId = options.workflowId;

  if (!workflowId) {
    // Non-interactive mode requires --workflow-id
    if (!isInteractive()) {
      console.error('Error: --workflow-id is required in non-interactive mode');
      process.exit(1);
    }

    // Interactive: show picker
    const selected = await pickWorkflow(client, {
      message: 'Select a workflow to view activity:',
    });

    if (!selected) {
      console.log('No workflow selected.');
      return;
    }
    workflowId = selected;
  }

  // Fetch activity
  const response = await client.getAutomationRuns(workflowId, {
    status: options.status,
    badge: options.badge,
    limit: options.limit,
    page: options.page,
  });

  // Output
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    if (response.queue.length === 0) {
      console.log('No activity found for this workflow.');
      return;
    }

    console.log(`\nWorkflow Activity (Page ${response.page} of ${response.numPages})\n`);

    const tableData = response.queue.map((run) => ({
      id: run._id,
      status: run.status,
      badges: run.badges?.join(', ') ?? '-',
      tasks: run.tasks ?? 0,
      completes: run.completes ?? 0,
      fails: run.fails ?? 0,
      created: run.created_at ?? run.str_created_at,
    }));

    const table = renderTable(tableData, {
      columns: [
        { header: 'Run ID', key: 'id', formatter: (v) => truncate(String(v), 24) },
        { header: 'Status', key: 'status', formatter: (v) => formatStatus(String(v)) },
        { header: 'Badges', key: 'badges', formatter: (v) => truncate(String(v), 15) },
        { header: 'Tasks', key: 'tasks' },
        { header: 'Done', key: 'completes' },
        { header: 'Fail', key: 'fails' },
        { header: 'Created', key: 'created', formatter: (v) => formatDate(v as string) },
      ],
    });

    console.log(table);
    console.log(`\nShowing ${response.queue.length} runs (Page ${response.page} of ${response.numPages || 1})`);
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
