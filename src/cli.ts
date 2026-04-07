#!/usr/bin/env node

/**
 * MESA CLI - Command-line interface for MESA automation development
 *
 * Commands:
 * - push: Upload scripts and mesa.json to MESA
 * - pull: Download scripts from MESA
 * - watch: Watch for file changes and auto-upload
 * - export: Export an automation with all scripts
 * - install: Install a template
 * - test: Test an automation
 * - replay: Replay a task
 * - logs: View recent logs
 * - auth: Authentication commands (login, logout, status)
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, watch as fsWatch } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { search } from '@inquirer/prompts';
import type { GlobalOptions, MesaConfig } from './types/index.js';
import { loadConfig, ConfigError, saveCredentials, hasCredentials, clearCredentials, getCredentialsPath } from './lib/config.js';
import { MesaClient, ApiError, AuthClient, getAuthBaseUrl } from './lib/client.js';
import {
  getAutomationKey,
  readMesaJsonWithReadme,
  isMesaJsonFile,
  isScriptFile,
  discoverReferencedScripts,
  buildAutomationUrl,
  AutomationError,
} from './lib/automation.js';
import { isObject } from './types/index.js';
import { registerWorkflowCommand } from './commands/workflow/index.js';
import { registerCacheCommand } from './commands/cache.js';

// =============================================================================
// CLI Setup
// =============================================================================

const program = new Command();

program
  .name('mesa')
  .description('Command-line interface for MESA automation development')
  .version('3.0.0')
  .option('-e, --env <value>', 'Environment to use (filename in ./config/)')
  .option('-a, --automation <value>', 'Automation key')
  .option('-f, --force', 'Force overwrite')
  .option('-v, --verbose', 'Verbose output')
  .option('-n, --number <value>', 'Number of items (for logs)')
  .option('-p, --payload <value>', 'JSON payload');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get global options from command
 */
function getGlobalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    env: typeof opts.env === 'string' ? opts.env : undefined,
    automation: typeof opts.automation === 'string' ? opts.automation : undefined,
    force: Boolean(opts.force),
    verbose: Boolean(opts.verbose),
    number: typeof opts.number === 'string' ? opts.number : undefined,
    payload: typeof opts.payload === 'string' ? opts.payload : undefined,
  };
}

/**
 * Get working directory
 */
function getCwd(): string {
  return process.cwd();
}

/**
 * Load config and create client, handling errors gracefully
 */
function getClientFromOptions(options: GlobalOptions): { config: MesaConfig; client: MesaClient } {
  const cwd = getCwd();
  const loaded = loadConfig(cwd, options.env);

  console.log(`Loaded config from: ${loaded.source === 'local' ? 'Local' : 'Global'} (${loaded.path})`);
  console.log(`Working directory: ${cwd}`);
  console.log(`Store UUID: ${loaded.config.uuid}`);
  console.log('');

  const client = new MesaClient({
    config: loaded.config,
    verbose: options.verbose,
  });

  return { config: loaded.config, client };
}

/**
 * Create directories recursively for a file path
 */
