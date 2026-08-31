import { homedir } from "node:os";

import {
  assertProviderMessagesSha256,
} from "../../shared/context-compiler";
import {
  proposeCheckpointRouteV0,
  resolveCheckpointRouteV0,
  type CheckpointRouterResultV0,
} from "../../shared/checkpoint-router";
import {
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_ROUTING_POLICY_ID,
} from "../../shared/hybrid-simulation-contracts";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  parseRawReviewResultV1,
  type ReviewResultV1,
} from "../../shared/review-result-contract";
import {
  CloudEgressAdmissionRecordV1Schema,
  InferenceAttemptFinishedPayloadSchema,
  type CloudEgressAdmissionRecordV1,
  type AgenticExecutionPolicyV2,
  type InferenceAttemptFinishedPayload,
  type SessionEventData,
} from "../../shared/session-events";
import { completedRequiredToolPrefix } from "../../shared/session-reducer";
import { AttemptUnitOfWork } from "../attempt-unit-of-work";
import {
  BUDGET_CACHE_ASSUMPTION,
  BudgetLedger,
  type BudgetProjectionInput,
  type BudgetReservationResolution,
} from "../budget-ledger";
import { deriveReviewCoverageV1 } from "../change-acquisition-contracts";
import {
  CLOUD_EGRESS_POLICY_VERSION,
  evaluateCloudEgressPolicyV1,
  type CloudEgressProvenanceManifestV1,
} from "../cloud-egress-policy";
import {
  assertHybridSimulationRuntimeV1,
  hybridSimulationAuthoritySnapshotV1,
  type HybridSimulationRuntimeV1,
} from "../hybrid-simulation-runtime";
import type { ProviderRegistration } from "../providers/provider-registry";
import {
  ProviderAbortedError,
  type ProviderResult,
} from "../providers/types";
import { compileReviewContextV1 } from "../review-context-compiler-v1";
import { buildReviewCloudEgressProvenanceV1 } from "../review-cloud-egress";
import { deriveVerifiedReviewEvidenceV1 } from "../review-event-provenance";
import { assertHostAcceptedReviewResultV1 } from "../review-result-acceptance";
import { extractVerifiedReviewRiskV1 } from "../review-risk";
import { toCheckpointRouterRiskV0 } from "../routing/review-risk-router-input";
import { inspectGitChanges } from "../tools/inspect-git-changes";
import { invokeProviderWithAbortRace } from "./provider-invocation";
import {
  REVIEW_SYSTEM_PROMPT,
  acquireChangeReviewEvidenceV1,
  allocateId,
  allocateIds,
  appendTerminal,
  attemptIdentity,
  containsSensitiveProviderOutput,
  notify,
  providerSnapshot,
  reviewContextEventV1,
  routerState,
  runLocalReviewSynthesisV1,
  safeDuration,
  startEvents,
  timestamp,
  usage,
  type AttemptIdentity,
  type PrestartedLocalReviewSynthesisV1,
  type RunLocalChangeReviewOptions,
  type StrictChangeReviewRouteV1,
} from "./run-local-change-review";

export interface RunHybridChangeReviewOptions
  extends Omit<RunLocalChangeReviewOptions, "runtime"> {
  runtime: HybridSimulationRuntimeV1;
}

interface CloudInvocationV1 {
  invoked: boolean;
  result?: ProviderResult;
  timedOut: boolean;
  cancelled: boolean;
}

interface CloudReviewAssessmentV1 {
  outcome: InferenceAttemptFinishedPayload["outcome"];
  errorCode?: string;
  parseStatus:
    | "accepted"
    | "invalid_json"
    | "schema_invalid"
    | "semantic_invalid"
    | "snapshot_stale"
    | "not_received";
  result?: ReviewResultV1;
  coverage?: ReturnType<typeof deriveReviewCoverageV1>;
  usage?: InferenceAttemptFinishedPayload["usage"];
  terminalError?: string;
  eligibleFallback: boolean;
}

const CLOUD_FAILURE_MESSAGES = {
  coordinator_error:
    "The Hybrid simulation coordinator failed before it could safely complete.",
  provider_error: "The fake Cloud review request failed.",
  provider_sensitive_output:
    "The fake Cloud review response contained a forbidden sensitive value.",
  provider_model_mismatch:
    "The fake Cloud review response reported the wrong model.",
  provider_protocol_error:
    "The fake Cloud review response violated the tool-free completion protocol.",
  provider_usage_invalid:
    "The fake Cloud review response did not contain trustworthy usage.",
  result_schema_invalid:
    "The fake Cloud review response did not satisfy ReviewResultV1.",
  result_semantic_invalid:
    "The fake Cloud review response failed host grounding acceptance.",
  workspace_snapshot_stale:
    "The workspace changed during fake Cloud synthesis; the stale review was rejected.",
  workspace_revalidation_failed:
    "The workspace could not be revalidated after fake Cloud synthesis.",
} as const;

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCompleteSnapshot(
  snapshot: ReturnType<typeof deriveVerifiedReviewEvidenceV1>["snapshot"],
): boolean {
  return (
    snapshot.omittedPathCount === 0 &&
    snapshot.omittedHunkCount === 0 &&
    snapshot.manifestOmissionCodes.length === 0 &&
    snapshot.manifest.every((entry) => entry.omissionCodes.length === 0)
  );
}

function reviewParseFailure(content: string): "invalid_json" | "schema_invalid" {
  try {
    JSON.parse(content);
    return "schema_invalid";
  } catch {
    return "invalid_json";
  }
}

