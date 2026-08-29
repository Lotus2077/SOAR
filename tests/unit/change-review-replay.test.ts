import { describe, expect, it } from "vitest";

import { deriveReviewCoverageV1 } from "../../src/main/change-acquisition-contracts";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  type ReviewResultV1,
} from "../../src/shared/review-result-contract";
import {
  parseStoredSessionEvent,
  type SessionEventData,
  type StoredSessionEvent,
} from "../../src/shared/session-events";
import { replaySession } from "../../src/shared/session-reducer";
import {
  REVIEW_FIXTURE_MODEL,
  REVIEW_FIXTURE_PROVIDER_ID,
  REVIEW_FIXTURE_SESSION_ID,
  REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
  completedReviewFixtureEvents,
  reviewFixtureEvents,
  reviewFixtureSnapshot,
} from "../helpers/review-event-fixture";

const REVIEW_DECISION_ID = "review-decision-2";
const REVIEW_LEASE_ID = "review-lease-1";
const REVIEW_MESSAGE_ID = "review-synthesis";
const REVIEW_ATTEMPT_ID = "review-attempt-4";
const REVIEW_CHECKPOINT_ID = `${REVIEW_FIXTURE_SESSION_ID}:context:4`;
const VERIFIED_REVIEW_EVIDENCE = deriveVerifiedReviewEvidenceV1(
  reviewFixtureEvents(),
);
const EVIDENCE_SET_ID = VERIFIED_REVIEW_EVIDENCE.evidenceSet.evidenceSetId;
const PROVENANCE_SHA256 =
  VERIFIED_REVIEW_EVIDENCE.provenance.provenanceSha256;

function timestamp(sequence: number): string {
  return new Date(Date.UTC(2026, 7, 30, 0, 0, sequence)).toISOString();
}

function stored(
  sequence: number,
  event: SessionEventData,
): StoredSessionEvent {
  return parseStoredSessionEvent({
    id: `${REVIEW_FIXTURE_SESSION_ID}:event:${sequence}`,
    sessionId: REVIEW_FIXTURE_SESSION_ID,
    sequence,
    createdAt: timestamp(sequence),
    ...event,
  });
}

function localAdmission() {
  const notApplicable = {
    status: "not_applicable" as const,
    reasonCode: "not_applicable" as const,
  };
  return {
    capability: {
      status: "passed" as const,
      reasonCode: "capability_ok" as const,
    },
    credential: notApplicable,
    health: notApplicable,
    pricing: notApplicable,
    egress: notApplicable,
    deadline: {
      status: "passed" as const,
      reasonCode: "deadline_ok" as const,
    },
    budget: notApplicable,
  };
}

function reviewResult(summary = "No blocking finding was found."): ReviewResultV1 {
  return {
    schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    snapshotId: reviewFixtureSnapshot().snapshotId,
    summary,
    conclusion: "no_blocking_findings",
    evidenceSetId: EVIDENCE_SET_ID,
    omissions: [],
    findings: [],
  };
}

function reviewCoverage() {
  return deriveReviewCoverageV1({
    snapshot: VERIFIED_REVIEW_EVIDENCE.snapshot,
    evidenceSet: VERIFIED_REVIEW_EVIDENCE.evidenceSet,
    packetRetainedEvidenceSet: true,
    snapshotRevalidated: true,
  });
}

