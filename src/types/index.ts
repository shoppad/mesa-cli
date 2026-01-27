/**
 * Type definitions for mesa-cli
 * All types are strict - no `any` allowed
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * CLI configuration loaded from config.yml
 * Can be stored locally in ./config/ or globally in ~/.mesa/
 */
export interface MesaConfig {
  /** MESA store UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or legacy shopify subdomain) */
  uuid: string;
  /** API key for authenticating with MESA API */
  key: string;
  /** Optional: Override the default API URL */
  api_url?: string;
}

/**
 * Parsed configuration file with environment support
 */
export interface ConfigFile {
  [environment: string]: MesaConfig;
}

// =============================================================================
// mesa.json Types (Automation Definition)
// =============================================================================

/**
 * Trigger or action definition in an automation
 */
export interface AutomationStep {
  key: string;
  name: string;
  /** Step type - either display format ('trigger'/'action') or connector key ('shopify'/'email') */
  type?: string;
  /** Trigger type for API ('input' or 'output') - used in config.inputs/outputs format */
  trigger_type?: 'input' | 'output';
  /** Connector version (e.g., 'v2', 'v3') */
  version?: string;
  operation_id?: string;
  metadata?: Record<string, unknown>;
  local_fields?: Field[];
  selected_fields?: string[];
  on_error?: 'default' | 'continue' | 'stop';
  weight?: number;
}

/**
 * Complete automation configuration from mesa.json
 */
export interface MesaAutomation {
  _id?: string;
  key: string;
  name: string;
  version: string;
  enabled?: boolean;
  setup?: boolean;
  config?: AutomationConfig;
  triggers?: AutomationStep[];
  actions?: AutomationStep[];
  readme?: string;
}

/**
 * Automation-level configuration
 * Note: When importing, inputs/outputs contain AutomationStep[].
 * When exported, they may contain Field[] for field definitions.
 */
export interface AutomationConfig {
  inputs?: AutomationStep[] | Field[];
  outputs?: AutomationStep[] | Field[];
  storage?: StorageItem[];
}

/**
 * Storage item definition
 */
export interface StorageItem {
  key: string;
  value: string;
}

// =============================================================================
// Field Types (used in automations and generate-fields)
// =============================================================================

export type FieldType =
  | 'text'
  | 'textarea'
  | 'checkbox'
  | 'select'
  | 'number'
  | 'object'
  | 'array'
  | 'code'
  | 'richtext'
  | 'json';

export type DataType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/**
 * Field definition for automation inputs/outputs
 */
export interface Field {
  key: string;
  label: string;
  type: FieldType;
  data_type: DataType;
  description?: string;
  required?: boolean;
  importance?: number;
  provides?: string;
  fields?: Field[];
  allow_custom_fields?: boolean;
  options?: FieldOption[];
}

/**
 * Option for select fields
 */
