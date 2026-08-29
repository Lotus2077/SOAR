import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildChangeHunkV1,
  buildChangeSnapshotV1,
  canonicalizeReviewEvidenceSetV1,
  deriveReviewCoverageV1,
  sha256GitIndexStageEntries,
} from "../../src/main/change-acquisition-contracts";
import {
  assertHostAcceptedReviewResultV1,
  parseAndHostAcceptRawReviewResultV1,
} from "../../src/main/review-result-acceptance";
import type {
  ChangeManifestEntryV1,
  ChangeSnapshotV1,
  ReviewCoverageV1,
  ReviewEvidenceSetV1,
} from "../../src/shared/change-review-contracts";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA,
  REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL,
  REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  REVIEW_RESULT_V1_LIMITS,
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  ReviewResultContractError,
  ReviewResultV1Schema,
  assertReviewResultV1Accepted,
  parseAndAcceptRawReviewResultV1,
  parseRawReviewResultV1,
  reviewResultV1ResponseFormat,
  reviewResultV1StructuredOutputIdentity,
  type ReviewResultV1,
  type ReviewResultV1AcceptanceContext,
} from "../../src/shared/review-result-contract";
import {
  InferenceAttemptStartedPayloadSchema,
  parseSessionEventData,
} from "../../src/shared/session-events";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function modifiedEntry(): ChangeManifestEntryV1 {
  const hunk = buildChangeHunkV1({
    schemaVersion: "change-hunk-v1",
    oldPath: "src/router.ts",
    newPath: "src/router.ts",
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    lines: [
      {
        kind: "context",
        content: "export function route() {",
        terminator: "lf",
        oldLine: 1,
        newLine: 1,
      },
      {
        kind: "deletion",
        content: "  return 'local';",
        terminator: "lf",
        oldLine: 2,
        newLine: null,
      },
      {
        kind: "addition",
        content: "  return chooseProvider();",
        terminator: "lf",
        oldLine: null,
        newLine: 2,
      },
    ],
  });
  return {
    changeKind: "modified",
    oldPath: "src/router.ts",
    newPath: "src/router.ts",
    staged: true,
    unstaged: false,
    base: {
      mode: "100644",
      sizeBytes: 48,
      admittedContentSha256: sha256("old router"),
    },
    working: {
      mode: "100644",
      sizeBytes: 56,
      admittedContentSha256: sha256("new router"),
    },
    omissionCodes: [],
    hunks: [hunk],
  };
}

function snapshot(entry: ChangeManifestEntryV1 = modifiedEntry()): ChangeSnapshotV1 {
  const indexPath = entry.newPath ?? entry.oldPath;
  if (indexPath === null) throw new Error("Invalid test entry.");
  return buildChangeSnapshotV1({
    schemaVersion: "change-snapshot-v1",
    baseCommitOid: "a".repeat(40),
    indexSha256: sha256GitIndexStageEntries([
      {
        mode: entry.working?.mode ?? entry.base?.mode ?? "100644",
        objectId: "b".repeat(40),
        stage: 0,
        path: indexPath,
      },
    ]),
    discoverySha256: sha256(`discovery:${indexPath}`),
    manifest: [entry],
    omittedPathCount: 0,
    omittedHunkCount: 0,
    manifestOmissionCodes: [],
  });
}

function evidenceSet(changeSnapshot: ChangeSnapshotV1): ReviewEvidenceSetV1 {
  const entry = changeSnapshot.manifest[0];
  const path = entry?.newPath ?? entry?.oldPath;
  const contentSha256 =
    entry?.working?.admittedContentSha256 ?? entry?.base?.admittedContentSha256;
  if (!entry || path === null || !contentSha256) {
    throw new Error("Invalid evidence fixture.");
  }
  return canonicalizeReviewEvidenceSetV1({
    schemaVersion: "review-evidence-set-v1",
    snapshotId: changeSnapshot.snapshotId,
    changeHunkSha256s: entry.hunks.map((hunk) => hunk.hunkSha256),
    completeBodies: [],
    repositoryObservations: [
      {
        observationId: "tool-read-1",
        toolName: "read_text_file",
        scope: "full_file",
        path,
        line: null,
        lineCount: 2,
        contentSha256,
      },
    ],
  });
}

function acceptanceContext(
  options: { packetRetainedEvidenceSet?: boolean } = {},
): ReviewResultV1AcceptanceContext {
  const changeSnapshot = snapshot();
  const admittedEvidence = evidenceSet(changeSnapshot);
  const coverage = deriveReviewCoverageV1({
    snapshot: changeSnapshot,
    evidenceSet: admittedEvidence,
    packetRetainedEvidenceSet: options.packetRetainedEvidenceSet ?? true,
    snapshotRevalidated: true,
  });
  return { snapshot: changeSnapshot, evidenceSet: admittedEvidence, coverage };
}

