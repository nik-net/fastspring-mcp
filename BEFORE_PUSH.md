# Before Pushing to Remote — Checklist

Use this list before you push this repo to a public remote (e.g. GitHub). Tick off as you go.

---

## Tests (all passing as of last run)

- [x] **Typecheck** — `npm run typecheck`
- [x] **Unit tests** — `npm test` (204 tests, coverage thresholds met)
- [x] **Build** — `npm run build`
- [x] **Smoke test** — `npm run test:smoke` (MCP server starts and responds to initialize + tools/list)

**Integration test** (`npm run test:integration`) is optional before push — it calls the real FastSpring API and needs `TEST_ORDER_REFERENCE`, `TEST_SUBSCRIPTION_ID` (and optionally `TEST_CUSTOMER_EMAIL`) in `.env`. Run it locally when you have credentials; CI does not run it.

---

## Still to do before you push

### 1. Replace repo placeholder in CHANGELOG

- [ ] In **CHANGELOG.md**, replace `YOUR_GITHUB_ORG_OR_USERNAME` with your actual GitHub org or username (e.g. `nikkhilgupta/fs-mcp`).

### 2. Confirm no secrets are tracked

- [ ] Run: `git status` and ensure **`.env`** never appears as a file to be committed.
- [ ] Run: `git ls-files .env` — output should be **empty** (if not, `.env` was committed at some point; remove it from the index and add to `.gitignore` if needed).
- [ ] Optional: `git log -p --all -S "FS_API_PASSWORD" -- "*.ts" "*.mjs" "*.json"` — should find nothing sensitive in committed source.

### 3. Rotate credentials if anything was ever committed

- [ ] If the old hardcoded order reference / subscription ID in `scripts/integration-test-api.mjs` referred to real customer data, treat those as exposed (they were in git history). Rotate or obscure as needed.
- [ ] FastSpring API credentials and MCP API keys live only in `.env` (never committed) — no rotation needed for open-sourcing unless you previously committed them elsewhere.

### 4. Set up remote and push

- [ ] Create the empty repo on GitHub (or your host). Do **not** initialize with a README if you already have one locally.
- [ ] Add remote: `git remote add origin <your-repo-url>`
- [ ] Push: `git push -u origin main` (or `master`, depending on your default branch).

### 5. Optional after push

- [ ] Add repo URL to **README.md** (e.g. “Fork me on GitHub” or link in intro).
- [ ] In GitHub: add description, topics, and ensure **SECURITY.md** is discoverable (e.g. Security tab).
- [ ] If you add **ESLint** as a devDependency and config, re-enable the **Lint** step in `.github/workflows/ci.yml`.

---

## Quick re-run of tests

```bash
npm run typecheck && npm run build && npm test && npm run test:smoke
```

When everything above is done, you can delete this file or keep it for future releases.
