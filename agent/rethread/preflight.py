from uuid import uuid4

from psycopg.types.json import Jsonb

from .policy import digest, pinned_requirements


def preflight(store, job, github, provider):
    head = job["payload"]["headSha"]
    files = github.source(head)
    pinned_requirements(files)
    with store.transaction() as db:
        store.fenced(db, job)
        guards = db.execute(
            "SELECT * FROM guards WHERE tenant_id=%s AND repository_id=%s",
            (job["tenant_id"], job["repository_id"]),
        ).fetchall()
    changed = github.request("GET", f"/pulls/{job['payload']['prNumber']}/files?per_page=100")
    changed_paths = {r["filename"] for r in changed}
    results = []
    outcomes = []
    # Prioritize explainably, but run every retained guard before reporting all-pass.
    for guard in sorted(guards, key=lambda g: not bool(set(g["source_paths"]) & changed_paths)):
        store.heartbeat(job)
        reason = (
            "Direct source-path relationship"
            if set(guard["source_paths"]) & changed_paths
            else "Complete retained guard suite; no direct path relationship"
        )
        validity = "active"
        if guard["path"] not in files:
            passed = False
            validity = "stale"
            result = {"reason": "Recorded guard was removed or renamed", "passed": False}
        elif digest(files[guard["path"]]) != digest(guard["content"]):
            passed = False
            validity = "needs_review"
            result = {
                "reason": "Recorded guard content changed; specification review required",
                "passed": False,
            }
        else:
            evidence = provider.check(files, "pytest", guard["test_name"], "preflight")
            passed = evidence.check.passed
            result = evidence.check.model_dump()
        with store.transaction() as db:
            store.fenced(db, job)
            db.execute(
                "INSERT INTO guard_checks(tenant_id,id,guard_id,job_id,head_sha,passed,selection_reason,result) VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(job_id,guard_id) DO NOTHING",
                (
                    job["tenant_id"],
                    uuid4(),
                    guard["id"],
                    job["id"],
                    head,
                    passed,
                    reason,
                    Jsonb(result),
                ),
            )
            db.execute(
                "UPDATE guards SET validity=%s,last_sha=%s,last_passed_at=CASE WHEN %s THEN now() ELSE last_passed_at END WHERE tenant_id=%s AND id=%s",
                (validity, head, passed, job["tenant_id"], guard["id"]),
            )
        outcomes.append(passed)
        results.append(
            f"- {guard['test_name']}: {'PASS' if passed else 'FAIL'} — {reason}; Case {guard['case_id']}"
        )
    all_pass = bool(guards) and all(outcomes)
    origin = __import__("os").environ["PUBLIC_ORIGIN"]
    summary = (
        "\n".join(results)
        if guards
        else "No retained guards exist. No all-guards-pass claim is made."
    )
    github.check(
        head,
        "retained guards",
        "success" if all_pass else "failure" if guards else "neutral",
        summary,
        f"{origin}/studio/guards",
        f"preflight:{job['payload']['correlation']}",
    )