function changeReference(context: ReviewResultV1AcceptanceContext) {
  const hunk = context.snapshot.manifest[0]?.hunks[0];
  if (!hunk) throw new Error("Invalid reference fixture.");
  return {
    kind: "change" as const,
    snapshotId: context.snapshot.snapshotId,
    path: "src/router.ts",
    side: "working" as const,
    line: 2,
    hunkSha256: hunk.hunkSha256,
  };
}

function result(
  context: ReviewResultV1AcceptanceContext,
  overrides: Partial<ReviewResultV1> = {},
): ReviewResultV1 {
  return {
    schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    snapshotId: context.snapshot.snapshotId,
    summary: "The route selection change can bypass the local policy.",
    conclusion: "blocking_findings",
    evidenceSetId: context.evidenceSet.evidenceSetId,
    omissions: [],
    findings: [
      {
        findingId: "finding-1",
        severity: "P1",
        title: "Local policy can be bypassed",
        impact: "A task can be sent to an unintended provider.",
        suggestedCorrection: "Check policy before selecting a provider.",
        suggestedTest: "Add a regression for a local-only session.",
        evidence: [changeReference(context)],
      },
    ],
    ...overrides,
  };
}

describe("ReviewResultV1 schema identity", () => {
  it("pins one canonical standard JSON Schema and its SHA-256", () => {
    expect(
      createHash("sha256")
        .update(REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL, "utf8")
        .digest("hex"),
    ).toBe(REVIEW_RESULT_V1_JSON_SCHEMA_SHA256);
    expect(REVIEW_RESULT_V1_JSON_SCHEMA).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
    });
    expect(Object.isFrozen(REVIEW_RESULT_V1_JSON_SCHEMA)).toBe(true);
    expect(
      Object.isFrozen(REVIEW_RESULT_V1_JSON_SCHEMA.properties.findings.items),
    ).toBe(true);
    expect(REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL).not.toContain(
      '"uniqueItems"',
    );
    expect(REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL).not.toContain('"pattern"');
    expect(reviewResultV1StructuredOutputIdentity()).toEqual({
      contract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      schemaName: REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
      schemaSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    });
    expect(reviewResultV1ResponseFormat()).toEqual({
      type: "json_schema",
      json_schema: {
        name: REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
        strict: true,
        schema: REVIEW_RESULT_V1_JSON_SCHEMA,
      },
    });
  });

  it("rejects forged schema hashes in both attempt and context events", () => {
    const attempt = {
      attemptId: "attempt-1",
      round: 1,
      checkpointId: "checkpoint-1",
      messageId: "message-1",
      decisionId: "decision-1",
      leaseId: "lease-1",
      providerId: "local-vllm",
      requestedModel: "local-model",
      phase: "synthesis" as const,
      requestedMaxOutputTokens: 512,
      allowTools: false,
      requireToolCall: false,
      structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      structuredOutputSchemaSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    };
    expect(InferenceAttemptStartedPayloadSchema.parse(attempt)).toEqual(attempt);
    expect(
      InferenceAttemptStartedPayloadSchema.safeParse({
        ...attempt,
        structuredOutputSchemaSha256: "0".repeat(64),
      }).success,
    ).toBe(false);

    const contextEvent = {
      type: "context.compiled" as const,
      payload: {
        checkpointId: "checkpoint-1",
        compilerVersion: "review-context-compiler-v1" as const,
        reason: "finalization_boundary" as const,
        mode: "finalization" as const,
        providerId: "local-vllm",
        model: "local-model",
        maxTokens: 1_000,
        estimatedTokens: 100,
        estimator: "utf8-bytes-v1" as const,
        reservedInputTokens: 100,
        effectiveInputTokenBudget: 800,
        sourceMessageCount: 1,
        messageCount: 2,
        evidenceCount: 0,
        deduplicatedEvidenceCount: 0,
        omittedEvidenceCount: 0,
        packetSha256: "a".repeat(64),
        messagesSha256: "b".repeat(64),
        safetyMargin: 0.1,
        decisionId: "decision-1",
        leaseId: "lease-1",
        messageId: "message-1",
        attemptId: "attempt-1",
        reviewSnapshotId: "c".repeat(64),
        reviewEvidenceSetId: "d".repeat(64),
        reviewProvenanceSha256: "e".repeat(64),
        structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
        structuredOutputSchemaSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
      },
    };
    expect(parseSessionEventData(contextEvent)).toEqual(contextEvent);
    expect(() =>
      parseSessionEventData({
        ...contextEvent,
        payload: {
          ...contextEvent.payload,
          structuredOutputSchemaSha256: "0".repeat(64),
        },
      }),
    ).toThrow();
  });
});

