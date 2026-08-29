-- Frozen schema emitted by src/main/database.ts at
-- 4233eddf64b0f8e1ee290c9b067efb1494eadbff. Do not update this fixture to
-- match later migrations; it exists to prove forward compatibility.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile IN ('quality', 'balanced', 'economy', 'fast')),
  status TEXT NOT NULL CHECK (status IN ('created', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  current_provider_id TEXT,
  current_model TEXT,
  route_reason TEXT,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  total_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_input_tokens >= 0),
  total_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_output_tokens >= 0),
  total_reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_reasoning_tokens >= 0),
  total_cost_usd REAL NOT NULL DEFAULT 0 CHECK (total_cost_usd >= 0),
  total_latency_ms REAL NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
  result TEXT,
  error TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, sequence)
);

CREATE INDEX session_events_session_sequence_idx
  ON session_events(session_id, sequence);

CREATE INDEX sessions_updated_at_idx
  ON sessions(updated_at DESC);

CREATE TRIGGER session_events_no_update
BEFORE UPDATE ON session_events
BEGIN
  SELECT RAISE(ABORT, 'session_events is append-only');
END;

CREATE TRIGGER session_events_no_delete
BEFORE DELETE ON session_events
BEGIN
  SELECT RAISE(ABORT, 'session_events is append-only');
END;
