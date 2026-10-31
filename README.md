# QA Pilot

QA Pilot is an end-to-end QA management and test automation platform. It takes a client requirement document through the full software testing life cycle (STLC): requirement analysis, test design, test execution, defect management, reporting and test closure.

| Layer | Stack |
|---|---|
| Web | React 19, TypeScript, Tailwind CSS 4, React Router, TanStack Query (Vite) |
| API | NestJS 11, TypeScript, Prisma 6 |
| Database | SQLite (local dev) / PostgreSQL (Docker, production) from one Prisma schema |
| Test engine | Playwright (Phase 4) |
| AI | Claude API (`CLAUDE_MODEL`). Without `ANTHROPIC_API_KEY`, deterministic rule-based generators run instead |

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Setup, auth, roles, multi-project, DB schema, audit trail, encryption | ✅ Done |
| 2 | Requirement upload/parsing, zero-miss extraction, coverage, RTM | ✅ Done |
| 3 | Clarifications, scenarios, test cases, techniques, test plan, test data + review workflow + exports | ✅ Done |
| 4 | Playwright script generation, Run Test Cases, execution screens + demo app | ✅ Done |
| 5 | Auto-defects with screenshots/attachments, defect management | |
| 6 | Jira guide + Jira REST integration | |
| 7 | Morning/evening defect monitoring + notifications | |
| 8 | DSR, WSR, Defect Report, Dashboard | |
| 9 | Test Closure Report with risk highlighting | |
| 10 | Hardening, tests, Docker | |

## Run locally (SQLite)

Requires Node.js 20 or later.

```bash
npm install
cp .env.example apps/api/.env
# Edit apps/api/.env and set JWT_SECRET and ENCRYPTION_KEY, e.g. `openssl rand -hex 32` for each
npm run db:setup          # creates apps/api/prisma/dev.db and seeds users + DEMO project
npm run dev               # API on :4000, web on :5173 (Vite proxies /api)
npm run dev:demo          # optional: ShopEasy demo app on :4600 to run tests against
```

Open http://localhost:5173.

| Seeded account | Password | Role |
|---|---|---|
| admin@qapilot.local | `SEED_ADMIN_PASSWORD` (default `ChangeMe!123`) | Admin |
| lead@qapilot.local | Demo!2345 | QA Lead |
| tester@qapilot.local | Demo!2345 | Tester |
| dev@qapilot.local | Demo!2345 | Developer |
| client@qapilot.local | Demo!2345 | Client (view-only) |

Change these passwords before you use the app with real data.

## Run with Docker (PostgreSQL)

```bash
cp .env.example .env      # set JWT_SECRET, ENCRYPTION_KEY (and POSTGRES_PASSWORD)
docker compose up --build # http://localhost:8080
```

The API image builds a PostgreSQL schema from the SQLite dev schema (`npm run prisma:postgres`), applies it, seeds the admin account (idempotent) and starts the server.

## Tests

```bash
npm test                  # API unit + integration (Jest + Supertest) and web (Vitest + Testing Library)
npm run typecheck
```

API integration tests run against a throwaway SQLite DB (`apps/api/prisma/test.db`) and storage folder (`apps/api/test-storage`) that are recreated on every run. The API test script sets `NODE_OPTIONS=--experimental-vm-modules`, which the PDF library needs under Jest.

The sample requirement documents in `apps/api/test/fixtures` are synthetic and are produced by `python3 apps/api/scripts/make-fixtures.py`. To see how any file is split, run:

```bash
cd apps/api && npx ts-node --transpile-only -P tsconfig.json scripts/try-parse.ts srs-v1.docx
```

## Environment variables

See [`.env.example`](.env.example). Nothing secret is hard-coded, and the API refuses to start without a strong `JWT_SECRET` and a 32-byte `ENCRYPTION_KEY`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma connection (`file:./dev.db` or a `postgresql://` URL) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Session tokens |
| `ENCRYPTION_KEY` | AES-256-GCM key for credentials, API tokens and webhooks stored in the DB |
| `CORS_ORIGIN` | Allowed web origins |
| `STORAGE_DIR` | Uploaded documents, screenshots, videos, traces |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Optional AI layer (default model `claude-opus-5-5`) |
| `OCR_LANG`, `OCR_LANG_PATH` | OCR language (default `eng`, bundled) |
| `MONITOR_*` | Morning/evening defect check schedule (default 09:30 and 18:00 Asia/Kolkata) |

## Roles and permissions

Each user has a global role. A per-project membership role overrides it inside that project. Admins see every project; everyone else sees only the projects they belong to. The matrix is in `apps/api/src/common/permissions.ts`.

| Permission | Admin | QA Lead | Tester | Developer | Client |
|---|:-:|:-:|:-:|:-:|:-:|
| Manage users | ✔ | | | | |
| Create/manage projects, settings, export | ✔ | ✔ | | | |
| Approve artefacts, acknowledge coverage gaps, trigger closure | ✔ | ✔ | | | |
| Edit requirements/artefacts, run tests, create defects | ✔ | ✔ | ✔ | | |
| Update defects | ✔ | ✔ | ✔ | ✔ | |
| View | ✔ | ✔ | ✔ | ✔ | ✔ |

