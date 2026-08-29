import { randomUUID } from "node:crypto";
import type { SoarDatabase } from "./database";
import {
  AgenticExecutionPolicySchema,
  AppTaskTrackSchema,
  CompletionObligationsSchema,
  parseSessionEventData,
  parseStoredSessionEvent,
  type AgenticExecutionPolicy,
  type AppTaskTrack,
  type CompletionObligations,
  type OptimizationProfile,
  type SessionEventData,
  type SessionStatus,
  type StoredSessionEvent,
} from "../shared/session-events";
import {
  reduceSessionEvent,
  replaySession,
  type SessionState,
} from "../shared/session-reducer";

interface SessionRow {
  id: string;
  title: string;
  objective: string;
  workspace_root: string;
  profile: OptimizationProfile;
  status: SessionStatus;
  current_provider_id: string | null;
  current_model: string | null;
  route_reason: string | null;
  last_sequence: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_tokens: number;
  total_cost_usd: number;
  total_latency_ms: number;
  result: string | null;
  error: string | null;
  state_json: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  session_id: string;
  sequence: number;
  type: string;
  payload_json: string;
  created_at: string;
}

interface ProjectionUpdateResult {
  changes: number;
}

type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) && "then" in value && typeof value.then === "function";
}

export interface SessionRecord {
  id: string;
  title: string;
  objective: string;
  workspaceRoot: string;
  profile: OptimizationProfile;
  status: SessionStatus;
  currentProviderId?: string;
  currentModel?: string;
  routeReason?: string;
  lastSequence: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  id?: string;
  title: string;
  objective: string;
  workspaceRoot: string;
  profile?: OptimizationProfile;
  taskTrack?: AppTaskTrack;
  completionObligations?: CompletionObligations;
  executionPolicy?: AgenticExecutionPolicy;
  createdAt?: string;
}

export interface AppendOptions {
  expectedSequence?: number;
  eventId?: string;
  createdAt?: string;
}

export interface AppendManyOptions {
  expectedSequence?: number;
  createdAt?: string;
  /**
   * Optional preallocated event-envelope IDs. Atomic multi-store units of work
   * use these so every durable identity exists before the transaction begins.
   */
  eventIds?: readonly string[];
  /**
   * Deterministic crash seam for atomic persistence tests. The callback runs
   * after each event insert but before the session projection commits.
   */
  afterEachPersistedForTest?: (
    zeroBasedIndex: number,
    event: StoredSessionEvent,
  ) => void;
}

export interface ListSessionsOptions {
  status?: SessionStatus;
  limit?: number;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} was not found`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionAlreadyExistsError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} already exists`);
    this.name = "SessionAlreadyExistsError";
  }
}

export class SequenceConflictError extends Error {
  readonly expectedSequence: number;
  readonly actualSequence: number;

  constructor(
    sessionId: string,
    expectedSequence: number,
    actualSequence: number,
  ) {
    super(
      `Session ${sessionId} sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`,
    );
    this.name = "SequenceConflictError";
    this.expectedSequence = expectedSequence;
    this.actualSequence = actualSequence;
  }
}

function assertIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error(`Invalid canonical ISO timestamp: ${value}`);
  }
  return value;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    workspaceRoot: row.workspace_root,
    profile: row.profile,
    status: row.status,
    currentProviderId: row.current_provider_id ?? undefined,
    currentModel: row.current_model ?? undefined,
    routeReason: row.route_reason ?? undefined,
    lastSequence: row.last_sequence,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalReasoningTokens: row.total_reasoning_tokens,
    totalCostUsd: row.total_cost_usd,
    totalLatencyMs: row.total_latency_ms,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseState(row: SessionRow): SessionState {
  const parsed = JSON.parse(row.state_json) as Omit<
    SessionState,
    | "contextCompilations"
    | "completionObligations"
    | "completionChecks"
    | "routingDecisions"
    | "inferenceAttempts"
  > & {
    contextCompilations?: SessionState["contextCompilations"];
    completionObligations?: SessionState["completionObligations"];
    completionChecks?: SessionState["completionChecks"];
    routingDecisions?: SessionState["routingDecisions"];
    inferenceAttempts?: SessionState["inferenceAttempts"];
  };
  if (
    parsed.contextCompilations !== undefined &&
    !Array.isArray(parsed.contextCompilations)
  ) {
    throw new Error(
      `Session projection ${row.id} has invalid context compilation telemetry`,
    );
  }
  if (
    parsed.routingDecisions !== undefined &&
    !Array.isArray(parsed.routingDecisions)
  ) {
    throw new Error(`Session projection ${row.id} has invalid routing decisions`);
  }
  if (
    parsed.inferenceAttempts !== undefined &&
    !Array.isArray(parsed.inferenceAttempts)
  ) {
    throw new Error(`Session projection ${row.id} has invalid inference attempts`);
  }
  if (
    parsed.completionChecks !== undefined &&
    !Array.isArray(parsed.completionChecks)
  ) {
    throw new Error(
      `Session projection ${row.id} has invalid completion obligation checks`,
    );
  }
  const completionObligations = CompletionObligationsSchema.parse(
    parsed.completionObligations ?? {
      requiredSuccessfulTools: [],
      minimumVerifiedPathLineCitations: 0,
    },
  );
  const executionPolicy =
    parsed.executionPolicy === undefined
      ? undefined
      : AgenticExecutionPolicySchema.parse(parsed.executionPolicy);
  const taskTrack =
    parsed.taskTrack === undefined
      ? undefined
      : AppTaskTrackSchema.parse(parsed.taskTrack);
  const state: SessionState = {
    ...parsed,
    // Projections written before context compilation telemetry was introduced
    // remain readable and are upgraded on the next append.
    contextCompilations: parsed.contextCompilations ?? [],
    routingDecisions: parsed.routingDecisions ?? [],
    inferenceAttempts: parsed.inferenceAttempts ?? [],
    completionObligations: {
      requiredSuccessfulTools: [
        ...completionObligations.requiredSuccessfulTools,
      ],
      minimumVerifiedPathLineCitations:
        completionObligations.minimumVerifiedPathLineCitations,
    },
    completionChecks: parsed.completionChecks ?? [],
    ...(taskTrack === undefined ? {} : { taskTrack }),
    ...(executionPolicy === undefined
      ? {}
      : { executionPolicy: { ...executionPolicy } }),
  };
  if (state.id !== row.id || state.lastSequence !== row.last_sequence) {
    throw new Error(`Session projection ${row.id} is inconsistent`);
  }
  return state;
}

export class EventStore {
  constructor(private readonly database: SoarDatabase) {}

  createSession(input: CreateSessionInput): SessionRecord {
    const sessionId = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.appendInternal(
      sessionId,
      [
        {
          event: {
            type: "session.created",
            payload: {
              title: input.title,
              objective: input.objective,
              workspaceRoot: input.workspaceRoot,
              profile: input.profile ?? "balanced",
              ...(input.taskTrack === undefined
                ? {}
                : { taskTrack: input.taskTrack }),
              ...(input.completionObligations === undefined
                ? {}
                : { completionObligations: input.completionObligations }),
              ...(input.executionPolicy === undefined
                ? {}
                : { executionPolicy: input.executionPolicy }),
            },
          },
          createdAt,
        },
        {
          event: {
            type: "user.message",
            payload: {
              messageId: `${sessionId}:objective`,
              content: input.objective,
            },
          },
          createdAt,
        },
      ],
      0,
    );
    return this.requireSession(sessionId);
  }

  append(
    sessionId: string,
    event: SessionEventData,
    options: AppendOptions = {},
  ): StoredSessionEvent {
    const events = this.appendInternal(
      sessionId,
      [{ event, eventId: options.eventId, createdAt: options.createdAt }],
      options.expectedSequence,
    );
    return events[0];
  }

  appendMany(
    sessionId: string,
    events: readonly SessionEventData[],
    options: AppendManyOptions = {},
  ): StoredSessionEvent[] {
    if (
      options.eventIds !== undefined &&
      options.eventIds.length !== events.length
    ) {
      throw new RangeError("eventIds must contain exactly one ID per event");
    }
    return this.appendInternal(
      sessionId,
      events.map((event, index) => ({
        event,
        eventId: options.eventIds?.[index],
        createdAt: options.createdAt,
      })),
      options.expectedSequence,
      options.afterEachPersistedForTest,
    );
  }

