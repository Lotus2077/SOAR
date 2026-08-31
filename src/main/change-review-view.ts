import type {
  ChangeReviewView,
  ReviewCoverageView,
  ReviewFreshness,
  ReviewPhaseView,
  ReviewRoutePhaseView,
} from "../shared/contracts";
import {
  ReviewCoverageV1Schema,
  type ChangeSnapshotV1,
} from "../shared/change-review-contracts";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  ReviewResultV1Schema,
  parseRawReviewResultV1,
} from "../shared/review-result-contract";
import type {
  CanonicalMessage,
  InferenceAttemptRecord,
  RoutingDecisionRecord,
  SessionState,
} from "../shared/session-reducer";
import type { EventStore } from "./event-store";
import {
  assertReviewCoverageV1,
  canonicalChangeJson,
} from "./change-acquisition-contracts";
import { deriveVerifiedReviewEvidenceV1 } from "./review-event-provenance";
import { assertHostAcceptedReviewResultV1 } from "./review-result-acceptance";
import { inspectGitChanges } from "./tools/inspect-git-changes";
import {
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
} from "../shared/hybrid-simulation-contracts";

const PHASE_LABELS = {
  inspection: "Local inspection",
  checkpoint: "Routing checkpoint",
  synthesis: "Local synthesis",
  fallback: "Fallback",
} as const;

type PhaseStatus = ReviewPhaseView["status"];

interface AcceptedReview {
  message: CanonicalMessage;
  attempt: InferenceAttemptRecord;
  result: ReturnType<typeof ReviewResultV1Schema.parse>;
  coverage: ReturnType<typeof ReviewCoverageV1Schema.parse>;
  snapshot: ChangeSnapshotV1;
}

function allToolCalls(state: SessionState) {
  return state.messages.flatMap((message) => message.toolCalls ?? []);
}

function terminalPhaseStatus(state: SessionState): PhaseStatus | undefined {
  if (state.status === "cancelled") return "cancelled";
  if (state.status === "failed" || state.status === "interrupted") {
    return "failed";
  }
  return undefined;
}

function completeSnapshot(snapshot: ChangeSnapshotV1): boolean {
  return (
    snapshot.omittedPathCount === 0 &&
    snapshot.omittedHunkCount === 0 &&
    snapshot.manifestOmissionCodes.length === 0 &&
    snapshot.manifest.every((entry) => entry.omissionCodes.length === 0)
  );
}

/**
 * Re-prove the complete acceptance chain before anything model-authored may
 * cross into the renderer. The persisted `accepted` label is an audit fact,
 * not sufficient authority by itself: replay must still bind the terminal
 * check, raw provider JSON, immutable evidence, derived coverage, and host
 * semantic acceptance to the same final message.
 */
