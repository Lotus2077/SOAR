import { z } from "zod";

import {
  CHANGE_REVIEW_CONTRACT_LIMITS,
  ChangePathSchema,
  ChangeSnapshotV1Schema,
  GitObjectIdSchema,
  Sha256Schema,
} from "./change-review-contracts";
import {
  REVIEW_RISK_POLICY_ID,
  REVIEW_RISK_SIGNAL_IDS,
  REVIEW_RISK_SIGNAL_WEIGHTS,
  REVIEW_RISK_THRESHOLD,
  ReviewRiskFactsV1Schema,
  isReviewRiskRelevantTestPath,
  isReviewRiskRuntimePath,
  isReviewRiskSensitivePath,
  reviewRiskSurfaceForPath,
  scoreCompleteReviewRiskFactsV1,
  type ReviewRiskFactsV1,
  type ReviewRiskSignalId,
  type ReviewRiskSurface,
} from "./review-risk";

const BoundedIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

const utf8Encoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

export const CALIBRATION_SOURCE_DIFF_PROTOCOL_V1 =
  "host_change_snapshot_admitted_hunks_v1" as const;

export const CalibrationSourceDiffFileV1Schema = z
  .object({
    oldPath: ChangePathSchema.nullable(),
    newPath: ChangePathSchema.nullable(),
    changeKind: z.enum([
      "added",
      "deleted",
      "modified",
      "renamed",
      "type_changed",
    ]),
    additions: z.number().int().nonnegative().safe(),
    deletions: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((file, context) => {
    const requiresOld = ["deleted", "modified", "renamed", "type_changed"].includes(
      file.changeKind,
    );
    const requiresNew = ["added", "modified", "renamed", "type_changed"].includes(
      file.changeKind,
    );
    if ((file.oldPath !== null) !== requiresOld) {
      context.addIssue({
        code: "custom",
        message: `${file.changeKind} has an invalid oldPath presence`,
        path: ["oldPath"],
      });
    }
    if ((file.newPath !== null) !== requiresNew) {
      context.addIssue({
        code: "custom",
        message: `${file.changeKind} has an invalid newPath presence`,
        path: ["newPath"],
      });
    }
    if (
      (file.changeKind === "modified" || file.changeKind === "type_changed") &&
      file.oldPath !== file.newPath
    ) {
      context.addIssue({
        code: "custom",
        message: `${file.changeKind} must retain its path`,
        path: ["newPath"],
      });
    }
    if (file.changeKind === "renamed" && file.oldPath === file.newPath) {
      context.addIssue({
        code: "custom",
        message: "renamed source facts require distinct paths",
        path: ["newPath"],
      });
    }
  });

export type CalibrationSourceDiffFileV1 = z.infer<
  typeof CalibrationSourceDiffFileV1Schema
>;

/**
 * Pure shape-validated projection for shared/offline arithmetic. This does not
 * verify snapshot or hunk identities. Host callers that freeze or route on the
 * result must use deriveVerifiedCalibrationSourceDiffV1 from the main layer.
 * Git numstat remains a discovery/reconciliation view, not an independent
 * source of frozen routing line counts.
 */
export function deriveCalibrationSourceDiffFromSnapshotShapeV1(
  snapshotInput: unknown,
): CalibrationSourceDiffFileV1[] {
  const snapshot = ChangeSnapshotV1Schema.parse(snapshotInput);
  if (
    snapshot.omittedPathCount !== 0 ||
    snapshot.omittedHunkCount !== 0 ||
    snapshot.manifestOmissionCodes.length !== 0 ||
    snapshot.manifest.some((entry) => entry.omissionCodes.length !== 0)
  ) {
    throw new TypeError(
      "Calibration source facts require a complete host change snapshot.",
    );
  }

  return snapshot.manifest
    .map((entry) => {
      if (entry.changeKind === "untracked") {
        throw new TypeError(
          "Frozen commit calibration cannot contain an untracked change.",
        );
      }
      let additions = 0;
      let deletions = 0;
      for (const hunk of entry.hunks) {
        for (const line of hunk.lines) {
          if (line.kind === "addition") additions += 1;
          if (line.kind === "deletion") deletions += 1;
        }
      }
      return CalibrationSourceDiffFileV1Schema.parse({
        oldPath: entry.oldPath,
        newPath: entry.newPath,
        changeKind: entry.changeKind,
        additions,
        deletions,
      });
    })
    .sort((left, right) =>
      compareText(sourceDiffPath(left), sourceDiffPath(right)),
    );
}

function sourceDiffPath(file: CalibrationSourceDiffFileV1): string {
  return file.newPath ?? file.oldPath ?? "";
}

function sourceDiffPathCandidates(
  file: CalibrationSourceDiffFileV1,
): string[] {
  return [file.newPath, file.oldPath].filter(
    (path): path is string => path !== null,
  );
}

export function deriveCalibrationRiskFactsV1(
  filesInput: readonly CalibrationSourceDiffFileV1[],
): ReviewRiskFactsV1 {
  const files = filesInput.map((file) => CalibrationSourceDiffFileV1Schema.parse(file));
  const surfaces = sortUnique(
    files.flatMap((file) =>
      sourceDiffPathCandidates(file).flatMap((candidate) => {
        const surface = reviewRiskSurfaceForPath(candidate);
        return surface === undefined ? [] : [surface];
      }),
    ),
  ) as ReviewRiskSurface[];
  return ReviewRiskFactsV1Schema.parse({
    changedPathCount: files.length,
    changedLineCount: files.reduce(
      (total, file) => total + file.additions + file.deletions,
      0,
    ),
    surfaces,
    sensitivePaths: sortUnique(
      files
        .flatMap(sourceDiffPathCandidates)
        .filter(isReviewRiskSensitivePath),
    ),
    runtimePaths: sortUnique(
      files.flatMap(sourceDiffPathCandidates).filter(isReviewRiskRuntimePath),
    ),
    relevantTestPaths: sortUnique(
      files
        .flatMap(sourceDiffPathCandidates)
        .filter(isReviewRiskRelevantTestPath),
    ),
  });
}

export const FrozenCalibrationAcquisitionV1Schema = z
  .object({
    status: z.literal("verified_change_snapshot_v1"),
    inspectorContractVersion: z.literal("inspect-git-changes-v1"),
    acquisitionComplete: z.literal(true),
    incompleteReasons: z.tuple([]),
    snapshotId: Sha256Schema,
    indexSha256: Sha256Schema,
    discoverySha256: Sha256Schema,
    sourceDiffProtocol: z.literal(CALIBRATION_SOURCE_DIFF_PROTOCOL_V1),
    sourceDiff: z
      .array(CalibrationSourceDiffFileV1Schema)
      .min(1)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries),
    verifiedFeatureFacts: ReviewRiskFactsV1Schema,
    verifiedScore: z.number().int().nonnegative().safe(),
    verifiedClassification: z.enum(["low_risk", "high_risk"]),
  })
  .strict()
  .superRefine((acquisition, context) => {
    const canonicalPaths = acquisition.sourceDiff.map(sourceDiffPath);
    if (
      canonicalPaths.some(
        (path, index) => index > 0 && canonicalPaths[index - 1]! >= path,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "source diff paths must be strictly sorted and unique",
        path: ["sourceDiff"],
      });
    }
    let derivedFacts: ReviewRiskFactsV1;
    try {
      derivedFacts = deriveCalibrationRiskFactsV1(acquisition.sourceDiff);
    } catch {
      context.addIssue({
        code: "custom",
        message: "source diff cannot produce bounded review-risk facts",
        path: ["sourceDiff"],
      });
      return;
    }
    if (
      JSON.stringify(derivedFacts) !==
      JSON.stringify(acquisition.verifiedFeatureFacts)
    ) {
      context.addIssue({
        code: "custom",
        message: "verified feature facts do not match the pinned source diff",
        path: ["verifiedFeatureFacts"],
      });
    }
    const score = scoreCompleteReviewRiskFactsV1(derivedFacts);
    if (score.score !== acquisition.verifiedScore) {
      context.addIssue({
        code: "custom",
        message: "verified score does not match review-risk-v1 arithmetic",
        path: ["verifiedScore"],
      });
    }
    if (score.classification !== acquisition.verifiedClassification) {
      context.addIssue({
        code: "custom",
        message: "verified classification does not match review-risk-v1",
        path: ["verifiedClassification"],
      });
    }
    if (
      utf8Encoder.encode(JSON.stringify(acquisition)).byteLength >
      CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes
    ) {
      context.addIssue({
        code: "custom",
        message:
          "frozen calibration acquisition exceeds the serialized contract byte limit",
      });
    }
  });

