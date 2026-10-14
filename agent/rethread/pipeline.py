import json
import os

from .policy import PolicyError, apply_plan, digest, pinned_requirements


def repair(store, job, case, github, provider, planner):
    request = case["data"]["request"]
    reproduction = request.get("reproduction")
    if not reproduction or (
        reproduction["kind"] == "pytest" and not request.get("behaviorContract")
    ):
        store.save(
            job,
            "needs_input",
            reason="Supply an executable reproduction and intended behavior contract",
        )
        return
    if case["state"] == "ready_for_review":
        return  # Completed checkpoint survived a crash before job finalization.
    store.save(job, "capturing")
    files = github.source(case["base_sha"])
    requirements = pinned_requirements(files)
    test = reproduction.get("test", "")
    if reproduction["kind"] == "pytest" and (not test or test.split("::")[0] not in files):
        raise PolicyError("needs_input: Select an existing pytest test that expresses the failure")
    checks = []
    outputs = []

    def check(source, kind, selected, phase):
        store.heartbeat(job)
        evidence = provider.check(source, kind, selected, phase)
        evidence.check.artifactId = store.artifact(job, "log", evidence.output)
        checks.append(evidence.check.model_dump())
        outputs.append(evidence.output[:12_000])
        store.save(job, data={"checks": checks})
        return evidence.check

    store.save(job, "reproducing")
    baseline = check(files, reproduction["kind"], test, "base")
    if baseline.exitCode != 1 or baseline.reason or baseline.passed:
        store.save(
            job,
            "needs_input",
            reason="The captured reproduction did not produce a valid failing check",
        )
        return
    # Record the same inventory before and after the patch. Never auto-fix the base.
    check(files, "pytest", "", "base")
    check(files, "ruff", "", "base")
    if any(c["reason"] for c in checks):
        store.save(
            job, "blocked", reason="Baseline inventory contains missing or invalid tools/reports"
        )
        return
    recipe = provider.last_recipe
    if not recipe or not recipe.get("complete"):
        store.save(job, "needs_input", reason="Environment recipe was not resolved")
        return
    recipe = {**recipe, "requirements": requirements}
    store.save(job, "diagnosing", data={"recipe": recipe})
    checkpoint = job.get("checkpoint") or {}
    if checkpoint.get("plan"):
        from .contracts import Plan

        candidate_plan = Plan.model_validate(checkpoint["plan"])
    else:
        candidate_plan = planner(store, job, files, request, {"checks": checks, "output": outputs})
        store.save(job, checkpoint={"plan": candidate_plan.model_dump()})
    candidate, diff = apply_plan(
        files, candidate_plan, request["behaviorContract"], reproduction["kind"]
    )
    proposal = {
        **candidate_plan.model_dump(),
        "diff": diff,
        "digest": digest(
            json.dumps(
                {
                    "files": [f.model_dump() for f in candidate_plan.files],
                    "guard": candidate_plan.guard.model_dump() if candidate_plan.guard else None,
                },
                sort_keys=True,
            )
        ),
    }
    # Redaction cannot silently alter a candidate's source/hash. Such proposals are blocked.
    from .redaction import redact

    if redact(json.dumps(proposal)) != json.dumps(proposal):
        raise PolicyError("Candidate contains credential-like content; cannot safely retain it")
    store.save(job, "proposing", data={"proposal": proposal})
    store.save(job, "verifying")
    verified = [
        check(candidate, reproduction["kind"], test, "candidate"),
        check(candidate, "pytest", "", "candidate"),
        check(candidate, "ruff", "", "candidate"),
    ]
    if candidate_plan.guard:
        base_guard = {**files, candidate_plan.guard.path: candidate_plan.guard.content.encode()}
        gbase = check(base_guard, "pytest", candidate_plan.guard.test, "guard_base")
        gpatch = check(candidate, "pytest", candidate_plan.guard.test, "guard_candidate")
        if gbase.exitCode != 1 or gbase.reason or not gpatch.passed:
            store.save(
                job, "failed", reason="Guard must genuinely fail on base and pass on candidate"
            )
            return
    if not all(c.passed for c in verified):
        store.save(job, "failed", reason="Candidate did not pass every required unchanged check")
        return
    source_digest = digest(
        json.dumps({p: digest(b) for p, b in sorted(candidate.items())}, sort_keys=True)
    )
    store.save(
        job,
        "ready_for_review",
        data={"checks": checks, "sourceDigest": source_digest},
        checkpoint={"verified": True, "plan": candidate_plan.model_dump()},
    )
    case_url = f"{os.environ['PUBLIC_ORIGIN']}/studio/cases/{case['id']}"
    github.check(
        case["base_sha"],
        "captured failure",
        "failure",
        f"Reproduction: {baseline.command}\nExit: {baseline.exitCode}\n"
        f"Output SHA256: {baseline.outputHash}",
        case_url,
        f"case:{case['id']}:base",
    )
