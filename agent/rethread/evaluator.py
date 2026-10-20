"""Pinned runner uploaded outside the writable source tree; runs inside E2B only.

The trusted worker reads this file as bytes, never executes repository commands.
"""

import ctypes
import json
import os
import pwd
import selectors
import signal
import subprocess
import sys
import time
from pathlib import Path

NETWORK_PROBES = (
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://1.1.1.1/",
    "http://[2606:4700:4700::1111]/",
    "https://example.com/",
    "https://pypi.org/simple/",
)


def network_isolation(env, demote):
    # The provider firewall does not cover the guest's local metadata service.
    # Require a separate kernel network namespace as well as provider egress rules.
    if os.readlink("/proc/self/ns/net") == os.readlink("/proc/1/ns/net"):
        raise RuntimeError("Target network namespace is not isolated")
    probes = []
    for address in NETWORK_PROBES:
        probe = subprocess.run(
            ["/usr/bin/curl", "-q", "--noproxy", "*", "-sS", "-I", "--max-time", "2", address],
            env=env,
            preexec_fn=demote,
            capture_output=True,
            timeout=5,
        )
        if probe.stdout or probe.returncode not in (6, 7, 28, 35, 52, 56):
            raise RuntimeError("Network isolation probe received bytes or an invalid denial")
        probes.append({"address": address, "exitCode": probe.returncode, "responseBytes": 0})
    return {"verified": True, "namespaceSeparated": True, "noNewPrivileges": True, "probes": probes}


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
        # Prevent target code from regaining privileges through a setuid binary.
        if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
            raise RuntimeError("Cannot require no-new-privileges")
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
    try:
        isolation = network_isolation(env, demote)
    except Exception as error:
        Path("/opt/rethread/result.json").write_text(
            json.dumps(
                {
                    "isolation": {"verified": False},
                    "error": f"Target network isolation failed: {type(error).__name__}",
                }
            )
        )
        return
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
                "isolation": isolation,
            }
        )
    )


if __name__ == "__main__":
    main()
