/**
 * Workflow Test-Payload Command
 *
 * Invokes the input trigger's `testPayload` hook directly and prints the
 * resulting payload — what the dashboard "Test" tab would render in its
 * preview. Unlike `mesa workflow test`, this does NOT execute the workflow;
 * it just exercises the connector's testPayload code path for a single
 * record id.
 *
 * Useful for verifying that an input trigger's testPayload return shape
 * matches the real webhook delivery shape during v1→v2 ports.
 *
 * Usage:
 *   mesa workflow test-payload <workflowId>          # auto-pick newest record
 *   mesa workflow test-payload <workflowId> --id 123 # specific record id
 *   mesa workflow test-payload --workflow-id <id> --json
 */

import { Command } from 'commander';
import type {
  GlobalOptions,
  AdminAutomation,
  AdminAutomationTrigger,
} from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';

interface TestPayloadOptions extends GlobalOptions {
  workflowId?: string;
  id?: string;
  json: boolean;
  nonInteractive: boolean;
}

export function registerTestPayloadCommand(parent: Command): void {
  parent
    .command('test-payload [workflowId]')
    .description("Invoke a workflow's input testPayload hook and print the result (no run)")
    .option('--workflow-id <id>', 'Workflow ID or key (alternative to positional arg)')
    .option('--id <recordId>', 'Connector record id to pass to testPayload (auto-picked from recent records if omitted)')
    .option('--json', 'Output as JSON only (suppresses progress lines)')
    .option('--non-interactive', 'Disable interactive prompts')
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(workflowIdArg, opts, cmd);
      try {
        const exitCode = await runTestPayloadCommand(options);
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
): TestPayloadOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId:
      workflowIdArg ||
      (typeof opts.workflowId === 'string' ? opts.workflowId : undefined),
    id: typeof opts.id === 'string' ? opts.id : undefined,
    json: Boolean(opts.json),
    nonInteractive: Boolean(opts.nonInteractive),
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

async function runTestPayloadCommand(options: TestPayloadOptions): Promise<number> {
  const client = getClient(options, options.json);

  // 1. Resolve workflow id/key
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

  // 2. Find the automation + its input trigger
  const listResponse = await client.listAdminAutomations();
  const automation: AdminAutomation | undefined = listResponse.automations.find(
    (a) => a._id === workflowId || a.key === workflowId
  );

  if (!automation) {
    return failure(options.json, `Workflow "${workflowId}" not found.`);
  }

  const input: AdminAutomationTrigger | undefined = (automation.triggers || []).find(
    (t) => t.trigger_type === 'input'
  );
  if (!input) {
    return failure(options.json, `Workflow "${automation.key}" has no input trigger.`);
  }

  // 3. Resolve record id — explicit --id, else auto-pick newest from getTestPayloads.
  // Record ids may come back as full Shopify gids (gid://shopify/Foo/123). The
  // testPayload endpoint takes the value as a URL path segment, so slashes
  // break routing — strip down to the numeric tail.
  let recordId = options.id;
  let pickedAuto = false;
  if (!recordId) {
    try {
      const tests = await client.getTestPayloads(input.trigger_type, input._id);
      const first = (tests.records && tests.records[0]) || null;
      if (first) {
        recordId = first.id;
        pickedAuto = true;
        if (!options.json) {
          console.log(`Auto-picked newest record: ${first.label} (id=${first.id})`);
        }
      }
    } catch {
      // Fall through — recordId stays undefined
    }
  }
  if (recordId) {
    recordId = stripGid(recordId);
  }

  if (!recordId) {
    return failure(
      options.json,
      `No --id supplied and no recent records returned by testSearch for ${input.entity}/${input.action}.`
    );
  }

  // 4. Invoke testPayload
  if (!options.json) {
    console.log(`Invoking testPayload for ${input.entity}/${input.action} with id=${recordId}...`);
  }
  const response = await client.getTestPayload(
    input.trigger_type,
    input._id,
    recordId,
    'connector'
  );

  // 5. Print result
  if (options.json) {
    console.log(JSON.stringify({
      workflow: { id: automation._id, key: automation.key, name: automation.name },
      trigger: { entity: input.entity, action: input.action, step_id: input._id },
      record_id: recordId,
      auto_picked: pickedAuto,
      description: response.description ?? '',
      payload: response.payload ?? null,
      ...(response.error ? { error: response.error } : {}),
    }, null, 2));
  } else {
    console.log('');
    console.log('─'.repeat(60));
    console.log(`Workflow: ${automation.name}`);
    console.log(`Trigger:  ${input.entity}/${input.action}  (step ${input._id})`);
    console.log(`Record:   ${recordId}${pickedAuto ? ' (auto-picked)' : ''}`);
    if (response.description) console.log(`Note:     ${response.description}`);
    if (response.error) console.log(`Error:    ${response.error}`);
    console.log('─'.repeat(60));
    console.log('Payload:');
    console.log(JSON.stringify(response.payload ?? null, null, 2));
    console.log('');
    console.log(`View workflow: https://dev-mesa.theshoppad.com/automations/${automation._id}/builder`);
  }

  return response.error ? 1 : 0;
}

/**
 * Strip `gid://shopify/Entity/123` → `123` so the value is URL-safe as a
 * single path segment. Pass through other id forms unchanged.
 */
function stripGid(id: string): string {
  const m = id.match(/gid:\/\/[^/]+\/[^/]+\/(.+)$/);
  return m ? m[1] : id;
}

function failure(jsonOutput: boolean, message: string): number {
  if (jsonOutput) {
    console.log(JSON.stringify({ error: true, message }));
  } else {
    console.error(`Error: ${message}`);
  }
  return 1;
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
