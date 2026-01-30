# CLAUDE.md - mesa-cli Reference Guide

## 1. What mesa-cli Is

mesa-cli is a command-line interface for MESA workflow automation development. It enables developers and AI agents to create, test, debug, and manage MESA workflows without using the web dashboard.

**Design Rule**: The CLI is a thin wrapper over the same backend logic used by the Dashboard. All business logic lives server-side—the CLI simply calls the same API endpoints. This ensures consistent behavior between CLI and Dashboard operations, and means any backend improvements automatically benefit both interfaces.

Primary use cases:
- Creating and configuring workflows programmatically
- Running full workflow tests with fixture payloads
- Testing individual workflow steps
- Enabling/disabling debug logging for troubleshooting
- Managing workflow state (enable/disable)
- CI/CD integration for automated workflow testing

---

## 2. Quickstart (5 minutes)

### Prerequisites

- **Node.js**: v18.0.0 or later (uses native test runner)
- **npm**: v8.0.0 or later
- **Access**: A MESA account with API access

### Install

```bash
# Clone and install
git clone <repo-url> mesa-cli
cd mesa-cli
npm install
npm run build

# Verify installation
npm run cli -- --help
```

Expected output:
```
Usage: mesa [options] [command]

Command-line interface for MESA automation development

Options:
  -V, --version              output the version number
  -e, --env <value>          Environment to use (filename in ./config/)
  -a, --automation <value>   Automation key
  -f, --force                Force overwrite
  -v, --verbose              Verbose output
  -n, --number <value>       Number of items (for logs)
  -p, --payload <value>      JSON payload
  -h, --help                 display help for command

Commands:
  auth                       Authentication commands
  push [files...]            Upload scripts and mesa.json to MESA
  ...
```

### First Commands

```bash
# 1. Check auth status (will show "not authenticated" initially)
npm run cli -- auth status

# 2. Authenticate with MESA
npm run cli -- auth login

# 3. Verify authentication succeeded
npm run cli -- auth status

# 4. List your workflows
npm run cli -- workflow list
```

Expected output after `auth status` (authenticated):
```
Authenticated as: your-store.myshopify.com
UUID: abc123-def456-...
Config: ~/.mesa/config.yml
```

Expected output from `workflow list`:
```
Name                              Key                    Status     Enabled
─────────────────────────────────────────────────────────────────────────────
Order Created to Slack            order_to_slack_1       published  Yes
Inventory Sync                    inventory_sync_2       published  Yes
...
```

---

## 3. Authentication

### How to Authenticate

mesa-cli uses OAuth 2.0 Device Authorization flow:

```bash
# Production authentication
npm run cli -- auth login

# Development environment authentication
npm run cli -- auth login --dev
```

The CLI will:
1. Display a verification URL and user code
2. Open your browser to the verification page
3. Poll for completion while you authorize in the browser
4. Save credentials on success

Example flow:
```
Opening browser to authorize...

Please visit: https://app.theshoppad.com/admin/mesa/cli/authorize
And enter code: ABCD-1234

Waiting for authorization... (press Ctrl+C to cancel)
✓ Successfully authenticated!
Credentials saved to: /Users/you/.mesa/config.yml
```

### Where Credentials Are Stored

| Location | Path | Purpose |
|----------|------|---------|
| Global config | `~/.mesa/config.yml` | Default credentials location |
| Local config | `./config/config.yml` | Project-specific override |
| Environment config | `./config/<env>.yml` | Environment-specific config |

Credential file format:
```yaml
uuid: your-store-uuid-here
key: your-api-key-here
api_url: https://api.getmesa.com/v1/admin  # optional, defaults to production
_authenticated_at: 2024-01-15T10:30:00.000Z
```

File permissions are set to `0600` (owner read/write only).

### Rotating Credentials

```bash
# Clear existing credentials
npm run cli -- auth logout

# Re-authenticate
npm run cli -- auth login
```

### Verifying Authentication

```bash
npm run cli -- auth status
```

Success output:
```
Authenticated as: your-store.myshopify.com
UUID: abc123-def456-...
Config: ~/.mesa/config.yml
```

