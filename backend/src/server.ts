import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { config, capabilities } from "./config.js";
import { pool } from "./db.js";
import { authRoutes, asyncRoute } from "./auth.js";
import { routes } from "./routes.js";
import { webhookRoutes } from "./webhook.js";
import { HttpError } from "./security.js";
import { wakeWorker } from "./workerWake.js";
export const logger = pino({
  name: "rethread-api",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "token",
    "password",
    "secret",
    "token_cipher",
  ],
});
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use((req, res, next) => {
  const started = performance.now();
  const requestPath = req.path;
  req.requestId = randomUUID();
  res.set("X-Request-ID", req.requestId);
  res.on("finish", () => {
    if (req.path === "/api/health") return;
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: requestPath,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        tenantId: req.identity?.tenant_id,
      },
      "Request completed",
    );
  });
  next();
});
app.get("/api/health", (_req, res) =>
  res.json({
    service: "rethread-api",
    version: 1,
    buildId: config.buildId,
    status: "alive",
  }),
);
app.get(
  "/api/ready",
  asyncRoute(async (_req, res) => {
    let database = false;
    let workers: Array<{ capabilities: { repairConfigured?: boolean } }> = [];
    if (config.databaseUrl) {
      try {
        await pool.query("SELECT 1 FROM rethread.schema_migrations LIMIT 1");
        const result = await pool.query(
          "SELECT capabilities FROM worker_heartbeats WHERE updated_at>now()-interval '90 seconds' ORDER BY updated_at DESC",
        );
        workers = result.rows;
        database = true;
      } catch {
        // Readiness failure is expected during setup/outage. Never expose DB errors/URLs.
        database = false;
      }
    }
    const repairConfigured = workers.some(
      (w) => w.capabilities.repairConfigured,
    );
    const ready =
      database &&
      repairConfigured &&
      capabilities().appConfigured &&
      capabilities().loginConfigured &&
      Boolean(config.webhookSecret);
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "blocked",
      database,
      worker: workers.length > 0,
      reason: ready
        ? null
        : !database
          ? "Configure database access and apply migrations; the database is unavailable"
          : "Configure integrations and start the trusted worker",
      capabilities: {
        ...capabilities(),
        repairConfigured,
      },
      buildId: config.buildId,
    });
  }),
);
app.get(
  "/api/capabilities",
  asyncRoute(async (_req, res) => {
    const worker = await pool
      .query(
        "SELECT capabilities FROM worker_heartbeats WHERE updated_at>now()-interval '90 seconds' ORDER BY updated_at DESC LIMIT 1",
      )
      .catch(() => ({ rows: [] }));
    res.json({
      ...capabilities(),
      repairConfigured: Boolean(worker.rows[0]?.capabilities.repairConfigured),
    });
  }),
);
app.use("/api", (req, res, next) => {
  const webhook = req.path === "/webhooks/github";
  res.on("finish", () => {
    if (req.identity || webhook) void wakeWorker().catch(() => {});
  });
  next();
});
app.use("/api", webhookRoutes);
app.use(express.json({ limit: "64kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api", authRoutes);
app.use("/api", routes);
app.use((_req, _res, next) =>
  next(new HttpError(404, "Route not found", "not_found")),
);
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const known = err instanceof HttpError;
    const validation = err instanceof ZodError;
    const status = known ? err.status : validation ? 400 : 500;
    logger.warn(
      {
        requestId: req.requestId,
        status,
        code: known ? err.code : validation ? "validation" : "internal",
      },
      "Request failed",
    );
    res.status(status).json({
      error: {
        code: known ? err.code : validation ? "validation" : "internal",
        message: known
          ? err.message
          : validation
            ? "Check the supplied fields"
            : "The service could not complete this request",
        requestId: req.requestId,
      },
    });
  },
);
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(config.port, "0.0.0.0", () =>
    logger.info(
      { port: config.port, buildId: config.buildId },
      "Rethread API listening",
    ),
  );
  const stop = () => {
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