  /**
   * Main-process persistence seam for a unit of work that must join session
   * events to another table on this exact SQLite connection. The callback is
   * synchronous and runs under BEGIN IMMEDIATE; append/appendMany calls made
   * inside it use better-sqlite3's nested savepoint support.
   */
  runImmediatePersistenceTransaction<T>(
    operation: (database: SoarDatabase) => SynchronousResult<T>,
  ): SynchronousResult<T> {
    if (this.database.inTransaction) {
      throw new Error(
        "Immediate persistence transactions cannot start inside another transaction",
      );
    }
    return this.database
      .transaction(() => {
        const result = operation(this.database);
        if (isPromiseLike(result)) {
          throw new TypeError(
            "Immediate persistence transactions require a synchronous callback",
          );
        }
        return result;
      })
      .immediate();
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as SessionRow | undefined;
    return row ? toSessionRecord(row) : undefined;
  }

  requireSession(sessionId: string): SessionRecord {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  getProjectedState(sessionId: string): SessionState {
    const row = this.database
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as SessionRow | undefined;
    if (!row) {
      throw new SessionNotFoundError(sessionId);
    }
    return parseState(row);
  }

  listSessions(options: ListSessionsOptions = {}): SessionRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 1_000));
    const rows = options.status
      ? (this.database
          .prepare(
            "SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
          )
          .all(options.status, limit) as SessionRow[])
      : (this.database
          .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
          .all(limit) as SessionRow[]);
    return rows.map(toSessionRecord);
  }

  getEvents(sessionId: string, afterSequence = 0): StoredSessionEvent[] {
    const rows = this.database
      .prepare(
        `SELECT id, session_id, sequence, type, payload_json, created_at
         FROM session_events
         WHERE session_id = ? AND sequence > ?
         ORDER BY sequence ASC`,
      )
      .all(sessionId, afterSequence) as EventRow[];

    return rows.map((row) =>
      parseStoredSessionEvent({
        id: row.id,
        sessionId: row.session_id,
        sequence: row.sequence,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        createdAt: row.created_at,
      }),
    );
  }

  replay(sessionId: string): SessionState {
    const events = this.getEvents(sessionId);
    if (events.length === 0) {
      throw new SessionNotFoundError(sessionId);
    }
    return replaySession(events);
  }

  private appendInternal(
    sessionId: string,
    pending: readonly {
      event: SessionEventData;
      eventId?: string;
      createdAt?: string;
    }[],
    expectedSequence?: number,
    afterEachPersistedForTest?: (
      zeroBasedIndex: number,
      event: StoredSessionEvent,
    ) => void,
  ): StoredSessionEvent[] {
    if (!sessionId.trim()) {
      throw new Error("sessionId is required");
    }
    if (pending.length === 0) {
      return [];
    }

    const normalized = pending.map((item) => ({
      event: parseSessionEventData(item.event),
      eventId: item.eventId ?? randomUUID(),
      createdAt: assertIsoTimestamp(item.createdAt ?? new Date().toISOString()),
    }));

    return this.database.transaction(() => {
      let row = this.database
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(sessionId) as SessionRow | undefined;
      const projectionSequence = row?.last_sequence ?? 0;
      const canonicalEvents = row ? this.getEvents(sessionId) : [];
      if (row && canonicalEvents.length === 0) {
        throw new Error(
          `Session projection ${sessionId} has no canonical event history`,
        );
      }
      let state = row ? replaySession(canonicalEvents) : undefined;
      const actualSequence = state?.lastSequence ?? 0;

      if (
        expectedSequence !== undefined &&
        expectedSequence !== actualSequence
      ) {
        throw new SequenceConflictError(
          sessionId,
          expectedSequence,
          actualSequence,
        );
      }
      if (row && normalized[0].event.type === "session.created") {
        throw new SessionAlreadyExistsError(sessionId);
      }
      if (!row && normalized[0].event.type !== "session.created") {
        throw new SessionNotFoundError(sessionId);
      }

      const stored: StoredSessionEvent[] = [];
      let sequence = actualSequence;

      for (const [index, item] of normalized.entries()) {
        sequence += 1;
        const candidate = parseStoredSessionEvent({
          id: item.eventId,
          sessionId,
          sequence,
          createdAt: item.createdAt,
          ...item.event,
        });
        state = reduceSessionEvent(state, candidate);

        if (!row) {
          this.insertSessionProjection(state, 0);
          row = this.database
            .prepare("SELECT * FROM sessions WHERE id = ?")
            .get(sessionId) as SessionRow;
        }

        this.database
          .prepare(
            `INSERT INTO session_events
             (id, session_id, sequence, type, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            candidate.id,
            candidate.sessionId,
            candidate.sequence,
            candidate.type,
            JSON.stringify(candidate.payload),
            candidate.createdAt,
          );
        stored.push(candidate);
        if (afterEachPersistedForTest !== undefined) {
          const callbackResult = afterEachPersistedForTest(index, candidate);
          if (isPromiseLike(callbackResult)) {
            throw new TypeError(
              "Event persistence fault callbacks must be synchronous",
            );
          }
        }
      }

      if (!state) {
        throw new Error("Event append did not produce a session state");
      }
      const update = this.updateSessionProjection(state, projectionSequence);
      if (update.changes !== 1) {
        const latest = this.getSession(sessionId)?.lastSequence ?? 0;
        throw new SequenceConflictError(
          sessionId,
          actualSequence,
          latest,
        );
      }

      return stored;
    })();
  }

  private insertSessionProjection(
    state: SessionState,
    lastSequence: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO sessions (
          id, title, objective, workspace_root, profile, status,
          current_provider_id, current_model, route_reason, last_sequence,
          total_input_tokens, total_output_tokens, total_reasoning_tokens,
          total_cost_usd, total_latency_ms, result, error, state_json,
          created_at, updated_at
        ) VALUES (
          @id, @title, @objective, @workspaceRoot, @profile, @status,
          @currentProviderId, @currentModel, @routeReason, @lastSequence,
          @inputTokens, @outputTokens, @reasoningTokens,
          @costUsd, @latencyMs, @result, @error, @stateJson,
          @createdAt, @updatedAt
        )`,
      )
      .run(this.projectionParameters(state, lastSequence));
  }

  private updateSessionProjection(
    state: SessionState,
    previousSequence: number,
  ): ProjectionUpdateResult {
    return this.database
      .prepare(
        `UPDATE sessions SET
          title = @title,
          objective = @objective,
          workspace_root = @workspaceRoot,
          profile = @profile,
          status = @status,
          current_provider_id = @currentProviderId,
          current_model = @currentModel,
          route_reason = @routeReason,
          last_sequence = @lastSequence,
          total_input_tokens = @inputTokens,
          total_output_tokens = @outputTokens,
          total_reasoning_tokens = @reasoningTokens,
          total_cost_usd = @costUsd,
          total_latency_ms = @latencyMs,
          result = @result,
          error = @error,
          state_json = @stateJson,
          updated_at = @updatedAt
        WHERE id = @id AND last_sequence = @previousSequence`,
      )
      .run({
        ...this.projectionParameters(state, state.lastSequence),
        previousSequence,
      });
  }

  private projectionParameters(
    state: SessionState,
    lastSequence: number,
  ): Record<string, string | number | null> {
    const route = state.routes.at(-1);
    return {
      id: state.id,
      title: state.title,
      objective: state.objective,
      workspaceRoot: state.workspaceRoot,
      profile: state.profile,
      status: state.status,
      currentProviderId: route?.providerId ?? null,
      currentModel: route?.model ?? null,
      routeReason: route?.reason ?? null,
      lastSequence,
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      reasoningTokens: state.usage.reasoningTokens,
      costUsd: state.usage.costUsd,
      latencyMs: state.usage.latencyMs,
      result: state.result ?? null,
      error: state.error ?? null,
      stateJson: JSON.stringify(state),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }
}
