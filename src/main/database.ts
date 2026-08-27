import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";

export type SoarDatabase = BetterSqlite3.Database;

export const IN_MEMORY_DATABASE = ":memory:";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
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

  CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, sequence)
  );

  CREATE INDEX IF NOT EXISTS session_events_session_sequence_idx
    ON session_events(session_id, sequence);

  CREATE INDEX IF NOT EXISTS sessions_updated_at_idx
    ON sessions(updated_at DESC);

  CREATE TRIGGER IF NOT EXISTS session_events_no_update
  BEFORE UPDATE ON session_events
  BEGIN
    SELECT RAISE(ABORT, 'session_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS session_events_no_delete
  BEFORE DELETE ON session_events
  BEGIN
    SELECT RAISE(ABORT, 'session_events is append-only');
  END;
`;

export interface CreateDatabaseOptions {
  readonly?: boolean;
}

export function createSoarDatabase(
  databasePath = IN_MEMORY_DATABASE,
  options: CreateDatabaseOptions = {},
): SoarDatabase {
  const isMemory = databasePath === IN_MEMORY_DATABASE;
  const resolvedPath = isMemory ? databasePath : resolve(databasePath);

  if (!isMemory && !options.readonly) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new BetterSqlite3(resolvedPath, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  if (!options.readonly) {
    if (!isMemory) {
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
    }
    database.exec(SCHEMA);
  }

  return database;
}
