import pg from "pg";
import { config } from "./config.js";
import type { CaseState } from "@rethread/contracts";
import { transitions } from "@rethread/contracts";
import { HttpError, redact } from "./security.js";
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.poolSize,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  options: "-c search_path=rethread,public",
});
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function getCase(
  db: pg.Pool | pg.PoolClient,
  tenant: string,
  id: string,
  lock = false,
) {
  const { rows } = await db.query(
    `SELECT * FROM cases WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [tenant, id],
  );
  if (!rows[0]) throw new HttpError(404, "Case not found", "not_found");
  return rows[0];
}
export async function event(
  db: pg.PoolClient,
  tenant: string,
  id: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const { rows } = await db.query(
    "UPDATE cases SET cursor=cursor+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING cursor",
    [tenant, id],
  );
  await db.query(
    "INSERT INTO events(tenant_id,case_id,sequence,type,payload) VALUES($1,$2,$3,$4,$5)",
    [
      tenant,
      id,
      rows[0].cursor,
      type,
      JSON.parse(redact(JSON.stringify(payload))),
    ],
  );
}
export async function transition(
  db: pg.PoolClient,
  tenant: string,
  id: string,
  next: CaseState,
  reason?: string,
) {
  const c = await getCase(db, tenant, id, true);
  if (!transitions[c.state as CaseState]?.includes(next))
    throw new HttpError(
      409,
      `Cannot change ${c.state} to ${next}`,
      "invalid_transition",
    );
  await db.query(
    "UPDATE cases SET state=$3,reason=$4 WHERE tenant_id=$1 AND id=$2",
    [tenant, id, next, reason || null],
  );
  await event(db, tenant, id, "state", { state: next, reason: reason || null });
}