function acceptedReview(
  store: EventStore,
  state: SessionState,
): AcceptedReview | undefined {
  if (state.status !== "completed") return undefined;

  const message = [...state.messages]
    .reverse()
    .find((candidate) => candidate.role === "assistant");
  if (
    message?.status !== "completed" ||
    message.reviewParseStatus !== "accepted" ||
    message.reviewResult === undefined ||
    message.reviewCoverage === undefined ||
    message.attemptId === undefined ||
    state.result !== message.content
  ) {
    return undefined;
  }

  const finalCheck = state.completionChecks.at(-1);
  const attempt = state.inferenceAttempts.find(
    (candidate) => candidate.attemptId === message.attemptId,
  );
  if (
    finalCheck?.outcome !== "accepted" ||
    finalCheck.messageId !== message.id ||
    finalCheck.sequence !== state.lastSequence - 1 ||
    attempt?.messageId !== message.id ||
    attempt.round !== finalCheck.round ||
    attempt.structuredOutputContract !== "change-review-result-v1" ||
    attempt.structuredOutputSchemaSha256 !==
      REVIEW_RESULT_V1_JSON_SCHEMA_SHA256 ||
    attempt.finished?.outcome !== "succeeded" ||
    attempt.finished.sequence !== finalCheck.sequence - 1
  ) {
    return undefined;
  }

  const checkpoint = state.contextCompilations.find(
    (candidate) => candidate.checkpointId === attempt.checkpointId,
  );
  if (
    checkpoint?.compilerVersion !== "review-context-compiler-v1" ||
    checkpoint.messageId !== message.id ||
    checkpoint.attemptId !== attempt.attemptId ||
    checkpoint.decisionId !== attempt.decisionId ||
    checkpoint.leaseId !== attempt.leaseId ||
    checkpoint.structuredOutputContract !== attempt.structuredOutputContract ||
    checkpoint.structuredOutputSchemaSha256 !==
      attempt.structuredOutputSchemaSha256 ||
    checkpoint.omittedEvidenceCount !== 0
  ) {
    return undefined;
  }

  try {
    const verified = deriveVerifiedReviewEvidenceV1(
      store.getEvents(state.id),
    );
    if (
      verified.sessionId !== state.id ||
      checkpoint.reviewSnapshotId !== verified.snapshot.snapshotId ||
      checkpoint.reviewEvidenceSetId !== verified.evidenceSet.evidenceSetId ||
      checkpoint.reviewProvenanceSha256 !==
        verified.provenance.provenanceSha256 ||
      checkpoint.evidenceCount !== verified.evidenceBodies.length
    ) {
      return undefined;
    }

    const attachedResult = ReviewResultV1Schema.parse(message.reviewResult);
    const rawResult = parseRawReviewResultV1(message.content);
    if (
      canonicalChangeJson(attachedResult) !== canonicalChangeJson(rawResult)
    ) {
      return undefined;
    }

    const snapshotRevalidated = completeSnapshot(verified.snapshot);
    const coverage = assertReviewCoverageV1({
      coverage: ReviewCoverageV1Schema.parse(message.reviewCoverage),
      snapshot: verified.snapshot,
      evidenceSet: verified.evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated,
    });
    const result = assertHostAcceptedReviewResultV1(rawResult, {
      snapshot: verified.snapshot,
      evidenceSet: verified.evidenceSet,
      coverage,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated,
    });
    return { message, attempt, result, coverage, snapshot: verified.snapshot };
  } catch {
    // Renderer-facing projection fails closed without forwarding raw provider,
    // repository, endpoint, or validator diagnostics across IPC.
    return undefined;
  }
}

function synthesisDecision(
  state: SessionState,
  accepted: AcceptedReview | undefined,
): RoutingDecisionRecord | undefined {
  const acceptedDecisionId = accepted?.message.decisionId;
  if (acceptedDecisionId !== undefined) {
    const exact = state.routingDecisions.find(
      (decision) => decision.decisionId === acceptedDecisionId,
    );
    if (exact !== undefined) return exact;
  }
  return [...state.routingDecisions]
    .reverse()
    .find((decision) => decision.phase === "synthesis") ??
    state.routingDecisions.at(-1);
}

function routeView(
  state: SessionState,
  decision: RoutingDecisionRecord | undefined,
): ChangeReviewView["route"] | undefined {
  if (decision === undefined) return undefined;
  const providerSnapshot = decision.routerInputSnapshot?.providers.find(
    (provider) =>
      provider.providerId === decision.selectedProviderId &&
      provider.model === decision.selectedModel,
  );
  const locality =
    providerSnapshot?.locality ??
    (state.executionPolicy?.schemaVersion === "agentic-execution-v2" &&
    state.executionPolicy.routingPolicy === "local_only_v1"
      ? "local"
      : undefined);
  if (locality === undefined) return undefined;
  return {
    providerId: decision.selectedProviderId,
    model: decision.selectedModel,
    locality,
    reasonCode: decision.reasonCode,
  };
}

function phase(
  id: ReviewPhaseView["id"],
  status: PhaseStatus,
): ReviewPhaseView {
  return { id, status, label: PHASE_LABELS[id] };
}

