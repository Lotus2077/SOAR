import type {
  JsonValue,
  OptimizationProfile,
  SessionStatus,
  StoredSessionEvent,
} from "./session-events";

export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: JsonValue;
  status: "requested" | "completed" | "failed";
  content?: string;
  durationMs?: number;
}

export interface CanonicalMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  status: "streaming" | "completed" | "failed";
  providerId?: string;
  model?: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: CanonicalToolCall[];
}

export interface RouteAssignment {
  providerId: string;
  model: string;
  reason: string;
  leaseId?: string;
  sequence: number;
  createdAt: string;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  latencyMs: number;
  ttftMs?: number;
}

export interface SessionState {
  id: string;
  title: string;
  objective: string;
  workspaceRoot: string;
  profile: OptimizationProfile;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastSequence: number;
  messages: CanonicalMessage[];
  routes: RouteAssignment[];
  usage: SessionUsage;
  result?: string;
  error?: string;
}

function findMessage(state: SessionState, messageId: string): CanonicalMessage {
  const message = state.messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    throw new Error(`Event references unknown message ${messageId}`);
  }
  return message;
}

function assertNextSequence(
  state: SessionState,
  event: StoredSessionEvent,
): void {
  const expected = state.lastSequence + 1;
  if (event.sequence !== expected) {
    throw new Error(
      `Session ${event.sessionId} expected event sequence ${expected}, received ${event.sequence}`,
    );
  }
}

function ensureActive(state: SessionState, event: StoredSessionEvent): void {
  if (["completed", "failed", "cancelled"].includes(state.status)) {
    throw new Error(
      `Cannot apply ${event.type} after session entered terminal status ${state.status}`,
    );
  }
}

export function createInitialSessionState(
  event: StoredSessionEvent & { type: "session.created" },
): SessionState {
  return {
    id: event.sessionId,
    title: event.payload.title,
    objective: event.payload.objective,
    workspaceRoot: event.payload.workspaceRoot,
    profile: event.payload.profile,
    status: "created",
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    lastSequence: event.sequence,
    messages: [],
    routes: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      latencyMs: 0,
    },
  };
}

export function reduceSessionEvent(
  state: SessionState | undefined,
  event: StoredSessionEvent,
): SessionState {
  if (!state) {
    if (event.type !== "session.created") {
      throw new Error(
        `First event for session ${event.sessionId} must be session.created`,
      );
    }
    if (event.sequence !== 1) {
      throw new Error(
        `First event for session ${event.sessionId} must have sequence 1`,
      );
    }
    return createInitialSessionState(event);
  }

  if (state.id !== event.sessionId) {
    throw new Error(
      `Cannot apply event for session ${event.sessionId} to ${state.id}`,
    );
  }
  assertNextSequence(state, event);
  ensureActive(state, event);

  const next: SessionState = {
    ...state,
    messages: state.messages.map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    })),
    routes: state.routes.map((route) => ({ ...route })),
    usage: { ...state.usage },
    updatedAt: event.createdAt,
    lastSequence: event.sequence,
  };

  switch (event.type) {
    case "session.created":
      throw new Error(`Session ${event.sessionId} has already been created`);
    case "session.started":
      next.status = "running";
      next.error = undefined;
      break;
    case "user.message":
      next.messages.push({
        id: event.payload.messageId,
        role: "user",
        content: event.payload.content,
        status: "completed",
      });
      break;
    case "route.assigned":
      next.routes.push({
        ...event.payload,
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      break;
    case "assistant.message.started":
      next.messages.push({
        id: event.payload.messageId,
        role: "assistant",
        content: "",
        status: "streaming",
        providerId: event.payload.providerId,
        model: event.payload.model,
        toolCalls: [],
      });
      break;
    case "assistant.message.delta": {
      const message = findMessage(next, event.payload.messageId);
      if (message.role !== "assistant") {
        throw new Error(`Message ${message.id} is not an assistant message`);
      }
      message.content += event.payload.delta;
      break;
    }
    case "assistant.message.completed": {
      const message = findMessage(next, event.payload.messageId);
      if (message.role !== "assistant") {
        throw new Error(`Message ${message.id} is not an assistant message`);
      }
      if (event.payload.content !== undefined) {
        message.content = event.payload.content;
      }
      message.status = "completed";
      break;
    }
    case "tool.call.requested": {
      const messageId =
        event.payload.messageId ??
        [...next.messages]
          .reverse()
          .find((message) => message.role === "assistant")?.id;
      if (!messageId) {
        throw new Error(
          `Tool call ${event.payload.toolCallId} has no assistant message`,
        );
      }
      const message = findMessage(next, messageId);
      if (message.role !== "assistant") {
        throw new Error(`Message ${message.id} is not an assistant message`);
      }
      if (message.toolCalls?.some((call) => call.id === event.payload.toolCallId)) {
        throw new Error(`Duplicate tool call ${event.payload.toolCallId}`);
      }
      message.toolCalls ??= [];
      message.toolCalls.push({
        id: event.payload.toolCallId,
        name: event.payload.name,
        arguments: event.payload.arguments,
        status: "requested",
      });
      break;
    }
    case "tool.call.completed": {
      const parent = next.messages.find((message) =>
        message.toolCalls?.some(
          (toolCall) => toolCall.id === event.payload.toolCallId,
        ),
      );
      const toolCall = parent?.toolCalls?.find(
        (candidate) => candidate.id === event.payload.toolCallId,
      );
      if (!toolCall) {
        throw new Error(`Unknown tool call ${event.payload.toolCallId}`);
      }
      toolCall.status = event.payload.isError ? "failed" : "completed";
      toolCall.content = event.payload.content;
      toolCall.durationMs = event.payload.durationMs;
      next.messages.push({
        id: `${event.sessionId}:tool:${event.payload.toolCallId}`,
        role: "tool",
        content: event.payload.content,
        status: event.payload.isError ? "failed" : "completed",
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.name,
      });
      break;
    }
    case "usage.recorded":
      next.usage.inputTokens += event.payload.inputTokens;
      next.usage.outputTokens += event.payload.outputTokens;
      next.usage.reasoningTokens += event.payload.reasoningTokens;
      next.usage.costUsd += event.payload.costUsd;
      next.usage.latencyMs += event.payload.latencyMs ?? 0;
      if (event.payload.ttftMs !== undefined) {
        next.usage.ttftMs = event.payload.ttftMs;
      }
      break;
    case "session.completed":
      next.status = "completed";
      next.result =
        event.payload.result ??
        [...next.messages]
          .reverse()
          .find((message) => message.role === "assistant")?.content;
      break;
    case "session.failed":
      next.status = "failed";
      next.error = event.payload.error;
      break;
    case "session.cancelled":
      next.status = "cancelled";
      next.error = event.payload.reason;
      break;
    case "session.interrupted":
      next.status = "interrupted";
      next.error = event.payload.reason;
      for (const message of next.messages) {
        if (message.status === "streaming") {
          message.status = "failed";
        }
      }
      break;
  }

  return next;
}

export function replaySession(events: readonly StoredSessionEvent[]): SessionState {
  if (events.length === 0) {
    throw new Error("Cannot replay an empty session event stream");
  }

  let state: SessionState | undefined;
  for (const event of events) {
    state = reduceSessionEvent(state, event);
  }
  return state as SessionState;
}
