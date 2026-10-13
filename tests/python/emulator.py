"""Controlled test-only provider. Never imported by production orchestration.

Only this repository's authored fixture is executed on the test host.
This provides no evidence of production sandbox/network isolation.
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from agent.rethread.sandbox import normalize

ROOT = Path(__file__).parents[1] / "fixtures" / "duplicate_delivery"
CONTRACT = "Delivering the same event twice queues exactly one notification."


def fixture_files():
    return {str(p.relative_to(ROOT / "base")).replace("\\", "/"): p.read_bytes()
            for p in (ROOT / "base").rglob("*") if p.is_file()}


class FixtureProvider:
    last_recipe = {"complete": True, "provider": "controlled-test-emulator", "toolVersions": "See test execution output", "networkIsolation": "not tested by emulator"}

    def check(self, files, kind, test, phase):
        allowed = set(fixture_files()) | {"tests/guards/test_duplicate_delivery.py"}
        if not set(files).issubset(allowed):
            raise ValueError("Test emulator accepts only the authored fixture")
        with tempfile.TemporaryDirectory(prefix="rethread-controlled-fixture-") as directory:
            root = Path(directory)
            for name, data in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            report = root / "report.xml"
            args = [sys.executable, "-m", "pytest", "-q", *([test] if test else []), f"--junitxml={report}"] if kind == "pytest" else [sys.executable, "-m", "ruff", "check", "--output-format=json", "."]
            started = time.monotonic()
            result = subprocess.run(args, cwd=root, env={"PATH": os.environ.get("PATH", ""), "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "PYTHONPATH": str(root), "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"}, capture_output=True, text=True, timeout=30)
            content = report.read_text() if kind == "pytest" and report.exists() else result.stdout
            return normalize(kind, phase, " ".join(args[2:]), result.returncode,
                             result.stdout + result.stderr, content,
                             int((time.monotonic()-started)*1000), test)

    def close(self):
        pass