function reviewSynthesisStart(): StoredSessionEvent[] {
  return [
    stored(26, {
      type: "routing.decision.recorded",
      payload: {
        decisionId: REVIEW_DECISION_ID,
        policyVersion: "hybrid-lease-router-v0",
        boundary: "evidence_complete",
        phase: "synthesis",
        action: "retain_lease",
        reasonCode: "low_risk_local_review",
        candidateProviderIds: [REVIEW_FIXTURE_PROVIDER_ID],
        selectedProviderId: REVIEW_FIXTURE_PROVIDER_ID,
        selectedModel: REVIEW_FIXTURE_MODEL,
        priorLeaseId: REVIEW_LEASE_ID,
        selectedLeaseId: REVIEW_LEASE_ID,
        riskPolicyId: "review-risk-v1",
        riskScore: 0,
        riskSignals: [],
        triggerFacts: [],
        admission: localAdmission(),
      },
    }),
    stored(27, {
      type: "assistant.message.started",
      payload: {
        messageId: REVIEW_MESSAGE_ID,
        providerId: REVIEW_FIXTURE_PROVIDER_ID,
        model: REVIEW_FIXTURE_MODEL,
        decisionId: REVIEW_DECISION_ID,
        leaseId: REVIEW_LEASE_ID,
        checkpointId: REVIEW_CHECKPOINT_ID,
        attemptId: REVIEW_ATTEMPT_ID,
      },
    }),
    stored(28, {
      type: "context.compiled",
      payload: {
        checkpointId: REVIEW_CHECKPOINT_ID,
        compilerVersion: "review-context-compiler-v1",
        reason: "finalization_boundary",
        mode: "finalization",
        providerId: REVIEW_FIXTURE_PROVIDER_ID,
        model: REVIEW_FIXTURE_MODEL,
        maxTokens: 100_000,
        estimatedTokens: 1_000,
        estimator: "utf8-bytes-v1",
        reservedInputTokens: 100,
        effectiveInputTokenBudget: 89_900,
        sourceMessageCount: 4,
        messageCount: 2,
        evidenceCount: 3,
        deduplicatedEvidenceCount: 0,
        omittedEvidenceCount: 0,
        packetSha256: "d".repeat(64),
        messagesSha256: "e".repeat(64),
        safetyMargin: 0.1,
        decisionId: REVIEW_DECISION_ID,
        leaseId: REVIEW_LEASE_ID,
        messageId: REVIEW_MESSAGE_ID,
        attemptId: REVIEW_ATTEMPT_ID,
        reviewSnapshotId: reviewFixtureSnapshot().snapshotId,
        reviewEvidenceSetId: EVIDENCE_SET_ID,
        reviewProvenanceSha256: PROVENANCE_SHA256,
        structuredOutputContract:
          REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
        structuredOutputSchemaSha256:
          REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
      },
    }),
    stored(29, {
      type: "inference.attempt.started",
      payload: {
        attemptId: REVIEW_ATTEMPT_ID,
        round: 4,
        checkpointId: REVIEW_CHECKPOINT_ID,
        messageId: REVIEW_MESSAGE_ID,
        decisionId: REVIEW_DECISION_ID,
        leaseId: REVIEW_LEASE_ID,
        providerId: REVIEW_FIXTURE_PROVIDER_ID,
        requestedModel: REVIEW_FIXTURE_MODEL,
        phase: "synthesis",
        requestedMaxOutputTokens: 2_048,
        allowTools: false,
        requireToolCall: false,
        structuredOutputContract:
          REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
        structuredOutputSchemaSha256:
          REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
      },
    }),
  ];
}

function acceptedReviewEvents(
  result = reviewResult(),
): StoredSessionEvent[] {
  const coverage = reviewCoverage();
  return [
    stored(30, {
      type: "assistant.message.completed",
      payload: {
        messageId: REVIEW_MESSAGE_ID,
        content: JSON.stringify(result),
        stopReason: "stop",
        completionState: "complete",
        reviewParseStatus: "accepted",
        reviewResult: result,
        reviewCoverage: coverage,
        attemptId: REVIEW_ATTEMPT_ID,
      },
    }),
    stored(31, {
      type: "inference.attempt.finished",
      payload: {
        attemptId: REVIEW_ATTEMPT_ID,
        checkpointId: REVIEW_CHECKPOINT_ID,
        outcome: "succeeded",
        requestDisposition: "sent",
        finishReason: "stop",
        servedModel: REVIEW_FIXTURE_MODEL,
        usage: {
          inputTokens: 1_000,
          outputTokens: 100,
          reasoningTokens: 0,
          reported: true,
        },
        cost: {
          amountMicrousd: 0,
          provenance: "local_zero_cost_policy",
        },
        latencyMs: 50,
        ttftMs: 10,
      },
    }),
    stored(32, {
      type: "completion.obligations.checked",
      payload: {
        checkId: `${REVIEW_FIXTURE_SESSION_ID}:completion:4`,
        messageId: REVIEW_MESSAGE_ID,
        round: 4,
        remainingRounds: 0,
        successfulRequiredTools: ["inspect_git_changes"],
        missingRequiredTools: [],
        verifiedPathLineCitations: [],
        unresolvedCitationCount: 0,
        outcome: "accepted",
      },
    }),
    stored(33, {
      type: "session.completed",
      payload: { result: JSON.stringify(result) },
    }),
  ];
}