Not authenticated output:
```
Not authenticated.
Run "mesa auth login" to authenticate.
```

### Common Auth Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `Configuration error: Could not find config.yml` | No credentials file | Run `npm run cli -- auth login` |
| `API error (401): Unauthorized` | Invalid or expired credentials | Run `npm run cli -- auth logout && npm run cli -- auth login` |
| `API error (403): Access denied` | Wrong store/insufficient permissions | Verify you're logged into the correct MESA account |
| `Browser did not open` | Headless environment | Manually visit the displayed URL |

---

## 4. Local Development

### Running in Development Mode

```bash
# Build and run (recommended for development)
npm run dev -- <command>

# Or build once and run multiple times
npm run build
npm run cli -- <command>

# Watch mode for continuous development
npm run build:watch
# In another terminal:
npm run cli -- <command>
```

### Running the Built Version

```bash
# After npm run build
node dist/cli.js <command>

# Or via npm script
npm run cli -- <command>
```

### Pointing to Different Environments

#### Method 1: Config File per Environment

Create environment-specific config files:

```bash
# Development config
cat > ./config/development.yml << 'EOF'
uuid: dev-store-uuid
key: dev-api-key
api_url: https://dev-mesa.theshoppad.com/api/admin
EOF

# Staging config
cat > ./config/staging.yml << 'EOF'
uuid: staging-store-uuid
key: staging-api-key
api_url: https://staging-mesa.theshoppad.com/api/admin
EOF

# Production config (default)
cat > ./config/config.yml << 'EOF'
uuid: prod-store-uuid
key: prod-api-key
EOF
```

Use with `-e` flag:
```bash
npm run cli -- -e development workflow list
npm run cli -- -e staging workflow list
npm run cli -- workflow list  # uses default config.yml
```

#### Method 2: Environment Variable

```bash
# Set environment via ENV variable
ENV=development npm run cli -- workflow list
```

#### Method 3: Multi-Environment Config File

Single config file with multiple environments:
```yaml
# ./config/config.yml
default:
  uuid: prod-uuid
  key: prod-key

development:
  uuid: dev-uuid
  key: dev-key
  api_url: https://dev-mesa.theshoppad.com/api/admin

staging:
  uuid: staging-uuid
  key: staging-key
  api_url: https://staging-mesa.theshoppad.com/api/admin
```

### Environment Variables Reference

| Variable | Purpose | Example |
|----------|---------|---------|
| `ENV` | Select config environment | `ENV=development` |

### API URLs by Environment

| Environment | API URL |
|-------------|---------|
| Production | `https://api.getmesa.com/v1/admin` |
| Development | `https://dev-mesa.theshoppad.com/api/admin` |

---

## 5. Core CLI Workflows

### 5.1 Listing Workflows

**Purpose**: Discover available workflows and get their IDs/keys.

```bash
# Interactive list with table output
npm run cli -- workflow list

# JSON output for scripting
npm run cli -- workflow list --json

# Paginated results
npm run cli -- workflow list --limit 10 --page 2

# Search by name
npm run cli -- workflow list --search "order"

# Sort by date
npm run cli -- workflow list --sort updated_at --sort-dir desc
```

**Options**:
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | false |
| `--limit <n>` | Max results per page | 50 |
| `--page <n>` | Page number (1-based) | 1 |
| `--search <term>` | Filter by name/key | - |
| `--sort <field>` | Sort field: `name`, `updated_at`, `created_at` | - |
| `--sort-dir <dir>` | Sort direction: `asc`, `desc` | - |

**Expected Output (table)**:
```
Name                              Key                    Status     Enabled
─────────────────────────────────────────────────────────────────────────────
Order Created to Slack            order_to_slack_1       published  Yes
Inventory Sync                    inventory_sync_2       published  No
```

**Expected Output (JSON)**:
```json
{
  "automations": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "key": "order_to_slack_1",
      "name": "Order Created to Slack",
      "status": "published",
      "enabled": true
    }
  ]
}
```

### 5.2 Creating Workflows

**Purpose**: Create new workflows interactively or from JSON definitions.

