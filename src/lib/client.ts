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