function phaseTimeline(
  state: SessionState,
  accepted: AcceptedReview | undefined,
): ReviewPhaseView[] {
  const calls = allToolCalls(state);
  const inspectionCalls = calls.filter(
    (toolCall) => toolCall.name === "inspect_git_changes",
  );
  const inspectionComplete = inspectionCalls.some(
    (toolCall) => toolCall.status === "completed",
  );
  const inspectionStarted =
    inspectionCalls.length > 0 ||
    state.inferenceAttempts.some(
      (attempt) =>
        attempt.phase === "investigation" &&
        attempt.allowedToolNames?.includes("inspect_git_changes"),
    );
  const checkpointDecision = state.routingDecisions.find(
    (decision) => decision.boundary === "evidence_complete",
  );
  const synthesisAttempts = state.inferenceAttempts.filter(
    (attempt) =>
      attempt.phase === "synthesis" &&
      attempt.structuredOutputContract === "change-review-result-v1",
  );
  const synthesisStarted = synthesisAttempts.length > 0;
  const synthesisFailed = synthesisAttempts.some(
    (attempt) => attempt.finished !== undefined && attempt.finished.outcome !== "succeeded",
  );
  const fallbackDecision = state.routingDecisions.find(
    (decision) =>
      decision.boundary === "provider_failure" ||
      decision.reasonCode === "local_fallback",
  );
  const fallbackAttempts = fallbackDecision
    ? state.inferenceAttempts.filter(
        (attempt) => attempt.decisionId === fallbackDecision.decisionId,
      )
    : [];
  const acceptedByFallback =
    fallbackDecision !== undefined &&
    accepted?.attempt.decisionId === fallbackDecision.decisionId;
  const simulation = state.hybridSimulation !== undefined;
  const terminal = terminalPhaseStatus(state);

  let inspectionStatus: PhaseStatus = "pending";
  if (inspectionComplete) inspectionStatus = "complete";
  else if (terminal !== undefined) inspectionStatus = terminal;
  else if (inspectionStarted || state.status === "running") inspectionStatus = "active";

  let checkpointStatus: PhaseStatus = "pending";
  if (checkpointDecision !== undefined) checkpointStatus = "complete";
  else if (terminal !== undefined && inspectionComplete) checkpointStatus = terminal;
  else if (inspectionComplete && state.status === "running") checkpointStatus = "active";

  let synthesisStatus: PhaseStatus = "pending";
  if (acceptedByFallback) synthesisStatus = "failed";
  else if (accepted !== undefined) synthesisStatus = "complete";
  else if (terminal !== undefined && (checkpointDecision !== undefined || synthesisStarted)) {
    synthesisStatus = terminal;
  } else if (synthesisFailed) synthesisStatus = "failed";
  else if (synthesisStarted) synthesisStatus = "active";

  let fallbackStatus: PhaseStatus = "pending";
  if (fallbackDecision !== undefined) {
    if (acceptedByFallback) fallbackStatus = "complete";
    else if (terminal !== undefined) fallbackStatus = terminal;
    else if (fallbackAttempts.length > 0) fallbackStatus = "active";
  }

  const phases = [
    phase("inspection", inspectionStatus),
    phase("checkpoint", checkpointStatus),
    phase("synthesis", synthesisStatus),
    phase("fallback", fallbackStatus),
  ];
  if (!simulation) return phases;
  const routes = simulationRoutes(state) ?? [];
  return phases.map((entry) => {
    const phaseRoutes = routes.filter(
      (candidate) => candidate.phaseId === entry.id,
    );
    const acceptedProviderLabel =
      accepted?.attempt.providerId ===
      state.hybridSimulation?.fakeCloudProvider.providerId
        ? "Fake Cloud"
        : accepted?.attempt.providerId ===
            state.hybridSimulation?.fakeLocalProvider.providerId
          ? "Fake Local"
          : undefined;
    const route =
      entry.id === "synthesis" && acceptedByFallback
        ? [...phaseRoutes]
            .reverse()
            .find((candidate) => candidate.locality === "cloud")
        : entry.id === "synthesis" && acceptedProviderLabel !== undefined
        ? [...phaseRoutes]
            .reverse()
            .find(
              (candidate) =>
                candidate.providerLabel === acceptedProviderLabel &&
                candidate.model === accepted?.attempt.requestedModel,
            )
        : phaseRoutes.at(-1);
    return {
      ...entry,
      label:
        entry.id === "checkpoint"
          ? "Routing check"
          : entry.id === "synthesis"
            ? route?.locality === "local"
              ? "Local synthesis"
              : "Fake cloud synthesis"
            : entry.id === "fallback"
              ? "Optional Local fallback"
              : "Local inspection",
      ...(route === undefined
        ? {}
        : {
            providerLabel: route.providerLabel,
            model: route.model,
            reason: route.reason,
            ...(route.latencyMs === undefined
              ? {}
              : { latencyMs: route.latencyMs }),
            ...(route.simulatedReservedMicrousd === undefined
              ? {}
              : {
                  simulatedReservedMicrousd:
                    route.simulatedReservedMicrousd,
                }),
            ...(route.simulatedSettledMicrousd === undefined
              ? {}
              : {
                  simulatedSettledMicrousd:
                    route.simulatedSettledMicrousd,
                }),
            ...(route.simulatedSettlementProvenance === undefined
              ? {}
              : {
                  simulatedSettlementProvenance:
                    route.simulatedSettlementProvenance,
                }),
            actualExternalSpendMicrousd: 0 as const,
          }),
    };
  });
}

