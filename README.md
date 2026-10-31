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
| 5 | Auto-defects with screenshots/attachments, defect management | ✅ Done |
| 6 | Jira: manual step-by-step guide with illustrated screens (no Jira connection, by decision) | ✅ Done |
| 7 | Morning/evening defect monitoring (in-app delivery) | ✅ Done |
| 8 | DSR, WSR, Defect Report, Dashboard | ✅ Done |
| 9 | Test Closure Report with risk highlighting | ✅ Done |
| 10 | Hardening, tests, README, Docker | ✅ Done |

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

Open http://localhost:5173. Playwright's Chromium is needed for test runs and PDF exports; if it is not installed yet, run `npx playwright install --with-deps chromium` in `apps/api`.

| Seeded account (development) | Password | Role |
|---|---|---|
| admin@qapilot.local | `SEED_ADMIN_PASSWORD` (default `ChangeMe!123`) | Admin |
| lead@qapilot.local | Demo!2345 | QA Lead |
| tester@qapilot.local | Demo!2345 | Tester |
| dev@qapilot.local | Demo!2345 | Developer |
| client@qapilot.local | Demo!2345 | Client (view-only) |

The demo users exist only in development (or with `SEED_DEMO_USERS=true`). Change every password before you use the app with real data. Each user can do this under **My account** (click your name at the top right).

## Run with Docker (PostgreSQL)

```bash
cp .env.example .env
# In .env set JWT_SECRET and ENCRYPTION_KEY (openssl rand -hex 32 each),
# SEED_ADMIN_PASSWORD (12+ characters) and POSTGRES_PASSWORD
docker compose up --build -d              # http://localhost:8080
docker compose --profile demo up -d       # optional: also the ShopEasy demo app
```

| Service | What it is |
|---|---|
| `db` | PostgreSQL 16, data in the `pgdata` volume |
| `api` | NestJS API on the official Playwright image, so test runs and PDF exports have Chromium, Firefox and WebKit. It runs as a non-root user and has a health check. On start it applies the schema (generated from the SQLite dev schema), creates the first Admin if there is none, and starts the scheduler. Uploaded files and evidence live in the `storage` volume. |
| `web` | nginx serving the built React app on port `WEB_PORT` (8080), proxying `/api`. It sets security headers (Content-Security-Policy, X-Frame-Options, nosniff) and caches hashed assets for a year. |
| `demo` | Optional (`--profile demo`). In QA Pilot use **`http://demo:4600`** as the environment URL: tests run inside the `api` container, which reaches the demo by its service name. From your browser it is at `http://localhost:4600` (`DEMO_PORT`). |

The API refuses to start in production with a SQLite `DATABASE_URL`, a `*` CORS origin, or a weak `JWT_SECRET`/`ENCRYPTION_KEY`. It also refuses to create the first Admin with the example password. Demo users are not created in Docker.

**Backups of the whole server:** back up the `pgdata` and `storage` volumes together, for example `docker compose exec db pg_dump -U qapilot qapilot > qapilot.sql` plus a copy of the storage volume. For a single project, use the in-app backup (below).

**Building behind a TLS-inspecting proxy:** if `npm ci` fails with certificate errors during `docker build`, pass the proxy's CA as a build secret: `docker build --secret id=npm_ca,src=/path/to/ca.pem -f apps/api/Dockerfile .` (it is used only while installing packages and is not stored in the image).

## Tests

```bash
npm test                  # API (Jest + Supertest), web (Vitest + Testing Library) and demo app tests
npm run typecheck
```

| Suite | Covers |
|---|---|
| `apps/api/src/**/*.spec.ts` | Unit tests: parsing, classification, coverage, generators, export engine, risk matrix, clock |
| `apps/api/test/*.e2e.spec.ts` | Integration tests through HTTP for every module: auth/RBAC, requirements, artefacts, execution (real Playwright runs against the demo app), defects, monitoring, reports, closure, **security** (lockout, token revocation, forged tokens, upload sniffing) and **backup/restore** |
| `apps/web/src/**/*.test.tsx` | UI components and pages |
| `apps/demo/server.test.js` | Demo app, including its deliberate bugs |

