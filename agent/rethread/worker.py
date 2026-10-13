import json
import os
import signal
import threading
from uuid import uuid4

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
    while not stopped.is_set():
        with store.transaction() as db:
            db.execute(
                "INSERT INTO worker_heartbeats(id,build_id) VALUES(%s,%s) ON CONFLICT(id) DO UPDATE SET updated_at=now()",
                (worker_id, os.getenv("BUILD_ID", "development")),
            )
            db.execute("DELETE FROM artifacts WHERE expires_at<now()")
            db.execute("DELETE FROM oauth_states WHERE expires_at<now()")
            db.execute("DELETE FROM sessions WHERE expires_at<now()")
        job = store.claim(worker_id)
        if not job:
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
                safe_reason = "Draft PR publication failed; verified evidence is retained. Retry reconciles existing branch/PR."
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
            finished.set()
            pulse.join(timeout=1)
            if provider:
                provider.close()
            if github:
                github.close()
    store.pool.close()


if __name__ == "__main__":
    main()
