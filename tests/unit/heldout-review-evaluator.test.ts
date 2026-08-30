import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalHeldOutJsonV1 } from "../../src/shared/heldout-review-runner-contracts";
import {
  HeldOutAdjudicationResolutionV1Schema,
  computeHeldOutCoordinatorAttestationSha256V1,
} from "../../src/benchmark/heldout-review-evaluator-contracts";
import {
  HeldOutReviewAggregateV1Schema,
  HeldOutReviewEvaluationError,
  evaluateHeldOutReviewV1,
  type EvaluateHeldOutReviewV1Input,
  type HeldOutReviewAggregateV1,
} from "../../src/benchmark/heldout-review-evaluator";
import { wilson95IntervalV1 } from "../../src/benchmark/heldout-review-statistics";
import {
  buildSyntheticHeldOutReviewScenarioV1,
  syntheticHeldOutDigestV1,
  type SyntheticHeldOutReviewScenarioV1,
} from "../helpers/heldout-review-synthetic";

function completeSyntheticScenario(): SyntheticHeldOutReviewScenarioV1 {
  return buildSyntheticHeldOutReviewScenarioV1({
    runSpecs: [
      ...Array.from({ length: 9 }, (_, index) => ({
        ordinal: index + 1,
        outcome: "accepted" as const,
      })),
      { ordinal: 10, outcome: "invalid" },
      { ordinal: 11, outcome: "blocked" },
      { ordinal: 12, outcome: "cancelled" },
    ],
    findingSpecs: [
      {
        ordinal: 1,
        findingId: "synthetic-clean-false-positive",
        adjudicatorDispositions: ["false_positive", "false_positive"],
      },
      {
        ordinal: 9,
        findingId: "synthetic-faulty-match",
        evidenceGoldIndex: 0,
        adjudicatorDispositions: ["matched_gold", "matched_gold"],
      },
    ],
  });
}

function evaluateWith(
  scenario: SyntheticHeldOutReviewScenarioV1,
  overrides: Partial<EvaluateHeldOutReviewV1Input> = {},
) {
  return evaluateHeldOutReviewV1({ ...scenario.input, ...overrides });
}

function expectEvaluationError(
  run: () => unknown,
  code: HeldOutReviewEvaluationError["code"],
): void {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(HeldOutReviewEvaluationError);
  expect((error as HeldOutReviewEvaluationError).code).toBe(code);
  expect((error as Error).message).toBe(code);
}