function completeReviewStream(
  result = reviewResult(),
): StoredSessionEvent[] {
  return [
    ...reviewFixtureEvents(),
    ...reviewSynthesisStart(),
    ...acceptedReviewEvents(result),
  ];
}

function genericSessionThroughAssistant(): StoredSessionEvent[] {
  const checkpointId = `${REVIEW_FIXTURE_SESSION_ID}:context:1`;
  const policy = {
    schemaVersion: "agentic-execution-v2" as const,
    inferenceRounds: 2,
    toolCalls: 1,
    routingPolicy: "local_only_v1" as const,
    maxProviderChanges: 2,
    maxPaidAttempts: 1,
    maxPaidEpisodeMicrousd: 250_000,
    maxEpisodeDurationMs: 120_000,
    attemptTimeoutMs: 30_000,
    egressConsent: "none" as const,
  } as const;
  return [
    stored(1, {
      type: "session.created",
      payload: {
        title: "Repository task",
        objective: "Inspect the repository.",
        workspaceRoot: "/tmp/repository-workspace",
        profile: "balanced",
        taskTrack: "repository-investigator-v1",
        completionObligations: {
          requiredSuccessfulTools: ["read_text_file"],
          minimumVerifiedPathLineCitations: 1,
        },
        executionPolicy: policy,
      },
    }),
    stored(2, {
      type: "session.started",
      payload: {
        startedAt: timestamp(2),
        deadlineAt: new Date(Date.parse(timestamp(2)) + 120_000).toISOString(),
      },
    }),
    stored(3, {
      type: "routing.decision.recorded",
      payload: {
        decisionId: "generic-decision",
        policyVersion: "hybrid-lease-router-v0",
        boundary: "session_start",
        phase: "investigation",
        action: "assign_new_lease",
        reasonCode: "local_investigation",
        candidateProviderIds: [REVIEW_FIXTURE_PROVIDER_ID],
        selectedProviderId: REVIEW_FIXTURE_PROVIDER_ID,
        selectedModel: REVIEW_FIXTURE_MODEL,
        selectedLeaseId: "generic-lease",
        riskSignals: [],
        triggerFacts: [],
        admission: localAdmission(),
      },
    }),
    stored(4, {
      type: "route.assigned",
      payload: {
        providerId: REVIEW_FIXTURE_PROVIDER_ID,
        model: REVIEW_FIXTURE_MODEL,
        reason: "local investigation",
        leaseId: "generic-lease",
        decisionId: "generic-decision",
        phase: "investigation",
      },
    }),
    stored(5, {
      type: "assistant.message.started",
      payload: {
        messageId: "generic-assistant",
        providerId: REVIEW_FIXTURE_PROVIDER_ID,
        model: REVIEW_FIXTURE_MODEL,
        decisionId: "generic-decision",
        leaseId: "generic-lease",
        checkpointId,
        attemptId: "generic-attempt",
      },
    }),
  ];
}

