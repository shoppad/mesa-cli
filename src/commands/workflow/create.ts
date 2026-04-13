/**
 * Workflow Create Command
 *
 * Creates a new workflow interactively or from JSON input.
 *
 * Interactive mode (default):
 *   mesa workflow create
 *
 * Non-interactive mode:
 *   mesa workflow create --non-interactive --input workflow.json
 *   echo '{"name":"..."}' | mesa workflow create --non-interactive
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { GlobalOptions, MesaAutomation, WorkflowCreateOptions } from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { buildAutomationUrl } from '../../lib/automation.js';
import {
  TriggerRegistryService,
  WorkflowBuilder,
  buildWorkflowFromInput,
  serializeWorkflow,
} from '../../lib/workflow/index.js';

/**
 * Register the create subcommand
 */
export function registerCreateCommand(parent: Command): void {
  parent
    .command('create')
    .description('Create a new workflow interactively or from JSON input')
    .option('--non-interactive', 'Non-interactive mode (requires --input or stdin)')
    .option('--input <file>', 'JSON file with workflow definition')
    .option('--output <file>', 'Output file path (default: ./mesa.json)')
    .option('--push', 'Push workflow to MESA after creation')
    .option('--json', 'Output JSON to stdout (for scripting)')
    .option('--force', 'Overwrite existing automation with same key')
    .action(async (opts, cmd: Command) => {
      const options = getGlobalOptions(cmd);
      const createOpts: WorkflowCreateOptions = {
        ...options,
        nonInteractive: Boolean(opts.nonInteractive),
        input: opts.input as string | undefined,
        output: opts.output as string | undefined,
        push: Boolean(opts.push),
        json: Boolean(opts.json),
        force: Boolean(opts.force),
      };

      try {
        let workflow: MesaAutomation | null = null;
        let action: 'save' | 'push' | 'print' | 'cancel' = 'save';

        if (createOpts.nonInteractive) {
          workflow = await handleNonInteractive(createOpts);
          // In non-interactive mode, determine action from flags
          if (createOpts.json) {
            action = 'print';
          } else if (createOpts.push) {
            action = 'push';
          } else {
            action = 'save';
          }
        } else {
          const result = await handleInteractive(createOpts);
          workflow = result.workflow;
          action = result.action;
        }

        if (!workflow || action === 'cancel') {
          console.log('Workflow creation cancelled.');
          return;
        }

        await handleOutput(workflow, action, createOpts);
      } catch (error) {
        handleError(error);
      }
    });
}

/**
 * Get global options from command
 */
function getGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof opts.env === 'string' ? opts.env : undefined,
    automation: typeof opts.automation === 'string' ? opts.automation : undefined,
    force: Boolean(opts.force),
    verbose: Boolean(opts.verbose),
    number: typeof opts.number === 'string' ? opts.number : undefined,
    payload: typeof opts.payload === 'string' ? opts.payload : undefined,
  };
}

/**
 * Get working directory
 */
function getCwd(): string {
  return process.cwd();
}

/**
 * Load config and create client
 */
function getClient(options: GlobalOptions): { client: MesaClient; uuid: string; apiUrl?: string; verbose: boolean } {
  const cwd = getCwd();
  const loaded = loadConfig(cwd, options.env);

  if (options.verbose) {
    console.log(`Loaded config from: ${loaded.source === 'local' ? 'Local' : 'Global'} (${loaded.path})`);
    console.log(`Store UUID: ${loaded.config.uuid}`);
    console.log('');
  }

  const client = new MesaClient({
    config: loaded.config,
    verbose: options.verbose,
  });

  return { client, uuid: loaded.config.uuid, apiUrl: loaded.config.api_url, verbose: options.verbose ?? false };
}

/**
 * Handle interactive workflow creation
 */
async function handleInteractive(
  options: WorkflowCreateOptions
): Promise<{ workflow: MesaAutomation | null; action: 'save' | 'push' | 'print' | 'cancel' }> {
  const { client } = getClient(options);
  const registry = new TriggerRegistryService(client);
  const builder = new WorkflowBuilder(registry);

  return builder.build();
}

/**
 * Handle non-interactive workflow creation
 */
async function handleNonInteractive(
  options: WorkflowCreateOptions
): Promise<MesaAutomation> {
  let inputJson: string;

  if (options.input) {
    // Read from file
    if (!existsSync(options.input)) {
      throw new Error(`Input file not found: ${options.input}`);
    }
    inputJson = readFileSync(options.input, 'utf-8');
  } else {
    // Read from stdin
    inputJson = await readStdin();
  }

  if (!inputJson.trim()) {
    throw new Error('No input provided. Use --input <file> or pipe JSON to stdin.');
  }

  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch (e) {
    throw new Error(`Invalid JSON input: ${(e as Error).message}`);
  }

  const { client } = getClient(options);
  const registry = new TriggerRegistryService(client);

  return buildWorkflowFromInput(input as Parameters<typeof buildWorkflowFromInput>[0], registry);
}

/**
 * Read from stdin
 */
async function readStdin(): Promise<string> {
  // Check if stdin is a TTY (interactive terminal)
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
      let chunk: string | null;
      while ((chunk = process.stdin.read() as string | null) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', reject);

    // Timeout after 100ms if no data (for non-piped scenarios)
    setTimeout(() => {
      if (data === '') {
        resolve('');
      }
    }, 100);
  });
}

/**
 * Handle workflow output based on action
 */
async function handleOutput(
  workflow: MesaAutomation,
  action: 'save' | 'push' | 'print',
  options: WorkflowCreateOptions
): Promise<void> {
  const json = serializeWorkflow(workflow, true);

  switch (action) {
    case 'print':
      console.log(json);
      break;

    case 'save': {
      const outputPath = options.output ?? './mesa.json';
      writeFileSync(outputPath, json);
      console.log(`Workflow saved to: ${outputPath}`);
      break;
    }

    case 'push': {
      const { client, uuid, apiUrl } = getClient(options);

      console.log('Pushing workflow to MESA...');

      try {
        const response = await client.createWorkflow(workflow, options.force);

        if (response.success === false) {
          console.error('Failed to push workflow:', response.log ?? 'Unknown error');
          process.exit(1);
        }

        console.log('Workflow pushed successfully!');

        if (response.log) {
          console.log(response.log);
        }

        // Show automation URL
        const automationId = response.automation?._id ?? workflow.key;
        const automationUrl = buildAutomationUrl(apiUrl, uuid, automationId);
        console.log('');
        console.log(`View workflow: ${automationUrl}`);

        // Also save locally if output path specified
        if (options.output) {
          writeFileSync(options.output, json);
          console.log(`Also saved to: ${options.output}`);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          console.error(`API Error: ${error.message}`);
          if (error.response.error) {
            console.error(error.response.error);
          }
          process.exit(1);
        }
        throw error;
      }
      break;
    }
  }
}

/**
 * Handle errors
 */
function handleError(error: unknown): never {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
    console.error('');
    console.error('Run "mesa auth login" to authenticate, or create a config file.');
    process.exit(1);
  }

  if (error instanceof ApiError) {
    console.error(`API error (${error.statusCode}): ${error.message}`);
    if (error.response.error) {
      console.error(error.response.error);
    }
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  console.error('An unexpected error occurred');
  console.error(error);
  process.exit(1);
}
