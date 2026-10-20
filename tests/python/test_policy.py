import ast
import io
import tarfile

import pytest
from pydantic import ValidationError

from agent.rethread.contracts import Plan
from agent.rethread.policy import (
    PolicyError,
    apply_plan,
    digest,
    normalize_guard_spacing,
    pinned_requirements,
    safe_path,
    unpack_archive,
)
from agent.rethread.sandbox import E2BProvider, SandboxUnavailable, normalize
from tests.python.emulator import CONTRACT, ROOT, fixture_files


def fixture_plan():
    return Plan.model_validate(
        {
            "rationale": "The duplicate delivery lacked an "
            "atomic event claim and enqueue transaction.",
            "files": [
                {
                    "path": "delivery.py",
                    "baseHash": digest(fixture_files()["delivery.py"]),
                    "content": (ROOT / "candidate.py").read_text(),
                }
            ],
            "guard": {
                "path": "tests/guards/test_duplicate_delivery.py",
                "content": (ROOT / "guard.py").read_text(),
                "test": "tests/guards/test_duplicate_delivery.py::test_duplicate_delivery",
                "contract": CONTRACT,
                "paths": ["delivery.py"],
            },
        }
    )


@pytest.mark.parametrize(
    "path", ["../secret", "/etc/passwd", "C:/temp/a.py", "a\\b", "a/../b", "a//b", "a/./b"]
)
def test_paths_are_exact_and_confined(path):
    with pytest.raises(PolicyError):
        safe_path(path)


@pytest.mark.parametrize("name,link", [("root/../../secret", False), ("root/link", True)])
def test_archive_rejects_traversal_and_symlinks(name, link):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        member = tarfile.TarInfo(name)
        if link:
            member.type = tarfile.SYMTYPE
            member.linkname = "/etc/passwd"
        archive.addfile(member)
    with pytest.raises(PolicyError):
        unpack_archive(buffer.getvalue())


def test_exact_hash_prevents_stale_or_fuzzy_edit():
    plan = fixture_plan()
    files = fixture_files()
    files["delivery.py"] += b"\n# changed head"
    with pytest.raises(PolicyError, match="stale"):
        apply_plan(files, plan, CONTRACT, "pytest")


@pytest.mark.parametrize(
    "path,content",
    [
        ("tests/test_delivery.py", "assert True\n"),
        (".github/workflows/ci.yml", ""),
        ("delivery.py", "# noqa\npass\n"),
        ("delivery.py", "import pytest\npytest.xfail('hide')\n"),
    ],
)
def test_original_tests_and_suppressions_are_forbidden(path, content):
    files = fixture_files()
    files.setdefault(path, b"original")
    plan = fixture_plan().model_copy(deep=True)
    plan.files[0].path = path
    plan.files[0].baseHash = digest(files[path])
    plan.files[0].content = content
    with pytest.raises(PolicyError):
        apply_plan(files, plan, CONTRACT, "pytest")


def test_planner_cannot_request_tools_or_publication():
    data = fixture_plan().model_dump()
    data["capabilities"] = ["publish", "send_secret", "allow_internet"]
    with pytest.raises(ValidationError):
        Plan.model_validate(data)


def test_oracle_contract_cannot_be_redefined_by_model():
    plan = fixture_plan().model_copy(deep=True)
    plan.guard.contract = "Two notifications are okay"
    with pytest.raises(PolicyError):
        apply_plan(fixture_files(), plan, CONTRACT, "pytest")


@pytest.mark.parametrize(
    "code,report",
    [
        (0, '<testsuites><testsuite tests="0"/></testsuites>'),
        (0, "not xml"),
        (5, '<testsuites><testsuite tests="0"/></testsuites>'),
        (None, ""),
        (127, ""),
        (0, '<testsuites><testsuite tests="1" failures="1"/></testsuites>'),
    ],
)
def test_empty_invalid_missing_tool_and_timeout_never_pass(code, report):
    assert not normalize("pytest", "candidate", "pytest", code, "output", report, 1).check.passed


def test_unavailable_sandbox_has_no_host_fallback(monkeypatch):
    monkeypatch.delenv("E2B_API_KEY", raising=False)
    with pytest.raises(SandboxUnavailable):
        E2BProvider()


def test_unpinned_dependencies_are_needs_input():
    files = fixture_files()
    files["requirements.lock"] = b"requests>=2\n"
    with pytest.raises(PolicyError, match="incomplete"):
        pinned_requirements(files)


def test_generated_guard_spacing_preserves_code_and_existing_tests():
    files = fixture_files()
    plan = fixture_plan()
    original = plan.guard.content.replace("\n\n\ndef ", "\n\n\n\ndef ")
    plan.guard.content = original
    changed, _ = apply_plan(files, plan, plan.guard.contract, "pytest")
    formatted = changed[plan.guard.path].decode()
    assert "\n\n\n\ndef " not in formatted
    assert "\n\n\ndef " in formatted
    assert ast.dump(ast.parse(original)) == ast.dump(ast.parse(formatted))
    assert plan.guard.content == formatted
    assert all(
        changed[path] == content for path, content in files.items() if path.startswith("tests/")
    )


def test_guard_spacing_preserves_multiline_literals_and_decorators():
    original = (
        'TEXT = """line\n\n\n\ndef inside_string():\n"""\n\n\n\n'
        "@decorator\ndef test_guard():\n    assert TEXT\n"
    )
    formatted = normalize_guard_spacing(original)
    assert '"""line\n\n\n\ndef inside_string():\n"""' in formatted
    assert "@decorator\ndef test_guard" in formatted
    assert ast.dump(ast.parse(original)) == ast.dump(ast.parse(formatted))
    assert normalize_guard_spacing(formatted) == formatted
