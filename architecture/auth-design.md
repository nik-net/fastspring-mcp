# Authentication Design Proposal
**FastSpring MCP Server — HTTP Transport Security**

> **Status:** Implemented ✅
> **Last updated:** 2026-02-19

---

## 1. Problem Statement

The FastSpring MCP server exposes 11 tools (orders, subscriptions, accounts) over a Streamable HTTP transport at `POST/GET/DELETE /mcp`. This endpoint currently has **zero authentication** — any actor who can reach the port can invoke all tools and access sensitive customer data (PII, orders, payment subscriptions).

The STDIO transport is inherently secure (OS-level process isolation) and requires no changes.

---

## 2. Client Compatibility

| Client | Simple Bearer token works? |
|---|---|
| **Cursor** | Yes — static `Authorization` header in MCP config |
| **Claude Desktop** | Yes — static `Authorization` header in `claude_desktop_config.json` |
| **Claude Code** | Yes — `--header "Authorization: Bearer <key>"` |
| **Anthropic Messages API** | Yes — `authorization_token` field |
| **claude.ai web app** (Settings → Connectors) | **No** — requires full OAuth 2.1 flow |

> The claude.ai web app connectors feature requires OAuth 2.1 and is explicitly **out of scope**. All other clients work with a static Bearer token.

---

## 3. Chosen Approach: Multi-Key API Authentication

A set of valid API keys is configured via environment variable. Any one key grants access. This is the simplest production-viable approach — no external dependencies, no token infrastructure, works with every target client today.

### Auth Flow

```
Incoming HTTP request
        │
        ├── GET /health ──────────────────────────────► Always allowed (Docker probe)
        │
        ├── MCP_AUTH_ENABLED = false ─────────────────► Pass through (backward compat)
        │
        └── MCP_AUTH_ENABLED = true
                │
                ├── Extract: Authorization: Bearer <token>
                │   (missing or malformed)
                │        └── 401 + WWW-Authenticate: Bearer realm="FastSpring MCP"
                │
                ├── Check token against key set (timing-safe)
                │   (not found)
                │        └── 401 + WWW-Authenticate: Bearer realm="FastSpring MCP"
                │
                └── Authorized ──────────────────────► MCP handler
```

### Key Storage

Keys are stored in `MCP_API_KEYS` as a comma-separated list in the `.env` file. The server loads them at startup and holds them in memory. Rotation requires updating the env var and restarting the container — acceptable given the low rotation frequency expected.

```bash
# .env
MCP_AUTH_ENABLED=true
MCP_API_KEYS=key-one-here,key-two-here,key-three-here
```

Generating a key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Security Properties

| Property | Detail |
|---|---|
| Timing-safe comparison | `crypto.timingSafeEqual` — no token-length oracle |
| No secrets in logs | Keys are never logged at any level |
| Health probe unprotected | `/health` bypasses auth for Docker/k8s probes |
| Fail-fast at startup | Server refuses to start if `enabled=true` with no keys configured |
| Backward compatible | `MCP_AUTH_ENABLED=false` (default) — existing deployments unaffected |
| Pluggable interface | `AuthMiddleware` interface enables drop-in JWT or OAuth 2.1 later |

---

## 4. Architecture

### 4.1 New Files

| File | Purpose |
|---|---|
| `src/middleware/auth.ts` | `AuthMiddleware` interface + `ApiKeyAuthMiddleware` implementation |

### 4.2 Modified Files

| File | Change |
|---|---|
| `src/config.ts` | Add `AuthConfig` interface; parse `MCP_AUTH_ENABLED`, `MCP_API_KEYS`; fail-fast validation |
| `src/transports/http.ts` | Inject `AuthMiddleware` into request handler; exempt `/health` |
| `.env.example` | Document new auth env vars |
| `README.md` | Document the feature, key generation, client config examples |

### 4.3 Config Schema

```typescript
export interface AuthConfig {
  readonly enabled: boolean;    // MCP_AUTH_ENABLED (default: false)
  readonly apiKeys: string[];   // MCP_API_KEYS — comma-separated list of valid tokens
}
```

### 4.4 Middleware Interface

```typescript
export type AuthResult =
  | { authorized: true }
  | { authorized: false; statusCode: 401 | 403; message: string };

export interface AuthMiddleware {
  validate(req: http.IncomingMessage): AuthResult;
}
```

`ApiKeyAuthMiddleware` implements this interface. The transport accepts `AuthMiddleware | null`, keeping the door open for a future `JwtAuthMiddleware` or `OAuthMiddleware` swap without touching transport code.

---

## 5. Client Configuration Examples

**Cursor** (`~/.cursor/mcp.json` or workspace `.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "fastspring": {
      "type": "http",
      "url": "http://your-server:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-key>"
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "fastspring": {
      "type": "http",
      "url": "http://your-server:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-key>"
      }
    }
  }
}
```

---

## 6. Out of Scope

| Concern | Note |
|---|---|
| claude.ai web app connectors | Requires OAuth 2.1 — separate, larger project if needed |
| Token expiry | Upgrade path: swap `ApiKeyAuthMiddleware` for `JwtAuthMiddleware` |
| Key hot-reload without restart | Not needed given expected rotation frequency |
| Rate limiting | Handle at reverse proxy layer (nginx, Traefik, Caddy) |

---

## 7. Implementation Checklist

- [x] `src/middleware/auth.ts` — `AuthMiddleware` interface + `ApiKeyAuthMiddleware`
- [x] `src/config.ts` — `AuthConfig`, parse env vars, fail-fast validation
- [x] `src/transports/http.ts` — inject middleware, exempt `/health`
- [x] `.env.example` — document `MCP_AUTH_ENABLED`, `MCP_API_KEYS`
- [x] `README.md` — key generation, client config examples
- [x] `tests/middleware/auth.test.ts` — 16 tests covering valid keys, rejections, security invariants, edge cases