The API integration tests run against a throwaway SQLite DB (`apps/api/prisma/test.db`) and storage folder (`apps/api/test-storage`), both recreated on every run. The API test script sets `NODE_OPTIONS=--experimental-vm-modules`, which the PDF library needs under Jest. GitHub Actions (`.github/workflows/ci.yml`) runs the type checks and all tests, and builds the three Docker images, on every pull request.

The sample requirement documents in `apps/api/test/fixtures` are synthetic and are produced by `python3 apps/api/scripts/make-fixtures.py`. To see how any file is split, run:

```bash
cd apps/api && npx ts-node --transpile-only -P tsconfig.json scripts/try-parse.ts srs-v1.docx
```

### Accessibility and performance audit

`apps/web/scripts/audit.mjs` signs in, opens every screen at desktop (1366 px) and phone (390 px) width, and for each one:
- times the load;
- runs axe-core with the WCAG 2.0/2.1/2.2 A and AA rules;
- checks for sideways scrolling and console errors.

It fails if any page has a problem or takes longer than 2 s. To test with a realistic data volume, first create a large synthetic project (1,000 requirements, 3,000 test cases, 3,000 results and 600 defects; `VOLUME_SCALE=2` doubles it):

```bash
npm run seed:volume --workspace apps/api            # or: docker compose exec api npm run seed:volume
node apps/web/scripts/audit.mjs --base http://localhost:8080 --password '<admin password>' --project VOL
```

Result at the end of Phase 10, on the Docker stack (PostgreSQL), for the volume project and a real project with test runs:
- 56 page views;
- 0 axe violations, 0 console errors, no sideways scrolling;
- every page loaded in 0.6–1.1 s, including the 0.5 s network-idle wait.

## Environment variables

See [`.env.example`](.env.example). Nothing secret is hard-coded, and the API refuses to start without a strong `JWT_SECRET` and a 32-byte `ENCRYPTION_KEY`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma connection (`file:./dev.db` or a `postgresql://` URL; PostgreSQL is required in production) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Session tokens (HS256, default 8 h) |
| `ENCRYPTION_KEY` | AES-256-GCM key for credentials, API tokens and settings stored in the DB. Keep it safe: restoring a backup on another server needs the same key for encrypted values |
| `CORS_ORIGIN` | Allowed web origins (comma-separated, no `*` in production) |
| `STORAGE_DIR` | Uploaded documents, screenshots, videos, traces, run output |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First Admin, created once |
| `SEED_DEMO_USERS` | Create the demo users (default: development only) |
| `MAX_FAILED_LOGINS`, `LOCKOUT_MINUTES` | Account lockout (default 5 failures, 15 minutes) |
| `TRUST_PROXY` | Number of reverse-proxy hops to trust for the client IP (Docker sets 1) |
| `BACKUP_UPLOAD_MAX_MB`, `BACKUP_MAX_MB` | Largest backup accepted for restore (default 1 GB upload, 2 GB unpacked) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Optional AI layer (default model `claude-opus-5-5`) |
| `OCR_LANG`, `OCR_LANG_PATH` | OCR language (default `eng`, bundled) |
| `MONITOR_TIMEZONE`, `MONITOR_MORNING_TIME`, `MONITOR_EVENING_TIME` | Default check schedule (09:30 and 18:00 Asia/Kolkata); each project can change it |
| `MONITOR_SCHEDULER` | `false` stops the scheduler in this process (with several API replicas, keep it on in one) |
| `POSTGRES_PASSWORD`, `WEB_PORT`, `DEMO_PORT` | Docker Compose only |

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

## Defect management (Phase 5)

