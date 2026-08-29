import {
  isCloudProposalDenialReason,
  isTerminalSessionStatus,
  type AgenticExecutionPolicy,
  type AgenticExecutionPolicyV2,
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
  type InferenceAttemptFinishedPayload,
  type InferenceAttemptStartedPayload,
  type RoutingDecisionPayload,
  type RoutingPhase,
  type SessionEventType,
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
  decisionId?: string;
  leaseId?: string;
  checkpointId?: string;
  attemptId?: string;
}

export interface RouteAssignment {
  providerId: string;
  model: string;
  reason: string;
  leaseId?: string;
  decisionId?: string;
  phase?: RoutingPhase;
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
  decisionId?: string;
  leaseId?: string;
  messageId?: string;
  attemptId?: string;
  sequence: number;
  createdAt: string;
}

export interface CompletionObligationCheck
  extends CompletionObligationCheckPayload {
  sequence: number;
  createdAt: string;
}

export interface RoutingDecisionRecord extends RoutingDecisionPayload {
  sequence: number;
  createdAt: string;
}

export interface InferenceAttemptFinishRecord
  extends InferenceAttemptFinishedPayload {
  sequence: number;
  createdAt: string;
}

export interface InferenceAttemptRecord
  extends InferenceAttemptStartedPayload {
  sequence: number;
  createdAt: string;
  finished?: InferenceAttemptFinishRecord;
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
  routingDecisions: RoutingDecisionRecord[];
  inferenceAttempts: InferenceAttemptRecord[];
  executionPolicy?: AgenticExecutionPolicy;
  completionObligations: CompletionObligations;
  completionChecks: CompletionObligationCheck[];
  usage: SessionUsage;
  result?: string;
  error?: string;
  /** Present only for v2 sessions; used to enforce the persisted event grammar. */
  lastV2EventType?: SessionEventType;
  startedAt?: string;
  deadlineAt?: string;
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

function v2Policy(state: SessionState): AgenticExecutionPolicyV2 | undefined {
  return state.executionPolicy?.schemaVersion === "agentic-execution-v2"
    ? state.executionPolicy
    : undefined;
}

function successfulInvestigationAttemptCount(state: SessionState): number {
  return state.inferenceAttempts.filter(
    (attempt) =>
      attempt.phase === "investigation" &&
      attempt.finished?.outcome === "succeeded",
  ).length;
}

function hasCompleteRoutingEvidence(state: SessionState): boolean {
  if (successfulInvestigationAttemptCount(state) < 1) return false;
  const required = state.completionObligations.requiredSuccessfulTools;
  if (required.length > 0) {
    return (
      completedRequiredToolPrefix(state.messages, required).length ===
      required.length
    );
  }
  return allToolCalls(state).some(hasSuccessfulToolResult);
}

function openInferenceAttempts(state: SessionState): InferenceAttemptRecord[] {
  return state.inferenceAttempts.filter((attempt) => attempt.finished === undefined);
}

function openInferenceAttempt(
  state: SessionState,
): InferenceAttemptRecord | undefined {
  const open = openInferenceAttempts(state);
  if (open.length > 1) {
    throw new Error("V2 replay contains more than one open inference attempt");
  }
  return open[0];
}

function findInferenceAttempt(
  state: SessionState,
  attemptId: string,
): InferenceAttemptRecord {
  const attempt = state.inferenceAttempts.find(
    (candidate) => candidate.attemptId === attemptId,
  );
  if (!attempt) {
    throw new Error(`Event references unknown inference attempt ${attemptId}`);
  }
  return attempt;
}

function assertV2StartGrammar(
  state: SessionState,
  event: StoredSessionEvent,
): void {
  if (!v2Policy(state)) return;
  const lastType = state.lastV2EventType;
  const openAttempt = openInferenceAttempt(state);
  if (
    openAttempt &&
    event.type !== "assistant.message.delta" &&
    event.type !== "assistant.message.completed" &&
    event.type !== "inference.attempt.finished"
  ) {
    throw new Error(
      `Open inference attempt ${openAttempt.attemptId} must finish before ${event.type}`,
    );
  }
  if (lastType === "routing.decision.recorded") {
    const decision = state.routingDecisions.at(-1);
    const expected =
      decision?.action === "assign_new_lease"
        ? "route.assigned"
        : "assistant.message.started";
    if (event.type !== expected) {
      throw new Error(
        `V2 routing decision ${decision?.decisionId ?? "unknown"} must be followed by ${expected}`,
      );
    }
  }
  if (lastType === "route.assigned" && event.type !== "assistant.message.started") {
    throw new Error("V2 route assignment must be followed by assistant.message.started");
  }
  if (
    lastType === "assistant.message.started" &&
    event.type !== "context.compiled"
  ) {
    throw new Error("V2 assistant start must be followed by context.compiled");
  }
  if (lastType === "tool.call.requested" && event.type !== "tool.call.completed") {
    throw new Error("V2 tool request must be followed by tool.call.completed");
  }
  if (lastType === "inference.attempt.finished") {
    const latest = state.inferenceAttempts.at(-1);
    const outcome = latest?.finished?.outcome;
    if (outcome === "cancelled" && event.type !== "session.cancelled") {
      throw new Error("A cancelled v2 attempt must be followed by session.cancelled");
    }
    if (outcome === "interrupted" && event.type !== "session.interrupted") {
      throw new Error(
        "An interrupted v2 attempt must be followed by session.interrupted",
      );
    }
    const message = latest
      ? state.messages.find((candidate) => candidate.id === latest.messageId)
      : undefined;
    if (
      outcome === "succeeded" &&
      (latest?.requireToolCall || message?.stopReason === "tool_calls") &&
      event.type !== "tool.call.requested" &&
      event.type !== "session.interrupted"
    ) {
      throw new Error(
        `Successful v2 attempt ${latest?.attemptId ?? "unknown"} requires its tool request next`,
      );
    }
  }
  if (
    lastType === "context.compiled" &&
    event.type !== "inference.attempt.started"
  ) {
    throw new Error("V2 context checkpoint must be followed by inference.attempt.started");
  }
  if (
    lastType === "assistant.message.completed" &&
    event.type !== "inference.attempt.finished"
  ) {
    throw new Error(
      "V2 assistant completion must be followed by inference.attempt.finished",
    );
  }
}

function assertV2TerminalReady(
  state: SessionState,
  terminalType: StoredSessionEvent["type"],
): void {
  if (!v2Policy(state)) return;
  const open = openInferenceAttempt(state);
  if (open) {
    throw new Error(
      `${terminalType} cannot terminate v2 session with open attempt ${open.attemptId}`,
    );
  }
  if (
    state.contextCompilations.length !== state.inferenceAttempts.length ||
    state.inferenceAttempts.some((attempt) => attempt.finished === undefined)
  ) {
    throw new Error(
      `${terminalType} requires exactly one terminal attempt for every v2 checkpoint`,
    );
  }
  if (state.messages.some((message) => message.status === "streaming")) {
    throw new Error(`${terminalType} cannot terminate with a streaming message`);
  }
  if (allToolCalls(state).some((toolCall) => toolCall.status === "requested")) {
    throw new Error(`${terminalType} cannot terminate with a pending tool call`);
  }
  if (terminalType === "session.completed") {
    const latest = state.inferenceAttempts.at(-1);
    if (!latest || latest.finished?.outcome !== "succeeded") {
      throw new Error("session.completed requires a successful final v2 attempt");
    }
  }
}

function cloneRoutingDecision(
  decision: RoutingDecisionRecord,
): RoutingDecisionRecord {
  const routerInputSnapshot = decision.routerInputSnapshot;
  return {
    ...decision,
    candidateProviderIds: [...decision.candidateProviderIds],
    riskSignals: decision.riskSignals.map((signal) => ({ ...signal })),
    triggerFacts: decision.triggerFacts.map((fact) => ({ ...fact })),
    admission: {
      capability: { ...decision.admission.capability },
      credential: { ...decision.admission.credential },
      health: { ...decision.admission.health },
      ...(decision.admission.pricing === undefined
        ? {}
        : { pricing: { ...decision.admission.pricing } }),
      egress: { ...decision.admission.egress },
      deadline: { ...decision.admission.deadline },
      budget: { ...decision.admission.budget },
    },
    ...(routerInputSnapshot === undefined
      ? {}
      : {
          routerInputSnapshot: {
            ...routerInputSnapshot,
            providers: routerInputSnapshot.providers.map((provider) => ({
              ...provider,
              capabilities: [...provider.capabilities],
            })),
            requiredCapabilities: [
              ...routerInputSnapshot.requiredCapabilities,
            ],
            deadline: { ...routerInputSnapshot.deadline },
            healthSnapshots: routerInputSnapshot.healthSnapshots.map(
              (snapshot) => ({ ...snapshot }),
            ),
            ...(routerInputSnapshot.pricingSnapshot === undefined
              ? {}
              : {
                  pricingSnapshot: {
                    ...routerInputSnapshot.pricingSnapshot,
                  },
                }),
          },
        }),
    ...(decision.billing === undefined
      ? {}
      : { billing: { ...decision.billing } }),
  };
}

function cloneInferenceAttempt(
  attempt: InferenceAttemptRecord,
): InferenceAttemptRecord {
  return {
    ...attempt,
    ...(attempt.allowedToolNames === undefined
      ? {}
      : { allowedToolNames: [...attempt.allowedToolNames] }),
    ...(attempt.finished === undefined
      ? {}
      : {
          finished: {
            ...attempt.finished,
            usage: { ...attempt.finished.usage },
            cost: { ...attempt.finished.cost },
          },
        }),
  };
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
    event.type === "routing.decision.recorded" ||
    event.type === "route.assigned" ||
    event.type === "assistant.message.started" ||
    event.type === "assistant.message.delta" ||
    event.type === "assistant.message.completed" ||
    event.type === "tool.call.requested" ||
    event.type === "tool.call.completed" ||
    event.type === "context.compiled" ||
    event.type === "inference.attempt.started" ||
    event.type === "inference.attempt.finished" ||
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
    routingDecisions: [],
    inferenceAttempts: [],
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
    ...(event.payload.executionPolicy?.schemaVersion === "agentic-execution-v2"
      ? { lastV2EventType: event.type }
      : {}),
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
  if (
    v2Policy(state) &&
    Date.parse(event.createdAt) < Date.parse(state.updatedAt)
  ) {
    throw new Error(
      `agentic-execution-v2 event createdAt must be nondecreasing; ${event.createdAt} precedes ${state.updatedAt}`,
    );
  }
  ensureActive(state, event);
  ensureCheckedTransition(state, event);
  ensureRunning(state, event);
  assertV2StartGrammar(state, event);

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
    routingDecisions: (state.routingDecisions ?? []).map(cloneRoutingDecision),
    inferenceAttempts: (state.inferenceAttempts ?? []).map(
      cloneInferenceAttempt,
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
      if (v2Policy(next)) {
        if (
          event.payload.startedAt === undefined ||
          event.payload.deadlineAt === undefined
        ) {
          throw new Error(
            "agentic-execution-v2 session.started requires startedAt and deadlineAt",
          );
        }
        if (event.payload.startedAt !== event.createdAt) {
          throw new Error(
            "agentic-execution-v2 startedAt must equal the persisted event timestamp",
          );
        }
        const expectedDeadline = new Date(
          Date.parse(event.payload.startedAt) +
            (v2Policy(next)?.maxEpisodeDurationMs ?? 0),
        ).toISOString();
        if (event.payload.deadlineAt !== expectedDeadline) {
          throw new Error(
            `agentic-execution-v2 deadlineAt must equal ${expectedDeadline}`,
          );
        }
        next.startedAt = event.payload.startedAt;
        next.deadlineAt = event.payload.deadlineAt;
      } else if (
        event.payload.startedAt !== undefined ||
        event.payload.deadlineAt !== undefined
      ) {
        throw new Error("v1 session.started cannot persist v2 deadline fields");
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
    case "routing.decision.recorded": {
      const policy = v2Policy(next);
      if (!policy) {
        throw new Error("routing.decision.recorded requires agentic-execution-v2");
      }
      if (
        next.routingDecisions.some(
          (decision) => decision.decisionId === event.payload.decisionId,
        )
      ) {
        throw new Error(`Duplicate routing decision ${event.payload.decisionId}`);
      }
      if (
        next.routingDecisions.some(
          (decision) => decision.boundary === event.payload.boundary,
        )
      ) {
        throw new Error(
          `Duplicate v2 routing boundary ${event.payload.boundary}`,
        );
      }
      if (
        event.payload.budgetReservationId !== undefined &&
        next.routingDecisions.some(
          (decision) =>
            decision.budgetReservationId === event.payload.budgetReservationId,
        )
      ) {
        throw new Error(
          `Duplicate budget reservation ${event.payload.budgetReservationId}`,
        );
      }
      if (event.payload.reasonCode === "cloud_admitted") {
        if (
          policy.routingPolicy !== "hybrid_v0" ||
          policy.egressConsent !== "session_cloud_synthesis_v1"
        ) {
          throw new Error(
            "cloud_admitted requires hybrid_v0 and session cloud-synthesis consent",
          );
        }
        if (
          event.payload.billing === undefined ||
          event.payload.billing.projectedCostMicrousd >
            policy.maxPaidEpisodeMicrousd
        ) {
          throw new Error(
            "cloud_admitted projected cost exceeds the persisted episode cap",
          );
        }
      }
      if (isCloudProposalDenialReason(event.payload.reasonCode)) {
        if (policy.routingPolicy !== "hybrid_v0") {
          throw new Error(
            "a denied cloud proposal requires the hybrid_v0 routing policy",
          );
        }
        if (
          event.payload.admission.egress.status === "passed" &&
          policy.egressConsent !== "session_cloud_synthesis_v1"
        ) {
          throw new Error(
            "a denied cloud proposal cannot record passed egress without session cloud-synthesis consent",
          );
        }
      }
      if (next.messages.some((message) => message.status === "streaming")) {
        throw new Error("Cannot route while an assistant message is streaming");
      }
      if (openInferenceAttempt(next)) {
        throw new Error("Cannot route while an inference attempt is open");
      }
      if (
        allToolCalls(next).some((toolCall) => toolCall.status === "requested")
      ) {
        throw new Error("Cannot route while a tool call is pending");
      }

      const activeRoute = next.routes.at(-1);
      if (event.payload.boundary === "session_start") {
        if (
          next.routingDecisions.length !== 0 ||
          next.routes.length !== 0 ||
          next.messages.some((message) => message.role === "assistant")
        ) {
          throw new Error("session_start must be the first v2 routing decision");
        }
        if (
          event.payload.action !== "assign_new_lease" ||
          event.payload.priorLeaseId !== undefined
        ) {
          throw new Error("session_start must assign a new lease without a prior lease");
        }
      } else {
        if (!activeRoute?.leaseId) {
          throw new Error(`${event.payload.boundary} requires an active v2 lease`);
        }
        if (event.payload.priorLeaseId !== activeRoute.leaseId) {
          throw new Error(
            `Routing decision ${event.payload.decisionId} prior lease does not match the active lease`,
          );
        }
      }

      if (event.payload.action === "retain_lease") {
        if (
          !activeRoute ||
          event.payload.selectedProviderId !== activeRoute.providerId ||
          event.payload.selectedModel !== activeRoute.model
        ) {
          throw new Error(
            `Retained routing decision ${event.payload.decisionId} does not match the active provider route`,
          );
        }
      }

      if (event.payload.boundary === "evidence_complete") {
        const successfulInvestigationCount =
          successfulInvestigationAttemptCount(next);
        if (!hasCompleteRoutingEvidence(next)) {
          throw new Error(
            "evidence_complete requires successful investigation and completed evidence obligations",
          );
        }
        if (event.payload.routerInputSnapshot !== undefined) {
          const evidenceReadyFact = event.payload.triggerFacts.find(
            (fact) => fact.key === "router_evidence_ready",
          );
          const successfulCountFact = event.payload.triggerFacts.find(
            (fact) =>
              fact.key ===
              "router_successful_investigation_attempt_count",
          );
          if (
            evidenceReadyFact?.value !== true ||
            successfulCountFact?.value !== successfulInvestigationCount
          ) {
            throw new Error(
              "evidence_complete trigger facts do not match canonical investigation evidence",
            );
          }
        }
      }

      if (event.payload.boundary === "provider_failure") {
        const priorAttempt = next.inferenceAttempts.at(-1);
        const priorDecision = priorAttempt
          ? next.routingDecisions.find(
              (decision) => decision.decisionId === priorAttempt.decisionId,
            )
          : undefined;
        if (
          next.lastV2EventType !== "inference.attempt.finished" ||
          priorAttempt?.finished === undefined ||
          priorAttempt.finished.outcome === "succeeded" ||
          priorAttempt.finished.outcome === "cancelled" ||
          priorAttempt.finished.outcome === "interrupted" ||
          priorDecision?.reasonCode !== "cloud_admitted" ||
          priorAttempt.budgetReservationId === undefined ||
          priorAttempt.budgetReservationId !==
            priorDecision.budgetReservationId
        ) {
          throw new Error(
            "provider_failure must immediately follow a failed admitted-cloud attempt",
          );
        }
        if (event.payload.reasonCode !== "local_fallback") {
          throw new Error("provider_failure boundary must select local_fallback");
        }
      }

      next.routingDecisions.push({
        ...event.payload,
        candidateProviderIds: [...event.payload.candidateProviderIds],
        riskSignals: event.payload.riskSignals.map((signal) => ({ ...signal })),
        triggerFacts: event.payload.triggerFacts.map((fact) => ({ ...fact })),
        admission: {
          capability: { ...event.payload.admission.capability },
          credential: { ...event.payload.admission.credential },
          health: { ...event.payload.admission.health },
          ...(event.payload.admission.pricing === undefined
            ? {}
            : { pricing: { ...event.payload.admission.pricing } }),
          egress: { ...event.payload.admission.egress },
          deadline: { ...event.payload.admission.deadline },
          budget: { ...event.payload.admission.budget },
        },
        ...(event.payload.routerInputSnapshot === undefined
          ? {}
          : {
              routerInputSnapshot: {
                ...event.payload.routerInputSnapshot,
                providers: event.payload.routerInputSnapshot.providers.map(
                  (provider) => ({
                    ...provider,
                    capabilities: [...provider.capabilities],
                  }),
                ),
                requiredCapabilities: [
                  ...event.payload.routerInputSnapshot.requiredCapabilities,
                ],
                deadline: { ...event.payload.routerInputSnapshot.deadline },
                healthSnapshots:
                  event.payload.routerInputSnapshot.healthSnapshots.map(
                    (snapshot) => ({ ...snapshot }),
                  ),
                ...(event.payload.routerInputSnapshot.pricingSnapshot ===
                undefined
                  ? {}
                  : {
                      pricingSnapshot: {
                        ...event.payload.routerInputSnapshot.pricingSnapshot,
                      },
                    }),
              },
            }),
        ...(event.payload.billing === undefined
          ? {}
          : { billing: { ...event.payload.billing } }),
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      break;
    }
    case "route.assigned":
      if (v2Policy(next)) {
        if (
          event.payload.decisionId === undefined ||
          event.payload.leaseId === undefined ||
          event.payload.phase === undefined
        ) {
          throw new Error(
            "agentic-execution-v2 route.assigned requires decisionId, leaseId, and phase",
          );
        }
        const decision = next.routingDecisions.at(-1);
        if (
          !decision ||
          decision.sequence !== event.sequence - 1 ||
          decision.action !== "assign_new_lease" ||
          decision.decisionId !== event.payload.decisionId ||
          decision.selectedLeaseId !== event.payload.leaseId ||
          decision.selectedProviderId !== event.payload.providerId ||
          decision.selectedModel !== event.payload.model ||
          decision.phase !== event.payload.phase
        ) {
          throw new Error("V2 route assignment does not match its routing decision");
        }
        if (
          next.routes.some((route) => route.leaseId === event.payload.leaseId)
        ) {
          throw new Error(`Duplicate route lease ${event.payload.leaseId}`);
        }
        const previousRoute = next.routes.at(-1);
        const providerChanges = next.routes.reduce(
          (count, route, index, routes) =>
            index > 0 && routes[index - 1]?.providerId !== route.providerId
              ? count + 1
              : count,
          previousRoute && previousRoute.providerId !== event.payload.providerId
            ? 1
            : 0,
        );
        if (providerChanges > (v2Policy(next)?.maxProviderChanges ?? 0)) {
          throw new Error("V2 route exceeds the persisted provider-change limit");
        }
      }
      next.routes.push({
        ...event.payload,
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      break;
    case "assistant.message.started":
      assertUniqueMessageId(next, event.payload.messageId);
      if (v2Policy(next)) {
        if (
          event.payload.decisionId === undefined ||
          event.payload.leaseId === undefined ||
          event.payload.checkpointId === undefined ||
          event.payload.attemptId === undefined
        ) {
          throw new Error(
            "agentic-execution-v2 assistant.message.started requires decision, lease, checkpoint, and attempt links",
          );
        }
        if (openInferenceAttempt(next)) {
          throw new Error("Cannot start an assistant message while an inference attempt is open");
        }
        if (
          next.inferenceAttempts.some(
            (attempt) => attempt.attemptId === event.payload.attemptId,
          )
        ) {
          throw new Error(`Duplicate inference attempt ${event.payload.attemptId}`);
        }
        const route = next.routes.at(-1);
        if (
          !route ||
          route.leaseId !== event.payload.leaseId
        ) {
          throw new Error(
            `Assistant message ${event.payload.messageId} does not match the active v2 lease`,
          );
        }
        const decision = next.routingDecisions.find(
          (candidate) => candidate.decisionId === event.payload.decisionId,
        );
        if (!decision || decision.selectedLeaseId !== event.payload.leaseId) {
          throw new Error(
            `Assistant message ${event.payload.messageId} references an invalid routing decision`,
          );
        }
        if (
          decision.selectedProviderId !== event.payload.providerId ||
          decision.selectedModel !== event.payload.model ||
          next.routingDecisions.at(-1)?.decisionId !== decision.decisionId
        ) {
          throw new Error(
            `Assistant message ${event.payload.messageId} does not match the active v2 routing decision`,
          );
        }
        const expectedCheckpointId = `${event.sessionId}:context:${
          next.contextCompilations.length + 1
        }`;
        if (event.payload.checkpointId !== expectedCheckpointId) {
          throw new Error(
            `Assistant message ${event.payload.messageId} expected checkpoint ${expectedCheckpointId}`,
          );
        }
        if (
          decision.checkpointId !== undefined &&
          decision.checkpointId !== event.payload.checkpointId
        ) {
          throw new Error(
            `Assistant message ${event.payload.messageId} checkpoint does not match its routing decision`,
          );
        }
        const boundaryStart =
          next.lastV2EventType === "routing.decision.recorded" ||
          next.lastV2EventType === "route.assigned";
        const obligationRetry =
          next.lastV2EventType === "completion.obligations.checked" &&
          next.completionChecks.at(-1)?.outcome === "retry";
        if (
          !boundaryStart &&
          next.lastV2EventType !== "tool.call.completed" &&
          !obligationRetry
        ) {
          throw new Error(
            "A retained-lease routine round must immediately follow tool completion or an obligation retry",
          );
        }
        if (!boundaryStart) {
          const latestDecision = next.routingDecisions.at(-1);
          if (latestDecision?.decisionId !== event.payload.decisionId) {
            throw new Error("Routine round must retain the active lease's decision");
          }
        }
      }
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
        ...(event.payload.decisionId === undefined
          ? {}
          : { decisionId: event.payload.decisionId }),
        ...(event.payload.leaseId === undefined
          ? {}
          : { leaseId: event.payload.leaseId }),
        ...(event.payload.checkpointId === undefined
          ? {}
          : { checkpointId: event.payload.checkpointId }),
        ...(event.payload.attemptId === undefined
          ? {}
          : { attemptId: event.payload.attemptId }),
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
      if (v2Policy(next)) {
        const attempt = openInferenceAttempt(next);
        if (!attempt || attempt.messageId !== message.id) {
          throw new Error(
            `Assistant delta for ${message.id} requires its open v2 inference attempt`,
          );
        }
      }
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
      if (v2Policy(next)) {
        if (event.payload.attemptId === undefined) {
          throw new Error(
            "agentic-execution-v2 assistant completion requires attemptId",
          );
        }
        const attempt = openInferenceAttempt(next);
        if (
          !attempt ||
          attempt.attemptId !== event.payload.attemptId ||
          attempt.messageId !== message.id
        ) {
          throw new Error(
            `Assistant completion ${message.id} does not match the open v2 attempt`,
          );
        }
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
      if (event.payload.attemptId !== undefined) {
        message.attemptId = event.payload.attemptId;
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
      if (v2Policy(next)) {
        const attempt = next.inferenceAttempts.at(-1);
        if (
          !attempt?.finished ||
          attempt.finished.outcome !== "succeeded" ||
          attempt.messageId !== message.id ||
          next.lastV2EventType !== "inference.attempt.finished"
        ) {
          throw new Error(
            `Tool call ${event.payload.toolCallId} requires the immediately preceding successful v2 attempt`,
          );
        }
        if (
          !attempt.allowTools ||
          !attempt.allowedToolNames?.includes(event.payload.name)
        ) {
          throw new Error(
            `Tool call ${event.payload.toolCallId} is not allowed by inference attempt ${attempt.attemptId}`,
          );
        }
      }
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
      if (v2Policy(next)) {
        if (
          event.payload.decisionId === undefined ||
          event.payload.leaseId === undefined ||
          event.payload.messageId === undefined ||
          event.payload.attemptId === undefined
        ) {
          throw new Error(
            "agentic-execution-v2 context.compiled requires decision, lease, message, and attempt links",
          );
        }
        if (
          assistant.id !== event.payload.messageId ||
          assistant.decisionId !== event.payload.decisionId ||
          assistant.leaseId !== event.payload.leaseId ||
          assistant.checkpointId !== event.payload.checkpointId ||
          assistant.attemptId !== event.payload.attemptId ||
          route.leaseId !== event.payload.leaseId
        ) {
          throw new Error(
            `Context checkpoint ${event.payload.checkpointId} does not match its v2 decision, lease, message, and attempt links`,
          );
        }
        const decision = next.routingDecisions.find(
          (candidate) => candidate.decisionId === event.payload.decisionId,
        );
        if (!decision) {
          throw new Error(
            `Context checkpoint ${event.payload.checkpointId} references an unknown routing decision`,
          );
        }
        const billableInputTokens =
          event.payload.estimatedTokens + event.payload.reservedInputTokens;
        if (
          !Number.isSafeInteger(billableInputTokens) ||
          decision.reasonCode === "cloud_admitted" &&
          ((decision.checkpointId !== undefined &&
            decision.checkpointId !== event.payload.checkpointId) ||
            (decision.packetSha256 !== undefined &&
              decision.packetSha256 !== event.payload.packetSha256) ||
            (decision.messagesSha256 !== undefined &&
              decision.messagesSha256 !== event.payload.messagesSha256) ||
            (decision.billing !== undefined &&
              decision.billing.billableInputTokens !==
                billableInputTokens))
        ) {
          throw new Error(
            `Context checkpoint ${event.payload.checkpointId} does not match its persisted routing admission packet`,
          );
        }
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
    case "inference.attempt.started": {
      const policy = v2Policy(next);
      if (!policy) {
        throw new Error("inference.attempt.started requires agentic-execution-v2");
      }
      if (openInferenceAttempt(next)) {
        throw new Error("Cannot start a second inference attempt while one is open");
      }
      if (
        next.inferenceAttempts.some(
          (attempt) => attempt.attemptId === event.payload.attemptId,
        )
      ) {
        throw new Error(`Duplicate inference attempt ${event.payload.attemptId}`);
      }
      const checkpoint = next.contextCompilations.at(-1);
      const message = [...next.messages]
        .reverse()
        .find((candidate) => candidate.role === "assistant");
      const route = next.routes.at(-1);
      const decision = next.routingDecisions.find(
        (candidate) => candidate.decisionId === event.payload.decisionId,
      );
      if (
        !checkpoint ||
        checkpoint.sequence !== event.sequence - 1 ||
        checkpoint.checkpointId !== event.payload.checkpointId ||
        checkpoint.messageId !== event.payload.messageId ||
        checkpoint.attemptId !== event.payload.attemptId ||
        checkpoint.decisionId !== event.payload.decisionId ||
        checkpoint.leaseId !== event.payload.leaseId
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} does not match the immediately preceding checkpoint`,
        );
      }
      if (
        !message ||
        message.status !== "streaming" ||
        message.id !== event.payload.messageId ||
        message.attemptId !== event.payload.attemptId ||
        message.checkpointId !== event.payload.checkpointId ||
        message.decisionId !== event.payload.decisionId ||
        message.leaseId !== event.payload.leaseId
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} does not match the active assistant`,
        );
      }
      if (
        !route ||
        route.leaseId !== event.payload.leaseId ||
        route.providerId !== event.payload.providerId ||
        route.model !== event.payload.requestedModel
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} does not match the active route`,
        );
      }
      if (
        !decision ||
        decision.selectedLeaseId !== event.payload.leaseId ||
        decision.selectedProviderId !== event.payload.providerId ||
        decision.selectedModel !== event.payload.requestedModel ||
        decision.phase !== event.payload.phase
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} does not match its routing decision`,
        );
      }
      if (
        decision.reasonCode === "cloud_admitted" &&
        decision.billing !== undefined &&
        decision.billing.requestedMaxOutputTokens !==
          event.payload.requestedMaxOutputTokens
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} output allowance does not match its routing decision`,
        );
      }
      const round = next.messages.filter(
        (candidate) => candidate.role === "assistant",
      ).length;
      if (event.payload.round !== round) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} round must equal assistant ordinal ${round}`,
        );
      }
      if (
        next.deadlineAt === undefined ||
        Date.parse(event.createdAt) >= Date.parse(next.deadlineAt)
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} cannot start at or after the episode deadline`,
        );
      }
      const paidAttemptCount = next.inferenceAttempts.filter(
        (attempt) => attempt.budgetReservationId !== undefined,
      ).length;
      if (
        event.payload.budgetReservationId !== undefined &&
        paidAttemptCount >= policy.maxPaidAttempts
      ) {
        throw new Error("V2 session exceeds the persisted paid-attempt limit");
      }
      if (
        decision.budgetReservationId !== event.payload.budgetReservationId
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} budget reservation does not match its routing decision`,
        );
      }
      next.inferenceAttempts.push({
        ...event.payload,
        ...(event.payload.allowedToolNames === undefined
          ? {}
          : { allowedToolNames: [...event.payload.allowedToolNames] }),
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      break;
    }
    case "inference.attempt.finished": {
      if (!v2Policy(next)) {
        throw new Error("inference.attempt.finished requires agentic-execution-v2");
      }
      const attempt = findInferenceAttempt(next, event.payload.attemptId);
      if (attempt.finished !== undefined) {
        throw new Error(`Inference attempt ${event.payload.attemptId} already finished`);
      }
      const openAttempt = openInferenceAttempt(next);
      if (openAttempt?.attemptId !== attempt.attemptId) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} is not the open attempt`,
        );
      }
      if (event.payload.checkpointId !== attempt.checkpointId) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} finish checkpoint does not match its start`,
        );
      }
      if (
        event.payload.servedModel !== undefined &&
        event.payload.servedModel !== attempt.requestedModel
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} served model does not match its requested model`,
        );
      }
      if (
        (attempt.budgetReservationId === undefined) !==
          (event.payload.cost.reservationId === undefined) ||
        (attempt.budgetReservationId !== undefined &&
          event.payload.cost.reservationId !== attempt.budgetReservationId)
      ) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} cost reservation does not match its start`,
        );
      }
      if (attempt.budgetReservationId === undefined) {
        if (
          event.payload.cost.amountMicrousd !== 0 ||
          event.payload.cost.provenance !== "local_zero_cost_policy"
        ) {
          throw new Error(
            `Unreserved inference attempt ${event.payload.attemptId} must use local zero-cost accounting`,
          );
        }
      } else if (
        event.payload.cost.provenance === "local_zero_cost_policy"
      ) {
        throw new Error(
          `Reserved inference attempt ${event.payload.attemptId} cannot use local zero-cost accounting`,
        );
      }
      if (event.payload.cost.provenance === "reserved_unknown") {
        const decision = next.routingDecisions.find(
          (candidate) => candidate.decisionId === attempt.decisionId,
        );
        if (
          decision?.reasonCode !== "cloud_admitted" ||
          decision.billing === undefined ||
          decision.budgetReservationId === undefined ||
          event.payload.cost.reservationId !==
            decision.budgetReservationId ||
          event.payload.cost.amountMicrousd !==
            decision.billing.projectedCostMicrousd
        ) {
          throw new Error(
            `reserved_unknown cost for inference attempt ${event.payload.attemptId} must equal its originating full reservation`,
          );
        }
      }
      const message = findMessage(next, attempt.messageId);
      if (message.role !== "assistant" || message.attemptId !== attempt.attemptId) {
        throw new Error(
          `Inference attempt ${event.payload.attemptId} does not match its assistant message`,
        );
      }
      if (event.payload.outcome === "succeeded") {
        if (message.status === "streaming") {
          throw new Error(
            `Successful inference attempt ${attempt.attemptId} requires a completed assistant message`,
          );
        }
        if (event.payload.finishReason !== message.stopReason) {
          throw new Error(
            `Successful inference attempt ${attempt.attemptId} finish reason does not match its assistant message`,
          );
        }
        if (attempt.requireToolCall && message.stopReason !== "tool_calls") {
          throw new Error(
            `Inference attempt ${attempt.attemptId} required a tool call but the assistant did not request one`,
          );
        }
        if (!attempt.allowTools && message.stopReason === "tool_calls") {
          throw new Error(
            `Tool-free inference attempt ${attempt.attemptId} cannot finish with tool_calls`,
          );
        }
      } else {
        message.status = "failed";
        message.completionState = "incomplete";
        if (event.payload.finishReason !== undefined) {
          message.stopReason = event.payload.finishReason;
        }
      }
      attempt.finished = {
        ...event.payload,
        usage: { ...event.payload.usage },
        cost: { ...event.payload.cost },
        sequence: event.sequence,
        createdAt: event.createdAt,
      };
      next.usage.inputTokens += event.payload.usage.inputTokens;
      next.usage.outputTokens += event.payload.usage.outputTokens;
      next.usage.reasoningTokens += event.payload.usage.reasoningTokens;
      next.usage.costUsd += event.payload.cost.amountMicrousd / 1_000_000;
      next.usage.latencyMs += event.payload.latencyMs;
      if (event.payload.ttftMs !== undefined) {
        next.usage.ttftMs = event.payload.ttftMs;
      }
      break;
    }
    case "completion.obligations.checked": {
      if (v2Policy(next)) {
        const attempt = next.inferenceAttempts.at(-1);
        if (
          !attempt?.finished ||
          attempt.finished.outcome !== "succeeded" ||
          attempt.messageId !== event.payload.messageId ||
          next.lastV2EventType !== "inference.attempt.finished"
        ) {
          throw new Error(
            `Completion obligation check ${event.payload.checkId} requires the immediately preceding successful v2 attempt`,
          );
        }
      }
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
      if (v2Policy(next)) {
        throw new Error(
          "usage.recorded is a v1-only source; v2 usage derives from finished attempts",
        );
      }
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
      assertV2TerminalReady(next, event.type);
      if (v2Policy(next)) {
        const finalMessage = [...next.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (
          !finalMessage ||
          finalMessage.status !== "completed" ||
          (event.payload.result !== undefined &&
            event.payload.result !== finalMessage.content)
        ) {
          throw new Error(
            `Session ${event.sessionId} v2 completion result must match its successful final assistant message`,
          );
        }
      }
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
      assertV2TerminalReady(next, event.type);
      next.status = "failed";
      next.error = event.payload.error;
      break;
    case "session.cancelled":
      assertV2TerminalReady(next, event.type);
      next.status = "cancelled";
      next.error = event.payload.reason;
      break;
    case "session.interrupted":
      assertV2TerminalReady(next, event.type);
      next.status = "interrupted";
      next.error = event.payload.reason;
      for (const message of next.messages) {
        if (message.status === "streaming") {
          message.status = "failed";
        }
      }
      break;
  }

  if (v2Policy(next)) {
    next.lastV2EventType = event.type;
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
