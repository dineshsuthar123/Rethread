import { createSign } from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./security.js";
const api = "https://api.github.com";
export async function github<T = any>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new HttpError(
      response.status === 401 || response.status === 403 ? 403 : 502,
      `GitHub request failed (${response.status})`,
      "github_unavailable",
    );
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
export function appJwt() {
  if (!config.appId || !config.appKey)
    throw new HttpError(503, "GitHub App is not configured", "configuration");
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 540, iss: config.appId })}`;
  return `${message}.${createSign("RSA-SHA256").update(message).sign(config.appKey).toString("base64url")}`;
}
export async function installationToken(
  installationId: number,
  repositoryId: number,
) {
  const token = await github(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(),
    {
      method: "POST",
      body: JSON.stringify({
        repository_ids: [repositoryId],
        permissions: {
          contents: "write",
          pull_requests: "write",
          checks: "write",
          actions: "read",
        },
      }),
    },
  );
  return token.token as string;
}
export async function assertRepository(
  userToken: string,
  installationId: number,
  repoId: number,
) {
  const installations = await github(
    "/user/installations?per_page=100",
    userToken,
  );
  if (
    !installations.installations.some(
      (i: any) => i.id === installationId && i.app_id === Number(config.appId),
    )
  )
    throw new HttpError(
      403,
      "Install the Rethread App on this repository",
      "installation_denied",
    );
  for (let page = 1; page <= 20; page++) {
    const list = await github(
      `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      userToken,
    );
    if (list.repositories.some((r: any) => r.id === repoId)) return;
    if (list.repositories.length < 100) break;
  }
  throw new HttpError(
    403,
    "Repository is outside this installation",
    "repository_denied",
  );
}