```bash
# Interactive wizard (recommended for learning)
npm run cli -- workflow create

# From JSON file (non-interactive)
npm run cli -- workflow create --non-interactive --input workflow.json

# Create and push to MESA immediately
npm run cli -- workflow create --input workflow.json --push

# Output to specific file
npm run cli -- workflow create --output ./workflows/my-workflow.json

# Force overwrite existing
npm run cli -- workflow create --input workflow.json --push --force
```

**Options**:
| Flag | Description |
|------|-------------|
| `--non-interactive` | Skip interactive prompts (requires `--input`) |
| `--input <file>` | JSON file with workflow definition |
| `--output <file>` | Output file path (default: `./mesa.json`) |
| `--push` | Push to MESA after creation |
| `--json` | Output JSON to stdout |
| `--force` | Overwrite existing automation |

**Workflow JSON Structure**:
```json
{
  "key": "my_workflow_1",
  "name": "My Workflow",
  "enabled": true,
  "triggers": [
    {
      "type": "input",
      "key": "shopify_order",
      "name": "Shopify Order Created",
      "metadata": {
        "topic": "orders/create"
      }
    },
    {
      "type": "output",
      "key": "slack_message",
      "name": "Send Slack Message",
      "metadata": {
        "channel": "#orders"
      }
    }
  ]
}
```

### 5.3 Enabling/Disabling Workflows

**Purpose**: Control workflow execution state.

```bash
# Interactive (shows picker)
npm run cli -- workflow enable
npm run cli -- workflow disable

# By workflow ID
npm run cli -- workflow enable --workflow-id 507f1f77bcf86cd799439011
npm run cli -- workflow disable --workflow-id 507f1f77bcf86cd799439011

# By workflow key
npm run cli -- workflow enable --workflow-id order_to_slack_1

# Skip confirmation (disable only)
npm run cli -- workflow disable --workflow-id <ID> --yes

# JSON output
npm run cli -- workflow enable --workflow-id <ID> --json

# Quiet mode (minimal output)
npm run cli -- workflow enable --workflow-id <ID> --quiet
```

**Expected Output**:
```
Successfully enabled workflow "Order Created to Slack" (507f1f77bcf86cd799439011)
```

**JSON Output**:
```json
{
  "id": "507f1f77bcf86cd799439011",
  "name": "Order Created to Slack",
  "enabled": true
}
```

### 5.4 Enabling/Disabling Debug Logs

**Purpose**: Toggle debug logging for workflow troubleshooting.

```bash
# Enable debug logging (interactive picker)
npm run cli -- workflow debug enable

# Enable for specific workflow
npm run cli -- workflow debug enable <WORKFLOW_KEY_OR_ID>
npm run cli -- workflow debug enable order_to_slack_1

# Disable debug logging
npm run cli -- workflow debug disable <WORKFLOW_KEY_OR_ID>

# Check debug status
npm run cli -- workflow debug status
npm run cli -- workflow debug status <WORKFLOW_KEY_OR_ID>

# JSON output
npm run cli -- workflow debug status --json
npm run cli -- workflow debug enable <ID> --json
```

**Expected Output (status)**:
```
Workflows with debug logging enabled:

Name                               Debug   Logging
───────────────────────────────────────────────────
Order Created to Slack             ON      on
Inventory Sync                     ON      on
```

**JSON Output (status)**:
```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "key": "order_to_slack_1",
    "name": "Order Created to Slack",
    "debug": true,
    "logging": true
  }
]
```

**Important**: Debug logs require BOTH `debug=true` AND `logging=true` on the workflow. If logging is disabled, the CLI will warn you.

### 5.5 Running a Full Workflow Test

**Purpose**: Execute a complete workflow test with a payload.

#### Interactive Mode (with payload picker)

```bash
# Pick workflow and payload interactively
npm run cli -- workflow test

# Pick payload for specific workflow
npm run cli -- workflow test <WORKFLOW_KEY_OR_ID>
npm run cli -- workflow test order_to_slack_1
```

#### With Custom Payload File

```bash
# Use JSON file as payload
npm run cli -- workflow test <WORKFLOW_ID> --payload ./test-payload.json

# Example payload file (test-payload.json):
# {
#   "id": 12345,
#   "email": "test@example.com",
#   "total_price": "99.99"
# }
```