function ensureDirectoryExists(filepath: string): void {
  const dir = dirname(filepath);
  if (dir && !existsSync(dir)) {
    console.log(`Creating directory: ${dir}`);
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Format a date for log output
 */
function formatLogDate(timestamp: string | number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString('en-US')} ${date.toLocaleTimeString('en-US')}`;
}

/**
 * Sleep for ms milliseconds (using proper async, not busy wait)
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Push Command
// =============================================================================

async function uploadFile(
  client: MesaClient,
  filepath: string,
  automationKey: string,
  force: boolean
): Promise<boolean> {
  if (!existsSync(filepath) || !lstatSync(filepath).isFile()) {
    console.log(`Skipping (not a file): ${filepath}`);
    return false;
  }

  const filename = basename(filepath);

  if (isScriptFile(filename)) {
    const code = readFileSync(filepath, 'utf-8');
    console.log(`Uploading ${filename} to automation ${automationKey}...`);

    await client.uploadScript(automationKey, filename, code);
    console.log(`Success: Uploaded ${filename}`);
    return true;
  }

  if (isMesaJsonFile(filename)) {
    const mesa = readMesaJsonWithReadme(filepath);
    if (!mesa) {
      console.log(`Error: Could not parse ${filename}`);
      return false;
    }

    if (!mesa.config) {
      console.log(`Warning: ${filename} has no config section, skipping.`);
      return false;
    }

    console.log(`Importing configuration from ${filename}...`);
    const response = await client.importAutomation(mesa, force);

    if (response.log) {
      console.log(`Import log for ${mesa.key ?? 'unknown'}:`);
      console.log(response.log);
    } else {
      console.log('Import completed (no log returned)');
    }

    return true;
  }

  console.log(`Skipping ${filename} (not .js or mesa.json)`);
  return false;
}

program
  .command('push [files...]')
  .description('Upload scripts and mesa.json to MESA')
  .action(async (files: string[], _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);
    const cwd = getCwd();

    try {
      const { client } = getClientFromOptions(options);

      // Default to mesa.json if no files specified
      const targetFiles = files.length > 0 ? files : ['mesa.json'];
      const resolvedFiles = targetFiles.map((f) => resolve(cwd, f));

      // Check if mesa.json is being pushed - if so, handle it specially
      // (upload other scripts first, then mesa.json twice to ensure scripts are set)
      const mesaJsonFile = resolvedFiles.find((f) => isMesaJsonFile(basename(f)));
      const scriptFiles = resolvedFiles.filter((f) => !isMesaJsonFile(basename(f)));

      // Always force push for now (legacy behavior)
      const force = true;

      if (mesaJsonFile) {
        // Get automation key from mesa.json or option
        const automationKey = getAutomationKey(options.automation, mesaJsonFile, cwd);

        // Auto-discover script files referenced from mesa.json's
        // metadata.script fields so `mesa push mesa.json` syncs script edits
        // without requiring the user to list each .js file explicitly.
        const discovered = discoverReferencedScripts(mesaJsonFile);
        for (const f of discovered) {
          if (!scriptFiles.includes(f)) scriptFiles.push(f);
        }

        // First upload mesa.json to create/update the automation
        await uploadFile(client, mesaJsonFile, automationKey, force);

        // Then upload all script files
        for (const file of scriptFiles) {
          await uploadFile(client, file, automationKey, force);
          await sleep(500); // Rate limit protection
        }

        // Re-upload mesa.json after scripts to ensure script references are correct
        if (scriptFiles.length > 0) {
          console.log('Waiting 5 seconds before final mesa.json update...');
          await sleep(5000);
          console.log('Re-uploading mesa.json to finalize script references...');
          await uploadFile(client, mesaJsonFile, automationKey, force);
        }
      } else {
        // Just upload the script files
        for (const file of scriptFiles) {
          const automationKey = getAutomationKey(options.automation, file, cwd);
          await uploadFile(client, file, automationKey, force);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Pull Command
// =============================================================================

program
  .command('pull [files...]')
  .description('Download scripts from MESA')
  .action(async (files: string[], _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);
    const cwd = getCwd();

    try {
      const { client } = getClientFromOptions(options);

      // Get automation key
      const automationKey = getAutomationKey(
        options.automation,
        files[0] ? resolve(cwd, files[0]) : undefined,
        cwd
      );

      console.log(`Downloading scripts from automation: ${automationKey}`);

      const response = await client.getScripts(automationKey);

      for (const script of response.scripts) {
        // Filter by requested files if specified, otherwise download all
        if (files.length === 0 || files.includes(script.filename) || files.includes('all')) {
          ensureDirectoryExists(script.filename);
          console.log(`Saving ${script.filename}`);
          writeFileSync(script.filename, script.code);
        }
      }

      console.log('Pull complete.');
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Watch Command
// =============================================================================

program
  .command('watch')
  .description('Watch for file changes and auto-upload')
  .action(async (_opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);
    const cwd = getCwd();

    try {
      const { client } = getClientFromOptions(options);

      console.log(`Watching for changes in ${cwd}...`);
      console.log('Press Ctrl+C to stop.\n');

      // Use fs.watch with recursive option
      fsWatch(cwd, { recursive: true }, async (_eventType, filename) => {
        if (!filename) return;

        // Skip node_modules and .git
        if (filename.includes('node_modules') || filename.includes('.git')) {
          return;
        }

        // Only process .js files
        if (!isScriptFile(filename)) {
          return;
        }

        const filepath = resolve(cwd, filename);

        // Check file exists and is a file
        if (!existsSync(filepath) || !lstatSync(filepath).isFile()) {
          return;
        }

        console.log(`\n[${new Date().toLocaleTimeString()}] File changed: ${filename}`);

        try {
          const automationKey = getAutomationKey(options.automation, filepath, cwd);
          await uploadFile(client, filepath, automationKey, true);
        } catch (err) {
          if (err instanceof Error) {
            console.error(`Error uploading ${filename}: ${err.message}`);
          }
        }
      });

      // Keep the process running
      await new Promise(() => {
        // This promise never resolves, keeping watch alive
      });
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Export Command
// =============================================================================

program
  .command('export <automation>')
  .description('Export an automation with all scripts')
  .action(async (automation: string, _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);

    try {
      const { client } = getClientFromOptions(options);

      console.log(`Exporting automation: ${automation}`);

      // Get the automation configuration
      const automationData = await client.getAutomation(automation);

      // Save mesa.json
      const mesaJson = JSON.stringify(automationData, null, 2);
      console.log('Writing configuration to mesa.json');
      writeFileSync('mesa.json', mesaJson);

      // Download all scripts
      const scripts = await client.getScripts(automation);
      for (const script of scripts.scripts) {
        ensureDirectoryExists(script.filename);
        console.log(`Saving ${script.filename}`);
        writeFileSync(script.filename, script.code);
      }

      console.log('Export complete.');
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Install Command
// =============================================================================

program
  .command('install <template>')
  .description('Install a template')
  .action(async (template: string, _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);

    try {
      const { config, client } = getClientFromOptions(options);

      console.log(`Installing template: ${template}`);

      const response = await client.installTemplate(template, options.force ?? false);

      console.log(`Installed ${template}. Log:`);
      console.log(response.log);

      // Show automation URL — collections set _id to the literal 'collection'
      // and don't have a single automation to link to, so skip those.
      const automationId = response.automation?._id;
      if (automationId && automationId !== 'collection') {
        const automationUrl = buildAutomationUrl(config.api_url, config.uuid, automationId);
        console.log('');
        console.log(`View workflow: ${automationUrl}`);
      }
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Test Command
// =============================================================================

program
  .command('test <automation> [trigger]')
  .description('Test an automation (optionally specify trigger key)')
  .action(async (automation: string, trigger: string | undefined, _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);

    try {
      const { config, client } = getClientFromOptions(options);

      console.log(`Testing automation: ${automation}${trigger ? ` (trigger: ${trigger})` : ''}`);

      const response = await client.testAutomation(automation, trigger, options.payload);

      if (response.task?.id) {
        console.log('Test successfully enqueued:');
        console.log(
          `https://${config.uuid}.myshopify.com/admin/apps/mesa/apps/mesa/admin/shopify/queue/task/${response.task.id}`
        );
      } else {
        console.log('Test response:', response);
      }
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Replay Command
// =============================================================================

