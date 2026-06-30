/**
 * Workflow command
 *
 * Parent command for workflow-related operations.
 * Subcommands:
 * - create: Create a new workflow interactively or from JSON
 * - list: List all workflows
 * - activity: Show recent activity for a workflow
 * - time-travel: Check status or start a backfill
 * - enable: Enable a workflow
 * - disable: Disable a workflow
 * - test: Run a test execution for a workflow
 * - test-payload: Invoke a workflow input's testPayload hook and print the result
 * - step test: Run a test execution for a single step
 * - debug enable/disable/status: Manage debug logging
 */

import { Command } from 'commander';
import { registerCreateCommand } from './create.js';
import { registerListCommand } from './list.js';
import { registerActivityCommand } from './activity.js';
import { registerTimeTravelCommand } from './time-travel.js';
import { registerEnableCommand } from './enable.js';
import { registerDisableCommand } from './disable.js';
import { registerTestCommand } from './test.js';
import { registerTestPayloadCommand } from './test-payload.js';
import { registerRetrieveFieldsCommand } from './retrieve-fields.js';
import { registerStepTestCommand } from './step-test.js';
import { registerDebugCommand } from './debug.js';

/**
 * Register the workflow command and all subcommands
 */
export function registerWorkflowCommand(program: Command): Command {
  const workflowCommand = program
    .command('workflow')
    .description('Workflow management commands');

  // Register subcommands
  registerCreateCommand(workflowCommand);
  registerListCommand(workflowCommand);
  registerActivityCommand(workflowCommand);
  registerTimeTravelCommand(workflowCommand);
  registerEnableCommand(workflowCommand);
  registerDisableCommand(workflowCommand);
  registerTestCommand(workflowCommand);
  registerTestPayloadCommand(workflowCommand);
  registerRetrieveFieldsCommand(workflowCommand);
  registerStepTestCommand(workflowCommand);
  registerDebugCommand(workflowCommand);

  return workflowCommand;
}
