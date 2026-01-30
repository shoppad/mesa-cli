/**
 * Workflow Disable Command
 *
 * Disables a workflow (automation).
 *
 * Usage:
 *   mesa workflow disable                     # Interactive picker
 *   mesa workflow disable --workflow-id abc   # Specific workflow
 *   mesa workflow disable --json              # JSON output
 *   mesa workflow disable --workflow-id abc --yes  # Skip confirmation
 */

import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import type {
  GlobalOptions,
  WorkflowEnableDisableOptions,
  AdminAutomation,
} from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';

/**
 * Register the disable subcommand
 */
export function registerDisableCommand(parent: Command): void {
  parent
    .command('disable')
    .description('Disable a workflow')
    .option('--workflow-id <id>', 'Workflow ID (required in non-interactive mode)')
    .option('--json', 'Output as JSON')
    .option('--yes', 'Skip confirmation prompt (required in non-interactive mode)')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (opts, cmd: Command) => {
      const options = getOptions(opts, cmd);

      try {
        await runDisableCommand(options);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(opts: Record<string, unknown>, cmd: Command): WorkflowEnableDisableOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId: typeof opts.workflowId === 'string' ? opts.workflowId : undefined,
    json: Boolean(opts.json),
    yes: Boolean(opts.yes),
    quiet: Boolean(opts.quiet),
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

async function runDisableCommand(options: WorkflowEnableDisableOptions): Promise<void> {
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

    // Show progress message
    if (!options.quiet && !options.json) {
      console.log('Fetching workflows...');
    }

    // Interactive: show picker
    const selected = await pickWorkflow(client, {
      message: 'Select a workflow to disable:',
    });

    if (!selected) {
      console.log('No workflow selected.');
      return;
    }
    workflowId = selected;
  }

  // Fetch the workflow to check current state
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

  // Check if already disabled
  if (!selectedAutomation.enabled) {
    if (options.json) {
      console.log(JSON.stringify({
        id: selectedAutomation._id,
        name: selectedAutomation.name,
        enabled: false,
        message: 'Workflow is already disabled',
      }));
    } else if (!options.quiet) {
      console.log(`Workflow "${selectedAutomation.name}" is already disabled.`);
    }
    return; // Exit with code 0 as per spec
  }

  // Confirm unless --yes is provided
  if (!options.yes && isInteractive()) {
    if (!options.json) {
      console.log('');
      console.log(`About to disable workflow: ${selectedAutomation.name}`);
      console.log(`Workflow ID: ${selectedAutomation._id}`);
      console.log('');
    }

    const confirmed = await confirm({
      message: 'Are you sure you want to disable this workflow?',
      default: false,
    });

    if (!confirmed) {
      if (!options.quiet) {
        console.log('Cancelled.');
      }
      return;
    }
  } else if (!options.yes && !isInteractive()) {
    console.error('Error: --yes is required to disable a workflow in non-interactive mode');
    process.exit(1);
  }

  // Show progress message
  if (!options.quiet && !options.json) {
    console.log('Disabling workflow...');
  }

  // Disable the workflow
  const result = await client.updateAutomationSettings(workflowId, {
    enabled: false,
  });

  // Output result
  if (options.json) {
    console.log(JSON.stringify({
      id: selectedAutomation._id,
      name: selectedAutomation.name,
      enabled: result.enabled ?? false,
    }));
  } else if (!options.quiet) {
    console.log(`Successfully disabled workflow "${selectedAutomation.name}" (${selectedAutomation._id})`);
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
