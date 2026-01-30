/**
 * Step Builder
 *
 * Handles the interactive process of building a single workflow step.
 * Guides the user through app selection, operation selection, and field configuration.
 */

import { input, select, confirm, search } from '@inquirer/prompts';
import type {
  WorkflowStep,
  TriggerField,
  AppConfig,
  AppOperation,
} from '../../types/index.js';
import { TriggerRegistryService } from './trigger-registry.js';
import { selectToken } from './token-picker.js';

/**
 * Builder for a single workflow step
 */
export class StepBuilder {
  constructor(
    private registry: TriggerRegistryService,
    private previousSteps: WorkflowStep[]
  ) {}

  /**
   * Build a step interactively
   * @param type - Whether to build a trigger or action
   * @returns The configured workflow step
   */
  async buildStep(type: 'trigger' | 'action'): Promise<WorkflowStep> {
    // 1. Select app
    const entry = await this.registry.searchApps(
      type === 'trigger' ? 'input' : 'output'
    );

    // 2. Get app configuration
    const appConfig = await this.registry.getAppConfig(
      entry.key,
      type === 'trigger' ? 'input' : 'output'
    );

    // 3. Check for OAuth requirements
    if (this.registry.requiresOAuth(appConfig)) {
      const provider = this.registry.getOAuthProvider(appConfig);
      console.log('');
      console.log(`Note: ${entry.name} requires OAuth authentication.`);
      console.log(`Complete setup in MESA UI after creating the workflow.`);
      if (provider) {
        console.log(`OAuth provider: ${provider}`);
      }
      console.log('');
    }

    // 4. Select operation
    const operation = await this.selectOperation(appConfig);

    // 5. Generate step key
    const stepKey = await this.generateStepKey(entry.key, operation.operation_id);

    // 6. Configure fields - use operation fields if available, fallback to app fields
    const stepFields = operation.fields ?? appConfig.fields;
    const fieldValues = await this.configureFields(stepFields);

    // 7. Handle secrets/connections
    const secretValues = await this.configureSecrets(stepFields);
    Object.assign(fieldValues, secretValues);

    return {
      key: stepKey,
      name: `${entry.name} - ${operation.title}`,
      type,
      app_key: entry.key,
      version: entry.current_version,
      entity_key: operation.entity_key,
      action_key: operation.action_key,
      operation_id: operation.operation_id,
      metadata: operation.metadata ?? {},
      fields: stepFields,
      field_values: fieldValues,
      response_example: operation.response_example as Record<string, unknown> | undefined,
      requires_oauth: this.registry.requiresOAuth(appConfig),
    };
  }

  /**
   * Select an operation from app config
   */
  private async selectOperation(config: AppConfig): Promise<AppOperation> {
    const operations = config.operations || [];

    if (operations.length === 0) {
      throw new Error(`No operations available for ${config.name}`);
    }

    // If only one operation, select it automatically
    if (operations.length === 1) {
      return operations[0];
    }

    // Interactive search for operation
    const selected = await search<AppOperation>({
      message: 'Select operation:',
      source: async (searchInput) => {
        const term = (searchInput ?? '').toLowerCase();
        const filtered = operations.filter(
          (op) =>
            op.title.toLowerCase().includes(term) ||
            op.operation_id.toLowerCase().includes(term) ||
            op.description?.toLowerCase().includes(term) ||
            op.entity_name?.toLowerCase().includes(term) ||
            op.action_name?.toLowerCase().includes(term)
        );

        return filtered.map((op) => ({
          name: op.title,
          value: op,
          description: op.description || op.operation_id,
        }));
      },
    });

    return selected;
  }

  /**
   * Generate a unique step key
   */
  private async generateStepKey(
    appKey: string,
    operationId: string
  ): Promise<string> {
    // Create base key from app and operation
    const baseKey = `${appKey}_${operationId}`
      .replace(/[^a-z0-9_]/gi, '_')
      .toLowerCase();

    // Check for conflicts with existing steps
    const existingKeys = new Set(this.previousSteps.map((s) => s.key));
    let suggestedKey = baseKey;
    let counter = 1;
    while (existingKeys.has(suggestedKey)) {
      suggestedKey = `${baseKey}_${counter}`;
      counter++;
    }

    // Let user confirm or customize the key
    const finalKey = await input({
      message: 'Step key:',
      default: suggestedKey,
      validate: (v) => {
        if (!/^[a-z][a-z0-9_]*$/i.test(v)) {
          return 'Must start with a letter and contain only letters, numbers, and underscores';
        }
        if (existingKeys.has(v)) {
          return 'Key already used by another step';
        }
        return true;
      },
    });

    return finalKey;
  }