#### Non-Interactive Mode (CI-friendly)

```bash
# Requires --payload, exits with code 0 (success) or 1 (failure)
npm run cli -- workflow test <WORKFLOW_ID> --payload ./payload.json --non-interactive

# With JSON output for parsing
npm run cli -- workflow test <WORKFLOW_ID> --payload ./payload.json --non-interactive --json

# Custom timeout (default: 300000ms = 5 minutes)
npm run cli -- workflow test <WORKFLOW_ID> --payload ./payload.json --non-interactive --timeout 60000
```

**Options**:
| Flag | Description | Default |
|------|-------------|---------|
| `--workflow-id <id>` | Workflow ID or key | - |
| `--payload <path>` | Path to JSON payload file | - |
| `--json` | Output as JSON | false |
| `--non-interactive` | CI mode (no prompts) | false |
| `--timeout <ms>` | Test timeout in milliseconds | 300000 |

**Expected Output (interactive)**:
```
Testing workflow: Order Created to Slack
Payload: Sample Order #1001

✓ Test success

────────────────────────────────────────────────────────────────
Test Results

  ✓ Shopify Order Created (125ms)
  ✓ Send Slack Message (340ms)

────────────────────────────────────────────────────────────────
Execution ID: 507f1f77bcf86cd799439011
Total Duration: 2150ms
Result: SUCCESS
```

**Expected Output (JSON)**:
```json
{
  "success": true,
  "executionId": "507f1f77bcf86cd799439011",
  "runId": "507f1f77bcf86cd799439012",
  "duration": 2150,
  "steps": [
    {
      "stepKey": "shopify_order",
      "name": "Shopify Order Created",
      "status": "success",
      "duration": 125,
      "taskId": "task_001"
    },
    {
      "stepKey": "slack_message",
      "name": "Send Slack Message",
      "status": "success",
      "duration": 340,
      "taskId": "task_002"
    }
  ]
}
```

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | All steps succeeded |
| 1 | One or more steps failed, or error occurred |

### 5.6 Running a Single Step Test

**Purpose**: Test an individual workflow step in isolation.

```bash
# Interactive mode
npm run cli -- workflow step test

# Test specific workflow step
npm run cli -- workflow step test <WORKFLOW_ID>

# With custom payload
npm run cli -- workflow step test <WORKFLOW_ID> --payload ./step-payload.json

# Non-interactive with JSON output
npm run cli -- workflow step test <WORKFLOW_ID> --payload ./payload.json --non-interactive --json
```

**Options**: Same as `workflow test`.

**Note**: Step test currently runs the full workflow test. Individual step isolation is a planned enhancement (see TODO section).

### 5.7 Viewing Workflow Activity

**Purpose**: View recent workflow executions and their status.

```bash
# Interactive (pick workflow)
npm run cli -- workflow activity

# For specific workflow
npm run cli -- workflow activity --workflow-id <ID>

# Filter by status
npm run cli -- workflow activity --workflow-id <ID> --status fail

# Filter by badge (test, replay, backfill, delayed)
npm run cli -- workflow activity --workflow-id <ID> --badge test

# Paginated
npm run cli -- workflow activity --workflow-id <ID> --limit 10 --page 2

# JSON output
npm run cli -- workflow activity --workflow-id <ID> --json
```

**Options**:
| Flag | Description | Default |
|------|-------------|---------|
| `--workflow-id <id>` | Workflow ID | - |
| `--json` | Output as JSON | false |
| `--limit <n>` | Results per page | 25 |
| `--page <n>` | Page number | 1 |
| `--status <status>` | Filter: `ready`, `running`, `success`, `fail`, `pause`, `skip` | - |
| `--badge <badge>` | Filter: `test`, `replay`, `backfill`, `delayed` | - |

**Expected Output**:
```
Activity for: Order Created to Slack

Status    Started              Duration   Badge
─────────────────────────────────────────────────────
✓         2024-01-15 10:30     2.1s       test
✓         2024-01-15 10:25     1.8s       -
✗         2024-01-15 10:20     0.5s       -
```