function simulationRoutes(state: SessionState): ChangeReviewView["routes"] {
  const authority = state.hybridSimulation;
  if (authority === undefined) return undefined;
  const attempts = state.inferenceAttempts.map<ReviewRoutePhaseView>((attempt) => {
    const cloud = attempt.providerId === authority.fakeCloudProvider.providerId;
    const local = attempt.providerId === authority.fakeLocalProvider.providerId;
    const decision = state.routingDecisions.find(
      (candidate) => candidate.decisionId === attempt.decisionId,
    );
    if (!cloud && !local) {
      throw new Error("Hybrid simulation attempt has no Fake provider attribution.");
    }
    const expectedModel = cloud
      ? authority.fakeCloudProvider.model
      : authority.fakeLocalProvider.model;
    if (attempt.requestedModel !== expectedModel) {
      throw new Error("Hybrid simulation attempt model attribution is inconsistent.");
    }
    const fallback =
      attempt.phase === "synthesis" &&
      local &&
      (decision?.boundary === "provider_failure" ||
        decision?.reasonCode === "local_fallback");
    const finished = attempt.finished;
    return {
      phaseId:
        attempt.phase === "investigation"
          ? "inspection"
          : fallback
            ? "fallback"
            : "synthesis",
      providerLabel: cloud ? "Fake Cloud" : "Fake Local",
      model: attempt.requestedModel,
      locality: cloud ? "cloud" : "local",
      status:
        finished === undefined
          ? "active"
          : finished.outcome === "succeeded"
            ? "complete"
            : finished.outcome === "cancelled"
              ? "cancelled"
              : "failed",
      reason:
        finished !== undefined && finished.outcome !== "succeeded"
          ? (finished.errorCode ?? "simulation_attempt_failed")
          : (decision?.reasonCode ?? "simulation_attempt"),
      ...(finished === undefined ? {} : { latencyMs: finished.latencyMs }),
      ...(attempt.costScope === "simulation" && decision?.billing !== undefined
        ? {
            simulatedReservedMicrousd:
              decision.billing.projectedCostMicrousd,
          }
        : {}),
      ...(finished?.cost.costScope === "simulation"
        ? {
            simulatedSettledMicrousd: finished.cost.amountMicrousd,
            simulatedSettlementProvenance:
              finished.cost.provenance === "provider_reported" ||
              finished.cost.provenance === "host_pricing_snapshot" ||
              finished.cost.provenance === "reserved_unknown"
                ? finished.cost.provenance
                : "not_settled",
          }
        : {}),
      actualExternalSpendMicrousd: 0,
    };
  });
  const checkpointDecision = state.routingDecisions.find(
    (decision) => decision.boundary === "evidence_complete",
  );
  const admission = checkpointDecision?.cloudEgressAdmissionId
    ? state.cloudEgressAdmissions.find(
        (record) =>
          record.admissionId === checkpointDecision.cloudEgressAdmissionId,
      )
    : undefined;
  const checkpointRoutes: NonNullable<ChangeReviewView["routes"]> =
    checkpointDecision === undefined
      ? []
      : [
          {
            phaseId: "checkpoint",
            providerLabel:
              admission !== undefined ||
              checkpointDecision.selectedProviderId ===
                authority.fakeCloudProvider.providerId
                ? "Fake Cloud candidate"
                : "Fake Local",
            model:
              admission !== undefined ||
              checkpointDecision.selectedProviderId ===
                authority.fakeCloudProvider.providerId
                ? authority.fakeCloudProvider.model
                : authority.fakeLocalProvider.model,
            locality:
              admission !== undefined ||
              checkpointDecision.selectedProviderId ===
                authority.fakeCloudProvider.providerId
                ? "cloud"
                : "local",
            status:
              admission?.decision === "deny" ? "failed" : "complete",
            reason:
              admission?.decision === "deny"
                ? admission.reasonCodes.join(", ")
                : checkpointDecision.reasonCode,
            simulatedReservedMicrousd: 0,
            simulatedSettledMicrousd: 0,
            simulatedSettlementProvenance: "not_settled",
            actualExternalSpendMicrousd: 0,
          },
        ];
  const cloudAttemptExists = attempts.some(
    (route) =>
      route.phaseId === "synthesis" && route.locality === "cloud",
  );
  const deniedCloudRoutes: NonNullable<ChangeReviewView["routes"]> =
    admission?.decision === "deny" && !cloudAttemptExists
      ? [
          {
            phaseId: "synthesis",
            providerLabel: "Fake Cloud",
            model: authority.fakeCloudProvider.model,
            locality: "cloud",
            status: "failed",
            reason: admission.reasonCodes.join(", "),
            simulatedReservedMicrousd: 0,
            simulatedSettledMicrousd: 0,
            simulatedSettlementProvenance: "not_settled",
            actualExternalSpendMicrousd: 0,
          },
        ]
      : [];
  const phaseOrder: Record<ReviewPhaseView["id"], number> = {
    inspection: 0,
    checkpoint: 1,
    synthesis: 2,
    fallback: 3,
  };
  return [...attempts, ...checkpointRoutes, ...deniedCloudRoutes].sort(
    (left, right) => {
      const phaseDifference =
        phaseOrder[left.phaseId] - phaseOrder[right.phaseId];
      if (phaseDifference !== 0) return phaseDifference;
      if (
        left.phaseId === "synthesis" &&
        left.locality !== right.locality
      ) {
        return left.locality === "cloud" ? -1 : 1;
      }
      return 0;
    },
  );
}

