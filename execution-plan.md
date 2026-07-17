# Execution Plan — Security Hardening Enhancements

Scope: Implement fixes for Jira tickets **EPMEDUAI-1020** and **EPMEDUAI-1021** in repo `mini-leave-portal`.

Repo context (from current codebase):
- `server.js` is a single-file Express API.
- JWT secret currently has an insecure fallback: `process.env.JWT_SECRET || "dev-secret-change-me"`.
- SQLite database file path is `./app.db` and **an `app.db` binary is committed**.
- The app auto-creates tables at startup (`db.exec(CREATE TABLE IF NOT EXISTS ...)`).
- The app **always seeds** two users if users table is empty (employee/admin with known passwords).

> Constraints / Assumptions (explicit)
> - No CI config is present in the repo; required checks below describe what should run locally/CI.
> - No test framework currently exists; we will add minimal test harness only if agreed. In this plan we include a lightweight approach to add tests using Node’s built-in test runner to avoid introducing large dependencies.
> - Ticket EPMEDUAI-1021 requests removal of DB artifacts and safe initialization. It does not explicitly prohibit dev seeding, but suggests limiting to development/test.

---

## 1. Sprint Plan

### Sprint 1 — “Security Baseline: Secrets + Data Hygiene”
**Goal**: Close immediate security gaps: enforce JWT secret configuration and remove committed database artifacts + seed restrictions.

**Tickets**: 
- EPMEDUAI-1020 — Remove insecure default JWT secret and require JWT_SECRET configuration
- EPMEDUAI-1021 — Remove production-like database artifact from repository and prevent credential exposure

**Rationale**: Both are high-priority security issues; address together to ship a hardened baseline.

**Planned capacity**: ~8–13 story points (depending on how much test scaffolding is added).

---

## 2. Task Breakdown (actionable)

Estimates use story points (SP) + T-shirt size.

### Ticket: EPMEDUAI-1020 — JWT secret enforcement

#### Task 1020.1 — Define JWT secret validation rules
- **Type**: design
- **Estimate**: 1 SP (XS)
- **Description**:
  - Decide minimum acceptable requirements for `JWT_SECRET`.
  - Recommend: must exist and have minimum length (e.g., >= 32 chars).
- **Acceptance notes**:
  - Validation rules are documented in-code comments and `README` (or inline in execution plan if README doesn’t exist).

#### Task 1020.2 — Implement fail-fast startup when JWT_SECRET missing/weak
- **Type**: implementation
- **Estimate**: 2 SP (S)
- **Description**:
  - Replace `const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";` with strict loading logic.
  - If missing/invalid: log a clear error and exit process with non-zero code.
  - Centralize config access (small `config` object in `server.js` or new `config.js` module).
- **Acceptance notes**:
  - App does not start without `JWT_SECRET`.
  - Error message explicitly states how to set `JWT_SECRET`.

#### Task 1020.3 — Ensure auth middleware returns 401 on invalid signature
- **Type**: test
- **Estimate**: 2 SP (S)
- **Description**:
  - Add an integration test that:
    - boots the server with a known `JWT_SECRET`.
    - issues a request with a token signed with a different secret.
    - expects `401` and `{ error: "Invalid token" }`.
  - Use Node built-in `node:test` + `fetch` (Node 20 includes fetch).
  - Provide a small server bootstrap method (export `app` without calling `listen` directly) to make tests feasible.
- **Acceptance notes**:
  - Test fails on old behavior and passes after fix.

#### Task 1020.4 — Documentation for required env vars
- **Type**: docs
- **Estimate**: 1 SP (XS)
- **Description**:
  - Add/Update `README.md` (if missing) or inline documentation describing:
    - `JWT_SECRET` required.
    - Example: `export JWT_SECRET="<strong-random-string>"`.
- **Acceptance notes**:
  - Developer can run app locally with clear instructions.

---

### Ticket: EPMEDUAI-1021 — Remove committed DB artifact + safe init

#### Task 1021.1 — Remove `app.db` from repository history (at least from current tree)
- **Type**: chore
- **Estimate**: 1 SP (XS)
- **Description**:
  - Delete `app.db` from the repo (current commit tree).
  - Confirm `.gitignore` includes `app.db` (it already does) and keep it.
- **Acceptance notes**:
  - Fresh clone does not include `app.db`.

