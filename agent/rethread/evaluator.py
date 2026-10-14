"""Pinned runner uploaded outside the writable source tree; runs inside E2B only.

The trusted worker reads this file as bytes, never executes repository commands.
"""

import json
import os
import pwd
import selectors
import signal
import subprocess
import sys
import time
from pathlib import Path


def main():
    kind, selected = sys.argv[1:3]
    user = pwd.getpwnam("user")
    report = Path("/evidence/report.xml")
    args = (
        [
            "/opt/rethread/venv/bin/python",
            "-m",
            "pytest",
            "-q",
            *([selected] if selected else []),
            f"--junitxml={report}",
        ]
        if kind == "pytest"
        else ["/opt/rethread/venv/bin/python", "-m", "ruff", "check", "--output-format=json", "."]
    )

    def demote():
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)

    env = {
        "PATH": "/opt/rethread/venv/bin:/usr/bin:/bin",
        "HOME": "/home/user",
        "LANG": "C.UTF-8",
        "PYTHONPATH": "/workspace",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
    }
    started = time.monotonic()
    process = subprocess.Popen(
        args,
        cwd="/workspace",
        env=env,
        preexec_fn=demote,
        start_new_session=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    output = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    timed_out = False
    truncated = False
    while selector.get_map():
        if time.monotonic() - started > 80:
            os.killpg(process.pid, signal.SIGKILL)
            timed_out = True
            break
        for key, _ in selector.select(timeout=0.2):
            chunk = os.read(key.fileobj.fileno(), 65536)
            if not chunk:
                selector.unregister(key.fileobj)
                continue
            remaining = 2 * 1024 * 1024 - len(output)
            output.extend(chunk[:remaining])
            truncated |= len(chunk) > remaining
    code = process.wait(timeout=5)
    text = output.decode(errors="replace")
    report_text = (
        report.read_text()[: 2 * 1024 * 1024]
        if kind == "pytest" and report.exists()
        else text
        if kind == "ruff"
        else ""
    )
    Path("/opt/rethread/result.json").write_text(
        json.dumps(
            {
                "exitCode": None if timed_out else code,
                "output": text,
                "report": report_text,
                "durationMs": int((time.monotonic() - started) * 1000),
                "truncated": truncated,
            }
        )
    )


if __name__ == "__main__":
    main()