  /**
   * Configure secret/connection fields
   */
  private async configureSecrets(
    fields: TriggerField[]
  ): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};

    // Find secret fields
    const secretFields = fields.filter((f) => f.type === 'secret' && f.secret_type);

    for (const field of secretFields) {
      const secretType = field.secret_type!;
      const secrets = await this.registry.getSecrets(secretType);

      if (secrets.length === 0) {
        // No connections available - warn the user
        console.log('');
        console.log(`Note: No ${field.label || secretType} connection configured.`);
        console.log(`You'll need to set up a connection in MESA UI after creating the workflow.`);
        console.log('');
      } else if (secrets.length === 1) {
        // One connection - auto-select it
        const secret = secrets[0];
        values[field.key] = secret._id;
        console.log(`Using ${field.label || secretType} connection: ${secret.name}`);
      } else {
        // Multiple connections - ask which one to use
        const defaultSecret = secrets.find((s) => s.is_default) || secrets[0];

        const useDefault = await confirm({
          message: `Use default ${field.label || secretType} connection "${defaultSecret.name}"?`,
          default: true,
        });

        if (useDefault) {
          values[field.key] = defaultSecret._id;
        } else {
          const selected = await select({
            message: `Select ${field.label || secretType} connection:`,
            choices: secrets.map((s) => ({
              name: s.name + (s.is_default ? ' (default)' : ''),
              value: s._id,
            })),
          });
          values[field.key] = selected;
        }
      }
    }

    return values;
  }

  /**
   * Configure fields for the step
   */
  private async configureFields(
    fields: TriggerField[]
  ): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};

    // Filter out internal/secret fields
    const configurableFields = fields.filter((f) => {
      // Skip secret fields (OAuth, API keys - handled elsewhere)
      if (f.type === 'secret') return false;
      // Skip hidden fields
      if (f.type === 'hidden') return false;
      return true;
    });

    if (configurableFields.length === 0) {
      return values;
    }

    // Handle object fields (like 'body', 'query', 'path') that contain nested fields
    // These come from OpenAPI spec and need to be structured properly in metadata
    for (const field of configurableFields) {
      if (field.type === 'object' && field.fields && field.fields.length > 0) {
        // Recursively configure nested fields
        const nestedValues = await this.configureFields(field.fields);
        if (Object.keys(nestedValues).length > 0) {
          values[field.key] = nestedValues;
        }
      }
    }

    // Get non-object fields for standard prompting
    const standardFields = configurableFields.filter((f) => f.type !== 'object');

    // Separate required and optional fields
    const requiredFields = standardFields.filter((f) => f.required);
    const optionalFields = standardFields.filter((f) => !f.required && f.location !== 'advanced');

    // Always prompt for required fields
    if (requiredFields.length > 0) {
      console.log('');
      console.log('Configure required fields:');
      for (const field of requiredFields) {
        const value = await this.promptForField(field);
        if (value !== undefined && value !== '') {
          values[field.key] = value;
        }
      }
    }

    // Ask if user wants to configure optional fields
    if (optionalFields.length > 0) {
      const configureOptional = await confirm({
        message: `Configure optional fields? (${optionalFields.length} available)`,
        default: false,
      });

      if (configureOptional) {
        console.log('');
        console.log('Configure optional fields (press Enter to skip):');
        for (const field of optionalFields) {
          const value = await this.promptForField(field);
          if (value !== undefined && value !== '') {
            values[field.key] = value;
          }
        }
      }
    }

    return values;
  }

  /**
   * Prompt for a single field value
   */
  private async promptForField(field: TriggerField): Promise<unknown> {
    const label = field.label || field.key;
    const required = field.required ? ' (required)' : '';
    const description = field.description ? ` - ${field.description}` : '';
    const hasTokens = this.previousSteps.length > 0;

    // Handle different field types
    switch (field.type) {
      case 'select':
        if (field.options && field.options.length > 0) {
          return select({
            message: `${label}${required}${description}`,
            choices: field.options.map((o) => ({
              name: o.label,
              value: o.value,
            })),
          });
        }
        // Fall through to text input if no options
        return this.promptTextField(field, label, required, description, hasTokens);

      case 'checkbox':
        return confirm({
          message: `${label}${required}${description}`,
          default: false,
        });

      case 'number':
        return input({
          message: `${label}${required}${description}`,
          validate: (v) => {
            if (field.required && !v) return 'This field is required';
            if (v && isNaN(Number(v))) return 'Must be a number';
            return true;
          },
        }).then((v) => (v ? Number(v) : undefined));

      case 'textarea':
      case 'code':
        return this.promptTextField(field, label, required, description, hasTokens, true);

      case 'text':
      default:
        return this.promptTextField(field, label, required, description, hasTokens);
    }
  }

  /**
   * Prompt for a text field with optional token insertion
   */
  private async promptTextField(
    field: TriggerField,
    label: string,
    required: string,
    description: string,
    hasTokens: boolean,
    isMultiline = false
  ): Promise<string | undefined> {
    // If we have tokens available, offer the choice
    if (hasTokens) {
      const choice = await select({
        message: `${label}${required}${description}`,
        choices: [
          { name: 'Enter value', value: 'enter' },
          { name: 'Insert token from previous step', value: 'token' },
          ...(!field.required ? [{ name: 'Skip (leave empty)', value: 'skip' }] : []),
        ],
      });

      if (choice === 'skip') {
        return undefined;
      }

      if (choice === 'token') {
        const token = await selectToken(this.previousSteps);
        if (token) {
          return token;
        }
        // If token selection was cancelled, fall through to manual entry
      }
    }

    // Manual text entry
    if (isMultiline) {
      console.log('(Enter value, or use tokens like {{step.field}}):');
    }

    const value = await input({
      message: isMultiline ? `${label}:` : `${label}${required}${description}`,
      default: field.placeholder,
      validate: (v) => (field.required && !v ? 'This field is required' : true),
    });

    return value || undefined;
  }
}