- **Automatic drafts:** after every run, each failed test case becomes one **draft defect**, with failures across browsers combined.
  - Every field in section 5.2 is filled in: module, requirement IDs, test case and run, environment, build, browser/viewport/OS, pre-conditions, steps to reproduce, test data, expected and actual result, severity, priority and defect type.
  - The actual result is rewritten from Playwright's assertion output into a sentence, e.g. *Expected the page to show text matching /locked/i – it showed: "Invalid email or password."*
  - All the run's evidence is attached: screenshot at failure, full-page and annotated screenshots, video, trace (passwords redacted), console log and network log.
  - Drafts stay out of the defect list until someone reviews them.
- **Duplicates:**
  - Similar defects in the same module are suggested on the draft, so you can choose **Link to DEF-x instead**. The evidence and a "reproduced in RUN-x" note move to the existing defect, and the draft is kept as *Duplicate*.
  - A test case that fails again while its defect is still open updates that defect instead of creating a new draft.
- **Screenshot is mandatory:** a draft can be confirmed only if it has at least one screenshot. Manual failures can attach one on the defect.
- **Life cycle:** New → Open → Assigned → In Progress → Fixed → Ready for Retest → Retest → Verified → Closed, plus Reopened, Deferred, Rejected, Duplicate and Not a Bug. Rules are enforced on the server:
  - Assigning needs an assignee.
  - Rejected, Not a Bug, Deferred and Reopened need a comment.
  - Fixed needs a root cause.
  - Duplicate needs the original defect.
  - Developers can only move a defect to In Progress, Fixed or Ready for Retest, and can only edit root cause, fix version and target date. Verification and closing belong to QA. Clients can view only.
- **Automatic retest:** in a later run, a passing test verifies its defect if that defect is *Ready for Retest* or in *Retest*, and a failing test reopens it.
- **History:** every field change, status change and comment is recorded, as well as the audit trail. Defect age is shown in days.
- **Severity and priority definitions:** shown as keyboard-accessible tooltips on every badge, under each dropdown, and in a definitions panel.
- **Exports:**
  - A single defect report in PDF/Word with the screenshots embedded, or in Excel.
  - The defect list in Excel/PDF/Word with every field and open Blocker/Critical/P1 defects highlighted in red.
- Set the project setting `defects.autoCreate` to `false` to turn off automatic drafts.

## Jira (Phase 6) – manual guide, no connection

By decision, **QA Pilot does not connect to Jira**: there is no API call, no stored Jira credentials and no "Push to Jira". Instead, every confirmed defect has a one-click **Create in Jira – step-by-step guide**. It shows the 11 steps of section 6.1, and each step has:

- the instruction;
- this defect's own values, with **Copy** buttons:
  - Summary;
  - a prepared Description (pre-conditions, steps to reproduce, expected/actual result, environment, build, browser/device, test data, severity and references);
  - Priority, mapped P1→Highest, P2→High, P3→Medium, P4→Low;
  - Severity, Component, Affects Version, Labels, Assignee, and the requirement to link;
- an **illustrated screen** of a generic issue form, filled with the defect's values, with the field to use outlined in red and the step number in a callout. These are illustrations, not real Jira screenshots: they carry no Atlassian branding and are labelled as such.

Also available with one click:
- **Download evidence (ZIP):** all screenshots, the video, the trace and the logs, ready to drag into Jira (step 9).
- **Guide as PDF / Word:** the whole guide with all 11 illustrations, for sharing or printing.
- **Save the Jira key** (and optional link) back on the defect (step 11). The key is validated (`PROJ-123`, `https://` links only), searchable in the defect list, shown on the defect and in exports, and recorded in its history.

## Defect monitoring (Phase 7)

