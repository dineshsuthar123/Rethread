# Deployment runbook

Release status: free-only deployment; paid infrastructure is prohibited.
See free-hosting.md for the active architecture and quota boundaries. A frontend
preview is not a complete hosted repair service. Actual IDs/results are recorded
in acceptance.md after each verified deployment.

## Existing resources and authorization

- GitHub repository ID `1161587671`, renamed to
  `dineshsuthar123/Rethread`; the old URL redirects. Branch
  `rethread/implementation` is the deployment source. Do not merge main.
- Vercel project `prj_y6qMBdujlnf4ELf7fZLiyJMirzd5`, workspace
  `team_z2VLeehZ3vv2r2hEfSFKEH3a`, previously named `rift-cicd`.
  The other local `frontend` project link is not reused.
- Render API service `srv-d6bpd7h4tr6s73cvs9og`, renamed `rethread-api`,
  retained on its existing free plan. URL remains
  `https://rift-cicd-agent.onrender.com`. Its repository redirects to Rethread.
  The unrelated free database in the workspace is untouched.

## Private settings

Copy `.env.example` to the ignored `.env.rethread.local` for owner tooling.
Configure API secrets through Render and worker secrets through GitHub Actions.
No secrets go into Vercel VITE variables, image layers, build arguments or chat.
API loads this private local file; Python owner commands use
`uv run --env-file .env.rethread.local`. For a local worker, prepare an ignored
`.env.rethread.worker.local` containing the worker's `DATABASE_URL` and provider
keys, and use that file instead of the API login. Docker receives provider environment
variables at runtime. Free-only mode admits only owner-confirmed Groq free-tier
access; monetary ceilings remain zero. It never switches to a paid endpoint.
Confirm and allocate remaining E2B Hobby credits before allowing sandbox work.

API requires database runtime URL, session encryption key (32 random bytes,
base64), public frontend origin, GitHub App ID/private key/slug, GitHub App
client ID/client secret and webhook secret. Worker requires its own runtime DB
URL, App ID/private key, public origin, E2B key/template, LLM key/model and
budget limits. Deployment tooling additionally needs Render API access.
The migrator uses `MIGRATION_DATABASE_URL`, not either runtime login.

## Existing Supabase Free setup

The owner selected their existing Supabase Free project. Account access is
currently unavailable to this workspace: `supabase projects list` requires a
login, and the database fields in `.env.rethread.local` remain unconfigured.
Configure access privately, never through chat. This is the remaining database dependency.

1. In the existing project's dashboard, confirm the Free plan, inspect public
   tables/roles and take a backup before migration. Do not reset the project or
   change its existing RLS policies.
2. Obtain the connection strings from **Connect**. Use direct PostgreSQL for
   owner migrations/backups where IPv6 works. Use the free **Session pooler**
   on port 5432 for IPv4 runtime connections; no paid IPv4 add-on is needed.
   This implementation uses session state and prepared statements, so do not
   use the transaction pooler on 6543. See the official
   [connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. Put the owner URL in `MIGRATION_DATABASE_URL` privately. Run the six forward
   migrations and apply `deploy/roles.sql`. Create separate password-protected
   LOGIN roles granted `rethread_api` and `rethread_worker`; pooled usernames
   include the project reference. Validate each restricted role's access.
4. Put only the API runtime URL in Render `DATABASE_URL`, and only the worker
   runtime URL in Actions `RETHREAD_WORKER_DATABASE_URL`. Require verified TLS
   and supply the provider CA privately if the local trust store needs it.
5. Keep the `rethread` schema outside Supabase's exposed Data API schemas. The
   product uses its authenticated Express API; its new schema is not an RLS
   protected browser API. Existing public RLS definitions remain intact.
6. Test migration checksums, tenant denial, cursor replay, artifact export and
   restricted-role startup on the actual project before admitting real Cases.

Free Supabase does not supply the paid PITR entitlement. The owner must choose
and test a private manual backup destination and cadence within free storage
limits, following the official [backup guidance](https://supabase.com/docs/guides/platform/backups).
The local restore exercise is not a hosted backup or recovery promise.

GitHub App repository permissions: contents read/write, pull requests
read/write, checks read/write, Actions read, metadata read. Subscribe to
installation, installation_repositories and pull_request events. Install only
on selected authorized repositories. Set user callback to
`<verified-frontend-origin>/api/auth/callback` and webhook to the verified
Render API's `/api/webhooks/github`. Keep private keys out of sandboxes.

## Build, migrate, and run

```sh
npm ci
npm run build
uv sync --frozen
npm run migrate
docker build -f deploy/api.Dockerfile -t rethread-api:local .
docker build -f deploy/worker.Dockerfile -t rethread-worker:local .
uv run --env-file .env.rethread.local python deploy/build_template.py
```

Set the returned E2B template ID privately. `build_template.py` installs the
pinned pytest/Ruff evaluator. The trusted runner is root-owned under
`/opt/rethread`; repository source is writable only under `/workspace`.
Hashed binary-wheel dependencies install with registry-only egress. Test
network is then denied. Production HTTP-level isolation probes must pass;
SDK unit tests cannot establish this boundary.

Run forward migrations with the separate migrator; a PostgreSQL advisory lock
serializes them and checksums detect edited migrations. Apply `deploy/roles.sql`
as owner, create private LOGIN roles for each capability role, and use separate
API/worker URLs. Do not give either runtime schema ownership or BYPASSRLS.
Existing Supabase public tables remain untouched. Backup and inspect existing
usage data before any optional import; source tables and rollback copies remain.

API startup: `node backend/dist/server.js`. Worker startup:
`python -m agent.rethread.worker`. API pool 5; worker pool 3 by default.
Liveness `/api/health` identifies build. `/api/ready` requires DB, current worker
heartbeat and configured integrations; a health response is not integration
acceptance.

## Provider deployment

The active `render.yaml` contains only the existing free API service. It passed
Render's authenticated Blueprint validator after removing all paid resources.
Worker execution uses the trusted GitHub Actions workflow; persistent PostgreSQL
must come from an authorized free account. No paid infrastructure was created.
The API may sleep. Queue/checkpoints persist outside that process, and execution
waits for a successful Actions dispatch. This is a free-tier tradeoff, not an
always-on production claim. See free-hosting.md for the exact owner setup.

Deploy Vercel from the repository root. `vercel.json` builds the canonical
frontend workspace and outputs frontend/dist. It uses same-origin `/api`
rewrites, SPA fallback, self-hosted fonts and security headers. Replace the API
destination with the actual verified service URL before hosted acceptance.
Use a branch preview while main remains unchanged. Rebuild if the origin or
rewrites change. Verify Set-Cookie, callback, logout, CSRF and cursor polling
on the actual frontend hostname. Polling is deliberate: bounded responses
avoid depending on a long-lived proxy stream.

## Release gate

Use an explicitly disposable authorized repository for the live journey:
GitHub sign-in → selected installation/repo → pinned failure → E2B reproduction
→ candidate and unchanged suite → additive base-fail/candidate-pass guard →
owner approval → one draft PR → separate regression branch → failed retained
guard linked to the original Case. Record all created PRs/branches; do not
delete them without cleanup authorization. Until that journey and the
rollback/backup checks pass, the hosted repair release is incomplete.
