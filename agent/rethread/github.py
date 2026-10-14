import os
import time
from urllib.parse import quote

import httpx
import jwt

from .policy import unpack_archive


class GitHub:
    def __init__(self, repository):
        self.repository = repository
        self.name = repository["full_name"]
        key = os.getenv("GITHUB_APP_PRIVATE_KEY", "").replace("\\n", "\n")
        app_id = os.getenv("GITHUB_APP_ID")
        if not key or not app_id:
            raise ValueError("blocked: GitHub App credentials are missing")
        now = int(time.time())
        token = jwt.encode(
            {"iat": now - 60, "exp": now + 540, "iss": app_id}, key, algorithm="RS256"
        )
        self.client = httpx.Client(
            base_url="https://api.github.com",
            timeout=30,
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Authorization": f"Bearer {token}",
            },
        )
        access = self.client.post(
            f"/app/installations/{repository['installation_id']}/access_tokens",
            json={
                "repository_ids": [repository["github_id"]],
                "permissions": {
                    "contents": "write",
                    "pull_requests": "write",
                    "checks": "write",
                    "actions": "read",
                },
            },
        )
        access.raise_for_status()
        self.client.headers["Authorization"] = f"Bearer {access.json()['token']}"

    def request(self, method, path, **kwargs):
        response = self.client.request(method, f"/repos/{self.name}{path}", **kwargs)
        response.raise_for_status()
        return response.json()

    def head(self, branch):
        return self.request("GET", f"/git/ref/heads/{quote(branch, safe='')}")["object"]["sha"]

    def source(self, sha):
        # GitHub returns a short-lived signed archive URL; never forward an App token.
        response = self.client.get(f"/repos/{self.name}/tarball/{sha}")
        if response.status_code != 302:
            response.raise_for_status()
            raise ValueError("Unexpected GitHub archive response")
        url = httpx.URL(response.headers["location"])
        if url.scheme != "https" or url.host != "codeload.github.com":
            raise ValueError("Archive redirect was not an authorized GitHub destination")
        data = bytearray()
        with httpx.stream("GET", str(url), timeout=60) as stream:
            stream.raise_for_status()
            for chunk in stream.iter_bytes():
                data.extend(chunk)
                if len(data) > 30 * 1024 * 1024:
                    raise ValueError("Source archive limit exceeded")
        return unpack_archive(bytes(data))

    def check(self, sha, name, conclusion, summary, case_url, external_id):
        existing = self.request("GET", f"/commits/{sha}/check-runs?per_page=100")
        matched = next(
            (c for c in existing["check_runs"] if c.get("external_id") == external_id), None
        )
        payload = {
            "name": f"Rethread / {name}",
            "status": "completed",
            "conclusion": conclusion,
            "output": {"title": name, "summary": summary[:60_000]},
            "details_url": case_url,
            "external_id": external_id,
        }
        if matched:
            return self.request("PATCH", f"/check-runs/{matched['id']}", json=payload)
        return self.request("POST", "/check-runs", json={**payload, "head_sha": sha})

    def close(self):
        self.client.close()