- **When:** checks run **twice a day** for every active project, by default **09:30 and 18:00 Asia/Kolkata**. Each project can change the times, time zone, SLA hours and ageing threshold on the **Defect Monitoring** page (QA Lead/Admin). A QA Lead can also run a check at any time.
- **What a check produces:** a **Defect Alert Summary**.
  - Every open **Blocker, Critical and P1** defect, highlighted in **red and bold**, with ID, title, severity, priority, status, assignee, age, last update, SLA due time and whether the SLA is breached. SLA hours per priority default to P1 24h, P2 7 days, P3 30 days, P4 90 days.
  - Changes since the last check: new defects (including confirmed drafts), reopened, closed.
  - Defects pending retest, ageing high-impact defects (more than 3 days by default), drafts waiting for review, and open counts by severity and priority.
- **Where it appears:** the Monitoring page (with the full history of morning, evening and manual checks), an alert card on the Overview, and a red count badge on **Defect Monitoring** in the menu. Every check exports to Excel/PDF/Word. Email, Slack and Teams delivery are **not enabled**, by decision.
- **Scheduler:** built in, with no extra dependency.
  - It wakes every minute and checks each project's local time.
  - A slot runs **once per day**; a database unique constraint enforces this even with several API instances.
  - A check missed while the server was down is **caught up within 3 hours** and marked *late*.

## Reports & dashboard (Phase 8)

**Reports & Dashboard** has four tabs.

- **Dashboard:** live KPI tiles (requirement coverage %, execution %, pass %, open defects, a red **Blocker/Critical/P1** count, drafts to review). Charts: test case status, RTM execution status, open defects by severity and by priority, the burn-down of test cases not yet executed (with an ideal line), and defects opened vs closed per day. Time range 7, 14, 30 or 90 days; refreshes every minute.
- **Daily Status Report (DSR), Weekly Status Report (WSR) and Defect Report:** generated for a date or period in the project's time zone, with every field from sections 8.1–8.3 filled in from project data.
  - **DSR:** execution summary (today and to date), defect summary (new, open, closed, reopened, by severity and priority), the Blocker/Critical/P1 list in red, tasks completed and planned, tester-wise progress, blockers, risks, open clarification questions, environment downtime and comments.
  - **WSR:** a suggested **RAG** status with its reason, planned vs actual, coverage, design progress (created/reviewed/approved), weekly execution trend, opened-vs-closed trend, burn-down, defects by severity and module, defect density per module, ageing, risks, accomplishments, next week's plan, milestones, escalations, resource utilisation and client action items.
  - **Defect Report:** totals by severity, priority, status, module, assignee and type; ageing buckets (0–2, 3–5, 6–10, >10 days); reopen and rejection rates; **defect leakage** once you enter the UAT/production defect counts; trend chart; the full defect list. Screenshots are embedded in the PDF/Word export.
- **Editing:** reports are **editable while in Draft** (header, narrative and inputs). **Refresh data** re-pulls the numbers but keeps your edits. Status moves Draft → Final → Sent; a Final report can go back to Draft, and a Sent report is locked.
- **Exports:** **PDF, Excel and Word** (charts embedded as images, high-impact rows in red), plus an **e-mail draft (.eml)** containing an HTML summary with the PDF attached. You open it in your own mail program, add recipients and send. QA Pilot sends nothing itself.
- **Charts:** dependency-free SVG, shown inline with a tooltip on every mark and a text "Data" view for screen readers. Colours were checked with a palette validator: blue/orange for two series, one blue ramp for ordered categories, fixed status colours for pass/fail/blocked, always with labels.

## Test closure (Phase 9)

- **Triggers:** the **Test Closure** page checks the conditions live:
  - **(a) all defects closed**;
  - **(b) all Blocker, Critical and P1 defects closed**;
  - **(c) closure requested by the client.** The QA Lead can always choose this, but must give a reason.
  For (a) and (b), unreviewed draft defects, *Deferred* and *Verified-but-not-closed* defects count as open.
