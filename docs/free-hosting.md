# Free-only hosting decision

The owner requires zero paid infrastructure. No plan upgrades, new billable
services or payment methods are authorized. This supersedes the original
always-on Render worker/database architecture. The rejected paid configuration
is not the active Blueprint.

| Component | Free deployment | Practical boundary |
| --- | --- | --- |
| Frontend | Existing Vercel project, renamed Rethread | Preview protection and Hobby quotas apply |
| API | Existing Render service, retained `free` plan | Sleeps/cold starts; no continuous-service guarantee |
| Durable jobs/data | Owner's existing Supabase Free PostgreSQL | Migrated and connected with restricted roles/verified TLS; quotas and pause behavior apply |
| Trusted worker | GitHub Actions standard Linux runner in this public repository | Event dispatch, queue delay, bounded batch, no always-on process |
| Target execution | E2B Hobby one-time credits | Stops at allocated credits; no paid top-up or host fallback |
| Planner | Owner-confirmed Groq free-tier key | Rate/token quota failures stay explicit; paid destinations blocked |

The database queue remains authoritative. A trigger writes a durable worker
wakeup after job insertion. The API dispatches only the trusted control
repository's registered `review.yml` path at the implementation ref. It never
dispatches arbitrary target code. The existing path lets the branch run without
merging main. Target source and dependency/test execution remain inside E2B.
The Actions worker drains at most two jobs, checkpoints each stage, and exits
when idle. Active jobs keep fenced leases; a later invocation recovers expiry.
Duplicate dispatches cannot duplicate a finalized job/PR.

Dispatch failures are retained in `worker_wakeups`; the next authenticated API
request retries after a cooldown. The owner can also run:

```sh
gh workflow run review.yml --repo dineshsuthar123/Rethread --ref rethread/implementation
```

There is no promise of unattended recovery while both the free API and Actions
worker are asleep. GitHub scheduled workflows require the default branch; main
has not been modified. A scheduled wakeup can be enabled only after the owner
separately approves the default-branch change. The UI keeps actual queued state
and never fabricates progress while waiting.

Configure a repository-scoped GitHub App installation on the trusted control
repository with Actions write and contents read for dispatch. Target access is
still repository-scoped installation tokens. Configure Actions secrets prefixed
`RETHREAD_` as listed in `.github/workflows/review.yml`. API `DATABASE_URL` and
worker `RETHREAD_WORKER_DATABASE_URL` use separate runtime logins. Forward
migrations use a separate owner/migrator URL.

E2B advertises $100 **one-time** Hobby credits with no card required, not free
unlimited execution. Confirm remaining credits privately and allocate only a
bounded portion through `SANDBOX_FREE_CREDIT_BUDGET_MICROS` (default 0 blocks
execution). Each create attempt conservatively charges its 300-second default
2-vCPU/4-GiB upper bound, including ambiguous errors. Do not enable paid billing
or automatic top-up. Shared account usage can consume credits outside Rethread,
so owner/provider limits still apply. [E2B pricing](https://e2b.dev/pricing).

The owner selected existing Supabase Free. Its database/storage quotas and
inactivity behavior apply. Inspect and back up that existing project before
forward migrations. The existing project now contains the additive `rethread`
schema; provider-managed schemas and public policies were preserved. No new
Supabase project or paid entitlement was created.
The unrelated existing Render database has not been reused.
[Supabase Free](https://supabase.com/pricing).

Standard GitHub-hosted runners are free for public repositories under GitHub's
current policy; this workflow does not request larger runners. If the repository
becomes private, recheck included minutes and block spending before running it.
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
