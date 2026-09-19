-- Existing Cloud control-plane databases were created before CLI sessions
-- retained the device authorization's display name. Apply once to deployed
-- SQLite databases before running the updated control plane.
ALTER TABLE cli_sessions ADD COLUMN client_name TEXT NOT NULL DEFAULT 'Carthagent CLI';