## Requirement analysis (Phase 2)

1. **Upload:** PDF, DOCX, XLSX, CSV, TXT, EML, Markdown and images, up to 25 MB. The original file is stored unchanged, with its SHA-256 hash, and can be downloaded again.
2. **Parsing:**
   - PDF is read page by page, so page numbers are kept. A page with no text layer is rendered and read with OCR.
   - DOCX keeps headings, nested lists, tables, footnotes and endnotes.
   - In spreadsheets, every sheet, row and cell is read.
   - Images are read with OCR. OCR uses tesseract.js with the English language data bundled as an npm package, so it works offline. Set `OCR_LANG` and `OCR_LANG_PATH` for other languages.
3. **Splitting into items:** every sentence, bullet, table row, table cell, header, footnote, note, caption and appendix item becomes an item with a hierarchical ID (`REQ-001.03`, cells `REQ-010.02.03`) and keeps its section and page.
4. **Classification:** a deterministic rule set always runs. When `ANTHROPIC_API_KEY` is set, Claude reclassifies the items in batches using schema-validated structured output, with server-side refusal fallback enabled. The AI never adds or removes items; splitting is deterministic. If the AI call fails, the rule-based result is kept.
5. **Ambiguity:** vague words (should, may, fast, user-friendly, etc., approximately, as needed, TBD …) each become a clarification question (`Q-001`).
6. **Reverse check:** the document is rebuilt from the extracted items and compared word for word with an independently extracted copy of the original text. The UI shows both word counts and any missing words.
7. **New versions:** the app shows the differences from the previous version (added, modified, removed).
   - Unchanged and modified items keep their requirement ID.
   - Links to scenarios and test cases, and "no test needed" decisions, carry over to the new version.
   - Test cases linked to modified or removed items are flagged for regeneration.
8. **Coverage:** an item counts as covered when a scenario or test case is linked to it. Otherwise it needs a reason-backed "Informational – no test needed" mark, or a QA Lead acknowledgement. The phase is complete only when no item is unmapped.
9. **RTM:** Requirement → Scenarios → Test cases → Execution status → Defects, always up to date, with Excel and CSV export.

## Test artefacts (Phase 3)

All artefacts are on the **Test Artefacts** screen. Every one can be edited and goes through **Approve / Reject with comment** (QA Lead or Admin). Editing an approved item sends it back for review. Machine-generated items show *AI-generated – pending review* until a human approves them; this applies to rule-based output as well as Claude output. Every artefact exports to **Excel, PDF and Word**: one document model is rendered by ExcelJS, Chromium (PDF) and the `docx` library.

- **Clarification Log:** contains the ambiguity questions from Phase 2, plus conflicts and gaps that can be detected on request.
  - *Conflicts* are similar statements that disagree on a number or on polarity (must vs must not).
  - *Gaps* are things the document doesn't specify, such as lockout/unlock rules, session timeout, error messages, roles, upload limits, payment failure, notification failure, OTP validity, rounding and supported browsers.
  - When `ANTHROPIC_API_KEY` is set, Claude adds its own findings. Duplicates are never created.
  - Recording a client answer marks the question *Answered* and flags the linked test cases for regeneration.
- **Scenarios & test cases:** designed for every testable item that isn't covered yet. Each test case is tagged with its technique:
  - Equivalence partitioning, boundary value analysis (min-1 … max+1), decision table, state transition (e.g. lockout after N attempts), use case, error guessing, checklist (UI, WCAG 2.2 AA, OWASP), pairwise (browser × OS × device) and exploratory charters.
  - Non-functional items get matching test types: Load/Stress, Security, Accessibility, Compatibility, Localization, Usability.
  - An end-to-end scenario chains each module's main flow.
  - Each test case is marked Smoke, Sanity and/or Regression, which Phase 4 uses to run suites.
  - With Claude configured, Claude designs the cases and the rule-based generator covers any item Claude missed, so coverage is always complete.
- **Regeneration:** replaces flagged test cases that are machine-generated, not approved and not yet executed. Approved, executed or manually written cases stay flagged for a person to update.
- **Test Data Sheet:** synthetic values only:
  - e-mail addresses on example.com, fictional +1-555-01xx phone numbers, public test card numbers;
  - valid and invalid values, the six boundary values, special characters (including XSS and SQL-injection strings) and empty/null values;
  - one test account per role, with passwords never stored in the sheet.
  The Excel export has `TestData` and `Accounts` sheets for data-driven automation.