function simulationProjection(
  state: SessionState,
): ChangeReviewView["simulation"] | undefined {
  const authority = state.hybridSimulation;
  const finish = [...state.inferenceAttempts]
    .reverse()
    .map((attempt) => attempt.finished)
    .find(
      (candidate) =>
        candidate?.cost.costScope === "simulation" &&
        candidate.cost.amountMicrousd > 0,
    );
  const settlementProvenance =
    finish?.cost.provenance === "provider_reported" ||
    finish?.cost.provenance === "host_pricing_snapshot" ||
    finish?.cost.provenance === "reserved_unknown"
      ? finish.cost.provenance
      : "not_settled";
  const reserved = state.costScopes.simulation.reservedMicrousd;
  const settled = state.costScopes.simulation.settledMicrousd;
  const failedRecordedOverrun =
    settled > HYBRID_SIMULATION_MAX_SPEND_MICROUSD &&
    state.status === "failed" &&
    (settlementProvenance === "provider_reported" ||
      settlementProvenance === "host_pricing_snapshot");
  if (
    authority === undefined ||
    authority.resultMarker !== HYBRID_SIMULATION_RESULT_MARKER ||
    state.executionPolicy?.schemaVersion !== "agentic-execution-v2" ||
    state.executionPolicy.routingPolicy !== "hybrid_simulation_v1" ||
    authority.maxSimulatedSpendMicrousd !==
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD ||
    !Number.isSafeInteger(reserved) ||
    reserved < 0 ||
    reserved > HYBRID_SIMULATION_MAX_SPEND_MICROUSD ||
    !Number.isSafeInteger(settled) ||
    settled < 0 ||
    (settled > HYBRID_SIMULATION_MAX_SPEND_MICROUSD &&
      !failedRecordedOverrun) ||
    state.costScopes.actual.reservedMicrousd !== 0 ||
    state.costScopes.actual.settledMicrousd !== 0 ||
    state.costScopes.legacyUnclassified.present
  ) {
    return undefined;
  }
  return {
    marker: HYBRID_SIMULATION_RESULT_MARKER,
    costScope: "simulation",
    maxSimulatedSpendMicrousd: authority.maxSimulatedSpendMicrousd,
    reservedMicrousd: reserved,
    settledMicrousd: settled,
    settlementProvenance,
    actualExternalSpendMicrousd: 0,
  };
}

function pendingNote(state: SessionState): string | undefined {
  if (state.status === "completed") {
    return "The completed session did not replay to a host-accepted structured result. Findings are withheld.";
  }
  if (state.status === "failed") {
    return "The local review did not produce a host-accepted structured result.";
  }
  if (state.status === "cancelled") {
    return "The local review was cancelled before a host-accepted result was available.";
  }
  if (state.status === "interrupted") {
    return "The local review was interrupted before a host-accepted result was available.";
  }
  return undefined;
}

