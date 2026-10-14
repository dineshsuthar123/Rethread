import { Router, type Request, type RequestHandler } from "express";
import { config, capabilities } from "./config.js";
import { pool, transaction } from "./db.js";
import {
  random,
  hash,
  encrypt,
  decrypt,
  equal,
  HttpError,
} from "./security.js";
import { github } from "./github.js";
import { randomUUID } from "node:crypto";
export type Identity = {
  user_id: string;
  tenant_id: string;
  csrf: string;
  token_cipher: string;
  login: string;
  avatar_url: string;
};
declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
      requestId: string;
    }
  }
}
export const asyncRoute =
  (fn: (req: Request, res: any) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const cookieName = "rethread_session";
const cookie = (res: any, value: string, maxAge: number) =>
  res.cookie(cookieName, value, {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
export const requireSession: RequestHandler = (req, _res, next) => {
  (async () => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!raw)
      throw new HttpError(401, "Sign in to continue", "session_expired");
    const result = await pool.query(
      "SELECT s.*,u.login,u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE s.id_hash=$1 AND s.expires_at>now()",
      [hash(raw)],
    );
    if (!result.rows[0])
      throw new HttpError(401, "Your session has expired", "session_expired");
    req.identity = result.rows[0];
    next();
  })().catch(next);
};
export const csrf: RequestHandler = (req, _res, next) => {
  if (
    !req.identity ||
    !equal((req.headers["x-csrf-token"] as string) || "", req.identity.csrf) ||
    req.headers.origin !== config.origin
  )
    return next(new HttpError(403, "Reload this page before retrying", "csrf"));
  next();
};
export const userToken = (req: Request) =>
  decrypt(req.identity!.token_cipher, config.sessionKey);
export const authRoutes = Router();
authRoutes.get(
  "/auth/github",
  asyncRoute(async (_req, res) => {
    if (!capabilities().loginConfigured)
      throw new HttpError(
        503,
        "GitHub login has not been configured",
        "configuration",
      );
    const state = random(),
      verifier = random();
    await pool.query(
      "INSERT INTO oauth_states(id_hash,verifier,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hash(state), verifier],
    );
    res.cookie("rethread_oauth", state, {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 600000,
    });
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.origin}/api/auth/callback`,
      state,
      code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
      code_challenge_method: "S256",
    });
    res.redirect(`https://github.com/login/oauth/authorize?${query}`);
  }),
);
authRoutes.get(
  "/auth/callback",
  asyncRoute(async (req, res) => {
    const state = String(req.query.state || "");
    const browserState =
      req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("rethread_oauth="))
        ?.slice("rethread_oauth=".length) || "";
    if (!state || !equal(state, browserState))
      throw new HttpError(400, "Login state did not match", "oauth_state");
    const states = await pool.query(
      "DELETE FROM oauth_states WHERE id_hash=$1 AND expires_at>now() RETURNING verifier",
      [hash(state)],
    );
    if (!states.rows[0] || typeof req.query.code !== "string")
      throw new HttpError(400, "Login expired; start again", "oauth_state");
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: req.query.code,
          redirect_uri: `${config.origin}/api/auth/callback`,
          code_verifier: states.rows[0].verifier,
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    const access = (await response.json()) as any;
    if (!access.access_token)
      throw new HttpError(401, "GitHub login was declined", "login_denied");
    const user = await github("/user", access.access_token);
    const session = random(),
      csrfToken = random();
    await transaction(async (db) => {
      await db.query(
        "INSERT INTO users(id,login,avatar_url) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET login=excluded.login,avatar_url=excluded.avatar_url",
        [user.id, user.login, user.avatar_url],
      );
      await db.query("SELECT pg_advisory_xact_lock($1)", [user.id]);
      let t = (
        await db.query(
          "SELECT tenant_id FROM memberships WHERE user_id=$1 ORDER BY tenant_id LIMIT 1",
          [user.id],
        )
      ).rows[0]?.tenant_id;
      if (!t) {
        t = randomUUID();
        await db.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
          t,
          `${user.login}'s workspace`,
        ]);
        await db.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
          [t, user.id],
        );
      }
      await db.query(
        "INSERT INTO sessions(id_hash,user_id,tenant_id,csrf,token_cipher,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '8 hours')",
        [
          hash(session),
          user.id,
          t,
          csrfToken,
          encrypt(access.access_token, config.sessionKey),
        ],
      );
    });
    cookie(res, session, 28800000);
    res.clearCookie("rethread_oauth", { path: "/api/auth" });
    res.redirect(`${config.origin}/connect`);
  }),
);
authRoutes.get(
  "/session",
  requireSession,
  asyncRoute(async (req, res) => {
    res.json({
      user: { login: req.identity!.login, avatarUrl: req.identity!.avatar_url },
      csrf: req.identity!.csrf,
      tenantId: req.identity!.tenant_id,
    });
  }),
);
authRoutes.post(
  "/logout",
  requireSession,
  csrf,
  asyncRoute(async (req, res) => {
    await pool.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
      req.identity!.tenant_id,
      req.identity!.user_id,
    ]);
    cookie(res, "", 0);
    res.status(204).end();
  }),
);
