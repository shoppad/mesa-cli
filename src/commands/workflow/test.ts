/**
 * Workflow Test Command
 *
 * Run a test execution for an entire workflow (from trigger through all steps).
 *
 * Usage:
 *   mesa workflow test                              # Interactive: pick workflow & payload
 *   mesa workflow test <workflowId>                 # Test specific workflow (pick payload)
 *   mesa workflow test --workflow-id abc            # Specific workflow
 *   mesa workflow test --payload ./data.json        # Custom payload from file
 *   mesa workflow test --default-payload            # Use default empty payload (skip picker)
 *   mesa workflow test --json                       # JSON output
 *   mesa workflow test --non-interactive            # CI mode
 */

import { Command } from 'commander';
import * as fs from 'fs';
import type {
  GlobalOptions,
  WorkflowTestOptions,
  AdminAutomation,
  FullAutomationTrigger,
} from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';
import { pickPayload } from '../../lib/test-picker.js';
import { pollTestCompletion } from '../../lib/test-runner.js';
import { formatStatus } from '../../lib/table.js';

/**
 * Register the test subcommand
 */
export function registerTestCommand(parent: Command): void {
  parent
    .command('test [workflowId]')
    .description('Run a test execution for a workflow')
    .option('--workflow-id <id>', 'Workflow ID (alternative to positional arg)')
    .option('--payload <path>', 'Path to JSON file with test payload')
    .option('--default-payload', 'Use default empty payload (skip interactive picker)')
    .option('--json', 'Output as JSON')
    .option('--non-interactive', 'Disable interactive prompts')
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 300000)', parseInt)
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(workflowIdArg, opts, cmd);

      try {
        const exitCode = await runTestCommand(options);
        process.exit(exitCode);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(
  workflowIdArg: string | undefined,
  opts: Record<string, unknown>,
  cmd: Command
): WorkflowTestOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId:
      workflowIdArg ||
      (typeof opts.workflowId === 'string' ? opts.workflowId : undefined),
    payload: typeof opts.payload === 'string' ? opts.payload
      : (typeof globals.payload === 'string' ? globals.payload : undefined),
    defaultPayload: Boolean(opts.defaultPayload),
    json: Boolean(opts.json),
    nonInteractive: Boolean(opts.nonInteractive),
    timeout: typeof opts.timeout === 'number' ? opts.timeout : 300000,
  };
}

function getClient(options: GlobalOptions, jsonOutput?: boolean): MesaClient {
  const cwd = process.cwd();
  const loaded = loadConfig(cwd, options.env);

  if (options.verbose && !jsonOutput) {
    console.log(
      `Loaded config from: ${loaded.source === 'local' ? 'Local' : 'Global'} (${loaded.path})`
    );
    console.log(`Store UUID: ${loaded.config.uuid}`);
    console.log('');
  }

  return new MesaClient({
    config: loaded.config,
    verbose: options.verbose,
  });
}

