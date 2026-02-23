# Security Policy

## Supported Versions

We release security updates for the latest major version. The following are currently supported:

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities in public GitHub issues.**

If you believe you have found a security issue:

1. **Email** the maintainers (or open a private security advisory on GitHub if the repo supports it) with a description of the issue and steps to reproduce.
2. Allow a reasonable time for a fix before any public disclosure.
3. We will acknowledge your report and work on a fix. We may ask for clarification.
4. After a fix is released, we can credit you in the release notes if you agree.

### What we consider in scope

* Authentication or authorization bypass (e.g. MCP HTTP auth, FastSpring API credential handling).
* Leak of credentials or secrets (e.g. in logs, error messages, or responses).
* Injection or unsafe handling of user-controlled input that could affect the server or downstream APIs.
* Denial of service or resource exhaustion from normal use of the server.

### What is out of scope

* Issues in dependencies (report to the upstream project; we will bump dependencies when fixes are released).
* Misconfiguration (e.g. leaving `MCP_AUTH_ENABLED=false` on a public endpoint).
* Social engineering or physical access.

Thank you for helping keep this project and its users safe.
