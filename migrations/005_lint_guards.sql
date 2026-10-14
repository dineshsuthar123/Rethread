ALTER TABLE rethread.guards ADD COLUMN kind text NOT NULL DEFAULT 'pytest' CHECK(kind IN ('pytest','ruff'));
