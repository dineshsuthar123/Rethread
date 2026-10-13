import json
from uuid import uuid4

import httpx
import pytest
from psycopg.types.json import Jsonb

from agent.rethread.policy import apply_plan, digest
from agent.rethread.publisher import publish
from tests.python.emulator import CONTRACT, fixture_files
from tests.python.test_durability import seeded_store as seeded_store
from tests.python.test_policy import fixture_plan


class PublishingGitHub:
    """Controlled GitHub provider, persists successful effects before ambiguous timeout."""

    name = "fixture/repo"

    def __init__(self, sha):
        self.sha = sha
        self.refs = {}
        self.prs = []
        self.timeout_once = False
        self.mutations = []

    def source(self, sha):
        return fixture_files()

    def head(self, branch):
        return self.sha

    def check(self, *args):
        return None

    def request(self, method, path, **kwargs):
        payload = kwargs.get("json", {})
        if method == "POST":
            self.mutations.append(path)
        if path.startswith("/git/commits/"):
            return {"tree": {"sha": "tree"}}
        if path == "/git/blobs":
            return {"sha": digest(payload["content"])[:40]}
        if path == "/git/trees":
            return {"sha": "new-tree"}
        if path == "/git/commits":
            return {"sha": "c" * 40}
        if path.startswith("/git/ref/heads/"):
            from urllib.parse import unquote

            branch = unquote(path.split("/heads/", 1)[1])
            if branch not in self.refs:
                response = httpx.Response(
                    404, request=httpx.Request(method, f"https://api.github.com{path}")
                )
                raise httpx.HTTPStatusError(
                    "Not found", request=response.request, response=response
                )
            return {"object": {"sha": self.refs[branch]}}
        if path == "/git/refs":
            self.refs[payload["ref"].removeprefix("refs/heads/")] = payload["sha"]
            return {}
        if path == "/pulls" and method == "GET":
            return self.prs
        if path == "/pulls" and method == "POST":
            self.prs.append(
                {"html_url": "https://github.com/fixture/repo/pull/1", "draft": payload["draft"]}
            )
            if self.timeout_once:
                self.timeout_once = False
                raise httpx.ReadTimeout("Ambiguous response")
            return self.prs[0]
        raise AssertionError((method, path))


def ready_case(store, tenant, repo, identity):
    plan = fixture_plan()
    candidate, diff = apply_plan(fixture_files(), plan, CONTRACT, "pytest")
    proposal = {
        **plan.model_dump(),
        "diff": diff,
        "digest": digest(
            json.dumps(
                {"files": [f.model_dump() for f in plan.files], "guard": plan.guard.model_dump()},
                sort_keys=True,
            )
        ),
    }
    data = {
        "proposal": proposal,
        "approvedDigest": proposal["digest"],
        "checks": [],
        "recipe": {"complete": True},
        "sourceDigest": digest(str(candidate)),
        "request": {"behaviorContract": CONTRACT, "reproduction": {"kind": "pytest"}},
    }
    with store.transaction() as db:
        for stage in (
            "capturing",
            "reproducing",
            "diagnosing",
            "proposing",
            "verifying",
            "ready_for_review",
            "publishing",
        ):
            db.execute(
                "UPDATE cases SET state=%s WHERE tenant_id=%s AND id=%s", (stage, tenant, identity)
            )
        db.execute(
            "UPDATE cases SET data=%s WHERE tenant_id=%s AND id=%s", (Jsonb(data), tenant, identity)
        )
        db.execute(
            "INSERT INTO publish_intents(tenant_id,case_id,idempotency_key,digest,branch) "
            " VALUES(%s,%s,%s,%s,%s)",
            (
                tenant,
                identity,
                str(uuid4()),
                proposal["digest"],
                f"rethread/case-{str(identity)[:12]}-fixture",
            ),
        )
        return db.execute(
            "SELECT * FROM cases WHERE tenant_id=%s AND id=%s", (tenant, identity)
        ).fetchone()


def test_ambiguous_pr_timeout_retry_reconciles_one_branch_one_draft(seeded_store, monkeypatch):
    store, tenant, repo, identity, _ = seeded_store
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5173")
    case = ready_case(store, tenant, repo, identity)
    job = store.claim("publisher")
    github = PublishingGitHub(case["base_sha"])
    github.timeout_once = True
    with pytest.raises(httpx.ReadTimeout):
        publish(store, job, case, github)
    publish(store, job, case, github)
    assert len(github.prs) == 1 and github.prs[0]["draft"]
    assert len(github.refs) == 1
    assert github.mutations.count("/pulls") == 1
    with store.transaction() as db:
        assert (
            db.execute(
                "SELECT state FROM cases WHERE tenant_id=%s AND id=%s", (tenant, identity)
            ).fetchone()["state"]
            == "pr_opened"
        )
        assert (
            db.execute(
                "SELECT count(*) AS count FROM guards WHERE tenant_id=%s AND case_id=%s",
                (tenant, identity),
            ).fetchone()["count"]
            == 1
        )


def test_changed_head_supersedes_old_verification_without_repository_writes(seeded_store):
    store, tenant, repo, identity, _ = seeded_store
    case = ready_case(store, tenant, repo, identity)
    github = PublishingGitHub("d" * 40)
    publish(store, store.claim("publisher"), case, github)
    assert not github.mutations
    with store.transaction() as db:
        assert (
            db.execute(
                "SELECT state FROM cases WHERE tenant_id=%s AND id=%s", (tenant, identity)
            ).fetchone()["state"]
            == "superseded"
        )
