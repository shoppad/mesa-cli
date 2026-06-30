/**
 * Workflow Typeahead Command
 *
 * Resolves a step field's typeahead options outside the dashboard — useful for
 * verifying that a picker returns the right options and that search filters.
 *
 * Usage:
 *   mesa workflow typeahead <workflowId> --step set_by_variant --field inventoryItemId --search uPhone
 *   mesa workflow typeahead <workflowId> --step publish_res --field id --search hat
 *   mesa workflow typeahead <workflowId> --field publicationId --value gid://shopify/Publication/1 --json
 */

import { Command } from 'commander';
import type { GlobalOptions, AdminAutomation, AdminAutomationTrigger } from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';

interface TypeaheadOptions extends GlobalOptions {
  workflowId?: string;
  step?: string;
  field?: string;
  search?: string;
  value?: string;
  json: boolean;
  nonInteractive: boolean;
}

interface TriggerExtra extends AdminAutomationTrigger { operation_id?: string }
interface Option { label?: string; value?: string }

export function registerTypeaheadCommand(parent: Command): void {
  parent
    .command('typeahead [workflowId]')
    .description("Resolve a step field's typeahead options (verify options + search filtering)")
    .option('--workflow-id <id>', 'Workflow ID or key (alternative to positional arg)')
    .option('--step <key>', 'Step key to target (default: first output step)')
    .requiredOption('--field <fieldKey>', 'The field to resolve a typeahead for (e.g. inventoryItemId)')
    .option('--search <term>', 'Browse query (filters the options)')
    .option('--value <value>', 'Resolve a specific saved value to its label')
    .option('--json', 'Output as JSON only')
    .option('--non-interactive', 'Disable interactive prompts')
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(workflowIdArg, opts, cmd);
      try {
        process.exit(await run(options));
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(workflowIdArg: string | undefined, opts: Record<string, unknown>, cmd: Command): TypeaheadOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId: workflowIdArg || (typeof opts.workflowId === 'string' ? opts.workflowId : undefined),
    step: typeof opts.step === 'string' ? opts.step : undefined,
    field: typeof opts.field === 'string' ? opts.field : undefined,
    search: typeof opts.search === 'string' ? opts.search : undefined,
    value: typeof opts.value === 'string' ? opts.value : undefined,
    json: Boolean(opts.json),
    nonInteractive: Boolean(opts.nonInteractive),
  };
}

function getClient(options: GlobalOptions, jsonOutput?: boolean): MesaClient {
  const loaded = loadConfig(process.cwd(), options.env);
  if (options.verbose && !jsonOutput) console.log(`Store UUID: ${loaded.config.uuid}`);
  return new MesaClient({ config: loaded.config, verbose: options.verbose });
}

async function run(options: TypeaheadOptions): Promise<number> {
  const client = getClient(options, options.json);

  let workflowId = options.workflowId;
  if (!workflowId) {
    if (options.nonInteractive || !isInteractive()) return fail(options.json, '--workflow-id is required in non-interactive mode');
    const picked = await pickWorkflow(client, { message: 'Select a workflow:', filter: (a) => a.status !== 'deleted' });
    if (!picked) { console.log('No workflow selected.'); return 0; }
    workflowId = picked;
  }

  const list = await client.listAdminAutomations();
  const automation: AdminAutomation | undefined = list.automations.find((a) => a._id === workflowId || a.key === workflowId);
  if (!automation) return fail(options.json, `Workflow "${workflowId}" not found.`);
  const triggers = (automation.triggers || []) as TriggerExtra[];
  const trigger = options.step
    ? triggers.find((t) => t.key === options.step)
    : triggers.find((t) => t.trigger_type === 'output');
  if (!trigger) return fail(options.json, options.step ? `Step "${options.step}" not found.` : 'No output step found (try --step).');

  const params: Record<string, string> = {};
  if (options.value) params.value = options.value;
  else params.search = options.search ?? '';

  if (!options.json) {
    const mode = options.value ? `value=${options.value}` : `search=${JSON.stringify(options.search ?? '')}`;
    console.log(`Resolving typeahead "${options.field}" on step "${trigger.name}" (${mode})...`);
  }

  const result = (await client.invokeTypeahead(trigger.trigger_type, trigger._id, options.field as string, params)) as {
    response?: Option[];
  };
  const opts = Array.isArray(result?.response) ? result.response : [];

  if (options.json) {
    console.log(JSON.stringify({
      workflow: { id: automation._id, key: automation.key },
      step: { key: trigger.key, name: trigger.name, id: trigger._id },
      field: options.field,
      count: opts.length,
      options: opts,
    }, null, 2));
  } else {
    console.log('');
    console.log('─'.repeat(60));
    console.log(`${opts.length} option(s):`);
    for (const o of opts.slice(0, 50)) console.log(`  • ${o.label ?? '(no label)'}   [${o.value ?? ''}]`);
    if (opts.length > 50) console.log(`  … and ${opts.length - 50} more`);
    console.log('');
  }
  return 0;
}

function fail(jsonOutput: boolean, message: string): number {
  if (jsonOutput) console.log(JSON.stringify({ error: true, message }));
  else console.error(`Error: ${message}`);
  return 1;
}

function handleError(error: unknown, jsonOutput?: boolean): never {
  if (jsonOutput) {
    console.error(JSON.stringify({ error: true, message: error instanceof Error ? error.message : 'Unknown error', code: error instanceof ApiError ? error.statusCode : undefined }));
  } else if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
    console.error('Run "mesa auth login" to authenticate.');
  } else if (error instanceof ApiError) {
    console.error(`API error (${error.statusCode}): ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error('An unexpected error occurred');
  }
  process.exit(1);
}
