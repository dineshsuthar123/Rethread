import os
import re


def redact(text: str) -> str:
    for name, value in os.environ.items():
        if (
            any(
                part in name
                for part in ("SECRET", "TOKEN", "API_KEY", "PRIVATE_KEY", "DATABASE_URL")
            )
            and len(value) > 8
        ):
            text = text.replace(value, "[redacted]")
    text = re.sub(r"\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+)\b", "[redacted]", text)
    return re.sub(
        r"(?i)(authorization|api[_-]?key|password|secret)([\s:=\"']+)[^\s,\"'}]+",
        r"\1\2[redacted]",
        text,
    )
