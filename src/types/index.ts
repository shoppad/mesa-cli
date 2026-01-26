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
  type: 'trigger' | 'action';
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
 */
export interface AutomationConfig {
  inputs?: Field[];
  outputs?: Field[];
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
  '@timestamp': string;
  message: string;
  level?: string;
  trigger: {
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
  | 'auth';

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