- **Open-defect risk assessment:** every defect still open (drafts included) gets a row with business impact, likelihood, a **risk level** from the impact × likelihood matrix, workaround, mitigation/recommendation and owner. Rows are pre-filled from severity, priority and assignee, and editable. The report and every export lead with a prominent banner: *N defect(s) remain OPEN – M High risk*. High risks are red, Medium amber.
- **Recommendation:** QA Pilot suggests **Go / Conditional Go / No-Go** with a reason and conditions.
  - *No-Go:* an open Blocker, or a High risk without a workaround.
  - *Conditional Go:* open risks remain or exit criteria are unmet.
  - *Go:* everything is met.
  You can change the decision, but **Go is refused while a High risk is open**, and the original suggestion is always shown alongside your choice.
- **Report contents:** every field in section 9:
  - document control; objectives and scope (taken from the Test Plan);
  - test summary (planned/executed/passed/failed/blocked/not run) with charts;
  - coverage and the final RTM; test types and techniques; environments;
  - defect summary (severity, priority, status, module, reopen and rejection rates, density);
  - deviations; the **exit criteria check** (each criterion evaluated against the data as met or not met, with comments);
  - lessons learned, best practices, recommendations, known issues; deliverables; sign-off.
- **Workflow:** Draft (editable; refresh keeps edits) → **Final** (requires a workaround and owner for every open defect) → **sign-off** by QA Lead, Project Manager and Client. A Client user signs their own section under their own name; the QA Lead records the others. When all three have signed, the report is **Signed Off** and the project is marked **Closed**, unless someone rejected.
- **Exports:** PDF, Word and Excel (risk, exit criteria and sign-off sheets), plus an e-mail draft (.eml) whose subject carries the decision.

## Security and compliance

- **Audit trail:** every change is recorded with who, what, when, the client IP and before/after snapshots, including logins, failed logins, lockouts, exports, backups and restores. Secret-looking fields are redacted.
- **Passwords and sign-in:**
  - Passwords are hashed with bcrypt (cost 12) and must meet a password policy.
  - Sign-in is rate-limited per IP, and the error message is the same for an unknown user and a wrong password.
  - After 5 failed attempts in a row the account is locked for 15 minutes. The Users page shows locked accounts, and an Admin can reset the password, which also unlocks the account.
- **Sessions:** tokens are signed with HS256 only, and the API checks the user and their state on every request.
  - Changing a password signs out every other session.
  - Changing a user's role or deactivating them signs that user out everywhere.
  - Anyone can **Sign out everywhere** from My account.
- **Encryption:** project secrets and test credentials are encrypted with AES-256-GCM. The API only returns them masked, and passwords typed by tests are redacted from logs, step results and traces.
- **Uploads:** checked against an allow-list and against the file's real content, not the type the browser claims. A script or SVG disguised as a screenshot is refused. Stored files are served with `nosniff` and a sandbox Content-Security-Policy, and only genuine PNG, JPEG, GIF or WebP images display inline. Everything else downloads.
- **Hardening:**
  - Helmet and nginx security headers, including a Content-Security-Policy with no inline scripts.
  - Strict request validation (unknown fields are rejected) and project-scoped authorization on every `/projects/:projectId/*` route.
  - Test code runs with an allow-listed environment, so the API's own secrets never reach it.
  - The production configuration checks listed in the Docker section.
- **Accessibility (WCAG 2.2 AA):**
  - labelled controls, a visible focus indicator, a skip link, `role="alert"` on errors and reduced-motion support;
  - charts have data tables, and severity is shown with text as well as colour;
  - pages reflow to phone width without sideways scrolling;
  - checked with axe-core on every screen (see the audit above).
- **AI output:** every AI-generated artefact is marked "AI-generated – pending review" until a person approves it.

## Backup and restore (Phase 10)

