import {
  isTerminalSessionStatus,
  type AgenticExecutionPolicy,
  type AppTaskTrack,
  type AssistantCompletionState,
  type CitationCorrection,
  type CompletionObligationCheckPayload,
  type CompletionObligations,
  type CompletionObligationToolName,
  type ContextCompilationMode,
  type ContextCompilationReason,
  type JsonValue,
  type OptimizationProfile,
  type SessionStatus,
  type StoredSessionEvent,
} from "./session-events";
import { normalizeCitationsFromEvidence } from "./citation-evidence";
import { parseSuccessfulRepositoryToolObservation } from "./tool-observation";

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
  stopReason?: string | null;
  completionState?: AssistantCompletionState;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: CanonicalToolCall[];
  citationCorrections?: CitationCorrection[];
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

export interface ContextCompilation {
  checkpointId: string;
  compilerVersion: string;
  reason: ContextCompilationReason;
  mode: ContextCompilationMode;
  providerId: string;
  model: string;
  maxTokens: number;
  estimatedTokens: number;
  estimator: "utf8-bytes-v1";
  reservedInputTokens: number;
  effectiveInputTokenBudget: number;
  sourceMessageCount: number;
  messageCount: number;
  evidenceCount: number;
  deduplicatedEvidenceCount: number;
  omittedEvidenceCount: number;
  packetSha256: string;
  messagesSha256: string;
  safetyMargin: number;
  sequence: number;
  createdAt: string;
}

export interface CompletionObligationCheck
  extends CompletionObligationCheckPayload {
  sequence: number;
  createdAt: string;
}

export interface SessionState {
  id: string;
  title: string;
  objective: string;
  workspaceRoot: string;
  profile: OptimizationProfile;
  /** Absent only for legacy sessions created before track identity was stored. */
  taskTrack?: AppTaskTrack;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastSequence: number;
  messages: CanonicalMessage[];
  routes: RouteAssignment[];
  contextCompilations: ContextCompilation[];
  executionPolicy?: AgenticExecutionPolicy;
  completionObligations: CompletionObligations;
  completionChecks: CompletionObligationCheck[];
  usage: SessionUsage;
  result?: string;
  error?: string;
}

const EMPTY_COMPLETION_OBLIGATIONS: CompletionObligations = {
  requiredSuccessfulTools: [],
  minimumVerifiedPathLineCitations: 0,
};

function cloneCompletionObligations(
  obligations: CompletionObligations,
): CompletionObligations {
  return {
    requiredSuccessfulTools: [...obligations.requiredSuccessfulTools],
    minimumVerifiedPathLineCitations:
      obligations.minimumVerifiedPathLineCitations,
  };
}

function hasCompletionObligations(
  obligations: CompletionObligations,
): boolean {
  return (
    obligations.requiredSuccessfulTools.length > 0 ||
    obligations.minimumVerifiedPathLineCitations > 0
  );
}

function equalToolSequences(
  left: readonly CompletionObligationToolName[],
  right: readonly CompletionObligationToolName[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tool, index) => tool === right[index])
  );
}

export function hasSuccessfulToolResult(
  toolCall: CanonicalToolCall,
): boolean {
  return (
    toolCall.status === "completed" &&
    parseSuccessfulRepositoryToolObservation(
      toolCall.name,
      toolCall.arguments,
      toolCall.content,
    ) !== undefined
  );
}

export function completedRequiredToolPrefix(
  messages: readonly CanonicalMessage[],
  requiredTools: readonly CompletionObligationToolName[],
): CompletionObligationToolName[] {
  let requiredIndex = 0;
  for (const message of messages) {
    if (message.role !== "assistant" || message.status !== "completed") {
      continue;
    }
    for (const toolCall of message.toolCalls ?? []) {
      if (
        hasSuccessfulToolResult(toolCall) &&
        toolCall.name === requiredTools[requiredIndex]
      ) {
        requiredIndex += 1;
        if (requiredIndex === requiredTools.length) {
          return [...requiredTools];
        }
      }
    }
  }
  return requiredTools.slice(0, requiredIndex);
}

