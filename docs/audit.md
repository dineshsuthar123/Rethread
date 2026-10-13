# Rethread source audit

Audited 2026-10-13. `git fetch origin` confirmed both local HEAD and
`origin/main` at `5ef799bdd45024a6b2d93d65b884272e93f1eae8`.
Implementation branch: `rethread/implementation`. No applicable AGENTS.md was
found in the repository or its ancestors. User-owned, untracked `contents/`
and `test-repo-*` directories are preserved.

## Observed entry points and runtime

- Vite builds `frontend/index.html`, whose module is `script.js`. The React
  `src/main.jsx` application is disconnected from that entry. `frontend1/`
  duplicates the frontend. Two local Vercel links refer to different projects;
  their current deployments and account access still require inspection.
- `backend/server.js` serves Express and optionally frontend/dist. `/analyze`
  launches work in the HTTP process, clones a repository, invokes Python,
  calculates a score, commits, and pushes. Publication is not an approved PR
  operation. Status/results read a process-local Map with SSE connections.
- `agent/agent.py` runs a repair loop. `sandbox_runner.py` also executes target
  tools on the host and mutates them with Ruff unsafe fixes before capture.
  The root service image does not supply an isolated execution provider.
- `webhook/webhook.js` dispatches a separate assisted-review Actions workflow.
  `call_llm.py` combines local static/test/mutation gates, Supabase budget
  reservation, the original repair adapter, and an LLM critique. Its useful
  bounded-budget and logging concepts will be retained in one orchestrator.
- `supabase/setup.sql` already defines budget/usage tables, restricted roles,
  RPCs and RLS. It is not a complete Case/job database. No live data has been
  inspected or modified.

## Verified defects

The built page has a different identity from the React source. Work is lost on
API restart. Status endpoints do not enforce tenant ownership or persisted
event cursors. Repository validation uses a hostname substring. Git credentials
are embedded in remote URLs, with an automatic fork and force-push fallback.
Patch application accepts fuzzy replacements and unconstrained model paths.
The review workflow runs target dependency installation alongside privileged
secrets and interpolates dispatch inputs into scripts. Tracked Python bytecode,
multiple deployment configurations, scoring and event-specific form fields
remain in the tree.

## Baseline and available resources

`python -m pytest agent/tests infrastructure/tests -q`: **59 passed**, 0.46s.
Existing test coverage includes parsers, patching, naming and scoring; neither
frontend nor backend declares a test script. Node 22.17.0 and Python 3.14.6
are available. PostgreSQL 18 is running locally; database authentication has
not yet been verified. Docker CLI exists but its Linux daemon is unavailable.
GitHub CLI is authenticated as `dineshsuthar123`. Existing deployment config
references `rift-cicd.vercel.app` and `rift-cicd-agent.onrender.com`; these are
configuration references, not verified live resources. No Render, E2B or
GitHub App credentials have been identified. Existing local LLM/PAT settings
will be inspected privately; values will never be logged or committed.

The supplied Return Stitch SVGs, outlined wordmarks and font attribution are
the identity source. The board's examples are illustrative, not test evidence.

## Risks requiring verification

Account access, current services, paid entitlements, private repository/App
installation permissions and sandbox network enforcement must be checked.
Provider login and database credentials are deployment dependencies. Existing
Supabase data requires backup and a deliberate import; it must not be dropped.
Actual same-origin session cookies, bounded event delivery, dependency recipes,
worker recovery and GitHub publish reconciliation require integration tests.
The available Docker daemon must be started or image checks recorded blocked.

## Implementation sequence

1. Establish versioned contracts, Case transitions, PostgreSQL migrations,
   tenant-qualified relations, durable jobs/events/artifacts and budget ledger.
2. Replace the API with TypeScript sessions, GitHub App control, scoped Case
   endpoints, approval, idempotent publisher and durable webhook/preflight.
3. Consolidate the Python agent into fenced orchestration, exact patch policy,
   bounded LLM planning and isolated E2B execution, with no host fallback.
4. Replace the canonical frontend with the branded React/TypeScript router,
   directed intro, interactive labeled fixture and API-backed Studio.
5. Exercise security/durability outcomes and the Python repair/guard fixture;
   inspect responsive screenshots and motion/keyboard/reconnect journeys.
6. Consolidate deployment, inspect/reuse authorized resources, migrate and
   deploy the branch without new billing commitments; run live acceptance
   where credentials permit and document each precise blocked dependency.

Progress and measured results are recorded in `docs/progress.md` and
`docs/acceptance.md`. This audit will be updated after the replacements land.
