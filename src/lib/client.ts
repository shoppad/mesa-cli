/**
 * HTTP client for MESA API
 *
 * Handles all communication with the MESA API, including:
 * - Authentication via X-Api-Key header
 * - Error handling and response typing
 * - Request/response logging in verbose mode
 */

import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type {
  MesaConfig,
  HttpMethod,
  ApiErrorResponse,
  ScriptsResponse,
  AutomationImportResponse,
  AutomationResponse,
  AutomationsListResponse,
  TaskResponse,
  LogsResponse,
  TemplateInstallResponse,
  DeviceAuthStartResponse,
  DeviceAuthStatusResponse,
  TriggerRegistry,
  AppConfig,
  MesaAutomation,
  SecretEntry,
  AdminAutomationsListResponse,
  AutomationRunsResponse,
  AutomationRunsParams,
  BackfillStatusResponse,
  BackfillStartRequest,
  BackfillStartResponse,
  AutomationSettingsRequest,
  AutomationSettingsResponse,
  TestPayloadsResponse,
  TestPayloadResponse,
  TestRecordsResponse,
  TestRecord,
  WorkflowTestResponse,
  StepTestResponse,
  TaskDetailsResponse,
  RunDetailsResponse,
} from '../types/index.js';
import { isApiError } from '../types/index.js';
import { getApiUrl } from './config.js';

/**
 * Error thrown when API request fails
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly response: ApiErrorResponse;

  constructor(message: string, statusCode: number, response: ApiErrorResponse) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

/**
 * Options for creating a MESA API client
 */
export interface ClientOptions {
  /** MESA configuration with uuid and key */
  config: MesaConfig;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * MESA API client
 */
export class MesaClient {
  private readonly baseUrl: string;
  private readonly uuid: string;
  private readonly apiKey: string;
  private readonly verbose: boolean;

