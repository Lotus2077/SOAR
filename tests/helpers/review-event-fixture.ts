import { createHash } from "node:crypto";

import {
  buildChangeHunkV1,
  buildChangeSnapshotV1,
  buildInspectGitChangesResultV1,
  deriveReviewCoverageV1,
} from "../../src/main/change-acquisition-contracts";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import type {
  ChangeSnapshotV1,
  ReviewCoverageV1,
} from "../../src/shared/change-review-contracts";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  type ReviewResultV1,
} from "../../src/shared/review-result-contract";
import {
  parseStoredSessionEvent,
  type JsonValue,
  type SessionEventData,
  type StoredSessionEvent,
} from "../../src/shared/session-events";

export const REVIEW_FIXTURE_SESSION_ID = "review-session";
export const REVIEW_FIXTURE_PROVIDER_ID = "local-vllm";
export const REVIEW_FIXTURE_MODEL = "local-review-model";
export const REVIEW_FIXTURE_NEW_TEXT = "export const value = 2;\n";
export const REVIEW_FIXTURE_ADDED_TEXT = "export const added = true;\n";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function reviewFixtureSnapshot(): ChangeSnapshotV1 {
  const addedHunk = buildChangeHunkV1({
    schemaVersion: "change-hunk-v1",
    oldPath: null,
    newPath: "src/added.ts",
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    lines: [
      {
        kind: "addition",
        content: "export const added = true;",
        terminator: "lf",
        oldLine: null,
        newLine: 1,
      },
    ],
  });
  const routerHunk = buildChangeHunkV1({
    schemaVersion: "change-hunk-v1",
    oldPath: "src/router.ts",
    newPath: "src/router.ts",
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [
      {
        kind: "deletion",
        content: "export const value = 1;",
        terminator: "lf",
        oldLine: 1,
        newLine: null,
      },
      {
        kind: "addition",
        content: "export const value = 2;",
        terminator: "lf",
        oldLine: null,
        newLine: 1,
      },
    ],
  });
  return buildChangeSnapshotV1({
    schemaVersion: "change-snapshot-v1",
    baseCommitOid: "a".repeat(40),
    indexSha256: "b".repeat(64),
    discoverySha256: "c".repeat(64),
    manifest: [
      {
        changeKind: "added",
        oldPath: null,
        newPath: "src/added.ts",
        staged: true,
        unstaged: false,
        base: null,
        working: {
          mode: "100644",
          sizeBytes: Buffer.byteLength(REVIEW_FIXTURE_ADDED_TEXT, "utf8"),
          admittedContentSha256: sha256(REVIEW_FIXTURE_ADDED_TEXT),
        },
        omissionCodes: [],
        hunks: [addedHunk],
      },
      {
        changeKind: "modified",
        oldPath: "src/router.ts",
        newPath: "src/router.ts",
        staged: false,
        unstaged: true,
        base: {
          mode: "100644",
          sizeBytes: Buffer.byteLength("export const value = 1;\n", "utf8"),
          admittedContentSha256: sha256("export const value = 1;\n"),
        },
        working: {
          mode: "100644",
          sizeBytes: Buffer.byteLength(REVIEW_FIXTURE_NEW_TEXT, "utf8"),
          admittedContentSha256: sha256(REVIEW_FIXTURE_NEW_TEXT),
        },
        omissionCodes: [],
        hunks: [routerHunk],
      },
    ],
    omittedPathCount: 0,
    omittedHunkCount: 0,
    manifestOmissionCodes: [],
  });
}

function timestamp(sequence: number): string {
  return new Date(Date.UTC(2026, 7, 30, 0, 0, sequence)).toISOString();
}