### 5.8 Time-Travel (Backfill)

**Purpose**: Re-run a workflow against historical data.

```bash
# Interactive (shows eligible workflows only)
npm run cli -- workflow time-travel

# Check status for specific workflow
npm run cli -- workflow time-travel --workflow-id <ID>

# Start backfill with date range
npm run cli -- workflow time-travel --workflow-id <ID> --from 2024-01-01 --to 2024-01-15

# Limit records processed
npm run cli -- workflow time-travel --workflow-id <ID> --from 2024-01-01 --limit 100

# Skip confirmation
npm run cli -- workflow time-travel --workflow-id <ID> --from 2024-01-01 --yes

# JSON output
npm run cli -- workflow time-travel --workflow-id <ID> --json
```

**Eligibility Requirements**:
- Workflow must be enabled
- Workflow must not be deleted
- Must have exactly one input trigger
- Input trigger must support backfill (connector-specific)

---

## 6. How to Test Integrations

### Recommended Approach for Deterministic Testing

1. **Use dedicated test stores/accounts**: Never test against production data
2. **Create stable fixture payloads**: Store in version control
3. **Reference payloads by file path**: Avoid live webhook dependencies
4. **Use `--non-interactive` mode**: Ensures reproducible execution
5. **Capture JSON output**: Parse and validate programmatically

### Setting Up a Test Environment

```bash
# Create test config
mkdir -p ./config
cat > ./config/test.yml << 'EOF'
uuid: test-store-uuid
key: test-api-key
api_url: https://api.getmesa.com/v1/admin
EOF

# Create test fixtures directory
mkdir -p ./test-fixtures
```

### Golden Path Example: Shopify Integration

#### 1. Configure Test Store Credentials

```bash
# Authenticate with your test store
npm run cli -- auth login

# Verify connection
npm run cli -- auth status
```

#### 2. Create Payload Fixture

```bash
# Create a stable test payload
cat > ./test-fixtures/shopify-order-created.json << 'EOF'
{
  "id": 5551234567890,
  "email": "test-customer@example.com",
  "created_at": "2024-01-15T10:30:00-05:00",
  "total_price": "99.99",
  "currency": "USD",
  "line_items": [
    {
      "id": 11111111111,
      "title": "Test Product",
      "quantity": 1,
      "price": "99.99"
    }
  ],
  "customer": {
    "id": 6661234567890,
    "email": "test-customer@example.com",
    "first_name": "Test",
    "last_name": "Customer"
  },
  "shipping_address": {
    "first_name": "Test",
    "last_name": "Customer",
    "address1": "123 Test Street",
    "city": "Test City",
    "province": "CA",
    "country": "US",
    "zip": "90210"
  }
}
EOF
```

#### 3. List Available Workflows

```bash
npm run cli -- workflow list --json | jq '.automations[] | {id: ._id, key: .key, name: .name}'
```

#### 4. Run Full Workflow Test

```bash
# Get workflow ID first
WORKFLOW_ID=$(npm run cli -- workflow list --json 2>/dev/null | jq -r '.automations[] | select(.key=="order_to_slack_1") | ._id')

# Run test with fixture
npm run cli -- workflow test "$WORKFLOW_ID" \
  --payload ./test-fixtures/shopify-order-created.json \
  --non-interactive \
  --json
```

#### 5. Interpret Results

```bash
# Run and capture output
RESULT=$(npm run cli -- workflow test "$WORKFLOW_ID" \
  --payload ./test-fixtures/shopify-order-created.json \
  --non-interactive \
  --json 2>/dev/null)

# Check success
if echo "$RESULT" | jq -e '.success == true' > /dev/null; then
  echo "Test passed!"
  echo "Duration: $(echo "$RESULT" | jq '.duration')ms"
else
  echo "Test failed!"
  echo "Error: $(echo "$RESULT" | jq -r '.error')"
  echo "Failed steps:"
  echo "$RESULT" | jq '.steps[] | select(.status == "fail")'
  exit 1
fi
```

### Testing Other Integrations

The same pattern applies to other integrations. Create appropriate fixture payloads:

