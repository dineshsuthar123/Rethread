FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
COPY --from=ghcr.io/astral-sh/uv:0.13.0@sha256:cdc6093146eb3ff6a40107b38f008b789e050e77ad87865e381d9917da55a168 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 rethread
COPY agent/rethread agent/rethread
COPY agent/__init__.py agent/__init__.py
COPY contracts/v1.json contracts/v1.json
COPY deploy/certs deploy/certs
USER rethread
ENV PYTHONUNBUFFERED=1 PATH=/app/.venv/bin:$PATH
ENV PGSSLMODE=verify-full PGSSLROOTCERT=/app/deploy/certs/supabase-root-ca.pem
CMD ["python", "-m", "agent.rethread.worker"]
