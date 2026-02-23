# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* Open source readiness: LICENSE (AGPL v3), COMMERCIAL_LICENSE.md (dual licensing), CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, GitHub issue/PR templates, CI workflow.
* Dual licensing: default AGPL v3 for the public repo; commercial license available for proprietary use (see COMMERCIAL_LICENSE.md and README).
* Integration tests now use `TEST_ORDER_REFERENCE` and `TEST_SUBSCRIPTION_ID` from environment (no hardcoded customer data).

### Changed

* `.gitignore` expanded to exclude all `.env.*` except `.env.example`, and common secret/certificate patterns.
* `.env.example` documents integration test variables.

## [1.0.0] - 2026-02-20

### Added

* FastSpring MCP server with STDIO and Streamable HTTP transports.
* Tools: orders (get_order, find_orders_by_email, find_orders_by_reference, get_order_by_reference), subscriptions (get_subscription, get_subscription_by_reference, list_subscriptions, get_subscription_entries), accounts (get_account, find_account_by_email, get_account_orders).
* Optional Bearer token auth for HTTP transport.
* Docker and Docker Compose support.
* Vitest tests with coverage thresholds.

[Unreleased]: https://github.com/YOUR_GITHUB_ORG_OR_USERNAME/fs-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/YOUR_GITHUB_ORG_OR_USERNAME/fs-mcp/releases/tag/v1.0.0
