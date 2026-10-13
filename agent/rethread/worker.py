import json
import os
import signal
import threading
from datetime import datetime, timezone
from uuid import uuid4

from psycopg.types.json import Jsonb

from .github import GitHub
from .pipeline import repair
from .planner import plan
from .preflight import preflight
from .publisher import publish
from .sandbox import E2BProvider, SandboxUnavailable
from .store import LeaseLost, Store


def main():
    store = Store()
    worker_id = f"rethread-{uuid4()}"
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    completed_jobs = 0

    def announce():
        configured = all(
            os.getenv(key) for key in ("E2B_API_KEY", "E2B_TEMPLATE_ID", "LLM_API_KEY", "LLM_MODEL")
        )
        with store.transaction() as db:
            db.execute(
                "INSERT INTO worker_heartbeats(id,build_id,capabilities) VALUES(%s,%s,%s) "
                "ON CONFLICT(id) DO UPDATE SET updated_at=now(),capabilities=excluded.capabilities",
                (
                    worker_id,
                    os.getenv("BUILD_ID", "development"),
                    Jsonb({"repairConfigured": configured}),
                ),
            )

    while not stopped.is_set():
        announce()
        with store.transaction() as db:
            db.execute("DELETE FROM artifacts WHERE expires_at<now()")
            db.execute("DELETE FROM oauth_states WHERE expires_at<now()")
            db.execute("DELETE FROM sessions WHERE expires_at<now()")
        job = store.claim(worker_id)
        if not job:
            if os.getenv("WORKER_EXIT_WHEN_IDLE") == "true":
                break
            stopped.wait(2)
            continue
        lost = threading.Event()
        finished = threading.Event()
        provider = None
        github = None

        def heartbeat():
            while not finished.wait(10):
                try:
                    if stopped.is_set():
                        raise LeaseLost("Worker shutdown")
                    announce()
                    started = job.get("first_started_at") or job["created_at"]
                    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
                    if elapsed > int(os.getenv("MAX_JOB_WALL_SECONDS", "900")):
                        store.save(
                            job,
                            "blocked" if job["case_id"] else None,
                            reason="Job wall-time ceiling reached",
                        )
                        store.finish(job, failed=True, reason="Job wall-time ceiling reached")
                        raise LeaseLost("Wall-time limit")
                    store.heartbeat(job)
                except Exception:
                    lost.set()
                    if provider:
                        provider.close()
                    return

        pulse = threading.Thread(target=heartbeat, daemon=True)
        pulse.start()
        try:
            with store.transaction() as db:
                store.fenced(db, job)
                repository = db.execute(
                    "SELECT * FROM repositories WHERE tenant_id=%s AND id=%s AND connected=true",
                    (job["tenant_id"], job["repository_id"]),
                ).fetchone()
                case = (
                    db.execute(
                        "SELECT * FROM cases WHERE tenant_id=%s AND id=%s",
                        (job["tenant_id"], job["case_id"]),
                    ).fetchone()
                    if job["case_id"]
                    else None
                )
            if not repository:
                raise SandboxUnavailable("GitHub installation is disconnected")
            finished_states = {
                "pr_opened",
                "needs_input",
                "unsupported",
                "blocked",
                "failed",
                "cancelled",
                "rejected",
                "superseded",
            }
            if case and (
                case["state"] in finished_states
                or job["kind"] == "repair"
                and case["state"] == "ready_for_review"
            ):
                store.finish(job, reason="Reconciled persisted Case outcome after restart")
                continue
            github = GitHub(repository)
            if job["sandbox_id"]:
                # Recover an orphan from a previous lease before starting another.
                from e2b import Sandbox

                Sandbox.kill(job["sandbox_id"], api_key=os.environ["E2B_API_KEY"])
            if job["kind"] == "publish":
                publish(store, job, case, github)
            else:
                provider = E2BProvider(
                    lambda identity: store.sandbox(job, identity),
                    lambda: lost.is_set() or stopped.is_set(),
                    lambda: store.reserve_sandbox_credit(job),
                )
                if job["kind"] == "repair":
                    repair(store, job, case, github, provider, plan)
                else:
                    preflight(store, job, github, provider)
            store.finish(job)
        except LeaseLost:
            print(
                json.dumps(
                    {"service": "rethread-worker", "jobId": str(job["id"]), "outcome": "lease_lost"}
                ),
                flush=True,
            )
        except Exception as exc:
            # Never log raw provider exceptions; they may embed signed URLs or credentials.
            from .policy import PolicyError

            safe_reason = (
                str(exc)
                if isinstance(exc, (PolicyError, SandboxUnavailable, ValueError))
                else f"Provider operation failed ({type(exc).__name__}); inspect the job stage"
            )
            if job["kind"] == "publish":
                state = "ready_for_review"
                safe_reason = (
                    "Draft PR publication failed; verified evidence is retai"
                    "ned. Retry reconciles existing branch/PR."
                )
            else:
                state = (
                    "unsupported"
                    if safe_reason.startswith("unsupported:")
                    else "needs_input"
                    if safe_reason.startswith("needs_input:")
                    else "blocked"
                    if isinstance(exc, SandboxUnavailable)
                    or safe_reason.startswith(("blocked:", "budget_exceeded:"))
                    else "failed"
                )
            try:
                store.save(job, state if job["case_id"] else None, reason=safe_reason)
                store.finish(job, failed=True, reason=safe_reason)
            except LeaseLost:
                pass
            print(
                json.dumps(
                    {
                        "service": "rethread-worker",
                        "jobId": str(job["id"]),
                        "outcome": state,
                        "exceptionType": type(exc).__name__,
                    }
                ),
                flush=True,
            )
        finally:
            completed_jobs += 1
            finished.set()
            pulse.join(timeout=1)
            if provider:
                provider.close()
            if github:
                github.close()
        if completed_jobs >= int(os.getenv("MAX_JOBS_PER_INVOCATION", "1000000")):
            break
    store.pool.close()


if __name__ == "__main__":
    main()
