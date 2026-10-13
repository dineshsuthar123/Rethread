import { Router } from "express";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { createCaseSchema, terminal } from "@rethread/contracts";
import { pool, transaction, getCase, event, transition } from "./db.js";
import { requireSession, csrf, asyncRoute, userToken } from "./auth.js";
import { github, assertRepository, installationToken } from "./github.js";
import { config } from "./config.js";
import { HttpError, hash, canonicalRepo } from "./security.js";
export const routes = Router();
routes.use(requireSession);
const uuid = z.string().uuid();
const tenant = (req: any) => req.identity.tenant_id as string;
const key = (req: any) =>
  z.string().min(8).max(200).parse(req.headers["idempotency-key"]);
async function repository(req: any, id: string) {
  const row = (
    await pool.query(
      "SELECT * FROM repositories WHERE tenant_id=$1 AND id=$2",
      [tenant(req), uuid.parse(id)],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Repository not found");
  if (!row.connected)
    throw new HttpError(
      409,
      "GitHub installation is disconnected",
      "installation_disconnected",
    );
  await assertRepository(
    userToken(req),
    Number(row.installation_id),
    Number(row.github_id),
  );
  return row;
}
routes.get(
  "/installations",
  asyncRoute(async (req, res) => {
    const result = await github(
      "/user/installations?per_page=100",
      userToken(req),
    );
    res.json({
      installUrl: config.appSlug
        ? `https://github.com/apps/${config.appSlug}/installations/new`
        : null,
      installations: result.installations
        .filter((i: any) => i.app_id === Number(config.appId))
        .map((i: any) => ({ id: i.id, account: i.account.login })),
    });
  }),
);
routes.get(
  "/installations/:id/repositories",
  asyncRoute(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const installations = await github(
      "/user/installations?per_page=100",
      userToken(req),
    );
    if (
      !installations.installations.some(
        (i: any) => i.id === id && i.app_id === Number(config.appId),
      )
    )
      throw new HttpError(403, "Installation is not authorized");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .parse(req.query.page || 1);
    const result = await github(
      `/user/installations/${id}/repositories?per_page=100&page=${page}`,
      userToken(req),
    );
    res.json({
      repositories: result.repositories.map((r: any) => ({
        githubId: r.id,
        fullName: r.full_name,
        url: r.html_url,
        defaultBranch: r.default_branch,
      })),
      hasMore: result.repositories.length === 100,
    });
  }),
);
routes.post(
  "/repositories",
  csrf,
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        installationId: z.number().int().positive(),
        githubId: z.number().int().positive(),
        url: z.string(),
      })
      .strict()
      .parse(req.body);
    const name = canonicalRepo(input.url);
    await assertRepository(
      userToken(req),
      input.installationId,
      input.githubId,
    );
    const token = await installationToken(input.installationId, input.githubId);
    const remote = await github(`/repos/${name}`, token);
    if (remote.id !== input.githubId)
      throw new HttpError(403, "Repository identity mismatch");
    const installation = await github(
      `/app/installations/${input.installationId}`,
      token,
    ).catch(() => null);
    const row = await transaction(async (db) => {
      await db.query(
        "INSERT INTO installations(tenant_id,id,account) VALUES($1,$2,$3) ON CONFLICT(tenant_id,id) DO UPDATE SET connected=true",
        [
          tenant(req),
          input.installationId,
          installation?.account?.login || name.split("/")[0],
        ],
      );
      const r = await db.query(
        "INSERT INTO repositories(tenant_id,id,github_id,installation_id,full_name,default_branch) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,github_id) DO UPDATE SET connected=true,installation_id=excluded.installation_id,full_name=excluded.full_name RETURNING *",
        [
          tenant(req),
          randomUUID(),
          input.githubId,
          input.installationId,
          name,
          remote.default_branch,
        ],
      );
      return r.rows[0];
    });
    res.status(201).json(row);
  }),
);
routes.get(
  "/repositories",
  asyncRoute(async (req, res) => {
    res.json({
      repositories: (
        await pool.query(
          "SELECT id,full_name,default_branch,installation_id,connected FROM repositories WHERE tenant_id=$1 ORDER BY full_name",
          [tenant(req)],
        )
      ).rows,
    });
  }),
);
routes.get(
  "/repositories/:id/branches",
  asyncRoute(async (req, res) => {
    const r = await repository(req, req.params.id);
    const token = await installationToken(
      Number(r.installation_id),
      Number(r.github_id),
    );
    res.json({
      branches: (
        await github(`/repos/${r.full_name}/branches?per_page=100`, token)
      ).map((b: any) => ({ name: b.name, sha: b.commit.sha })),
    });
  }),
);
routes.get(
  "/repositories/:id/runs",
  asyncRoute(async (req, res) => {
    const r = await repository(req, req.params.id);
    const token = await installationToken(
      Number(r.installation_id),
      Number(r.github_id),
    );
    const result = await github(
      `/repos/${r.full_name}/actions/runs?status=failure&per_page=30`,
      token,
    );
    res.json({
      runs: result.workflow_runs.map((x: any) => ({
        id: x.id,
        name: x.name,
        sha: x.head_sha,
        branch: x.head_branch,
        url: x.html_url,
      })),
    });
  }),
);
routes.post(
  "/cases",
  csrf,
  asyncRoute(async (req, res) => {
    const input = createCaseSchema.parse(req.body),
      idempotency = key(req),
      digest = hash(JSON.stringify(input));
    const r = await repository(req, input.repositoryId);
    const token = await installationToken(
      Number(r.installation_id),
      Number(r.github_id),
    );
    const commit = await github(
      `/repos/${r.full_name}/commits/${input.baseSha}`,
      token,
    );
    if (commit.sha !== input.baseSha)
      throw new HttpError(400, "Immutable commit could not be resolved");
    if (input.actionsRunId) {
      const run = await github(
        `/repos/${r.full_name}/actions/runs/${input.actionsRunId}`,
        token,
      );
      if (run.head_sha !== input.baseSha || run.conclusion !== "failure")
        throw new HttpError(400, "Select a failed run at the captured commit");
    }
    const result = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${tenant(req)}:${idempotency}`,
      ]);
      const previous = (
        await db.query(
          "SELECT * FROM cases WHERE tenant_id=$1 AND idempotency_key=$2",
          [tenant(req), idempotency],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== digest)
          throw new HttpError(
            409,
            "Idempotency key already used for different input",
          );
        return previous;
      }
      const id = randomUUID();
      const state = input.reproduction ? "queued" : "needs_input";
      await db.query(
        "INSERT INTO cases(tenant_id,id,repository_id,title,state,base_sha,branch,reason,data,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          tenant(req),
          id,
          input.repositoryId,
          input.title,
          state,
          input.baseSha,
          input.branch,
          state === "needs_input"
            ? "Supply a pytest test identity or Ruff reproduction. A CI log alone is not an executable oracle."
            : null,
          { request: input },
          idempotency,
          digest,
        ],
      );
      if (state === "queued")
        await db.query(
          "INSERT INTO jobs(id,tenant_id,case_id,repository_id,kind) VALUES($1,$2,$3,$4,'repair')",
          [randomUUID(), tenant(req), id, input.repositoryId],
        );
      await event(db, tenant(req), id, "state", { state });
      return getCase(db, tenant(req), id);
    });
    res.status(202).json(result);
  }),
);
routes.get(
  "/cases",
  asyncRoute(async (req, res) => {
    const search = z
      .string()
      .max(200)
      .parse(req.query.search || "");
    const repo = req.query.repositoryId
      ? uuid.parse(req.query.repositoryId)
      : null;
    const before = req.query.before
      ? z.string().datetime().parse(req.query.before)
      : null;
    const result = await pool.query(
      "SELECT * FROM cases WHERE tenant_id=$1 AND ($2::uuid IS NULL OR repository_id=$2) AND ($3='' OR to_tsvector('english', title || ' ' || coalesce(data->'request'->>'behaviorContract','')) @@ plainto_tsquery('english',$3)) AND ($4::timestamptz IS NULL OR created_at<$4) ORDER BY created_at DESC LIMIT 51",
      [tenant(req), repo, search, before],
    );
    res.json({
      cases: result.rows.slice(0, 50),
      hasMore: result.rows.length > 50,
    });
  }),
);
routes.get(
  "/cases/:id",
  asyncRoute(async (req, res) => {
    res.json(await getCase(pool, tenant(req), uuid.parse(req.params.id)));
  }),
);
routes.get(
  "/cases/:id/events",
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id),
      c = await getCase(pool, tenant(req), id);
    const raw = req.query.after ?? req.headers["last-event-id"] ?? 0;
    const after = z.coerce.number().int().nonnegative().parse(raw);
    if (after > Number(c.cursor))
      throw new HttpError(
        409,
        "Event cursor is ahead of this Case",
        "cursor_gap",
      );
    const rows = (
      await pool.query(
        "SELECT * FROM events WHERE tenant_id=$1 AND case_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 200",
        [tenant(req), id, after],
      )
    ).rows;
    const events = rows.map((x: any) => ({
      version: 1,
      id: `${id}:${x.sequence}`,
      caseId: id,
      sequence: Number(x.sequence),
      timestamp: x.created_at.toISOString(),
      type: x.type,
      payload: x.payload,
    }));
    const gap = events.length > 0 && events[0].sequence !== after + 1;
    if (req.accepts(["json", "text/event-stream"]) === "text/event-stream") {
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      for (const e of events)
        res.write(
          `id: ${e.sequence}\nevent: record\ndata: ${JSON.stringify(e)}\n\n`,
        );
      res.write(
        `event: cursor\ndata: ${JSON.stringify({ cursor: Number(c.cursor), gap })}\n\n: heartbeat\n\n`,
      );
      res.end();
    } else
      res.json({
        events,
        cursor: Number(c.cursor),
        gap,
        hasMore: events.length === 200,
      });
  }),
);
routes.post(
  "/cases/:id/cancel",
  csrf,
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await transaction(async (db) => {
      const c = await getCase(db, tenant(req), id, true);
      if (c.state === "cancelled") return;
      if (terminal.has(c.state))
        throw new HttpError(409, "This Case has finished");
      await transition(db, tenant(req), id, "cancelled", "Cancelled by owner");
      await db.query(
        "UPDATE jobs SET status='cancelled',fence=fence+1,updated_at=now() WHERE tenant_id=$1 AND case_id=$2 AND status IN ('queued','running')",
        [tenant(req), id],
      );
    });
    res.json(await getCase(pool, tenant(req), id));
  }),
);
routes.post(
  "/cases/:id/approve",
  csrf,
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const digest = z
      .object({ digest: z.string().length(64) })
      .strict()
      .parse(req.body).digest;
    await transaction(async (db) => {
      const c = await getCase(db, tenant(req), id, true);
      if (c.state !== "ready_for_review" || c.data.proposal?.digest !== digest)
        throw new HttpError(
          409,
          "Proposal changed; review the current patch",
          "stale_proposal",
        );
      await db.query(
        "UPDATE cases SET data=jsonb_set(data,'{approvedDigest}',to_jsonb($3::text)) WHERE tenant_id=$1 AND id=$2",
        [tenant(req), id, digest],
      );
      await event(db, tenant(req), id, "approved", { digest });
      await db.query(
        "INSERT INTO audit_records(tenant_id,user_id,action,object_id) VALUES($1,$2,'proposal.approved',$3)",
        [tenant(req), req.identity!.user_id, id],
      );
    });
    res.json(await getCase(pool, tenant(req), id));
  }),
);
routes.post(
  "/cases/:id/reject",
  csrf,
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await transaction((db) =>
      transition(db, tenant(req), id, "rejected", "Proposal rejected by owner"),
    );
    res.json(await getCase(pool, tenant(req), id));
  }),
);
routes.post(
  "/cases/:id/publish",
  csrf,
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id),
      idempotency = key(req);
    const c = await getCase(pool, tenant(req), id);
    await repository(req, c.repository_id);
    await transaction(async (db) => {
      const current = await getCase(db, tenant(req), id, true);
      const intent = (
        await db.query(
          "SELECT * FROM publish_intents WHERE tenant_id=$1 AND case_id=$2",
          [tenant(req), id],
        )
      ).rows[0];
      if (intent && ["publishing", "pr_opened"].includes(current.state)) return;
      if (
        current.state !== "ready_for_review" ||
        !current.data.approvedDigest ||
        current.data.approvedDigest !== current.data.proposal?.digest
      )
        throw new HttpError(
          409,
          "Review and approve the verified proposal before publishing",
          "approval_required",
        );
      const branch = `rethread/case-${id.slice(0, 12)}-${current.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 35)
        .replace(/-$/, "")}`;
      await db.query(
        "INSERT INTO publish_intents(tenant_id,case_id,idempotency_key,digest,branch) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,case_id) DO UPDATE SET status='queued',reason=NULL",
        [tenant(req), id, idempotency, current.data.approvedDigest, branch],
      );
      await transition(db, tenant(req), id, "publishing");
      await db.query(
        "INSERT INTO jobs(id,tenant_id,case_id,repository_id,kind) VALUES($1,$2,$3,$4,'publish')",
        [randomUUID(), tenant(req), id, current.repository_id],
      );
    });
    res.status(202).json(await getCase(pool, tenant(req), id));
  }),
);
routes.post(
  "/cases/:id/archive",
  csrf,
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await transaction(async (db) => {
      const c = await getCase(db, tenant(req), id, true);
      if (!terminal.has(c.state) && c.state !== "ready_for_review")
        throw new HttpError(409, "Cancel or finish this Case before archiving");
      await db.query(
        "UPDATE cases SET archived=true WHERE tenant_id=$1 AND id=$2",
        [tenant(req), id],
      );
      await event(db, tenant(req), id, "archived", {});
    });
    res.status(204).end();
  }),
);
routes.get(
  "/guards",
  asyncRoute(async (req, res) => {
    res.json({
      guards: (
        await pool.query(
          "SELECT g.*,c.title AS case_title FROM guards g JOIN cases c ON c.tenant_id=g.tenant_id AND c.id=g.case_id WHERE g.tenant_id=$1 ORDER BY g.created_at DESC LIMIT 200",
          [tenant(req)],
        )
      ).rows,
    });
  }),
);
routes.get(
  "/guards/:id",
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const guard = (
      await pool.query("SELECT * FROM guards WHERE tenant_id=$1 AND id=$2", [
        tenant(req),
        id,
      ])
    ).rows[0];
    if (!guard) throw new HttpError(404, "Guard not found");
    const checks = (
      await pool.query(
        "SELECT * FROM guard_checks WHERE tenant_id=$1 AND guard_id=$2 ORDER BY created_at DESC LIMIT 50",
        [tenant(req), id],
      )
    ).rows;
    res.json({ guard, checks });
  }),
);
routes.get(
  "/cases/:id/artifacts/:artifactId",
  asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await getCase(pool, tenant(req), id);
    const a = (
      await pool.query(
        "SELECT a.*,p.payload FROM artifacts a JOIN artifact_payloads p USING(tenant_id,id,case_id) WHERE a.tenant_id=$1 AND a.case_id=$2 AND a.id=$3 AND a.expires_at>now()",
        [tenant(req), id, uuid.parse(req.params.artifactId)],
      )
    ).rows[0];
    if (!a) throw new HttpError(404, "Artifact expired or not found");
    res.set({
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Hash": a.content_hash,
      "X-Artifact-Truncated": String(a.truncated),
    });
    res.send(gunzipSync(a.payload, { maxOutputLength: 10485760 }));
  }),
);
routes.get(
  "/cases/:id/export",
  asyncRoute(async (req, res) => {
    const c = await getCase(pool, tenant(req), uuid.parse(req.params.id));
    const manifest = {
      version: 1,
      caseId: c.id,
      title: c.title,
      baseSha: c.base_sha,
      branch: c.branch,
      reproduction: c.data.request.reproduction,
      recipe: c.data.recipe || null,
      checks: c.data.checks || [],
      behaviorContract:
        c.data.proposal?.guard?.contract || c.data.request.behaviorContract,
      proposal: c.data.proposal || null,
      limitations: [
        "Environment replay is scoped to the recorded recipe. Secrets and source archives are excluded.",
      ],
      instructions:
        "Apply candidate.diff after inspecting it. Install requirements with --require-hashes inside an isolated environment. Run the recorded reproduction, pytest suite, Ruff, and the additive guard. Never run untrusted repository code on a credential-bearing host.",
    };
    res.set({
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rethread-${c.id}-manifest.json"`,
    });
    res.send(JSON.stringify(manifest, null, 2));
  }),
);
routes.get(
  "/settings",
  asyncRoute(async (req, res) => {
    const queue = await pool.query(
      "SELECT status,count(*)::int AS count,min(created_at) AS oldest FROM jobs WHERE tenant_id=$1 GROUP BY status",
      [tenant(req)],
    );
    const budget = await pool.query(
      "SELECT day,reserved_micros,spent_micros,ceiling_micros FROM budgets WHERE scope=$1 ORDER BY day DESC LIMIT 7",
      [tenant(req)],
    );
    res.json({
      queue: queue.rows,
      budgets: budget.rows,
      retentionDays: 30,
      buildId: config.buildId,
    });
  }),
);
