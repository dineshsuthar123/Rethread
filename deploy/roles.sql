-- Run as the database owner, after forward migrations. No passwords in this file.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='rethread_api') THEN CREATE ROLE rethread_api NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='rethread_worker') THEN CREATE ROLE rethread_worker NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA rethread TO rethread_api,rethread_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON rethread.users,rethread.tenants,rethread.memberships,rethread.sessions,rethread.oauth_states,rethread.installations,rethread.repositories,rethread.cases,rethread.jobs,rethread.events,rethread.publish_intents,rethread.webhook_deliveries TO rethread_api;
GRANT SELECT ON rethread.guards,rethread.guard_checks,rethread.artifacts,rethread.artifact_payloads,rethread.budgets,rethread.worker_heartbeats,rethread.schema_migrations TO rethread_api;
GRANT INSERT ON rethread.audit_records TO rethread_api;
GRANT USAGE ON SEQUENCE rethread.audit_records_id_seq TO rethread_api;
GRANT SELECT,UPDATE ON rethread.cases,rethread.jobs,rethread.repositories,rethread.installations,rethread.publish_intents TO rethread_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON rethread.events,rethread.artifacts,rethread.artifact_payloads,rethread.guards,rethread.guard_checks,rethread.budgets,rethread.budget_reservations,rethread.worker_heartbeats TO rethread_worker;
GRANT DELETE ON rethread.sessions,rethread.oauth_states TO rethread_worker;
GRANT SELECT(expires_at) ON rethread.sessions,rethread.oauth_states TO rethread_worker;
-- Create separate LOGIN roles using owner tooling and private password entry,
-- grant one capability role to each login, and use those URLs for API/worker.
-- Neither runtime login may own the schema, CREATE ROLE, or BYPASSRLS.

GRANT SELECT,INSERT,UPDATE ON rethread.worker_wakeups TO rethread_api;

GRANT SELECT,INSERT,UPDATE ON rethread.sandbox_credit_allowance,rethread.sandbox_credit_charges TO rethread_worker;
