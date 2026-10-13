import gzip
import json
import os
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .policy import digest
from .redaction import redact


PROTOCOL=json.loads((Path(__file__).parents[2]/"contracts/v1.json").read_text(encoding="utf-8"))

class LeaseLost(RuntimeError):
    pass


class Store:
    def __init__(self, url=None):
        self.pool = ConnectionPool(
            url or os.environ["DATABASE_URL"],
            min_size=1,
            open=True,
            max_size=int(os.getenv("WORKER_DB_POOL_SIZE", "3")),
            kwargs={"row_factory": dict_row, "options": "-c search_path=rethread,public"},
        )

    @contextmanager
    def transaction(self):
        with self.pool.connection() as db, db.transaction():
            yield db

    def claim(self, worker):
        with self.transaction() as db:
            db.execute("""UPDATE jobs SET status='failed',reason='Retry limit exhausted',updated_at=now()
                         WHERE attempts>=3 AND (status='queued' OR (status='running' AND lease_until<now()))""")
            row = db.execute("""SELECT j.* FROM jobs j WHERE j.attempts<3
                AND ((j.status='queued' AND j.next_attempt_at<=now()) OR (j.status='running' AND j.lease_until<now()))
                AND (SELECT count(*) FROM jobs busy WHERE busy.tenant_id=j.tenant_id
                     AND busy.status='running' AND busy.lease_until>now())<2
                ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1""").fetchone()
            if not row:
                return None
            # Serialize concurrency admission per tenant, without holding this lock over work.
            db.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(row["tenant_id"]),))
            running = db.execute("SELECT count(*) AS count FROM jobs WHERE tenant_id=%s AND status='running' AND lease_until>now()", (row["tenant_id"],)).fetchone()["count"]
            if running >= 2:
                return None
            return db.execute(
                """UPDATE jobs SET status='running',worker_id=%s,fence=fence+1,
                attempts=attempts+1,lease_until=now()+interval '60 seconds',heartbeat_at=now(),updated_at=now()
                WHERE id=%s RETURNING *""",
                (worker, row["id"]),
            ).fetchone()

    def fenced(self, db, job):
        current = db.execute(
            """SELECT * FROM jobs WHERE id=%s AND fence=%s
             AND status='running' AND lease_until>now() FOR UPDATE""",
            (job["id"], job["fence"]),
        ).fetchone()
        if not current:
            raise LeaseLost("Job cancelled or lease superseded")
        if current["case_id"]:
            case = db.execute(
                "SELECT * FROM cases WHERE tenant_id=%s AND id=%s FOR UPDATE",
                (job["tenant_id"], job["case_id"]),
            ).fetchone()
            if case["state"] == "cancelled":
                raise LeaseLost("Case cancelled")
        return current

    def heartbeat(self, job):
        with self.transaction() as db:
            self.fenced(db, job)
            db.execute(
                "UPDATE jobs SET lease_until=now()+interval '60 seconds',heartbeat_at=now() WHERE id=%s",
                (job["id"],),
            )

    def event(self, db, tenant, case, event_type, payload):
        sequence = db.execute(
            "UPDATE cases SET cursor=cursor+1,updated_at=now() WHERE tenant_id=%s AND id=%s RETURNING cursor",
            (tenant, case),
        ).fetchone()["cursor"]
        payload = json.loads(redact(json.dumps(payload, default=str)))
        db.execute(
            "INSERT INTO events(tenant_id,case_id,sequence,type,payload) VALUES(%s,%s,%s,%s,%s)",
            (tenant, case, sequence, event_type, Jsonb(payload)),
        )

    def save(self, job, state=None, data=None, reason=None, checkpoint=None):
        with self.transaction() as db:
            self.fenced(db, job)
            if job["case_id"]:
                current = db.execute("SELECT state FROM cases WHERE tenant_id=%s AND id=%s", (job["tenant_id"],job["case_id"])).fetchone()["state"]
                stages=PROTOCOL["stages"]
                if state == current or (state in stages and current in stages and stages.index(state)<stages.index(current)):
                    state=None  # Reclaimed work can recheck evidence without rewinding durable state.
                if state and state not in PROTOCOL["transitions"][current]:
                    raise ValueError(f"Invalid transition: {current} -> {state}")
                if state:
                    db.execute(
                        "UPDATE cases SET state=%s,reason=%s WHERE tenant_id=%s AND id=%s",
                        (state, reason, job["tenant_id"], job["case_id"]),
                    )
                    self.event(
                        db,
                        job["tenant_id"],
                        job["case_id"],
                        "state",
                        {"state": state, "reason": reason},
                    )
                if data:
                    clean = json.loads(redact(json.dumps(data)))
                    db.execute(
                        "UPDATE cases SET data=data||%s WHERE tenant_id=%s AND id=%s",
                        (Jsonb(clean), job["tenant_id"], job["case_id"]),
                    )
                    self.event(
                        db, job["tenant_id"], job["case_id"], "evidence", {"keys": list(data)}
                    )
            if checkpoint is not None:
                db.execute(
                    "UPDATE jobs SET checkpoint=%s,updated_at=now() WHERE id=%s",
                    (Jsonb(checkpoint), job["id"]),
                )

    def sandbox(self, job, sandbox_id):
        with self.transaction() as db:
            self.fenced(db, job)
            db.execute("UPDATE jobs SET sandbox_id=%s WHERE id=%s", (sandbox_id, job["id"]))

    def finish(self, job, failed=False, reason=None):
        with self.transaction() as db:
            self.fenced(db, job)
            db.execute(
                "UPDATE jobs SET status=%s,reason=%s,sandbox_id=NULL,lease_until=NULL,updated_at=now() WHERE id=%s",
                ("failed" if failed else "completed", reason, job["id"]),
            )

    def artifact(self, job, kind, text):
        raw = redact(text).encode()
        maximum = 2 * 1024 * 1024 if kind == "log" else 10 * 1024 * 1024
        truncated = len(raw) > maximum
        raw = raw[:maximum]
        identity = str(uuid4())
        with self.transaction() as db:
            self.fenced(db, job)
            db.execute(
                "SELECT id FROM cases WHERE tenant_id=%s AND id=%s FOR UPDATE",
                (job["tenant_id"], job["case_id"]),
            )
            used = db.execute(
                "SELECT coalesce(sum(raw_bytes),0) AS used FROM artifacts WHERE tenant_id=%s AND case_id=%s",
                (job["tenant_id"], job["case_id"]),
            ).fetchone()["used"]
            if used + len(raw) > 25 * 1024 * 1024:
                raise ValueError("Case artifact quota exceeded")
            db.execute(
                "INSERT INTO artifacts(tenant_id,id,case_id,kind,content_hash,raw_bytes,truncated) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                (
                    job["tenant_id"],
                    identity,
                    job["case_id"],
                    kind,
                    digest(raw),
                    len(raw),
                    truncated,
                ),
            )
            db.execute(
                "INSERT INTO artifact_payloads(tenant_id,id,case_id,payload) VALUES(%s,%s,%s,%s)",
                (job["tenant_id"], identity, job["case_id"], gzip.compress(raw)),
            )
        return identity

    def reserve(self, tenant, reservation_id, amount):
        # Reservation retries are idempotent; global and tenant rows lock in a fixed order.
        with self.transaction() as db:
            db.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (reservation_id,))
            existing = db.execute(
                "SELECT * FROM budget_reservations WHERE id=%s", (reservation_id,)
            ).fetchone()
            if existing:
                if existing["tenant_id"] != tenant or existing["amount_micros"] != amount:
                    raise ValueError("Reservation identity mismatch")
                return not existing["settled"]
            day = db.execute("SELECT current_date AS day").fetchone()["day"]
            for scope, limit in sorted(
                [
                    ("global", int(os.getenv("GLOBAL_DAILY_BUDGET_MICROS", "10000000"))),
                    (str(tenant), int(os.getenv("TENANT_DAILY_BUDGET_MICROS", "2000000"))),
                ]
            ):
                db.execute(
                    "INSERT INTO budgets(scope,day,ceiling_micros) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING",
                    (scope, day, limit),
                )
                row = db.execute(
                    "SELECT * FROM budgets WHERE scope=%s AND day=%s FOR UPDATE", (scope, day)
                ).fetchone()
                if row["reserved_micros"] + row["spent_micros"] + amount > row["ceiling_micros"]:
                    raise ValueError("budget_exceeded: Daily ceiling would be exceeded")
                db.execute(
                    "UPDATE budgets SET reserved_micros=reserved_micros+%s WHERE scope=%s AND day=%s",
                    (amount, scope, day),
                )
            db.execute(
                "INSERT INTO budget_reservations(id,tenant_id,day,amount_micros) VALUES(%s,%s,%s,%s)",
                (reservation_id, tenant, day, amount),
            )
            return True

    def settle(self, reservation_id, actual):
        with self.transaction() as db:
            row = db.execute(
                "SELECT * FROM budget_reservations WHERE id=%s FOR UPDATE", (reservation_id,)
            ).fetchone()
            if not row or row["settled"]:
                return
            charged = min(actual, row["amount_micros"])
            for scope in sorted(["global", str(row["tenant_id"])]):
                db.execute(
                    "UPDATE budgets SET reserved_micros=reserved_micros-%s,spent_micros=spent_micros+%s WHERE scope=%s AND day=%s",
                    (row["amount_micros"], charged, scope, row["day"]),
                )
            db.execute(
                "UPDATE budget_reservations SET settled=true,actual_micros=%s WHERE id=%s",
                (actual, reservation_id),
            )