describe("ReviewResultV1 structural parsing", () => {
  it("parses the whole raw JSON value without prose, fence, or suffix repair", () => {
    const context = acceptanceContext();
    const valid = result(context);
    expect(parseRawReviewResultV1(JSON.stringify(valid))).toEqual(valid);
    expect(() =>
      parseRawReviewResultV1(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``),
    ).toThrow(/exactly one valid JSON value/u);
    expect(() =>
      parseRawReviewResultV1(`${JSON.stringify(valid)} trailing`),
    ).toThrow(/exactly one valid JSON value/u);
  });

  it("rejects unknown fields, empty evidence, string bounds, and raw byte overflow", () => {
    const context = acceptanceContext();
    const valid = result(context);
    expect(
      ReviewResultV1Schema.safeParse({ ...valid, unexpected: true }).success,
    ).toBe(false);
    expect(
      ReviewResultV1Schema.safeParse({
        ...valid,
        summary: "x".repeat(REVIEW_RESULT_V1_LIMITS.maxSummaryCharacters + 1),
      }).success,
    ).toBe(false);
    expect(
      ReviewResultV1Schema.safeParse({
        ...valid,
        findings: [{ ...valid.findings[0]!, evidence: [] }],
      }).success,
    ).toBe(false);
    expect(() =>
      parseRawReviewResultV1(
        `"${"x".repeat(REVIEW_RESULT_V1_LIMITS.maxRawOutputBytes)}"`,
      ),
    ).toThrow(/byte limit/u);
  });

  it("rejects duplicate omission codes, finding IDs, and evidence references", () => {
    const context = acceptanceContext();
    const valid = result(context);
    expect(
      ReviewResultV1Schema.safeParse({
        ...valid,
        omissions: [
          { code: "not_read", description: "One path was not read." },
          { code: "not_read", description: "Another path was not read." },
        ],
      }).success,
    ).toBe(false);
    expect(
      ReviewResultV1Schema.safeParse({
        ...valid,
        findings: [valid.findings[0]!, { ...valid.findings[0]! }],
      }).success,
    ).toBe(false);
    expect(
      ReviewResultV1Schema.safeParse({
        ...valid,
        findings: [
          {
            ...valid.findings[0]!,
            evidence: [
              valid.findings[0]!.evidence[0]!,
              valid.findings[0]!.evidence[0]!,
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate raw object members, including escaped equivalent names", () => {
    const context = acceptanceContext();
    const valid = JSON.stringify(result(context));
    const duplicateTopLevel = valid.replace(
      '"summary":',
      '"summary":"shadowed","\\u0073ummary":',
    );
    const duplicateNested = valid.replace(
      '"title":',
      '"title":"shadowed","title":',
    );
    expect(() => parseRawReviewResultV1(duplicateTopLevel)).toThrow(
      /duplicate JSON object member/u,
    );
    expect(() => parseRawReviewResultV1(duplicateNested)).toThrow(
      /duplicate JSON object member/u,
    );
  });
});

describe("ReviewResultV1 host acceptance", () => {
  it("enforces blocking, incomplete, and clean conclusion precedence", () => {
    const complete = acceptanceContext();
    expect(assertReviewResultV1Accepted(result(complete), complete).conclusion).toBe(
      "blocking_findings",
    );
    expect(() =>
      assertReviewResultV1Accepted(
        result(complete, { conclusion: "no_blocking_findings" }),
        complete,
      ),
    ).toThrow(/must be blocking_findings/u);

    const clean = result(complete, {
      summary: "No blocking findings were found in the admitted evidence.",
      conclusion: "no_blocking_findings",
      findings: [],
    });
    expect(
      parseAndAcceptRawReviewResultV1(JSON.stringify(clean), complete).conclusion,
    ).toBe("no_blocking_findings");

    const incomplete = acceptanceContext({ packetRetainedEvidenceSet: false });
    const incompleteResult = result(incomplete, {
      summary: "The final packet did not retain the complete evidence set.",
      conclusion: "incomplete",
      omissions: [
        {
          code: "packet_evidence_not_retained",
          description: "The final packet did not retain the evidence set.",
        },
      ],
      findings: [],
    });
    expect(
      assertReviewResultV1Accepted(incompleteResult, incomplete).conclusion,
    ).toBe("incomplete");
    expect(() =>
      assertReviewResultV1Accepted(
        { ...incompleteResult, conclusion: "no_blocking_findings" },
        incomplete,
      ),
    ).toThrow(/must be incomplete/u);

    expect(
      assertReviewResultV1Accepted(
        result(incomplete, {
          omissions: incompleteResult.omissions,
          conclusion: "blocking_findings",
        }),
        incomplete,
      ).conclusion,
    ).toBe("blocking_findings");
    expect(() =>
      assertReviewResultV1Accepted(result(incomplete), incomplete),
    ).toThrow(/requires at least one bounded review omission/u);
  });

  it("rejects stale, inadmissible, and repository-only finding evidence", () => {
    const context = acceptanceContext();
    const valid = result(context);
    expect(() =>
      assertReviewResultV1Accepted(
        { ...valid, snapshotId: "f".repeat(64) },
        context,
      ),
    ).toThrow(/stale change snapshot/u);
    expect(() =>
      assertReviewResultV1Accepted(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0]!,
              evidence: [
                { ...changeReference(context), line: 999 },
              ],
            },
          ],
        },
        context,
      ),
    ).toThrow(/inadmissible evidence/u);

    const observation = context.evidenceSet.repositoryObservations[0]!;
    expect(() =>
      assertReviewResultV1Accepted(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0]!,
              severity: "P2",
              evidence: [
                {
                  kind: "repository",
                  snapshotId: context.snapshot.snapshotId,
                  evidenceSetId: context.evidenceSet.evidenceSetId,
                  observationId: observation.observationId,
                  path: observation.path,
                  line: 1,
                  contentSha256: observation.contentSha256,
                },
              ],
            },
          ],
          conclusion: "no_blocking_findings",
        },
        context,
      ),
    ).toThrow(/lacks admitted change-origin evidence/u);
  });

  it("accepts change_metadata as origin evidence for a content-identical rename", () => {
    const contentSha256 = sha256("unchanged content");
    const renamedSnapshot = snapshot({
      changeKind: "renamed",
      oldPath: "src/old-router.ts",
      newPath: "src/router.ts",
      staged: true,
      unstaged: false,
      base: {
        mode: "100644",
        sizeBytes: 17,
        admittedContentSha256: contentSha256,
      },
      working: {
        mode: "100644",
        sizeBytes: 17,
        admittedContentSha256: contentSha256,
      },
      omissionCodes: [],
      hunks: [],
    });
    const renamedEvidence = evidenceSet(renamedSnapshot);
    const coverage: ReviewCoverageV1 = deriveReviewCoverageV1({
      snapshot: renamedSnapshot,
      evidenceSet: renamedEvidence,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });
    const context = {
      snapshot: renamedSnapshot,
      evidenceSet: renamedEvidence,
      coverage,
    };
    const accepted = assertReviewResultV1Accepted(
      {
        schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
        snapshotId: renamedSnapshot.snapshotId,
        summary: "The rename keeps the same admitted content.",
        conclusion: "no_blocking_findings",
        evidenceSetId: renamedEvidence.evidenceSetId,
        omissions: [],
        findings: [
          {
            findingId: "rename-note",
            severity: "P3",
            title: "Content-identical rename",
            impact: "Imports may need to follow the new path.",
            suggestedCorrection: "Update any remaining old-path imports.",
            suggestedTest: "Run the import resolution test.",
            evidence: [
              {
                kind: "change_metadata",
                snapshotId: renamedSnapshot.snapshotId,
                path: "src/router.ts",
                changeKind: "renamed",
              },
            ],
          },
        ],
      },
      context,
    );
    expect(accepted.findings[0]?.evidence[0]).toMatchObject({
      kind: "change_metadata",
      changeKind: "renamed",
    });
  });

  it("uses a dedicated error type for raw protocol failures", () => {
    expect(() => parseRawReviewResultV1("not-json")).toThrow(
      ReviewResultContractError,
    );
  });

  it("offers a main-process gate that re-verifies identities and host-derived coverage", () => {
    const context = acceptanceContext();
    const valid = result(context);
    const hostInput = {
      snapshot: context.snapshot,
      evidenceSet: context.evidenceSet,
      coverage: context.coverage,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    };
    expect(
      parseAndHostAcceptRawReviewResultV1(JSON.stringify(valid), hostInput),
    ).toEqual(valid);

    const tamperedSnapshot = structuredClone(context.snapshot);
    tamperedSnapshot.manifest[0]!.hunks[0]!.lines[2]!.content = "tampered";
    expect(() =>
      assertHostAcceptedReviewResultV1(valid, {
        ...hostInput,
        snapshot: tamperedSnapshot,
      }),
    ).toThrow(/identity mismatch/u);

    const forgedCoverage = {
      ...structuredClone(context.coverage),
      runtimeCodeChangedWithoutChangedTest: false,
    };
    expect(() =>
      assertHostAcceptedReviewResultV1(valid, {
        ...hostInput,
        coverage: forgedCoverage,
      }),
    ).toThrow(/does not match host-derived coverage|Runtime-without-test/u);
  });
});
