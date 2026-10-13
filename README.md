# Rethread

**Fix the failure. Keep the lesson.**

Rethread turns an executable Python failure into a pinned Case: source snapshot,
reproduction, focused candidate, independent verification, and a retained guard.
A later pull request reruns the guard and links a recurrence to its original Case.

The Return Stitch identity comes from the supplied brand kit. The canonical
React/TypeScript frontend includes a skippable introduction, a clearly labeled
interactive example, and a Case-centered Studio with readable Failure / Repair /
Guard stages, evidence, repository memory and light/dark themes.

## Current release scope

Python with pytest and Ruff is exercised with a controlled duplicate-webhook
fixture. The repair uses one transaction for the event claim and durable outbox
insert. Tests demonstrate base failure, candidate success and guard recurrence.
Hosted production integration remains gated on real GitHub App, database,
sandbox and LLM credentials; local emulators are not live provider evidence.
Unsupported repositories and incomplete reproductions receive explicit outcomes.

The owner requires **free-only hosting**. The existing Vercel frontend and Render
free API are reused. A trusted GitHub Actions batch worker controls E2B sandboxes;
jobs/checkpoints/events will persist in the owner's existing Supabase Free
PostgreSQL after private connection setup and migration.
Cold starts, queue delays and provider quotas apply. E2B credits are one-time,
not unlimited free execution. Paid infrastructure and paid LLM/sandbox usage
are disabled. [Hosting boundaries](docs/free-hosting.md).

## One workspace

- `frontend/`: React, Vite, TypeScript router, supplied vector identity, self-hosted fonts.
- `backend/`: Express/TypeScript control API, encrypted sessions, scoped access,
  raw-body webhook HMAC, durable job wakeup, proposal approval and artifact export.
- `agent/rethread/`: Python trusted worker, strict candidate policy, planner,
  E2B provider, fenced queue, credit/budget ledger, publisher and guard preflight.
- `contracts/`, `migrations/`: versioned contracts and additive PostgreSQL schema.
- `tests/`: controlled fixtures, security/durability tests and Playwright journeys.
- `deploy/`, `render.yaml`, `vercel.json`: documented startup and free hosting.

Target code never runs on the API/worker host. There is no automatic fork,
force-push, auto-merge or credential-bearing remote. A verified proposal still
requires owner approval before a separate idempotent draft-PR operation.

## Local development

Use Node 22+ and Python 3.12 through 3.14. Start a disposable PostgreSQL database for
integration tests. Configure private settings in `.env.rethread.local`, using
`.env.example` as the variable catalog. Never commit values or put them in chat.

```sh
npm ci
uv sync --frozen
npm run build
npm run migrate
npm run dev -w backend
npm run dev -w frontend
```

Local worker: `uv run --env-file .env.rethread.worker.local python -m agent.rethread.worker`.
That ignored file uses the restricted worker database login and provider keys,
as described in the deployment runbook.
No integration credentials are needed to explore `/studio/cases/example`.

```sh
npm run typecheck
npm test
uv run ruff check agent/rethread tests/python
uv run pytest -q
npx playwright install chromium
npm run test:e2e
npm audit
```

Database tests require `DATABASE_URL` pointing to an explicitly disposable
`*_test` database. [Acceptance evidence](docs/acceptance.md),
[deployment](docs/deployment.md), [operations](docs/operations.md),
[security boundaries](docs/security-boundaries.md), [source audit](docs/audit.md).

## Attribution

Original repository/backend contribution: Dinesh Suthar, with contributors
preserved in Git history. Return Stitch assets and outlined DejaVu wordmarks
are retained with their supplied notice. Space Grotesk, Inter and IBM Plex Mono
are self-hosted with font licenses under `frontend/public/licenses/`. Third-party
package licenses remain applicable. No company history, customer statistics or
universal bug-prevention claims are made.
