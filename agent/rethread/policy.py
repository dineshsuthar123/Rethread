"""Exact in-memory source changes, with no execution or fuzzy substitutions."""

import ast
import difflib
import hashlib
import io
import re
import tarfile
from pathlib import PurePosixPath

from .contracts import Plan


class PolicyError(ValueError):
    pass


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def safe_path(path: str) -> str:
    p = PurePosixPath(path)
    if (
        not path
        or "\\" in path
        or ":" in path
        or "\x00" in path
        or p.is_absolute()
        or any(x in ("..", ".", "") for x in path.split("/"))
    ):
        raise PolicyError("Unsafe source path")
    return str(p)


def unpack_archive(data: bytes) -> dict[str, bytes]:
    if len(data) > 30 * 1024 * 1024:
        raise PolicyError("Source archive exceeds compressed limit")
    files: dict[str, bytes] = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            safe_path(member.name.rstrip("/"))
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise PolicyError("Source archive links and special entries are forbidden")
            if member.isdir():
                continue
            parts = member.name.split("/")
            if len(parts) < 2:
                raise PolicyError("Source archive must have a root directory")
            path = safe_path("/".join(parts[1:]))
            if path in files or member.size > 1024 * 1024 or len(files) >= 5000:
                raise PolicyError("Source archive file limit or duplicate path")
            total += member.size
            if total > 25 * 1024 * 1024:
                raise PolicyError("Source expansion limit exceeded")
            if path.startswith(".git/") or (
                PurePosixPath(path).name.startswith(".env") and not path.endswith(".example")
            ):
                raise PolicyError("Archive contains credential-bearing or Git files")
            stream = archive.extractfile(member)
            if stream is None:
                raise PolicyError("Archive file is unreadable")
            files[path] = stream.read(member.size + 1)
    if ".gitmodules" in files:
        raise PolicyError("Submodules are not supported")
    return files


FORBIDDEN = re.compile(
    r"(?:pytest\.(?:skip|xfail)|@.*(?:skip|xfail)|#\s*(?:noqa|type:\s*ignore|ruff:)|\bassert\s+True\b)",
    re.I,
)


def validate_guard(content: str, test: str):
    if FORBIDDEN.search(content):
        raise PolicyError("Guard suppresses verification")
    tree = ast.parse(content)
    name = test.split("::")[-1]
    matching = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
    if len(matching) != 1 or not any(isinstance(n, ast.Assert) for n in ast.walk(matching[0])):
        raise PolicyError("Guard needs a named test with an executable assertion")


def apply_plan(files: dict[str, bytes], plan: Plan, contract: str, kind: str):
    changed = dict(files)
    diff = []
    seen = set()
    for change in plan.files:
        path = safe_path(change.path)
        if path in seen or path not in files or digest(files[path]) != change.baseHash:
            raise PolicyError("Ambiguous, missing or stale candidate file")
        seen.add(path)
        if (
            not path.endswith(".py")
            or path.startswith(("tests/", "test/", ".", "infrastructure/"))
            or PurePosixPath(path).name.startswith(("test_", "conftest", "setup"))
        ):
            raise PolicyError(
                "Only existing Python source may change; tests and policy are retained"
            )
        if FORBIDDEN.search(change.content):
            raise PolicyError("Candidate suppresses checks")
        ast.parse(change.content)
        before = files[path].decode("utf-8")
        delta = list(
            difflib.unified_diff(
                before.splitlines(keepends=True),
                change.content.splitlines(keepends=True),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
            )
        )
        diff.extend(delta)
        changed[path] = change.content.encode()
    if not diff or sum(len(x.encode()) for x in diff) > 100_000:
        raise PolicyError("Empty or oversized patch")
    if kind == "pytest":
        if not plan.guard or not contract or plan.guard.contract != contract:
            raise PolicyError("A behavior repair requires the developer's exact contract and guard")
    if plan.guard:
        guard = plan.guard
        safe_path(guard.path)
        if guard.path in files or not guard.test.startswith(f"{guard.path}::"):
            raise PolicyError("Guard must be an additive test")
        if not set(guard.paths).issubset(seen):
            raise PolicyError("Guard source links must refer to changed files")
        validate_guard(guard.content, guard.test)
        changed[guard.path] = guard.content.encode()
        diff.extend(
            difflib.unified_diff(
                [],
                guard.content.splitlines(keepends=True),
                fromfile="/dev/null",
                tofile=f"b/{guard.path}",
            )
        )
    return changed, "".join(diff)


def pinned_requirements(files: dict[str, bytes]) -> str:
    if not any(p.endswith(".py") for p in files):
        raise PolicyError("unsupported: Only Python/pytest/Ruff is supported")
    if "requirements.lock" not in files:
        raise PolicyError(
            "needs_input: Supply requirements.lock with exact versions and SHA256 hashes (empty is valid for stdlib-only projects)"
        )
    text = files["requirements.lock"].decode()
    joined = text.replace("\\\n", " ")
    for line in joined.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not re.fullmatch(
            r"[a-zA-Z0-9_.-]+(?:\[[a-zA-Z0-9_,.-]+\])?==[a-zA-Z0-9_.+!-]+(?:\s+--hash=sha256:[a-f0-9]{64})+",
            line,
        ):
            raise PolicyError(
                "needs_input: Dependency recipe is incomplete or contains unsupported sources"
            )
    return text
