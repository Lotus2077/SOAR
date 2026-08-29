import type {
  ChangeReviewView,
  ReviewCoverageView,
  ReviewFreshness,
  ReviewPhaseView,
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
  if (accepted !== undefined) synthesisStatus = "complete";
  else if (terminal !== undefined && (checkpointDecision !== undefined || synthesisStarted)) {
    synthesisStatus = terminal;
  } else if (synthesisFailed) synthesisStatus = "failed";
  else if (synthesisStarted) synthesisStatus = "active";

  let fallbackStatus: PhaseStatus = "pending";
  if (fallbackDecision !== undefined) {
    const acceptedByFallback =
      accepted?.attempt.decisionId === fallbackDecision.decisionId;
    if (acceptedByFallback) fallbackStatus = "complete";
    else if (terminal !== undefined) fallbackStatus = terminal;
    else if (fallbackAttempts.length > 0) fallbackStatus = "active";
  }

  return [
    phase("inspection", inspectionStatus),
    phase("checkpoint", checkpointStatus),
    phase("synthesis", synthesisStatus),
    phase("fallback", fallbackStatus),
  ];
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
  const base = {
    sessionId: state.id,
    status: state.status,
    phases: phaseTimeline(state, accepted),
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