function requireDecision(
  result: CheckpointRouterResultV0,
  boundary: "evidence_complete" | "provider_failure",
): StrictChangeReviewRouteV1 {
  if (result.kind !== "decision") {
    throw new Error(`Hybrid simulation ${boundary} routing was denied.`);
  }
  return result;
}

function prepareLocalSynthesis(options: {
  runner: RunLocalChangeReviewOptions;
  registration: ProviderRegistration;
  route: StrictChangeReviewRouteV1;
  identity: AttemptIdentity;
  stateBeforeStart: ReturnType<RunLocalChangeReviewOptions["store"]["getProjectedState"]>;
  verified: ReturnType<typeof deriveVerifiedReviewEvidenceV1>;
  compiled?: ReturnType<typeof compileReviewContextV1>;
}): PrestartedLocalReviewSynthesisV1 {
  const reserve =
    options.registration.provider.estimateInputTokenReserve?.(
      false,
      undefined,
      false,
      REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    ) ?? options.registration.descriptor.requestReserveTokens;
  return {
    stateBeforeStart: options.stateBeforeStart,
    identity: options.identity,
    route: options.route,
    verified: options.verified,
    compiled: options.compiled ?? compileReviewContextV1({
      objective: options.stateBeforeStart.objective,
      verifiedEvidence: options.verified,
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      maxInputTokens:
        options.registration.descriptor.contextWindowTokens -
        options.route.attempt.requestedMaxOutputTokens,
      reservedInputTokens: reserve,
      safetyMargin: options.runner.context.safetyMargin,
    }),
  };
}

function prepareCloudContext(options: {
  runner: RunLocalChangeReviewOptions;
  registration: ProviderRegistration;
  state: ReturnType<RunLocalChangeReviewOptions["store"]["getProjectedState"]>;
  verified: ReturnType<typeof deriveVerifiedReviewEvidenceV1>;
  requestedMaxOutputTokens: number;
}) {
  const reserve =
    options.registration.provider.estimateInputTokenReserve?.(
      false,
      undefined,
      false,
      REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    ) ?? options.registration.descriptor.requestReserveTokens;
  return compileReviewContextV1({
    objective: options.state.objective,
    verifiedEvidence: options.verified,
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    maxInputTokens:
      options.registration.descriptor.contextWindowTokens -
      options.requestedMaxOutputTokens,
    reservedInputTokens: reserve,
    safetyMargin: options.runner.context.safetyMargin,
  });
}

function projectionForCloud(options: {
  compiled: ReturnType<typeof compileReviewContextV1>;
  requestedMaxOutputTokens: number;
  pricing: ReturnType<HybridSimulationRuntimeV1["pricingSnapshotProvider"]>;
}): BudgetProjectionInput {
  const billableInputTokens =
    options.compiled.telemetry.estimatedTokens +
    options.compiled.telemetry.reservedInputTokens;
  if (!Number.isSafeInteger(billableInputTokens)) {
    throw new RangeError("Hybrid simulation input projection is unsafe.");
  }
  return {
    billableInputTokens,
    billableCacheReadTokens: 0,
    requestedMaxOutputTokens: options.requestedMaxOutputTokens,
    inputMicrousdPerMillionTokens:
      options.pricing.inputMicrousdPerMillionTokens,
    outputMicrousdPerMillionTokens:
      options.pricing.outputMicrousdPerMillionTokens,
    cacheReadMicrousdPerMillionTokens:
      options.pricing.cacheReadMicrousdPerMillionTokens,
    providerFeeCeilingMicrousd: 0,
    cacheAssumption: BUDGET_CACHE_ASSUMPTION,
  };
}