> Note: removing from full git history requires rewriting history (e.g., `git filter-repo`). This plan only guarantees removal from HEAD; coordinate with repo owners if full history purge is required.

#### Task 1021.2 — Make DB path configurable and support clean bootstrap
- **Type**: implementation
- **Estimate**: 2 SP (S)
- **Description**:
  - Keep default DB path `./app.db` but allow override via env (e.g., `DB_PATH`).
  - Ensure app can start when DB file does not exist (better-sqlite3 will create it).
  - Keep table creation `CREATE TABLE IF NOT EXISTS ...`.
- **Acceptance notes**:
  - Starting from a clean repo creates DB file locally and `/health` returns `{ ok: true }`.

#### Task 1021.3 — Restrict seeding to non-production environments
- **Type**: implementation
- **Estimate**: 2 SP (S)
- **Description**:
  - Current code always seeds default users if table empty.
  - Change so seeding runs only when explicitly enabled:
    - Option A: `SEED_USERS=true`
    - Option B: `NODE_ENV !== "production"` (less explicit)
  - Prefer **explicit flag** to avoid accidental seeding.
  - Update console output to indicate seeding mode.
- **Acceptance notes**:
  - In default startup (no seed flag), no default users are created.
  - With `SEED_USERS=true`, users are seeded as before (for dev convenience).

#### Task 1021.4 — Tests for clean-start behavior without committed DB
- **Type**: test
- **Estimate**: 2 SP (S)
- **Description**:
  - Add a test that starts server with `DB_PATH` set to a temp path (within repo workspace, e.g. `./.tmp/test.db`).
  - Assert `/health` returns ok true.
  - Assert tables exist by querying the db file (or by hitting `/auth/login` with expected failure due to no users).
- **Acceptance notes**:
  - Test demonstrates app is bootstrappable without shipping `app.db`.

#### Task 1021.5 — Documentation updates for DB initialization
- **Type**: docs
- **Estimate**: 1 SP (XS)
- **Description**:
  - Document `DB_PATH` (if added) and seeding toggle (`SEED_USERS`).
  - Explain that DB is created on first run and should not be committed.
- **Acceptance notes**:
  - New contributors understand how to run locally.

---

## 3. Dependencies

### Cross-ticket / sequencing dependencies
- **1020.3 (tests)** depends on **1020.2** if refactoring server startup is required for testability.
- **1021.4 (tests)** depends on **1021.2** (DB_PATH/config) and likely on test harness introduced in **1020.3**.
- **1021.3 (seeding restriction)** should land before docs **1021.5**.

### Recommended implementation order
1. 1021.1 remove `app.db` from repo (fast win; reduces exposure immediately).
2. 1020.2 enforce JWT_SECRET fail-fast.
3. 1021.2 DB_PATH + bootstrap.
4. 1021.3 restrict seeding.
5. Add tests (1020.3, 1021.4) after code is structured for it.
6. Docs (1020.4, 1021.5).

---

## 4. Timeline (1 sprint, 2 weeks example)

> Adjust dates to actual team cadence.

- **Days 1–2**: 1021.1, 1020.1, 1020.2
- **Days 3–4**: 1021.2, 1021.3
- **Days 5–7**: 1020.3, 1021.4 (test harness + integration tests)
- **Days 8–9**: 1020.4, 1021.5 (docs), cleanup
- **Day 10**: buffer + security review + release prep

---

## 5. Branching Strategy

- **Base branch**: `main` (assumption; confirm in repo settings)

### Branch naming convention
- `feature/<ticket>-<short-description>` for enhancements/security hardening
- `chore/<ticket>-<short-description>` for repo hygiene

**Examples**
- `feature/EPMEDUAI-1020-require-jwt-secret`
- `chore/EPMEDUAI-1021-remove-committed-db`
- `feature/EPMEDUAI-1021-seed-toggle-db-path`

**Notes**
- Keep branches small and ticket-aligned to simplify reviews.
- If both tickets must merge together for compatibility, use a short-lived integration branch after individual PRs merge.

---

## 6. Commit Plan (Conventional Commits)

Allowed types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.

### Task 1021.1 — Remove committed DB artifact
**Branch**: `chore/EPMEDUAI-1021-remove-committed-db`
- `chore: remove committed app.db from repository`
  - Body: `This removes the SQLite database artifact from version control. app.db remains ignored via .gitignore.`

