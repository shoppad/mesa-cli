# mesa-cli

Command-line interface to download, watch and publish [Mesa Automations](https://getmesa.com/).

## Installation

### From npm (recommended)

```bash
npm install -g mesa-cli
```

### From source

```bash
git clone https://github.com/shoppad/mesa-cli.git
cd mesa-cli
npm install
npm run build
npm link  # Makes `mesa` available globally
```

## Quick Start

### 1. Authenticate

```bash
mesa auth login
```

This opens your browser to authorize the CLI with your MESA account. Once approved, credentials are stored in `~/.mesa/config.yml`.

For development environments:

```bash
mesa auth login --dev
```

### 2. Navigate to your automation

```bash
cd /path/to/your/automation
```

Your directory should contain a `mesa.json` file with the automation configuration.

### 3. Use CLI commands

```bash
# Download scripts from MESA
mesa pull

# Upload changes to MESA
mesa push *.js mesa.json

# Watch for changes and auto-upload
mesa watch
```

## Configuration

The CLI looks for configuration in:

1. `./config/config.yml` (local, environment-specific)
2. `./config.yml` (local)
3. `~/.mesa/config/config.yml` (global, environment-specific)
4. `~/.mesa/config.yml` (global)

### Config file format

```yaml
uuid: your-mesa-uuid-here
key: your-api-key-here
api_url: https://api.getmesa.com/v1/admin  # optional
```

### Environment-specific configs

Create files like `./config/development.yml` or `./config/production.yml`, then use:

```bash
mesa -e development push
# or
ENV=development mesa push
```

## Commands

### `mesa auth login [--dev]`

Authenticate with MESA using browser-based authorization.

- `--dev` - Use development environment (dev-mesa.theshoppad.com)

### `mesa auth logout`

Clear stored credentials.

### `mesa auth status`

Show current authentication status.

### `mesa push [files...]`

Upload scripts and configuration to MESA.

```bash
mesa push                    # Push mesa.json
mesa push *.js              # Push all .js files
mesa push script.js mesa.json  # Push specific files
```

### `mesa pull [files...]`

Download scripts from MESA.

```bash
mesa pull            # Download all scripts
mesa pull script.js  # Download specific file
mesa pull all        # Download all scripts
```

### `mesa watch`

Watch for file changes and automatically upload.

```bash
mesa watch
# Press Ctrl+C to stop
```

### `mesa export <automation>`

Export an automation with all its scripts.

```bash
mesa export my-automation-key
# Downloads mesa.json and all scripts
```

### `mesa install <template>`

Install a template from the MESA library.

```bash
mesa install shopify-to-slack
mesa install -f shopify-to-slack  # Force overwrite
```

### `mesa test <automation> [trigger]`

Test an automation.

```bash
mesa test my-automation
mesa test my-automation my-trigger
mesa test my-automation -p '{"key": "value"}'  # With payload
```

### `mesa replay <taskId>`

Replay a previously executed task.

```bash
mesa replay 507f1f77bcf86cd799439011
```

### `mesa workflow list`

List all workflows in your MESA account.

```bash
mesa workflow list                          # Table output
mesa workflow list --json                   # JSON output
mesa workflow list --search "order"         # Filter by name/key
mesa workflow list --limit 10 --page 2      # Pagination
mesa workflow list --sort updated_at --sort-dir desc  # Sort results
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--limit <n>` | Maximum results per page (default: 50) |
| `--page <n>` | Page number (1-based) |
| `--search <term>` | Filter by name or key |
| `--sort <field>` | Sort by: `name`, `updated_at`, `created_at` |
| `--sort-dir <dir>` | Sort direction: `asc`, `desc` |

### `mesa workflow enable`

Enable a workflow.

```bash
mesa workflow enable                        # Interactive picker
mesa workflow enable --workflow-id <id>     # Specific workflow by ID
mesa workflow enable --json                 # JSON output
```

### `mesa workflow disable`

Disable a workflow.

```bash
mesa workflow disable                       # Interactive picker
mesa workflow disable --workflow-id <id>    # Specific workflow
mesa workflow disable --workflow-id <id> --yes  # Skip confirmation (CI mode)
```

### `mesa workflow test`

Run a full workflow test execution.

```bash
mesa workflow test                          # Interactive: pick workflow & payload
mesa workflow test <workflowId>             # Test specific workflow
mesa workflow test --workflow-id <id>       # Alternative syntax
mesa workflow test <id> --payload ./data.json  # Custom payload from file
mesa workflow test <id> --default-payload   # Use empty payload (skip picker)
mesa workflow test <id> --non-interactive --json  # CI mode with JSON output
mesa workflow test <id> --timeout 60000     # Custom timeout (ms)
```

| Option | Description | Default |
|--------|-------------|---------|
| `--workflow-id <id>` | Workflow ID or key | - |
| `--payload <path>` | Path to JSON payload file | - |
| `--default-payload` | Use empty payload | false |
| `--json` | Output as JSON | false |
| `--non-interactive` | CI mode (no prompts) | false |
| `--timeout <ms>` | Test timeout | 300000 |

**Exit codes**: 0 = success, 1 = failure

### `mesa workflow step test`

Run a step test (currently executes the full workflow).

```bash
mesa workflow step test <workflowId>
mesa workflow step test <id> --payload ./data.json
mesa workflow step test <id> --non-interactive --json
```

Options are the same as `workflow test`.

### `mesa workflow activity`

View recent workflow executions (runs).

```bash
mesa workflow activity                      # Interactive picker
mesa workflow activity --workflow-id <id>   # Specific workflow
mesa workflow activity --status fail        # Filter by status
mesa workflow activity --badge test         # Filter by badge
mesa workflow activity --limit 10 --page 2  # Pagination
mesa workflow activity --json               # JSON output
```

| Option | Description |
|--------|-------------|
| `--workflow-id <id>` | Workflow ID |
| `--status <status>` | Filter: `ready`, `running`, `success`, `fail`, `pause`, `skip` |
| `--badge <badge>` | Filter: `test`, `replay`, `backfill`, `delayed` |
| `--limit <n>` | Results per page (default: 25) |
| `--page <n>` | Page number (1-based) |
| `--json` | Output as JSON |

### `mesa workflow debug enable|disable|status`

Manage debug logging for workflows.

```bash
mesa workflow debug enable <workflowId>     # Enable debug logging
mesa workflow debug disable <workflowId>    # Disable debug logging
mesa workflow debug status                  # Show all workflows with debug enabled
mesa workflow debug status <workflowId>     # Check specific workflow
mesa workflow debug status --json           # JSON output
```

**Note**: Debug logs require both `debug=true` AND `logging=true` on the workflow.

### `mesa workflow time-travel`

Check status or start a backfill (time-travel) to re-run a workflow against historical data.

```bash
mesa workflow time-travel                   # Interactive: check status
mesa workflow time-travel --workflow-id <id>  # Check status for specific workflow
mesa workflow time-travel --workflow-id <id> --from 2024-01-01 --to 2024-01-31  # Start backfill
mesa workflow time-travel --workflow-id <id> --from 2024-01-01 --limit 100  # Limit records
mesa workflow time-travel --workflow-id <id> --from 2024-01-01 --yes  # Skip confirmation
```

| Option | Description |
|--------|-------------|
| `--workflow-id <id>` | Workflow ID |
| `--from <date>` | Start date (YYYY-MM-DD) |
| `--to <date>` | End date (YYYY-MM-DD) |
| `--limit <n>` | Maximum records to process |
| `--yes` | Skip confirmation |
| `--json` | Output as JSON |

### `mesa workflow create`

Create a new workflow automation interactively or from JSON input.

#### Interactive mode (default)

```bash
mesa workflow create
```

Launches an interactive wizard that guides you through:
1. Naming your workflow
2. Selecting a trigger (e.g., "Shopify - Order Created")
3. Adding actions (e.g., "Slack - Send Message")
4. Configuring fields with optional token insertion from previous steps
5. Saving or pushing the workflow

#### Non-interactive mode

```bash
# From a JSON file
mesa workflow create --non-interactive --input workflow.json

# From stdin
echo '{"name":"My Workflow","steps":[...]}' | mesa workflow create --non-interactive

# Output options
mesa workflow create --non-interactive --input workflow.json --json     # Print JSON to stdout
mesa workflow create --non-interactive --input workflow.json --push     # Push directly to MESA
mesa workflow create --non-interactive --input workflow.json --output ./my-workflow.json
```

#### Non-interactive JSON format

```json
{
  "name": "Order to Email",
  "key": "order_to_email",
  "steps": [
    {
      "type": "trigger",
      "app": "shopify",
      "operation_id": "orders_create",
      "key": "shopify_order"
    },
    {
      "type": "action",
      "app": "email",
      "operation_id": "email",
      "key": "email_notification",
      "fields": {
        "to": "{{shopify_order.order.customer.email}}",
        "subject": "Order Confirmation",
        "message": "Thank you for your order {{shopify_order.order.name}}"
      }
    }
  ]
}
```

**Note:** Use `operation_id` to specify the trigger/action type. You can find available operation IDs by running the interactive wizard or checking the MESA UI.

#### Token syntax

Use `{{step_key.field.path}}` to reference outputs from previous steps:
- `{{shopify_order.order.id}}` - Order ID
- `{{shopify_order.order.customer.email}}` - Customer email
- `{{shopify_order.order.line_items.0.sku}}` - First line item SKU

### `mesa logs [automation]`

View recent logs with interactive automation selection.

```bash
mesa logs                           # Interactive: select automation from list
mesa logs <automation-id>           # Logs for specific automation ID
mesa logs <automation-id> -n 10     # Last 10 logs for automation
mesa logs -n 50                     # Last 50 logs (skips interactive selection)
mesa logs -v                        # Verbose (show metadata)
```

When run without arguments, shows an interactive searchable list of automations with:
- 🟢 Enabled / ⚪ Disabled status
- Last run time for each automation
- Type to filter by name
- Option to view all logs

### `mesa cache clear`

Clear the local cache (trigger definitions, app configs).

```bash
mesa cache clear
```

### `mesa cache status`

Show cache location and size.

```bash
mesa cache status
```

## Global Options

| Option | Description |
|--------|-------------|
| `-e, --env <name>` | Environment (config file name) |
| `-a, --automation <key>` | Automation key (overrides mesa.json) |
| `-f, --force` | Force overwrite |
| `-v, --verbose` | Verbose output |
| `-n, --number <n>` | Number of items |
| `-p, --payload <json>` | JSON payload for test/logs |

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Build

```bash
npm install
npm run build
```

### Run locally

```bash
npm run cli -- --help
npm run cli -- auth status
npm run cli -- -e development push
```

### Watch mode (rebuild on changes)

```bash
npm run build:watch
```

### Run tests

```bash
npm test
```

### Type checking

```bash
npm run typecheck
```

## Project Structure

```
mesa-cli/
├── src/
│   ├── cli.ts              # Main CLI entry point
│   ├── generate-fields.ts  # Field generator utility
│   ├── commands/
│   │   └── workflow/       # Workflow commands
│   │       ├── index.ts    # Command registration
│   │       ├── create.ts   # Create subcommand
│   │       ├── list.ts     # List workflows
│   │       ├── enable.ts   # Enable workflow
│   │       ├── disable.ts  # Disable workflow
│   │       ├── test.ts     # Run workflow test
│   │       ├── step-test.ts    # Run step test
│   │       ├── activity.ts     # View workflow activity
│   │       ├── debug.ts        # Debug logging commands
│   │       └── time-travel.ts  # Backfill commands
│   ├── lib/
│   │   ├── automation.ts   # Automation helpers
│   │   ├── client.ts       # HTTP client
│   │   ├── config.ts       # Config loading
│   │   ├── table.ts        # Table formatting utilities
│   │   ├── workflow-picker.ts   # Interactive workflow selection
│   │   ├── test-picker.ts       # Test payload selection
│   │   ├── test-runner.ts       # Test execution & polling
│   │   └── workflow/       # Workflow builder modules
│   │       ├── trigger-registry.ts  # App/trigger search
│   │       ├── step-builder.ts      # Step configuration
│   │       ├── token-picker.ts      # Token insertion
│   │       ├── workflow-builder.ts  # Main wizard
│   │       └── serializer.ts        # JSON conversion
│   └── types/
│       └── index.ts        # Type definitions
├── dist/                   # Compiled output (generated)
├── package.json
└── tsconfig.json
```

## MESA Web App Setup (for auth flow development)

The authentication flow requires the MESA web app to be running.

### Dev environment

1. Start the MESA web app Docker containers
2. Use `mesa auth login --dev` to authenticate against dev-mesa.theshoppad.com

### Environment URLs

| Environment | App URL | API URL |
|-------------|---------|---------|
| Development | https://dev-mesa.theshoppad.com | https://dev-mesa.theshoppad.com/api |
| Production | https://app.theshoppad.com | https://api.getmesa.com/v1/admin |

## Troubleshooting

### "Could not find config.yml"

Run `mesa auth login` to authenticate, or create a config file manually:

```bash
mkdir -p ~/.mesa
cat > ~/.mesa/config.yml << EOF
uuid: your-uuid-here
key: your-api-key-here
EOF
```

### "Invalid token" or 403 errors

Your API key may be expired or invalid. Run `mesa auth login` to re-authenticate.

### "No store selected" during auth

If you have multiple MESA stores, the authorization page will ask you to select one.

## Publishing

```bash
npm version patch  # or minor, major
npm publish
```

## License

AGPL-3.0