async function invokeFakeCloud(options: {
  runner: RunLocalChangeReviewOptions;
  runtime: HybridSimulationRuntimeV1;
  policy: AgenticExecutionPolicyV2;
  registration: ProviderRegistration;
  route: StrictChangeReviewRouteV1;
  compiled: ReturnType<typeof compileReviewContextV1>;
  admission: CloudEgressAdmissionRecordV1;
  provenance: CloudEgressProvenanceManifestV1;
}): Promise<CloudInvocationV1> {
  if (options.runner.controller.signal.aborted) {
    return { invoked: false, timedOut: false, cancelled: true };
  }
  const current = options.runner.store.getProjectedState(
    options.runner.sessionId,
  );
  const remaining =
    current.deadlineAt === undefined
      ? 0
      : Date.parse(current.deadlineAt) -
        Date.parse(timestamp(options.runner, current));
  if (remaining <= 0) {
    return { invoked: false, timedOut: true, cancelled: false };
  }
  const persisted = current.contextCompilations.at(-1);
  const persistedDecision = current.routingDecisions.at(-1);
  const reboundEgress = evaluateCloudEgressPolicyV1({
    messages: options.compiled.messages,
    provenance: options.provenance,
    hostBoundary: {
      canonicalWorkspaceRoot: current.workspaceRoot,
      canonicalHomeRoot: homedir(),
      knownSecretValues: (options.runner.sensitiveValues ?? []).filter(
        (value) => value.length > 0,
      ),
    },
    requestPolicy: { toolDefinitions: "none" },
  });
  if (
    persisted?.checkpointId !== options.admission.checkpointId ||
    persisted.messagesSha256 !== options.admission.messagesSemanticSha256 ||
    persisted.messagesSha256 !== options.compiled.telemetry.messagesSha256 ||
    options.route.decision.messagesSha256 !== persisted.messagesSha256 ||
    persistedDecision?.cloudEgressAdmissionId !== options.admission.admissionId ||
    persistedDecision.provenanceSemanticSha256 !==
      options.admission.provenanceSemanticSha256 ||
    options.route.decision.provenanceSemanticSha256 !==
      options.admission.provenanceSemanticSha256 ||
    reboundEgress.policyVersion !== options.admission.policyVersion ||
    reboundEgress.decision !== options.admission.decision ||
    !exactJson(reboundEgress.reasonCodes, options.admission.reasonCodes) ||
    reboundEgress.messagesSemanticSha256 !==
      options.admission.messagesSemanticSha256 ||
    reboundEgress.provenanceSemanticSha256 !==
      options.admission.provenanceSemanticSha256
  ) {
    throw new Error(
      "Hybrid simulation message or provenance identity changed before dispatch.",
    );
  }
  assertProviderMessagesSha256(
    options.compiled.messages,
    options.admission.messagesSemanticSha256,
  );

  await options.runtime.testHooks?.beforeFakeCloudDispatch?.();
  if (options.runner.controller.signal.aborted) {
    return { invoked: false, timedOut: false, cancelled: true };
  }
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    Math.min(options.policy.attemptTimeoutMs, remaining, 2_147_483_647),
  );
  let invoked = false;
  try {
    const result = await invokeProviderWithAbortRace({
      userSignal: options.runner.controller.signal,
      timeoutSignal: timeoutController.signal,
      getPartialContent: () => "",
      invoke: (signal) => {
        invoked = true;
        return options.registration.provider.complete({
          messages: [...options.compiled.messages],
          signal,
          requestedMaxOutputTokens:
            options.route.attempt.requestedMaxOutputTokens,
          allowTools: false,
          requireToolCall: false,
          structuredOutputContract:
            REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
          // Raw structured output is retained only in this stack frame until
          // host acceptance; it is never streamed into renderer state.
          onDelta: () => undefined,
        });
      },
    });
    return {
      invoked,
      result,
      timedOut: timeoutController.signal.aborted,
      cancelled: options.runner.controller.signal.aborted,
    };
  } catch (error) {
    return {
      invoked,
      timedOut:
        !options.runner.controller.signal.aborted &&
        (timeoutController.signal.aborted ||
          (error instanceof ProviderAbortedError &&
            error.abortKind === "timeout")),
      cancelled: options.runner.controller.signal.aborted,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function assessCloudReview(options: {
  runner: RunLocalChangeReviewOptions;
  runtime: HybridSimulationRuntimeV1;
  invocation: CloudInvocationV1;
  expectedModel: string;
  verified: ReturnType<typeof deriveVerifiedReviewEvidenceV1>;
}): Promise<CloudReviewAssessmentV1> {
  const { invocation } = options;
  if (invocation.cancelled || options.runner.controller.signal.aborted) {
    return {
      outcome: "cancelled",
      errorCode: "user_cancelled",
      parseStatus: "not_received",
      eligibleFallback: false,
    };
  }
  if (invocation.result === undefined) {
    const timedOut = invocation.timedOut;
    return {
      outcome: timedOut ? "timeout" : "provider_error",
      errorCode: timedOut ? "attempt_timeout" : "provider_error",
      parseStatus: "not_received",
      eligibleFallback: true,
    };
  }
  const result = invocation.result;
  if (
    containsSensitiveProviderOutput(
      result,
      options.runner.sensitiveValues ?? [],
    )
  ) {
    return {
      outcome: "protocol_error",
      errorCode: "provider_sensitive_output",
      parseStatus: "not_received",
      eligibleFallback: true,
    };
  }
  if (result.servedModel !== options.expectedModel) {
    return {
      outcome: "protocol_error",
      errorCode: "provider_model_mismatch",
      parseStatus: "schema_invalid",
      eligibleFallback: true,
    };
  }
  if (result.finishReason !== "stop" || result.toolCalls.length !== 0) {
    return {
      outcome: "protocol_error",
      errorCode: "provider_protocol_error",
      parseStatus: "schema_invalid",
      eligibleFallback: true,
    };
  }
  let reportedUsage: InferenceAttemptFinishedPayload["usage"];
  try {
    reportedUsage = usage(result);
  } catch {
    return {
      outcome: "protocol_error",
      errorCode: "provider_usage_invalid",
      parseStatus: "schema_invalid",
      eligibleFallback: true,
    };
  }
  let parsed: ReviewResultV1;
  try {
    parsed = parseRawReviewResultV1(result.content);
  } catch {
    return {
      outcome: "protocol_error",
      errorCode: "result_schema_invalid",
      parseStatus: reviewParseFailure(result.content),
      usage: reportedUsage,
      eligibleFallback: true,
    };
  }
  let current;
  try {
    current = await inspectGitChanges({
      workspaceRoot: options.runner.store.requireSession(
        options.runner.sessionId,
      ).workspaceRoot,
      request: { schemaVersion: "inspect-git-changes-v1" },
      signal: options.runner.controller.signal,
    });
  } catch {
    if (options.runner.controller.signal.aborted) {
      return {
        outcome: "cancelled",
        errorCode: "user_cancelled",
        parseStatus: "not_received",
        usage: reportedUsage,
        eligibleFallback: false,
      };
    }
    return {
      outcome: "protocol_error",
      errorCode: "workspace_revalidation_failed",
      parseStatus: "snapshot_stale",
      usage: reportedUsage,
      terminalError: CLOUD_FAILURE_MESSAGES.workspace_revalidation_failed,
      eligibleFallback: false,
    };
  }
  await options.runtime.testHooks?.afterCloudWorkspaceRevalidation?.();
  if (options.runner.controller.signal.aborted) {
    return {
      outcome: "cancelled",
      errorCode: "user_cancelled",
      parseStatus: "not_received",
      usage: reportedUsage,
      eligibleFallback: false,
    };
  }
  if (current.snapshot.snapshotId !== options.verified.snapshot.snapshotId) {
    return {
      outcome: "protocol_error",
      errorCode: "workspace_snapshot_stale",
      parseStatus: "snapshot_stale",
      usage: reportedUsage,
      terminalError: CLOUD_FAILURE_MESSAGES.workspace_snapshot_stale,
      eligibleFallback: false,
    };
  }
  const snapshotRevalidated = isCompleteSnapshot(options.verified.snapshot);
  const coverage = deriveReviewCoverageV1({
    snapshot: options.verified.snapshot,
    evidenceSet: options.verified.evidenceSet,
    packetRetainedEvidenceSet: true,
    snapshotRevalidated,
  });
  try {
    const accepted = assertHostAcceptedReviewResultV1(parsed, {
      snapshot: options.verified.snapshot,
      evidenceSet: options.verified.evidenceSet,
      coverage,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated,
    });
    return {
      outcome: "succeeded",
      parseStatus: "accepted",
      result: accepted,
      coverage,
      usage: reportedUsage,
      eligibleFallback: false,
    };
  } catch {
    return {
      outcome: "protocol_error",
      errorCode: "result_semantic_invalid",
      parseStatus: "semantic_invalid",
      usage: reportedUsage,
      eligibleFallback: true,
    };
  }
}

function hostPricedMicrousd(options: {
  usage: InferenceAttemptFinishedPayload["usage"];
  projection: BudgetProjectionInput;
}): number {
  const component = (tokens: number, rate: number): bigint =>
    (BigInt(tokens) * BigInt(rate) + 999_999n) / 1_000_000n;
  const cacheRead = options.usage.cacheReadTokens ?? 0;
  const amount =
    component(
      options.usage.inputTokens - cacheRead,
      options.projection.inputMicrousdPerMillionTokens,
    ) +
    component(
      options.usage.outputTokens + options.usage.reasoningTokens,
      options.projection.outputMicrousdPerMillionTokens,
    ) +
    component(
      cacheRead,
      options.projection.cacheReadMicrousdPerMillionTokens ?? 0,
    ) +
    BigInt(options.projection.providerFeeCeilingMicrousd);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Hybrid simulation settled cost is unsafe.");
  }
  return Number(amount);
}

function cloudCost(options: {
  invocation: CloudInvocationV1;
  assessment: CloudReviewAssessmentV1;
  resolution: Extract<BudgetReservationResolution, { status: "admitted" }>;
  projection: BudgetProjectionInput;
}) {
  const reservationId = options.resolution.reservation.id;
  if (!options.invocation.invoked) {
    return {
      amountMicrousd: 0,
      provenance: "host_pricing_snapshot" as const,
      reservationId,
      costScope: "simulation" as const,
    };
  }
  if (options.assessment.outcome === "cancelled") {
    return {
      amountMicrousd: options.resolution.reservation.amountMicrousd,
      provenance: "reserved_unknown" as const,
      reservationId,
      costScope: "simulation" as const,
    };
  }
  const providerCost = options.invocation.result?.costUsd;
  if (
    options.assessment.usage?.reported === true &&
    typeof providerCost === "number" &&
    Number.isFinite(providerCost) &&
    providerCost >= 0 &&
    providerCost * 1_000_000 <= Number.MAX_SAFE_INTEGER
  ) {
    return {
      amountMicrousd: Math.ceil(providerCost * 1_000_000),
      provenance: "provider_reported" as const,
      reservationId,
      costScope: "simulation" as const,
    };
  }
  if (options.assessment.usage?.reported === true) {
    return {
      amountMicrousd: hostPricedMicrousd({
        usage: options.assessment.usage,
        projection: options.projection,
      }),
      provenance: "host_pricing_snapshot" as const,
      reservationId,
      costScope: "simulation" as const,
    };
  }
  return {
    amountMicrousd: options.resolution.reservation.amountMicrousd,
    provenance: "reserved_unknown" as const,
    reservationId,
    costScope: "simulation" as const,
  };
}

function completeAcceptedReview(options: {
  runner: RunLocalChangeReviewOptions;
  policy: AgenticExecutionPolicyV2;
  identity: AttemptIdentity;
  content: string;
}): void {
  const state = options.runner.store.getProjectedState(options.runner.sessionId);
  const successfulRequiredTools = completedRequiredToolPrefix(
    state.messages,
    state.completionObligations.requiredSuccessfulTools,
  );
  const missingRequiredTools =
    state.completionObligations.requiredSuccessfulTools.slice(
      successfulRequiredTools.length,
    );
  if (missingRequiredTools.length > 0) {
    throw new Error("Hybrid review completion lost required Local evidence.");
  }
  const events: SessionEventData[] = [
    {
      type: "completion.obligations.checked",
      payload: {
        checkId: `${options.runner.sessionId}:completion:${options.identity.round}`,
        messageId: options.identity.messageId,
        round: options.identity.round,
        remainingRounds: Math.max(
          0,
          options.policy.inferenceRounds - options.identity.round,
        ),
        successfulRequiredTools,
        missingRequiredTools,
        verifiedPathLineCitations: [],
        unresolvedCitationCount: 0,
        outcome: "accepted",
      },
    },
    { type: "session.completed", payload: { result: options.content } },
  ];
  options.runner.store.appendMany(options.runner.sessionId, events, {
    expectedSequence: state.lastSequence,
    createdAt: timestamp(options.runner, state),
    eventIds: allocateIds(options.runner, events.length),
  });
  notify(options.runner);
}

async function executeCommittedCloud(options: {
  runner: RunLocalChangeReviewOptions;
  runtime: HybridSimulationRuntimeV1;
  policy: AgenticExecutionPolicyV2;
  attempts: AttemptUnitOfWork;
  registration: ProviderRegistration;
  route: StrictChangeReviewRouteV1;
  identity: AttemptIdentity;
  compiled: ReturnType<typeof compileReviewContextV1>;
  verified: ReturnType<typeof deriveVerifiedReviewEvidenceV1>;
  admission: CloudEgressAdmissionRecordV1;
  provenance: CloudEgressProvenanceManifestV1;
  resolution: Extract<BudgetReservationResolution, { status: "admitted" }>;
  projection: BudgetProjectionInput;
}): Promise<"accepted" | "fallback" | "terminal"> {
  const invocation = await invokeFakeCloud(options);
  let assessment = await assessCloudReview({
    runner: options.runner,
    runtime: options.runtime,
    invocation,
    expectedModel: options.route.attempt.model,
    verified: options.verified,
  });
  // assessCloudReview contains awaited workspace verification. Recheck once at
  // the synchronous persistence boundary so a Stop arriving in that tail can
  // never be committed as an accepted review.
  if (
    options.runner.controller.signal.aborted &&
    assessment.outcome !== "cancelled"
  ) {
    assessment = {
      outcome: "cancelled",
      errorCode: "user_cancelled",
      parseStatus: "not_received",
      ...(assessment.usage === undefined ? {} : { usage: assessment.usage }),
      eligibleFallback: false,
    };
  }
  const requestDisposition: InferenceAttemptFinishedPayload["requestDisposition"] =
    invocation.invoked
      ? invocation.result === undefined
        ? "unknown"
        : "sent"
      : "not_sent";
  const cost = cloudCost({
    invocation,
    assessment,
    resolution: options.resolution,
    projection: options.projection,
  });
  const overrun =
    cost.amountMicrousd > options.resolution.reservation.amountMicrousd;
  const reported = assessment.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    reported: false,
  };
  const finish = InferenceAttemptFinishedPayloadSchema.parse({
    attemptId: options.identity.attemptId,
    checkpointId: options.identity.checkpointId,
    outcome: assessment.outcome,
    requestDisposition,
    ...(assessment.outcome === "succeeded"
      ? {
          finishReason: invocation.result!.finishReason,
          servedModel: invocation.result!.servedModel,
        }
      : {}),
    usage: reported,
    cost,
    latencyMs: safeDuration(invocation.result?.durationMs),
    ...(assessment.outcome === "succeeded" &&
    invocation.result?.timeToFirstTokenMs !== undefined &&
    safeDuration(invocation.result.timeToFirstTokenMs) <=
      safeDuration(invocation.result.durationMs)
      ? { ttftMs: invocation.result.timeToFirstTokenMs }
      : {}),
    ...(assessment.outcome === "succeeded"
      ? {}
      : { errorCode: assessment.errorCode ?? "provider_error" }),
  });
  const assistant: SessionEventData = {
    type: "assistant.message.completed",
    payload: {
      messageId: options.identity.messageId,
      content:
        assessment.outcome === "succeeded"
          ? invocation.result?.content ?? ""
          : "",
      stopReason:
        assessment.outcome === "succeeded"
          ? invocation.result?.finishReason ?? "stop"
          : assessment.outcome === "cancelled"
            ? "cancelled"
            : assessment.outcome === "timeout"
              ? "timeout"
              : "error",
      completionState:
        assessment.outcome === "succeeded" ? "complete" : "incomplete",
      reviewParseStatus: assessment.parseStatus,
      ...(assessment.result === undefined
        ? {}
        : { reviewResult: assessment.result }),
      ...(assessment.coverage === undefined
        ? {}
        : { reviewCoverage: assessment.coverage }),
      attemptId: options.identity.attemptId,
    },
  };
  const terminal: SessionEventData | undefined =
    assessment.outcome === "cancelled"
      ? {
          type: "session.cancelled",
          payload: { reason: "Cancelled during fake Cloud synthesis." },
        }
      : overrun
        ? {
            type: "session.failed",
            payload: {
              error:
                "A simulated budget overrun exceeded the reserved maximum.",
            },
          }
        : assessment.terminalError === undefined
          ? undefined
          : {
              type: "session.failed",
              payload: { error: assessment.terminalError },
            };
  const events: SessionEventData[] = [
    assistant,
    { type: "inference.attempt.finished", payload: finish },
    ...(terminal === undefined ? [] : [terminal]),
  ];
  const state = options.runner.store.getProjectedState(options.runner.sessionId);
  options.attempts.commitAttemptFinish({
    sessionId: options.runner.sessionId,
    expectedSequence: state.lastSequence,
    createdAt: timestamp(options.runner, state),
    eventIds: allocateIds(options.runner, events.length),
    events,
    terminalLedgerEntryId: allocateId(options.runner),
  });
  notify(options.runner);
  if (terminal !== undefined) return "terminal";
  if (assessment.outcome === "succeeded") {
    completeAcceptedReview({
      runner: options.runner,
      policy: options.policy,
      identity: options.identity,
      content: invocation.result!.content,
    });
    return "accepted";
  }
  if (!assessment.eligibleFallback) {
    throw new Error("A fake Cloud failure had no valid fallback consequence.");
  }
  await options.runtime.testHooks?.afterFakeCloudFailurePersisted?.();
  return "fallback";
}