/**
 * Build a step from non-interactive input
 */
export async function buildStepFromInput(
  registry: TriggerRegistryService,
  stepInput: {
    type: 'trigger' | 'action';
    app: string;
    operation_id?: string;
    entity?: string;
    action?: string;
    key?: string;
    fields?: Record<string, unknown>;
  },
  existingKeys: Set<string>
): Promise<WorkflowStep> {
  const type = stepInput.type === 'trigger' ? 'input' : 'output';
  const appConfig = await registry.getAppConfig(stepInput.app, type);

  // Get the registry entry to find the version
  const entries = await registry.getEntries(type);
  const registryEntry = entries.find((e) => e.key === stepInput.app);
  const version = registryEntry?.current_version;

  // Check if operations are available
  if (!appConfig.operations || appConfig.operations.length === 0) {
    throw new Error(`No operations available for ${stepInput.app}. The app may not support ${type} operations.`);
  }

  // Find operation by operation_id or entity+action
  let operation: AppOperation | undefined;

  if (stepInput.operation_id) {
    operation = appConfig.operations.find((op) => op.operation_id === stepInput.operation_id);
    if (!operation) {
      const available = appConfig.operations.map((op) => op.operation_id).slice(0, 10).join(', ');
      throw new Error(
        `Operation "${stepInput.operation_id}" not found in ${stepInput.app}. Available: ${available}...`
      );
    }
  } else if (stepInput.entity && stepInput.action) {
    // Legacy entity+action lookup
    operation = appConfig.operations.find(
      (op) => op.entity_key === stepInput.entity && op.action_key === stepInput.action
    );
    if (!operation) {
      const available = appConfig.operations.map((op) => `${op.entity_key}/${op.action_key}`).slice(0, 10).join(', ');
      throw new Error(
        `Operation for entity="${stepInput.entity}" action="${stepInput.action}" not found in ${stepInput.app}. Available: ${available}...`
      );
    }
  } else {
    throw new Error('Either operation_id or entity+action must be provided');
  }

  // Generate key if not provided
  let stepKey = stepInput.key;
  if (!stepKey) {
    stepKey = `${stepInput.app}_${operation.operation_id}`
      .replace(/[^a-z0-9_]/gi, '_')
      .toLowerCase();

    let counter = 1;
    const originalKey = stepKey;
    while (existingKeys.has(stepKey)) {
      stepKey = `${originalKey}_${counter}`;
      counter++;
    }
  }

  // Use operation fields if available, fallback to app fields
  const stepFields = operation.fields ?? appConfig.fields;

  // Auto-select secrets for non-interactive mode
  const fieldValues: Record<string, unknown> = { ...(stepInput.fields ?? {}) };

  // Find secret fields that need auto-selection
  const secretFields = stepFields.filter(
    (f: TriggerField) => f.type === 'secret' && f.secret_type && !fieldValues[f.key]
  );

  for (const field of secretFields) {
    // For OAuth secrets, use the app/connector key to find secrets
    const secretType = field.secret_type;
    if (!secretType) continue;

    const secretLookupKey = secretType === 'oauth' ? stepInput.app : secretType;
    try {
      const secrets = await registry.getSecrets(secretLookupKey);
      if (secrets.length > 0) {
        // Auto-select the default secret, or the first one
        const defaultSecret = secrets.find((s) => s.is_default) || secrets[0];
        fieldValues[field.key] = defaultSecret._id;
        console.log(`Using ${field.label || secretLookupKey} connection: ${defaultSecret.name}`);
      } else {
        console.log(`Note: No ${field.label || secretLookupKey} connection configured.`);
      }
    } catch {
      // Silently continue if secrets endpoint fails
    }
  }

  return {
    key: stepKey,
    name: `${appConfig.name} - ${operation.title}`,
    type: stepInput.type,
    app_key: stepInput.app,
    version,
    entity_key: operation.entity_key,
    action_key: operation.action_key,
    operation_id: operation.operation_id,
    metadata: operation.metadata ?? {},
    fields: stepFields,
    field_values: fieldValues,
    response_example: operation.response_example as Record<string, unknown> | undefined,
    requires_oauth: registry.requiresOAuth(appConfig),
  };
}
