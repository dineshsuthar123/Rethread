import copy
import json
import os
from types import SimpleNamespace

import pytest

from agent.rethread.sandbox import E2BProvider, SandboxUnavailable, verified_network_isolation

ADDRESSES = (
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://1.1.1.1/",
    "http://[2606:4700:4700::1111]/",
    "https://example.com/",
    "https://pypi.org/simple/",
)


def isolation_report():
    return {
        "verified": True,
        "namespaceSeparated": True,
        "noNewPrivileges": True,
        "probes": [{"address": a, "exitCode": 7, "responseBytes": 0} for a in ADDRESSES],
    }


def test_worker_requires_complete_network_denial_evidence():
    assert verified_network_isolation(isolation_report())
    for key in ("verified", "namespaceSeparated", "noNewPrivileges", "probes"):
        report = isolation_report()
        del report[key]
        assert not verified_network_isolation(report)
    for key, bad in (("responseBytes", 1), ("exitCode", 0), ("exitCode", 127)):
        report = isolation_report()
        report["probes"][0][key] = bad
        assert not verified_network_isolation(report)
    report = isolation_report()
    report["probes"][0] = copy.deepcopy(report["probes"][1])
    assert not verified_network_isolation(report)


@pytest.mark.parametrize("verified", [True, False])
def test_provider_requires_isolated_runner_evidence_and_always_kills_sandbox(monkeypatch, verified):
    from agent.rethread import sandbox as module

    monkeypatch.setenv("E2B_API_KEY", "test-key")
    monkeypatch.setenv("E2B_TEMPLATE_ID", "test-template")
    monkeypatch.setenv("E2B_FREE_ENTITLEMENT_CONFIRMED", "true")
    commands = []
    killed = []

    def run(command, **kwargs):
        commands.append(command)
        return SimpleNamespace(exit_code=0, stdout="tool versions")

    report = isolation_report() if verified else {"verified": False}
    result = {
        "isolation": report,
        "exitCode": 1,
        "output": "captured failure",
        "report": '<testsuites><testsuite tests="1" failures="1"/></testsuites>',
        "durationMs": 1,
    }
    fake = SimpleNamespace(
        sandbox_id="test-id",
        commands=SimpleNamespace(run=run),
        files=SimpleNamespace(write=lambda *a, **k: None, read=lambda *a, **k: json.dumps(result)),
        update_network=lambda *a: None,
        kill=lambda: killed.append(True),
    )
    monkeypatch.setattr(module.Sandbox, "create", lambda **kwargs: fake)
    provider = E2BProvider(before_create=lambda: None)
    if verified:
        evidence = provider.check({"requirements.lock": b""}, "pytest", "", "base")
        assert evidence.check.exitCode == 1 and not evidence.check.reason
        assert provider.last_recipe["complete"]
    else:
        with pytest.raises(SandboxUnavailable, match="isolation was not verified"):
            provider.check({"requirements.lock": b""}, "pytest", "", "base")
        assert not provider.last_recipe["complete"]
    assert any(
        command.startswith("/usr/bin/unshare --net -- /usr/bin/env -i") for command in commands
    )
    assert killed == [True]


@pytest.fixture
def evaluator():
    if os.name != "posix":
        pytest.skip("The trusted evaluator runs only inside a Linux sandbox")
    from agent.rethread import evaluator

    return evaluator


def test_same_network_namespace_is_rejected_before_target_execution(evaluator, monkeypatch):
    monkeypatch.setattr(evaluator.os, "readlink", lambda _: "net:[1]")
    monkeypatch.setattr(evaluator.subprocess, "run", lambda *a, **k: pytest.fail("Probe ran"))
    with pytest.raises(RuntimeError, match="namespace"):
        evaluator.network_isolation({}, lambda: None)


@pytest.mark.parametrize(
    "response,code", [(b"HTTP/1.1 501 Firecracker API\r\n", 0), (b" ", 7), (b"", 0), (b"", 127)]
)
def test_metadata_response_and_invalid_probes_fail_closed(evaluator, monkeypatch, response, code):
    monkeypatch.setattr(evaluator.os, "readlink", lambda p: "net:[1]" if "/1/" in p else "net:[2]")
    monkeypatch.setattr(
        evaluator.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(stdout=response, returncode=code),
    )
    with pytest.raises(RuntimeError, match="isolation probe"):
        evaluator.network_isolation({}, lambda: None)


def test_all_probes_use_the_same_unprivileged_environment(evaluator, monkeypatch):
    monkeypatch.setattr(evaluator.os, "readlink", lambda p: "net:[1]" if "/1/" in p else "net:[2]")
    calls = []
    env = {"PATH": "/usr/bin:/bin"}

    def demote():
        pass

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(stdout=b"", returncode=7)

    monkeypatch.setattr(evaluator.subprocess, "run", run)
    result = evaluator.network_isolation(env, demote)
    assert verified_network_isolation(result)
    assert tuple(call[0][-1] for call in calls) == ADDRESSES
    assert all(call[1]["env"] is env and call[1]["preexec_fn"] is demote for call in calls)
    assert all(call[0][:4] == ["/usr/bin/curl", "-q", "--noproxy", "*"] for call in calls)
