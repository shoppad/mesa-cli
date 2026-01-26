# MESA CLI Authentication Investigation

## Date: 2026-01-26

## Summary

This document captures findings from investigating the MESA web app authentication mechanisms and database schema to understand how to implement a modern CLI authentication flow.

---

## 1. Current Authentication Mechanisms in MESA Web App

### A. AWS Cognito with JWT (Web UI)
- **File:** `/apps/mesa/services/auth/cognito.php`
- Primary auth for web dashboard
- JWT stored in `accessToken` cookie
- Validates claims: `iss`, `token_use`, `exp`

### B. Admin API Authentication (Current CLI Target)
- **File:** `/apps/mesa/services/utils/client.php`
- Route: `/api/admin/{uuid}/(.*).json`
- Requires `X-Api-Key` header
- Key validated against `config.api_key.value` (decrypted)

### C. MCP Token Authentication
- **File:** `/apps/mesa/services/mcp/mcp.php`
- Token format: `encrypted("{uuid}|{webhook_key}")`
- Uses encryption service for token validation

### D. Webhook Authentication
- HMAC-SHA256 for Shopify webhooks
- Query parameter `?apikey={webhook_key}` for JSON webhooks

---

## 2. UUID Structure

### Historical vs. Current
- **Historical:** Shopify store subdomain (e.g., `my-store`)
- **Current:** Proper UUID (e.g., `2039ecd8-77d4-4b50-bfdc-8fdb09546824`)

### Source
- Web platform: Generated from Stripe Customer ID
- Shopify: Uses a shop identifier format (e.g., `shoppad-darryl`)

### Storage
- `mesa.uuid` field in mesa collection
- `mesa.users[].uuid` for user-to-store mapping

---

## 3. API Key Schema

### Location in MongoDB
**Collection:** `shoppad.mesa`

### Structure
```javascript
{
  uuid: "2039ecd8-77d4-4b50-bfdc-8fdb09546824",
  config: {
    api_key: {
      id: "AWS_KEY_ID",           // AWS API Gateway key ID
      value: "ENCRYPTED_VALUE",   // AES-256 encrypted
      usage_plan_id: "stabvu"     // AWS usage plan
    },
    webhook_key: {
      id: "AWS_KEY_ID",
      value: "ENCRYPTED_VALUE",
      usage_plan_id: "stabvu"
    }
  }
}
```

### Key Creation Flow
**File:** `/apps/mesa/services/queue/aws.php`
1. Check if key exists in config
2. Create new key in AWS API Gateway
3. Encrypt key value
4. Store in MongoDB

### Key Retrieval
**File:** `/apps/mesa/services/utils/client.php`
```php
public static function getKey($type = 'api') {
    $config = Request::Shop()->getConfig();
    $token = @(string)$config["{$type}_key"]['value'];
    $encryption = new Encryption(Config::get('encryption.key'));
    return $encryption->decrypt($token);
}
```

---

## 4. Dev Environment Findings

### MongoDB
- **Host:** localhost:27017 (via Docker)
- **Database:** `shoppad`
- **Collections:** `mesa`, `mesa.users`, `mesa.secrets`, etc.

### Sample Records
- 2 mesa stores found
- 2 users found (one web, one Shopify source)
- Current sample has `webhook_key` but no `api_key`

---

## 5. What Needs to Change

### Server-Side (MESA Web App)

1. **New Collection: `mesa.cli_auth_sessions`**
   - Stores pending CLI auth requests
   - Fields: `device_code`, `user_code`, `uuid`, `status`, `expires_at`, `created_at`

2. **New Endpoints:**
   - `POST /api/cli/auth/device` - Start device code flow
   - `GET /api/cli/auth/status` - Poll for auth completion
   - `POST /api/cli/auth/approve` - Approve CLI access (called from UI)

3. **New UI Page:**
   - Route: `/cli/authorize`
   - Shows user code, asks for confirmation
   - Creates/returns API key on approval

4. **API Key Creation:**
   - Ensure `api_key` is created if not exists
   - Consider CLI-specific key type vs. reusing existing

### Client-Side (CLI)

1. **New `auth login` command**
   - Request device code
   - Display user code
   - Open browser to approval URL
   - Poll for completion
   - Store credentials locally

2. **Config storage update**
   - Current: `config.yml` with `uuid` and `key`
   - Keep format, add better error handling

---

## 6. Recommended Auth Flow

```
┌─────────────┐                              ┌─────────────┐
│   CLI       │                              │  MESA API   │
└─────────────┘                              └─────────────┘
       │                                            │
       │  1. POST /api/cli/auth/device              │
       │  ─────────────────────────────────────────>│
       │                                            │
       │  2. { device_code, user_code, url }        │
       │  <─────────────────────────────────────────│
       │                                            │
       │  3. Open browser to url?user_code=XXX      │
       │  ─────────────────────────────────────────>│ Browser
       │                                            │
       │                                            │ User logs in
       │                                            │ (Cognito JWT)
       │                                            │
       │                                            │ User approves
       │                                            │
       │  4. Poll: GET /api/cli/auth/status         │
       │  ─────────────────────────────────────────>│
       │                                            │
       │  5. { status: 'approved', uuid, api_key }  │
       │  <─────────────────────────────────────────│
       │                                            │
       │  6. Store credentials locally              │
       │                                            │

```

---

## 7. Security Considerations

1. **Device codes** should expire quickly (10 minutes)
2. **User codes** should be short, human-readable (e.g., `MESA-1234`)
3. **API keys** should be stored with restricted file permissions (0600)
4. **Polling** should have rate limits and exponential backoff
5. **HTTPS** required for all endpoints

---

## 8. Files to Modify in MESA Web App

| File | Changes |
|------|---------|
| `/config/routes.php` | Add CLI auth routes |
| `/controllers/api/cli.php` | New controller for CLI auth endpoints |
| `/models/cli_auth.php` | New model for CLI auth sessions |
| `/services/queue/aws.php` | Ensure API key creation works |
| `/views/cli/authorize.php` | New approval page |

---

## 9. Next Steps

1. Complete TypeScript port of mesa-cli
2. Implement backend endpoints in MESA web app
3. Create approval UI
4. Wire up CLI auth command
5. Test end-to-end