function findMessage(state: SessionState, messageId: string): CanonicalMessage {
  const message = state.messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    throw new Error(`Event references unknown message ${messageId}`);
  }
  return message;
}

function assertUniqueMessageId(state: SessionState, messageId: string): void {
  if (state.messages.some((message) => message.id === messageId)) {
    throw new Error(`Duplicate message ${messageId}`);
  }
}

function allToolCalls(state: SessionState): CanonicalToolCall[] {
  return state.messages.flatMap((message) => message.toolCalls ?? []);
}

function equalStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function ensureCurrentAssistantCheckpoint(
  state: SessionState,
  eventType: string,
  messageId?: string,
): void {
  if (!state.executionPolicy) return;
  const assistants = state.messages.filter(
    (message) => message.role === "assistant",
  );
  const currentAssistant = assistants.at(-1);
  if (
    !currentAssistant ||
    (messageId !== undefined && currentAssistant.id !== messageId) ||
    state.contextCompilations.length !== assistants.length
  ) {
    throw new Error(
      `${eventType} cannot occur before the current assistant's pre-inference context checkpoint`,
    );
  }
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
  if (isTerminalSessionStatus(state.status)) {
    throw new Error(
      `Cannot apply ${event.type} after session entered terminal status ${state.status}`,
    );
  }
}

function ensureRunning(state: SessionState, event: StoredSessionEvent): void {
  const runningOnlyEvent =
    event.type === "route.assigned" ||
    event.type === "assistant.message.started" ||
    event.type === "assistant.message.delta" ||
    event.type === "assistant.message.completed" ||
    event.type === "tool.call.requested" ||
    event.type === "tool.call.completed" ||
    event.type === "context.compiled" ||
    event.type === "completion.obligations.checked" ||
    event.type === "usage.recorded";
  if (runningOnlyEvent && state.status !== "running") {
    throw new Error(
      `Cannot apply ${event.type} while session status is ${state.status}`,
    );
  }
}