  constructor(options: ClientOptions) {
    this.baseUrl = getApiUrl(options.config);
    this.uuid = options.config.uuid;
    this.apiKey = options.config.key;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Make an API request
   */
  private async request<T>(
    method: HttpMethod,
    endpoint: string,
    data?: Record<string, unknown>,
    params?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}/${this.uuid}/${endpoint}`;

    const config: AxiosRequestConfig = {
      method,
      url,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      params,
    };

    if (method !== 'GET' && data) {
      config.data = data;
    }

    if (this.verbose) {
      console.log(`[API] ${method} ${url}`);
      if (params && Object.keys(params).length > 0) {
        console.log('[API] Query params:', params);
      }
      if (data) {
        console.log('[API] Request body:', JSON.stringify(data, null, 2));
      }
    }

    try {
      const response: AxiosResponse<T> = await axios(config);

      if (this.verbose) {
        console.log(`[API] Response status: ${response.status}`);
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const statusCode = error.response?.status ?? 500;
        const responseData: unknown = error.response?.data;

        let apiError: ApiErrorResponse;
        if (isApiError(responseData)) {
          apiError = responseData;
        } else {
          apiError = {
            error: error.message,
            status: statusCode,
          };
        }

        if (this.verbose) {
          console.error(`[API] Error: ${statusCode}`, apiError);
        }

        throw new ApiError(
          apiError.error ?? apiError.message ?? 'API request failed',
          statusCode,
          apiError
        );
      }

      throw error;
    }
  }

  // =========================================================================
  // Script Operations
  // =========================================================================

  /**
   * Get all scripts for an automation
   */
  async getScripts(automationKey: string): Promise<ScriptsResponse> {
    return this.request<ScriptsResponse>('GET', `${automationKey}/scripts.json`);
  }

  /**
   * Upload a script to an automation
   */
  async uploadScript(
    automationKey: string,
    filename: string,
    code: string
  ): Promise<void> {
    await this.request<void>('POST', `${automationKey}/scripts.json`, {
      script: {
        filename,
        code,
      },
    });
  }

  // =========================================================================
  // Automation Operations
  // =========================================================================

  /**
   * Get an automation by key
   */
  async getAutomation(automationKey: string): Promise<AutomationResponse> {
    return this.request<AutomationResponse>('GET', `automations/${automationKey}.json`);
  }

  /**
   * List all automations
   */
  async listAutomations(): Promise<AutomationsListResponse> {
    return this.request<AutomationsListResponse>('GET', 'automations.json');
  }

  /**
   * Import an automation from mesa.json
   */
  async importAutomation(
    automation: Record<string, unknown>,
    force: boolean
  ): Promise<AutomationImportResponse> {
    const endpoint = force ? 'automations.json?force=1' : 'automations.json';
    return this.request<AutomationImportResponse>('POST', endpoint, automation);
  }

  // =========================================================================
  // Task Operations
  // =========================================================================

  /**
   * Replay a task
   */
  async replayTask(taskId: string): Promise<TaskResponse> {
    return this.request<TaskResponse>('POST', `tasks/${taskId}/replay.json`);
  }

  /**
   * Test an automation
   */
  async testAutomation(
    automationKey: string,
    triggerKey: string | undefined,
    payload: string | undefined
  ): Promise<TaskResponse> {
    const endpoint = triggerKey
      ? `${automationKey}/triggers/${triggerKey}/test.json`
      : `automations/${automationKey}/test.json`;

    return this.request<TaskResponse>('POST', endpoint, { payload });
  }

  // =========================================================================
  // Log Operations
  // =========================================================================

  /**
   * Get logs
   */
  async getLogs(params: Record<string, string>): Promise<LogsResponse> {
    return this.request<LogsResponse>('GET', 'logs.json', undefined, params);
  }

  // =========================================================================
  // Template Operations
  // =========================================================================

  /**
   * Install a template
   */
  async installTemplate(
    template: string,
    force: boolean
  ): Promise<TemplateInstallResponse> {
    return this.request<TemplateInstallResponse>('POST', 'templates/install.json', {
      template,
      force: force ? 1 : 0,
    });
  }

  // =========================================================================
  // Workflow Operations (CLI API)
  // =========================================================================

  /**
   * Make a CLI API request
   * CLI endpoints use /api/cli/* path with uuid as query parameter
   */
  private async cliRequest<T>(endpoint: string): Promise<T> {
    // Derive the CLI API base from the admin API URL
    // e.g., https://api.getmesa.com/v1/admin -> https://api.getmesa.com/v1/api/cli
    // or https://app.theshoppad.com/api/admin -> https://app.theshoppad.com/api/cli
    let cliBaseUrl: string;
    if (this.baseUrl.includes('/v1/admin')) {
      // Production: api.getmesa.com/v1/admin -> api.getmesa.com/v1/api/cli
      cliBaseUrl = this.baseUrl.replace('/v1/admin', '/v1/api/cli');
    } else if (this.baseUrl.includes('/api/admin')) {
      // Direct app URL: /api/admin -> /api/cli
      cliBaseUrl = this.baseUrl.replace('/api/admin', '/api/cli');
    } else {
      // Fallback: append /cli to base
      cliBaseUrl = this.baseUrl.replace(/\/admin$/, '/cli');
    }

    const url = `${cliBaseUrl}/${endpoint}`;

    const config: AxiosRequestConfig = {
      method: 'GET',
      url,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      params: {
        uuid: this.uuid,
      },
    };

    if (this.verbose) {
      console.log(`[CLI API] GET ${url}`);
      console.log('[CLI API] Query params:', { uuid: this.uuid });
    }

    try {
      const response: AxiosResponse<T> = await axios(config);

      if (this.verbose) {
        console.log(`[CLI API] Response status: ${response.status}`);
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const statusCode = error.response?.status ?? 500;
        const responseData: unknown = error.response?.data;

        let apiError: ApiErrorResponse;
        if (isApiError(responseData)) {
          apiError = responseData;
        } else {
          apiError = {
            error: error.message,
            status: statusCode,
          };
        }

        if (this.verbose) {
          console.error(`[CLI API] Error: ${statusCode}`, apiError);
        }

        throw new ApiError(
          apiError.error ?? apiError.message ?? 'CLI API request failed',
          statusCode,
          apiError
        );
      }

      throw error;
    }
  }

  /**
   * Get trigger registry (list of all available apps/triggers)
   * Calls the CLI API endpoint /cli/triggers.json which wraps existing trigger functionality
   */
  async getTriggerRegistry(): Promise<TriggerRegistry> {
    return this.cliRequest<TriggerRegistry>('triggers.json');
  }

  /**
   * Get app configuration with entities, actions, and fields
   * @param appKey - The app key (e.g., 'shopify', 'slack')
   * @param type - Whether this is an input (trigger) or output (action)
   */
  async getAppConfig(appKey: string, type: 'input' | 'output'): Promise<AppConfig> {
    return this.cliRequest<AppConfig>(`triggers/${appKey}/${type}.json`);
  }

  /**
   * Create a new workflow/automation
   * @param workflow - The workflow definition to create
   * @param force - Whether to overwrite existing automation with same key
   */
  async createWorkflow(
    workflow: MesaAutomation,
    force = false
  ): Promise<AutomationImportResponse> {
    const endpoint = force ? 'automations.json?force=1' : 'automations.json';
    return this.request<AutomationImportResponse>('POST', endpoint, workflow as unknown as Record<string, unknown>);
  }

  /**
   * Get available secrets/connections for a secret type
   * @param secretType - The secret type (e.g., 'shopify', 'slack', 'google')
   */
  async getSecrets(secretType: string): Promise<SecretEntry[]> {
    try {
      const response = await this.cliRequest<{ secrets: SecretEntry[] }>(`secrets/${secretType}.json`);
      return response.secrets || [];
    } catch {
      // If API doesn't support secrets endpoint, return empty array
      return [];
    }
  }

  // =========================================================================
  // Admin API Operations (Workflow List/Activity/Time-Travel)
  // =========================================================================

  /**
   * Make an Admin API request with query params support
   */
  private async adminRequest<T>(
    method: HttpMethod,
    endpoint: string,
    data?: Record<string, unknown>,
    params?: Record<string, string | number | undefined>
  ): Promise<T> {
    // Clean undefined params
    const cleanParams: Record<string, string> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          cleanParams[key] = String(value);
        }
      }
    }

    // Use the same base URL pattern as regular requests
    const url = `${this.baseUrl}/${this.uuid}/${endpoint}`;

    const config: AxiosRequestConfig = {
      method,
      url,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      params: cleanParams,
    };

    if (method !== 'GET' && data) {
      config.data = data;
    }

    if (this.verbose) {
      console.log(`[API] ${method} ${url}`);
      if (Object.keys(cleanParams).length > 0) {
        console.log('[API] Query params:', cleanParams);
      }
      if (data) {
        console.log('[API] Request body:', JSON.stringify(data, null, 2));
      }
    }

    try {
      const response: AxiosResponse<T> = await axios(config);

      if (this.verbose) {
        console.log(`[API] Response status: ${response.status}`);
      }

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const statusCode = error.response?.status ?? 500;
        const responseData: unknown = error.response?.data;

        let apiError: ApiErrorResponse;
        if (isApiError(responseData)) {
          apiError = responseData;
        } else {
          apiError = {
            error: error.message,
            status: statusCode,
          };
        }

        if (this.verbose) {
          console.error(`[API] Error: ${statusCode}`, apiError);
        }

        throw new ApiError(
          apiError.error ?? apiError.message ?? 'API request failed',
          statusCode,
          apiError
        );
      }

      throw error;
    }
  }

  /**
   * List all automations (with detailed info including triggers)
   * Uses the same endpoint as existing listAutomations but returns full AdminAutomation type
   */
  async listAdminAutomations(): Promise<AdminAutomationsListResponse> {
    return this.adminRequest<AdminAutomationsListResponse>('GET', 'automations.json');
  }

  /**
   * Test an automation (workflow) via the CLI API
   * POST /api/admin/{uuid}/automations/{key}/test.json
   * This is a simpler endpoint that handles trigger resolution internally
   */
  async testAutomationByKey(
    automationKey: string,
    payload?: unknown
  ): Promise<{ task: { id: string; run_task_id?: string } }> {
    return this.adminRequest<{ task: { id: string; run_task_id?: string } }>(
      'POST',
      `automations/${automationKey}/test.json`,
      payload !== undefined ? { payload } as Record<string, unknown> : undefined
    );
  }

  /**
   * Get automation runs (activity) for a specific automation
   * Endpoint: GET /automations/{id}/queue.json
   */
  async getAutomationRuns(
    automationId: string,
    params?: AutomationRunsParams
  ): Promise<AutomationRunsResponse> {
    return this.adminRequest<AutomationRunsResponse>(
      'GET',
      `automations/${automationId}/queue.json`,
      undefined,
      params as Record<string, string | number | undefined>
    );
  }

  /**
   * Get backfill status for an automation
   * Endpoint: GET /automations/{id}/backfills.json
   */
  async getBackfillStatus(automationId: string): Promise<BackfillStatusResponse> {
    return this.adminRequest<BackfillStatusResponse>(
      'GET',
      `automations/${automationId}/backfills.json`
    );
  }

  /**
   * Start a backfill for an automation
   * Endpoint: POST /automations/{id}/backfills.json
   */
  async startBackfill(
    automationId: string,
    request: BackfillStartRequest
  ): Promise<BackfillStartResponse> {
    return this.adminRequest<BackfillStartResponse>(
      'POST',
      `automations/${automationId}/backfills.json`,
      request as Record<string, unknown>
    );
  }

  /**
   * Update automation settings (enable/disable, name, etc)
   * Endpoint: POST /automations/{id}/settings.json
   */
  async updateAutomationSettings(
    automationId: string,
    settings: AutomationSettingsRequest
  ): Promise<AutomationSettingsResponse> {
    return this.adminRequest<AutomationSettingsResponse>(
      'POST',
      `automations/${automationId}/settings.json`,
      settings as Record<string, unknown>
    );
  }

  // =========================================================================
  // Test Operations
  // =========================================================================

  /**
   * List available test payloads for a trigger
   * GET /triggers/{type}/{triggerId}/tests.json
   */
  async getTestPayloads(
    triggerType: 'input' | 'output',
    triggerId: string,
    search?: string
  ): Promise<TestPayloadsResponse> {
    return this.adminRequest<TestPayloadsResponse>(
      'GET',
      `triggers/${triggerType}/${triggerId}/tests.json`,
      undefined,
      search ? { search } : undefined
    );
  }

  /**
   * Get a specific test payload
   * GET /triggers/{type}/{triggerId}/test/{payloadId}.json
   */
  async getTestPayload(
    triggerType: 'input' | 'output',
    triggerId: string,
    payloadId: string,
    idType: 'connector' | 'task'
  ): Promise<TestPayloadResponse> {
    return this.adminRequest<TestPayloadResponse>(
      'GET',
      `triggers/${triggerType}/${triggerId}/test/${payloadId}.json`,
      undefined,
      { id_type: idType }
    );
  }

  /**
   * List saved test records for a trigger
   * GET /triggers/{type}/{triggerId}/test-records.json
   */
  async getTestRecords(
    triggerType: 'input' | 'output',
    triggerId: string
  ): Promise<TestRecordsResponse> {
    return this.adminRequest<TestRecordsResponse>(
      'GET',
      `triggers/${triggerType}/${triggerId}/test-records.json`
    );
  }

  /**
   * Get a specific saved test record with payload
   * GET /triggers/{type}/{triggerId}/test-records/{testRecordId}.json
   */
  async getTestRecord(
    triggerType: 'input' | 'output',
    triggerId: string,
    testRecordId: string
  ): Promise<TestRecord> {
    return this.adminRequest<TestRecord>(
      'GET',
      `triggers/${triggerType}/${triggerId}/test-records/${testRecordId}.json`
    );
  }

  /**
   * Execute a workflow test (full workflow from input trigger)
   * POST /triggers/{type}/{triggerId}/test.json
   */
  async executeWorkflowTest(
    triggerType: 'input' | 'output',
    triggerId: string,
    options: {
      payload: unknown;
      testRecordId?: string;
      record?: { name?: string; id?: string; label?: string; date?: string };
    }
  ): Promise<WorkflowTestResponse> {
    return this.adminRequest<WorkflowTestResponse>(
      'POST',
      `triggers/${triggerType}/${triggerId}/test.json`,
      {
        payload: options.payload,
        test_record_id: options.testRecordId,
        record: options.record,
      }
    );
  }

  /**
   * Execute a single step test
   * POST /triggers/{type}/{triggerId}/test-step.json
   */
  async executeStepTest(
    triggerType: 'input' | 'output',
    triggerId: string,
    testRecordId: string,
    payload?: unknown
  ): Promise<StepTestResponse> {
    return this.adminRequest<StepTestResponse>(
      'POST',
      `triggers/${triggerType}/${triggerId}/test-step.json`,
      {
        test_record_id: testRecordId,
        payload,
      }
    );
  }

  /**
   * Get task details including payload
   * GET /queue/task/{taskId}.json
   * Note: The backend returns the task directly, so we wrap it in the expected format.
   */
  async getTaskDetails(taskId: string): Promise<TaskDetailsResponse> {
    // Backend returns task data directly (not wrapped in { task: ... })
    const response = await this.adminRequest<Record<string, unknown>>(
      'GET',
      `queue/task/${taskId}.json`
    );

    // Wrap in expected format if necessary
    if ('task' in response) {
      return response as unknown as TaskDetailsResponse;
    }

    // Extract relevant fields and wrap
    return {
      task: {
        _id: response._id as string,
        status: response.status as TaskDetailsResponse['task']['status'],
        trigger_name: response.trigger_name as string | undefined,
        trigger_key: response.trigger_key as string | undefined,
        created_at: response.created_at as string | undefined,
        updated_at: response.updated_at as string | undefined,
        duration: response.execution_time as number | undefined,
        error: response.message as string | undefined,
      },
      payload: response.payload,
      request: response.request,
      response: response.response,
    };
  }

  /**
   * Get run details with all tasks
   * GET /queue/run/{runId}.json
   */
  async getRunDetails(
    runId: string,
    options?: { page?: number }
  ): Promise<RunDetailsResponse> {
    return this.adminRequest<RunDetailsResponse>(
      'GET',
      `queue/run/${runId}.json`,
      undefined,
      options as Record<string, string | number | undefined>
    );
  }
}

// =============================================================================
// Unauthenticated Client for Auth Flow
// =============================================================================

/**
 * Client for authentication endpoints (doesn't require existing credentials)
 */
export class AuthClient {
  private readonly baseUrl: string;
  private readonly verbose: boolean;

  constructor(baseUrl: string, verbose = false) {
    this.baseUrl = baseUrl;
    this.verbose = verbose;
  }

  /**
   * Start device authorization flow
   * Endpoint: POST /api/cli/auth/device.json
   */
  async startDeviceAuth(): Promise<DeviceAuthStartResponse> {
    const url = `${this.baseUrl}/api/cli/auth/device.json`;

    if (this.verbose) {
      console.log(`[AUTH] POST ${url}`);
    }

    try {
      const response = await axios.post<DeviceAuthStartResponse>(url);
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const statusCode = error.response?.status ?? 500;
        const responseData: unknown = error.response?.data;

        let apiError: ApiErrorResponse;
        if (isApiError(responseData)) {
          apiError = responseData;
        } else {
          apiError = {
            error: error.message,
            status: statusCode,
          };
        }

        throw new ApiError(
          apiError.error ?? apiError.message ?? 'Auth request failed',
          statusCode,
          apiError
        );
      }
      throw error;
    }
  }

  /**
   * Check device authorization status
   * Endpoint: GET /api/cli/auth/status.json?device_code=XXX
   */
  async checkDeviceAuthStatus(deviceCode: string): Promise<DeviceAuthStatusResponse> {
    const url = `${this.baseUrl}/api/cli/auth/status.json`;

    if (this.verbose) {
      console.log(`[AUTH] GET ${url}`);
    }

    try {
      const response = await axios.get<DeviceAuthStatusResponse>(url, {
        params: { device_code: deviceCode },
      });
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const statusCode = error.response?.status ?? 500;
        const responseData: unknown = error.response?.data;

        let apiError: ApiErrorResponse;
        if (isApiError(responseData)) {
          apiError = responseData;
        } else {
          apiError = {
            error: error.message,
            status: statusCode,
          };
        }

        throw new ApiError(
          apiError.error ?? apiError.message ?? 'Status check failed',
          statusCode,
          apiError
        );
      }
      throw error;
    }
  }
}

/**
 * Get the appropriate base URL for auth based on environment
 */
export function getAuthBaseUrl(isDev: boolean): string {
  return isDev
    ? 'https://dev-mesa.theshoppad.com'
    : 'https://app.theshoppad.com';
}