export type FrozenCalibrationAcquisitionV1 = z.infer<
  typeof FrozenCalibrationAcquisitionV1Schema
>;

export const REVIEW_ATTENTION_LABELS = ["heightened", "routine"] as const;

export const ChangeReviewCalibrationChangeV1Schema = z
  .object({
    schemaVersion: z.literal("change-review-calibration-change-v1"),
    id: BoundedIdentifierSchema,
    source: z
      .object({
        repository: z.string().url(),
        baseRevision: GitObjectIdSchema,
        changeRevision: GitObjectIdSchema,
        changeUrl: z.string().url(),
        committedAt: z.string().datetime({ offset: true }),
        subject: z.string().trim().min(1).max(256),
      })
      .strict(),
    fixtureMode: z.literal("pinned_git_patch_to_index"),
    materialization: z
      .object({
        protocol: z.literal("git-patch-to-index-v1"),
        steps: z.tuple([
          z.literal("clone_public_repository"),
          z.literal("verify_base_and_change_objects"),
          z.literal("checkout_base_revision_detached"),
          z.literal("generate_binary_full_index_patch_base_to_change"),
          z.literal("apply_patch_to_index"),
          z.literal("run_host_change_acquisition"),
          z.literal("verify_snapshot_identity_and_feature_facts"),
        ]),
        patchApplication: z.literal(
          "git_diff_binary_full_index_then_git_apply_index_v1",
        ),
      })
      .strict(),
    acquisition: FrozenCalibrationAcquisitionV1Schema,
    label: z
      .object({
        reviewAttention: z.enum(REVIEW_ATTENTION_LABELS),
        provenance: z.literal("curator_scope_judgment_v1"),
        rationale: z.string().trim().min(1).max(512),
      })
      .strict(),
  })
  .strict()
  .superRefine((change, context) => {
    if (change.source.baseRevision === change.source.changeRevision) {
      context.addIssue({
        code: "custom",
        message: "base and change revisions must differ",
        path: ["source", "changeRevision"],
      });
    }
  });