function ensureCheckedTransition(
  state: SessionState,
  event: StoredSessionEvent,
): void {
  const lastCheck = state.completionChecks.at(-1);
  if (!lastCheck || lastCheck.sequence !== state.lastSequence) return;
  if (lastCheck.outcome === "accepted" && event.type !== "session.completed") {
    throw new Error(
      `Accepted completion obligation check ${lastCheck.checkId} must be followed immediately by session.completed`,
    );
  }
  if (lastCheck.outcome === "exhausted" && event.type !== "session.failed") {
    throw new Error(
      `Exhausted completion obligation check ${lastCheck.checkId} must be followed immediately by session.failed`,
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
    ...(event.payload.taskTrack === undefined
      ? {}
      : { taskTrack: event.payload.taskTrack }),
    status: "created",
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    lastSequence: event.sequence,
    messages: [],
    routes: [],
    contextCompilations: [],
    ...(event.payload.executionPolicy === undefined
      ? {}
      : { executionPolicy: { ...event.payload.executionPolicy } }),
    completionObligations: cloneCompletionObligations(
      event.payload.completionObligations ?? EMPTY_COMPLETION_OBLIGATIONS,
    ),
    completionChecks: [],
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
  ensureCheckedTransition(state, event);
  ensureRunning(state, event);

  const next: SessionState = {
    ...state,
    messages: state.messages.map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
      citationCorrections: message.citationCorrections?.map((correction) => ({
        ...correction,
      })),
    })),
    routes: state.routes.map((route) => ({ ...route })),
    // Persisted projections created before context telemetry was introduced do
    // not have this field. Defaulting here keeps those snapshots replayable.
    contextCompilations: (state.contextCompilations ?? []).map(
      (compilation) => ({ ...compilation }),
    ),
    completionObligations: cloneCompletionObligations(
      state.completionObligations ?? EMPTY_COMPLETION_OBLIGATIONS,
    ),
    completionChecks: (state.completionChecks ?? []).map((check) => ({
      ...check,
      successfulRequiredTools: [...check.successfulRequiredTools],
      missingRequiredTools: [...check.missingRequiredTools],
      verifiedPathLineCitations: [...check.verifiedPathLineCitations],
    })),
    usage: { ...state.usage },
    updatedAt: event.createdAt,
    lastSequence: event.sequence,
  };

  switch (event.type) {
    case "session.created":
      throw new Error(`Session ${event.sessionId} has already been created`);
    case "session.started":
      if (next.status !== "created") {
        throw new Error(
          `Session ${event.sessionId} cannot start from status ${next.status}`,
        );
      }
      next.status = "running";
      next.error = undefined;
      break;
    case "user.message":
      assertUniqueMessageId(next, event.payload.messageId);
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
      assertUniqueMessageId(next, event.payload.messageId);
      if (next.executionPolicy) {
        const route = next.routes.at(-1);
        if (
          !route ||
          route.providerId !== event.payload.providerId ||
          route.model !== event.payload.model
        ) {
          throw new Error(
            `Assistant message ${event.payload.messageId} does not match the active route`,
          );
        }
        const priorAssistantCount = next.messages.filter(
          (message) => message.role === "assistant",
        ).length;
        if (next.contextCompilations.length !== priorAssistantCount) {
          throw new Error(
            `Assistant message ${event.payload.messageId} cannot start before the prior inference checkpoint is complete`,
          );
        }
        if (
          priorAssistantCount >= next.executionPolicy.inferenceRounds
        ) {
          throw new Error(
            `Assistant message ${event.payload.messageId} exceeds the persisted inference-round limit`,
          );
        }
      }
      if (next.messages.some((message) => message.status === "streaming")) {
        throw new Error("Cannot start a second assistant message while one is streaming");
      }
      if (
        allToolCalls(next).some((toolCall) => toolCall.status === "requested")
      ) {
        throw new Error("Cannot start an assistant message while a tool call is pending");
      }
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
      if (message.status !== "streaming") {
        throw new Error(`Assistant message ${message.id} is no longer streaming`);
      }
      ensureCurrentAssistantCheckpoint(
        next,
        event.type,
        event.payload.messageId,
      );
      message.content += event.payload.delta;
      break;
    }
    case "assistant.message.completed": {
      const message = findMessage(next, event.payload.messageId);
      if (message.role !== "assistant") {
        throw new Error(`Message ${message.id} is not an assistant message`);
      }
      if (message.status !== "streaming") {
        throw new Error(`Assistant message ${message.id} has already completed`);
      }
      if (
        next.executionPolicy &&
        next.contextCompilations.length !==
          next.messages.filter((candidate) => candidate.role === "assistant")
            .length
      ) {
        throw new Error(
          `Assistant message ${message.id} cannot complete without exactly one context checkpoint`,
        );
      }
      if (event.payload.content !== undefined) {
        message.content = event.payload.content;
      }
      if (event.payload.stopReason !== undefined) {
        message.stopReason = event.payload.stopReason;
      }
      message.completionState = event.payload.completionState ?? "complete";
      if (event.payload.citationCorrections !== undefined) {
        message.citationCorrections = event.payload.citationCorrections.map(
          (correction) => ({ ...correction }),
        );
      }
      message.status =
        message.completionState === "complete" ? "completed" : "failed";
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
      const latestAssistant = [...next.messages]
        .reverse()
        .find((candidate) => candidate.role === "assistant");
      if (latestAssistant?.id !== message.id) {
        throw new Error(
          `Tool call ${event.payload.toolCallId} must belong to the latest assistant message`,
        );
      }
      ensureCurrentAssistantCheckpoint(next, event.type, message.id);
      if (
        next.executionPolicy &&
        (message.status !== "completed" || message.stopReason !== "tool_calls")
      ) {
        throw new Error(
          `Tool call ${event.payload.toolCallId} requires a completed assistant with stop reason tool_calls`,
        );
      }
      if (
        next.executionPolicy &&
        (message.toolCalls?.length ?? 0) > 0
      ) {
        throw new Error(
          `Assistant message ${message.id} permits exactly one sequential tool call`,
        );
      }
      if (message.status === "failed") {
        throw new Error(`Assistant message ${message.id} cannot request tools after failure`);
      }
      if (
        message.status === "completed" &&
        message.stopReason !== "tool_calls"
      ) {
        throw new Error(
          `Assistant message ${message.id} cannot request tools after a non-tool completion`,
        );
      }
      if (
        next.completionChecks.some((check) => check.messageId === message.id)
      ) {
        throw new Error(
          `Assistant message ${message.id} cannot request tools after its completion obligation check`,
        );
      }
      if (
        (message.toolCalls ?? []).some(
          (toolCall) => toolCall.status !== "requested",
        )
      ) {
        throw new Error(
          `Assistant message ${message.id} cannot add tool calls after tool execution begins`,
        );
      }
      const successfulRequiredTools = completedRequiredToolPrefix(
        next.messages,
        next.completionObligations.requiredSuccessfulTools,
      );
      const nextRequiredTool =
        next.completionObligations.requiredSuccessfulTools[
          successfulRequiredTools.length
        ];
      if (nextRequiredTool && event.payload.name !== nextRequiredTool) {
        throw new Error(
          `Tool call ${event.payload.toolCallId} must request required tool ${nextRequiredTool}, received ${event.payload.name}`,
        );
      }
      if (allToolCalls(next).some((call) => call.id === event.payload.toolCallId)) {
        throw new Error(`Duplicate tool call ${event.payload.toolCallId}`);
      }
      if (
        next.executionPolicy &&
        allToolCalls(next).length >= next.executionPolicy.toolCalls
      ) {
        throw new Error(
          `Tool call ${event.payload.toolCallId} exceeds the persisted tool-call limit`,
        );
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
      const matchingToolCalls = next.messages.flatMap((message) =>
        (message.toolCalls ?? [])
          .filter((candidate) => candidate.id === event.payload.toolCallId)
          .map((toolCall) => ({ message, toolCall })),
      );
      if (matchingToolCalls.length === 0) {
        throw new Error(`Unknown tool call ${event.payload.toolCallId}`);
      }
      if (matchingToolCalls.length !== 1) {
        throw new Error(`Ambiguous tool call ${event.payload.toolCallId}`);
      }
      const match = matchingToolCalls[0];
      if (!match) throw new Error("Tool call lookup became inconsistent");
      const { message: parent, toolCall } = match;
      const latestAssistant = [...next.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (latestAssistant?.id !== parent.id) {
        throw new Error(
          `Tool call ${toolCall.id} cannot complete after a newer assistant message`,
        );
      }
      if (parent.status !== "completed") {
        throw new Error(
          `Tool call ${toolCall.id} cannot complete before its assistant message`,
        );
      }
      if (parent.stopReason !== "tool_calls") {
        throw new Error(
          `Tool call ${toolCall.id} requires assistant stop reason tool_calls`,
        );
      }
      if (toolCall.name !== event.payload.name) {
        throw new Error(
          `Tool call ${toolCall.id} expected ${toolCall.name}, received ${event.payload.name}`,
        );
      }
      if (toolCall.status !== "requested") {
        throw new Error(`Tool call ${toolCall.id} has already completed`);
      }
      const toolMessageId = `${event.sessionId}:tool:${event.payload.toolCallId}`;
      assertUniqueMessageId(next, toolMessageId);
      toolCall.status = event.payload.isError ? "failed" : "completed";
      toolCall.content = event.payload.content;
      toolCall.durationMs = event.payload.durationMs;
      next.messages.push({
        id: toolMessageId,
        role: "tool",
        content: event.payload.content,
        status: event.payload.isError ? "failed" : "completed",
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.name,
      });
      break;
    }
    case "context.compiled": {
      const expectedCheckpointId = `${event.sessionId}:context:${
        next.contextCompilations.length + 1
      }`;
      if (event.payload.checkpointId !== expectedCheckpointId) {
        throw new Error(
          `Context checkpoint expected ${expectedCheckpointId}, received ${event.payload.checkpointId}`,
        );
      }
      const route = next.routes.at(-1);
      if (
        !route ||
        route.providerId !== event.payload.providerId ||
        route.model !== event.payload.model
      ) {
        throw new Error(
          `Context checkpoint ${event.payload.checkpointId} does not match the active route`,
        );
      }
      const assistant = [...next.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (
        !assistant ||
        assistant.providerId !== event.payload.providerId ||
        assistant.model !== event.payload.model
      ) {
        throw new Error(
          `Context checkpoint ${event.payload.checkpointId} does not match the active assistant`,
        );
      }
      if (next.executionPolicy) {
        const assistantCount = next.messages.filter(
          (message) => message.role === "assistant",
        ).length;
        if (
          assistant.status !== "streaming" ||
          next.contextCompilations.length !== assistantCount - 1
        ) {
          throw new Error(
            `Context checkpoint ${event.payload.checkpointId} must be the single pre-inference checkpoint for a streaming assistant`,
          );
        }
      }
      const workingReasons: ContextCompilationReason[] = [
        "session_start",
        "tool_result_boundary",
        "obligation_retry_boundary",
        "no_progress_boundary",
      ];
      const finalizationReasons: ContextCompilationReason[] = [
        "session_start",
        "obligation_retry_boundary",
        "finalization_boundary",
        "no_progress_finalization_boundary",
      ];
      const permittedReasons =
        event.payload.mode === "working"
          ? workingReasons
          : finalizationReasons;
      if (!permittedReasons.includes(event.payload.reason)) {
        throw new Error(
          `Context checkpoint reason ${event.payload.reason} is incompatible with mode ${event.payload.mode}`,
        );
      }
      if (
        (next.contextCompilations.length === 0) !==
        (event.payload.reason === "session_start")
      ) {
        throw new Error(
          `Context checkpoint reason session_start is reserved for the first checkpoint`,
        );
      }
      next.contextCompilations.push({
        ...event.payload,
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      break;
    }
    case "completion.obligations.checked": {
      if (!hasCompletionObligations(next.completionObligations)) {
        throw new Error(
          `Session ${event.sessionId} has no active completion obligations`,
        );
      }
      if (
        event.payload.checkId !==
        `${event.sessionId}:completion:${event.payload.round}`
      ) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} does not match round ${event.payload.round}`,
        );
      }
      if (
        next.completionChecks.some(
          (check) => check.checkId === event.payload.checkId,
        )
      ) {
        throw new Error(
          `Duplicate completion obligation check ${event.payload.checkId}`,
        );
      }
      if (
        next.completionChecks.some(
          (check) => check.messageId === event.payload.messageId,
        )
      ) {
        throw new Error(
          `Assistant message ${event.payload.messageId} already has a completion obligation check`,
        );
      }
      const previousCheck = next.completionChecks.at(-1);
      if (
        previousCheck !== undefined &&
        event.payload.round <= previousCheck.round
      ) {
        throw new Error(
          `Completion obligation check round ${event.payload.round} must follow round ${previousCheck.round}`,
        );
      }
      if (
        previousCheck?.outcome === "retry" &&
        event.payload.remainingRounds >= previousCheck.remainingRounds
      ) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} must reduce remaining rounds below ${previousCheck.remainingRounds}`,
        );
      }

      const message = findMessage(next, event.payload.messageId);
      if (message.role !== "assistant" || message.status === "streaming") {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} requires a completed assistant message`,
        );
      }
      const latestAssistant = [...next.messages]
        .reverse()
        .find((candidate) => candidate.role === "assistant");
      if (latestAssistant?.id !== message.id) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} must target the latest assistant message`,
        );
      }
      if (next.messages.at(-1)?.id !== message.id) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} requires its assistant candidate to be the final canonical message`,
        );
      }
      const assistantOrdinal =
        next.messages
          .filter((candidate) => candidate.role === "assistant")
          .findIndex((candidate) => candidate.id === message.id) + 1;
      if (event.payload.round !== assistantOrdinal) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} round must equal assistant ordinal ${assistantOrdinal}`,
        );
      }
      if (
        next.executionPolicy &&
        event.payload.remainingRounds >
          next.executionPolicy.inferenceRounds - event.payload.round
      ) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} exceeds the persisted inference-round budget`,
        );
      }
      if (
        message.content.trim().length === 0 ||
        (message.toolCalls?.length ?? 0) > 0 ||
        message.stopReason !== "stop"
      ) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} requires a non-empty tool-free assistant stop`,
        );
      }

      const requiredTools =
        next.completionObligations.requiredSuccessfulTools;
      const successfulRequiredTools = completedRequiredToolPrefix(
        next.messages,
        requiredTools,
      );
      const missingRequiredTools = requiredTools.slice(
        successfulRequiredTools.length,
      );
      if (
        !equalToolSequences(
          event.payload.successfulRequiredTools,
          successfulRequiredTools,
        ) ||
        !equalToolSequences(
          event.payload.missingRequiredTools,
          missingRequiredTools,
        )
      ) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} does not match replayed tool progress`,
        );
      }
      const citationIntegrity = normalizeCitationsFromEvidence(
        message.content,
        next.messages,
      );
      const replayedVerifiedCitations =
        citationIntegrity.unresolved.length === 0
          ? citationIntegrity.verifiedCitations
          : [];
      if (
        citationIntegrity.content !== message.content ||
        !equalStrings(
          event.payload.verifiedPathLineCitations,
          replayedVerifiedCitations,
        ) ||
        event.payload.unresolvedCitationCount !==
          citationIntegrity.unresolved.length
      ) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} does not match replayed citation evidence`,
        );
      }

      const obligationsSatisfied =
        missingRequiredTools.length === 0 &&
        event.payload.verifiedPathLineCitations.length >=
          next.completionObligations.minimumVerifiedPathLineCitations &&
        event.payload.unresolvedCitationCount === 0;
      const expectedOutcome = obligationsSatisfied
        ? "accepted"
        : event.payload.remainingRounds > 0
          ? "retry"
          : "exhausted";
      if (event.payload.outcome !== expectedOutcome) {
        throw new Error(
          `Completion obligation check ${event.payload.checkId} expected outcome ${expectedOutcome}, received ${event.payload.outcome}`,
        );
      }
      const expectedCompletionState =
        event.payload.outcome === "accepted" ? "complete" : "incomplete";
      if (message.completionState !== expectedCompletionState) {
        throw new Error(
          `Assistant message ${message.id} must be ${expectedCompletionState} for obligation outcome ${event.payload.outcome}`,
        );
      }

      next.completionChecks.push({
        ...event.payload,
        successfulRequiredTools: [
          ...event.payload.successfulRequiredTools,
        ],
        missingRequiredTools: [...event.payload.missingRequiredTools],
        verifiedPathLineCitations: [
          ...event.payload.verifiedPathLineCitations,
        ],
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      break;
    }
    case "usage.recorded":
      ensureCurrentAssistantCheckpoint(next, event.type);
      if (
        next.executionPolicy &&
        [...next.messages]
          .reverse()
          .find((message) => message.role === "assistant")?.status === "streaming"
      ) {
        throw new Error(
          "usage.recorded requires the current assistant to be non-streaming",
        );
      }
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
      if (hasCompletionObligations(next.completionObligations)) {
        const finalMessage = [...next.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        const finalCheck = next.completionChecks.at(-1);
        if (
          !finalMessage ||
          !finalCheck ||
          finalCheck.messageId !== finalMessage.id ||
          finalCheck.outcome !== "accepted" ||
          finalCheck.sequence !== event.sequence - 1
        ) {
          throw new Error(
            `Session ${event.sessionId} cannot complete without an immediately preceding accepted obligation check for its final assistant message`,
          );
        }
        if (
          event.payload.result !== undefined &&
          event.payload.result !== finalMessage.content
        ) {
          throw new Error(
            `Session ${event.sessionId} completion result does not match its accepted assistant message`,
          );
        }
      }
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

  let state = reduceSessionEvent(undefined, events[0]);
  for (let index = 1; index < events.length; index += 1) {
    state = reduceSessionEvent(state, events[index]);
  }
  return state;
}
