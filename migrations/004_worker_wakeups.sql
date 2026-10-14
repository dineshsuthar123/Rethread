SET search_path TO rethread,public;
CREATE TABLE worker_wakeups(id int PRIMARY KEY CHECK(id=1),requested_at timestamptz NOT NULL DEFAULT now(),last_dispatched_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),attempts int NOT NULL DEFAULT 0,reason text);
CREATE FUNCTION rethread.request_worker_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO rethread.worker_wakeups(id) VALUES(1)
 ON CONFLICT(id) DO UPDATE SET requested_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER queue_wakeup AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION rethread.request_worker_wakeup();
