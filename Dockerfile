# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Full Node image with devDependencies so TypeScript can compile.
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDeps required by tsc).
# --ignore-scripts prevents the "prepare" script from running tsc before
# the source files have been copied into the layer.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ── Stage 2: Production ───────────────────────────────────────────────────────
# Lean image with only runtime dependencies and the compiled output.
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only.
# --ignore-scripts skips the "prepare" build step (already done in Stage 1).
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# Copy compiled JavaScript from the builder stage.
COPY --from=builder /app/dist ./dist

# Pre-create the log directory and hand ownership to the built-in non-root
# "node" user that ships with the official Node image.
RUN mkdir -p /app/logs && chown -R node:node /app

USER node

# ── Transport defaults ─────────────────────────────────────────────────────────
# These configure the server to listen on HTTP inside the container.
# Sensitive credentials (FS_API_USERNAME, FS_API_PASSWORD, FS_COMPANY_ID)
# must NEVER be baked into the image — inject them at runtime via
#   docker run --env-file .env ...
#   or docker compose (env_file / environment).
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000 \
    MCP_HTTP_PATH=/mcp \
    MCP_HTTP_STATELESS=false \
    FS_LOG_DIR=/app/logs \
    FS_LOG_LEVEL=info

# Expose the MCP HTTP port.
# Override MCP_HTTP_PORT and this EXPOSE value together if you need a
# different port (or simply remap with -p at runtime).
EXPOSE 3000

# Readiness / liveness probe using the built-in /health endpoint.
# alpine ships with wget; no need to install curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
