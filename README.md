# FastSpring MCP Server

Production-ready [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [FastSpring API](https://developer.fastspring.com/reference/getting-started-with-your-api). Exposes FastSpring orders, subscriptions, and accounts as MCP tools for use with Claude, Cursor, and any other MCP-compatible client.

Supports two transport modes:
- **STDIO** — default; for local MCP clients (Claude Desktop, Cursor, MCP Inspector)
- **Streamable HTTP** — for remote clients, hosted deployments, and Docker

---

## Table of Contents

1. [Stack](#stack)
2. [Environment Variables Reference](#environment-variables-reference)
3. [Sensitive Information — How to Handle Credentials](#sensitive-information--how-to-handle-credentials)
4. [Running Locally](#running-locally)
   - [Prerequisites](#prerequisites)
   - [STDIO transport (default)](#stdio-transport-default)
   - [Streamable HTTP transport](#streamable-http-transport)
5. [Running in Docker](#running-in-docker)
   - [Prerequisites](#prerequisites-1)
   - [Docker Compose (recommended)](#docker-compose-recommended)
   - [Plain Docker run](#plain-docker-run)
6. [CI/CD Deployments](#cicd-deployments)
7. [Connecting MCP Clients](#connecting-mcp-clients)
   - [Cursor / Claude Desktop (STDIO)](#cursor--claude-desktop-stdio)
   - [Cursor / Claude Desktop (HTTP)](#cursor--claude-desktop-http)
   - [Claude.ai (remote HTTP)](#claudeai-remote-http)
8. [Testing & Inspection](#testing--inspection)
9. [Tools Reference](#tools-reference)
10. [Logging](#logging)
11. [Scripts Reference](#scripts-reference)

---

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 (≥ 20 required) |
| Language | TypeScript — strict mode |
| MCP SDK | `@modelcontextprotocol/sdk` v1.26+ |
| HTTP transport | `StreamableHTTPServerTransport` (MCP spec) |
| HTTP client | Axios (Basic auth + interceptors) |
| Testing | Vitest — mocked HTTP, 80 %+ coverage |
| Logging | Winston — daily rotation, structured JSON |
| Container | Docker / Docker Compose |

---

## Environment Variables Reference

### Required — FastSpring credentials

| Variable | Description |
|---|---|
| `FS_API_USERNAME` | FastSpring API username |
| `FS_API_PASSWORD` | FastSpring API password |

Credentials are created in the FastSpring dashboard: **Developer Tools → APIs → Create**.

### Optional — FastSpring settings

| Variable | Default | Description |
|---|---|---|
| `FS_COMPANY_ID` | — | Classic (legacy) API company ID. Required only for order-reference lookups via `find_orders_by_reference` / `get_order_by_reference`. |
| `FS_BASE_URL` | `https://api.fastspring.com` | Override if your account uses a company-scoped base URL. |
| `FS_DEBUG` | `false` | Set to `true` to log every API request and response body. |
| `FS_LOG_LEVEL` | `debug` | Log verbosity: `debug` `info` `warn` `error` `fatal`. |
| `FS_LOG_DIR` | `logs` | Directory for daily log files. |

### Optional — Transport & HTTP server

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http`. |
| `MCP_HTTP_PORT` | `3000` | Port the HTTP server listens on. |
| `MCP_HTTP_HOST` | `0.0.0.0` | Interface to bind to (`0.0.0.0` = all interfaces). |
| `MCP_HTTP_PATH` | `/mcp` | URL path for the MCP endpoint. |
| `MCP_HTTP_STATELESS` | `false` | `true` = create a new server per request (no session tracking). Suitable for serverless/ephemeral callers. |

### Optional — HTTP authentication

| Variable | Default | Description |
|---|---|---|
| `MCP_AUTH_ENABLED` | `false` | Set to `true` to require Bearer token auth on all MCP endpoints. `GET /health` is always exempt. |
| `MCP_API_KEYS` | — | Comma-separated list of valid API keys. Required when `MCP_AUTH_ENABLED=true`. Any single key grants full access. |

> **Note:** Authentication only applies to the HTTP transport. The STDIO transport is secured by the OS process model and needs no auth configuration.

---

## Sensitive Information — How to Handle Credentials

> **Rule:** credentials (`FS_API_USERNAME`, `FS_API_PASSWORD`, `FS_COMPANY_ID`) are **never** stored inside the container image or committed to source control. They are always injected at runtime as environment variables.

### What is safe and what is not

| Location | Safe? | Notes |
|---|---|---|
| `.env` file on your local machine | ✅ | Never committed (`.gitignore`), never copied into the image (`.dockerignore`) |
| Baked into `Dockerfile` via `ENV` | ❌ | Would be visible in every layer of the image |
| Committed to git | ❌ | Permanent, hard to rotate |
| Docker image layers | ❌ | `docker history` / `docker inspect` exposes them |
| Runtime environment variable (`-e`, `env:`) | ✅ | The correct approach for all environments |

### Local development

Use a `.env` file — it is loaded automatically by the server at startup (via `dotenv`) and by Docker Compose for variable substitution:

```bash
cp .env.example .env
# Edit .env and fill in your credentials
```

The `.env` file is excluded from git and Docker builds:
- `.gitignore` → never committed
- `.dockerignore` → never copied into the image

### CI/CD and production

Do **not** use a `.env` file. Inject credentials as environment variables from your platform's secret store:

**GitHub Actions**
```yaml
env:
  FS_API_USERNAME: ${{ secrets.FS_API_USERNAME }}
  FS_API_PASSWORD: ${{ secrets.FS_API_PASSWORD }}
  FS_COMPANY_ID:   ${{ secrets.FS_COMPANY_ID }}
```

**AWS ECS**
```json
{
  "secrets": [
    { "name": "FS_API_USERNAME", "valueFrom": "arn:aws:secretsmanager:..." },
    { "name": "FS_API_PASSWORD", "valueFrom": "arn:aws:secretsmanager:..." }
  ]
}
```

**Kubernetes**
```yaml
env:
  - name: FS_API_USERNAME
    valueFrom:
      secretKeyRef:
        name: fastspring-credentials
        key: username
```

**Render / Railway / Fly.io / Heroku** — use the platform's "Environment Variables" or "Secrets" UI dashboard.

---

## Running Locally

### Prerequisites

```bash
node --version   # must be ≥ 20
npm --version
```

**Install and build:**

```bash
npm install
npm run build
```

**Configure credentials:**

```bash
cp .env.example .env
# Edit .env — set FS_API_USERNAME and FS_API_PASSWORD at minimum
```

---

### STDIO transport (default)

STDIO is the standard transport for local MCP clients. The client (Cursor, Claude Desktop, MCP Inspector) spawns the server as a child process and communicates over stdin/stdout.

```bash
npm start
# or explicitly:
npm run start:stdio
```

The server produces no console output on startup (MCP protocol runs over stdio — any stdout/stderr would corrupt the stream). All logs go to the `logs/` directory.

---

### Streamable HTTP transport

HTTP mode starts a local web server. Use this when you want to call the server from a script, another process, or a remote MCP client.

```bash
npm run start:http
```

**Default endpoint:** `http://localhost:3000/mcp`

**Custom port or path:**

```bash
MCP_HTTP_PORT=8080 MCP_HTTP_PATH=/api/mcp npm run start:http
```

**Verify it is running:**

```bash
curl http://localhost:3000/health
# → {"status":"ok","transport":"streamable-http","mode":"stateful","sessions":0}
```

**Stateless mode** (new server instance per request — useful for scripts or one-shot callers):

```bash
MCP_HTTP_STATELESS=true npm run start:http
```

**Test with the MCP Inspector UI (HTTP mode):**

```bash
npm run test:inspector:http
# Starts the server in HTTP mode, then opens the Inspector UI pointing at it
```

---

## Running in Docker

The Docker image defaults to HTTP transport (`MCP_TRANSPORT=http`) and binds to `0.0.0.0` so it is reachable from outside the container. Credentials are **never baked into the image** — they are always passed at runtime.

### Prerequisites

You need **both** the Docker daemon and the Compose plugin. The easiest way to get both together is **Docker Desktop**.

#### Option A — Docker Desktop (recommended for Mac/Windows)

Download and install from https://www.docker.com/products/docker-desktop/

Docker Desktop bundles the Docker daemon, the `docker` CLI, and the `docker compose` plugin (v2). After installing and starting Docker Desktop:

```bash
docker --version          # Docker version 29.x or later
docker compose version    # Docker Compose version v2.x or later
```

#### Option B — Docker CLI + Compose plugin via Homebrew (Mac)

If you already have the Docker CLI installed via Homebrew (`brew install docker`) but without Docker Desktop, install the standalone Compose plugin separately:

```bash
brew install docker-compose
```

Then use the hyphenated `docker-compose` command (v1) or the `:v1` npm script variants:

```bash
docker-compose --version  # docker-compose version 1.x or 2.x
```

> **How to tell which you have:** Run `docker compose version` (with a space). If it says `unknown command`, you have the CLI only and need Option A or B above.

---

### Docker Compose (recommended)

Docker Compose reads your `.env` file automatically for variable substitution and passes each credential as a runtime environment variable into the container. The `.env` file itself is never copied into the image.

**Start (builds image on first run, uses cache on subsequent runs):**

```bash
# Docker Desktop / Compose v2 (docker compose — space):
npm run docker:up
# or directly:
docker compose build && docker compose up

# Homebrew docker-compose / Compose v1 (docker-compose — hyphen):
npm run docker:up:v1
# or directly:
docker-compose build && docker-compose up
```

**Verify:**

```bash
curl http://localhost:3000/health
```

**Tail logs:**

```bash
npm run docker:logs        # Compose v2
npm run docker:logs:v1     # Compose v1
```

**Stop:**

```bash
npm run docker:down        # Compose v2
npm run docker:down:v1     # Compose v1
```

**Custom port** — set `MCP_HTTP_PORT` in your `.env` or shell before starting:

```bash
MCP_HTTP_PORT=8080 docker compose up --build
```

**What Docker Compose does with your `.env`:**

Docker Compose reads `.env` from the project directory and substitutes `${VAR}` placeholders in `docker-compose.yml`. The result is that each variable is passed to the container as a standard environment variable. The `.env` file stays on your machine — it is not mounted into the container, and `.dockerignore` prevents it from entering the build context.

---

### Plain Docker run

If you prefer not to use Compose, build the image once and run it with explicit `-e` flags. Each `-e VAR` (without a value) forwards the variable from your current shell into the container.

**Build:**

```bash
npm run docker:build
# or:
docker build -t fastspring-mcp .
```

**Run** (credentials must be exported in your shell first):

```bash
export FS_API_USERNAME=your_username
export FS_API_PASSWORD=your_password
export FS_COMPANY_ID=your_company_id   # if needed

npm run docker:run
# which expands to:
docker run --rm \
  -e FS_API_USERNAME \
  -e FS_API_PASSWORD \
  -e FS_COMPANY_ID \
  -e FS_LOG_LEVEL \
  -e FS_DEBUG \
  -p 3000:3000 \
  fastspring-mcp
```

Or use `--env-file` to load from a file at run time (the file stays on the host):

```bash
docker run --rm --env-file .env -p 3000:3000 fastspring-mcp
```

---

## CI/CD Deployments

For CI/CD pipelines, there is no `.env` file. Inject all variables as secrets provided by your platform.

**Generic pattern:**

```bash
# 1. Build the image (no secrets needed at build time)
docker build -t fastspring-mcp .

# 2. Push to a registry
docker tag fastspring-mcp registry.example.com/fastspring-mcp:latest
docker push registry.example.com/fastspring-mcp:latest

# 3. Deploy — pass secrets as environment variables at runtime
docker run -d \
  -e FS_API_USERNAME="$FS_API_USERNAME" \
  -e FS_API_PASSWORD="$FS_API_PASSWORD" \
  -e FS_COMPANY_ID="$FS_COMPANY_ID" \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_PORT=3000 \
  -p 3000:3000 \
  registry.example.com/fastspring-mcp:latest
```

The server performs **fail-fast validation** at startup: if `FS_API_USERNAME` or `FS_API_PASSWORD` are missing, the process exits immediately with a clear error. Misconfiguration is caught at boot, not at the first API call.

---

## Connecting MCP Clients

### Cursor / Claude Desktop (STDIO)

Add to your MCP config file (e.g. `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "fastspring": {
      "command": "node",
      "args": ["/absolute/path/to/fs-mcp/dist/index.js"],
      "env": {
        "FS_API_USERNAME": "your_username",
        "FS_API_PASSWORD": "your_password",
        "FS_COMPANY_ID":   "your_company_id"
      }
    }
  }
}
```

The client spawns the server as a subprocess. The `env` block passes credentials directly — no `.env` file required when using this approach.

---

### Cursor / Claude Desktop (HTTP)

Start the server in HTTP mode first (locally or via Docker), then configure your client to connect by URL.

Claude Desktop only supports stdio transport natively. To connect it to an HTTP MCP server, use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a proxy bridge — `npx` fetches it automatically, no install required.

**Without authentication** (`MCP_AUTH_ENABLED=false`, default):
```json
{
  "mcpServers": {
    "fastspring": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp"
      ]
    }
  }
}
```

**With authentication** (`MCP_AUTH_ENABLED=true`):
```json
{
  "mcpServers": {
    "fastspring": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--header",
        "Authorization:Bearer <your-api-key>"
      ]
    }
  }
}
```

---

### Claude.ai (remote HTTP)

Claude.ai connects to remote MCP servers over the Streamable HTTP transport. Deploy this server (via Docker or any Node host), then add the public URL in Claude.ai's MCP server settings:

```
https://your-server.example.com/mcp
```

If authentication is enabled, include the `Authorization: Bearer <key>` header in your client configuration. Ensure the server is behind HTTPS (e.g. a reverse proxy such as nginx or Caddy) for production use.

---

### Generating API keys

Use Node.js to generate a cryptographically secure random key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add one or more keys to your `.env`:

```bash
MCP_AUTH_ENABLED=true
MCP_API_KEYS=a3f8c2...,b7d1e9...
```

The server accepts any key in the list, so different clients can use different keys and be revoked independently by removing their key and restarting.

---

## Testing & Inspection

### Unit tests

Run the full test suite with coverage (thresholds: 80 % lines/statements/functions, 75 % branches). All HTTP calls are mocked — no real FastSpring API calls are made.

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

Type-check only (no emit):

```bash
npm run typecheck
```

---

### Smoke test (no browser)

Spawns the server, sends MCP `initialize` and `tools/list` over STDIO, and prints the JSON responses. Useful for verifying the server starts correctly without a browser or UI:

```bash
npm run test:smoke
```

Save output for sharing or debugging:

```bash
npm run test:smoke > logs/smoke.txt 2>&1
```

---

### MCP Inspector — STDIO mode

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) provides a browser UI to list and invoke tools. In STDIO mode it spawns the server as a child process:

```bash
npm run test:inspector
# Opens Inspector UI at http://localhost:6274
```

Pass credentials if you are not using a `.env` file:

```bash
FS_API_USERNAME=xxx FS_API_PASSWORD=yyy npm run test:inspector
```

---

### MCP Inspector — HTTP mode

In HTTP mode the Inspector connects to an **already-running** server by URL. This command starts the server in HTTP mode in the background, waits for it to be ready, then opens the Inspector:

```bash
npm run test:inspector:http
# Opens Inspector UI connected to http://localhost:3000/mcp
```

Custom port:

```bash
MCP_HTTP_PORT=8080 npm run test:inspector:http
```

---

### Integration test (real API)

Calls the real FastSpring API with your credentials. Requires a valid `.env` with credentials and optionally `TEST_CUSTOMER_EMAIL`:

```bash
npm run test:integration
```

---

## Tools Reference

All tools return JSON. Errors include an `error` field, and when available `statusCode` and `responseBody` from FastSpring. **All string inputs are trimmed** before calling the API.

### Orders

| Tool | Description | Inputs |
|---|---|---|
| `get_order` | Fetch a single order by **internal** FastSpring order ID. | `orderId` (string) |
| `find_orders_by_email` | List all orders for a customer by email. | `email` (string) |
| `find_orders_by_reference` | Look up orders by **reference** (e.g. `VI8201014-6538-11102S`). | `reference` (string) |
| `get_order_by_reference` | Fetch full order detail by reference via the Classic API. | `reference` (string) |

### Subscriptions

| Tool | Description | Inputs |
|---|---|---|
| `get_subscription` | Fetch a subscription by **internal** subscription ID. | `subscriptionId` (string) |
| `get_subscription_by_reference` | Look up a subscription by **reference**. | `reference` (string) |
| `list_subscriptions` | List subscriptions with optional filters. | `status` (optional), `product` (optional), `email` (optional) |
| `get_subscription_entries` | Get line items for a subscription. | `subscriptionId` (string) |

### Accounts

| Tool | Description | Inputs |
|---|---|---|
| `get_account` | Fetch a customer account by ID. | `accountId` (string) |
| `find_account_by_email` | Look up an account by customer email. | `email` (string) |
| `get_account_orders` | Get all orders for an account. | `accountId` (string) |

### ID vs reference — avoiding 400 errors

- `get_order` and `get_subscription` use FastSpring's **internal ID** in the URL path. Passing a human-readable **reference** (e.g. `VI8201014-6538-11102S`) will return **400 Bad Request**.
- Use `find_orders_by_reference` or `get_subscription_by_reference` when you have a reference string.
- Internal IDs are available in the FastSpring dashboard or from list tools (`find_orders_by_email`, `list_subscriptions`, etc.) which return objects containing both `id` and `reference`.
- If you get 400 on valid-looking IDs, your account may use a company-scoped base URL. Set `FS_BASE_URL=https://api.fastspring.com/company/yourcompany` in `.env`.

---

## Logging

- **Daily rotation:** one file per day under `FS_LOG_DIR` (default `logs/`), e.g. `logs/fastspring-mcp-2026-02-19.log`. Files are retained for 14 days.
- **Levels:** `fatal` `error` `warn` `info` `debug` — set via `FS_LOG_LEVEL`.
- **DEBUG level:** logs every FastSpring API request (method, URL) and response (status, body). Enable with `FS_DEBUG=true` or `FS_LOG_LEVEL=debug`.
- **Format:** pretty-printed lines with timestamp, level, message, and JSON metadata. Credentials are never logged.
- **Docker:** the `logs/` directory is mounted as a volume (`./logs:/app/logs`) so logs persist across container restarts.

---

## Scripts Reference

### Development

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Start server in STDIO mode (default) |
| `npm run start:stdio` | Start server explicitly in STDIO mode |
| `npm run start:http` | Start server in Streamable HTTP mode (port 3000) |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | ESLint on `src/` |

### Testing

| Script | Description |
|---|---|
| `npm test` | Vitest unit tests with coverage |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:smoke` | Smoke test over STDIO — no browser required |
| `npm run test:integration` | Integration test against real FastSpring API |
| `npm run test:inspector` | MCP Inspector UI — STDIO mode |
| `npm run test:inspector:http` | MCP Inspector UI — HTTP mode (starts server + opens Inspector) |

### Docker

| Script | Description |
|---|---|
| `npm run docker:build` | Build the Docker image (no Compose needed) |
| `npm run docker:run` | Run the container — credentials forwarded from shell env (no Compose needed) |
| `npm run docker:up` | Build and start via Docker Compose v2 (`docker compose`) |
| `npm run docker:down` | Stop and remove containers (Compose v2) |
| `npm run docker:logs` | Tail container logs (Compose v2) |
| `npm run docker:up:v1` | Build and start via Compose v1 (`docker-compose` — Homebrew) |
| `npm run docker:down:v1` | Stop and remove containers (Compose v1) |
| `npm run docker:logs:v1` | Tail container logs (Compose v1) |

---

## License

This project is **dual-licensed**.

- **AGPL v3** — Default. You may use, modify, and distribute the software under the terms of the [GNU Affero General Public License v3](LICENSE). If you run a modified version as a service over a network, you must make the corresponding source available to users of that service.
- **Commercial** — Use in proprietary products or services without AGPL’s source-availability obligations requires a separate commercial license. See [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) for details.

**Commercial licensing enquiries:** [help@gotmo.co.uk](mailto:help@gotmo.co.uk)
