import { Router, raw } from "express";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { verifyHmac, hash, HttpError } from "./security.js";
import { transaction } from "./db.js";
import { asyncRoute } from "./auth.js";
export const webhookRoutes = Router();
webhookRoutes.post(
  "/webhooks/github",
  raw({ type: "application/json", limit: "2mb" }),
  asyncRoute(async (req, res) => {
    if (
      !Buffer.isBuffer(req.body) ||
      !verifyHmac(
        req.body,
        String(req.headers["x-hub-signature-256"] || ""),
        config.webhookSecret,
      )
    )
      throw new HttpError(401, "Invalid webhook signature");
    const delivery = String(req.headers["x-github-delivery"] || "");
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(delivery))
      throw new HttpError(400, "Missing delivery identifier");
    const event = String(req.headers["x-github-event"] || "");
    if (
      ![
        "installation",
        "installation_repositories",
        "pull_request",
        "ping",
      ].includes(event)
    ) {
      res.status(202).json({ ignored: true });
      return;
    }
    const p = JSON.parse(req.body.toString());
    await transaction(async (db) => {
      const inserted = await db.query(
        "INSERT INTO webhook_deliveries(id,event,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
        [delivery, event, hash(req.body)],
      );
      if (!inserted.rowCount) return;
      const installation = p.installation?.id;
      if (!installation) return;
      if (
        event === "installation" &&
        ["deleted", "suspend"].includes(p.action)
      ) {
        await db.query("UPDATE installations SET connected=false WHERE id=$1", [
          installation,
        ]);
        await db.query(
          "UPDATE repositories SET connected=false WHERE installation_id=$1",
          [installation],
        );
      }
      if (event === "installation_repositories") {
        for (const removed of p.repositories_removed || [])
          await db.query(
            "UPDATE repositories SET connected=false WHERE github_id=$1 AND installation_id=$2",
            [removed.id, installation],
          );
      }
      if (
        event === "pull_request" &&
        ["opened", "synchronize", "reopened"].includes(p.action) &&
        !p.pull_request.head.ref.startsWith("rethread/case-") &&
        p.pull_request.head.repo?.id === p.repository.id
      ) {
        const repos = (
          await db.query(
            "SELECT * FROM repositories WHERE installation_id=$1 AND github_id=$2 AND connected=true",
            [installation, p.repository.id],
          )
        ).rows;
        for (const r of repos) {
          const correlation = `${r.tenant_id}:${p.repository.id}:${p.pull_request.number}:${p.pull_request.head.sha}`;
          await db.query(
            "INSERT INTO jobs(id,tenant_id,repository_id,kind,payload) SELECT $1,$2,$3,'preflight',$4 WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE tenant_id=$2 AND kind='preflight' AND payload->>'correlation'=$5)",
            [
              randomUUID(),
              r.tenant_id,
              r.id,
              {
                correlation,
                prNumber: p.pull_request.number,
                headSha: p.pull_request.head.sha,
                baseSha: p.pull_request.base.sha,
              },
              correlation,
            ],
          );
        }
      }
    });
    res.status(202).json({ received: true });
  }),
);
