# Owner operations

Use deployment.md for setup and acceptance.md for measured release evidence.
All commands below operate on a named owner-controlled test/production resource;
never substitute an unrelated repository or database.

## Investigate a Case

Open `/studio/cases/<id>`, inspect each check's actual output in the evidence
dock, and export its manifest. Correlate `X-Request-ID`, Case ID and job ID with
structured API/worker logs. Provider errors expose type/stage, never keys or
signed archive URLs. `needs_input` identifies the oracle/dependency gap;
`unsupported` identifies an adapter limitation; `blocked` identifies missing
infrastructure/budget. None is a verified repair.

Worker readiness requires a heartbeat newer than 90 seconds. Monitor stale
heartbeats (>90 s), oldest queued job (>5 min), expired running leases (>60 s),
retries >=3, failed publication, sandbox probe failures and budgets >80%.
The authenticated Settings route exposes tenant queue age and budgets.
Provider alert delivery must be configured in the owner workspace; no
notifications or emails are sent by this implementation without authorization.

```sql
SELECT id,updated_at,build_id FROM rethread.worker_heartbeats;
SELECT id,kind,status,attempts,lease_until,heartbeat_at,reason
FROM rethread.jobs ORDER BY created_at DESC LIMIT 50;
SELECT scope,day,reserved_micros,spent_micros,ceiling_micros
FROM rethread.budgets WHERE day=current_date;
```

## Stalled work and cancellation

Cancel through the Case UI/API. Cancellation changes Case/job state and
increments its fencing token; the heartbeat loop kills the active sandbox.
Restarting the API never restarts an agent job. A restarted worker waits for a
lease to expire, reclaims it with a higher fence, kills a recorded orphan
sandbox and resumes from its persisted plan/checkpoint. A retained completed
Case outcome is reconciled without rewinding or republishing. Do not manually
delete jobs or reset fencing tokens.

An ambiguous draft-PR timeout is retried from the Case action after approval.
The saved branch/commit and existing PR list are reconciled. A head change is
superseded; capture a new Case at the new commit and reverify. Never force-push
the old patch or manually label failed verification as passing.

## Revoke access

Use Settings → Sign out everywhere to invalidate this user's sessions. Revoke
the Rethread GitHub App installation/selected repository in GitHub for source
access; signed installation webhooks disconnect the repository. Revoke or
rotate compromised App/E2B/LLM credentials in the provider and redeploy runtime
settings privately. Expired logs/artifacts are removed by worker housekeeping.
Original repository commits and PRs are not deleted by retention cleanup.

## Backup, restore and migration recovery

```sh
pg_dump --format=custom --file=rethread-backup.dump "$MIGRATION_DATABASE_URL"
createdb rethread_restore_test
pg_restore --dbname="$RESTORE_TEST_URL" rethread-backup.dump
DATABASE_URL="$MIGRATION_DATABASE_URL" RESTORE_DATABASE_URL="$RESTORE_TEST_URL" uv run python deploy/verify_restore.py
```

Keep dumps encrypted and outside Git; they contain private source/evidence and
encrypted login tokens. Verify row counts, migration checksums, event cursor
continuity, artifact content hashes and representative exports after restoring
into a separate test database. Record backup ID/time and restore results.
Never test restore by overwriting production. Configure provider backup/PITR
retention before accepting real private repository Cases. The selected Supabase
Free account requires an owner-managed manual backup procedure; do not enable
paid PITR under the current authorization. `verify_restore.py` refuses a restore
target whose database name does not end in `_test`, compares every Rethread
table's row digest/count, verifies cursor continuity and decompresses/hash-checks
artifacts. Pause source writes during the dump/comparison to avoid drift.

Migrations are additive, checksum-protected and serialized by advisory lock.
The current schema leaves legacy Supabase tables intact. Roll back application
images first while retaining additive columns/tables; do not drop the schema.
Forward recovery reruns the migrator idempotently. A destructive future
migration needs a verified backup and a separate recovery procedure.

The local acceptance exercise restored all six migrations into a separate
database, compared 24 tables, 49 Cases, 83 events and one compressed artifact.
An intentionally failing transaction left neither its probe table nor migration
record, and the normal migrator reran successfully. No production schema was
rolled back. See acceptance.md for the exact environment and limitations.

## Deploy rollback

Record API/worker image IDs and provider deploy IDs before a release. Disable
new admission if the release is faulty, cancel or inspect active work, then
redeploy the preceding verified implementation commit. Restart workers only
after schema compatibility is confirmed; expired leases/fences reconcile jobs.
For Vercel, point the release alias at the previous verified deployment. Do not
roll back to the removed host-execution runtime. Local image startup and
database restore evidence are distinct from a provider rollback test; the
actual tested scope belongs in acceptance.md.

## Retention, export and spend

Artifacts expire after 30 days. Case/guard metadata stays searchable; expired
artifact access returns not_found. Archive completed Cases through the API.
Exports retain the recipe/commands/contract/additive guard without hosted keys.
Per-Case and per-tenant artifact quotas fail closed. Budget reservation and
settlement are atomic/idempotent; do not clear unknown reservations to free
funds. Ambiguous provider usage charges the conservative reserved maximum.
Set provider account spend limits and current conservative model price settings.
No fallback silently switches provider or model.
