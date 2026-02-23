# ─────────────────────────────────────────────────────────────────────────────
# FastSpring MCP — Docker management
#
# Prerequisites:
#   • Docker Desktop running (enable "Start on login" in Docker Desktop →
#     General so the container comes back automatically after a reboot)
#   • .env file present (copy from .env.example and fill in credentials)
#
# The container is always started in DETACHED mode (-d) so no terminal window
# is held open.  The restart policy in docker-compose.yml (unless-stopped)
# means Docker will bring the container back up automatically whenever the
# Docker daemon restarts — e.g. after a machine reboot or Docker update.
#
# Typical first-time setup:
#   make build      # compile the image
#   make start      # launch in background
#   make status     # confirm it is healthy
#
# Day-to-day:
#   make logs       # tail live logs  (Ctrl-C to exit — container keeps running)
#   make restart    # apply config changes without rebuilding the image
#   make rebuild    # rebuild image and restart (use after code changes)
#   make stop       # stop the container (will NOT auto-restart until 'make start')
# ─────────────────────────────────────────────────────────────────────────────

COMPOSE      := docker compose
SERVICE      := fastspring-mcp
LOG_LINES    := 100

.PHONY: build start stop restart rebuild logs status clean help

## build — build (or rebuild) the Docker image without starting the container
build:
	$(COMPOSE) build

## start — start the container in the background (detached)
## The container will restart automatically if Docker restarts.
start:
	$(COMPOSE) up -d
	@echo ""
	@echo "Container started in background."
	@echo "  Logs  : make logs"
	@echo "  Status: make status"
	@echo "  Stop  : make stop"

## stop — stop the container
## It will NOT restart automatically until you run 'make start' again.
stop:
	$(COMPOSE) stop

## restart — restart the container without rebuilding the image
## Use this to pick up .env changes.
restart:
	$(COMPOSE) restart

## rebuild — rebuild the image from source, then restart the container
## Use this after code changes.
rebuild:
	$(COMPOSE) up -d --build

## logs — stream live container logs (Ctrl-C exits the stream; container keeps running)
logs:
	$(COMPOSE) logs -f --tail=$(LOG_LINES) $(SERVICE)

## status — show the container's current state and health
status:
	$(COMPOSE) ps $(SERVICE)

## clean — stop and remove the container and its image (credentials and logs are preserved)
clean:
	$(COMPOSE) down --rmi local

## help — list available targets
help:
	@echo ""
	@echo "FastSpring MCP — available make targets:"
	@echo ""
	@grep -E '^## ' Makefile | sed 's/^## /  /'
	@echo ""