function stored(sequence: number, event: SessionEventData): StoredSessionEvent {
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

export interface ReviewFixtureResultOverrides {
  snapshot?: ChangeSnapshotV1;
  inspectionContent?: string;
  readRelativePath?: string;
  readContent?: string;
  searchContent?: string;
}

export function reviewFixtureEvents(
  overrides: ReviewFixtureResultOverrides = {},
): StoredSessionEvent[] {
  const snapshot = overrides.snapshot ?? reviewFixtureSnapshot();
  const inspectResult = buildInspectGitChangesResultV1(snapshot);
  const inspectionContent =
    overrides.inspectionContent ?? JSON.stringify({ ok: true, ...inspectResult });
  const readContent =
    overrides.readContent ??
    JSON.stringify({
      ok: true,
      text: REVIEW_FIXTURE_NEW_TEXT,
      bytes: Buffer.byteLength(REVIEW_FIXTURE_NEW_TEXT, "utf8"),
      truncated: false,
    });
  const searchContent =
    overrides.searchContent ??
    JSON.stringify({
      ok: true,
      matches: [
        {
          path: "src/router.ts",
          lineNumber: 1,
          text: "export const value = 2;",
          textTruncated: false,
        },
      ],
      count: 1,
      filesSearched: 2,
      bytesScanned: 64,
      skipped: {
        binary: 0,
        ignored: 0,
        symlink: 0,
        tooLarge: 0,
        unreadable: 0,
      },
      truncated: false,
      outputBytes: 256,
    });

  const events: StoredSessionEvent[] = [
    stored(1, {
      type: "session.created",
      payload: {
        title: "Review current changes",
        objective: "Review the current changes for concrete defects.",
        workspaceRoot: "/tmp/review-workspace",
        profile: "quality",
        taskTrack: "change-review-v1",
        completionObligations: {
          requiredSuccessfulTools: ["inspect_git_changes"],
          minimumVerifiedPathLineCitations: 0,
        },
        executionPolicy: {
          schemaVersion: "agentic-execution-v2",
          inferenceRounds: 4,
          toolCalls: 3,
          routingPolicy: "local_only_v1",
          maxProviderChanges: 2,
          maxPaidAttempts: 1,
          maxPaidEpisodeMicrousd: 250_000,
          maxEpisodeDurationMs: 120_000,
          attemptTimeoutMs: 30_000,
          egressConsent: "none",
        },
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
        decisionId: "review-decision-1",
        policyVersion: "hybrid-lease-router-v0",
        boundary: "session_start",
        phase: "investigation",
        action: "assign_new_lease",
        reasonCode: "local_investigation",
        candidateProviderIds: [REVIEW_FIXTURE_PROVIDER_ID],
        selectedProviderId: REVIEW_FIXTURE_PROVIDER_ID,
        selectedModel: REVIEW_FIXTURE_MODEL,
        selectedLeaseId: "review-lease-1",
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
        leaseId: "review-lease-1",
        decisionId: "review-decision-1",
        phase: "investigation",
      },
    }),
  ];

  let sequence = 5;
  const addToolRound = (
    ordinal: number,
    toolName: "inspect_git_changes" | "read_text_file" | "search_text",
    arguments_: JsonValue,
    content: string,
  ): void => {
    const messageId = `review-message-${ordinal}`;
    const attemptId = `review-attempt-${ordinal}`;
    const checkpointId = `${REVIEW_FIXTURE_SESSION_ID}:context:${ordinal}`;
    const toolCallId = `review-tool-${ordinal}`;
    events.push(
      stored(sequence, {
        type: "assistant.message.started",
        payload: {
          messageId,
          providerId: REVIEW_FIXTURE_PROVIDER_ID,
          model: REVIEW_FIXTURE_MODEL,
          decisionId: "review-decision-1",
          leaseId: "review-lease-1",
          checkpointId,
          attemptId,
        },
      }),
      stored(sequence + 1, {
        type: "context.compiled",
        payload: {
          checkpointId,
          compilerVersion: "context-compiler-v1",
          reason: ordinal === 1 ? "session_start" : "tool_result_boundary",
          mode: "working",
          providerId: REVIEW_FIXTURE_PROVIDER_ID,
          model: REVIEW_FIXTURE_MODEL,
          maxTokens: 100_000,
          estimatedTokens: 1_000,
          estimator: "utf8-bytes-v1",
          reservedInputTokens: 100,
          effectiveInputTokenBudget: 89_900,
          sourceMessageCount: ordinal,
          messageCount: 2,
          evidenceCount: ordinal - 1,
          deduplicatedEvidenceCount: 0,
          omittedEvidenceCount: 0,
          packetSha256: "d".repeat(64),
          messagesSha256: "e".repeat(64),
          safetyMargin: 0.1,
          decisionId: "review-decision-1",
          leaseId: "review-lease-1",
          messageId,
          attemptId,
        },
      }),
      stored(sequence + 2, {
        type: "inference.attempt.started",
        payload: {
          attemptId,
          round: ordinal,
          checkpointId,
          messageId,
          decisionId: "review-decision-1",
          leaseId: "review-lease-1",
          providerId: REVIEW_FIXTURE_PROVIDER_ID,
          requestedModel: REVIEW_FIXTURE_MODEL,
          phase: "investigation",
          requestedMaxOutputTokens: 512,
          allowTools: true,
          allowedToolNames: [toolName],
          requireToolCall: true,
        },
      }),
      stored(sequence + 3, {
        type: "assistant.message.completed",
        payload: {
          messageId,
          stopReason: "tool_calls",
          completionState: "complete",
          attemptId,
        },
      }),
      stored(sequence + 4, {
        type: "inference.attempt.finished",
        payload: {
          attemptId,
          checkpointId,
          outcome: "succeeded",
          requestDisposition: "sent",
          finishReason: "tool_calls",
          servedModel: REVIEW_FIXTURE_MODEL,
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            reasoningTokens: 0,
            reported: true,
          },
          cost: {
            amountMicrousd: 0,
            provenance: "local_zero_cost_policy",
          },
          latencyMs: 25,
          ttftMs: 5,
        },
      }),
      stored(sequence + 5, {
        type: "tool.call.requested",
        payload: {
          toolCallId,
          name: toolName,
          arguments: arguments_,
          messageId,
        },
      }),
      stored(sequence + 6, {
        type: "tool.call.completed",
        payload: {
          toolCallId,
          name: toolName,
          content,
          isError: false,
          durationMs: 5,
        },
      }),
    );
    sequence += 7;
  };

  addToolRound(
    1,
    "inspect_git_changes",
    { schemaVersion: "inspect-git-changes-v1" },
    inspectionContent,
  );
  addToolRound(
    2,
    "read_text_file",
    { relativePath: overrides.readRelativePath ?? "src/router.ts" },
    readContent,
  );
  addToolRound(
    3,
    "search_text",
    { query: "value = 2", relativePath: "src/router.ts" },
    searchContent,
  );
  return events;
}

