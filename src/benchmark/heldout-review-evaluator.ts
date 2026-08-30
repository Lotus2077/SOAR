import { createHash, type KeyObject } from "node:crypto";

import { z } from "zod";

import {
  HELD_OUT_EVALUATOR_VERSION,
  HELD_OUT_FIXTURE_COUNT,
  HELD_OUT_REVIEW_PROTOCOL_ID,
  HeldOutRunManifestV1Schema,
  canonicalHeldOutJsonV1,
  validateHeldOutRunResultsV1,
  type HeldOutEvidenceRegionV1,
  type HeldOutRunManifestV1,
  type HeldOutRunResultV1,
} from "../shared/heldout-review-runner-contracts.ts";
import {
  HeldOutAdjudicationPacketV1Schema,
  HeldOutAdjudicationResolutionV1Schema,
  HeldOutAdjudicatorJudgmentV1Schema,
  HeldOutCoordinatorAttestationV1Schema,
  computeHeldOutRunManifestSha256V1,
  computeHeldOutAdjudicationPacketSha256V1,
  computeHeldOutCoordinatorAttestationSha256V1,
  coordinatorVerificationKeyFingerprintV1,
  validateHeldOutAdjudicationPairV1,
  validateHeldOutCorpusV1,
  validateHeldOutPrivateFindingBindingsV1,
  type HeldOutAdjudicationPacketV1,
  type HeldOutAdjudicationResolutionV1,
  type HeldOutAdjudicatorJudgmentV1,
  type HeldOutCoordinatorAttestationV1,
  type HeldOutFindingDispositionV1,
  type HeldOutGoldDefectV1,
  type HeldOutOracleEntryV1,
  type HeldOutPrivateFindingV1,
} from "./heldout-review-evaluator-contracts.ts";
import {
  computeHeldOutOperationalStatisticsV1,
  wilson95IntervalV1,
  type HeldOutOperationalStatisticsV1,
  type HeldOutStatisticsRowV1,
  type Wilson95IntervalV1,
} from "./heldout-review-statistics.ts";

const MAX_FINDINGS = HELD_OUT_FIXTURE_COUNT * 64;
const MAX_JUDGMENTS = MAX_FINDINGS * 2;

export const HELD_OUT_REVIEW_NON_CLAIMS_V1 = Object.freeze([
  "The evaluator process contacted no provider.",
  "Private corpus inputs prevent independent corpus reproduction.",
  "Coordinator signatures are trusted assertions; the harness does not observe personhood, actual blinding, or external trust-anchor approval.",
  "Selected token cost and infrastructure cost are reported separately.",
  "This aggregate is not evidence of routing benefit or release readiness.",
] as const);

export type HeldOutReviewAssessmentStatusV1 =
  | "complete"
  | "pending_adjudication"
  | "adjudication_attestation_unverified"
  | "corpus_correction_required";

export type HeldOutReviewSemanticReasonV1 =
  | "zero_emitted_findings"
  | "pending_adjudication"
  | "adjudication_attestation_unverified"
  | "valid_novel_defect"
  | null;

export type HeldOutReviewEvaluationErrorCode =
  | "corpus_input_invalid"
  | "run_input_invalid"
  | "finding_input_invalid"
  | "adjudication_input_invalid"
  | "statistics_input_invalid";

/** Stable, non-disclosing error surface for the offline CLI. */
export class HeldOutReviewEvaluationError extends Error {
  readonly code: HeldOutReviewEvaluationErrorCode;

  constructor(code: HeldOutReviewEvaluationErrorCode) {
    super(code);
    this.code = code;
    this.name = "HeldOutReviewEvaluationError";
  }
}

export interface HeldOutSemanticMetricsV1 {
  highSeverityRecall: Wilson95IntervalV1;
  allSeverityRecall: Wilson95IntervalV1;
  findingPrecision: Wilson95IntervalV1;
  falseAccept: Wilson95IntervalV1 & { count: number };
  weightedQuality: number | null;
  weightedQualityReason: "zero_emitted_findings" | null;
  conditionalAcceptedDiagnostics: {
    highSeverityRecall: Wilson95IntervalV1;
    allSeverityRecall: Wilson95IntervalV1;
    findingPrecision: Wilson95IntervalV1;
  };
  rawCounts: {
    emittedFindings: number;
    uniqueMatchedFindings: number;
    duplicateMatchedFindings: number;
    falsePositiveFindings: number;
    matchedHighSeverityGold: number;
    highSeverityGold: number;
    matchedAllSeverityGold: number;
    allSeverityGold: number;
    falseAccepts: number;
    falseAcceptEligibleFixtures: number;
  };
}

export interface HeldOutReviewAggregateV1 {
  schemaVersion: "held-out-review-aggregate-v1";
  protocolVersion: typeof HELD_OUT_REVIEW_PROTOCOL_ID;
  evaluatorVersion: typeof HELD_OUT_EVALUATOR_VERSION;
  setCommitment: string;
  policy: HeldOutRunManifestV1["policy"];
  servedModelFingerprint: string;
  deploymentFingerprint: string;
  configurationFingerprint: string;
  assessmentStatus: HeldOutReviewAssessmentStatusV1;
  semanticStatusReason: HeldOutReviewSemanticReasonV1;
  corpusCounts: {
    assigned: 24;
    clean: 8;
    faulty: 16;
    highSeverityGold: number;
    lowerSeverityGold: number;
  };
  outcomeCounts: HeldOutOperationalStatisticsV1["outcomeCounts"];
  adjudicationSummary: {
    emittedFindingCount: number;
    resolvedFindingCount: number;
    pendingFindingCount: number;
    unverifiedAttestationCount: number;
    validNovelDefectCount: number;
  };
  semanticMetrics: HeldOutSemanticMetricsV1 | null;
  operationalStatistics: HeldOutOperationalStatisticsV1;
  aggregateUsage: {
    inferenceAttemptCount: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    reportedAttempts: number;
    unreportedAttempts: number;
  };
  infrastructureCost: {
    knownAssignmentCount: number;
    unknownAssignmentCount: number;
    totalKnownMicrousd: number;
    totalMicrousd: number | null;
    reason: "unknown_infrastructure_cost" | null;
  };
  nonClaims: readonly string[];
}

const publicSha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const publicSafeInteger = z.number().int().nonnegative().safe();
const publicFiniteNumber = z.number().finite().nonnegative();
const publicNullablePointReason = z
  .enum(["zero_successful_reviews", "unknown_selected_cost"])
  .nullable();

interface PublicRefinementContext {
  addIssue(issue: {
    code: "custom";
    path?: PropertyKey[];
    message: string;
  }): void;
}