**Google Sheets Example** (`./test-fixtures/sheets-row-added.json`):
```json
{
  "spreadsheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "range": "Sheet1!A1:D1",
  "values": [["Value1", "Value2", "Value3", "Value4"]]
}
```

**Slack Example** (`./test-fixtures/slack-message.json`):
```json
{
  "channel": "#test-channel",
  "text": "Test message from integration test",
  "username": "Test Bot"
}
```

---

## 7. Debugging Guide

### Where Debug Logs Appear

| Log Type | Location | How to Access |
|----------|----------|---------------|
| CLI verbose output | Terminal | Add `-v` or `--verbose` flag |
| Workflow debug logs | MESA Dashboard > Logs | Enable with `workflow debug enable` |
| Execution logs | MESA Dashboard > Activity | Click on execution |
| API request/response | Terminal (verbose) | Add `-v` flag |

### Enabling Verbose Mode

```bash
# Verbose shows API calls and config details
npm run cli -- -v workflow list

# Verbose with workflow test
npm run cli -- -v workflow test <ID> --payload ./test.json
```

Verbose output includes:
- Config file path and source
- Store UUID
- API request URLs
- Response status codes

### Capturing Failed Execution Artifacts

```bash
# Run test and capture full output
npm run cli -- workflow test <ID> \
  --payload ./test.json \
  --non-interactive \
  --json > test-result.json 2>&1

# Extract execution ID
EXECUTION_ID=$(jq -r '.executionId' test-result.json)

# View activity for this workflow to get more details
npm run cli -- workflow activity --workflow-id <ID> --json
```

### Debugging Checklist

#### Missing Credentials
```bash
# Symptom: "Configuration error: Could not find config.yml"
# Fix:
npm run cli -- auth status  # Check current state
npm run cli -- auth login   # Re-authenticate
```

#### Wrong Store Selected
```bash
# Symptom: "Workflow not found" or unexpected workflows
# Fix:
npm run cli -- auth status  # Verify store UUID
npm run cli -- workflow list  # Confirm correct workflows visible
# If wrong store, logout and login to correct account
npm run cli -- auth logout
npm run cli -- auth login
```

#### Workflow Test Timeout
```bash
# Symptom: "Test timed out after 300 seconds"
# Fix: Increase timeout
npm run cli -- workflow test <ID> --payload ./test.json --timeout 600000

# Or debug with verbose mode
npm run cli -- -v workflow test <ID> --payload ./test.json
```

#### Invalid Payload Format
```bash
# Symptom: "Error: Invalid JSON" or step fails on input validation
# Fix: Validate JSON
cat ./test.json | jq .  # Will error if invalid JSON

# Check payload matches expected schema
npm run cli -- -v workflow test <ID> --payload ./test.json
```

#### Permission/Role Issues
```bash
# Symptom: "API error (403): Access denied"
# Fix: Verify API key has correct permissions
npm run cli -- auth status
# Re-authenticate if needed
npm run cli -- auth login
```

#### Debug Logs Not Appearing
```bash
# Symptom: Enabled debug but no logs visible
# Check both debug AND logging are enabled
npm run cli -- workflow debug status <ID> --json

# Output should show both true:
# { "debug": true, "logging": true }

# If logging is false, enable it in MESA Dashboard
```

---

## 8. CI / Automation Usage

### Headless Authentication

For CI environments, pre-configure credentials:

```bash
# Option 1: Create config file in CI
mkdir -p ~/.mesa
cat > ~/.mesa/config.yml << EOF
uuid: ${MESA_UUID}
key: ${MESA_API_KEY}
EOF
chmod 600 ~/.mesa/config.yml

# Option 2: Project-local config
mkdir -p ./config
cat > ./config/config.yml << EOF
uuid: ${MESA_UUID}
key: ${MESA_API_KEY}
EOF
```

### CI Workflow Test Recipe

