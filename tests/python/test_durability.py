import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from agent.rethread.store import LeaseLost, Store

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="Disposable PostgreSQL required"
)


@pytest.fixture
def seeded_store():
    store = Store()
    tenant, repo, case, job = (uuid4() for _ in range(4))
    with store.transaction() as db:
        database = db.execute("SELECT current_database() AS name").fetchone()["name"]
        assert database.endswith("_test"), (
            "Integration tests require a named disposable *_test database"
        )
        db.execute("INSERT INTO tenants(id,name) VALUES(%s,'Durability test')", (tenant,))
        db.execute(
            "INSERT INTO installations(tenant_id,id,account) VALUES(%s,123,'fixture')", (tenant,)
        )
        db.execute(
            (
                "INSERT INTO repositories(tenant_id,id,github_id,install"
                "ation_id,full_name,default_branch) VALUES(%s,%s,123,123"
                ",'fixture/repo','main')"
            ),
            (tenant, repo),
        )
        db.execute(
            (
                "INSERT INTO cases(tenant_id,id,repository_id,title,stat"
                "e,base_sha,branch,idempotency_key,request_hash) VALUES("
                "%s,%s,%s,'Fixture case','queued',%s,'main',%s,'hash')"
            ),
            (tenant, case, repo, "a" * 40, str(uuid4())),
        )
        db.execute(
            "INSERT INTO jobs(id,tenant_id,case_id,repository_id,kind) "
            "VALUES(%s,%s,%s,%s,'repair')",
            (job, tenant, case, repo),
        )
        # Test-specific rows first; isolate from other integration test queue entries.
        db.execute(
            "UPDATE jobs SET "
            "next_attempt_at=now()+interval '1 day' WHERE id<>%s AND status='queued'",
            (job,),
        )
        db.execute(
            "UPDATE jobs SET status='cancelled',fence=fence+1 WHERE id<>%s AND status='running'",
            (job,),
        )
    yield store, tenant, repo, case, job
    store.pool.close()


def test_two_workers_claim_one_job_and_stale_fence_cannot_finalize(seeded_store):
    store, tenant, repo, case, identity = seeded_store
    with ThreadPoolExecutor(2) as executor:
        claimed = list(executor.map(store.claim, ["worker-a", "worker-b"]))
    jobs = [job for job in claimed if job]
    assert len(jobs) == 1
    first = jobs[0]
    store.save(first, "capturing", checkpoint={"source": "pinned"})
    with store.transaction() as db:
        db.execute("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (identity,))
    recovered = store.claim("worker-restarted")
    assert recovered["fence"] > first["fence"]
    assert recovered["checkpoint"]["source"] == "pinned"
    with pytest.raises(LeaseLost):
        store.save(first, "failed", reason="Late stale write")
    store.save(recovered, "reproducing")
    store.finish(recovered)
    with store.transaction() as db:
        assert (
            db.execute(
                "SELECT state FROM cases WHERE tenant_id=%s AND id=%s", (tenant, case)
            ).fetchone()["state"]
            == "reproducing"
        )


def test_cancelled_fence_cannot_write_or_publish(seeded_store):
    store, tenant, repo, case, identity = seeded_store
    job = store.claim("worker")
    with store.transaction() as db:
        db.execute(
            "UPDATE cases SET state='cancelled' WHERE tenant_id=%s AND id=%s", (tenant, case)
        )
        db.execute("UPDATE jobs SET status='cancelled',fence=fence+1 WHERE id=%s", (identity,))
    with pytest.raises(LeaseLost):
        store.finish(job)


def test_concurrent_budget_reservations_do_not_overrun_and_retries_settle_once(
    seeded_store, monkeypatch
):
    store, tenant, *_ = seeded_store
    monkeypatch.setenv("TENANT_DAILY_BUDGET_MICROS", "100")
    monkeypatch.setenv("GLOBAL_DAILY_BUDGET_MICROS", "10000000")
    ids = [str(uuid4()), str(uuid4())]

    def reserve(identity):
        try:
            return store.reserve(tenant, identity, 70)
        except ValueError:
            return False

    with ThreadPoolExecutor(2) as executor:
        result = list(executor.map(reserve, ids))
    assert result.count(True) == 1
    successful = ids[result.index(True)]
    assert store.reserve(tenant, successful, 70)
    store.settle(successful, 50)
    store.settle(successful, 50)
    with store.transaction() as db:
        budget = db.execute("SELECT * FROM budgets WHERE scope=%s", (str(tenant),)).fetchone()
        assert budget["spent_micros"] == 50 and budget["reserved_micros"] == 0
