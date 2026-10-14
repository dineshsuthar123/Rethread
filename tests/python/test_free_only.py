import pytest

from agent.rethread.planner import plan
from agent.rethread.sandbox import E2BProvider, SandboxUnavailable


def test_no_sandbox_is_created_without_confirmed_free_entitlement(monkeypatch):
    monkeypatch.setenv("FREE_ONLY", "true")
    monkeypatch.setenv("E2B_API_KEY", "example-not-a-real-key")
    monkeypatch.setenv("E2B_TEMPLATE_ID", "example-template")
    monkeypatch.delenv("E2B_FREE_ENTITLEMENT_CONFIRMED", raising=False)
    with pytest.raises(SandboxUnavailable, match="paid sandbox usage is disabled"):
        E2BProvider()


def test_paid_llm_destination_is_blocked_before_any_request(monkeypatch):
    monkeypatch.setenv("FREE_ONLY", "true")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("FREE_LLM_ENTITLEMENT_CONFIRMED", "true")
    with pytest.raises(ValueError, match="paid LLM usage is disabled"):
        plan(None, {}, {}, {}, [])