```yaml
# GitHub Actions example
name: Integration Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test-workflows:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install mesa-cli
        run: |
          npm install
          npm run build

      - name: Configure MESA credentials
        run: |
          mkdir -p ~/.mesa
          cat > ~/.mesa/config.yml << EOF
          uuid: ${{ secrets.MESA_UUID }}
          key: ${{ secrets.MESA_API_KEY }}
          EOF
          chmod 600 ~/.mesa/config.yml

      - name: Verify authentication
        run: npm run cli -- auth status

      - name: Run workflow tests
        run: |
          npm run cli -- workflow test ${{ vars.WORKFLOW_ID }} \
            --payload ./test-fixtures/order-created.json \
            --non-interactive \
            --json > test-result.json

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-result.json

      - name: Check test result
        run: |
          if jq -e '.success == true' test-result.json > /dev/null; then
            echo "✓ Workflow test passed"
          else
            echo "✗ Workflow test failed"
            jq '.steps[] | select(.status == "fail")' test-result.json
            exit 1
          fi
```

### Exit Codes Reference

| Code | Meaning | CI Action |
|------|---------|-----------|
| 0 | Success | Continue pipeline |
| 1 | Failure | Fail pipeline |

### Non-Interactive Flags Summary

| Command | Required Flags for CI |
|---------|----------------------|
| `workflow test` | `--non-interactive --payload <file>` or `--workflow-id <id>` |
| `workflow enable` | `--workflow-id <id>` |
| `workflow disable` | `--workflow-id <id> --yes` |
| `workflow debug enable` | `<workflow-id>` positional arg |
| `workflow list` | None (always non-interactive) |

### Saving JSON Artifacts

```bash
# Test output
npm run cli -- workflow test <ID> --payload ./test.json --non-interactive --json > workflow-test-result.json

# Workflow list
npm run cli -- workflow list --json > workflows.json

# Activity log
npm run cli -- workflow activity --workflow-id <ID> --json > activity.json

# Debug status
npm run cli -- workflow debug status --json > debug-status.json
```

---

## 9. Repo-Specific Maintenance Notes

### Project Structure

```
mesa-cli/
├── src/
│   ├── cli.ts                 # Entry point, command registration
│   ├── commands/
│   │   ├── auth.ts            # auth login/logout/status
│   │   ├── push.ts            # push scripts
│   │   ├── pull.ts            # pull scripts
│   │   ├── watch.ts           # file watcher
│   │   ├── export.ts          # export automation
│   │   ├── install.ts         # install template
│   │   ├── test.ts            # legacy test command
│   │   ├── replay.ts          # replay task
│   │   ├── logs.ts            # view logs
│   │   ├── cache.ts           # cache management
│   │   └── workflow/          # workflow subcommands
│   │       ├── index.ts       # registers all workflow commands
│   │       ├── create.ts      # workflow create
│   │       ├── list.ts        # workflow list
│   │       ├── activity.ts    # workflow activity
│   │       ├── enable.ts      # workflow enable
│   │       ├── disable.ts     # workflow disable
│   │       ├── test.ts        # workflow test
│   │       ├── step-test.ts   # workflow step test
│   │       ├── time-travel.ts # workflow time-travel
│   │       └── debug.ts       # workflow debug enable/disable/status
│   ├── lib/
│   │   ├── client.ts          # API client (all HTTP calls)
│   │   ├── config.ts          # Config loading/management
│   │   ├── automation.ts      # mesa.json helpers
│   │   ├── table.ts           # Table formatting
│   │   ├── workflow-picker.ts # Interactive workflow selection
│   │   ├── test-picker.ts     # Test payload selection
│   │   ├── test-runner.ts     # Test execution polling
│   │   └── workflow/          # Workflow creation utilities
│   └── types/
│       └── index.ts           # TypeScript type definitions
├── dist/                      # Compiled JavaScript (git-ignored)
├── config/                    # Local config files (git-ignored)
├── package.json
├── tsconfig.json
└── CLAUDE.md                  # This file
```

### Adding a New Command

1. **Create command file** in `src/commands/` or appropriate subdirectory:

