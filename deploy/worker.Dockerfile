FROM python:3.12.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 rethread
COPY agent/rethread agent/rethread
COPY agent/__init__.py agent/__init__.py
COPY contracts/v1.json contracts/v1.json
USER rethread
ENV PYTHONUNBUFFERED=1 PATH=/app/.venv/bin:$PATH
CMD ["python", "-m", "agent.rethread.worker"]
