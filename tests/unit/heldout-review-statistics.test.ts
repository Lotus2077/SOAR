import { describe, expect, it } from "vitest";

import {
  HELD_OUT_REVIEW_STATISTICS_V1_LIMITS,
  HeldOutReviewStatisticsError,
  computeHeldOutOperationalStatisticsV1,
  wilson95IntervalV1,
  type HeldOutStatisticsOutcomeV1,
  type HeldOutStatisticsRowV1,
} from "../../src/benchmark/heldout-review-statistics.ts";

function rows(options: {
  accepted?: number;
  unknownCostOrdinal?: number;
  latency?: (ordinal: number, outcome: HeldOutStatisticsOutcomeV1) => number;
  cost?: (ordinal: number, outcome: HeldOutStatisticsOutcomeV1) => number;
} = {}): HeldOutStatisticsRowV1[] {
  const accepted = options.accepted ?? 24;
  return Array.from(
    {
      length: HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.assignedFixtureCount,
    },
    (_, index) => {
      const ordinal = index + 1;
      const outcome: HeldOutStatisticsOutcomeV1 =
        ordinal <= accepted ? "accepted" : "invalid";
      return {
        ordinal,
        outcome,
        latencyMs:
          options.latency?.(ordinal, outcome) ??
          (outcome === "accepted" ? ordinal * 100 : ordinal * 10_000),
        selectedCostMicrousd:
          ordinal === options.unknownCostOrdinal
            ? null
            : (options.cost?.(ordinal, outcome) ?? ordinal * 100),
      };
    },
  );
}

function calculate(inputRows: readonly HeldOutStatisticsRowV1[]) {
  return computeHeldOutOperationalStatisticsV1({
    rows: inputRows,
    replicateCount: 1_000,
    seed: 0x1234_5678,
  });
}

describe("wilson95IntervalV1", () => {
  it("returns an explicit null and reason for a zero denominator", () => {
    expect(wilson95IntervalV1(0, 0)).toEqual({
      numerator: 0,
      denominator: 0,
      estimate: null,
      interval: null,
      reason: "zero_denominator",
    });
  });

  it("computes bounded deterministic Wilson 95% intervals", () => {
    expect(wilson95IntervalV1(12, 24)).toEqual({
      numerator: 12,
      denominator: 24,
      estimate: 0.5,
      interval: {
        method: "wilson-score-95-v1",
        confidenceLevel: 0.95,
        lower: 0.314274258196,
        upper: 0.685725741804,
      },
      reason: null,
    });
    expect(wilson95IntervalV1(0, 1).interval).toEqual({
      method: "wilson-score-95-v1",
      confidenceLevel: 0.95,
      lower: 0,
      upper: 0.793450685623,
    });
    expect(wilson95IntervalV1(1, 1).interval).toEqual({
      method: "wilson-score-95-v1",
      confidenceLevel: 0.95,
      lower: 0.206549314377,
      upper: 1,
    });
  });

  it("rejects malformed counts instead of repairing them", () => {
    for (const values of [
      [-1, 1],
      [2, 1],
      [0.5, 1],
      [0, -1],
      [0, 1.5],
      [0, HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumWilsonTrials + 1],
    ] as const) {
      expect(() => wilson95IntervalV1(values[0], values[1])).toThrowError(
        new HeldOutReviewStatisticsError("statistics_input_invalid"),
      );
    }
  });
});