describe("held-out review pure evaluator", () => {
  it("scores a complete 24-case assignment with conservative all-assigned denominators and byte-stable output", () => {
    const scenario = completeSyntheticScenario();
    const aggregate = evaluateWith(scenario);
    const repeated = evaluateWith(scenario);

    expect(aggregate.assessmentStatus).toBe("complete");
    expect(aggregate.semanticStatusReason).toBeNull();
    expect(aggregate.corpusCounts).toEqual({
      assigned: 24,
      clean: 8,
      faulty: 16,
      highSeverityGold: 20,
      lowerSeverityGold: 8,
    });
    expect(aggregate.outcomeCounts).toEqual({
      accepted: 9,
      invalid: 1,
      blocked: 1,
      cancelled: 1,
      unstarted: 12,
    });
    expect(aggregate.operationalStatistics.successfulReviewCount).toBe(9);
    expect(aggregate.operationalStatistics.validReviewYield).toEqual(
      expect.objectContaining({
        numerator: 9,
        denominator: 24,
        estimate: 0.375,
        reason: null,
      }),
    );
    expect(aggregate.aggregateUsage).toMatchObject({
      inferenceAttemptCount: 12,
      reportedAttempts: 12,
      unreportedAttempts: 0,
    });
    expect(aggregate.adjudicationSummary).toMatchObject({
      emittedFindingCount: 2,
      resolvedFindingCount: 2,
      pendingFindingCount: 0,
      unverifiedAttestationCount: 0,
      validNovelDefectCount: 0,
    });

    const metrics = aggregate.semanticMetrics;
    expect(metrics).not.toBeNull();
    expect(metrics?.highSeverityRecall).toMatchObject({
      numerator: 1,
      denominator: 20,
      estimate: 0.05,
      reason: null,
    });
    expect(metrics?.allSeverityRecall).toMatchObject({
      numerator: 1,
      denominator: 28,
      estimate: 0.035714285714,
      reason: null,
    });
    expect(metrics?.findingPrecision).toMatchObject({
      numerator: 1,
      denominator: 2,
      estimate: 0.5,
      reason: null,
    });
    expect(metrics?.falseAccept).toMatchObject({
      numerator: 0,
      denominator: 16,
      estimate: 0,
      count: 0,
    });
    expect(metrics?.weightedQuality).toBe(0.135714285714);
    expect(metrics?.rawCounts).toEqual({
      emittedFindings: 2,
      uniqueMatchedFindings: 1,
      duplicateMatchedFindings: 0,
      falsePositiveFindings: 1,
      matchedHighSeverityGold: 1,
      highSeverityGold: 20,
      matchedAllSeverityGold: 1,
      allSeverityGold: 28,
      falseAccepts: 0,
      falseAcceptEligibleFixtures: 16,
    });
    expect(metrics?.conditionalAcceptedDiagnostics.highSeverityRecall).toMatchObject(
      { numerator: 1, denominator: 2, estimate: 0.5 },
    );
    expect(metrics?.conditionalAcceptedDiagnostics.allSeverityRecall).toMatchObject(
      { numerator: 1, denominator: 3, estimate: 0.333333333333 },
    );
    expect(canonicalHeldOutJsonV1(repeated)).toBe(
      canonicalHeldOutJsonV1(aggregate),
    );
    expect(
      HeldOutReviewAggregateV1Schema.safeParse({
        ...aggregate,
        fixtureId: "must-not-be-public",
      }).success,
    ).toBe(false);
    expect(
      HeldOutReviewAggregateV1Schema.safeParse({
        ...aggregate,
        aggregateUsage: {
          ...aggregate.aggregateUsage,
          unreportedAttempts: 1,
        },
      }).success,
    ).toBe(false);
    expect(
      HeldOutReviewAggregateV1Schema.safeParse({
        ...aggregate,
        operationalStatistics: {
          ...aggregate.operationalStatistics,
          validReviewYield: {
            ...aggregate.operationalStatistics.validReviewYield,
            numerator: 10,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects contradictory public aggregate status, metric, cost, and accounting mutations", () => {
    const aggregate = evaluateWith(completeSyntheticScenario());
    const acceptedUsageInvariant =
      "Accepted outcomes require sufficient aggregate inference, reported usage, and input/output token totals.";
    const mutations: Array<
      [string, (candidate: HeldOutReviewAggregateV1) => void, string?]
    > = [
      ["duplicate outcome view", (candidate) => {
        candidate.outcomeCounts.accepted += 1;
      }],
      ["non-partitioning outcomes", (candidate) => {
        candidate.outcomeCounts.invalid += 1;
        candidate.operationalStatistics.outcomeCounts.invalid += 1;
      }],
      ["forged assessment reason", (candidate) => {
        candidate.semanticStatusReason = "pending_adjudication";
      }],
      ["non-partitioning adjudication", (candidate) => {
        candidate.adjudicationSummary.pendingFindingCount += 1;
      }],
      ["forged Wilson estimate", (candidate) => {
        candidate.semanticMetrics!.highSeverityRecall.estimate = 0.99;
      }],
      ["semantic raw-count mismatch", (candidate) => {
        candidate.semanticMetrics!.rawCounts.emittedFindings += 1;
      }],
      ["forged weighted quality", (candidate) => {
        candidate.semanticMetrics!.weightedQuality = 0.99;
      }],
      ["forged selected-cost point", (candidate) => {
        candidate.operationalStatistics.selectedCostMicrousd.total.value = 1;
      }],
      ["bootstrap override", (candidate) => {
        candidate.operationalStatistics.latencyMs.bootstrap95.seed += 1;
      }],
      ["infrastructure count mismatch", (candidate) => {
        candidate.infrastructureCost.knownAssignmentCount += 1;
      }],
      ["aggregate token mismatch", (candidate) => {
        candidate.aggregateUsage.cacheReadTokens =
          candidate.aggregateUsage.inputTokens + 1;
      }],
      [
        "accepted count exceeds aggregate inference",
        (candidate) => {
          candidate.aggregateUsage.inferenceAttemptCount = 8;
          candidate.aggregateUsage.reportedAttempts = 8;
          candidate.aggregateUsage.unreportedAttempts = 0;
        },
        acceptedUsageInvariant,
      ],
      [
        "accepted count exceeds reported attempts",
        (candidate) => {
          candidate.aggregateUsage.reportedAttempts = 8;
          candidate.aggregateUsage.unreportedAttempts = 4;
        },
        acceptedUsageInvariant,
      ],
      [
        "accepted count exceeds aggregate input tokens",
        (candidate) => {
          candidate.aggregateUsage.inputTokens = 8;
          candidate.aggregateUsage.cacheReadTokens = 0;
        },
        acceptedUsageInvariant,
      ],
      [
        "accepted count exceeds aggregate output tokens",
        (candidate) => {
          candidate.aggregateUsage.outputTokens = 8;
        },
        acceptedUsageInvariant,
      ],
      ["removed non-claim", (candidate) => {
        candidate.nonClaims = [
          "The evaluator contacted a provider.",
          ...candidate.nonClaims.slice(1),
        ];
      }],
    ];

    for (const [label, mutate, expectedMessage] of mutations) {
      const candidate = structuredClone(aggregate);
      mutate(candidate);
      const parsed = HeldOutReviewAggregateV1Schema.safeParse(candidate);
      expect(parsed.success, label).toBe(false);
      if (!parsed.success && expectedMessage) {
        expect(
          parsed.error.issues.some((issue) => issue.message === expectedMessage),
          `${label} exact invariant`,
        ).toBe(true);
      }
    }

    const zeroInferenceAggregate = evaluateWith(
      buildSyntheticHeldOutReviewScenarioV1(),
    );
    expect(zeroInferenceAggregate.aggregateUsage.inferenceAttemptCount).toBe(0);
    const zeroInferenceCostMutations: Array<
      [string, (candidate: HeldOutReviewAggregateV1) => void]
    > = [
      ["zero inference with positive selected cost", (candidate) => {
        const cost = candidate.operationalStatistics.selectedCostMicrousd;
        cost.totalKnown = 24;
        cost.total.value = 24;
        cost.perAssigned.value = 1;
        cost.perAssigned.numeratorKnown = 24;
        cost.perSuccessful.numeratorKnown = 24;
        cost.perAssignedBootstrap95.interval = { lower: 1, upper: 1 };
      }],
      ["zero inference with unknown selected cost", (candidate) => {
        const cost = candidate.operationalStatistics.selectedCostMicrousd;
        cost.knownAssignmentCount = 23;
        cost.unknownAssignmentCount = 1;
        cost.total = { value: null, reason: "unknown_selected_cost" };
        cost.perAssigned = {
          value: null,
          reason: "unknown_selected_cost",
          numeratorKnown: 0,
          denominator: 24,
        };
        cost.perAssignedBootstrap95.generatedReplicateCount = 0;
        cost.perAssignedBootstrap95.validReplicateCount = 0;
        cost.perAssignedBootstrap95.zeroSuccessReplicateCount = 0;
        cost.perAssignedBootstrap95.interval = null;
        cost.perAssignedBootstrap95.reason = "unknown_selected_cost";
      }],
    ];
    for (const [label, mutate] of zeroInferenceCostMutations) {
      const candidate = structuredClone(zeroInferenceAggregate);
      mutate(candidate);
      const parsed = HeldOutReviewAggregateV1Schema.safeParse(candidate);
      expect(parsed.success, label).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (issue) =>
              issue.message ===
              "Zero aggregate inference attempts require known zero selected cost for every assignment.",
          ),
          `${label} exact invariant`,
        ).toBe(true);
      }
    }

    const pendingAggregate = evaluateWith(
      buildSyntheticHeldOutReviewScenarioV1({
        runSpecs: [{ ordinal: 1, outcome: "accepted" }],
        findingSpecs: [
          {
            ordinal: 1,
            findingId: "synthetic-missing-packet",
            includePacket: false,
          },
        ],
      }),
    );
    expect(pendingAggregate.assessmentStatus).toBe("pending_adjudication");
    const impossibleFindingCount = structuredClone(pendingAggregate);
    impossibleFindingCount.adjudicationSummary.emittedFindingCount = 65;
    impossibleFindingCount.adjudicationSummary.pendingFindingCount = 65;
    const findingCountParse = HeldOutReviewAggregateV1Schema.safeParse(
      impossibleFindingCount,
    );
    expect(findingCountParse.success).toBe(false);
    if (!findingCountParse.success) {
      expect(
        findingCountParse.error.issues.some(
          (issue) =>
            issue.message ===
            "Emitted findings cannot exceed 64 findings per accepted result.",
        ),
      ).toBe(true);
    }

    const impossibleGoldCount = structuredClone(pendingAggregate);
    impossibleGoldCount.corpusCounts.highSeverityGold = 1_024;
    impossibleGoldCount.corpusCounts.lowerSeverityGold = 8;
    const goldCountParse =
      HeldOutReviewAggregateV1Schema.safeParse(impossibleGoldCount);
    expect(goldCountParse.success).toBe(false);
    if (!goldCountParse.success) {
      expect(
        goldCountParse.error.issues.some(
          (issue) =>
            issue.message ===
            "Aggregate gold count cannot exceed 64 defects per faulty fixture.",
        ),
      ).toBe(true);
    }

    const falseAcceptInvariant =
      "False-accept counts require a feasible high-severity fixture population and unmatched gold.";
    const falseAcceptMutations: Array<
      [string, (candidate: HeldOutReviewAggregateV1) => void]
    > = [
      ["zero high-severity eligible fixtures", (candidate) => {
        const metrics = candidate.semanticMetrics!;
        metrics.rawCounts.falseAcceptEligibleFixtures = 0;
        metrics.rawCounts.falseAccepts = 0;
        metrics.falseAccept = {
          ...wilson95IntervalV1(0, 0),
          count: 0,
        };
      }],
      ["more false accepts than accepted results", (candidate) => {
        const metrics = candidate.semanticMetrics!;
        metrics.rawCounts.falseAcceptEligibleFixtures = 16;
        metrics.rawCounts.falseAccepts = 10;
        metrics.falseAccept = {
          ...wilson95IntervalV1(10, 16),
          count: 10,
        };
      }],
    ];
    for (const [label, mutate] of falseAcceptMutations) {
      const candidate = structuredClone(aggregate);
      mutate(candidate);
      const parsed = HeldOutReviewAggregateV1Schema.safeParse(candidate);
      expect(parsed.success, label).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (issue) => issue.message === falseAcceptInvariant,
          ),
          `${label} exact invariant`,
        ).toBe(true);
      }
    }

    const corpusOnly = buildSyntheticHeldOutReviewScenarioV1();
    const highSeverityFindingSpecs = corpusOnly.corpus.oracle.entries.flatMap(
      (entry) =>
        entry.fixtureClass === "faulty"
          ? entry.goldDefects.flatMap((gold, goldIndex) =>
              gold.severity === "P0" || gold.severity === "P1"
                ? [
                    {
                      ordinal: entry.ordinal,
                      findingId: `synthetic-high-${entry.ordinal}-${goldIndex}`,
                      evidenceGoldIndex: goldIndex,
                    },
                  ]
                : [],
            )
          : [],
    );
    const highSeverityAcceptedOrdinals = [
      ...new Set(highSeverityFindingSpecs.map((finding) => finding.ordinal)),
    ];
    const allHighMatchedAggregate = evaluateWith(
      buildSyntheticHeldOutReviewScenarioV1({
        runSpecs: highSeverityAcceptedOrdinals.map((ordinal) => ({
          ordinal,
          outcome: "accepted" as const,
        })),
        findingSpecs: highSeverityFindingSpecs,
      }),
    );
    expect(
      allHighMatchedAggregate.semanticMetrics!.rawCounts
        .matchedHighSeverityGold,
    ).toBe(allHighMatchedAggregate.corpusCounts.highSeverityGold);
    const falseAcceptAfterCompleteRecall = structuredClone(
      allHighMatchedAggregate,
    );
    const completeRecallMetrics =
      falseAcceptAfterCompleteRecall.semanticMetrics!;
    completeRecallMetrics.rawCounts.falseAccepts = 1;
    completeRecallMetrics.falseAccept = {
      ...wilson95IntervalV1(
        1,
        completeRecallMetrics.rawCounts.falseAcceptEligibleFixtures,
      ),
      count: 1,
    };
    const completeRecallParse = HeldOutReviewAggregateV1Schema.safeParse(
      falseAcceptAfterCompleteRecall,
    );
    expect(completeRecallParse.success).toBe(false);
    if (!completeRecallParse.success) {
      expect(
        completeRecallParse.error.issues.some(
          (issue) => issue.message === falseAcceptInvariant,
        ),
      ).toBe(true);
    }

    const setUnknownSelectedCost = (
      candidate: HeldOutReviewAggregateV1,
      unknownAssignmentCount: number,
    ) => {
      const cost = candidate.operationalStatistics.selectedCostMicrousd;
      cost.knownAssignmentCount = 24 - unknownAssignmentCount;
      cost.unknownAssignmentCount = unknownAssignmentCount;
      cost.total = { value: null, reason: "unknown_selected_cost" };
      cost.perAssigned = {
        value: null,
        reason: "unknown_selected_cost",
        numeratorKnown: 0,
        denominator: 24,
      };
      cost.perSuccessful = {
        value: null,
        reason: "unknown_selected_cost",
        numeratorKnown: 0,
        denominator: candidate.outcomeCounts.accepted,
      };
      for (const bootstrap of [
        cost.perAssignedBootstrap95,
        cost.perSuccessfulBootstrap95,
      ]) {
        bootstrap.generatedReplicateCount = 0;
        bootstrap.validReplicateCount = 0;
        bootstrap.zeroSuccessReplicateCount = 0;
        bootstrap.interval = null;
        bootstrap.reason = "unknown_selected_cost";
      }
    };
    const unknownCostInvariant =
      "Unknown selected-cost assignments require dispatched, non-unstarted assignments.";
    const unknownCostMutations: Array<
      [string, (candidate: HeldOutReviewAggregateV1) => void]
    > = [
      ["unknown cost exceeds non-unstarted assignments", (candidate) => {
        candidate.aggregateUsage.inferenceAttemptCount = 13;
        candidate.aggregateUsage.reportedAttempts = 12;
        candidate.aggregateUsage.unreportedAttempts = 1;
        setUnknownSelectedCost(candidate, 13);
      }],
      ["unknown cost exceeds dispatched assignments", (candidate) => {
        candidate.aggregateUsage.inferenceAttemptCount = 11;
        candidate.aggregateUsage.reportedAttempts = 11;
        candidate.aggregateUsage.unreportedAttempts = 0;
        setUnknownSelectedCost(candidate, 12);
      }],
    ];
    for (const [label, mutate] of unknownCostMutations) {
      const candidate = structuredClone(aggregate);
      mutate(candidate);
      const parsed = HeldOutReviewAggregateV1Schema.safeParse(candidate);
      expect(parsed.success, label).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (issue) => issue.message === unknownCostInvariant,
          ),
          `${label} exact invariant`,
        ).toBe(true);
      }
    }
  });

  it("maps every manifest-envelope and usage-integrity violation to run_input_invalid", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      runSpecs: [{ ordinal: 1, outcome: "accepted" }],
    });
    const violations: Array<
      (result: (typeof scenario.runResults.results)[number]) => void
    > = [
      (result) => {
        result.telemetry.inferenceAttemptCount =
          scenario.manifest.limits.maxInferenceRounds + 1;
        result.telemetry.usage.reportedAttempts =
          result.telemetry.inferenceAttemptCount;
      },
      (result) => {
        result.telemetry.successfulToolCount =
          scenario.manifest.limits.maxToolCalls + 1;
      },
      (result) => {
        result.telemetry.endToEndLatencyMs =
          scenario.manifest.limits.episodeTimeoutMs + 1;
      },
      (result) => {
        result.telemetry.usage.cacheReadTokens =
          result.telemetry.usage.inputTokens + 1;
      },
      (result) => {
        result.telemetry.usage.reportedAttempts = 0;
      },
      (result) => {
        result.telemetry.usage.inputTokens = 0;
        result.telemetry.usage.cacheReadTokens = 0;
      },
      (result) => {
        result.telemetry.usage.inputTokens =
          scenario.manifest.limits.maxInputTokens + 1;
      },
      (result) => {
        result.telemetry.usage.outputTokens =
          scenario.manifest.limits.maxOutputTokens;
        result.telemetry.usage.reasoningTokens = 1;
      },
    ];

    for (const mutate of violations) {
      const runResults = structuredClone(scenario.runResults);
      mutate(runResults.results[0]!);
      expectEvaluationError(
        () => evaluateWith(scenario, { runResults }),
        "run_input_invalid",
      );
    }
  });

  it("penalizes a duplicate match to one gold defect without inflating recall", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-duplicate-a",
          adjudicatorDispositions: ["matched_gold", "matched_gold"],
        },
        {
          ordinal: 9,
          findingId: "synthetic-duplicate-b",
          adjudicatorDispositions: ["matched_gold", "matched_gold"],
        },
      ],
    });

    const metrics = evaluateWith(scenario).semanticMetrics;
    expect(metrics).not.toBeNull();
    expect(metrics?.findingPrecision).toMatchObject({
      numerator: 1,
      denominator: 2,
      estimate: 0.5,
    });
    expect(metrics?.highSeverityRecall).toMatchObject({
      numerator: 1,
      denominator: 20,
    });
    expect(metrics?.allSeverityRecall).toMatchObject({
      numerator: 1,
      denominator: 28,
    });
    expect(metrics?.rawCounts).toMatchObject({
      emittedFindings: 2,
      uniqueMatchedFindings: 1,
      duplicateMatchedFindings: 1,
      falsePositiveFindings: 1,
    });
  });

  it("counts a faulty clean conclusion as a false accept and keeps zero-finding precision and weighted quality non-estimable", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      runSpecs: [
        {
          ordinal: 9,
          outcome: "accepted",
          conclusion: "no_blocking_findings",
        },
      ],
    });

    const aggregate = evaluateWith(scenario);
    expect(aggregate.assessmentStatus).toBe("complete");
    expect(aggregate.semanticStatusReason).toBe("zero_emitted_findings");
    expect(aggregate.semanticMetrics?.findingPrecision).toEqual({
      numerator: 0,
      denominator: 0,
      estimate: null,
      interval: null,
      reason: "zero_denominator",
    });
    expect(aggregate.semanticMetrics?.weightedQuality).toBeNull();
    expect(aggregate.semanticMetrics?.weightedQualityReason).toBe(
      "zero_emitted_findings",
    );
    expect(aggregate.semanticMetrics?.falseAccept).toMatchObject({
      numerator: 1,
      denominator: 16,
      estimate: 0.0625,
      count: 1,
    });
    expect(aggregate.semanticMetrics?.highSeverityRecall).toMatchObject({
      numerator: 0,
      denominator: 20,
    });
    expect(aggregate.semanticMetrics?.allSeverityRecall).toMatchObject({
      numerator: 0,
      denominator: 28,
    });
  });

  it("reports attempted and unreported usage populations separately", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      runSpecs: [{ ordinal: 1, outcome: "invalid" }],
    });
    const runResults = structuredClone(scenario.runResults);
    const result = runResults.results[0]!;
    result.telemetry.usage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      reportedAttempts: 0,
    };

    expect(evaluateWith(scenario, { runResults }).aggregateUsage).toMatchObject({
      inferenceAttemptCount: 1,
      reportedAttempts: 0,
      unreportedAttempts: 1,
    });
  });

  it("returns pending_adjudication when a finding has only one judgment", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 1,
          findingId: "synthetic-pending-judgment",
          adjudicatorDispositions: ["false_positive", "false_positive"],
          judgmentCount: 1,
        },
      ],
    });

    const aggregate = evaluateWith(scenario);
    expect(aggregate.assessmentStatus).toBe("pending_adjudication");
    expect(aggregate.semanticStatusReason).toBe("pending_adjudication");
    expect(aggregate.semanticMetrics).toBeNull();
    expect(aggregate.adjudicationSummary).toMatchObject({
      emittedFindingCount: 1,
      resolvedFindingCount: 0,
      pendingFindingCount: 1,
      unverifiedAttestationCount: 0,
    });
    expect(aggregate.outcomeCounts).toMatchObject({
      accepted: 1,
      unstarted: 23,
    });
  });

  it("keeps an unresolved disagreement pending and scores the same disagreement only after a bound joint resolution", () => {
    const pending = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-disagreement",
          adjudicatorDispositions: ["matched_gold", "false_positive"],
        },
      ],
    });
    expect(evaluateWith(pending)).toMatchObject({
      assessmentStatus: "pending_adjudication",
      semanticStatusReason: "pending_adjudication",
      semanticMetrics: null,
      adjudicationSummary: {
        pendingFindingCount: 1,
        resolvedFindingCount: 0,
      },
    });

    const resolved = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-disagreement",
          adjudicatorDispositions: ["matched_gold", "false_positive"],
          resolutionDisposition: "matched_gold",
        },
      ],
    });
    const aggregate = evaluateWith(resolved);
    expect(aggregate.assessmentStatus).toBe("complete");
    expect(aggregate.adjudicationSummary).toMatchObject({
      pendingFindingCount: 0,
      resolvedFindingCount: 1,
    });
    expect(aggregate.semanticMetrics?.findingPrecision).toMatchObject({
      numerator: 1,
      denominator: 1,
      estimate: 1,
    });
  });

  it("suppresses scoring when a signed judgment disposition is rewritten", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-mutated-judgment-disposition",
          adjudicatorDispositions: ["false_positive", "false_positive"],
        },
      ],
    });
    const candidate = scenario.packets[0]?.candidateGold[0];
    if (!candidate) {
      throw new Error("Synthetic faulty fixture needs a candidate.");
    }
    const rewrittenJudgments = structuredClone(scenario.judgments);
    for (const judgment of rewrittenJudgments) {
      judgment.disposition = {
        kind: "matched_gold",
        goldDefectId: candidate.goldDefectId,
      };
    }

    expect(
      evaluateWith(scenario, { judgments: rewrittenJudgments }),
    ).toMatchObject({
      assessmentStatus: "adjudication_attestation_unverified",
      semanticStatusReason: "adjudication_attestation_unverified",
      semanticMetrics: null,
      adjudicationSummary: {
        pendingFindingCount: 0,
        resolvedFindingCount: 0,
        unverifiedAttestationCount: 1,
      },
    });
  });

  it("suppresses scoring when a signed joint resolution disposition is rewritten", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-mutated-resolution-disposition",
          adjudicatorDispositions: ["matched_gold", "false_positive"],
          resolutionDisposition: "false_positive",
        },
      ],
    });
    const candidate = scenario.packets[0]?.candidateGold[0];
    const resolution = structuredClone(scenario.resolutions[0]);
    if (!candidate || !resolution) {
      throw new Error("Synthetic resolution fixture is incomplete.");
    }
    resolution.finalDisposition = {
      kind: "matched_gold",
      goldDefectId: candidate.goldDefectId,
    };

    expect(evaluateWith(scenario, { resolutions: [resolution] })).toMatchObject(
      {
        assessmentStatus: "adjudication_attestation_unverified",
        semanticStatusReason: "adjudication_attestation_unverified",
        semanticMetrics: null,
        adjudicationSummary: {
          pendingFindingCount: 0,
          resolvedFindingCount: 0,
          unverifiedAttestationCount: 1,
        },
      },
    );
  });

  it("suppresses metrics for an invalid coordinator signature and rejects a mismatched trust anchor", () => {
    const badSignatureScenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 1,
          findingId: "synthetic-invalid-signature",
          adjudicatorDispositions: ["false_positive", "false_positive"],
        },
      ],
    });
    const badAttestation = structuredClone(
      badSignatureScenario.attestations[0]!,
    );
    badAttestation.signatureBase64 = Buffer.alloc(64, 0x7f).toString("base64");
    const badJudgment = structuredClone(badSignatureScenario.judgments[0]!);
    badJudgment.coordinatorAttestationSha256 =
      computeHeldOutCoordinatorAttestationSha256V1(badAttestation);
    const invalidSignature = evaluateWith(badSignatureScenario, {
      judgments: [badJudgment, badSignatureScenario.judgments[1]!],
      coordinatorAttestations: [
        badAttestation,
        badSignatureScenario.attestations[1]!,
      ],
    });
    expect(invalidSignature).toMatchObject({
      assessmentStatus: "adjudication_attestation_unverified",
      semanticStatusReason: "adjudication_attestation_unverified",
      semanticMetrics: null,
      adjudicationSummary: {
        pendingFindingCount: 0,
        resolvedFindingCount: 0,
        unverifiedAttestationCount: 1,
      },
    });

    const mismatchedTrustScenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 1,
          findingId: "synthetic-mismatched-trust-anchor",
          adjudicatorDispositions: ["false_positive", "false_positive"],
        },
      ],
    });
    const unrelatedPublicKey = generateKeyPairSync("ed25519").publicKey;
    expectEvaluationError(
      () =>
        evaluateWith(mismatchedTrustScenario, {
          coordinatorPublicKey: unrelatedPublicKey,
        }),
      "adjudication_input_invalid",
    );
  });

  it("rejects a mismatched coordinator trust anchor when no finding needs adjudication", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1();
    const unrelatedPublicKey = generateKeyPairSync("ed25519").publicKey;

    expectEvaluationError(
      () =>
        evaluateWith(scenario, {
          coordinatorPublicKey: unrelatedPublicKey,
        }),
      "adjudication_input_invalid",
    );
  });

  it("suppresses every semantic metric when a valid novel defect requires corpus correction", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 1,
          findingId: "synthetic-valid-novel-defect",
          adjudicatorDispositions: [
            "valid_novel_defect",
            "valid_novel_defect",
          ],
        },
      ],
    });

    const aggregate = evaluateWith(scenario);
    expect(aggregate).toMatchObject({
      assessmentStatus: "corpus_correction_required",
      semanticStatusReason: "valid_novel_defect",
      semanticMetrics: null,
      adjudicationSummary: {
        emittedFindingCount: 1,
        resolvedFindingCount: 1,
        pendingFindingCount: 0,
        unverifiedAttestationCount: 0,
        validNovelDefectCount: 1,
      },
    });
  });

  it("rejects a schema-valid adjudication packet whose candidate overlap set was tampered", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-packet-overlap-tamper",
          adjudicatorDispositions: ["matched_gold", "matched_gold"],
        },
      ],
    });
    const tamperedPacket = structuredClone(scenario.packets[0]!);
    expect(tamperedPacket.candidateGold.length).toBeGreaterThan(1);
    tamperedPacket.candidateGold.pop();

    expectEvaluationError(
      () =>
        evaluateWith(scenario, {
          adjudicationPackets: [tamperedPacket],
        }),
      "adjudication_input_invalid",
    );
  });

  it("rejects duplicate packets and orphan packet, judgment, attestation, and resolution records", () => {
    const scenario = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 1,
          findingId: "synthetic-orphan-control",
          adjudicatorDispositions: ["false_positive", "false_positive"],
        },
      ],
    });
    expectEvaluationError(
      () =>
        evaluateWith(scenario, {
          adjudicationPackets: [scenario.packets[0]!, scenario.packets[0]!],
        }),
      "adjudication_input_invalid",
    );

    const orphanPacket = structuredClone(scenario.packets[0]!);
    orphanPacket.finding.findingId = "synthetic-orphan-packet";
    expectEvaluationError(
      () =>
        evaluateWith(scenario, {
          adjudicationPackets: [...scenario.packets, orphanPacket],
        }),
      "adjudication_input_invalid",
    );

    const orphanJudgment = structuredClone(scenario.judgments[0]!);
    orphanJudgment.packetSha256 = syntheticHeldOutDigestV1("orphan-packet");
    expectEvaluationError(
      () =>
        evaluateWith(scenario, {
          judgments: [...scenario.judgments, orphanJudgment],
        }),
      "adjudication_input_invalid",
    );

    const orphanAttestation = structuredClone(scenario.attestations[0]!);
    orphanAttestation.signatureBase64 = Buffer.alloc(64, 0x3c).toString(
      "base64",
    );
    expectEvaluationError(
      () =>
        evaluateWith(scenario, {
          coordinatorAttestations: [
            ...scenario.attestations,
            orphanAttestation,
          ],
        }),
      "adjudication_input_invalid",
    );

    const resolved = buildSyntheticHeldOutReviewScenarioV1({
      findingSpecs: [
        {
          ordinal: 9,
          findingId: "synthetic-orphan-resolution-control",
          adjudicatorDispositions: ["matched_gold", "false_positive"],
          resolutionDisposition: "matched_gold",
        },
      ],
    });
    const orphanResolution = HeldOutAdjudicationResolutionV1Schema.parse({
      ...resolved.resolutions[0]!,
      packetSha256: syntheticHeldOutDigestV1("orphan-resolution-packet"),
    });
    expectEvaluationError(
      () =>
        evaluateWith(resolved, {
          resolutions: [...resolved.resolutions, orphanResolution],
        }),
      "adjudication_input_invalid",
    );
  });
});
