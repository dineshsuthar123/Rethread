import dotenv from "dotenv";
import {fileURLToPath} from "node:url";
dotenv.config({path:fileURLToPath(new URL("../../.env.rethread.local",import.meta.url))});
export const config = {
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  origin: process.env.PUBLIC_ORIGIN || "http://localhost:5173",
  production: process.env.NODE_ENV === "production",
  sessionKey: process.env.SESSION_ENCRYPTION_KEY || "",
  appId: process.env.GITHUB_APP_ID || "",
  appKey: (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  appSlug: process.env.GITHUB_APP_SLUG || "",
  clientId: process.env.GITHUB_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
  buildId: process.env.BUILD_ID || "development",
  poolSize: Number(process.env.API_DB_POOL_SIZE || 5),
};
export const capabilities = () => ({
  python: {
    supported: true,
    tooling: ["pytest", "ruff"],
    requirements:
      "Pinned requirements with hashes; executable reproduction required",
  },
  javascript: { supported: false, reason: "Adapter not validated end to end" },
  loginConfigured: Boolean(
    config.clientId && config.clientSecret && config.sessionKey,
  ),
  appConfigured: Boolean(config.appId && config.appKey && config.appSlug),
  repairConfigured: Boolean(
    process.env.E2B_API_KEY &&
    process.env.E2B_TEMPLATE_ID &&
    process.env.LLM_API_KEY &&
    process.env.LLM_MODEL,
  ),
});
