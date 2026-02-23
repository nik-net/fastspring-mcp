# Open source push — security checklist

Use this before pushing to a **new public remote**. It summarizes what is safe, what was changed, and how to avoid leaking secrets or customer data.

---

## 1. Git history — sensitive data

**Yes: your current git history still contains the old order reference and subscription ID.**

They appeared in:
- The **initial commit** (`93dbddc`): `scripts/integration-test-api.mjs` had hardcoded `ORDER_REFERENCE = "VI8260212-9431-10120"` and `SUBSCRIPTION_ID = "QPFodmtlRq2ILb-_3p955A"`.
- A later commit that removed them: the **diff** of that commit shows those same strings.

So if you **push with full history** to a new remote, anyone can see those values in the repo history.

**Options:**

| Option | What to do |
|--------|------------|
| **A. Push with history** | Accept that those IDs are in history. Treat them as exposed; rotate or obscure in FastSpring if needed. Easiest. |
| **B. Push without history** | Create a single “initial release” commit with no parent history so the old commits (and refs) never go to the remote. Steps below. |
| **C. Rewrite history** | Use `git filter-repo` or BFG to remove the sensitive strings from all commits. More work and can break clones. |

**To push without history (Option B):**

```bash
# Create a new branch with no history
git checkout --orphan open-source-main
git add -A
git commit -m "Initial open source release"
# Rename to main if that’s your default
git branch -M main
# Add the new remote and push (only this one commit)
git remote add origin <your-new-repo-url>
git push -u origin main
```

Your new remote will have only this one commit; the old commits (with the refs in diffs) stay only on your local machine.

---

## 2. Tracked files — what was cleaned

All **currently tracked** files have been audited and updated so they do **not** contain:

- Real order references (e.g. `VI8260212-9431-10120`) → replaced with placeholder `VI0000000-0000-00000` in source and unit tests.
- Real subscription references (e.g. `VI8170706-1107-55121S`) → replaced with placeholder `VI0000000-0000-00000S` in tests.
- Your real company ID (`vi8ltd`) → replaced with `example-company` in tests and docs (e.g. `.env.example`, comments).

**Emails in tests** (e.g. `a@b.com`, `john@acme.com`, `jane@acme.com`, `user@example.com`) are generic/example addresses only, not real customer data.

**Credentials:** No API keys, passwords, or usernames are in tracked source or test files. They are only in `.env`, which is not committed.

---

## 3. .gitignore — what is never committed

The following are ignored and will **not** be pushed:

- **Environment & secrets:** `.env`, `.env.*`, except `.env.example`. Backup/secret patterns: `*.bak`, `*.backup`, `.env.local`, `*.secret`, `*.secrets`.
- **Keys/certs:** `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.cer`.
- **Build & runtime:** `node_modules/`, `dist/`, `logs/`, `*.log`, `coverage/`, `.vitest/`.
- **Editor/OS:** `.DS_Store`, `.idea/`, `.vscode/`, etc.

**Before pushing, confirm:**

```bash
git status
git ls-files .env
```

- `.env` must **not** appear in `git ls-files`. If it does, it was committed earlier; remove it from the index and ensure `.gitignore` is correct.

---

## 4. Quick verification

```bash
# Nothing sensitive in working tree
git status

# .env is not tracked
git ls-files .env
# (output should be empty)

# Optional: search for leftover real-looking refs (should only find placeholders)
rg -n "VI8260212|QPFodmtlRq2ILb|vi8ltd" --glob '!*.md' .
# (ideally no matches, or only in this OPEN_SOURCE_PUSH.md / BEFORE_PUSH.md)
```

---

## 5. Summary

| Item | Status |
|------|--------|
| **Tracked source/tests** | No real order/sub refs or company ID; placeholders only. No credentials. |
| **.gitignore** | `.env`, keys, logs, and common secret patterns excluded. |
| **Git history** | Still contains old refs in past commits/diffs if you push with history. Use Option A (accept), B (push no history), or C (rewrite). |

After you push, you can delete this file or keep it for future releases.