export const REVIEW_FIXTURE_SYNTHESIS_DECISION_ID = "review-decision-2";
export const REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID = "review-synthesis";
export const REVIEW_FIXTURE_SYNTHESIS_ATTEMPT_ID = "review-attempt-4";
export const REVIEW_FIXTURE_SYNTHESIS_CHECKPOINT_ID =
  `${REVIEW_FIXTURE_SESSION_ID}:context:4`;

function completeSnapshot(snapshot: ChangeSnapshotV1): boolean {
  return (
    snapshot.omittedPathCount === 0 &&
    snapshot.omittedHunkCount === 0 &&
    snapshot.manifestOmissionCodes.length === 0 &&
    snapshot.manifest.every((entry) => entry.omissionCodes.length === 0)
  );
}

export interface CompletedReviewFixtureOverrides {
  snapshot?: ChangeSnapshotV1;
  evidenceOverrides?: Omit<ReviewFixtureResultOverrides, "snapshot">;
  result?: ReviewResultV1;
  coverage?: ReviewCoverageV1;
  rawContent?: string;
  terminal?: "completed" | "interrupted" | "running";
}

/**
 * Canonical review history through a successful structured synthesis attempt.
 * Callers can deliberately vary the redundant raw/attached records to prove
 * that renderer projection revalidates rather than trusts replay labels.
 */
