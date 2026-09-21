CREATE TABLE banco_sessions (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 token_hash TEXT UNIQUE, csrf_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 audit_head TEXT NOT NULL DEFAULT '', audit_count INTEGER NOT NULL DEFAULT 0,
 mutation_id TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TRIGGER banco_session_quota BEFORE INSERT ON banco_sessions
WHEN (SELECT COUNT(*) FROM banco_sessions) >= 300
BEGIN SELECT RAISE(ABORT, 'banco session quota exceeded'); END;
--> statement-breakpoint
CREATE TABLE banco_audit (
 org_id TEXT NOT NULL REFERENCES banco_sessions(id),
 sequence INTEGER NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL,
 payload TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL,
 PRIMARY KEY(org_id,sequence)
);
--> statement-breakpoint
CREATE TRIGGER banco_audit_append_only_update BEFORE UPDATE ON banco_audit
BEGIN SELECT RAISE(ABORT, 'audit is append only'); END;
--> statement-breakpoint
CREATE TRIGGER banco_audit_append_only_delete BEFORE DELETE ON banco_audit
BEGIN SELECT RAISE(ABORT, 'audit is append only'); END;
--> statement-breakpoint
CREATE TABLE banco_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
