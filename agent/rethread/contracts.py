from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

VERSION = 1
STATES = (
    "queued",
    "capturing",
    "reproducing",
    "diagnosing",
    "proposing",
    "verifying",
    "ready_for_review",
    "publishing",
    "pr_opened",
    "needs_input",
    "unsupported",
    "blocked",
    "failed",
    "cancelled",
    "rejected",
    "superseded",
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChangedFile(StrictModel):
    path: str = Field(min_length=1, max_length=300)
    baseHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    content: str = Field(max_length=100_000)


class Guard(StrictModel):
    path: str = Field(pattern=r"^tests/guards/test_[a-zA-Z0-9_]+\.py$")
    content: str = Field(min_length=1, max_length=30_000)
    test: str = Field(pattern=r"^tests/guards/test_[a-zA-Z0-9_]+\.py::test_[a-zA-Z0-9_]+$")
    contract: str = Field(min_length=4, max_length=4000)
    paths: list[str] = Field(min_length=1, max_length=20)


class Plan(StrictModel):
    rationale: str = Field(min_length=10, max_length=4000)
    files: list[ChangedFile] = Field(min_length=1, max_length=8)
    guard: Guard | None


class Check(StrictModel):
    id: str
    phase: Literal["base", "candidate", "guard_base", "guard_candidate", "preflight"]
    name: str
    command: str
    exitCode: int | None
    collected: int | None
    passed: bool
    outputHash: str
    artifactId: str | None = None
    durationMs: int
    reason: str | None = None