describe("change-review-v1 event replay", () => {
  it("rejects a forged matching structured schema hash at the stored-event boundary", () => {
    const [contextEvent, attemptEvent] = reviewSynthesisStart().slice(-2);
    if (
      contextEvent?.type !== "context.compiled" ||
      attemptEvent?.type !== "inference.attempt.started"
    ) {
      throw new Error("Expected review context and attempt fixtures.");
    }
    const forgedHash = "0".repeat(64);
    const forgedContext = {
      ...contextEvent,
      payload: {
        ...contextEvent.payload,
        structuredOutputSchemaSha256: forgedHash,
      },
    };
    const forgedAttempt = {
      ...attemptEvent,
      payload: {
        ...attemptEvent.payload,
        structuredOutputSchemaSha256: forgedHash,
      },
    };

    expect(() => parseStoredSessionEvent(forgedContext)).toThrow();
    expect(() => parseStoredSessionEvent(forgedAttempt)).toThrow();
  });

  it("rejects review compilation and structured attempts outside change-review-v1", () => {
    const generic = genericSessionThroughAssistant();
    const checkpointId = `${REVIEW_FIXTURE_SESSION_ID}:context:1`;
    const reviewContext = reviewSynthesisStart().at(-2);
    const structuredAttempt = reviewSynthesisStart().at(-1);
    if (
      reviewContext?.type !== "context.compiled" ||
      structuredAttempt?.type !== "inference.attempt.started"
    ) {
      throw new Error("Expected review context and attempt fixtures.");
    }

    const genericReviewContext = stored(6, {
      type: "context.compiled",
      payload: {
        ...reviewContext.payload,
        checkpointId,
        reason: "session_start",
        decisionId: "generic-decision",
        leaseId: "generic-lease",
        messageId: "generic-assistant",
        attemptId: "generic-attempt",
      },
    });
    expect(() => replaySession([...generic, genericReviewContext])).toThrow(
      /review-context-compiler-v1 is restricted to change-review-v1/u,
    );

    const {
      reviewSnapshotId: _reviewSnapshotId,
      reviewEvidenceSetId: _reviewEvidenceSetId,
      reviewProvenanceSha256: _reviewProvenanceSha256,
      structuredOutputContract: _structuredOutputContract,
      structuredOutputSchemaSha256: _structuredOutputSchemaSha256,
      ...genericContextPayload
    } = reviewContext.payload;
    const genericContext = stored(6, {
      type: "context.compiled",
      payload: {
        ...genericContextPayload,
        checkpointId,
        compilerVersion: "context-compiler-v1",
        reason: "session_start",
        decisionId: "generic-decision",
        leaseId: "generic-lease",
        messageId: "generic-assistant",
        attemptId: "generic-attempt",
      },
    });
    const genericStructuredAttempt = stored(7, {
      type: "inference.attempt.started",
      payload: {
        ...structuredAttempt.payload,
        attemptId: "generic-attempt",
        checkpointId,
        messageId: "generic-assistant",
        decisionId: "generic-decision",
        leaseId: "generic-lease",
      },
    });
    expect(() =>
      replaySession([...generic, genericContext, genericStructuredAttempt]),
    ).toThrow(
      /change-review-result-v1 attempts are restricted to change-review-v1/u,
    );
  });

  it("requires accepted result and coverage identities to match the immutable review packet", () => {
    const accepted = acceptedReviewEvents()[0];
    if (accepted?.type !== "assistant.message.completed") {
      throw new Error("Expected an accepted review completion fixture.");
    }
    const { reviewCoverage: _coverage, ...withoutCoverage } = accepted.payload;
    expect(() =>
      parseStoredSessionEvent({
        ...accepted,
        payload: withoutCoverage,
      }),
    ).toThrow(/accepted review completion requires both/u);

    const mismatchedResult = structuredClone(completeReviewStream());
    const resultCompletion = mismatchedResult.find(
      (event) => event.type === "assistant.message.completed" &&
        event.payload.messageId === REVIEW_MESSAGE_ID,
    );
    if (
      resultCompletion?.type !== "assistant.message.completed" ||
      resultCompletion.payload.reviewResult === undefined
    ) {
      throw new Error("Expected a structured result fixture.");
    }
    resultCompletion.payload.reviewResult.snapshotId = "1".repeat(64);
    expect(() => replaySession(mismatchedResult)).toThrow(
      /does not match its immutable packet identities/u,
    );

    const mismatchedCoverage = structuredClone(completeReviewStream());
    const coverageCompletion = mismatchedCoverage.find(
      (event) => event.type === "assistant.message.completed" &&
        event.payload.messageId === REVIEW_MESSAGE_ID,
    );
    if (
      coverageCompletion?.type !== "assistant.message.completed" ||
      coverageCompletion.payload.reviewCoverage === undefined
    ) {
      throw new Error("Expected a structured coverage fixture.");
    }
    coverageCompletion.payload.reviewCoverage.evidenceSetId = "2".repeat(64);
    expect(() => replaySession(mismatchedCoverage)).toThrow(
      /does not match its immutable packet identities/u,
    );
  });

  it("closes a not_received structured attempt as a failed session", () => {
    const events = [
      ...reviewFixtureEvents(),
      ...reviewSynthesisStart(),
      stored(30, {
        type: "assistant.message.completed",
        payload: {
          messageId: REVIEW_MESSAGE_ID,
          stopReason: "error",
          completionState: "incomplete",
          reviewParseStatus: "not_received",
          attemptId: REVIEW_ATTEMPT_ID,
        },
      }),
      stored(31, {
        type: "inference.attempt.finished",
        payload: {
          attemptId: REVIEW_ATTEMPT_ID,
          checkpointId: REVIEW_CHECKPOINT_ID,
          outcome: "provider_error",
          requestDisposition: "sent",
          errorCode: "provider_failed",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            reported: false,
          },
          cost: {
            amountMicrousd: 0,
            provenance: "local_zero_cost_policy",
          },
          latencyMs: 50,
        },
      }),
      stored(32, {
        type: "session.failed",
        payload: { error: "The local provider returned no review output." },
      }),
    ];

    const state = replaySession(events);
    expect(state.status).toBe("failed");
    expect(state.inferenceAttempts).toHaveLength(4);
    expect(state.inferenceAttempts.at(-1)).toMatchObject({
      finished: { outcome: "provider_error" },
    });
    expect(state.messages.at(-1)).toMatchObject({
      reviewParseStatus: "not_received",
      completionState: "incomplete",
    });
  });

  it("does not interpret path:line text in an accepted structured summary as a legacy citation", () => {
    const result = reviewResult(
      "No blocking finding was found at src/router.ts:1 in the admitted review evidence.",
    );
    const state = replaySession(completeReviewStream(result));

    expect(state.status).toBe("completed");
    expect(state.completionChecks).toEqual([
      expect.objectContaining({
        verifiedPathLineCitations: [],
        unresolvedCitationCount: 0,
        outcome: "accepted",
      }),
    ]);
    expect(state.messages.at(-1)).toMatchObject({
      reviewParseStatus: "accepted",
      reviewResult: { summary: result.summary },
      reviewCoverage: {
        snapshotId: result.snapshotId,
        evidenceSetId: result.evidenceSetId,
      },
    });
  });

  it("preserves raw and attached accepted records separately for projection-time revalidation", () => {
    const baseline = completedReviewFixtureEvents();
    const completion = baseline.find(
      (event) =>
        event.type === "assistant.message.completed" &&
        event.payload.messageId === REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
    );
    if (
      completion?.type !== "assistant.message.completed" ||
      completion.payload.reviewResult === undefined
    ) {
      throw new Error("Expected an accepted review fixture.");
    }
    const differentRawResult = {
      ...completion.payload.reviewResult,
      summary: "A different shape-valid raw result.",
    };
    const state = replaySession(
      completedReviewFixtureEvents({
        rawContent: JSON.stringify(differentRawResult),
      }),
    );

    expect(state.status).toBe("completed");
    expect(state.messages.at(-1)).toMatchObject({
      reviewParseStatus: "accepted",
      reviewResult: { summary: completion.payload.reviewResult.summary },
      content: JSON.stringify(differentRawResult),
    });
    expect(state.result).toBe(JSON.stringify(differentRawResult));
  });
});
