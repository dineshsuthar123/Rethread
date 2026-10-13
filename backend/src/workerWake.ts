import { pool, transaction } from "./db.js";
import { github, appJwt } from "./github.js";
export async function wakeWorker() {
  if (process.env.WORKER_MODE !== "github-actions") return;
  const owner = process.env.CONTROL_REPOSITORY;
  const installation = process.env.CONTROL_INSTALLATION_ID;
  const repositoryId = Number(process.env.CONTROL_REPOSITORY_ID);
  if (
    !owner ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(owner) ||
    !installation ||
    !repositoryId
  )
    return;
  const admitted = await transaction(async (db) => {
    const row = (
      await db.query(
        "SELECT * FROM worker_wakeups WHERE id=1 AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",
      )
    ).rows[0];
    if (!row) return false;
    const running = await db.query(
      "SELECT 1 FROM jobs WHERE status='running' AND lease_until>now() LIMIT 1",
    );
    const queued = await db.query(
      "SELECT 1 FROM jobs WHERE status='queued' OR (status='running' AND lease_until<now()) LIMIT 1",
    );
    if (running.rowCount || !queued.rowCount) return false;
    await db.query(
      "UPDATE worker_wakeups SET next_attempt_at=now()+interval '2 minutes',attempts=attempts+1 WHERE id=1",
    );
    return true;
  });
  if (!admitted) return;
  try {
    // This token is only for the owner's trusted control repository, never the target repo.
    const token = await github(
      `/app/installations/${installation}/access_tokens`,
      appJwt(),
      {
        method: "POST",
        body: JSON.stringify({
          repository_ids: [repositoryId],
          permissions: { actions: "write", contents: "read" },
        }),
      },
    );
    await github(
      `/repos/${owner}/actions/workflows/review.yml/dispatches`,
      token.token,
      {
        method: "POST",
        body: JSON.stringify({
          ref: process.env.CONTROL_REF || "rethread/implementation",
        }),
      },
    );
    await pool.query(
      "UPDATE worker_wakeups SET last_dispatched_at=now(),reason=NULL WHERE id=1",
    );
  } catch {
    await pool.query(
      "UPDATE worker_wakeups SET reason='Trusted Actions worker dispatch failed; queue retained for retry' WHERE id=1",
    );
  }
}