export interface FieldOption {
  label: string;
  value: string;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Script object returned by scripts endpoint
 */
export interface Script {
  filename: string;
  code: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Response from GET /{automation}/scripts.json
 */
export interface ScriptsResponse {
  scripts: Script[];
}

/**
 * Response from POST /automations.json
 */
export interface AutomationImportResponse {
  automation?: MesaAutomation;
  log?: string;
  success?: boolean;
}

/**
 * Secret/connection entry
 */
export interface SecretEntry {
  /** Secret ID */
  _id: string;
  /** Display name */
  name: string;
  /** Secret type (e.g., 'shopify', 'slack') */
  type: string;
  /** Whether this is the default secret */
  is_default?: boolean;
}

/**
 * Task object for replay/test commands
 */
export interface Task {
  id: string;
  automation_key: string;
  trigger_key?: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

/**
 * Response from POST /tasks/{id}/replay.json or test endpoint
 */
export interface TaskResponse {
  task: Task;
  success?: boolean;
}

/**
 * Log entry from logs endpoint
 */
export interface LogEntry {
  '@timestamp': string | number;
  message: string;
  level?: string;
  task?: {
    _id: string;
    automation?: {
      _id: string;
      automation_name: string;
    };
  };
  trigger?: {
    name: string;
    _id: string;
  };
  fields?: {
    meta?: string;
  };
}

/**
 * Response from GET /logs.json
 */
export interface LogsResponse {
  logs: LogEntry[];
}

/**
 * Automation summary from list endpoint
 */
export interface AutomationListItem {
  _id: string;
  key: string;
  name: string;
  enabled: boolean;
  source?: string;
  destination?: string;
  updated_at?: string;
}

/**
 * Response from GET /automations.json
 */
export interface AutomationsListResponse {
  automations: AutomationListItem[];
}

/**
 * Response from GET /automations/{key}.json
 */
export interface AutomationResponse extends MesaAutomation {
  config: AutomationConfig;
}

/**
 * Response from POST /templates/install.json
 */
export interface TemplateInstallResponse {
  log: string;
  success?: boolean;
}

// =============================================================================
// CLI Auth Flow Types (Device Code / One-Time Code)
// =============================================================================

/**
 * Response from POST /api/cli/auth/device
 * Initiates the device authorization flow
 */
export interface DeviceAuthStartResponse {
  /** Server-side code used to poll for completion */
  device_code: string;
  /** Human-readable code to display to user */
  user_code: string;
  /** URL for user to visit in browser */
  verification_url: string;
  /** Seconds until codes expire */
  expires_in: number;
  /** Recommended polling interval in seconds */
  interval: number;
}

/**
 * Response from GET /api/cli/auth/status
 * Used to poll for authorization completion
 */
export interface DeviceAuthStatusResponse {
  /** Current status of the authorization request */
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /** Present when status is 'approved' - the MESA store UUID */
  uuid?: string;
  /** Present when status is 'approved' - the API key */
  api_key?: string;
  /** Error message if status is 'denied' */
  error?: string;
}

/**
 * Locally stored credentials after successful auth
 */
export interface StoredCredentials {
  uuid: string;
  key: string;
  api_url?: string;
  /** Timestamp when credentials were stored */
  authenticated_at: string;
}

// =============================================================================
// CLI Command Types
// =============================================================================

/**
 * Global CLI options available on all commands
 */
export interface GlobalOptions {
  /** Environment to use (filename in ./config/) */
  env?: string;
  /** Automation key (overrides mesa.json detection) */
  automation?: string;
  /** Force overwrite */
  force?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Number parameter (for logs, etc.) */
  number?: string;
  /** JSON payload for test commands */
  payload?: string;
}

/**
 * CLI command definitions
 */
export type CommandName =
  | 'push'
  | 'pull'
  | 'watch'
  | 'export'
  | 'install'
  | 'replay'
  | 'test'
  | 'logs'
  | 'auth'
  | 'workflow';

// =============================================================================
// HTTP Client Types
// =============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Options for API requests
 */
export interface RequestOptions {
  method: HttpMethod;
  endpoint: string;
  data?: Record<string, unknown>;
  params?: Record<string, string>;
}

/**
 * Error response from MESA API
 */
export interface ApiErrorResponse {
  error?: string;
  message?: string;
  status?: number;
}

// =============================================================================
// Generate Fields Types
// =============================================================================

/**
 * Options for generate-fields command
 */
export interface GenerateFieldsOptions {
  /** Output folder (defaults to ../fields/) */
  output?: string;
  /** Print to console instead of saving */
  print?: boolean;
  /** Set importance on all fields */
  importance?: string;
  /** Set required on all fields (true/false) */
  required?: string;
  /** Set allow_custom_fields on objects/arrays */
  allowcustom?: string;
}

/**
 * Mapping of key patterns to provides values
 */
export interface ProvidesMapping {
  [pattern: string]: string;
}

// =============================================================================
// Workflow Create Types (Trigger Registry & Builder)
// =============================================================================

/**
 * Entry in the trigger registry (list of available apps)
 */
export interface TriggerRegistryEntry {
  /** App key (e.g., 'shopify', 'slack') */
  key: string;
  /** Display name */
  name: string;
  /** Icon URL */
  icon: string;
  /** Whether this is an input (trigger) or output (action) */
  type: 'input' | 'output';
  /** Tags for categorization */
  tags?: string[];
  /** Whether this requires a pro subscription */
  is_pro?: boolean;
  /** Sort weight */
  weight?: number;
  /** Current active version (e.g., 'v2') */
  current_version?: string;
}

/**
 * Full trigger registry with inputs and outputs
 */
export interface TriggerRegistry {
  inputs: TriggerRegistryEntry[];
  outputs: TriggerRegistryEntry[];
}

/**
 * Action within an entity (e.g., Order -> Created, Updated)
 */
export interface AppAction {
  /** Display name */
  name: string;
  /** Action key (e.g., 'created', 'updated') */
  key: string;
  /** Metadata for the action */
  metadata?: Record<string, unknown>;
  /** Operation ID for API calls */
  operation_id: string;
  /** API path pattern */
  path?: string;
  /** HTTP method */
  method?: string;
  /** Field definitions for this action */
  fields?: TriggerField[];
  /** Example response data (for token picker) */
  response_example?: Record<string, unknown>;
}

/**
 * Entity within an app (e.g., Order, Product, Customer)
 */
export interface AppEntity {
  /** Display name */
  name: string;
  /** Entity key (e.g., 'order', 'product') */
  key: string;
  /** Available actions for this entity */
  actions: AppAction[];
}

/**
 * Field definition from trigger config (simpler than full Field type)
 */
export interface TriggerField {
  key: string;
  label?: string;
  type: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  location?: string;
  secret_type?: string;
  oauth_provider?: string;
  options?: FieldOption[];
  /** Nested fields for object type fields (e.g., body, query, path from OpenAPI) */
  fields?: TriggerField[];
  /** Whether custom fields are allowed (for object type fields) */
  allow_custom_fields?: boolean;
}

/**
 * Operation from Algolia (flat trigger definition)
 */
export interface AppOperation {
  /** Operation ID (e.g., 'orders_create') */
  operation_id: string;
  /** Display title from Algolia */
  title: string;
  /** Description from Algolia */
  description: string;
  /** Entity key from config.json */
  entity_key: string;
  /** Entity name from config.json */
  entity_name: string;
  /** Action key from config.json */
  action_key: string;
  /** Action name from config.json */
  action_name: string;
  /** Metadata for the operation */
  metadata?: Record<string, unknown>;
  /** Field definitions */
  fields?: TriggerField[];
  /** Example response data (for token picker) */
  response_example?: unknown[] | null;
}

/**
 * Full app configuration with operations and fields
 */
export interface AppConfig {
  /** Schema version */
  schema: number;
  /** Whether this is an input or output trigger */
  type: 'input' | 'output';
  /** App display name */
  name: string;
  /** App key */
  key: string;
  /** Configuration fields for the app */
  fields: TriggerField[];
  /** Available operations (from Algolia + config.json) */
  operations: AppOperation[];
  /** @deprecated Use operations instead */
  entities?: AppEntity[];
  /** Example response data (for token picker) */
  response_example?: Record<string, unknown>;
}

/**
 * Step being built in the workflow wizard
 */
export interface WorkflowStep {
  /** Unique key for this step */
  key: string;
  /** Display name */
  name: string;
  /** Whether this is a trigger or action */
  type: 'trigger' | 'action';
  /** App key (e.g., 'shopify') */
  app_key: string;
  /** Connector version (e.g., 'v2') */
  version?: string;
  /** Entity key (e.g., 'order') */
  entity_key: string;
  /** Action key (e.g., 'created') */
  action_key: string;
  /** Operation ID */
  operation_id: string;
  /** Action metadata */
  metadata: Record<string, unknown>;
  /** Field definitions from config */
  fields: TriggerField[];
  /** User-provided field values */
  field_values: Record<string, unknown>;
  /** Response example for token picker */
  response_example?: Record<string, unknown>;
  /** Whether this step requires OAuth setup */
  requires_oauth?: boolean;
}

/**
 * State of the workflow builder wizard
 */
export interface WorkflowBuilderState {
  /** Workflow name */
  name: string;
  /** Workflow key (auto-generated from name) */
  key: string;
  /** Steps in the workflow */
  steps: WorkflowStep[];
}

/**
 * Token path for the token picker
 */
export interface TokenPath {
  /** Step key that provides this token */
  step_key: string;
  /** Human-readable step name (e.g., 'Shopify - Order Created') */
  step_name: string;
  /** Path to the field (e.g., 'order.customer.email') */
  path: string;
  /** Human-readable label for the field (e.g., 'Customer Email') */
  label: string;
  /** Description of the field */
  description?: string;
  /** Full token string (e.g., '{{step_key.order.customer.email}}') */
  full_token: string;
}

/**
 * Input for non-interactive workflow creation (single step)
 */
export interface WorkflowStepInput {
  /** Step type */
  type: 'trigger' | 'action';
  /** App key */
  app: string;
  /** Operation ID (preferred) */
  operation_id?: string;
  /** Entity key (deprecated, use operation_id) */
  entity?: string;
  /** Action key (deprecated, use operation_id) */
  action?: string;
  /** Optional custom step key */
  key?: string;
  /** Field values */
  fields?: Record<string, unknown>;
}

/**
 * Input for non-interactive workflow creation
 */
export interface WorkflowCreateInput {
  /** Workflow name */
  name: string;
  /** Optional workflow key (auto-generated if not provided) */
  key?: string;
  /** Whether to enable the workflow */
  enabled?: boolean;
  /** Steps to create */
  steps: WorkflowStepInput[];
}

/**
 * Options for workflow create command
 */
export interface WorkflowCreateOptions extends GlobalOptions {
  /** Non-interactive mode */
  nonInteractive?: boolean;
  /** Input file path */
  input?: string;
  /** Output file path */
  output?: string;
  /** Push to MESA after creation */
  push?: boolean;
  /** Output JSON to stdout */
  json?: boolean;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Type guard helper for checking if value is an object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard for checking if value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard for MesaConfig
 */
export function isMesaConfig(value: unknown): value is MesaConfig {
  return (
    isObject(value) &&
    typeof value.uuid === 'string' &&
    typeof value.key === 'string'
  );
}

/**
 * Type guard for MesaAutomation
 */
export function isMesaAutomation(value: unknown): value is MesaAutomation {
  return (
    isObject(value) &&
    typeof value.key === 'string' &&
    typeof value.name === 'string' &&
    typeof value.version === 'string'
  );
}

/**
 * Type guard for API error responses
 */
export function isApiError(value: unknown): value is ApiErrorResponse {
  return isObject(value) && ('error' in value || 'message' in value);
}
