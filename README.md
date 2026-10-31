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
| 3 | Clarifications, scenarios, test cases, techniques, test plan, test data + review workflow + exports | ⏳ Next |
| 4 | Playwright script generation, Run Test Cases, execution screens | |
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
