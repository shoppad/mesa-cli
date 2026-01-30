/**
 * Test execution and polling logic
 *
 * Handles polling for test completion and displaying progress.
 * Tests in MESA are async (queued via SQS), so we need to poll
 * the backend for status updates.
 */

import ora, { type Ora } from 'ora';
import type { MesaClient } from './client.js';
import type { TestResult, StepResult, LogEntry } from '../types/index.js';

export interface TestRunnerOptions {
  /** MESA API client */
  client: MesaClient;
  /** Initial task ID from test response */
  taskId: string;
  /** Run ID for full workflow tests (to track all steps) */
  runId?: string;
  /** Timeout in milliseconds (default: 300000ms / 5 minutes) */
  timeout?: number;
  /** Polling interval in milliseconds (default: 2000ms) */
  pollInterval?: number;
  /** JSON output mode (disables spinner) */
  json?: boolean;
}

/**
 * Poll for test completion and return results
 *
 * For workflow tests (with runId): polls the run endpoint to track all tasks.
 * For step tests (no runId): polls the single task endpoint.
 *
 * @param options - Runner options
 * @returns Test execution result
 */
export async function pollTestCompletion(
  options: TestRunnerOptions
): Promise<TestResult> {
  const {
    client,
    taskId,
    runId,
    timeout = 300000,
    pollInterval = 2000,
    json = false,
  } = options;

  const startTime = Date.now();
  let spinner: Ora | null = null;

  if (!json) {
    spinner = ora('Running test...').start();
  }

  const steps: StepResult[] = [];
  let lastStatus = '';

  try {
    while (Date.now() - startTime < timeout) {
      try {
        if (runId) {
          // Full workflow test - poll the run for all tasks
          const runDetails = await client.getRunDetails(runId);

          // Update steps from run tasks
          steps.length = 0;
          for (const task of runDetails.tasks) {
            // Error can be in 'error', 'message', or response.message
            const errorMessage = task.error || task.message || task.response?.message;
            steps.push({
              stepKey: task.trigger_key || 'unknown',
              name: task.trigger_name || 'Unknown Step',
              status: mapStatus(task.status),
              duration: task.duration,
              taskId: task._id,
              error: errorMessage,
              details: task.details,
            });
          }

          // Check if run is complete (normalize status to lowercase for comparison)
          const runStatus = runDetails.run.status.toLowerCase();
          if (['success', 'fail', 'pause'].includes(runStatus)) {
            const success = runStatus === 'success';
            if (spinner) {
              if (success) {
                spinner.succeed('Test completed successfully');
              } else {
                spinner.fail(`Test ${runStatus}`);
              }
            }

            // Fetch logs for failed tasks to provide debugging context
            let logs: LogEntry[] | undefined;
            if (!success && !json) {
              logs = await fetchLogsForFailedTasks(client, steps);
            }

            return {
              success,
              executionId: taskId,
              runId,
              duration: Date.now() - startTime,
              steps,
              error: runStatus === 'fail' ? 'One or more steps failed' : undefined,
              logs,
            };
          }

          // Update spinner with current step
          const running = steps.find((s) => s.status === 'running');
          if (running && spinner) {
            spinner.text = `Running: ${running.name}...`;
          }
        } else {
          // Single step test - poll the task directly
          const taskDetails = await client.getTaskDetails(taskId);
          const task = taskDetails.task;

          if (task.status !== lastStatus) {
            lastStatus = task.status;
            if (spinner) {
              spinner.text = `Step status: ${task.status}`;
            }
          }

          if (['success', 'fail', 'skip', 'pause'].includes(task.status)) {
            const success = task.status === 'success';
            if (spinner) {
              if (success) {
                spinner.succeed(`Step ${task.status}`);
              } else {
                spinner.fail(`Step ${task.status}`);
              }
            }
            return {
              success,
              executionId: taskId,
              duration: task.duration || Date.now() - startTime,
              steps: [{
                stepKey: task.trigger_key || 'unknown',
                name: task.trigger_name || 'Unknown Step',
                status: mapStatus(task.status),
                duration: task.duration,
                taskId: task._id,
                error: task.error,
              }],
              error: task.error,
            };
          }
        }

        await sleep(pollInterval);
      } catch {
        // Continue polling on transient errors (network issues, etc.)
        await sleep(pollInterval);
      }
    }

    // Timeout reached
    if (spinner) {
      spinner.fail('Test timed out');
    }

    return {
      success: false,
      executionId: taskId,
      runId,
      duration: Date.now() - startTime,
      steps,
      error: `Test timed out after ${timeout / 1000} seconds`,
    };
  } finally {
    // Ensure spinner is stopped even on error
    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }
  }
}

/**
 * Map backend status to StepResult status
 * Backend may return capitalized status (e.g., "Fail" instead of "fail")
 */
function mapStatus(status: string): StepResult['status'] {
  switch (status.toLowerCase()) {
    case 'success':
      return 'success';
    case 'fail':
      return 'fail';
    case 'skip':
      return 'skip';
    case 'running':
      return 'running';
    default:
      return 'pending';
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch recent logs for failed tasks
 * Searches for logs by task ID to provide debugging context
 */
async function fetchLogsForFailedTasks(
  client: MesaClient,
  steps: StepResult[],
  limit = 10
): Promise<LogEntry[]> {
  const failedSteps = steps.filter((s) => s.status === 'fail' && s.taskId);
  if (failedSteps.length === 0) {
    return [];
  }

  const allLogs: LogEntry[] = [];

  for (const step of failedSteps) {
    try {
      // Search for logs by task ID
      const response = await client.getLogs({
        search: step.taskId!,
        limit: String(limit),
      });

      if (response.logs && response.logs.length > 0) {
        allLogs.push(...response.logs);
      }
    } catch {
      // Ignore errors fetching logs - they're optional debugging info
    }
  }

  // Sort logs by timestamp (newest last for chronological display)
  allLogs.sort((a, b) => {
    const timeA = typeof a['@timestamp'] === 'string' ? new Date(a['@timestamp']).getTime() : a['@timestamp'];
    const timeB = typeof b['@timestamp'] === 'string' ? new Date(b['@timestamp']).getTime() : b['@timestamp'];
    return timeA - timeB;
  });

  return allLogs;
}
