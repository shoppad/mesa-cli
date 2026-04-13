/**
 * Workflow List Command
 *
 * Lists all workflows (automations) from the admin API.
 *
 * Usage:
 *   mesa workflow list              # Table output
 *   mesa workflow list --json       # JSON output
 *   mesa workflow list --search foo # Filter by name
 */

import { Command } from 'commander';
import type { GlobalOptions, WorkflowListOptions } from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { renderTable, formatRelative, truncate } from '../../lib/table.js';

/**
 * Register the list subcommand
 */
export function registerListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List all workflows')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Maximum number of results', parseInt)
    .option('--page <n>', 'Page number (1-based)', parseInt)
    .option('--search <term>', 'Filter by name or key')
    .option('--sort <field>', 'Sort by field (name, updated_at, created_at)')
    .option('--sort-dir <dir>', 'Sort direction (asc, desc)')
    .action(async (opts, cmd: Command) => {
      const options = getOptions(opts, cmd);

      try {
        await runListCommand(options);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(opts: Record<string, unknown>, cmd: Command): WorkflowListOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    json: Boolean(opts.json),
    limit: typeof opts.limit === 'number' ? opts.limit : undefined,
    page: typeof opts.page === 'number' ? opts.page : undefined,
    search: typeof opts.search === 'string' ? opts.search : undefined,
    sort: opts.sort as WorkflowListOptions['sort'],
    sortDir: opts.sortDir as WorkflowListOptions['sortDir'],
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

async function runListCommand(options: WorkflowListOptions): Promise<void> {
  const client = getClient(options, options.json);
  const response = await client.listAdminAutomations();

  // Filter out deleted workflows (matching dashboard behavior)
  let workflows = response.automations.filter((a) => a.status !== 'deleted');

  // Apply search filter
  if (options.search) {
    const term = options.search.toLowerCase();
    workflows = workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(term) ||
        w.key.toLowerCase().includes(term)
    );
  }

  // Apply sorting (default: _id DESC which is creation order, matching dashboard)
  const sortField = options.sort ?? '_id';
  const sortDir = options.sortDir ?? 'desc';

  workflows.sort((a, b) => {
    let aVal: string | undefined;
    let bVal: string | undefined;

    switch (sortField) {
      case 'name':
        aVal = a.name;
        bVal = b.name;
        break;
      case 'updated_at':
        aVal = a.updated_at ?? a.updated_at_iso;
        bVal = b.updated_at ?? b.updated_at_iso;
        break;
      case 'created_at':
        aVal = a.created_at ?? a.created_at_iso;
        bVal = b.created_at ?? b.created_at_iso;
        break;
      default:
        // Default sort by _id (creation order)
        aVal = a._id;
        bVal = b._id;
    }

    const comparison = (aVal ?? '').localeCompare(bVal ?? '');
    return sortDir === 'desc' ? -comparison : comparison;
  });

  // Apply pagination
  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const startIndex = (page - 1) * limit;
  const paginatedWorkflows = workflows.slice(startIndex, startIndex + limit);

  // Output
  if (options.json) {
    const output = {
      workflows: paginatedWorkflows.map((w) => ({
        id: w._id,
        name: w.name,
        key: w.key,
        enabled: w.enabled,
        status: w.status,
        updated_at: w.updated_at ?? w.updated_at_iso,
        created_at: w.created_at ?? w.created_at_iso,
      })),
      total: workflows.length,
      page,
      limit,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    if (paginatedWorkflows.length === 0) {
      console.log('No workflows found.');
      return;
    }

    const tableData = paginatedWorkflows.map((w) => ({
      name: w.name,
      id: w._id,
      key: w.key,
      status: w.enabled ? 'enabled' : 'disabled',
      updated: w.updated_at ?? w.updated_at_iso,
    }));

    const table = renderTable(tableData, {
      columns: [
        { header: 'Name', key: 'name', formatter: (v) => truncate(String(v), 40) },
        { header: 'Key', key: 'key', formatter: (v) => truncate(String(v), 36) },
        { header: 'ID', key: 'id' },
        { header: 'Status', key: 'status' },
        { header: 'Updated', key: 'updated', formatter: (v) => formatRelative(v as string) },
      ],
    });

    console.log(table);
    console.log(`\nShowing ${paginatedWorkflows.length} of ${workflows.length} workflows`);
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
