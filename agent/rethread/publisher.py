import json
import os
from urllib.parse import quote

import httpx
from psycopg.types.json import Jsonb

from .contracts import Plan
from .policy import apply_plan, digest


def publish(store, job, case, github):
    with store.transaction() as db:
        store.fenced(db, job)
        intent = db.execute(
            "SELECT * FROM publish_intents WHERE tenant_id=%s AND case_id=%s",
            (job["tenant_id"], job["case_id"]),
        ).fetchone()
    proposal = case["data"]["proposal"]
    if (
        not intent
        or intent["digest"] != proposal["digest"]
        or case["data"].get("approvedDigest") != proposal["digest"]
    ):
        raise ValueError("Publication requires the approved current proposal")
    files = github.source(case["base_sha"])
    plan = Plan.model_validate({k: proposal[k] for k in ("rationale", "files", "guard")})
    candidate, diff = apply_plan(
        files,
        plan,
        case["data"]["request"]["behaviorContract"],
        case["data"]["request"]["reproduction"]["kind"],
    )
    if (
        diff != proposal["diff"]
        or digest(
            json.dumps({"files": proposal["files"], "guard": proposal["guard"]}, sort_keys=True)
        )
        != proposal["digest"]
    ):
        raise ValueError("Approved candidate integrity mismatch")
    if github.head(case["branch"]) != case["base_sha"]:
        store.save(
            job,
            "superseded",
            reason="Repository head changed. Capture and verify the new head before publishing.",
        )
        return
    branch = intent["branch"]
    if not intent["commit_sha"]:
        base = github.request("GET", f"/git/commits/{case['base_sha']}")
        entries = []
        # The manifest and instructions are portable; they contain no tokens/source archive.
        portable = {
            "version": 1,
            "caseId": str(case["id"]),
            "baseSha": case["base_sha"],
            "behaviorContract": case["data"]["request"]["behaviorContract"],
            "recipe": case["data"]["recipe"],
            "checks": case["data"]["checks"],
            "guard": proposal["guard"],
            "sourceDigest": case["data"]["sourceDigest"],
        }
        writes = {p["path"]: candidate[p["path"]].decode() for p in proposal["files"]}
        if proposal["guard"]:
            writes[proposal["guard"]["path"]] = proposal["guard"]["content"]
        prefix = f".rethread/cases/{case['id']}"
        writes[f"{prefix}/manifest.json"] = json.dumps(portable, indent=2)
        writes[f"{prefix}/README.md"] = (
            "# Reproduce this Case\n\nUse a disposable isolated environment. Install the hashed requirements.lock.\nRun the reproduction command and unchanged pytest/Ruff suite listed in manifest.json.\nThe additive guard fails at the recorded base and passes on this repair.\nVerification is scoped to these checks, not all possible behavior.\n"
        )
        for path, content in writes.items():
            store.heartbeat(job)
            blob = github.request(
                "POST", "/git/blobs", json={"content": content, "encoding": "utf-8"}
            )
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        tree = github.request(
            "POST", "/git/trees", json={"base_tree": base["tree"]["sha"], "tree": entries}
        )
        commit = github.request(
            "POST",
            "/git/commits",
            json={
                "message": f"Rethread: {case['title']}",
                "tree": tree["sha"],
                "parents": [case["base_sha"]],
            },
        )
        with store.transaction() as db:
            store.fenced(db, job)
            db.execute(
                "UPDATE publish_intents SET commit_sha=%s WHERE tenant_id=%s AND case_id=%s",
                (commit["sha"], job["tenant_id"], job["case_id"]),
            )
        intent["commit_sha"] = commit["sha"]
    store.heartbeat(job)
    try:
        ref = github.request("GET", f"/git/ref/heads/{quote(branch, safe='')}")
        if ref["object"]["sha"] != intent["commit_sha"]:
            raise ValueError("Repair branch collision; refusing to overwrite")
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            raise
        github.request(
            "POST", "/git/refs", json={"ref": f"refs/heads/{branch}", "sha": intent["commit_sha"]}
        )
    store.heartbeat(job)
    if github.head(case["branch"]) != case["base_sha"]:
        store.save(
            job,
            "superseded",
            reason="Base changed before PR creation; the repair branch is retained for inspection",
        )
        return
    prs = github.request(
        "GET",
        "/pulls",
        params={
            "state": "all",
            "head": f"{github.name.split('/')[0]}:{branch}",
            "base": case["branch"],
        },
    )
    case_url = f"{os.environ['PUBLIC_ORIGIN']}/studio/cases/{case['id']}"
    checks = "\n".join(
        f"- {c['phase']}: `{c['command']}` — exit {c['exitCode']}, collected {c['collected']}, passed {c['passed']}"
        for c in case["data"]["checks"]
    )
    body = f"""## Symptom
{case["title"]}

Reproduced at `{case["base_sha"]}`.

## Root-cause hypothesis and scope
{proposal["rationale"]}

## Behavior contract and retained guard
{case["data"]["request"]["behaviorContract"] or "The recorded Ruff rule remains enabled."}

## Recorded checks
{checks}

## Limitations
Verification covers the captured reproduction, unchanged pytest/Ruff suite and retained guard.
The environment recipe is pinned, but byte-for-byte determinism is not promised.

[Inspect Case and evidence]({case_url})
"""
    store.heartbeat(job)
    pr = (
        prs[0]
        if prs
        else github.request(
            "POST",
            "/pulls",
            json={
                "title": f"Rethread: {case['title']}",
                "head": branch,
                "base": case["branch"],
                "body": body,
                "draft": True,
            },
        )
    )
    with store.transaction() as db:
        store.fenced(db, job)
        db.execute(
            "UPDATE publish_intents SET status='published',pr_url=%s WHERE tenant_id=%s AND case_id=%s",
            (pr["html_url"], job["tenant_id"], job["case_id"]),
        )
        guard = proposal["guard"]
        if guard:
            db.execute(
                """INSERT INTO guards(tenant_id,id,repository_id,case_id,test_name,path,contract,source_paths,content,last_sha,last_passed_at)
               VALUES(%s,gen_random_uuid(),%s,%s,%s,%s,%s,%s,%s,%s,now()) ON CONFLICT(tenant_id,case_id) DO NOTHING""",
                (
                    job["tenant_id"],
                    case["repository_id"],
                    case["id"],
                    guard["test"],
                    guard["path"],
                    guard["contract"],
                    guard["paths"],
                    guard["content"],
                    intent["commit_sha"],
                ),
            )
        db.execute(
            "UPDATE cases SET state='pr_opened',data=data||%s WHERE tenant_id=%s AND id=%s",
            (Jsonb({"prUrl": pr["html_url"]}), job["tenant_id"], job["case_id"]),
        )
        store.event(
            db,
            job["tenant_id"],
            job["case_id"],
            "state",
            {"state": "pr_opened", "prUrl": pr["html_url"]},
        )
    try:
        github.check(
            intent["commit_sha"],
            "repair evidence",
            "success",
            checks,
            case_url,
            f"case:{case['id']}:candidate",
        )
    except Exception:
        store.save(job, data={"checkRunSync": "failed; PR exists and is retained"})