program
  .command('replay <taskId>')
  .description('Replay a task')
  .action(async (taskId: string, _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);

    try {
      const { client } = getClientFromOptions(options);

      console.log(`Replaying task: ${taskId}`);

      await client.replayTask(taskId);

      console.log('Task replayed successfully.');
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Logs Command
// =============================================================================

/**
 * Get last run time for each automation from logs
 */
async function getAutomationLastRuns(
  client: MesaClient
): Promise<Map<string, Date>> {
  const lastRuns = new Map<string, Date>();

  try {
    // Fetch recent logs to determine last run times
    const response = await client.getLogs({ limit: '100' });

    for (const log of response.logs) {
      const automationId = log.task?.automation?._id;
      if (automationId && !lastRuns.has(automationId)) {
        const timestamp = log['@timestamp'];
        const date = typeof timestamp === 'number'
          ? new Date(timestamp)
          : new Date(timestamp);
        lastRuns.set(automationId, date);
      }
    }
  } catch {
    // Ignore errors - we'll just show "Never" for last run
  }

  return lastRuns;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffMins > 0) {
    return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

/**
 * Interactive automation selector for logs
 */
async function selectAutomation(
  client: MesaClient
): Promise<string | null> {
  console.log('Fetching automations...');

  // Fetch automations and last run times in parallel
  const [automationsResponse, lastRuns] = await Promise.all([
    client.listAutomations(),
    getAutomationLastRuns(client),
  ]);

  const automations = automationsResponse.automations;

  if (automations.length === 0) {
    console.log('No automations found.');
    return null;
  }

  // Build choices with last run info
  interface AutomationChoice {
    id: string;
    name: string;
    lastRun: string;
    enabled: boolean;
  }

  const choices: AutomationChoice[] = automations.map((auto) => {
    const lastRunDate = lastRuns.get(auto._id);
    const lastRunStr = lastRunDate ? formatRelativeTime(lastRunDate) : 'Never';

    return {
      id: auto._id,
      name: auto.name,
      lastRun: lastRunStr,
      enabled: auto.enabled,
    };
  });

  // Sort by last run (most recent first), then by name
  choices.sort((a, b) => {
    if (a.lastRun === 'Never' && b.lastRun !== 'Never') return 1;
    if (a.lastRun !== 'Never' && b.lastRun === 'Never') return -1;
    return a.name.localeCompare(b.name);
  });

  // Use search prompt for filtering
  const selected = await search<string>({
    message: 'Select an automation (type to filter):',
    source: async (input) => {
      const term = (input ?? '').toLowerCase();

      // Always include "All automations" option at the top
      const results: Array<{ name: string; value: string; description?: string }> = [
        {
          name: '📋 All automations',
          value: '__all__',
          description: 'Show logs from all automations',
        },
      ];

      // Filter and add automation choices
      const filtered = choices.filter(
        (c) => c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term)
      );

      for (const choice of filtered) {
        const status = choice.enabled ? '🟢' : '⚪';
        results.push({
          name: `${status} ${choice.name}`,
          value: choice.id,
          description: `Last run: ${choice.lastRun} | ID: ${choice.id}`,
        });
      }

      return results;
    },
  });

  return selected === '__all__' ? null : selected;
}

/**
 * Display logs
 */
function displayLogs(
  logs: Array<{
    '@timestamp': string | number;
    message: string;
    trigger?: { name: string; _id: string };
    fields?: { meta?: string };
  }>,
  verbose: boolean
): void {
  for (const entry of logs) {
    const dateStr = formatLogDate(entry['@timestamp']);
    const triggerName = entry.trigger?.name ?? 'unknown';
    const triggerId = entry.trigger?._id ?? '';
    console.log(`[${dateStr}] [${triggerName}] [${triggerId}] ${entry.message}`);

    // Print metadata if verbose
    if (verbose && entry.fields?.meta) {
      try {
        const meta: unknown = JSON.parse(entry.fields.meta);
        console.log(JSON.stringify(meta, null, 2));
      } catch {
        console.log(entry.fields.meta);
      }
    }
  }
}

program
  .command('logs [automation]')
  .description('View recent logs (interactive selection if no automation specified)')
  .action(async (automation: string | undefined, _opts: unknown, cmd: Command) => {
    const options = getGlobalOptions(cmd);

    try {
      const { client } = getClientFromOptions(options);

      let selectedAutomation = automation;

      // If no automation provided, show interactive selection
      if (!selectedAutomation) {
        selectedAutomation = await selectAutomation(client) ?? undefined;
      }

      const params: Record<string, string> = {};

      // Filter by automation if selected (not "all")
      if (selectedAutomation) {
        params.automation_id = selectedAutomation;
        console.log(`\nShowing logs for automation: ${selectedAutomation}\n`);
      } else {
        console.log('\nShowing logs for all automations\n');
      }

      // Parse payload as additional params if provided
      if (options.payload) {
        try {
          const payloadObj: unknown = JSON.parse(options.payload);
          if (isObject(payloadObj)) {
            for (const [key, value] of Object.entries(payloadObj)) {
              if (typeof value === 'string' || typeof value === 'number') {
                params[key] = String(value);
              }
            }
          }
        } catch {
          console.warn('Warning: Could not parse payload as JSON');
        }
      }

      if (options.number) {
        params.limit = options.number;
      }

      const response = await client.getLogs(params);

      // Optionally truncate if number specified
      let logs = response.logs;
      if (options.number) {
        const limit = parseInt(options.number, 10);
        logs = logs.slice(Math.max(logs.length - limit, 0));
      }

      if (logs.length === 0) {
        console.log('No logs found.');
      } else {
        displayLogs(logs, options.verbose ?? false);
      }
    } catch (error) {
      handleError(error);
    }
  });

// =============================================================================
// Auth Commands
// =============================================================================

const authCommand = program
  .command('auth')
  .description('Authentication commands');

authCommand
  .command('login')
  .description('Authenticate with MESA')
  .option('--dev', 'Use development environment')
  .action(async (opts: { dev?: boolean }, cmd: Command) => {
    const options = getGlobalOptions(cmd);
    const isDev = Boolean(opts.dev);

    try {
      const baseUrl = getAuthBaseUrl(isDev);
      const authClient = new AuthClient(baseUrl, options.verbose);

      console.log(`Authenticating with MESA (${isDev ? 'dev' : 'prod'})...`);
      console.log('');

      // Start device auth flow
      const deviceAuth = await authClient.startDeviceAuth();

      console.log('To authenticate, visit:');
      console.log(`  ${deviceAuth.verification_url}`);
      console.log('');
      console.log(`Enter this code when prompted: ${deviceAuth.user_code}`);
      console.log('');
      console.log(`Code expires in ${Math.floor(deviceAuth.expires_in / 60)} minutes.`);
      console.log('');

      // Try to open browser
      try {
        const open = await import('open');
        await open.default(deviceAuth.verification_url);
        console.log('Browser opened. Complete authentication there.');
      } catch {
        console.log('Could not open browser automatically. Please visit the URL above.');
      }

      console.log('');
      console.log('Waiting for authorization...');

      // Poll for completion
      const pollInterval = deviceAuth.interval * 1000;
      const maxAttempts = Math.ceil(deviceAuth.expires_in / deviceAuth.interval);
      let attempts = 0;

      while (attempts < maxAttempts) {
        await sleep(pollInterval);
        attempts++;

        try {
          const status = await authClient.checkDeviceAuthStatus(deviceAuth.device_code);

          if (status.status === 'approved' && status.uuid && status.api_key) {
            console.log('');
            console.log('Authorization successful!');
            console.log('');

            // Save credentials
            // For dev, use the base URL + /api/admin path (routes are under /api mount)
            const apiUrl = isDev ? `${baseUrl}/api/admin` : undefined;
            const credentialsPath = saveCredentials(
              {
                uuid: status.uuid,
                key: status.api_key,
                authenticated_at: new Date().toISOString(),
              },
              apiUrl
            );

            console.log(`Credentials saved to: ${credentialsPath}`);
            console.log(`Store UUID: ${status.uuid}`);
            console.log('');
            console.log('You can now use mesa commands to manage your automations.');
            return;
          }

          if (status.status === 'denied') {
            console.log('');
            console.log('Authorization denied:', status.error ?? 'Unknown error');
            process.exit(1);
          }

          if (status.status === 'expired') {
            console.log('');
            console.log('Authorization code expired. Please try again.');
            process.exit(1);
          }

          // Still pending, continue polling
          process.stdout.write('.');
        } catch (err) {
          // Ignore polling errors (e.g., network issues) and continue
          if (options.verbose && err instanceof Error) {
            console.warn(`\nPolling error: ${err.message}`);
          }
        }
      }

      console.log('');
      console.log('Authorization timed out. Please try again.');
      process.exit(1);
    } catch (error) {
      handleError(error);
    }
  });

authCommand
  .command('logout')
  .description('Clear stored credentials')
  .action(async () => {
    if (clearCredentials()) {
      console.log('Credentials cleared.');
      console.log(`Config file: ${getCredentialsPath()}`);
    } else {
      console.log('No credentials found to clear.');
    }
  });

authCommand
  .command('status')
  .description('Show current authentication status')
  .action(async () => {
    const credentialsPath = getCredentialsPath();

    if (hasCredentials()) {
      try {
        const loaded = loadConfig(getCwd());
        console.log('Authenticated');
        console.log(`Store UUID: ${loaded.config.uuid}`);
        console.log(`Config: ${loaded.path}`);
      } catch {
        console.log('Credentials exist but may be invalid.');
        console.log(`Config: ${credentialsPath}`);
      }
    } else {
      console.log('Not authenticated');
      console.log('Run `mesa auth login` to authenticate.');
    }
  });

// =============================================================================
// Workflow Commands
// =============================================================================

registerWorkflowCommand(program);

// =============================================================================
// Cache Commands
// =============================================================================

registerCacheCommand(program);

// =============================================================================
// Error Handling
// =============================================================================

function handleError(error: unknown): never {
  if (error instanceof ConfigError) {
    console.error('Configuration error:', error.message);
    process.exit(1);
  }

  if (error instanceof AutomationError) {
    console.error('Automation error:', error.message);
    process.exit(1);
  }

  if (error instanceof ApiError) {
    console.error(`API error (${error.statusCode}):`, error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.error('Unknown error:', error);
  process.exit(1);
}

// =============================================================================
// Main
// =============================================================================

program.parse();
