# Acceptance evidence

Initial evidence 2026-10-13 UTC; provider setup update 2026-10-14. **The hosted repair release is incomplete.** The
frontend and existing free API are deployed; actual DB/worker/E2B/LLM and user-login
acceptance remain blocked. App authentication and control installation access
are now verified. No paid plan, worker, database, top-up
or payment method was created. The owner selected existing Supabase Free.

## Source and deployed resources

- Repository: [dineshsuthar123/Rethread](https://github.com/dineshsuthar123/Rethread),
  ID `1161587671`, renamed from Rift; old URL redirects.
- Branch: `rethread/implementation`. Main remains
  `5ef799bdd45024a6b2d93d65b884272e93f1eae8`; no merge or force push.
- Frontend/worker source: `9f53fc36d9ae2491c484770146e7a0b3aa6e970a`.
  API readiness fix source: `ecfb3a47c9afe4bb487405fe657607bc65dde874`.
  Later documentation/artifact commits do not change either runtime.
- Vercel reused project `prj_y6qMBdujlnf4ELf7fZLiyJMirzd5`, display name
  `rethread`, workspace `team_z2VLeehZ3vv2r2hEfSFKEH3a`.
  Deployment `dpl_CWP8yJgpMxWRVfzSsc9tTEg1hBRb`: **READY**, branch preview
  [rethread-fwq8gnrmi](https://rethread-fwq8gnrmi-dineshs-projects-231eafe3.vercel.app).
  Existing Vercel authentication protection remains enabled; account access is
  needed to open it. Authenticated CLI requests verified HTML at
  `/studio/cases/example` and the same-origin `/api/health` rewrite.
- Render reused service `srv-d6bpd7h4tr6s73cvs9og`, display name `rethread-api`,
  **free** plan, URL [API health](https://rift-cicd-agent.onrender.com/api/health).
  Initial latest-version deploy `dep-db76fnrl550s73au8tkg` became **live**;
  its health identified the exact `9f53fc3...` commit. Rollback/forward IDs are
  recorded below. API readiness-fix deploy `dep-db76jurrjlhs73a41a8g`
  became live. Current App/control-settings deploy `dep-db7ldle7bikc73ba5r2g`
  is **live**, and its health identifies `ecfb3a4...`.
- `render.yaml` passed the authenticated Blueprint validator with one existing
  free API action. It contains no paid worker/database. The unrelated existing
  Render database was left untouched.

The API returns genuine liveness. `/api/ready` correctly returns **503 blocked**
with database/worker/repairConfigured false, loginConfigured/appConfigured true
and an explicit database setup reason. Configuration presence does not establish
a completed user login. No fixture is stored as a hosted verified Case.

On 2026-10-14, the E2B key passed read-only sandbox inventory authentication
without creating a sandbox; it was stored as `RETHREAD_E2B_API_KEY` in Actions.
The Groq key/model were already authenticated and staged. A valid 32-byte
session encryption key was generated privately and configured on the existing
Render API with the verified frontend origin, FREE_ONLY and Actions worker mode.
No secret values were printed or committed. After the owner's corrections,
the App JWT authenticated (`GET /app` 200); its slug/client ID match, and
contents, pull requests, checks and Actions write permissions plus the
`pull_request` subscription were verified. Installation `171316286` includes
the control repository. The registered worker workflow is active. App keys and
webhook settings were staged privately, including TLS verification; control
dispatch settings and confirmed free-entitlement variables are configured.
Temporary inspection installation tokens were revoked after use. Actual login,
signed delivery persistence and worker dispatch still require the database.

The supplied Supabase direct URI resolves only to IPv6. Both ordinary resolution
and an explicit IPv6 connection failed from this workspace; verified-TLS
connection attempts timed out. `MIGRATION_DATABASE_URL` remains a placeholder.
The free shared Session pooler URI (5432) is required before read-only inspection,
backup and additive migration. No hosted data/schema was changed. Both free
entitlement flags are now confirmed, but sandbox credit allocation remains 0
and the template is absent. No template, inference or sandbox execution was
admitted under those settings.

## Prepared live fixture

Created [rethread-python-acceptance](https://github.com/dineshsuthar123/rethread-python-acceptance)
as the dedicated public, disposable repository for the authorized live journey.
Repository ID `1418721552`, base branch `acceptance-base`, pinned commit
`a4d9f37696a35131233937165069708c80135a42`. It contains the authored standard-library
SQLite fixture and original tests; no customer data or runtime secrets.
[Actions run 38548518554](https://github.com/dineshsuthar123/rethread-python-acceptance/actions/runs/38548518554)
completed with Ruff passing and pytest reporting **1 failed, 1 passed**:
`test_retry_delivery` observes two queued records instead of one. This is actual
GitHub CI evidence of the captured failure, not hosted Rethread or E2B acceptance.

The App inventory currently includes only Rethread. Adding the fixture with
the authenticated account returned 403: the workspace cannot modify this App's
installation selection. The owner must add the fixture in installation settings.
No repair branch, repair PR or recurrence branch has been created yet. Retain
fixture artifacts until the owner authorizes cleanup.

## Automated evidence

| Check | Observed result | Scope |
| --- | --- | --- |
| Original Python baseline | 59 passed | Existing agent/infrastructure tests before changes |
| Python suite | 78 passed | Parser, policy, controlled repair/guard, PostgreSQL durability, budgets, publication and free-only limits |
| Backend suite | 9 passed | URL validation, token encryption, scoped ownership, CSRF, durable cancellation/cursors, webhook/Case idempotency and honest DB-outage readiness |
| Playwright | 12 passed | Five widths, reduced motion, interrupted intro/routes, browser Back, keyboard/dialog/tabs, expired session, controlled cursor reconnect/approval, recording, CSS 200% zoom |
| Typecheck/build/Ruff | Passed | All workspaces and current trusted Python source/tests |
| npm audit / pip-audit | No known vulnerabilities reported | Locked application dependencies at scan time |
| Docker API + worker | Built and started | Local trusted control processes, restricted test DB logins; no target execution on the host |
| Trivy image gates | Passed | HIGH/CRITICAL with fixes available; lower/unfixed findings are not a clean-security guarantee |
| Six forward migrations | Passed | Empty isolated PostgreSQL 18 test DB, then idempotent rerun/restore |

Latest API runtime CI: [run 38438794226](https://github.com/dineshsuthar123/Rethread/actions/runs/38438794226),
all three jobs successful (checks, API image, worker image).
Frontend/worker runtime [run 38437413073](https://github.com/dineshsuthar123/Rethread/actions/runs/38437413073)
also passed. The prior
[run 38436727018](https://github.com/dineshsuthar123/Rethread/actions/runs/38436727018)
also passed at `a6e5df20cd5917d168aee37f92af2ce962f320b4`.
Its [API](artifacts/sboms/rethread-api-sbom.json),
[worker](artifacts/sboms/rethread-worker-sbom.json) and local locked
[Python](artifacts/sboms/python-sbom.json) CycloneDX SBOMs are retained.
The evidence snapshot at `4fcd16b5421ed549152c1c9d3505e5280b13438c`
passed [push CI](https://github.com/dineshsuthar123/Rethread/actions/runs/38439947222)
and [draft-PR CI](https://github.com/dineshsuthar123/Rethread/actions/runs/38440061836).
Review [draft PR #3](https://github.com/dineshsuthar123/Rethread/pull/3); main is unchanged.

Earlier CI failures were real: Docker-driver SBOM attestation was unsupported,
then the API image contained vulnerable Debian perl and bundled npm packages.
SBOM generation was separated from image building; Debian security updates and
runtime package-manager removal fixed the scanner findings. No test or scan gate
was disabled to obtain these passes.

### Repair, safety and durability outcomes

The authored SQLite duplicate-delivery fixture executes pytest/Ruff and proves
base failure, candidate success, guard failure on base and success on candidate.
Claiming the event and inserting the durable outbox share one transaction.
Reintroducing the bug fails the retained guard. This is controlled fixture
evidence; the production E2B adapter has not run with real credentials.

Tests reject no-test/invalid reports, missing tools, timeouts, malformed plans,
misleading URLs, malicious archives/paths, protected-test/CI/config changes and
capability-bearing prompt output. PostgreSQL integration tests prove one leased
job under competing workers, stale-fence denial, persisted checkpoints,
cancellation, retry exhaustion with honest Case state, retained verified
proposals and concurrent budget limits. Controlled GitHub publication tests
prove a timeout after PR creation reconciles one PR and a fresh-head mismatch
performs no publication writes. API ownership tests deny cross-tenant reads,
events, exports, cancellation, approval and publication.

Actual E2B metadata/internal HTTP denial, target secret absence, remote sandbox
termination on cancellation and live GitHub publication remain release gates.
Local adapters cannot establish those provider boundaries.

## Visual and performance evidence

Inspected marketing and Studio screenshots at 360, 390, 768, 1024 and 1440 pixels,
plus CSS 200% zoom and 16/24/32 pixel identity. No horizontal overflow was found;
the final narrow Studio capture hides the skip control until keyboard focus.
Review [marketing](artifacts/marketing-1440.png),
[mobile Studio](artifacts/studio-390.png), [desktop Studio](artifacts/studio-1440.png),
[zoom](artifacts/zoom-200.png), [small identity](artifacts/identity-small.png), and
[intro/route/replay recording](artifacts/intro-case-replay.webm).
These captures use the clearly labeled interactive example, not live repairs.

Local production-preview Lighthouse 12.8.2, default simulated mobile
throttling, fresh navigation, Node 22.17.0, at source `a6e5df2...`:

| Route | Performance | Automated accessibility | LCP | CLS | TBT |
| --- | ---: | ---: | ---: | ---: | ---: |
| Marketing `/` | 91 | 100 | 2.76 s | 0.0087 | 9.5 ms |
| Studio example | 97 | 100 | 2.27 s | 0.0239 | 0 ms |

Reports: [marketing lab](artifacts/lighthouse-marketing.json),
[Studio lab](artifacts/lighthouse-studio.json). An earlier marketing repeat was
2.75 s LCP/0.0087 CLS. Marketing is above the 2.5 s aim in this lab. These are
local measurements, not hosted field percentiles or measured INP; TBT is not
INP. Automated accessibility does not replace screen-reader/manual review.
Native browser surfaces were unavailable, so browser automation and screenshots
were used. Core JS is about 103.1 kB gzip, CSS 7.4 kB, HTML 0.5 kB; modern font
files total about 89.2 kB. The core shell stays below 250 KiB before the optional
27.6 kB gzip GSAP chunk. No WebGL dependency is required.

## Backup, migration and rollback scope

An isolated local cluster at `127.0.0.1:55432` holds `rethread_test`; it does not
touch the machine's pre-existing database service. `pg_dump -Fc` and `pg_restore
--no-owner --no-acl` restored into `rethread_restore_final_test`. The read-only
`deploy/verify_restore.py` matched all 24 tables, including 49 Cases, 83 events,
six migration checksums and one gzip artifact. Cursor continuity and artifact
SHA-256 passed. Dumps/row contents stay ignored and private.

On the restored database, an intentionally invalid migration transaction
created a probe table then failed. Both the table and migration record rolled
back; the six normal migrations reran successfully. No destructive down
migration or production database rollback was performed. Restricted API startup reports
database=true but configured worker/App=false; the restricted Docker worker
starts, announces capabilities and exits normally when the queue is idle.
The final API image also starts without a DB URL and returns explicit 503
blocked readiness. Local image IDs from `docker image inspect`:
API `sha256:42d59e7e70c4e91e6d43bf952c48839601cb9c65a52ce1acfd4284a8c340f22e`;
worker `sha256:91c9565e13fe4e920fb3d16b16c9049bd41a6d4d255b57d1c73504d486804a8e`.

Render rollback was tested by redeploying the preceding scanner-passed
`a6e5df2...` implementation commit, deploy `dep-db76hjvf3r2c73dchol0`, after the
`9f53fc3...` deployment. The rollback reached live and `/api/health` identified
`a6e5df2...`. Forward restoration `dep-db76io0u01pc73cei950` reached live and
health identified `9f53fc3...`; the subsequent readiness fix is also live.
This tests provider image/commit deployment and liveness only: the hosted database was
unconfigured, so hosted job reconciliation/data recovery could not be tested.
Lease/checkpoint/terminal-outcome reconciliation is covered by local PostgreSQL
tests. Vercel production-alias rollback and Supabase hosted backup/PITR were
not exercised. Never roll back to the removed privileged legacy runtime.

## Concrete release blockers and owner steps

| Blocked action | Resource | Minimal private owner setup |
| --- | --- | --- |
| Inspect/backup/migrate persistent data; connect API/worker | Existing Supabase Free project | Copy the actual free Session pooler URI on 5432 from Dashboard Connect into private MIGRATION_DATABASE_URL; direct IPv6 times out. After backup, create restricted runtime logins as deployment.md specifies |
| Actual user sign-in and signed webhook persistence | Rethread GitHub App/API | App credentials/permissions/control installation are verified and staged; connect migrated database, then exercise the actual callback and delivery path |
| Run the durable trusted worker | Rethread Actions review.yml | Provider keys and free variables are staged; worker DB URL and validated E2B template remain required before dispatch |
| Build template and exercise isolation/cancellation | E2B Hobby | Entitlement confirmed, key authenticated; allocate a positive bounded amount within verified remaining free credits, with billing/top-ups disabled |
| Generate a real bounded candidate | Groq free tier | Key/model authenticated and staged, entitlement confirmed; replay and credit dependencies must pass before inference |
| Hosted failure -> approval -> one draft PR -> later recurrence | rethread-python-acceptance | Add repository 1418721552 to installation 171316286 in GitHub settings; workspace installation modification returned 403. Complete the preceding dependencies |

Use ignored private environment files or provider settings; never put secrets
in chat, VITE variables, commits or build arguments. [Deployment](deployment.md)
defines the exact callbacks, permissions, connections and commands;
[operations](operations.md) defines revocation, retention/export, investigation
and recovery. No real target PR or sandbox has been created under missing
credentials. The demo remains explicitly labeled.

The original always-on architecture cannot be delivered under the owner's
free-only constraint. The implemented Actions batches/Render cold starts and
one-time sandbox credits have finite availability/quotas. No paid substitute,
host sandbox fallback, fake completion, auto-merge or default-branch change
was used.
