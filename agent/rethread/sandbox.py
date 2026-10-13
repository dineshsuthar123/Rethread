"""E2B-only execution. Missing provider or malformed evidence fails closed."""

import json
import os
import shlex
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import uuid4
from xml.etree import ElementTree

from e2b import CommandExitException, Sandbox

from .contracts import Check
from .policy import digest, safe_path
from .redaction import redact


class SandboxUnavailable(RuntimeError):
    pass


@dataclass
class Evidence:
    check: Check
    output: str


class SandboxProvider(Protocol):
    def check(self, files: dict[str, bytes], kind: str, test: str, phase: str) -> Evidence: ...
    def close(self): ...


def normalize(kind, phase, command, code, output, report, duration, test=""):
    collected = None
    valid = False
    reason = None
    try:
        if kind == "pytest":
            root = ElementTree.fromstring(report)
            suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
            collected = sum(int(s.attrib["tests"]) for s in suites)
            failed = sum(
                int(s.attrib.get("failures", 0)) + int(s.attrib.get("errors", 0)) for s in suites
            )
            skipped = sum(int(s.attrib.get("skipped", 0)) for s in suites)
            valid = (
                collected > 0
                and skipped < collected
                and code in (0, 1)
                and (code != 0 or failed == 0)
            )
        elif kind == "ruff":
            issues = json.loads(report)
            valid = isinstance(issues, list) and all(
                isinstance(i, dict) and "code" in i for i in issues
            )
            valid = valid and code in (0, 1) and (code != 0 or len(issues) == 0)
        else:
            raise ValueError("Unknown runner")
        if not valid:
            reason = "Invalid, empty, missing-tool or inconsistent runner evidence"
    except (ValueError, KeyError, ElementTree.ParseError, TypeError):
        reason = "Missing or invalid runner report"
    check = Check(
        id=str(uuid4()),
        phase=phase,
        name=kind if not test else test,
        command=command,
        exitCode=code,
        collected=collected,
        passed=valid and code == 0,
        outputHash=digest(redact(output)),
        durationMs=duration,
        reason=reason,
    )
    return Evidence(check, redact(output))


class E2BProvider:
    def __init__(
        self, on_sandbox=lambda identity: None, cancelled=lambda: False, before_create=None
    ):
        if (
            os.getenv("FREE_ONLY", "true") == "true"
            and os.getenv("E2B_FREE_ENTITLEMENT_CONFIRMED") != "true"
        ):
            raise SandboxUnavailable(
                "Confirm available E2B Hobby credits privately; paid sandbox usage is disabled"
            )
        if not os.getenv("E2B_API_KEY") or not os.getenv("E2B_TEMPLATE_ID"):
            raise SandboxUnavailable("E2B credentials and a validated template are required")
        self.on_sandbox = on_sandbox
        self.cancelled = cancelled
        self.active = None
        self.last_recipe = None
        self.before_create = before_create

    def check(self, files, kind, test, phase):
        if self.cancelled():
            raise SandboxUnavailable("Job cancelled")
        if self.before_create is None:
            raise SandboxUnavailable(
                "A trusted free-credit reservation is required before sandbox creation"
            )
        self.before_create()
        sandbox = Sandbox.create(
            template=os.environ["E2B_TEMPLATE_ID"],
            api_key=os.environ["E2B_API_KEY"],
            timeout=300,
            secure=True,
            network={
                "allow_out": ["pypi.org", "files.pythonhosted.org"],
                "deny_out": ["0.0.0.0/0"],
            },
        )
        self.active = sandbox
        self.on_sandbox(sandbox.sandbox_id)
        try:
            # No Git tokens, model keys, DB settings or host environment are transferred.
            sandbox.commands.run(
                "mkdir -p /workspace /evidence "
                "/opt/rethread && chown user:user /workspace /evidence",
                user="root",
                timeout=10,
            )
            for path, data in files.items():
                safe_path(path)
                sandbox.files.write(f"/workspace/{path}", data, user="user")
            install = sandbox.commands.run(
                (
                    "/opt/rethread/venv/bin/python -m pip install --only-bin"
                    "ary=:all: --require-hashes --no-deps -r /workspace/requ"
                    "irements.lock >/opt/rethread/install.log 2>&1"
                ),
                user="root",
                cwd="/workspace",
                timeout=90,
            )
            if install.exit_code != 0:
                raise SandboxUnavailable("Pinned dependency installation failed")
            freeze = sandbox.commands.run(
                (
                    "/opt/rethread/venv/bin/python --version && /opt/rethrea"
                    "d/venv/bin/python -m pytest --version && /opt/rethread/"
                    "venv/bin/python -m ruff --version && /opt/rethread/venv"
                    "/bin/python -m pip freeze --all"
                ),
                user="user",
                timeout=10,
            )
            self.last_recipe = {
                "templateId": os.environ["E2B_TEMPLATE_ID"],
                "toolVersions": redact(freeze.stdout),
                "requirementsHash": digest(files["requirements.lock"]),
                "dependencyInstall": "python -m pip install "
                "--require-hashes --no-deps -r requirements.lock",
                "network": "Package registry egress only for install; denied for checks",
                "complete": True,
            }
            sandbox.update_network({"allow_out": [], "deny_out": ["0.0.0.0/0"]})
            # A valid TCP connect is insufficient: require no HTTP response bytes.
            for address in ("http://169.254.169.254/", "http://10.0.0.1/", "https://example.com/"):
                try:
                    probe = sandbox.commands.run(
                        f"curl -sS -I --max-time 2 {shlex.quote(address)}", user="user", timeout=5
                    )
                except CommandExitException as denied:
                    probe = denied
                if probe.stdout.strip():
                    raise SandboxUnavailable("Network isolation probe received application bytes")
            if self.cancelled():
                raise SandboxUnavailable("Job cancelled")
            if kind == "pytest":
                command = (
                    f"python -m pytest -q {shlex.quote(test) if test else ''} "
                    "--junitxml=/evidence/report.xml"
                )
            elif kind == "ruff":
                command = "python -m ruff check --output-format=json ."
            else:
                raise SandboxUnavailable("Unsupported evaluator")
            sandbox.files.write(
                "/opt/rethread/evaluator.py",
                Path(__file__).with_name("evaluator.py").read_bytes(),
                user="root",
            )
            sandbox.commands.run(
                "chmod -R go-w /opt/rethread && chmod 755 /opt/rethread", user="root", timeout=10
            )
            started = time.monotonic()
            try:
                sandbox.commands.run(
                    "/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin "
                    "python3 -I -S /opt/rethread/evaluator.py "
                    f"{shlex.quote(kind)} {shlex.quote(test)}",
                    user="root",
                    timeout=90,
                )
                result = json.loads(sandbox.files.read("/opt/rethread/result.json", user="root"))
                if len(result["output"]) > 2 * 1024 * 1024:
                    raise ValueError("Evaluator output exceeds limit")
                return normalize(
                    kind,
                    phase,
                    command,
                    result["exitCode"],
                    result["output"],
                    result["report"],
                    result["durationMs"],
                    test,
                )
            except Exception as exc:
                return normalize(
                    kind,
                    phase,
                    command,
                    None,
                    f"Runner failed: {type(exc).__name__}",
                    "",
                    int((time.monotonic() - started) * 1000),
                    test,
                )
        finally:
            self.close()

    def close(self):
        if self.active:
            try:
                self.active.kill()
            finally:
                self.active = None