### Task 1020.2 — Enforce JWT_SECRET config
**Branch**: `feature/EPMEDUAI-1020-require-jwt-secret`
- `fix(auth): require JWT_SECRET and fail fast when missing`
  - Body: `Remove insecure fallback secret and exit with a clear error when JWT_SECRET is not configured.`
- (optional if refactor needed)
  - `refactor(config): centralize env configuration for server startup`

### Task 1021.2 — DB path config + bootstrap
**Branch**: `feature/EPMEDUAI-1021-seed-toggle-db-path`
- `feat(db): allow configuring sqlite path via DB_PATH`
  - Body: `Default remains ./app.db; supports clean bootstrap on fresh clone.`

### Task 1021.3 — Restrict seeding
**Branch**: `feature/EPMEDUAI-1021-seed-toggle-db-path`
- `fix(seed): run user seeding only when SEED_USERS=true`
  - Body: `Avoid shipping default credentials by preventing implicit seeding.`

### Task 1020.3 — JWT invalid signature test
**Branch**: `feature/EPMEDUAI-1020-require-jwt-secret`
- `test(auth): return 401 for tokens signed with wrong secret`
  - Body: `Boot server with configured JWT_SECRET and verify invalid signature is rejected.`

### Task 1021.4 — Clean-start test
**Branch**: `feature/EPMEDUAI-1021-seed-toggle-db-path`
- `test(db): server starts and healthcheck passes without preexisting app.db`
  - Body: `Uses DB_PATH pointing to a temp sqlite file.`

### Task 1020.4 + 1021.5 — Docs
**Branch**: `feature/EPMEDUAI-1021-seed-toggle-db-path` (or separate docs branch)
- `docs: document required JWT_SECRET and optional DB_PATH/SEED_USERS`

---

## 7. PR Plan

### Merge strategy
- **Squash merge** for each PR (keeps main history clean and aligns to ticket).

### Required checks (recommended)
- `npm test` (after adding tests)
- `node -c server.js` or `npm run lint` (no linter exists; optional)
- Basic security sanity: ensure startup fails without `JWT_SECRET` (can be a test)

### PR breakdown & order

#### PR-1: Remove DB artifact (fast security win)
- **Branch**: `chore/EPMEDUAI-1021-remove-committed-db`
- **Tickets**: EPMEDUAI-1021
- **Contents**:
  - Remove `app.db` from repo.
  - Confirm `.gitignore` still ignores it.
- **Review focus**: ensures no sensitive artifacts remain.

#### PR-2: Enforce JWT_SECRET (fail-fast)
- **Branch**: `feature/EPMEDUAI-1020-require-jwt-secret`
- **Tickets**: EPMEDUAI-1020
- **Contents**:
  - Remove fallback secret, add validation + fail-fast.
  - Minimal refactor to keep config clean.
- **Review focus**: startup behavior, clear error messaging, no regressions.

#### PR-3: DB bootstrap + seed toggle + tests + docs
- **Branch**: `feature/EPMEDUAI-1021-seed-toggle-db-path`
- **Tickets**: EPMEDUAI-1021 (+ optionally reference EPMEDUAI-1020 for shared test harness changes)
- **Contents**:
  - `DB_PATH` support.
  - Seed gating with `SEED_USERS=true`.
  - Integration tests for clean-start and JWT invalid signature (if test harness shared, consider moving JWT test to PR-2; otherwise keep tests with the relevant change).
  - Docs updates.
- **Review focus**: no default credentials created by accident; tests are deterministic.

### Review guidelines
- Ensure secrets/config are not logged.
- Confirm default runtime with no env vars:
  - must **fail** due to missing JWT secret (per 1020).
  - should not require pre-existing DB file (per 1021).
- Confirm seeding requires explicit opt-in.

---

## Appendix: Validation Checklist (for QA/reviewer)

### EPMEDUAI-1020
- [ ] Start app with no `JWT_SECRET` => process exits non-zero with clear error.
- [ ] Start with `JWT_SECRET=some-long-secret` => app starts.
- [ ] Send request with token signed by different secret => 401 + `Invalid token`.

### EPMEDUAI-1021
- [ ] Repo has no `app.db` committed.
- [ ] Fresh clone + `JWT_SECRET=...` => app starts, creates DB file locally.
- [ ] Default startup does not seed users.
- [ ] With `SEED_USERS=true`, users are seeded (dev only).