describe("computeHeldOutOperationalStatisticsV1", () => {
  it("preserves all outcome and cost counts and bootstraps byte-stably", () => {
    const inputRows = rows({ accepted: 12 });
    inputRows[12]!.outcome = "blocked";
    inputRows[13]!.outcome = "cancelled";
    inputRows[14]!.outcome = "unstarted";
    const first = calculate(inputRows);
    const second = calculate([...inputRows].reverse());

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first).toMatchObject({
      schemaVersion: "heldout-review-operational-statistics-v1",
      seed: 0x1234_5678,
      replicateCount: 1_000,
      assignedCount: 24,
      successfulReviewCount: 12,
      validReviewYield: {
        numerator: 12,
        denominator: 24,
        estimate: 0.5,
        reason: null,
      },
      outcomeCounts: {
        accepted: 12,
        invalid: 9,
        blocked: 1,
        cancelled: 1,
        unstarted: 1,
      },
      latencyMs: {
        successfulReviewCount: 12,
        mean: { value: 650, reason: null },
      },
      selectedCostMicrousd: {
        knownAssignmentCount: 24,
        unknownAssignmentCount: 0,
        totalKnown: 30_000,
        total: { value: 30_000, reason: null },
        perAssigned: {
          value: 1_250,
          reason: null,
          numeratorKnown: 30_000,
          denominator: 24,
        },
        perSuccessful: {
          value: 2_500,
          reason: null,
          numeratorKnown: 30_000,
          denominator: 12,
        },
      },
    });
    expect(first.latencyMs.bootstrap95).toEqual({
      method: "mulberry32-percentile-95-v1",
      confidenceLevel: 0.95,
      seed: 0x1234_5678,
      replicateCount: 1_000,
      generatedReplicateCount: 1_000,
      validReplicateCount: 1_000,
      zeroSuccessReplicateCount: 0,
      interval: {
        lower: 441.666666666667,
        upper: 841.875,
      },
      reason: null,
    });
  });

  it("uses only accepted rows for the successful-review latency estimator", () => {
    const statistics = calculate(
      rows({
        accepted: 2,
        latency: (ordinal, outcome) =>
          outcome === "accepted" ? ordinal * 100 : 80_000_000,
      }),
    );
    expect(statistics.latencyMs.mean).toEqual({ value: 150, reason: null });
    expect(statistics.latencyMs.successfulReviewCount).toBe(2);
  });

  it("reports zero successful reviews without manufacturing estimates", () => {
    const statistics = calculate(rows({ accepted: 0 }));
    expect(statistics.validReviewYield).toEqual(wilson95IntervalV1(0, 24));
    expect(statistics.latencyMs).toEqual({
      successfulReviewCount: 0,
      mean: { value: null, reason: "zero_successful_reviews" },
      bootstrap95: {
        method: "mulberry32-percentile-95-v1",
        confidenceLevel: 0.95,
        seed: 0x1234_5678,
        replicateCount: 1_000,
        generatedReplicateCount: 0,
        validReplicateCount: 0,
        zeroSuccessReplicateCount: 0,
        interval: null,
        reason: "zero_successful_reviews",
      },
    });
    expect(statistics.selectedCostMicrousd.perAssigned.value).toBe(1_250);
    expect(statistics.selectedCostMicrousd.perAssignedBootstrap95.interval).not.toBeNull();
    expect(statistics.selectedCostMicrousd.perSuccessful).toEqual({
      value: null,
      reason: "zero_successful_reviews",
      numeratorKnown: 30_000,
      denominator: 0,
    });
    expect(
      statistics.selectedCostMicrousd.perSuccessfulBootstrap95,
    ).toMatchObject({
      generatedReplicateCount: 0,
      validReplicateCount: 0,
      interval: null,
      reason: "zero_successful_reviews",
    });
  });

  it("nulls the paired cost-per-success interval if any replicate has zero successes", () => {
    const statistics = computeHeldOutOperationalStatisticsV1({
      rows: rows({ accepted: 1 }),
      replicateCount: 64,
      seed: 7,
    });
    expect(statistics.selectedCostMicrousd.perSuccessful).toEqual({
      value: 30_000,
      reason: null,
      numeratorKnown: 30_000,
      denominator: 1,
    });
    expect(
      statistics.selectedCostMicrousd.perSuccessfulBootstrap95,
    ).toMatchObject({
      generatedReplicateCount: 64,
      validReplicateCount: 43,
      zeroSuccessReplicateCount: 21,
      interval: null,
      reason: "zero_success_bootstrap_replicate",
    });
    expect(
      statistics.selectedCostMicrousd.perAssignedBootstrap95,
    ).toMatchObject({
      generatedReplicateCount: 64,
      validReplicateCount: 64,
      zeroSuccessReplicateCount: 21,
      reason: null,
    });
  });

  it("preserves known cost totals while refusing estimates with unknown cost", () => {
    const statistics = calculate(rows({ accepted: 12, unknownCostOrdinal: 5 }));
    expect(statistics.selectedCostMicrousd).toMatchObject({
      knownAssignmentCount: 23,
      unknownAssignmentCount: 1,
      totalKnown: 29_500,
      total: { value: null, reason: "unknown_selected_cost" },
      perAssigned: {
        value: null,
        reason: "unknown_selected_cost",
        numeratorKnown: 29_500,
        denominator: 24,
      },
      perSuccessful: {
        value: null,
        reason: "unknown_selected_cost",
        numeratorKnown: 29_500,
        denominator: 12,
      },
      perAssignedBootstrap95: {
        generatedReplicateCount: 0,
        validReplicateCount: 0,
        interval: null,
        reason: "unknown_selected_cost",
      },
      perSuccessfulBootstrap95: {
        generatedReplicateCount: 0,
        validReplicateCount: 0,
        interval: null,
        reason: "unknown_selected_cost",
      },
    });
  });

  it("uses paired all-assignment costs rather than successful-row costs", () => {
    const statistics = calculate(
      rows({
        accepted: 12,
        cost: (_ordinal, outcome) =>
          outcome === "accepted" ? 100 : 900,
      }),
    );
    expect(statistics.selectedCostMicrousd.total.value).toBe(12_000);
    expect(statistics.selectedCostMicrousd.perAssigned.value).toBe(500);
    expect(statistics.selectedCostMicrousd.perSuccessful.value).toBe(1_000);
  });

  it("retains an exact zero-cost point and degenerate intervals", () => {
    const statistics = calculate(
      rows({ accepted: 24, cost: () => 0, latency: () => 250.25 }),
    );
    expect(statistics.latencyMs.mean.value).toBe(250.25);
    expect(statistics.latencyMs.bootstrap95.interval).toEqual({
      lower: 250.25,
      upper: 250.25,
    });
    expect(statistics.selectedCostMicrousd).toMatchObject({
      total: { value: 0, reason: null },
      perAssigned: { value: 0, reason: null },
      perSuccessful: { value: 0, reason: null },
      perAssignedBootstrap95: {
        interval: { lower: 0, upper: 0 },
        reason: null,
      },
      perSuccessfulBootstrap95: {
        zeroSuccessReplicateCount: 0,
        interval: { lower: 0, upper: 0 },
        reason: null,
      },
    });
  });

  it("rejects malformed, incomplete, or unbounded inputs", () => {
    const validRows = rows();
    const invalidInputs: unknown[] = [
      { rows: validRows.slice(0, 23), replicateCount: 10, seed: 1 },
      { rows: validRows, replicateCount: 0, seed: 1 },
      {
        rows: validRows,
        replicateCount:
          HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumBootstrapReplicates + 1,
        seed: 1,
      },
      { rows: validRows, replicateCount: 10, seed: -1 },
      { rows: validRows, replicateCount: 10, seed: 0x1_0000_0000 },
      { rows: validRows, replicateCount: 10, seed: 1, extra: true },
    ];
    for (const input of invalidInputs) {
      expect(() =>
        computeHeldOutOperationalStatisticsV1(
          input as Parameters<typeof computeHeldOutOperationalStatisticsV1>[0],
        ),
      ).toThrowError(
        new HeldOutReviewStatisticsError("statistics_input_invalid"),
      );
    }

    const rowMutations: Array<(candidate: Record<string, unknown>) => void> = [
      (candidate) => {
        candidate.ordinal = 2;
      },
      (candidate) => {
        candidate.outcome = "passed";
      },
      (candidate) => {
        candidate.latencyMs = Number.NaN;
      },
      (candidate) => {
        candidate.latencyMs =
          HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumLatencyMs + 1;
      },
      (candidate) => {
        candidate.selectedCostMicrousd = 0.5;
      },
      (candidate) => {
        candidate.selectedCostMicrousd =
          HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumSelectedCostMicrousd + 1;
      },
      (candidate) => {
        candidate.extra = true;
      },
    ];
    rowMutations.forEach((mutate) => {
      const candidateRows = rows().map((row) => ({ ...row }));
      mutate(candidateRows[0]! as unknown as Record<string, unknown>);
      expect(() =>
        calculate(candidateRows as HeldOutStatisticsRowV1[]),
      ).toThrowError(new HeldOutReviewStatisticsError("statistics_row_invalid"));
    });

    const missingAcceptedLatency = rows();
    missingAcceptedLatency[0]!.latencyMs = null;
    expect(() => calculate(missingAcceptedLatency)).toThrowError(
      new HeldOutReviewStatisticsError("statistics_row_invalid"),
    );
  });

  it("changes bootstrap intervals with the explicit seed while retaining points", () => {
    const inputRows = rows({ accepted: 12 });
    const first = computeHeldOutOperationalStatisticsV1({
      rows: inputRows,
      replicateCount: 200,
      seed: 1,
    });
    const second = computeHeldOutOperationalStatisticsV1({
      rows: inputRows,
      replicateCount: 200,
      seed: 2,
    });
    expect(first.latencyMs.mean).toEqual(second.latencyMs.mean);
    expect(first.latencyMs.bootstrap95.interval).not.toEqual(
      second.latencyMs.bootstrap95.interval,
    );
  });
});