function publicIssue(
  context: PublicRefinementContext,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function samePublicValue(left: unknown, right: unknown): boolean {
  return canonicalHeldOutJsonV1(left) === canonicalHeldOutJsonV1(right);
}

const PublicWilson95IntervalV1Schema = z
  .object({
    numerator: publicSafeInteger,
    denominator: publicSafeInteger,
    estimate: z.number().finite().min(0).max(1).nullable(),
    interval: z
      .object({
        method: z.literal("wilson-score-95-v1"),
        confidenceLevel: z.literal(0.95),
        lower: z.number().finite().min(0).max(1),
        upper: z.number().finite().min(0).max(1),
      })
      .strict()
      .nullable(),
    reason: z.literal("zero_denominator").nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    let expected: Wilson95IntervalV1;
    try {
      expected = wilson95IntervalV1(value.numerator, value.denominator);
    } catch {
      publicIssue(
        context,
        [],
        "Wilson numerator and denominator are outside the supported domain.",
      );
      return;
    }
    if (
      !samePublicValue(
        {
          numerator: value.numerator,
          denominator: value.denominator,
          estimate: value.estimate,
          interval: value.interval,
          reason: value.reason,
        },
        expected,
      )
    ) {
      publicIssue(
        context,
        [],
        "Wilson estimate, interval, and reason must match its raw counts.",
      );
    }
  });

const PublicPointEstimateV1Schema = z
  .object({
    value: publicFiniteNumber.nullable(),
    reason: publicNullablePointReason,
  })
  .strict()
  .superRefine((estimate, context) => {
    if ((estimate.value === null) !== (estimate.reason !== null)) {
      publicIssue(
        context,
        [],
        "A point estimate must have exactly one of a numeric value or null reason.",
      );
    }
  });

const PublicBootstrapIntervalV1Schema = z
  .object({
    method: z.literal("mulberry32-percentile-95-v1"),
    confidenceLevel: z.literal(0.95),
    seed: z.number().int().min(0).max(0xffff_ffff).safe(),
    replicateCount: z.number().int().min(1).max(100_000).safe(),
    generatedReplicateCount: publicSafeInteger,
    validReplicateCount: publicSafeInteger,
    zeroSuccessReplicateCount: publicSafeInteger,
    interval: z
      .object({ lower: publicFiniteNumber, upper: publicFiniteNumber })
      .strict()
      .nullable(),
    reason: z
      .enum([
        "zero_successful_reviews",
        "unknown_selected_cost",
        "zero_success_bootstrap_replicate",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((bootstrap, context) => {
    if (
      bootstrap.generatedReplicateCount > bootstrap.replicateCount ||
      bootstrap.validReplicateCount > bootstrap.generatedReplicateCount ||
      bootstrap.zeroSuccessReplicateCount >
        bootstrap.generatedReplicateCount
    ) {
      publicIssue(
        context,
        ["generatedReplicateCount"],
        "Bootstrap diagnostic counts cannot exceed generated or committed replicates.",
      );
    }
    if ((bootstrap.interval === null) !== (bootstrap.reason !== null)) {
      publicIssue(
        context,
        ["interval"],
        "A bootstrap interval must have exactly one of an interval or null reason.",
      );
    }
    if (
      bootstrap.interval !== null &&
      bootstrap.interval.lower > bootstrap.interval.upper
    ) {
      publicIssue(
        context,
        ["interval"],
        "A bootstrap interval lower bound cannot exceed its upper bound.",
      );
    }
  });

const PublicOperationalStatisticsV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-review-operational-statistics-v1"),
    algorithms: z
      .object({
        bootstrap: z.literal("mulberry32-percentile-95-v1"),
        latencyEstimator: z.literal(
          "successful-review-arithmetic-mean-v1",
        ),
        costPerAssignedEstimator: z.literal(
          "all-assignment-arithmetic-mean-v1",
        ),
        costPerSuccessfulEstimator: z.literal(
          "all-assignment-cost-per-success-v1",
        ),
      })
      .strict(),
    seed: z.number().int().min(0).max(0xffff_ffff).safe(),
    replicateCount: z.number().int().min(1).max(100_000).safe(),
    assignedCount: z.literal(24),
    successfulReviewCount: z.number().int().min(0).max(24).safe(),
    validReviewYield: PublicWilson95IntervalV1Schema,
    outcomeCounts: z
      .object({
        accepted: z.number().int().min(0).max(24).safe(),
        invalid: z.number().int().min(0).max(24).safe(),
        blocked: z.number().int().min(0).max(24).safe(),
        cancelled: z.number().int().min(0).max(24).safe(),
        unstarted: z.number().int().min(0).max(24).safe(),
      })
      .strict(),
    latencyMs: z
      .object({
        successfulReviewCount: z.number().int().min(0).max(24).safe(),
        mean: PublicPointEstimateV1Schema,
        bootstrap95: PublicBootstrapIntervalV1Schema,
      })
      .strict(),
    selectedCostMicrousd: z
      .object({
        knownAssignmentCount: z.number().int().min(0).max(24).safe(),
        unknownAssignmentCount: z.number().int().min(0).max(24).safe(),
        totalKnown: publicSafeInteger,
        total: PublicPointEstimateV1Schema,
        perAssigned: PublicPointEstimateV1Schema.safeExtend({
          numeratorKnown: publicSafeInteger,
          denominator: z.literal(24),
        }).strict(),
        perSuccessful: PublicPointEstimateV1Schema.safeExtend({
          numeratorKnown: publicSafeInteger,
          denominator: z.number().int().min(0).max(24).safe(),
        }).strict(),
        perAssignedBootstrap95: PublicBootstrapIntervalV1Schema,
        perSuccessfulBootstrap95: PublicBootstrapIntervalV1Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((statistics, context) => {
    const outcomeTotal = Object.values(statistics.outcomeCounts).reduce(
      (total, count) => total + count,
      0,
    );
    if (outcomeTotal !== statistics.assignedCount) {
      publicIssue(
        context,
        ["outcomeCounts"],
        "Terminal outcome counts must partition all 24 assignments.",
      );
    }
    if (
      statistics.successfulReviewCount !== statistics.outcomeCounts.accepted ||
      statistics.latencyMs.successfulReviewCount !==
        statistics.successfulReviewCount
    ) {
      publicIssue(
        context,
        ["successfulReviewCount"],
        "Successful-review counts must match accepted outcomes.",
      );
    }
    const expectedYield = wilson95IntervalV1(
      statistics.outcomeCounts.accepted,
      statistics.assignedCount,
    );
    if (!samePublicValue(statistics.validReviewYield, expectedYield)) {
      publicIssue(
        context,
        ["validReviewYield"],
        "Valid-review yield must match all assigned outcomes.",
      );
    }

    const bootstrapRecords = [
      ["latencyMs", statistics.latencyMs.bootstrap95],
      [
        "selectedCostMicrousd.perAssignedBootstrap95",
        statistics.selectedCostMicrousd.perAssignedBootstrap95,
      ],
      [
        "selectedCostMicrousd.perSuccessfulBootstrap95",
        statistics.selectedCostMicrousd.perSuccessfulBootstrap95,
      ],
    ] as const;
    for (const [path, bootstrap] of bootstrapRecords) {
      if (
        bootstrap.seed !== statistics.seed ||
        bootstrap.replicateCount !== statistics.replicateCount
      ) {
        publicIssue(
          context,
          path.split("."),
          "Every bootstrap must use the committed statistics seed and replicate count.",
        );
      }
    }

    const latency = statistics.latencyMs;
    if (statistics.successfulReviewCount === 0) {
      if (
        !samePublicValue(latency.mean, {
          value: null,
          reason: "zero_successful_reviews",
        }) ||
        latency.bootstrap95.generatedReplicateCount !== 0 ||
        latency.bootstrap95.validReplicateCount !== 0 ||
        latency.bootstrap95.zeroSuccessReplicateCount !== 0 ||
        latency.bootstrap95.interval !== null ||
        latency.bootstrap95.reason !== "zero_successful_reviews"
      ) {
        publicIssue(
          context,
          ["latencyMs"],
          "Zero successful reviews require null latency estimates and zero bootstrap generation.",
        );
      }
    } else if (
      latency.mean.value === null ||
      latency.mean.reason !== null ||
      latency.bootstrap95.generatedReplicateCount !== statistics.replicateCount ||
      latency.bootstrap95.validReplicateCount !== statistics.replicateCount ||
      latency.bootstrap95.zeroSuccessReplicateCount !== 0 ||
      latency.bootstrap95.interval === null ||
      latency.bootstrap95.reason !== null
    ) {
      publicIssue(
        context,
        ["latencyMs"],
        "Successful reviews require numeric latency estimates and a complete bootstrap.",
      );
    }

    const cost = statistics.selectedCostMicrousd;
    if (
      cost.knownAssignmentCount + cost.unknownAssignmentCount !==
      statistics.assignedCount
    ) {
      publicIssue(
        context,
        ["selectedCostMicrousd"],
        "Known and unknown selected-cost counts must partition all assignments.",
      );
    }
    if (
      cost.perAssigned.numeratorKnown !== cost.totalKnown ||
      cost.perSuccessful.numeratorKnown !== cost.totalKnown ||
      cost.perSuccessful.denominator !== statistics.successfulReviewCount
    ) {
      publicIssue(
        context,
        ["selectedCostMicrousd"],
        "Selected-cost numerators and denominators must share the aggregate raw counts.",
      );
    }

    const noSuccessfulReviews = statistics.successfulReviewCount === 0;
    const hasUnknownCost = cost.unknownAssignmentCount > 0;
    const expectedTotal = hasUnknownCost
      ? { value: null, reason: "unknown_selected_cost" as const }
      : { value: cost.totalKnown, reason: null };
    const expectedPerAssigned = hasUnknownCost
      ? {
          value: null,
          reason: "unknown_selected_cost" as const,
          numeratorKnown: cost.totalKnown,
          denominator: statistics.assignedCount,
        }
      : {
          value: stableNumber(cost.totalKnown / statistics.assignedCount),
          reason: null,
          numeratorKnown: cost.totalKnown,
          denominator: statistics.assignedCount,
        };
    const expectedPerSuccessful = noSuccessfulReviews
      ? {
          value: null,
          reason: "zero_successful_reviews" as const,
          numeratorKnown: cost.totalKnown,
          denominator: 0,
        }
      : hasUnknownCost
        ? {
            value: null,
            reason: "unknown_selected_cost" as const,
            numeratorKnown: cost.totalKnown,
            denominator: statistics.successfulReviewCount,
          }
        : {
            value: stableNumber(
              cost.totalKnown / statistics.successfulReviewCount,
            ),
            reason: null,
            numeratorKnown: cost.totalKnown,
            denominator: statistics.successfulReviewCount,
          };
    if (
      !samePublicValue(cost.total, expectedTotal) ||
      !samePublicValue(cost.perAssigned, expectedPerAssigned) ||
      !samePublicValue(cost.perSuccessful, expectedPerSuccessful)
    ) {
      publicIssue(
        context,
        ["selectedCostMicrousd"],
        "Selected-cost point estimates must be derived from their raw counts.",
      );
    }

    const perAssignedBootstrap = cost.perAssignedBootstrap95;
    const perSuccessfulBootstrap = cost.perSuccessfulBootstrap95;
    if (hasUnknownCost) {
      if (
        perAssignedBootstrap.generatedReplicateCount !== 0 ||
        perAssignedBootstrap.validReplicateCount !== 0 ||
        perAssignedBootstrap.zeroSuccessReplicateCount !== 0 ||
        perAssignedBootstrap.interval !== null ||
        perAssignedBootstrap.reason !== "unknown_selected_cost"
      ) {
        publicIssue(
          context,
          ["selectedCostMicrousd", "perAssignedBootstrap95"],
          "Unknown selected cost requires a non-estimable per-assigned bootstrap.",
        );
      }
    } else if (
      perAssignedBootstrap.generatedReplicateCount !==
        statistics.replicateCount ||
      perAssignedBootstrap.validReplicateCount !== statistics.replicateCount ||
      perAssignedBootstrap.interval === null ||
      perAssignedBootstrap.reason !== null
    ) {
      publicIssue(
        context,
        ["selectedCostMicrousd", "perAssignedBootstrap95"],
        "Known selected cost requires a complete per-assigned bootstrap.",
      );
    }

    if (noSuccessfulReviews) {
      if (
        perSuccessfulBootstrap.generatedReplicateCount !== 0 ||
        perSuccessfulBootstrap.validReplicateCount !== 0 ||
        perSuccessfulBootstrap.zeroSuccessReplicateCount !== 0 ||
        perSuccessfulBootstrap.interval !== null ||
        perSuccessfulBootstrap.reason !== "zero_successful_reviews"
      ) {
        publicIssue(
          context,
          ["selectedCostMicrousd", "perSuccessfulBootstrap95"],
          "Zero successful reviews require a non-estimable cost-per-success bootstrap.",
        );
      }
    } else if (hasUnknownCost) {
      if (
        perSuccessfulBootstrap.generatedReplicateCount !== 0 ||
        perSuccessfulBootstrap.validReplicateCount !== 0 ||
        perSuccessfulBootstrap.zeroSuccessReplicateCount !== 0 ||
        perSuccessfulBootstrap.interval !== null ||
        perSuccessfulBootstrap.reason !== "unknown_selected_cost"
      ) {
        publicIssue(
          context,
          ["selectedCostMicrousd", "perSuccessfulBootstrap95"],
          "Unknown selected cost requires a non-estimable cost-per-success bootstrap.",
        );
      }
    } else {
      const zeroReplicates = perSuccessfulBootstrap.zeroSuccessReplicateCount;
      if (
        perSuccessfulBootstrap.generatedReplicateCount !==
          statistics.replicateCount ||
        perSuccessfulBootstrap.validReplicateCount + zeroReplicates !==
          statistics.replicateCount ||
        perAssignedBootstrap.zeroSuccessReplicateCount !== zeroReplicates ||
        (zeroReplicates === 0
          ? perSuccessfulBootstrap.interval === null ||
            perSuccessfulBootstrap.reason !== null
          : perSuccessfulBootstrap.interval !== null ||
            perSuccessfulBootstrap.reason !==
              "zero_success_bootstrap_replicate")
      ) {
        publicIssue(
          context,
          ["selectedCostMicrousd", "perSuccessfulBootstrap95"],
          "Cost-per-success bootstrap diagnostics must partition every paired replicate.",
        );
      }
    }
  });

const PublicSemanticMetricsV1Schema = z
  .object({
    highSeverityRecall: PublicWilson95IntervalV1Schema,
    allSeverityRecall: PublicWilson95IntervalV1Schema,
    findingPrecision: PublicWilson95IntervalV1Schema,
    falseAccept: PublicWilson95IntervalV1Schema.safeExtend({
      count: publicSafeInteger,
    }).strict(),
    weightedQuality: z.number().finite().min(0).max(1).nullable(),
    weightedQualityReason: z.literal("zero_emitted_findings").nullable(),
    conditionalAcceptedDiagnostics: z
      .object({
        highSeverityRecall: PublicWilson95IntervalV1Schema,
        allSeverityRecall: PublicWilson95IntervalV1Schema,
        findingPrecision: PublicWilson95IntervalV1Schema,
      })
      .strict(),
    rawCounts: z
      .object({
        emittedFindings: publicSafeInteger,
        uniqueMatchedFindings: publicSafeInteger,
        duplicateMatchedFindings: publicSafeInteger,
        falsePositiveFindings: publicSafeInteger,
        matchedHighSeverityGold: publicSafeInteger,
        highSeverityGold: publicSafeInteger,
        matchedAllSeverityGold: publicSafeInteger,
        allSeverityGold: publicSafeInteger,
        falseAccepts: publicSafeInteger,
        falseAcceptEligibleFixtures: z.number().int().min(0).max(24).safe(),
      })
      .strict(),
  })
  .strict();

/** Exact public allowlist; private evaluator structures cannot be added silently. */
export const HeldOutReviewAggregateV1Schema = z
  .object({
    schemaVersion: z.literal("held-out-review-aggregate-v1"),
    protocolVersion: z.literal(HELD_OUT_REVIEW_PROTOCOL_ID),
    evaluatorVersion: z.literal(HELD_OUT_EVALUATOR_VERSION),
    setCommitment: publicSha256,
    policy: z.enum([
      "local_only_v1",
      "cloud_synthesis_all_eval",
      "hybrid_v0",
    ]),
    servedModelFingerprint: publicSha256,
    deploymentFingerprint: publicSha256,
    configurationFingerprint: publicSha256,
    assessmentStatus: z.enum([
      "complete",
      "pending_adjudication",
      "adjudication_attestation_unverified",
      "corpus_correction_required",
    ]),
    semanticStatusReason: z
      .enum([
        "zero_emitted_findings",
        "pending_adjudication",
        "adjudication_attestation_unverified",
        "valid_novel_defect",
      ])
      .nullable(),
    corpusCounts: z
      .object({
        assigned: z.literal(24),
        clean: z.literal(8),
        faulty: z.literal(16),
        highSeverityGold: publicSafeInteger.min(20).max(MAX_FINDINGS),
        lowerSeverityGold: publicSafeInteger.min(8).max(MAX_FINDINGS),
      })
      .strict(),
    outcomeCounts: PublicOperationalStatisticsV1Schema.shape.outcomeCounts,
    adjudicationSummary: z
      .object({
        emittedFindingCount: publicSafeInteger,
        resolvedFindingCount: publicSafeInteger,
        pendingFindingCount: publicSafeInteger,
        unverifiedAttestationCount: publicSafeInteger,
        validNovelDefectCount: publicSafeInteger,
      })
      .strict(),
    semanticMetrics: PublicSemanticMetricsV1Schema.nullable(),
    operationalStatistics: PublicOperationalStatisticsV1Schema,
    aggregateUsage: z
      .object({
        inferenceAttemptCount: publicSafeInteger,
        inputTokens: publicSafeInteger,
        outputTokens: publicSafeInteger,
        reasoningTokens: publicSafeInteger,
        cacheReadTokens: publicSafeInteger,
        reportedAttempts: publicSafeInteger,
        unreportedAttempts: publicSafeInteger,
      })
      .strict()
      .superRefine((usage, context) => {
        if (
          usage.reportedAttempts > usage.inferenceAttemptCount ||
          usage.unreportedAttempts !==
            usage.inferenceAttemptCount - usage.reportedAttempts
        ) {
          context.addIssue({
            code: "custom",
            path: ["unreportedAttempts"],
            message:
              "Reported and unreported attempts must partition inference attempts.",
          });
        }
        if (usage.cacheReadTokens > usage.inputTokens) {
          publicIssue(
            context,
            ["cacheReadTokens"],
            "Aggregate cache-read tokens cannot exceed aggregate input tokens.",
          );
        }
        if (
          usage.reportedAttempts === 0 &&
          (usage.inputTokens !== 0 ||
            usage.outputTokens !== 0 ||
            usage.reasoningTokens !== 0 ||
            usage.cacheReadTokens !== 0)
        ) {
          publicIssue(
            context,
            ["reportedAttempts"],
            "Zero reported attempts require zero aggregate provider tokens.",
          );
        }
        if (usage.reportedAttempts > 0 && usage.inputTokens === 0) {
          publicIssue(
            context,
            ["inputTokens"],
            "Reported attempts require positive aggregate input tokens.",
          );
        }
      }),
    infrastructureCost: z
      .object({
        knownAssignmentCount: z.number().int().min(0).max(24).safe(),
        unknownAssignmentCount: z.number().int().min(0).max(24).safe(),
        totalKnownMicrousd: publicSafeInteger,
        totalMicrousd: publicSafeInteger.nullable(),
        reason: z.literal("unknown_infrastructure_cost").nullable(),
      })
      .strict(),
    nonClaims: z.array(z.string().trim().min(1).max(512)).length(5),
  })
  .strict()
  .superRefine((aggregate, context) => {
    if (
      !samePublicValue(
        aggregate.outcomeCounts,
        aggregate.operationalStatistics.outcomeCounts,
      )
    ) {
      publicIssue(
        context,
        ["outcomeCounts"],
        "Top-level and operational outcome counts must be identical.",
      );
    }
    if (
      aggregate.corpusCounts.highSeverityGold +
        aggregate.corpusCounts.lowerSeverityGold >
      aggregate.corpusCounts.faulty * 64
    ) {
      publicIssue(
        context,
        ["corpusCounts"],
        "Aggregate gold count cannot exceed 64 defects per faulty fixture.",
      );
    }

    const usage = aggregate.aggregateUsage;
    const acceptedCount = aggregate.outcomeCounts.accepted;
    if (
      acceptedCount > usage.inferenceAttemptCount ||
      acceptedCount > usage.reportedAttempts ||
      acceptedCount > usage.inputTokens ||
      acceptedCount > usage.outputTokens
    ) {
      publicIssue(
        context,
        ["aggregateUsage"],
        "Accepted outcomes require sufficient aggregate inference, reported usage, and input/output token totals.",
      );
    }
    const selectedCost =
      aggregate.operationalStatistics.selectedCostMicrousd;
    if (
      usage.inferenceAttemptCount === 0 &&
      (selectedCost.knownAssignmentCount !== aggregate.corpusCounts.assigned ||
        selectedCost.unknownAssignmentCount !== 0 ||
        selectedCost.totalKnown !== 0)
    ) {
      publicIssue(
        context,
        ["operationalStatistics", "selectedCostMicrousd"],
        "Zero aggregate inference attempts require known zero selected cost for every assignment.",
      );
    }
    if (
      selectedCost.unknownAssignmentCount >
        aggregate.corpusCounts.assigned - aggregate.outcomeCounts.unstarted ||
      selectedCost.unknownAssignmentCount > usage.inferenceAttemptCount
    ) {
      publicIssue(
        context,
        ["operationalStatistics", "selectedCostMicrousd"],
        "Unknown selected-cost assignments require dispatched, non-unstarted assignments.",
      );
    }

    const adjudication = aggregate.adjudicationSummary;
    if (
      adjudication.emittedFindingCount >
      aggregate.outcomeCounts.accepted * 64
    ) {
      publicIssue(
        context,
        ["adjudicationSummary", "emittedFindingCount"],
        "Emitted findings cannot exceed 64 findings per accepted result.",
      );
    }
    if (
      adjudication.resolvedFindingCount +
        adjudication.pendingFindingCount +
        adjudication.unverifiedAttestationCount !==
      adjudication.emittedFindingCount
    ) {
      publicIssue(
        context,
        ["adjudicationSummary"],
        "Resolved, pending, and unverified findings must partition emitted findings.",
      );
    }
    if (
      adjudication.validNovelDefectCount > adjudication.resolvedFindingCount
    ) {
      publicIssue(
        context,
        ["adjudicationSummary", "validNovelDefectCount"],
        "Valid novel defects must be a subset of resolved findings.",
      );
    }

    let expectedStatus: HeldOutReviewAssessmentStatusV1 = "complete";
    let expectedReason: HeldOutReviewSemanticReasonV1 =
      adjudication.emittedFindingCount === 0
        ? "zero_emitted_findings"
        : null;
    if (adjudication.validNovelDefectCount > 0) {
      expectedStatus = "corpus_correction_required";
      expectedReason = "valid_novel_defect";
    } else if (adjudication.unverifiedAttestationCount > 0) {
      expectedStatus = "adjudication_attestation_unverified";
      expectedReason = "adjudication_attestation_unverified";
    } else if (adjudication.pendingFindingCount > 0) {
      expectedStatus = "pending_adjudication";
      expectedReason = "pending_adjudication";
    }
    if (
      aggregate.assessmentStatus !== expectedStatus ||
      aggregate.semanticStatusReason !== expectedReason ||
      (expectedStatus === "complete") !==
        (aggregate.semanticMetrics !== null)
    ) {
      publicIssue(
        context,
        ["assessmentStatus"],
        "Assessment status, semantic reason, and metric availability must follow adjudication state.",
      );
    }

    const metrics = aggregate.semanticMetrics;
    if (metrics !== null) {
      const raw = metrics.rawCounts;
      const allSeverityGold =
        aggregate.corpusCounts.highSeverityGold +
        aggregate.corpusCounts.lowerSeverityGold;
      if (
        raw.emittedFindings !== adjudication.emittedFindingCount ||
        raw.highSeverityGold !== aggregate.corpusCounts.highSeverityGold ||
        raw.allSeverityGold !== allSeverityGold ||
        raw.uniqueMatchedFindings !== raw.matchedAllSeverityGold ||
        raw.matchedHighSeverityGold > raw.matchedAllSeverityGold ||
        raw.falsePositiveFindings !==
          raw.emittedFindings - raw.uniqueMatchedFindings ||
        raw.duplicateMatchedFindings > raw.falsePositiveFindings ||
        raw.falseAcceptEligibleFixtures > aggregate.corpusCounts.faulty
      ) {
        publicIssue(
          context,
          ["semanticMetrics", "rawCounts"],
          "Semantic raw counts must match corpus, adjudication, and finding partitions.",
        );
      }
      if (
        metrics.highSeverityRecall.numerator !==
          raw.matchedHighSeverityGold ||
        metrics.highSeverityRecall.denominator !== raw.highSeverityGold ||
        metrics.allSeverityRecall.numerator !== raw.matchedAllSeverityGold ||
        metrics.allSeverityRecall.denominator !== raw.allSeverityGold ||
        metrics.findingPrecision.numerator !== raw.uniqueMatchedFindings ||
        metrics.findingPrecision.denominator !== raw.emittedFindings ||
        metrics.falseAccept.numerator !== raw.falseAccepts ||
        metrics.falseAccept.count !== raw.falseAccepts ||
        metrics.falseAccept.denominator !==
          raw.falseAcceptEligibleFixtures
      ) {
        publicIssue(
          context,
          ["semanticMetrics"],
          "Semantic Wilson counts must bind the published raw counts.",
        );
      }
      if (
        raw.falseAcceptEligibleFixtures <
          Math.ceil(raw.highSeverityGold / 64) ||
        raw.falseAccepts > acceptedCount ||
        raw.falseAccepts >
          raw.highSeverityGold - raw.matchedHighSeverityGold
      ) {
        publicIssue(
          context,
          ["semanticMetrics", "rawCounts", "falseAccepts"],
          "False-accept counts require a feasible high-severity fixture population and unmatched gold.",
        );
      }

      const conditional = metrics.conditionalAcceptedDiagnostics;
      if (
        conditional.highSeverityRecall.numerator !==
          metrics.highSeverityRecall.numerator ||
        conditional.highSeverityRecall.denominator >
          metrics.highSeverityRecall.denominator ||
        conditional.allSeverityRecall.numerator !==
          metrics.allSeverityRecall.numerator ||
        conditional.allSeverityRecall.denominator >
          metrics.allSeverityRecall.denominator ||
        !samePublicValue(
          conditional.findingPrecision,
          metrics.findingPrecision,
        )
      ) {
        publicIssue(
          context,
          ["semanticMetrics", "conditionalAcceptedDiagnostics"],
          "Conditional diagnostics must retain matched numerators and bounded denominators.",
        );
      }

      const zeroFindings = raw.emittedFindings === 0;
      const expectedWeightedQuality = zeroFindings
        ? null
        : stableNumber(
            0.5 * metrics.highSeverityRecall.estimate! +
              0.3 * metrics.allSeverityRecall.estimate! +
              0.2 * metrics.findingPrecision.estimate!,
          );
      if (
        metrics.weightedQuality !== expectedWeightedQuality ||
        metrics.weightedQualityReason !==
          (zeroFindings ? "zero_emitted_findings" : null)
      ) {
        publicIssue(
          context,
          ["semanticMetrics", "weightedQuality"],
          "Weighted quality and its null reason must match the component estimates.",
        );
      }
    }

    const infrastructure = aggregate.infrastructureCost;
    const hasUnknownInfrastructure =
      infrastructure.unknownAssignmentCount > 0;
    if (
      infrastructure.knownAssignmentCount +
        infrastructure.unknownAssignmentCount !==
        aggregate.corpusCounts.assigned ||
      (hasUnknownInfrastructure
        ? infrastructure.totalMicrousd !== null ||
          infrastructure.reason !== "unknown_infrastructure_cost"
        : infrastructure.totalMicrousd !==
            infrastructure.totalKnownMicrousd ||
          infrastructure.reason !== null)
    ) {
      publicIssue(
        context,
        ["infrastructureCost"],
        "Infrastructure-cost counts, total, and null reason must be consistent.",
      );
    }

    if (!samePublicValue(aggregate.nonClaims, HELD_OUT_REVIEW_NON_CLAIMS_V1)) {
      publicIssue(
        context,
        ["nonClaims"],
        "The fixed public non-claims cannot be removed or rewritten.",
      );
    }
  });

export interface EvaluateHeldOutReviewV1Input {
  runner: unknown;
  oracle: unknown;
  commitmentMaterial: unknown;
  manifest: unknown;
  runResults: unknown;
  privateFindings: readonly unknown[];
  adjudicationPackets: readonly unknown[];
  judgments: readonly unknown[];
  coordinatorAttestations: readonly unknown[];
  resolutions: readonly unknown[];
  coordinatorPublicKey: KeyObject;
}

interface ResolvedFinding {
  ordinal: number;
  findingId: string;
  disposition: HeldOutFindingDispositionV1;
}

function evaluationError(
  code: HeldOutReviewEvaluationErrorCode,
): HeldOutReviewEvaluationError {
  return new HeldOutReviewEvaluationError(code);
}

function stableNumber(value: number): number {
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeSum(values: readonly number[], code: HeldOutReviewEvaluationErrorCode) {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw evaluationError(code);
  }
  return total;
}

function arrayInput(
  value: readonly unknown[],
  maximum: number,
  code: HeldOutReviewEvaluationErrorCode,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw evaluationError(code);
  }
  return value;
}

function fingerprint(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(Uint8Array.of(0))
    .update(canonicalHeldOutJsonV1(value), "utf8")
    .digest("hex");
}

function bindingKey(ordinal: number, findingId: string): string {
  return `${ordinal}:${findingId}`;
}

function regionsOverlap(
  left: HeldOutEvidenceRegionV1,
  right: HeldOutEvidenceRegionV1,
): boolean {
  if (left.kind !== right.kind || left.path !== right.path) return false;
  if (left.kind === "change_metadata" || right.kind === "change_metadata") {
    return (
      left.kind === "change_metadata" &&
      right.kind === "change_metadata" &&
      left.changeKind === right.changeKind
    );
  }
  return (
    left.side === right.side &&
    left.hunkSha256 === right.hunkSha256 &&
    left.startLine <= right.endLine &&
    right.startLine <= left.endLine
  );
}

function expectedCandidates(
  finding: HeldOutPrivateFindingV1,
  oracleEntry: HeldOutOracleEntryV1,
) {
  if (oracleEntry.fixtureClass === "clean") return [];
  return oracleEntry.goldDefects
    .flatMap((gold) => {
      const overlappingRegions = finding.evidenceRegions.filter((region) =>
        gold.evidenceRegions.some((goldRegion) =>
          regionsOverlap(region, goldRegion),
        ),
      );
      return overlappingRegions.length === 0
        ? []
        : [
            {
              goldDefectId: gold.goldDefectId,
              severity: gold.severity,
              semanticRubric: gold.semanticRubric,
              overlappingRegions,
            },
          ];
    })
    .sort((left, right) => compareText(left.goldDefectId, right.goldDefectId));
}

function exactPacket(
  packet: HeldOutAdjudicationPacketV1,
  privateFinding: HeldOutPrivateFindingV1,
  oracleEntry: HeldOutOracleEntryV1,
  setCommitment: string,
  manifestFingerprint: string,
): boolean {
  return (
    packet.setCommitment === setCommitment &&
    packet.runManifestSha256 === manifestFingerprint &&
    canonicalHeldOutJsonV1(packet.finding) ===
      canonicalHeldOutJsonV1(privateFinding) &&
    canonicalHeldOutJsonV1(packet.candidateGold) ===
      canonicalHeldOutJsonV1(expectedCandidates(privateFinding, oracleEntry))
  );
}

function sameDisposition(
  left: HeldOutFindingDispositionV1,
  right: HeldOutFindingDispositionV1,
): boolean {
  return canonicalHeldOutJsonV1(left) === canonicalHeldOutJsonV1(right);
}

function statusReason(
  status: HeldOutReviewAssessmentStatusV1,
  emittedFindingCount: number,
): HeldOutReviewSemanticReasonV1 {
  if (status === "pending_adjudication") return "pending_adjudication";
  if (status === "adjudication_attestation_unverified") {
    return "adjudication_attestation_unverified";
  }
  if (status === "corpus_correction_required") {
    return "valid_novel_defect";
  }
  return emittedFindingCount === 0 ? "zero_emitted_findings" : null;
}

function goldKey(ordinal: number, goldDefectId: string): string {
  return `${ordinal}:${goldDefectId}`;
}

function goldRecords(entries: readonly HeldOutOracleEntryV1[]) {
  return entries.flatMap((entry) =>
    entry.goldDefects.map((gold) => ({ ordinal: entry.ordinal, gold })),
  );
}

function semanticMetrics(
  entries: readonly HeldOutOracleEntryV1[],
  runResults: readonly HeldOutRunResultV1[],
  resolved: readonly ResolvedFinding[],
): HeldOutSemanticMetricsV1 {
  const allGold = goldRecords(entries);
  const highGold = allGold.filter(
    ({ gold }) => gold.severity === "P0" || gold.severity === "P1",
  );
  const matchedGold = new Set<string>();
  let duplicateMatchedFindings = 0;
  let directFalsePositives = 0;

  for (const finding of resolved) {
    if (finding.disposition.kind === "false_positive") {
      directFalsePositives += 1;
      continue;
    }
    if (finding.disposition.kind === "matched_gold") {
      const key = goldKey(finding.ordinal, finding.disposition.goldDefectId);
      if (matchedGold.has(key)) duplicateMatchedFindings += 1;
      else matchedGold.add(key);
    }
  }

  const matchedHighSeverityGold = highGold.filter(({ ordinal, gold }) =>
    matchedGold.has(goldKey(ordinal, gold.goldDefectId)),
  ).length;
  const matchedAllSeverityGold = allGold.filter(({ ordinal, gold }) =>
    matchedGold.has(goldKey(ordinal, gold.goldDefectId)),
  ).length;
  const highSeverityRecall = wilson95IntervalV1(
    matchedHighSeverityGold,
    highGold.length,
  );
  const allSeverityRecall = wilson95IntervalV1(
    matchedAllSeverityGold,
    allGold.length,
  );
  const findingPrecision = wilson95IntervalV1(
    matchedGold.size,
    resolved.length,
  );

  let falseAccepts = 0;
  let falseAcceptEligibleFixtures = 0;
  entries.forEach((entry, index) => {
    const high = entry.goldDefects.filter(
      (gold) => gold.severity === "P0" || gold.severity === "P1",
    );
    if (high.length === 0) return;
    falseAcceptEligibleFixtures += 1;
    const result = runResults[index];
    if (
      result?.outcome === "accepted" &&
      result.conclusion === "no_blocking_findings" &&
      high.some(
        (gold) => !matchedGold.has(goldKey(entry.ordinal, gold.goldDefectId)),
      )
    ) {
      falseAccepts += 1;
    }
  });
  const falseAccept = {
    ...wilson95IntervalV1(falseAccepts, falseAcceptEligibleFixtures),
    count: falseAccepts,
  };

  const acceptedOrdinals = new Set(
    runResults
      .filter((result) => result.outcome === "accepted")
      .map((result) => result.ordinal),
  );
  const acceptedGold = allGold.filter(({ ordinal }) =>
    acceptedOrdinals.has(ordinal),
  );
  const acceptedHighGold = acceptedGold.filter(
    ({ gold }) => gold.severity === "P0" || gold.severity === "P1",
  );
  const acceptedMatched = acceptedGold.filter(({ ordinal, gold }) =>
    matchedGold.has(goldKey(ordinal, gold.goldDefectId)),
  );
  const acceptedMatchedHigh = acceptedHighGold.filter(({ ordinal, gold }) =>
    matchedGold.has(goldKey(ordinal, gold.goldDefectId)),
  );

  const weightedQuality =
    findingPrecision.estimate === null ||
    highSeverityRecall.estimate === null ||
    allSeverityRecall.estimate === null
      ? null
      : stableNumber(
          0.5 * highSeverityRecall.estimate +
            0.3 * allSeverityRecall.estimate +
            0.2 * findingPrecision.estimate,
        );
  const falsePositiveFindings =
    directFalsePositives + duplicateMatchedFindings;

  return {
    highSeverityRecall,
    allSeverityRecall,
    findingPrecision,
    falseAccept,
    weightedQuality,
    weightedQualityReason:
      findingPrecision.estimate === null ? "zero_emitted_findings" : null,
    conditionalAcceptedDiagnostics: {
      highSeverityRecall: wilson95IntervalV1(
        acceptedMatchedHigh.length,
        acceptedHighGold.length,
      ),
      allSeverityRecall: wilson95IntervalV1(
        acceptedMatched.length,
        acceptedGold.length,
      ),
      findingPrecision,
    },
    rawCounts: {
      emittedFindings: resolved.length,
      uniqueMatchedFindings: matchedGold.size,
      duplicateMatchedFindings,
      falsePositiveFindings,
      matchedHighSeverityGold,
      highSeverityGold: highGold.length,
      matchedAllSeverityGold,
      allSeverityGold: allGold.length,
      falseAccepts,
      falseAcceptEligibleFixtures,
    },
  };
}

function aggregateUsage(results: readonly HeldOutRunResultV1[]) {
  const usage = results.map((result) => result.telemetry.usage);
  return {
    inferenceAttemptCount: safeSum(
      results.map((result) => result.telemetry.inferenceAttemptCount),
      "run_input_invalid",
    ),
    inputTokens: safeSum(
      usage.map((record) => record.inputTokens),
      "run_input_invalid",
    ),
    outputTokens: safeSum(
      usage.map((record) => record.outputTokens),
      "run_input_invalid",
    ),
    reasoningTokens: safeSum(
      usage.map((record) => record.reasoningTokens),
      "run_input_invalid",
    ),
    cacheReadTokens: safeSum(
      usage.map((record) => record.cacheReadTokens),
      "run_input_invalid",
    ),
    reportedAttempts: safeSum(
      usage.map((record) => record.reportedAttempts),
      "run_input_invalid",
    ),
    unreportedAttempts: safeSum(
      results.map(
        (result) =>
          result.telemetry.inferenceAttemptCount -
          result.telemetry.usage.reportedAttempts,
      ),
      "run_input_invalid",
    ),
  };
}

function infrastructureCost(results: readonly HeldOutRunResultV1[]) {
  const values = results.map(
    (result) => result.telemetry.infrastructureCostMicrousd,
  );
  const known = values.filter((value): value is number => value !== null);
  const totalKnownMicrousd = safeSum(known, "run_input_invalid");
  const unknownAssignmentCount = values.length - known.length;
  return {
    knownAssignmentCount: known.length,
    unknownAssignmentCount,
    totalKnownMicrousd,
    totalMicrousd: unknownAssignmentCount === 0 ? totalKnownMicrousd : null,
    reason:
      unknownAssignmentCount === 0
        ? null
        : ("unknown_infrastructure_cost" as const),
  };
}

/**
 * Offline only. This module has no provider, runtime, network, filesystem, or
 * subprocess dependency; the CLI supplies already-read private records.
 */
export function evaluateHeldOutReviewV1(
  input: EvaluateHeldOutReviewV1Input,
): HeldOutReviewAggregateV1 {
  let corpus: ReturnType<typeof validateHeldOutCorpusV1>;
  try {
    corpus = validateHeldOutCorpusV1({
      runner: input.runner,
      oracle: input.oracle,
      commitmentMaterial: input.commitmentMaterial,
    });
  } catch {
    throw evaluationError("corpus_input_invalid");
  }

  let manifest: HeldOutRunManifestV1;
  let runResults: ReturnType<typeof validateHeldOutRunResultsV1>;
  try {
    manifest = HeldOutRunManifestV1Schema.parse(input.manifest);
    runResults = validateHeldOutRunResultsV1({
      runner: corpus.runner,
      manifest,
      runManifestSha256: computeHeldOutRunManifestSha256V1(manifest),
      runResults: input.runResults,
    });
  } catch {
    throw evaluationError("run_input_invalid");
  }

  let privateFindings: HeldOutPrivateFindingV1[];
  try {
    const bounded = arrayInput(
      input.privateFindings,
      MAX_FINDINGS,
      "finding_input_invalid",
    );
    privateFindings = validateHeldOutPrivateFindingBindingsV1({
      runResults,
      privateFindings: bounded,
    }).privateFindings;
  } catch (error) {
    if (error instanceof HeldOutReviewEvaluationError) throw error;
    throw evaluationError("finding_input_invalid");
  }

  const manifestFingerprint = computeHeldOutRunManifestSha256V1(manifest);
  const packetByBinding = new Map<string, HeldOutAdjudicationPacketV1>();
  try {
    for (const inputPacket of arrayInput(
      input.adjudicationPackets,
      MAX_FINDINGS,
      "adjudication_input_invalid",
    )) {
      const packet = HeldOutAdjudicationPacketV1Schema.parse(inputPacket);
      const key = bindingKey(packet.finding.ordinal, packet.finding.findingId);
      if (packetByBinding.has(key)) throw new TypeError();
      packetByBinding.set(key, packet);
    }
  } catch (error) {
    if (error instanceof HeldOutReviewEvaluationError) throw error;
    throw evaluationError("adjudication_input_invalid");
  }

  const packets: HeldOutAdjudicationPacketV1[] = [];
  let missingPacketCount = 0;
  for (const finding of privateFindings) {
    const key = bindingKey(finding.ordinal, finding.findingId);
    const packet = packetByBinding.get(key);
    if (!packet) {
      missingPacketCount += 1;
      continue;
    }
    const oracleEntry = corpus.oracle.entries[finding.ordinal - 1];
    if (
      !oracleEntry ||
      oracleEntry.fixtureCommitment !== finding.fixtureCommitment ||
      !exactPacket(
        packet,
        finding,
        oracleEntry,
        corpus.runner.setCommitment,
        manifestFingerprint,
      )
    ) {
      throw evaluationError("adjudication_input_invalid");
    }
    packets.push(packet);
    packetByBinding.delete(key);
  }
  if (packetByBinding.size !== 0) {
    throw evaluationError("adjudication_input_invalid");
  }

  const judgmentByPacket = new Map<string, HeldOutAdjudicatorJudgmentV1[]>();
  const attestationByHash = new Map<string, HeldOutCoordinatorAttestationV1>();
  const resolutionByPacket = new Map<string, HeldOutAdjudicationResolutionV1>();
  try {
    for (const inputJudgment of arrayInput(
      input.judgments,
      MAX_JUDGMENTS,
      "adjudication_input_invalid",
    )) {
      const judgment = HeldOutAdjudicatorJudgmentV1Schema.parse(inputJudgment);
      const records = judgmentByPacket.get(judgment.packetSha256) ?? [];
      if (records.some((record) => record.studyId === judgment.studyId)) {
        throw new TypeError();
      }
      records.push(judgment);
      judgmentByPacket.set(judgment.packetSha256, records);
    }
    for (const inputAttestation of arrayInput(
      input.coordinatorAttestations,
      MAX_JUDGMENTS,
      "adjudication_input_invalid",
    )) {
      const attestation =
        HeldOutCoordinatorAttestationV1Schema.parse(inputAttestation);
      const hash = computeHeldOutCoordinatorAttestationSha256V1(attestation);
      if (attestationByHash.has(hash)) throw new TypeError();
      attestationByHash.set(hash, attestation);
    }
    for (const inputResolution of arrayInput(
      input.resolutions,
      MAX_FINDINGS,
      "adjudication_input_invalid",
    )) {
      const resolution =
        HeldOutAdjudicationResolutionV1Schema.parse(inputResolution);
      if (resolutionByPacket.has(resolution.packetSha256)) throw new TypeError();
      resolutionByPacket.set(resolution.packetSha256, resolution);
    }
  } catch (error) {
    if (error instanceof HeldOutReviewEvaluationError) throw error;
    throw evaluationError("adjudication_input_invalid");
  }

  let trustAnchorMatches = true;
  try {
    trustAnchorMatches =
      coordinatorVerificationKeyFingerprintV1(input.coordinatorPublicKey) ===
      manifest.coordinator.verificationKeyFingerprint;
  } catch {
    trustAnchorMatches = false;
  }
  if (!trustAnchorMatches) {
    throw evaluationError("adjudication_input_invalid");
  }

  const resolved: ResolvedFinding[] = [];
  const usedAttestationHashes = new Set<string>();
  const usedResolutionPackets = new Set<string>();
  const knownPacketHashes = new Set(
    packets.map(computeHeldOutAdjudicationPacketSha256V1),
  );
  let pendingFindingCount = missingPacketCount;
  let unverifiedAttestationCount = 0;
  let validNovelDefectCount = 0;

  for (const packet of packets) {
    const packetHash = computeHeldOutAdjudicationPacketSha256V1(packet);
    const judgments = judgmentByPacket.get(packetHash) ?? [];
    if (judgments.length < 2) {
      pendingFindingCount += 1;
      continue;
    }
    if (judgments.length > 2) {
      throw evaluationError("adjudication_input_invalid");
    }
    const attestations = judgments.map((judgment) =>
      attestationByHash.get(judgment.coordinatorAttestationSha256),
    );
    if (!attestations[0] || !attestations[1]) {
      pendingFindingCount += 1;
      continue;
    }
    const disagrees = !sameDisposition(
      judgments[0]!.disposition,
      judgments[1]!.disposition,
    );
    const resolution = resolutionByPacket.get(packetHash);
    if (disagrees && !resolution) {
      pendingFindingCount += 1;
      continue;
    }
    try {
      const validated = validateHeldOutAdjudicationPairV1({
        packet,
        judgments: [judgments[0], judgments[1]],
        attestations: [attestations[0], attestations[1]],
        manifest,
        coordinatorPublicKey: input.coordinatorPublicKey,
        ...(resolution ? { resolution } : {}),
      });
      usedAttestationHashes.add(judgments[0]!.coordinatorAttestationSha256);
      usedAttestationHashes.add(judgments[1]!.coordinatorAttestationSha256);
      if (resolution) usedResolutionPackets.add(packetHash);
      resolved.push({
        ordinal: packet.finding.ordinal,
        findingId: packet.finding.findingId,
        disposition: validated.finalDisposition,
      });
      if (validated.finalDisposition.kind === "valid_novel_defect") {
        validNovelDefectCount += 1;
      }
    } catch {
      unverifiedAttestationCount += 1;
    }
  }

  for (const packetHash of judgmentByPacket.keys()) {
    if (!knownPacketHashes.has(packetHash)) {
      throw evaluationError("adjudication_input_invalid");
    }
  }
  if (
    usedAttestationHashes.size !== attestationByHash.size ||
    usedResolutionPackets.size !== resolutionByPacket.size
  ) {
    const hasOnlyCurrentlyPendingReferences =
      [...attestationByHash.keys()].every((hash) =>
        [...judgmentByPacket.values()].some((records) =>
          records.some((record) => record.coordinatorAttestationSha256 === hash),
        ),
      ) &&
      [...resolutionByPacket.keys()].every((hash) => knownPacketHashes.has(hash));
    if (!hasOnlyCurrentlyPendingReferences) {
      throw evaluationError("adjudication_input_invalid");
    }
  }

  let assessmentStatus: HeldOutReviewAssessmentStatusV1 = "complete";
  if (validNovelDefectCount > 0) {
    assessmentStatus = "corpus_correction_required";
  } else if (unverifiedAttestationCount > 0) {
    assessmentStatus = "adjudication_attestation_unverified";
  } else if (pendingFindingCount > 0) {
    assessmentStatus = "pending_adjudication";
  }

  let operationalStatistics: HeldOutOperationalStatisticsV1;
  try {
    const rows: HeldOutStatisticsRowV1[] = runResults.results.map((result) => ({
      ordinal: result.ordinal,
      outcome: result.outcome,
      latencyMs: result.telemetry.endToEndLatencyMs,
      selectedCostMicrousd: result.telemetry.selectedTokenCostMicrousd,
    }));
    operationalStatistics = computeHeldOutOperationalStatisticsV1({
      rows,
      replicateCount: manifest.statistics.bootstrapReplicateCount,
      seed: manifest.statistics.bootstrapSeedUint32,
    });
  } catch {
    throw evaluationError("statistics_input_invalid");
  }

  const metrics =
    assessmentStatus === "complete"
      ? semanticMetrics(corpus.oracle.entries, runResults.results, resolved)
      : null;
  const semanticStatusReason = statusReason(
    assessmentStatus,
    privateFindings.length,
  );

  return Object.freeze(HeldOutReviewAggregateV1Schema.parse({
    schemaVersion: "held-out-review-aggregate-v1" as const,
    protocolVersion: HELD_OUT_REVIEW_PROTOCOL_ID,
    evaluatorVersion: HELD_OUT_EVALUATOR_VERSION,
    setCommitment: corpus.runner.setCommitment,
    policy: manifest.policy,
    servedModelFingerprint: fingerprint(
      "soar-heldout-served-model-v1",
      manifest.providerIdentity.servedModel,
    ),
    deploymentFingerprint: manifest.deploymentFingerprint,
    configurationFingerprint: manifest.configurationFingerprint,
    assessmentStatus,
    semanticStatusReason,
    corpusCounts: {
      assigned: corpus.counts.fixtures,
      clean: corpus.counts.clean,
      faulty: corpus.counts.faulty,
      highSeverityGold: corpus.counts.p0p1Defects,
      lowerSeverityGold: corpus.counts.p2p3Defects,
    },
    outcomeCounts: operationalStatistics.outcomeCounts,
    adjudicationSummary: {
      emittedFindingCount: privateFindings.length,
      resolvedFindingCount: resolved.length,
      pendingFindingCount,
      unverifiedAttestationCount,
      validNovelDefectCount,
    },
    semanticMetrics: metrics,
    operationalStatistics,
    aggregateUsage: aggregateUsage(runResults.results),
    infrastructureCost: infrastructureCost(runResults.results),
    nonClaims: HELD_OUT_REVIEW_NON_CLAIMS_V1,
  }));
}