async function runTestCommand(options: WorkflowTestOptions): Promise<number> {
  const client = getClient(options, options.json);

  // 1. Resolve workflow ID/key
  let automation: AdminAutomation | undefined;
  let workflowId = options.workflowId;

  if (!workflowId) {
    // Non-interactive mode requires --workflow-id
    if (options.nonInteractive || !isInteractive()) {
      console.error('Error: --workflow-id is required in non-interactive mode');
      return 1;
    }

    // Interactive: show workflow picker
    if (!options.json) {
      console.log('Fetching workflows...');
    }

    const picked = await pickWorkflow(client, {
      message: 'Select a workflow to test:',
      filter: (a) => a.enabled && a.status !== 'deleted',
    });

    if (!picked) {
      console.log('No workflow selected.');
      return 0;
    }
    workflowId = picked;
  }

  // 2. Find the automation to get its key
  const listResponse = await client.listAdminAutomations();
  automation = listResponse.automations.find(
    (a) => a._id === workflowId || a.key === workflowId
  );

  if (!automation) {
    if (options.json) {
      console.log(
        JSON.stringify({ error: true, message: `Workflow "${workflowId}" not found` })
      );
    } else {
      console.error(`Error: Workflow "${workflowId}" not found.`);
    }
    return 1;
  }

  // 3. Resolve payload
  let payload: unknown;
  let payloadSource = 'default';

  if (options.payload) {
    // Load payload from file
    try {
      const content = fs.readFileSync(options.payload, 'utf-8');
      payload = JSON.parse(content);
      payloadSource = `File: ${options.payload}`;
    } catch (error) {
      if (options.json) {
        console.log(
          JSON.stringify({
            error: true,
            message: `Failed to read payload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          })
        );
      } else {
        console.error(
          `Error reading payload file: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      return 1;
    }
  } else if (!options.defaultPayload && !options.nonInteractive && isInteractive() && !options.json) {
    // Interactive mode: show payload picker
    // Find the input trigger for this workflow
    const inputTrigger = automation.triggers?.find(
      (t) => t.trigger_type === 'input'
    );

    if (inputTrigger) {
      const pickedPayload = await pickPayload({
        client,
        trigger: inputTrigger as FullAutomationTrigger,
      });

      if (pickedPayload) {
        payload = pickedPayload.payload;
        if (pickedPayload.record?.name) {
          payloadSource = `Test Record: ${pickedPayload.record.name}`;
        } else {
          payloadSource = 'Selected payload';
        }
      } else {
        // User cancelled or no payload available
        console.log('No payload selected. Using default empty payload.');
      }
    }
  }

  // 4. Execute test using the simpler CLI endpoint
  if (!options.json) {
    console.log('');
    console.log(`Testing workflow: ${automation.name}`);
    console.log(`Payload: ${payloadSource}`);
    console.log('');
  }

  let testResponse: { task: { id: string; run_task_id?: string } };
  try {
    testResponse = await client.testAutomationByKey(automation.key, payload);
  } catch (error) {
    if (error instanceof ApiError) {
      if (options.json) {
        console.log(JSON.stringify({ error: true, message: error.message }));
      } else {
        console.error(`Error: ${error.message}`);
      }
      return 1;
    }
    throw error;
  }

  // 5. Poll for completion using run_task_id to track ALL steps in the workflow
  const result = await pollTestCompletion({
    client,
    taskId: testResponse.task.id,
    runId: testResponse.task.run_task_id || testResponse.task.id,
    timeout: options.timeout,
    json: options.json,
  });

  // 6. Output results
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('');
    console.log('─'.repeat(60));
    console.log('Test Results');
    console.log('─'.repeat(60));
    console.log('');

    for (const step of result.steps) {
      const status = formatStatus(step.status);
      const duration = step.duration ? `${step.duration}ms` : '-';
      console.log(`  ${status} ${step.name} (${duration})`);
      if (step.error) {
        console.log(`      Error: ${step.error}`);
        if (step.details) {
          // Indent each line of details
          const detailLines = step.details.split('\n');
          console.log('');
          for (const line of detailLines) {
            console.log(`      ${line}`);
          }
        }
      }
    }

    // Display logs if there were failures
    if (result.logs && result.logs.length > 0) {
      console.log('');
      console.log('─'.repeat(60));
      console.log('Recent Logs');
      console.log('─'.repeat(60));
      console.log('');

      for (const log of result.logs) {
        const timestamp = formatLogTimestamp(log['@timestamp']);
        const level = (log.level || 'info').toUpperCase().padEnd(5);
        const stepName = log.trigger?.name || log.task?.automation?.automation_name || '';
        const prefix = stepName ? `[${stepName}] ` : '';

        console.log(`  ${timestamp} ${level} ${prefix}${log.message}`);

        // Show meta data if present (often contains variable values, etc.)
        if (log.fields?.meta) {
          try {
            const meta = typeof log.fields.meta === 'string'
              ? JSON.parse(log.fields.meta)
              : log.fields.meta;
            if (typeof meta === 'object' && meta !== null) {
              const metaStr = JSON.stringify(meta, null, 2)
                .split('\n')
                .map((line) => `             ${line}`)
                .join('\n');
              console.log(metaStr);
            }
          } catch {
            // If meta isn't JSON, show it as-is
            console.log(`             ${log.fields.meta}`);
          }
        }
      }
    }

    console.log('');
    console.log('─'.repeat(60));
    console.log(`Execution ID: ${result.executionId}`);
    if (result.runId) {
      console.log(`Run ID: ${result.runId}`);
    }
    console.log(`Total Duration: ${result.duration}ms`);
    console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  }

  return result.success ? 0 : 1;
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
      if (error.statusCode === 426) {
        console.error('Rate limit exceeded. You can run 10 tests per hour.');
        console.error('Wait a few minutes and try again.');
      } else {
        console.error(`API error (${error.statusCode}): ${error.message}`);
      }
    } else if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unexpected error occurred');
    }
  }
  process.exit(1);
}

/**
 * Format a log timestamp for display
 */
function formatLogTimestamp(timestamp: string | number): string {
  try {
    const date = typeof timestamp === 'number'
      ? new Date(timestamp)
      : new Date(timestamp);

    if (isNaN(date.getTime())) {
      return String(timestamp).substring(0, 19);
    }

    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(timestamp).substring(0, 19);
  }
}
