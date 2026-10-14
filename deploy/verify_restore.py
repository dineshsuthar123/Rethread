"""Compare a quiesced source with a separately restored *_test database.

Read-only; URLs are supplied privately as DATABASE_URL and RESTORE_DATABASE_URL.
The result contains counts and digests, never database URLs or row contents.
"""

import gzip
import hashlib
import io
import json
import os

import psycopg
from psycopg import sql


def inspect(url, require_test=False):
    with psycopg.connect(url) as db:
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        # Compare instants consistently across provider/local server time zones.
        db.execute("SET LOCAL TIME ZONE 'UTC'")
        if require_test:
            name = db.execute("SELECT current_database()").fetchone()[0]
            if not name.endswith("_test"):
                raise RuntimeError("Restore verification requires a separate *_test database")
        tables = db.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='rethread' ORDER BY tablename"
        ).fetchall()
        result = {}
        for (table,) in tables:
            checksum = hashlib.sha256()
            count = 0
            with db.cursor(name=f"verify_{table}") as cursor:
                cursor.execute(
                    sql.SQL(
                        "SELECT row_to_json(t)::text FROM rethread.{} t "
                        "ORDER BY row_to_json(t)::text"
                    ).format(sql.Identifier(table))
                )
                for (row,) in cursor:
                    checksum.update(row.encode())
                    checksum.update(b"\n")
                    count += 1
            result[table] = {"rows": count, "sha256": checksum.hexdigest()}
        inconsistent = db.execute(
            "SELECT count(*) FROM rethread.cases c WHERE cursor<>"
            "(SELECT coalesce(max(sequence),0) FROM rethread.events e "
            "WHERE e.tenant_id=c.tenant_id AND e.case_id=c.id)"
        ).fetchone()[0]
        if inconsistent:
            raise RuntimeError("Event cursor continuity check failed")
        with db.cursor(name="verify_artifacts") as cursor:
            cursor.execute(
                "SELECT content_hash,raw_bytes,payload FROM rethread.artifacts a "
                "JOIN rethread.artifact_payloads p USING(tenant_id,id,case_id)"
            )
            for expected_hash, expected_bytes, payload in cursor:
                with gzip.GzipFile(fileobj=io.BytesIO(payload)) as compressed:
                    raw = compressed.read(10 * 1024 * 1024 + 1)
                if len(raw) != expected_bytes or hashlib.sha256(raw).hexdigest() != expected_hash:
                    raise RuntimeError("Restored artifact integrity check failed")
        return result


if __name__ == "__main__":
    source = inspect(os.environ["DATABASE_URL"])
    restored = inspect(os.environ["RESTORE_DATABASE_URL"], require_test=True)
    if source != restored:
        changed = sorted(
            table
            for table in source.keys() | restored.keys()
            if source.get(table) != restored.get(table)
        )
        raise RuntimeError(f"Restored tables differ: {', '.join(changed)}")
    print(
        json.dumps(
            {
                "status": "passed",
                "scope": "rethread schema",
                "tables": source,
                "eventCursors": "passed",
                "artifactHashes": "passed",
            },
            indent=2,
        )
    )