export type ChangeReviewCalibrationChangeV1 = z.infer<
  typeof ChangeReviewCalibrationChangeV1Schema
>;

export const ChangeReviewCalibrationSetV1Schema = z
  .object({
    schemaVersion: z.literal("change-review-calibration-set-v1"),
    setId: z.literal("change-review-calibration-v1"),
    status: z.literal("frozen"),
    frozenAt: z.string().datetime({ offset: true }),
    selectionProtocol: z.literal(
      "real_public_changes_balanced_by_curator_review_attention_v1",
    ),
    labelSemantics: z.literal(
      "review_attention_only_not_defect_correctness_or_quality_gold",
    ),
    changes: z.array(ChangeReviewCalibrationChangeV1Schema).length(12),
  })
  .strict()
  .superRefine((set, context) => {
    const ids = set.changes.map((change) => change.id);
    const revisions = set.changes.map((change) => change.source.changeRevision);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "calibration change ids must be unique",
        path: ["changes"],
      });
    }
    if (new Set(revisions).size !== revisions.length) {
      context.addIssue({
        code: "custom",
        message: "calibration change revisions must be unique",
        path: ["changes"],
      });
    }
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      context.addIssue({
        code: "custom",
        message: "calibration changes must be sorted by id",
        path: ["changes"],
      });
    }
    for (const label of REVIEW_ATTENTION_LABELS) {
      if (
        set.changes.filter((change) => change.label.reviewAttention === label)
          .length < 4
      ) {
        context.addIssue({
          code: "custom",
          message: `calibration set requires at least four ${label} changes`,
          path: ["changes"],
        });
      }
    }
  });

export type ChangeReviewCalibrationSetV1 = z.infer<
  typeof ChangeReviewCalibrationSetV1Schema
>;

