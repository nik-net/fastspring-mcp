# Contributing to FastSpring MCP Server

Thank you for your interest in contributing. This document describes how to get set up, the standards we follow, and the process for submitting changes.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Coding Standards](#coding-standards)
5. [Submitting a Pull Request](#submitting-a-pull-request)
6. [Reporting Bugs](#reporting-bugs)
7. [Requesting Features](#requesting-features)
8. [Security Vulnerabilities](#security-vulnerabilities)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20 (`node --version`)
- npm ≥ 9

### Setup

```bash
# Fork and clone the repo
git clone https://github.com/<your-fork>/fs-mcp.git
cd fs-mcp

# Install dependencies
npm install

# Build
npm run build

# Copy the example env file and fill in your FastSpring credentials
cp .env.example .env
```

---

## Development Workflow

### Branch naming

```
feat/<short-description>      # new feature
fix/<short-description>       # bug fix
refactor/<short-description>  # refactoring, no behaviour change
docs/<short-description>      # documentation only
test/<short-description>      # test additions or fixes
chore/<short-description>     # tooling, deps, CI
```

### Making changes

1. Create a branch from `main`.
2. Write your code — follow the [Coding Standards](#coding-standards) below.
3. Add or update tests in `tests/` to cover your change.
4. Ensure the full test suite passes: `npm test`
5. Ensure TypeScript compiles cleanly: `npm run typecheck`
6. Open a pull request against `main`.

### Running tests

```bash
# Full test suite with coverage
npm test

# Watch mode
npm run test:watch

# Type-check only
npm run typecheck

# Smoke test (no browser, validates server starts and responds)
npm run build && npm run test:smoke
```

Coverage thresholds are enforced: ≥ 80 % lines/statements/functions, ≥ 75 % branches. Pull requests that lower coverage will not be merged.

---

## Coding Standards

- **Language:** TypeScript with strict mode (`strict: true`). No `any` without a comment explaining why.
- **Formatting:** The project does not enforce a formatter at CI level yet, but please match the surrounding style — 2-space indentation, double quotes, semicolons.
- **Error handling:** Every public function must have a root-level `try/catch`. Errors should be caught and logged; never swallowed silently.
- **No hard-coded values:** Use environment variables (via `src/config.ts`) or typed enumerations. Never hard-code API URLs, credentials, or customer data.
- **Logging:** Use the injected `logger` (Winston) rather than `console.*`. All API requests and responses must be logged at `debug` level.
- **Comments:** Explain *why*, not *what*. Do not narrate the code.
- **SOLID principles:** Keep modules small, single-purpose, and injected with dependencies rather than importing them directly.

---

## Submitting a Pull Request

1. Fill in the pull request template completely.
2. Reference any related issues with `Closes #<issue-number>` or `Relates to #<issue-number>`.
3. Make sure CI passes (lint, typecheck, tests).
4. Request a review. A maintainer will respond within a few business days.
5. Squash or rebase fixup commits before merging if asked.

---

## Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) issue template. Include:

- A clear description of the unexpected behaviour.
- Exact steps to reproduce.
- Expected vs. actual output.
- Your environment (OS, Node.js version, transport mode, MCP client).
- Relevant log output (redact any credentials or PII before posting).

---

## Requesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) issue template. Describe the problem you are solving, not just the solution you have in mind.

---

## Security Vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.** Follow the responsible disclosure process described in [SECURITY.md](SECURITY.md).
