"""Build the isolated evaluator template using privately configured E2B credentials."""
import os

from e2b import Template

template = (Template().from_image("e2bdev/base")
            .run_cmd("python3 -m venv /opt/rethread/venv && /opt/rethread/venv/bin/pip install pytest==9.1.1 ruff==0.17.0", user="root")
            .run_cmd("mkdir -p /workspace /evidence /opt/rethread && chown user:user /workspace /evidence && chmod -R go-w /opt/rethread", user="root"))
if __name__ == "__main__":
    result = Template.build(template, alias="rethread-python-v1", api_key=os.environ["E2B_API_KEY"])
    print(f"E2B template: {result.template_id}; build: {result.build_id}")