/**
 * Production-shaped, strictly fake-only Hybrid simulation change review.
 * The runtime brand, session authority, egress record, simulated campaign and
 * atomic attempt boundaries are all required before the fake Cloud call.
 */
export async function runHybridChangeReviewV1(
  options: RunHybridChangeReviewOptions,
): Promise<void> {
  const runner: RunLocalChangeReviewOptions = {
    ...options,
    runtime: {
      clock: options.runtime.clock,
      idFactory: options.runtime.idFactory,
      ...(options.runtime.attemptUnitOfWorkFactory === undefined
        ? {}
        : {
            attemptUnitOfWorkFactory:
              options.runtime.attemptUnitOfWorkFactory,
          }),
    },
  };
  try {
    const admitted = assertHybridSimulationRuntimeV1({
      runtime: options.runtime,
      providerRegistry: options.providerRegistry,
      defaultLocalProviderId: options.defaultLocalProviderId,
    });
    const initialState = options.store.getProjectedState(options.sessionId);
    const expectedAuthority = hybridSimulationAuthoritySnapshotV1(
      options.runtime,
      admitted,
    );
    const initialPolicy = initialState.executionPolicy;
    if (
      initialPolicy?.schemaVersion !== "agentic-execution-v2" ||
      initialPolicy.routingPolicy !==
        HYBRID_SIMULATION_ROUTING_POLICY_ID ||
      initialPolicy.simulationConsent !==
        HYBRID_SIMULATION_CONSENT_ID ||
      initialPolicy.egressConsent !== "none" ||
      initialState.hybridSimulation === undefined ||
      !exactJson(initialState.hybridSimulation, expectedAuthority)
    ) {
      throw new Error("The persisted Hybrid simulation authority is invalid.");
    }
    const ledger = new BudgetLedger(options.store);
    const campaign = ledger.runImmediate((transaction) =>
      transaction.requireCampaign(expectedAuthority.campaignId),
    );
    if (
      campaign.providerId !== expectedAuthority.fakeCloudProvider.providerId ||
      campaign.credentialMetadataId !==
        expectedAuthority.credentialMetadataId ||
      campaign.openingExposureMicrousd !== 0 ||
      campaign.automaticStopMicrousd !==
        expectedAuthority.maxSimulatedSpendMicrousd ||
      campaign.hardCeilingMicrousd !==
        expectedAuthority.maxSimulatedSpendMicrousd ||
      campaign.costScope !== "simulation" ||
      campaign.createdAt !== expectedAuthority.campaignCreatedAt
    ) {
      throw new Error("The persisted simulated campaign authority is invalid.");
    }

    const acquired = await acquireChangeReviewEvidenceV1({
      runner,
      expectedRoutingPolicy: HYBRID_SIMULATION_ROUTING_POLICY_ID,
      costScope: "simulation",
    });
    if (acquired === undefined) return;
    let state = options.store.getProjectedState(options.sessionId);
    const verified = deriveVerifiedReviewEvidenceV1(
      options.store.getEvents(options.sessionId),
    );
    const risk = toCheckpointRouterRiskV0(
      extractVerifiedReviewRiskV1(verified.snapshot),
    );
    const providers = admitted.descriptors.map(providerSnapshot);
    const asOf = timestamp(runner, state);
    const proposal = proposeCheckpointRouteV0({
      boundary: "evidence_complete",
      policy: acquired.policy,
      asOf,
      deadlineAt: state.deadlineAt!,
      providers,
      localProviderId: admitted.local.descriptor.id,
      cloudProviderId: admitted.cloud.descriptor.id,
      structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      state: routerState(state),
      risk,
    });
    if (proposal.intent !== "cloud_synthesis") {
      const localRoute = requireDecision(
        resolveCheckpointRouteV0({
          boundary: "evidence_complete",
          policy: acquired.policy,
          asOf,
          deadlineAt: state.deadlineAt!,
          providers,
          localProviderId: admitted.local.descriptor.id,
          cloudProviderId: admitted.cloud.descriptor.id,
          structuredOutputContract:
            REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
          state: routerState(state),
          risk,
          decisionId: allocateId(runner),
          selectedLeaseId: proposal.priorLeaseId!,
          targetHealthSnapshot: options.runtime.healthSnapshotProvider(
            admitted.local.descriptor,
            asOf,
          ),
        }),
        "evidence_complete",
      );
      await runLocalReviewSynthesisV1({
        runner,
        policy: acquired.policy,
        attempts: acquired.attempts,
        registration: admitted.local,
        health: acquired.localHealth,
        costScope: "simulation",
        preResolvedRoute: localRoute,
      });
      return;
    }

    const identity = attemptIdentity(runner, state);
    const admissionId = allocateId(runner);
    const reservationId = allocateId(runner);
    const decisionId = allocateId(runner);
    const cloudLeaseId = allocateId(runner);
    const cloudCompiled = prepareCloudContext({
      runner,
      registration: admitted.cloud,
      state,
      verified,
      requestedMaxOutputTokens: admitted.cloud.descriptor.maxOutputTokens,
    });
    const localCompiled = prepareCloudContext({
      runner,
      registration: admitted.local,
      state,
      verified,
      requestedMaxOutputTokens: admitted.local.descriptor.maxOutputTokens,
    });
    const provenance = buildReviewCloudEgressProvenanceV1({
      compiled: cloudCompiled,
      simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    });
    const egress = evaluateCloudEgressPolicyV1({
      messages: cloudCompiled.messages,
      provenance: provenance.manifest,
      hostBoundary: {
        canonicalWorkspaceRoot: state.workspaceRoot,
        canonicalHomeRoot: homedir(),
        knownSecretValues: (runner.sensitiveValues ?? []).filter(
          (value) => value.length > 0,
        ),
      },
      requestPolicy: { toolDefinitions: "none" },
    });
    if (egress.messagesSemanticSha256 !== cloudCompiled.telemetry.messagesSha256) {
      throw new Error("Hybrid simulation egress and compiler message hashes differ.");
    }
    const admission = CloudEgressAdmissionRecordV1Schema.parse({
      schemaVersion: "cloud-egress-admission-record-v1",
      admissionId,
      policyVersion: CLOUD_EGRESS_POLICY_VERSION,
      decision: egress.decision,
      reasonCodes: egress.reasonCodes,
      messagesSemanticSha256: egress.messagesSemanticSha256,
      provenanceSemanticSha256: egress.provenanceSemanticSha256,
      checkpointId: identity.checkpointId,
      simulationAuthorityId: options.runtime.simulationAuthorityId,
      evaluatedAt: asOf,
    });
    const bindEgressProvenance = (
      route: StrictChangeReviewRouteV1,
    ): StrictChangeReviewRouteV1 => ({
      ...route,
      decision: {
        ...route.decision,
        provenanceSemanticSha256: admission.provenanceSemanticSha256,
      },
    });
    const egressEvent: Extract<
      SessionEventData,
      { type: "cloud.egress.admission.recorded" }
    > = { type: "cloud.egress.admission.recorded", payload: admission };
    const cloudHealth = options.runtime.healthSnapshotProvider(
      admitted.cloud.descriptor,
      asOf,
    );
    const localHealth = options.runtime.healthSnapshotProvider(
      admitted.local.descriptor,
      asOf,
    );
    const pricing = options.runtime.pricingSnapshotProvider(
      admitted.cloud.descriptor,
      asOf,
    );
    const projection = projectionForCloud({
      compiled: cloudCompiled,
      requestedMaxOutputTokens: admitted.cloud.descriptor.maxOutputTokens,
      pricing,
    });
    const position = ledger.getBudgetPosition({
      campaignId: options.runtime.campaignId,
      sessionId: options.sessionId,
    });
    const resolveCloud = (budget: {
      remainingEpisodeMicrousd: number;
      remainingCampaignMicrousd: number;
      budgetDenialReason?: Extract<
        BudgetReservationResolution,
        { status: "denied" }
      >["reason"];
    }) =>
      requireDecision(
        resolveCheckpointRouteV0({
          boundary: "evidence_complete",
          policy: acquired.policy,
          asOf,
          deadlineAt: state.deadlineAt!,
          providers,
          localProviderId: admitted.local.descriptor.id,
          cloudProviderId: admitted.cloud.descriptor.id,
          structuredOutputContract:
            REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
          state: routerState(state),
          risk,
          decisionId,
          selectedLeaseId: cloudLeaseId,
          targetHealthSnapshot: cloudHealth,
          cloudAdmission: {
            credentialMetadataId: options.runtime.credentialMetadataId,
            credentialAvailable: options.runtime.credentialAvailable,
            retainedLocalHealthSnapshot: localHealth,
            pricingSnapshot: pricing,
            packet: {
              checkpointId: identity.checkpointId,
              packetSha256: cloudCompiled.telemetry.packetSha256,
              messagesSha256: cloudCompiled.telemetry.messagesSha256,
              egressAllowed: egress.decision === "pass",
              cloudEgressAdmissionId: admissionId,
            },
            budget: {
              campaignId: options.runtime.campaignId,
              reservationId,
              billableInputTokens: projection.billableInputTokens,
              billableCacheReadTokens: projection.billableCacheReadTokens,
              requestedMaxOutputTokens: projection.requestedMaxOutputTokens,
              providerFeeCeilingMicrousd:
                projection.providerFeeCeilingMicrousd,
              remainingEpisodeMicrousd: budget.remainingEpisodeMicrousd,
              remainingCampaignMicrousd: budget.remainingCampaignMicrousd,
              ...(budget.budgetDenialReason === undefined
                ? {}
                : { budgetDenialReason: budget.budgetDenialReason }),
            },
          },
        }),
        "evidence_complete",
      );

    // Use unbounded synthetic remaining amounts only to determine whether a
    // non-budget gate already retains Local. The persisted decision below is
    // re-resolved against the actual position.
    const gateProbe = resolveCloud({
      remainingEpisodeMicrousd: Number.MAX_SAFE_INTEGER,
      remainingCampaignMicrousd: Number.MAX_SAFE_INTEGER,
    });
    if (gateProbe.decision.reasonCode !== "cloud_admitted") {
      const retained = bindEgressProvenance(resolveCloud({
        remainingEpisodeMicrousd: position.remainingEpisodeMicrousd,
        remainingCampaignMicrousd: position.remainingCampaignMicrousd,
      }));
      await runLocalReviewSynthesisV1({
        runner,
        policy: acquired.policy,
        attempts: acquired.attempts,
        registration: admitted.local,
        health: localHealth,
        costScope: "simulation",
        preResolvedRoute: retained,
        egressAdmissionRecord: egressEvent,
      });
      return;
    }

    const localRouteFor = (resolution: BudgetReservationResolution) =>
      bindEgressProvenance(resolveCloud({
        remainingEpisodeMicrousd:
          resolution.billing.remainingEpisodeMicrousd,
        remainingCampaignMicrousd:
          resolution.billing.remainingCampaignMicrousd,
        ...(resolution.status === "denied"
          ? { budgetDenialReason: resolution.reason }
          : {}),
      }));
    const committed = acquired.attempts.commitBudgetedStart({
      sessionId: options.sessionId,
      expectedSequence: state.lastSequence,
      createdAt: asOf,
      eventIds: {
        admitted: allocateIds(runner, 6),
        denied: allocateIds(runner, 5),
      },
      campaignId: options.runtime.campaignId,
      reservationId,
      attemptId: identity.attemptId,
      providerId: admitted.cloud.descriptor.id,
      pricingSnapshotId: pricing.snapshotId,
      costScope: "simulation",
      cloudEgressAdmissionId: admissionId,
      projection,
      buildEvents: (resolution) => {
        const route = localRouteFor(resolution);
        const cloudAdmitted = resolution.status === "admitted";
        if (
          cloudAdmitted !==
          (route.decision.reasonCode === "cloud_admitted")
        ) {
          throw new Error("Locked simulated budget and router disagree.");
        }
        const preparedLocal = cloudAdmitted
          ? undefined
          : prepareLocalSynthesis({
              runner,
              registration: admitted.local,
              route,
              identity,
              stateBeforeStart: state,
              verified,
              compiled: localCompiled,
            });
        const compiled = cloudAdmitted
          ? cloudCompiled
          : preparedLocal!.compiled;
        return [
          egressEvent,
          ...startEvents({
            state,
            identity,
            decision: route.decision,
            plan: route.attempt,
            contextEvent: reviewContextEventV1({
              identity,
              route,
              compiled,
              verified,
            }),
            includeDecision: true,
            includeRoute: cloudAdmitted,
            structured: true,
            costScope: "simulation",
          }),
        ];
      },
    });
    notify(runner);
    if (committed.budgetResolution?.status === "denied") {
      const deniedRoute = localRouteFor(committed.budgetResolution);
      const lockedPreparedLocal = prepareLocalSynthesis({
        runner,
        registration: admitted.local,
        route: deniedRoute,
        identity,
        stateBeforeStart: state,
        verified,
        compiled: localCompiled,
      });
      await runLocalReviewSynthesisV1({
        runner,
        policy: acquired.policy,
        attempts: acquired.attempts,
        registration: admitted.local,
        health: localHealth,
        costScope: "simulation",
        preResolvedRoute: lockedPreparedLocal.route,
        prestarted: lockedPreparedLocal,
      });
      return;
    }
    if (committed.budgetResolution?.status !== "admitted") {
      throw new Error("Simulated budget admission returned no resolution.");
    }
    const cloudRoute = localRouteFor(committed.budgetResolution);
    const cloudOutcome = await executeCommittedCloud({
      runner,
      runtime: options.runtime,
      policy: acquired.policy,
      attempts: acquired.attempts,
      registration: admitted.cloud,
      route: cloudRoute,
      identity,
      compiled: cloudCompiled,
      verified,
      admission,
      provenance: provenance.manifest,
      resolution: committed.budgetResolution,
      projection,
    });
    if (cloudOutcome !== "fallback") return;
    if (runner.controller.signal.aborted) {
      appendTerminal(runner, {
        type: "session.cancelled",
        payload: { reason: "Cancelled before Local fallback." },
      });
      return;
    }
    state = options.store.getProjectedState(options.sessionId);
    const fallbackAsOf = timestamp(runner, state);
    const fallback = bindEgressProvenance(requireDecision(
      resolveCheckpointRouteV0({
        boundary: "provider_failure",
        policy: acquired.policy,
        asOf: fallbackAsOf,
        deadlineAt: state.deadlineAt!,
        providers,
        localProviderId: admitted.local.descriptor.id,
        cloudProviderId: admitted.cloud.descriptor.id,
        structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
        state: routerState(state),
        decisionId: allocateId(runner),
        selectedLeaseId: allocateId(runner),
        targetHealthSnapshot: options.runtime.healthSnapshotProvider(
          admitted.local.descriptor,
          fallbackAsOf,
        ),
      }),
      "provider_failure",
    ));
    await runLocalReviewSynthesisV1({
      runner,
      policy: acquired.policy,
      attempts: acquired.attempts,
      registration: admitted.local,
      health: options.runtime.healthSnapshotProvider(
        admitted.local.descriptor,
        fallbackAsOf,
      ),
      costScope: "simulation",
      preResolvedRoute: fallback,
    });
  } catch {
    const state = options.store.getProjectedState(options.sessionId);
    if (state.inferenceAttempts.some((attempt) => attempt.finished === undefined)) {
      // A committed open attempt is recovered as unknown/interrupted on restart;
      // dispatching or fabricating a finish after an orchestration fault is unsafe.
      return;
    }
    appendTerminal(
      {
        ...runner,
        runtime: undefined,
      },
      options.controller.signal.aborted
        ? {
            type: "session.cancelled",
            payload: { reason: "Cancelled during Hybrid simulation." },
          }
        : {
            type: "session.failed",
            payload: { error: CLOUD_FAILURE_MESSAGES.coordinator_error },
          },
    );
  }
}