function acceptanceNote(
  freshness: Exclude<ReviewFreshness, "pending" | "not_available">,
  accepted: AcceptedReview,
): string {
  if (freshness === "drifted") {
    return "The workspace changed after this review. Findings are withheld until a new review completes.";
  }
  if (freshness === "unavailable") {
    return "SOAR could not revalidate the reviewed snapshot. Findings are withheld.";
  }
  if (freshness === "identity_same_unverifiable") {
    return "The snapshot identity still matches, but host coverage or the accepted result is incomplete. The review is shown with its omissions; copying is disabled.";
  }
  if (accepted.coverage.counts.changedPaths === 0) {
    return "The host-verified change snapshot is empty.";
  }
  if (accepted.result.conclusion === "no_blocking_findings") {
    return "No blocking findings were found in the inspected, host-verified evidence.";
  }
  return "Accepted against the current change snapshot and host-verified evidence.";
}

function coverageView(
  coverage: AcceptedReview["coverage"],
): ReviewCoverageView {
  return {
    schemaVersion: "review-coverage-view-v1",
    status: coverage.status,
    counts: { ...coverage.counts },
    changedTestCount: coverage.changedTestPaths.length,
    runtimeCodeChangedWithoutChangedTest:
      coverage.runtimeCodeChangedWithoutChangedTest,
    snapshotRevalidated: coverage.snapshotRevalidated,
    omissionCodes: [...coverage.omissionCodes],
  };
}

/**
 * Project a renderer-safe review view from canonical event history.
 *
 * Raw provider output, rejected structured data, workspace paths, and provider
 * endpoints are deliberately absent. A workspace read occurs only after replay
 * proves that a structured review was host-accepted on a successful attempt.
 */
export async function toChangeReviewView(
  store: EventStore,
  sessionId: string,
): Promise<ChangeReviewView> {
  const state = store.replay(sessionId);
  if (state.taskTrack !== "change-review-v1") {
    throw new TypeError("Change-review views require a change-review-v1 session.");
  }

  const accepted = acceptedReview(store, state);
  const decision = synthesisDecision(state, accepted);
  const routes = simulationRoutes(state);
  const simulation = simulationProjection(state);
  if (state.hybridSimulation !== undefined && simulation === undefined) {
    throw new Error(
      "Hybrid simulation attribution validation failed; the review result is withheld.",
    );
  }
  const base = {
    sessionId: state.id,
    status: state.status,
    phases: phaseTimeline(state, accepted),
    ...(state.hybridSimulation === undefined
      ? {}
      : { executionMode: "hybrid_simulation" as const }),
    ...(routes === undefined ? {} : { routes }),
    ...(simulation === undefined ? {} : { simulation }),
    ...(routeView(state, decision) === undefined
      ? {}
      : { route: routeView(state, decision) }),
  };

  if (accepted === undefined) {
    const note = pendingNote(state);
    return {
      ...base,
      freshness:
        state.status === "created" || state.status === "running"
          ? "pending"
          : "not_available",
      ...(note === undefined ? {} : { acceptanceNote: note }),
    };
  }

  let freshness: Exclude<ReviewFreshness, "pending">;
  try {
    const current = await inspectGitChanges({
      workspaceRoot: state.workspaceRoot,
      request: { schemaVersion: "inspect-git-changes-v1" },
    });
    if (current.snapshot.snapshotId !== accepted.result.snapshotId) {
      freshness = "drifted";
    } else if (
      accepted.coverage.snapshotRevalidated &&
      accepted.coverage.status === "complete" &&
      accepted.result.conclusion !== "incomplete"
    ) {
      freshness = "fresh_complete";
    } else {
      freshness = "identity_same_unverifiable";
    }
  } catch {
    freshness = "unavailable";
  }

  if (freshness === "drifted" || freshness === "unavailable") {
    return {
      ...base,
      freshness,
      acceptanceNote: acceptanceNote(freshness, accepted),
    };
  }

  return {
    ...base,
    freshness,
    reviewResult: accepted.result,
    coverage: coverageView(accepted.coverage),
    baseRevision: accepted.snapshot.baseCommitOid.slice(0, 12),
    acceptanceNote: acceptanceNote(freshness, accepted),
  };
}
