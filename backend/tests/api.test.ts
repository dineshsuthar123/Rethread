import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { canonicalRepo, encrypt, decrypt, hash } from "../src/security.js";
import { transitions } from "@rethread/contracts";
test("canonical GitHub identity rejects misleading hosts and credentials", () => {
  assert.equal(
    canonicalRepo("https://github.com/acme/alerts.git"),
    "acme/alerts",
  );
  for (const url of [
    "https://github.com.evil.test/acme/r",
    "https://evil.test/github.com/r",
    "http://github.com/acme/r",
    "https://token@github.com/acme/r",
    "https://github.com:444/acme/r",
    "https://github.com/acme/r/issues",
    "https://github.com/acme/%2e%2e",
    "https://github.com/acme/r?x=1",
  ])
    assert.throws(() => canonicalRepo(url));
});
test("session tokens are encrypted and authenticated", () => {
  const key = randomBytes(32).toString("base64");
  const cipher = encrypt("private-login-token", key);
  assert.ok(!cipher.includes("private-login-token"));
  assert.equal(decrypt(cipher, key), "private-login-token");
  assert.throws(() => decrypt(cipher, randomBytes(32).toString("base64")));
});
test("approval and publication are distinct transitions", () => {
  assert.ok(transitions.ready_for_review.includes("publishing"));
  assert.ok(!transitions.verifying.includes("publishing"));
  assert.equal(transitions.cancelled.length, 0);
});

const integration = Boolean(process.env.DATABASE_URL);
let pool: any, app: any, server: any, origin: string;
const tenantA = randomUUID(),
  tenantB = randomUUID(),
  repoA = randomUUID(),
  repoB = randomUUID(),
  caseA = randomUUID();
const cookieA = randomBytes(32).toString("hex"),
  cookieB = randomBytes(32).toString("hex"),
  csrf = "test-csrf";
const userA = Date.now(),
  userB = userA + 1;
before(async () => {
  if (!integration) return;
  process.env.NODE_ENV = "test";
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_WEBHOOK_SECRET = "controlled-webhook-secret";
  process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  ({ pool } = await import("../src/db.js"));
  ({ app } = await import("../src/server.js"));
  await pool.query(
    "INSERT INTO tenants(id,name) VALUES($1,'Test A'),($2,'Test B')",
    [tenantA, tenantB],
  );
  await pool.query(
    "INSERT INTO users(id,login,avatar_url) VALUES($1,'test-a',''),($2,'test-b','')",
    [userA, userB],
  );
  for (const [tenant, user, cookie, repo] of [
    [tenantA, userA, cookieA, repoA],
    [tenantB, userB, cookieB, repoB],
  ]) {
    await pool.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenant, user],
    );
    await pool.query(
      "INSERT INTO sessions(id_hash,user_id,tenant_id,csrf,token_cipher,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",
      [
        hash(String(cookie)),
        user,
        tenant,
        csrf,
        encrypt("fixture-user-token", process.env.SESSION_ENCRYPTION_KEY),
      ],
    );
    await pool.query(
      "INSERT INTO installations(tenant_id,id,account) VALUES($1,123,'fixture')",
      [tenant],
    );
    await pool.query(
      "INSERT INTO repositories(tenant_id,id,github_id,installation_id,full_name,default_branch) VALUES($1,$2,123,123,'fixture/repo','main')",
      [tenant, repo],
    );
  }
  await pool.query(
    "INSERT INTO cases(tenant_id,id,repository_id,title,state,base_sha,branch,data,idempotency_key,request_hash) VALUES($1,$2,$3,'Fixture failure','queued',$4,'main',$5,'test-create','hash')",
    [
      tenantA,
      caseA,
      repoA,
      "a".repeat(40),
      {
        request: {
          reproduction: { kind: "pytest", test: "tests/test_a.py::test_a" },
          behaviorContract: "One enqueue",
        },
      },
    ],
  );
  await pool.query(
    "INSERT INTO jobs(id,tenant_id,case_id,repository_id,kind) VALUES($1,$2,$3,$4,'repair')",
    [randomUUID(), tenantA, caseA, repoA],
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
const request = (
  path: string,
  cookie = cookieA,
  method = "GET",
  body?: unknown,
  withCsrf = true,
) =>
  fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Cookie: `rethread_session=${cookie}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "controlled-request-key",
      Origin: "http://localhost:5173",
      ...(withCsrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
test(
  "tenant B cannot read, stream, export, cancel, approve or publish tenant A Case",
  { skip: !integration },
  async () => {
    for (const suffix of ["", "/events", "/export"])
      assert.equal(
        (await request(`/cases/${caseA}${suffix}`, cookieB)).status,
        404,
      );
    for (const suffix of ["cancel", "approve", "publish"])
      assert.equal(
        (
          await request(`/cases/${caseA}/${suffix}`, cookieB, "POST", {
            digest: "a".repeat(64),
          })
        ).status,
        404,
      );
  },
);
test(
  "missing session and CSRF do not authorize mutation",
  { skip: !integration },
  async () => {
    assert.equal((await request(`/cases/${caseA}`, "wrong")).status, 401);
    assert.equal(
      (await request(`/cases/${caseA}/cancel`, cookieA, "POST", {}, false))
        .status,
      403,
    );
  },
);
test(
  "cancellation persists, fences workers, and event cursor reconnect is bounded",
  { skip: !integration },
  async () => {
    assert.equal(
      (await request(`/cases/${caseA}/cancel`, cookieA, "POST")).status,
      200,
    );
    const c = (await (await request(`/cases/${caseA}`)).json()) as any;
    assert.equal(c.state, "cancelled");
    const job = (
      await pool.query(
        "SELECT status,fence FROM jobs WHERE tenant_id=$1 AND case_id=$2",
        [tenantA, caseA],
      )
    ).rows[0];
    assert.equal(job.status, "cancelled");
    assert.equal(Number(job.fence), 1);
    const initial = (await (
      await request(`/cases/${caseA}/events?after=0`)
    ).json()) as any;
    assert.equal(initial.events.length, 1);
    const reconnect = (await (
      await request(
        `/cases/${caseA}/events?after=${initial.events[0].sequence}`,
      )
    ).json()) as any;
    assert.equal(reconnect.events.length, 0);
    assert.equal(
      (await request(`/cases/${caseA}/events?after=999`)).status,
      409,
    );
  },
);
test(
  "duplicate signed PR webhook deliveries commit one durable preflight job",
  { skip: !integration },
  async () => {
    const delivery = randomUUID();
    const body = JSON.stringify({
      action: "synchronize",
      installation: { id: 123 },
      repository: { id: 123 },
      pull_request: {
        number: 1,
        head: { ref: "fixture", sha: "b".repeat(40), repo: { id: 123 } },
        base: { sha: "a".repeat(40) },
      },
    });
    const signature = `sha256=${createHmac("sha256", "controlled-webhook-secret").update(body).digest("hex")}`;
    const send = () =>
      fetch(`${origin}/api/webhooks/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Delivery": delivery,
          "X-GitHub-Event": "pull_request",
          "X-Hub-Signature-256": signature,
        },
        body,
      });
    assert.equal((await send()).status, 202);
    assert.equal((await send()).status, 202);
    const jobs = await pool.query(
      "SELECT id FROM jobs WHERE tenant_id=$1 AND kind='preflight' AND payload->>'headSha'=$2",
      [tenantA, "b".repeat(40)],
    );
    assert.equal(jobs.rowCount, 1);
  },
);
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(resolve));
  if (pool) await pool.end();
});
