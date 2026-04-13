/**
 * Debug Logging Commands
 *
 * Manages debug logging for workflows (automations).
 *
 * Usage:
 *   mesa workflow debug enable <workflowId>   # Enable debug logging
 *   mesa workflow debug disable <workflowId>  # Disable debug logging
 *   mesa workflow debug status [workflowId]   # Show debug status
 */

import { Command } from 'commander';
import type { GlobalOptions, AdminAutomation } from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';

/**
 * Register the debug subcommand group
 */
export function registerDebugCommand(parent: Command): void {
  const debugCommand = parent
    .command('debug')
    .description('Manage debug logging for workflows');

  // Enable debug logging
  debugCommand
    .command('enable [workflowId]')
    .description('Enable debug logging for a workflow')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(opts, cmd);
      try {
        await setDebugMode(workflowIdArg, true, options);
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // Disable debug logging
  debugCommand
    .command('disable [workflowId]')
    .description('Disable debug logging for a workflow')
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress non-essential output')
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(opts, cmd);
      try {
        await setDebugMode(workflowIdArg, false, options);
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // Status command
  debugCommand
    .command('status [workflowId]')
    .description('Show debug logging status for workflow(s)')
    .option('--json', 'Output as JSON')
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(opts, cmd);
      try {
        await showDebugStatus(workflowIdArg, options);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

interface DebugCommandOptions extends GlobalOptions {
  json?: boolean;
  quiet?: boolean;
}

function getOptions(opts: Record<string, unknown>, cmd: Command): DebugCommandOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    json: Boolean(opts.json),
    quiet: Boolean(opts.quiet),
  };
}

function getClient(options: GlobalOptions): MesaClient {
  const loaded = loadConfig(process.cwd(), options.env);
  return new MesaClient({ config: loaded.config, verbose: options.verbose });
}

async function setDebugMode(
  workflowIdArg: string | undefined,
  enable: boolean,
  options: DebugCommandOptions
): Promise<void> {
  const client = getClient(options);

  // Resolve workflow ID
  let workflowId = workflowIdArg;
  if (!workflowId) {
    if (!isInteractive()) {
      console.error('Error: workflow ID is required in non-interactive mode');
      process.exit(1);
    }

    if (!options.quiet && !options.json) {
      console.log('Fetching workflows...');
    }

    const selected = await pickWorkflow(client, {
      message: `Select workflow to ${enable ? 'enable' : 'disable'} debug logging:`,
    });
    if (!selected) {
      console.log('No workflow selected.');
      return;
    }
    workflowId = selected;
  }

  // Get current automation to verify it exists and check logging status
  const response = await client.listAdminAutomations();
  const automation = response.automations.find(
    (a) => a._id === workflowId || a.key === workflowId
  );

  if (!automation) {
    if (options.json) {
      console.log(JSON.stringify({ error: true, message: 'Workflow not found' }));
    } else {
      console.error(`Error: Workflow "${workflowId}" not found.`);
    }
    process.exit(1);
  }

  // Check if already in desired state
  const currentDebug = automation.debug ?? false;
  if (currentDebug === enable) {
    if (options.json) {
      console.log(JSON.stringify({
        id: automation._id,
        key: automation.key,
        name: automation.name,
        debug: enable,
        message: `Debug logging is already ${enable ? 'enabled' : 'disabled'}`,
      }));
    } else if (!options.quiet) {
      console.log(`Debug logging is already ${enable ? 'enabled' : 'disabled'} for "${automation.name}".`);
    }
    return;
  }

  // Warn if logging is disabled (debug logs won't work)
  if (enable && automation.logging === false && !options.quiet && !options.json) {
    console.log('Note: Logging is disabled for this workflow. Debug logs will be captured');
    console.log('but logging must be enabled to view them in the dashboard.');
    console.log('');
  }

  // Update settings
  if (!options.quiet && !options.json) {
    console.log(`${enable ? 'Enabling' : 'Disabling'} debug logging...`);
  }

  await client.updateAutomationSettings(automation._id, { debug: enable });

  // Output result
  if (options.json) {
    console.log(JSON.stringify({
      id: automation._id,
      key: automation.key,
      name: automation.name,
      debug: enable,
    }));
  } else if (!options.quiet) {
    const action = enable ? 'enabled' : 'disabled';
    console.log(`Debug logging ${action} for "${automation.name}" (${automation._id})`);
  }
}

async function showDebugStatus(
  workflowIdArg: string | undefined,
  options: DebugCommandOptions
): Promise<void> {
  const client = getClient(options);
  const response = await client.listAdminAutomations();

  let automations: AdminAutomation[];

  if (workflowIdArg) {
    // Filter to specific workflow
    const automation = response.automations.find(
      (a) => a._id === workflowIdArg || a.key === workflowIdArg
    );
    if (!automation) {
      if (options.json) {
        console.log(JSON.stringify({ error: true, message: 'Workflow not found' }));
      } else {
        console.error(`Error: Workflow "${workflowIdArg}" not found.`);
      }
      process.exit(1);
    }
    automations = [automation];
  } else {
    // Show all workflows with debug enabled, or all if none have debug
    const debugEnabled = response.automations.filter((a) => a.debug);
    automations = debugEnabled.length > 0 ? debugEnabled : response.automations;
  }

  if (options.json) {
    console.log(JSON.stringify(
      automations.map((a) => ({
        id: a._id,
        key: a.key,
        name: a.name,
        debug: a.debug ?? false,
        logging: a.logging ?? true,
      })),
      null,
      2
    ));
    return;
  }

  // Table output
  if (!workflowIdArg && response.automations.some((a) => a.debug)) {
    console.log('\nWorkflows with debug logging enabled:\n');
  } else if (!workflowIdArg) {
    console.log('\nNo workflows have debug logging enabled. Showing all:\n');
  } else {
    console.log('');
  }

  // Header
  const nameWidth = 35;
  const debugWidth = 8;
  const loggingWidth = 8;

  console.log(
    padRight('Name', nameWidth) +
    padRight('Debug', debugWidth) +
    padRight('Logging', loggingWidth)
  );
  console.log('─'.repeat(nameWidth + debugWidth + loggingWidth));

  for (const a of automations) {
    const debug = a.debug ? 'ON' : 'off';
    const logging = a.logging !== false ? 'on' : 'off';
    const name = a.name.length > nameWidth - 2 ? a.name.substring(0, nameWidth - 5) + '...' : a.name;

    console.log(
      padRight(name, nameWidth) +
      padRight(debug, debugWidth) +
      padRight(logging, loggingWidth)
    );
  }
  console.log('');
}

function padRight(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - str.length));
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