export function completedReviewFixtureEvents(
  overrides: CompletedReviewFixtureOverrides = {},
): StoredSessionEvent[] {
  const snapshot = overrides.snapshot ?? reviewFixtureSnapshot();
  const evidenceEvents = reviewFixtureEvents({
    ...overrides.evidenceOverrides,
    snapshot,
  });
  const verified = deriveVerifiedReviewEvidenceV1(evidenceEvents);
  const snapshotRevalidated = completeSnapshot(snapshot);
  const coverage =
    overrides.coverage ??
    deriveReviewCoverageV1({
      snapshot: verified.snapshot,
      evidenceSet: verified.evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated,
    });
  const incomplete = coverage.status === "incomplete";
  const result =
    overrides.result ??
    ({
      schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      snapshotId: snapshot.snapshotId,
      evidenceSetId: verified.evidenceSet.evidenceSetId,
      summary: incomplete
        ? "The bounded review has explicit coverage omissions."
        : "No blocking finding was found.",
      conclusion: incomplete ? "incomplete" : "no_blocking_findings",
      omissions: incomplete
        ? [
            {
              code: coverage.omissionCodes[0] ?? "snapshot_not_revalidated",
              description:
                "The bounded snapshot or evidence coverage was incomplete.",
            },
          ]
        : [],
      findings: [],
    } satisfies ReviewResultV1);
  const rawContent = overrides.rawContent ?? JSON.stringify(result);
  const events = [
    ...evidenceEvents,
    stored(26, {
      type: "routing.decision.recorded",
      payload: {
        decisionId: REVIEW_FIXTURE_SYNTHESIS_DECISION_ID,
        policyVersion: "hybrid-lease-router-v0",
        boundary: "evidence_complete",
        phase: "synthesis",
        action: "retain_lease",
        reasonCode: "low_risk_local_review",
        candidateProviderIds: [REVIEW_FIXTURE_PROVIDER_ID],
        selectedProviderId: REVIEW_FIXTURE_PROVIDER_ID,
        selectedModel: REVIEW_FIXTURE_MODEL,
        priorLeaseId: "review-lease-1",
        selectedLeaseId: "review-lease-1",
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
        messageId: REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
        providerId: REVIEW_FIXTURE_PROVIDER_ID,
        model: REVIEW_FIXTURE_MODEL,
        decisionId: REVIEW_FIXTURE_SYNTHESIS_DECISION_ID,
        leaseId: "review-lease-1",
        checkpointId: REVIEW_FIXTURE_SYNTHESIS_CHECKPOINT_ID,
        attemptId: REVIEW_FIXTURE_SYNTHESIS_ATTEMPT_ID,
      },
    }),
    stored(28, {
      type: "context.compiled",
      payload: {
        checkpointId: REVIEW_FIXTURE_SYNTHESIS_CHECKPOINT_ID,
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
        evidenceCount: verified.evidenceBodies.length,
        deduplicatedEvidenceCount: 0,
        omittedEvidenceCount: 0,
        packetSha256: "d".repeat(64),
        messagesSha256: "e".repeat(64),
        safetyMargin: 0.1,
        decisionId: REVIEW_FIXTURE_SYNTHESIS_DECISION_ID,
        leaseId: "review-lease-1",
        messageId: REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
        attemptId: REVIEW_FIXTURE_SYNTHESIS_ATTEMPT_ID,
        reviewSnapshotId: snapshot.snapshotId,
        reviewEvidenceSetId: verified.evidenceSet.evidenceSetId,
        reviewProvenanceSha256: verified.provenance.provenanceSha256,
        structuredOutputContract:
          REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
        structuredOutputSchemaSha256:
          REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
      },
    }),
    stored(29, {
      type: "inference.attempt.started",
      payload: {
        attemptId: REVIEW_FIXTURE_SYNTHESIS_ATTEMPT_ID,
        round: 4,
        checkpointId: REVIEW_FIXTURE_SYNTHESIS_CHECKPOINT_ID,
        messageId: REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
        decisionId: REVIEW_FIXTURE_SYNTHESIS_DECISION_ID,
        leaseId: "review-lease-1",
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
    stored(30, {
      type: "assistant.message.completed",
      payload: {
        messageId: REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
        content: rawContent,
        stopReason: "stop",
        completionState: "complete",
        reviewParseStatus: "accepted",
        reviewResult: result,
        reviewCoverage: coverage,
        attemptId: REVIEW_FIXTURE_SYNTHESIS_ATTEMPT_ID,
      },
    }),
    stored(31, {
      type: "inference.attempt.finished",
      payload: {
        attemptId: REVIEW_FIXTURE_SYNTHESIS_ATTEMPT_ID,
        checkpointId: REVIEW_FIXTURE_SYNTHESIS_CHECKPOINT_ID,
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
  ];

  if ((overrides.terminal ?? "completed") === "running") return events;
  if (overrides.terminal === "interrupted") {
    return [
      ...events,
      stored(32, {
        type: "session.interrupted",
        payload: { reason: "The desktop process stopped before finalization." },
      }),
    ];
  }
  return [
    ...events,
    stored(32, {
      type: "completion.obligations.checked",
      payload: {
        checkId: `${REVIEW_FIXTURE_SESSION_ID}:completion:4`,
        messageId: REVIEW_FIXTURE_SYNTHESIS_MESSAGE_ID,
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
      payload: { result: rawContent },
    }),
  ];
}
