/**
 * Workflow Retrieve-Fields Command
 *
 * Invokes a step's `updateLocalFields` JS hook — the "Retrieve Fields" button
 * in the builder — outside the dashboard, then reads back the step's
 * local_fields and prints the dynamic form fields that were produced.
 *
 * Primary use: verify the Shopify v2 "Create Metaobject Entry" Retrieve Fields
 * flow. Given a metaobject definition type, it should load that definition's
 * field definitions as form inputs (color, size, etc.).
 *
 * Usage:
 *   mesa workflow retrieve-fields <workflowId>                 # uses the step's saved Type
 *   mesa workflow retrieve-fields <workflowId> --type season   # override the definition type
 *   mesa workflow retrieve-fields <workflowId> --step create_entry
 *   mesa workflow retrieve-fields <workflowId> --json
 */

import { Command } from 'commander';
import type { GlobalOptions, AdminAutomation, AdminAutomationTrigger } from '../../types/index.js';
import { loadConfig, ConfigError } from '../../lib/config.js';
import { MesaClient, ApiError } from '../../lib/client.js';
import { pickWorkflow, isInteractive } from '../../lib/workflow-picker.js';

interface RetrieveFieldsOptions extends GlobalOptions {
  workflowId?: string;
  step?: string;
  type?: string;
  method: string;
  json: boolean;
  nonInteractive: boolean;
}

/** Trigger shape with the extra runtime fields the API returns but the type omits. */
interface TriggerWithLocals extends AdminAutomationTrigger {
  operation_id?: string;
  local_fields?: LocalField[];
}

interface LocalField {
  key: string;
  label?: string;
  type?: string;
  source?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  fields?: LocalField[];
}

