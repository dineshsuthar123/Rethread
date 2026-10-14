import type { Case, Check } from "@rethread/contracts";
// Deterministic demonstration, deliberately separate from hosted Case APIs.
const checks: Check[] = [
  {
    id: "example-base",
    phase: "base",
    name: "test_retry_delivery",
    command: "pytest tests/test_delivery.py::test_retry_delivery",
    exitCode: 1,
    collected: 1,
    passed: false,
    outputHash: "example — no production hash",
    durationMs: 0,
  },
  {
    id: "example-candidate",
    phase: "candidate",
    name: "test_retry_delivery",
    command: "pytest tests/test_delivery.py::test_retry_delivery",
    exitCode: 0,
    collected: 1,
    passed: true,
    outputHash: "example — no production hash",
    durationMs: 0,
  },
  {
    id: "example-guard-base",
    phase: "guard_base",
    name: "test_duplicate_delivery",
    command: "pytest tests/guards/test_duplicate_delivery.py",
    exitCode: 1,
    collected: 1,
    passed: false,
    outputHash: "example — no production hash",
    durationMs: 0,
  },
  {
    id: "example-guard-patch",
    phase: "guard_candidate",
    name: "test_duplicate_delivery",
    command: "pytest tests/guards/test_duplicate_delivery.py",
    exitCode: 0,
    collected: 1,
    passed: true,
    outputHash: "example — no production hash",
    durationMs: 0,
  },
];
export const fixture: Case = {
  id: "example",
  repository_id: "example",
  title: "A retry should never send twice.",
  state: "ready_for_review",
  base_sha: "example snapshot",
  branch: "example",
  reason: null,
  cursor: 0,
  archived: false,
  created_at: "",
  updated_at: "",
  data: {
    request: {
      repositoryId: "example",
      branch: "example",
      baseSha: "example",
      title: "Duplicate webhook delivery",
      behaviorContract:
        "Delivering the same event twice queues exactly one notification.",
      reproduction: {
        kind: "pytest",
        test: "tests/test_delivery.py::test_retry_delivery",
      },
    },
    checks,
    recipe: {
      complete: true,
      description: "Example: Python, SQLite, pytest and Ruff",
    },
    proposal: {
      digest: "example",
      rationale:
        "The event claim and notification outbox insert share one database transaction. A duplicate claim rolls back without enqueueing again. Delivery from the outbox happens separately.",
      files: [{ path: "delivery.py", baseHash: "example", content: "" }],
      diff: "--- a/delivery.py\n+++ b/delivery.py\n@@ atomic claim + durable outbox @@\n- enqueue_notification(event)\n- remember(event.id)\n+ with db.transaction():\n+     if claim_once(event.id):\n+         insert_outbox(event)\n",
      guard: {
        path: "tests/guards/test_duplicate_delivery.py",
        content:
          'def test_duplicate_delivery(db):\n    deliver(db, event_id="evt_42")\n    deliver(db, event_id="evt_42")\n    assert queued_notifications(db) == 1\n',
        test: "tests/guards/test_duplicate_delivery.py::test_duplicate_delivery",
        contract:
          "Delivering the same event twice queues exactly one notification.",
        paths: ["delivery.py"],
      },
    },
  },
};
