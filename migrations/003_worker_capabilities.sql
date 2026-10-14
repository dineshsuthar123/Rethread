ALTER TABLE rethread.worker_heartbeats ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}';
ALTER TABLE rethread.jobs ADD COLUMN first_started_at timestamptz;