export function registerRetrieveFieldsCommand(parent: Command): void {
  parent
    .command('retrieve-fields [workflowId]')
    .description("Invoke a step's \"Retrieve Fields\" (updateLocalFields) hook and print the dynamic fields it produces")
    .option('--workflow-id <id>', 'Workflow ID or key (alternative to positional arg)')
    .option('--step <key>', 'Step key to target (default: the first metaobjectCreate/updateLocalFields-capable output step)')
    .option('--type <type>', 'Metaobject definition type to load (overrides the step\'s saved Type)')
    .option('--method <name>', 'The on-change hook method to invoke', 'updateLocalFields')
    .option('--json', 'Output as JSON only')
    .option('--non-interactive', 'Disable interactive prompts')
    .action(async (workflowIdArg, opts, cmd: Command) => {
      const options = getOptions(workflowIdArg, opts, cmd);
      try {
        const exitCode = await runRetrieveFieldsCommand(options);
        process.exit(exitCode);
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

function getOptions(workflowIdArg: string | undefined, opts: Record<string, unknown>, cmd: Command): RetrieveFieldsOptions {
  const globals = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof globals.env === 'string' ? globals.env : undefined,
    verbose: Boolean(globals.verbose),
    workflowId: workflowIdArg || (typeof opts.workflowId === 'string' ? opts.workflowId : undefined),
    step: typeof opts.step === 'string' ? opts.step : undefined,
    type: typeof opts.type === 'string' ? opts.type : undefined,
    method: typeof opts.method === 'string' ? opts.method : 'updateLocalFields',
    json: Boolean(opts.json),
    nonInteractive: Boolean(opts.nonInteractive),
  };
}

function getClient(options: GlobalOptions, jsonOutput?: boolean): MesaClient {
  const loaded = loadConfig(process.cwd(), options.env);
  if (options.verbose && !jsonOutput) {
    console.log(`Store UUID: ${loaded.config.uuid}`);
  }
  return new MesaClient({ config: loaded.config, verbose: options.verbose });
}

/** True if this output step supports the Retrieve Fields hook. */
function isRetrieveFieldsStep(t: TriggerWithLocals): boolean {
  if (t.trigger_type !== 'output') return false;
  const meta = (t.metadata || {}) as Record<string, unknown>;
  const api = typeof meta.api_endpoint === 'string' ? meta.api_endpoint : '';
  const op = t.operation_id || (typeof meta.operation_id === 'string' ? meta.operation_id : '');
  return (
    op === 'metaobjectCreate' ||
    op === 'metaobjectUpdate' ||
    /metaobject\/(create|update)/.test(api) ||
    (t.entity === 'metaobject' && (t.action === 'create' || t.action === 'update'))
  );
}

/** Pull the form's currently-saved Type out of the step metadata.body. */
function savedType(t: TriggerWithLocals): string | undefined {
  const meta = (t.metadata || {}) as Record<string, unknown>;
  const body = (meta.body || {}) as Record<string, unknown>;
  const type = body.type ?? meta.type;
  return typeof type === 'string' && type.trim() ? type.trim() : undefined;
}

/** Extract the dynamic (source: 'shopify') fields from a step's local_fields tree. */
function extractDynamicFields(localFields: LocalField[] | undefined): LocalField[] {
  if (!Array.isArray(localFields)) return [];
  const body = localFields.find((f) => f.key === 'body');
  const group = body?.fields?.find((f) => f.key === 'fields');
  const fields = group?.fields || [];
  return fields.filter((f) => f.source === 'shopify');
}

async function findStep(client: MesaClient, workflowId: string, stepKey?: string): Promise<{ automation: AdminAutomation; trigger: TriggerWithLocals } | null> {
  const list = await client.listAdminAutomations();
  const automation = list.automations.find((a) => a._id === workflowId || a.key === workflowId);
  if (!automation) return null;
  const triggers = (automation.triggers || []) as TriggerWithLocals[];
  let trigger: TriggerWithLocals | undefined;
  if (stepKey) {
    trigger = triggers.find((t) => t.key === stepKey);
  } else {
    trigger = triggers.find(isRetrieveFieldsStep);
  }
  return trigger ? { automation, trigger } : null;
}

async function runRetrieveFieldsCommand(options: RetrieveFieldsOptions): Promise<number> {
  const client = getClient(options, options.json);

  // 1. Resolve workflow id/key
  let workflowId = options.workflowId;
  if (!workflowId) {
    if (options.nonInteractive || !isInteractive()) {
      return failure(options.json, '--workflow-id is required in non-interactive mode');
    }
    const picked = await pickWorkflow(client, { message: 'Select a workflow:', filter: (a) => a.status !== 'deleted' });
    if (!picked) { console.log('No workflow selected.'); return 0; }
    workflowId = picked;
  }

  // 2. Find the target step
  const found = await findStep(client, workflowId, options.step);
  if (!found) {
    return failure(options.json, options.step
      ? `Step "${options.step}" not found in workflow "${workflowId}".`
      : `Workflow "${workflowId}" has no metaobjectCreate/updateLocalFields-capable step (try --step).`);
  }
  const { automation, trigger } = found;

  // 3. Determine the definition type to load
  const type = options.type || savedType(trigger);
  if (!type) {
    return failure(options.json, `No definition type: pass --type, or set a Type on the "${trigger.name}" step first.`);
  }

  if (!options.json) {
    console.log(`Invoking ${options.method} on step "${trigger.name}" (${trigger._id}) with type="${type}"...`);
  }

  // 4. Invoke the hook. Server-side this runs setLocalFields (persists to the
  //    trigger) and the CLI endpoint returns the resulting local_fields.
  const result = (await client.invokeOnChange(trigger.trigger_type, trigger._id, options.method, { type })) as {
    local_fields?: LocalField[];
  };
  const dynamic = extractDynamicFields(result?.local_fields);

  // 6. Report
  if (options.json) {
    console.log(JSON.stringify({
      workflow: { id: automation._id, key: automation.key, name: automation.name },
      step: { key: trigger.key, name: trigger.name, id: trigger._id },
      type,
      field_count: dynamic.length,
      fields: dynamic.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })),
    }, null, 2));
  } else {
    console.log('');
    console.log('─'.repeat(60));
    console.log(`Workflow: ${automation.name}`);
    console.log(`Step:     ${trigger.name}  (${trigger._id})`);
    console.log(`Type:     ${type}`);
    console.log('─'.repeat(60));
    if (!dynamic.length) {
      console.log('No dynamic fields were produced. Either the definition has no');
      console.log('fields, the type is wrong, or the hook failed.');
    } else {
      console.log(`Retrieved ${dynamic.length} field(s):`);
      for (const f of dynamic) {
        const extra = f.type === 'select' && f.options ? ` [${f.options.map((o) => o.value).join(', ')}]` : '';
        console.log(`  • ${f.label || f.key}  (key=${f.key}, type=${f.type}${f.required ? ', required' : ''})${extra}`);
      }
    }
    console.log('');
    console.log(`View workflow: https://dev-mesa.theshoppad.com/automations/${automation._id}/builder`);
  }

  return dynamic.length > 0 ? 0 : 1;
}

function failure(jsonOutput: boolean, message: string): number {
  if (jsonOutput) console.log(JSON.stringify({ error: true, message }));
  else console.error(`Error: ${message}`);
  return 1;
}

function handleError(error: unknown, jsonOutput?: boolean): never {
  if (jsonOutput) {
    console.error(JSON.stringify({
      error: true,
      message: error instanceof Error ? error.message : 'Unknown error',
      code: error instanceof ApiError ? error.statusCode : undefined,
    }));
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
