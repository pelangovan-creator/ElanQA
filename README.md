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
| 2 | Requirement upload/parsing, zero-miss extraction, coverage, RTM | ⏳ Next |
| 3 | Clarifications, scenarios, test cases, techniques, test plan, test data + review workflow + exports | |
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

API integration tests run against a throwaway SQLite DB (`apps/api/prisma/test.db`) that is recreated on every run.

## Environment variables

See [`.env.example`](.env.example). Nothing secret is hard-coded, and the API refuses to start without a strong `JWT_SECRET` and a 32-byte `ENCRYPTION_KEY`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma connection (`file:./dev.db` or a `postgresql://` URL) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Session tokens |
| `ENCRYPTION_KEY` | AES-256-GCM key for credentials, API tokens and webhooks stored in the DB |
| `CORS_ORIGIN` | Allowed web origins |
| `STORAGE_DIR` | Uploaded documents, screenshots, videos, traces |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Optional AI layer |
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
