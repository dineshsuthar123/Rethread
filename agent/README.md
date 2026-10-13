# Rethread trusted worker

Run `uv run --env-file .env.rethread.local python -m agent.rethread.worker` from
the workspace root. Dependencies are locked in uv.lock. Free deployment uses
the registered `.github/workflows/review.yml` on the implementation branch.

The worker claims PostgreSQL jobs with leases/fencing, checkpoints repair stages,
redacts bounded planner input, controls E2B execution, applies hash-checked exact
source diffs, records independent checks and publishes only an approved draft PR.
It never imports or executes target repositories locally. Missing sandbox,
unconfirmed free entitlement, empty/invalid runner reports and insufficient
credits fail closed. The test-only fixture provider lives in tests/python and
is never imported by production code.

See [security boundaries](../docs/security-boundaries.md),
[free hosting](../docs/free-hosting.md) and [operations](../docs/operations.md).
`error_parser.py` and the small classification vocabulary retain useful legacy
parser tests; they are not the verification oracle.