- **Back up:** on a project's **Overview** page, Admins and QA Leads click **Export full project backup**. The download is one `.zip` containing:
  - `backup.json`: every project table (requirements and versions, RTM links, clarifications, scenarios, test cases, test data, artefacts and review history, environments, scripts, runs and results, defects with history, monitoring checks, reports, closure reports, ID counters and the project's audit trail), plus name, e-mail and role for the users it refers to (never password hashes);
  - `files/`: every stored file (original requirement documents, screenshots, videos, traces, run output) with a SHA-256 checksum for each.

  Encrypted settings and credentials stay encrypted.
- **Restore:** on the **Projects** page, click **Restore from backup**, choose the file and enter a new project key. The backup is restored as a **new project** and the original is never changed. During a restore:
  - every record gets a new ID, and the links between records are rebuilt;
  - team members are matched to accounts on this server by e-mail; people without an account are listed, and their work is attributed to whoever runs the restore;
  - encrypted values that this server's `ENCRYPTION_KEY` cannot read are dropped and listed so you can enter them again;
  - every file is checked against its checksum, and unsafe paths are refused;
  - the restore is all-or-nothing.
- A test fails if a database table is added without being included in the backup.

## Acceptance criteria (section 12)

| Criterion | Status | Where / how it is verified |
|---|---|---|
| Uploading a requirement document produces all artefacts in 3.1–3.6, with 100 % coverage shown or every gap acknowledged | ✅ | Requirements & RTM, Test Artefacts; `requirements.e2e`, `artefacts.e2e`. Rule-based generation covers every testable item. Items it considers non-testable are suggested as Informational, and the QA Lead accepts or acknowledges them. Analysis cannot be completed while any item is unmapped. |
| "Run Test Cases" executes against a given URL and shows results live | ✅ | Test Execution; `execution.e2e` runs real Playwright tests against the demo app. Verified in Docker against the demo container (24 tests in about 15 s). |
| Every failed test produces a defect with at least one screenshot | ✅ | Draft defects with screenshot, video, trace and logs; confirming a defect requires a screenshot. `defects.e2e`, plus the Docker check (5 of 5 failures). |
| Defects can be pushed to Jira (when configured) and manual Jira steps are displayed | ⚠️ By decision | At your request there is **no Jira connection** (no credentials, push or sync). Each defect has a one-click illustrated step-by-step guide to create the ticket by hand, and you can record the Jira key. |
| Morning and evening checks run on schedule and highlight Blocker/Critical/P1 | ✅ | Built-in time-zone-aware scheduler with catch-up after a restart; `monitoring.e2e`. Runs in Docker. |
| DSR, WSR, Defect Report and Test Closure Report generate with all fields and export to PDF/Excel/Word | ✅ | Reports & Dashboard, Test Closure; `reports.e2e`, `closure.e2e`. PDF rendering verified inside the Docker image. |
| Closure report highlights the risk of every open defect when closed early or on client request | ✅ | Test Closure; `closure.e2e`. |

## Repository layout

```
apps/api            NestJS API (src/<module>), Prisma schema + seed, scripts (fixtures, volume seed), Jest tests
apps/web            React app (src/pages, src/components, src/lib), scripts/audit.mjs, nginx config
apps/demo           ShopEasy demo application under test (deliberate bugs, DEMO_BUGS=0 fixes them)
docker-compose.yml  PostgreSQL + API + web (+ demo with --profile demo)
.github/workflows   CI: typecheck, tests, Docker builds
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| API exits with "Invalid configuration" | Set `JWT_SECRET` (32+ random characters) and `ENCRYPTION_KEY` (64 hex characters) in `.env`. |
| Docker API exits with "Refusing to create the first Admin…" | Set `SEED_ADMIN_PASSWORD` (12+ characters) in `.env`. |
| Test runs or PDF exports fail locally with "Executable doesn't exist" | Run `npx playwright install --with-deps chromium` in `apps/api`. Docker images already include the browsers. |
| Runs in Docker cannot reach `http://localhost:…` | Inside Docker, `localhost` is the API container. Use the service name (`http://demo:4600`) or `http://host.docker.internal:<port>`. |
| "Too many failed sign-in attempts" | Wait for the lockout to end, or ask an Admin to reset the password on the Users page. |
| Restore warns that settings or credentials were dropped | The backup came from a server with a different `ENCRYPTION_KEY`. Enter those values again. |
