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

### `mesa logs`

View recent logs.

```bash
mesa logs              # Recent logs
mesa logs -n 50        # Last 50 logs
mesa logs -v           # Verbose (show metadata)
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
│   ├── lib/
│   │   ├── automation.ts   # Automation helpers
│   │   ├── client.ts       # HTTP client
│   │   └── config.ts       # Config loading
│   └── types/
│       └── index.ts        # Type definitions
├── dist/                   # Compiled output (generated)
├── docs/
│   └── auth-investigation.md
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