```typescript
// src/commands/workflow/my-command.ts
import { Command } from 'commander';
import type { GlobalOptions } from '../../types/index.js';
import { loadConfig } from '../../lib/config.js';
import { MesaClient } from '../../lib/client.js';

export function registerMyCommand(parent: Command): void {
  parent
    .command('my-command [arg]')
    .description('Description of what this command does')
    .option('--json', 'Output as JSON')
    .option('--some-option <value>', 'Option description')
    .action(async (arg, opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions;
      // Implementation
    });
}
```

2. **Register in parent command**:

```typescript
// src/commands/workflow/index.ts
import { registerMyCommand } from './my-command.js';

export function registerWorkflowCommand(program: Command): Command {
  const workflowCommand = program.command('workflow');
  // ... existing registrations
  registerMyCommand(workflowCommand);  // Add this
  return workflowCommand;
}
```

3. **Add types if needed** in `src/types/index.ts`

4. **Add client methods if needed** in `src/lib/client.ts`:

```typescript
// Use existing adminRequest pattern
async myNewMethod(param: string): Promise<MyResponse> {
  return this.adminRequest<MyResponse>(
    'POST',
    `endpoint/${param}.json`,
    { body: 'data' }
  );
}
```

### Design Rules for New Commands

1. **No business logic in CLI**: Commands should call backend APIs, not implement business rules
2. **Support `--json`**: All commands that produce output should support JSON mode
3. **Support non-interactive**: Commands should work in CI with appropriate flags
4. **Use existing patterns**: Follow the patterns in `enable.ts` or `list.ts`
5. **Handle errors consistently**: Use `ApiError`, `ConfigError` classes
6. **Use shared utilities**: `workflow-picker.ts`, `table.ts`, `client.ts`

### Running Tests

```bash
# Type checking
npm run typecheck

# Build
npm run build

# Run all tests
npm test

# Run specific test file
node --test dist/lib/config.test.js

# Watch mode for development
npm run build:watch
```

### Test File Conventions

- Test files: `*.test.ts` alongside source files
- Uses Node.js built-in test runner
- Pattern:
  ```typescript
  import { describe, it } from 'node:test';
  import assert from 'node:assert';

  describe('Feature', () => {
    it('should do something', () => {
      assert.strictEqual(actual, expected);
    });
  });
  ```

### Updating Documentation

When adding commands:
1. Update this CLAUDE.md with command syntax and examples
2. Update command's `--help` description
3. Add JSDoc comments to exported functions
4. Update README.md if user-facing

---

## 10. TODO / Planned Enhancements

### Step Test Isolation

**Current state**: `workflow step test` runs the full workflow.

**Needed**: True single-step testing with:
- Ability to provide step input directly
- Hydration from previous execution outputs
- Token resolution from prior step context

**Implementation location**: `src/commands/workflow/step-test.ts`

### Payload ID Support

**Current state**: Payloads loaded from file only.

**Needed**: Support `--payload-id <id>` to reference:
- Connector fixture payloads
- Previous task payloads

**Implementation**: Add to `workflow test` command options, use `client.getTestPayload()`.

### Execution Artifact Export

**Needed**: Command to export full execution details:
```bash
mesa workflow execution <EXECUTION_ID> --json
```

Including:
- All step inputs/outputs
- Request/response bodies
- Timing information
- Error details

---

## Quick Reference

### Common Commands

```bash
# Authentication
npm run cli -- auth login
npm run cli -- auth status
npm run cli -- auth logout

# List workflows
npm run cli -- workflow list
npm run cli -- workflow list --json

# Run workflow test
npm run cli -- workflow test <ID> --payload ./test.json --non-interactive --json

# Enable debug logs
npm run cli -- workflow debug enable <ID>

# View activity
npm run cli -- workflow activity --workflow-id <ID>

# Enable/disable workflow
npm run cli -- workflow enable --workflow-id <ID>
npm run cli -- workflow disable --workflow-id <ID> --yes
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ENV` | Select config environment |

### Config File Locations

| Priority | Path |
|----------|------|
| 1 (highest) | `./config/{env}.yml` |
| 2 | `./config/config.yml` |
| 3 | `./config.yml` |
| 4 | `~/.mesa/config/{env}.yml` |
| 5 | `~/.mesa/config/config.yml` |
| 6 (lowest) | `~/.mesa/config.yml` |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Failure |
