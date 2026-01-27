/**
 * Workflow command
 *
 * Parent command for workflow-related operations.
 * Subcommands:
 * - create: Create a new workflow interactively or from JSON
 */

import { Command } from 'commander';
import { registerCreateCommand } from './create.js';

/**
 * Register the workflow command and all subcommands
 */
export function registerWorkflowCommand(program: Command): Command {
  const workflowCommand = program
    .command('workflow')
    .description('Workflow management commands');

  // Register subcommands
  registerCreateCommand(workflowCommand);

  return workflowCommand;
}