- **Test Plan (IEEE 829 / ISO 29119):** 23 sections filled in from project data: scope and out-of-scope items, modules, test types and techniques used, the RACI from the project team, entry/exit/suspension criteria, the defect life cycle with severity/priority/SLA definitions, risks from ambiguous items and open questions, and assumptions. Each section can be edited, and regenerating creates a new version.
- **Test Techniques Document:** explains every black-box, experience-based and white-box technique and every test type, and lists the test cases that use each one.

## Test execution (Phase 4)

### Demo application
`apps/demo` contains **ShopEasy Demo**, a small Express application with Login, Registration and Checkout pages. It implements [`apps/demo/docs/demo-srs.md`](apps/demo/docs/demo-srs.md) and has three **deliberate, documented bugs**:

| Bug | Requirement | Behaviour |
|---|---|---|
| BUG-1 | Lock the account after 3 failed attempts | Locks after 4 |
| BUG-2 | Password 8–16 characters | Accepts more than 16 |
| BUG-3 | Discount for orders *above* Rs. 5000 | Applies at exactly 5000 |

Set `DEMO_BUGS=0` to fix them. Session state is per browser context, so tests are isolated. The test account is `qapilot.tester@example.com` / `Demo!2345` (change it with `DEMO_TESTER_PASSWORD`).

**Try it end to end:**
1. `npm run dev:demo`
2. Create a project and upload `apps/demo/docs/demo-srs.md`. In **Test Artefacts**, generate and approve the test cases.
3. In **Test Execution → Environments**, add `http://localhost:4600` with a *Tester* account.
4. Click **Generate / update scripts**, then **▶ Run Test Cases**.

The run finds the three bugs through five failing test cases (state transition, equivalence partitioning, BVA, BVA, equivalence partitioning). Each failure comes with evidence.

### How it works
- **Environments:** application URL, type (QA/UAT/Staging…), browsers, viewport, module → path map, parallel workers, retries and timeout.
  - Test-account credentials are AES-256-GCM encrypted. You can write them but not read them back: responses show them masked.
- **Script generation:** turns approved automation-candidate test cases into a Playwright project. You can opt in to also include test cases still pending review.
  - First, the environment's pages are opened in a real browser to find the field labels (the "probe").
  - The project contains `playwright.config.ts`, a base Page Object, one Page Object per module, the Test Data Sheet as JSON (data-driven tests), an evidence fixture, a live-progress reporter, and one spec per test case.
  - Templates implement the test case's technique: equivalence partitioning and boundary values on the field, rule thresholds, state transitions (lockout), login, error guessing (empty form, script injection), UI/accessibility checks and responsive checks.
  - Anything that can't be automated generically becomes `test.fixme`, which is reported as **Skipped**, never as a false pass. With `ANTHROPIC_API_KEY` set, Claude writes those scripts using the probed page labels.
  - Scripts can be viewed and edited in the UI. Edited scripts are run exactly as saved and are never overwritten by regeneration.
- **Running:** choose Run all, Run selected, Run by module, Run by priority, Run smoke/sanity/regression suite, or Re-run failed. One run per project at a time.
  - Progress, the log and per-test results update live, and a run can be aborted.
  - The test case status is the worst result across all browsers.
- **Evidence on every failure:** screenshot at the point of failure, full-page screenshot, an annotated screenshot highlighting the element under test (or the outcome message), video, Playwright trace, console log and network log.
- **Manual execution:** a guided screen to mark each step Pass/Fail/Blocked/Skipped, record actual results and attach screenshots. It updates the test case and the run history.

### Security notes for execution
- Playwright runs as a child process with an **allowlisted environment**, so the API's own `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` and `ANTHROPIC_API_KEY` never reach test code. Test credentials are passed in through `QAPILOT_CREDENTIALS` and are never written to disk.
- Typed passwords are **redacted** before anything is stored: step titles, errors, run logs, console/network logs, and every file inside the trace archive, including form bodies in plain, URL-encoded and form-encoded variants. Screenshots and video show password fields masked.
- **Running scripts executes code on the server.** Anyone with the `execution.run` permission (Admin, QA Lead, Tester) can edit and run scripts. In production, run QA Pilot in an isolated container (see Docker) with only the network access the application under test needs.

## Security and compliance features (Phase 1)

- **Audit trail:** every create, update, delete, login, failed login and export is recorded with before/after snapshots. Secret-looking fields are redacted.
- **Passwords:** bcrypt (cost 12) with a password policy. Login is rate-limited, and the error message is the same for an unknown user and a wrong password.
- **Encryption:** project secrets are encrypted with AES-256-GCM and the API only returns them masked.
- **Hardening:** Helmet headers, strict DTO validation (unknown fields rejected) and project-scoped authorization on every `/projects/:projectId/*` route.
- **Backup:** full project export as JSON.
- **Accessibility:** labelled controls, visible focus, a skip link, `role="alert"` on errors, and reduced-motion support (working towards WCAG 2.2 AA).

## Repository layout

```
apps/api     NestJS API (src/<module>), Prisma schema + seed, Jest tests
apps/web     React app (src/pages, src/components, src/lib)
docker-compose.yml
```
