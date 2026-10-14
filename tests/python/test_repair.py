import json

from agent.rethread.pipeline import repair
from tests.python.emulator import CONTRACT, FixtureProvider, fixture_files
from tests.python.test_policy import fixture_plan


class RecordingStore:
    def __init__(self):
        self.state = "queued"
        self.data = {}

    def heartbeat(self, job):
        pass

    def artifact(self, job, kind, text):
        return "test-artifact"

    def save(self, job, state=None, data=None, **kwargs):
        if state:
            self.state = state
        self.data.update(data or {})


class FixtureGitHub:
    def source(self, sha):
        return fixture_files()

    def check(self, *args):
        pass


def test_real_fixture_fails_base_passes_repair_guard_and_catches_recurrence(monkeypatch, tmp_path):
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5173")
    store = RecordingStore()
    case = {
        "id": "fixture",
        "state": "queued",
        "base_sha": "a" * 40,
        "data": {
            "request": {
                "behaviorContract": CONTRACT,
                "reproduction": {
                    "kind": "pytest",
                    "test": "tests/test_delivery.py::test_retry_delivery",
                },
            }
        },
    }
    repair(
        store,
        {"checkpoint": {}},
        case,
        FixtureGitHub(),
        FixtureProvider(),
        lambda *args: fixture_plan(),
    )
    assert store.state == "ready_for_review"
    checks = store.data["checks"]
    assert checks[0]["exitCode"] == 1
    assert all(c["passed"] for c in checks if c["phase"] in ("candidate", "guard_candidate"))
    assert all(c["exitCode"] == 1 for c in checks if c["phase"] == "guard_base")
    regressed = {
        **fixture_files(),
        "tests/guards/test_duplicate_delivery.py": fixture_plan().guard.content.encode(),
    }
    recurrence = FixtureProvider().check(
        regressed, "pytest", fixture_plan().guard.test, "preflight"
    )
    assert recurrence.check.exitCode == 1 and not recurrence.check.passed
    report = {
        "provider": "controlled-test-emulator",
        "checks": checks,
        "recurrence": recurrence.check.model_dump(),
    }
    output = tmp_path / "fixture-evidence.json"
    output.write_text(json.dumps(report, indent=2))
    assert output.exists()