const ReviewRiskProtocolSignalSchema = z
  .object({
    id: z.enum(REVIEW_RISK_SIGNAL_IDS),
    weight: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

export const ChangeReviewEvalProtocolV1Schema = z
  .object({
    schemaVersion: z.literal("change-review-eval-v1"),
    protocolId: z.literal("change-review-eval-v1"),
    status: z.literal("frozen"),
    frozenAt: z.string().datetime({ offset: true }),
    riskPolicy: z
      .object({
        policyId: z.literal(REVIEW_RISK_POLICY_ID),
        changedLineProtocol: z.literal(CALIBRATION_SOURCE_DIFF_PROTOCOL_V1),
        threshold: z.literal(REVIEW_RISK_THRESHOLD),
        lowRiskPredicate: z.literal("complete_evidence_and_score_less_than_3"),
        incompletePredicate: z.literal(
          "incomplete_oversized_binary_submodule_or_unreadable_evidence",
        ),
        signals: z.array(ReviewRiskProtocolSignalSchema).length(
          REVIEW_RISK_SIGNAL_IDS.length,
        ),
      })
      .strict(),
    calibration: z
      .object({
        setId: z.literal("change-review-calibration-v1"),
        status: z.literal("verified_change_snapshots_v1"),
        manifestPath: z.literal(
          "benchmarks/change-review/calibration-v1.json",
        ),
        manifestSha256: Sha256Schema,
        fixtureCount: z.literal(12),
        labelsAreRoutingCalibrationOnly: z.literal(true),
      })
      .strict(),
    acquisitionProfile: z
      .object({
        requestSchemaVersion: z.literal("inspect-git-changes-v1"),
        resultSchemaVersion: z.literal("inspect-git-changes-result-v1"),
        diffEngine: z.literal("diff@9.0.0"),
        maxChangedPaths: z.literal(200),
        maxSourceBytesPerSide: z.literal(262144),
        maxTotalSourceBytes: z.literal(4194304),
        maxHunks: z.literal(200),
        maxResultBytes: z.literal(196608),
      })
      .strict(),
    heldOut: z
      .object({
        storageBoundary: z.literal("sealed_outside_agent_workspace"),
        fixtureIdentitiesIncluded: z.literal(false),
        goldIncluded: z.literal(false),
        minimumFixtures: z.literal(24),
        minimumClean: z.literal(8),
        minimumFaulty: z.literal(16),
        minimumP0P1Defects: z.literal(20),
        minimumP2P3Defects: z.literal(8),
      })
      .strict(),
    comparisonPolicies: z.tuple([
      z.literal("local_only_v1"),
      z.literal("cloud_synthesis_all_eval"),
      z.literal("hybrid_v0"),
    ]),
    evidenceIsolation: z.literal(
      "same_immutable_host_collected_packet_tool_free_synthesis_only_provider_differs",
    ),
    evaluator: z
      .object({
        evaluatorVersion: z.literal("change-review-evaluator-v1"),
        successfulReview: z.literal(
          "valid_grounded_result_accepted_against_unchanged_snapshot",
        ),
        highSeverityRecall: z.literal(
          "unique_matched_p0_p1_divided_by_all_p0_p1",
        ),
        allSeverityRecall: z.literal(
          "unique_matched_p0_p1_p2_p3_divided_by_all_p0_p1_p2_p3",
        ),
        findingPrecision: z.literal(
          "unique_matched_valid_findings_divided_by_all_findings_duplicates_are_false_positive",
        ),
        falseAccept: z.literal(
          "clean_conclusion_while_any_p0_p1_gold_remains_unmatched",
        ),
        weightedQuality: z.literal(
          "0.5_high_severity_recall_plus_0.3_all_severity_recall_plus_0.2_finding_precision",
        ),
        adjudication: z.literal(
          "two_humans_blinded_to_policy_and_provider_resolve_semantic_matches",
        ),
      })
      .strict(),
    reporting: z
      .object({
        proportionIntervals: z.literal("wilson_95_percent"),
        costLatencyIntervals: z.literal("bootstrap_95_percent"),
        invalidBlockedFlakyRetriedRunsSeparated: z.literal(true),
        localInfrastructureReportedSeparately: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((protocol, context) => {
    const expectedSignals = REVIEW_RISK_SIGNAL_IDS.map((id) => ({
      id,
      weight: REVIEW_RISK_SIGNAL_WEIGHTS[id],
    }));
    if (JSON.stringify(protocol.riskPolicy.signals) !== JSON.stringify(expectedSignals)) {
      context.addIssue({
        code: "custom",
        message: "protocol signal order and weights must match review-risk-v1",
        path: ["riskPolicy", "signals"],
      });
    }
  });

export type ChangeReviewEvalProtocolV1 = z.infer<
  typeof ChangeReviewEvalProtocolV1Schema
>;

export function frozenReviewRiskProtocolSignals(): Array<{
  id: ReviewRiskSignalId;
  weight: 1 | 2;
}> {
  return REVIEW_RISK_SIGNAL_IDS.map((id) => ({
    id,
    weight: REVIEW_RISK_SIGNAL_WEIGHTS[id],
  }));
}
