/**
 * Workflow Step Test Command
 *
 * Execute a single step in isolation.
 * Note: Step testing currently uses the same endpoint as workflow testing
 * since individual step testing requires Dashboard API access.
 *
 * Usage:
 *   mesa workflow step test <workflowId>
 *   mesa workflow step test my-workflow --payload ./order.json
 */

import { Command } from 'commander';
import * as fs from 'fs';
import type {
  GlobalOptions,
  StepTestOptions,
  AdminAutomation,
} from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';
import { pollTestCompletion } from '../../lib/test-runner.js';
import { formatStatus } from '../../lib/table.js';

/**
 * Register the step test subcommand
 */
export function registerStepTestCommand(parent: Command): void {
  // Create a "step" subcommand group
  const stepCommand = parent
    .command('step')
    .description('Step-level operations');

  // Add "test" under "step"
  stepCommand
    .command('test [workflowId]')
    .description('Run a test execution for a workflow (step testing runs the full workflow)')
    .option('--workflow-id <id>', 'Workflow ID')
    .option('--payload <path>', 'Path to JSON file with test payload')
    .option('--json', 'Output as JSON')
    .option('--non-interactive', 'Disable interactive prompts')
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 300000)', parseInt)
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(workflowIdArg, opts, cmd);

      try {
        const exitCode = await runStepTestCommand(options);
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
): StepTestOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId:
      workflowIdArg ||
      (typeof opts.workflowId === 'string' ? opts.workflowId : undefined),
    payload: typeof opts.payload === 'string' ? opts.payload : undefined,
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

async function runStepTestCommand(options: StepTestOptions): Promise<number> {
  const client = getClient(options, options.json);

  // Note: Individual step testing requires Dashboard API access.
  // For now, this command runs the full workflow test.
  if (!options.json && !options.nonInteractive) {
    console.log('Note: Step testing currently runs the full workflow.');
    console.log('');
  }

  // 1. Resolve workflow ID
  let automation: AdminAutomation | undefined;
  let workflowId = options.workflowId;

  if (!workflowId) {
    if (options.nonInteractive || !isInteractive()) {
      console.error('Error: --workflow-id is required in non-interactive mode');
      return 1;
    }

    if (!options.json) {
      console.log('Fetching workflows...');
    }

    const picked = await pickWorkflow(client, {
      message: 'Select a workflow:',
      filter: (a) => a.status !== 'deleted',
    });

    if (!picked) {
      console.log('No workflow selected.');
      return 0;
    }
    workflowId = picked;
  }

  // 2. Find the automation
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

  // 3. Resolve payload (optional)
  let payload: unknown;
  let payloadSource = 'default';

  if (options.payload) {
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
  }

  // 4. Execute test
  if (!options.json) {
    console.log('');
    console.log(`Testing workflow: ${automation.name}`);
    console.log(`Payload: ${payloadSource}`);
    console.log('');
  }

  let testResponse: { task: { id: string } };
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

  // 5. Poll for completion
  const result = await pollTestCompletion({
    client,
    taskId: testResponse.task.id,
    timeout: options.timeout,
    json: options.json,
  });

  // 6. Output results
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('');
    console.log('─'.repeat(60));
    console.log('Step Test Results');
    console.log('─'.repeat(60));
    console.log('');

    for (const step of result.steps) {
      const status = formatStatus(step.status);
      const duration = step.duration ? `${step.duration}ms` : '-';
      console.log(`  ${status} ${step.name} (${duration})`);
      if (step.error) {
        console.log(`     Error: ${step.error}`);
      }
    }

    console.log('');
    console.log('─'.repeat(60));
    console.log(`Execution ID: ${result.executionId}`);
    console.log(`Duration: ${result.duration}ms`);
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
