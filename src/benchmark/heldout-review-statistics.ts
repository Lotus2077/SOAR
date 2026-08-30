export const HELD_OUT_REVIEW_STATISTICS_V1_LIMITS = Object.freeze({
  assignedFixtureCount: 24,
  maximumWilsonTrials: 1_000_000,
  maximumBootstrapReplicates: 100_000,
  maximumLatencyMs: 86_400_000,
  maximumSelectedCostMicrousd: 100_000_000_000,
} as const);

export const HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS = Object.freeze({
  wilson: "wilson-score-95-v1",
  bootstrap: "mulberry32-percentile-95-v1",
  latencyEstimator: "successful-review-arithmetic-mean-v1",
  costPerAssignedEstimator: "all-assignment-arithmetic-mean-v1",
  costPerSuccessfulEstimator: "all-assignment-cost-per-success-v1",
} as const);

export const HELD_OUT_STATISTICS_OUTCOMES_V1 = [
  "accepted",
  "invalid",
  "blocked",
  "cancelled",
  "unstarted",
] as const;

export type HeldOutStatisticsOutcomeV1 =
  (typeof HELD_OUT_STATISTICS_OUTCOMES_V1)[number];

export interface HeldOutStatisticsRowV1 {
  ordinal: number;
  outcome: HeldOutStatisticsOutcomeV1;
  latencyMs: number | null;
  selectedCostMicrousd: number | null;
}

export type HeldOutStatisticsNullReasonV1 =
  | "zero_denominator"
  | "zero_successful_reviews"
  | "unknown_selected_cost"
  | "zero_success_bootstrap_replicate";

export interface Wilson95IntervalV1 {
  numerator: number;
  denominator: number;
  estimate: number | null;
  interval: {
    method: typeof HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.wilson;
    confidenceLevel: 0.95;
    lower: number;
    upper: number;
  } | null;
  reason: "zero_denominator" | null;
}

export interface HeldOutPointEstimateV1 {
  value: number | null;
  reason:
    | "zero_successful_reviews"
    | "unknown_selected_cost"
    | null;
}

export interface HeldOutBootstrapIntervalV1 {
  method: typeof HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap;
  confidenceLevel: 0.95;
  seed: number;
  replicateCount: number;
  generatedReplicateCount: number;
  validReplicateCount: number;
  zeroSuccessReplicateCount: number;
  interval: { lower: number; upper: number } | null;
  reason:
    | "zero_successful_reviews"
    | "unknown_selected_cost"
    | "zero_success_bootstrap_replicate"
    | null;
}

export interface HeldOutOperationalStatisticsV1 {
  schemaVersion: "heldout-review-operational-statistics-v1";
  algorithms: {
    bootstrap: typeof HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap;
    latencyEstimator: typeof HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.latencyEstimator;
    costPerAssignedEstimator: typeof HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.costPerAssignedEstimator;
    costPerSuccessfulEstimator: typeof HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.costPerSuccessfulEstimator;
  };
  seed: number;
  replicateCount: number;
  assignedCount: number;
  successfulReviewCount: number;
  validReviewYield: Wilson95IntervalV1;
  outcomeCounts: Record<HeldOutStatisticsOutcomeV1, number>;
  latencyMs: {
    successfulReviewCount: number;
    mean: HeldOutPointEstimateV1;
    bootstrap95: HeldOutBootstrapIntervalV1;
  };
  selectedCostMicrousd: {
    knownAssignmentCount: number;
    unknownAssignmentCount: number;
    totalKnown: number;
    total: HeldOutPointEstimateV1;
    perAssigned: HeldOutPointEstimateV1 & {
      numeratorKnown: number;
      denominator: number;
    };
    perSuccessful: HeldOutPointEstimateV1 & {
      numeratorKnown: number;
      denominator: number;
    };
    perAssignedBootstrap95: HeldOutBootstrapIntervalV1;
    perSuccessfulBootstrap95: HeldOutBootstrapIntervalV1;
  };
}

type StatisticsErrorCode =
  | "statistics_input_invalid"
  | "statistics_row_invalid";

export class HeldOutReviewStatisticsError extends Error {
  readonly code: StatisticsErrorCode;

  constructor(code: StatisticsErrorCode) {
    super(code);
    this.code = code;
    this.name = "HeldOutReviewStatisticsError";
  }
}

const WILSON_Z_95 = 1.959963984540054;
const UINT32_MAX = 0xffff_ffff;
const LATENCY_SEED_DOMAIN = 0x4c41_5459;
const COST_SEED_DOMAIN = 0x434f_5354;
const ROW_KEYS = [
  "latencyMs",
  "ordinal",
  "outcome",
  "selectedCostMicrousd",
] as const;
const INPUT_KEYS = ["replicateCount", "rows", "seed"] as const;

function statisticsError(code: StatisticsErrorCode): HeldOutReviewStatisticsError {
  return new HeldOutReviewStatisticsError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function stableNumber(value: number): number {
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  code: StatisticsErrorCode,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw statisticsError(code);
  }
}

function assertBoundedNumberOrNull(
  value: unknown,
  maximum: number,
): asserts value is number | null {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum)
  ) {
    throw statisticsError("statistics_row_invalid");
  }
}

function assertBoundedCostOrNull(
  value: unknown,
): asserts value is number | null {
  if (value === null) return;
  assertSafeIntegerInRange(
    value,
    0,
    HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumSelectedCostMicrousd,
    "statistics_row_invalid",
  );
}

function validateRows(rowsInput: unknown): HeldOutStatisticsRowV1[] {
  if (
    !Array.isArray(rowsInput) ||
    rowsInput.length !==
      HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.assignedFixtureCount
  ) {
    throw statisticsError("statistics_input_invalid");
  }

  const ordinals = new Set<number>();
  const rows = rowsInput.map((rowInput) => {
    if (!isPlainRecord(rowInput) || !hasExactKeys(rowInput, ROW_KEYS)) {
      throw statisticsError("statistics_row_invalid");
    }
    assertSafeIntegerInRange(
      rowInput.ordinal,
      1,
      HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.assignedFixtureCount,
      "statistics_row_invalid",
    );
    if (ordinals.has(rowInput.ordinal)) {
      throw statisticsError("statistics_row_invalid");
    }
    ordinals.add(rowInput.ordinal);
    if (
      typeof rowInput.outcome !== "string" ||
      !HELD_OUT_STATISTICS_OUTCOMES_V1.includes(
        rowInput.outcome as HeldOutStatisticsOutcomeV1,
      )
    ) {
      throw statisticsError("statistics_row_invalid");
    }
    assertBoundedNumberOrNull(
      rowInput.latencyMs,
      HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumLatencyMs,
    );
    assertBoundedCostOrNull(rowInput.selectedCostMicrousd);
    if (rowInput.outcome === "accepted" && rowInput.latencyMs === null) {
      throw statisticsError("statistics_row_invalid");
    }
    return {
      ordinal: rowInput.ordinal,
      outcome: rowInput.outcome as HeldOutStatisticsOutcomeV1,
      latencyMs: rowInput.latencyMs,
      selectedCostMicrousd: rowInput.selectedCostMicrousd,
    };
  });

  rows.sort((left, right) => left.ordinal - right.ordinal);
  return rows;
}

function mean(values: readonly number[]): number {
  return stableNumber(
    values.reduce((total, value) => total + value, 0) / values.length,
  );
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return stableNumber(lower + (upper - lower) * (position - lowerIndex));
}

function percentile95(values: readonly number[]): {
  lower: number;
  upper: number;
} {
  return {
    lower: quantile(values, 0.025),
    upper: quantile(values, 0.975),
  };
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sampledIndex(random: () => number, length: number): number {
  return Math.floor(random() * length);
}

function nullBootstrap(
  seed: number,
  replicateCount: number,
  reason:
    | "zero_successful_reviews"
    | "unknown_selected_cost",
): HeldOutBootstrapIntervalV1 {
  return {
    method: HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap,
    confidenceLevel: 0.95,
    seed,
    replicateCount,
    generatedReplicateCount: 0,
    validReplicateCount: 0,
    zeroSuccessReplicateCount: 0,
    interval: null,
    reason,
  };
}

function bootstrapLatency(
  latencies: readonly number[],
  replicateCount: number,
  seed: number,
): HeldOutBootstrapIntervalV1 {
  if (latencies.length === 0) {
    return nullBootstrap(seed, replicateCount, "zero_successful_reviews");
  }
  const random = createMulberry32((seed ^ LATENCY_SEED_DOMAIN) >>> 0);
  const estimates: number[] = [];
  for (let replicate = 0; replicate < replicateCount; replicate += 1) {
    let total = 0;
    for (let index = 0; index < latencies.length; index += 1) {
      total += latencies[sampledIndex(random, latencies.length)]!;
    }
    estimates.push(stableNumber(total / latencies.length));
  }
  return {
    method: HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap,
    confidenceLevel: 0.95,
    seed,
    replicateCount,
    generatedReplicateCount: replicateCount,
    validReplicateCount: replicateCount,
    zeroSuccessReplicateCount: 0,
    interval: percentile95(estimates),
    reason: null,
  };
}

function bootstrapCosts(
  rows: readonly HeldOutStatisticsRowV1[],
  replicateCount: number,
  seed: number,
): {
  perAssigned: HeldOutBootstrapIntervalV1;
  perSuccessful: HeldOutBootstrapIntervalV1;
} {
  const successfulCount = rows.filter(
    (row) => row.outcome === "accepted",
  ).length;
  if (successfulCount === 0) {
    return {
      perAssigned: rows.some((row) => row.selectedCostMicrousd === null)
        ? nullBootstrap(seed, replicateCount, "unknown_selected_cost")
        : bootstrapKnownCostPerAssigned(rows, replicateCount, seed),
      perSuccessful: nullBootstrap(
        seed,
        replicateCount,
        "zero_successful_reviews",
      ),
    };
  }
  if (rows.some((row) => row.selectedCostMicrousd === null)) {
    return {
      perAssigned: nullBootstrap(
        seed,
        replicateCount,
        "unknown_selected_cost",
      ),
      perSuccessful: nullBootstrap(
        seed,
        replicateCount,
        "unknown_selected_cost",
      ),
    };
  }

  const random = createMulberry32((seed ^ COST_SEED_DOMAIN) >>> 0);
  const perAssignedEstimates: number[] = [];
  const perSuccessfulEstimates: number[] = [];
  let zeroSuccessReplicateCount = 0;
  for (let replicate = 0; replicate < replicateCount; replicate += 1) {
    let totalCost = 0;
    let replicateSuccesses = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[sampledIndex(random, rows.length)]!;
      totalCost += row.selectedCostMicrousd!;
      if (row.outcome === "accepted") replicateSuccesses += 1;
    }
    perAssignedEstimates.push(stableNumber(totalCost / rows.length));
    if (replicateSuccesses === 0) {
      zeroSuccessReplicateCount += 1;
    } else {
      perSuccessfulEstimates.push(
        stableNumber(totalCost / replicateSuccesses),
      );
    }
  }

  const common = {
    method: HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap,
    confidenceLevel: 0.95 as const,
    seed,
    replicateCount,
    generatedReplicateCount: replicateCount,
  };
  return {
    perAssigned: {
      ...common,
      validReplicateCount: replicateCount,
      zeroSuccessReplicateCount,
      interval: percentile95(perAssignedEstimates),
      reason: null,
    },
    perSuccessful: {
      ...common,
      validReplicateCount: perSuccessfulEstimates.length,
      zeroSuccessReplicateCount,
      interval:
        zeroSuccessReplicateCount === 0
          ? percentile95(perSuccessfulEstimates)
          : null,
      reason:
        zeroSuccessReplicateCount === 0
          ? null
          : "zero_success_bootstrap_replicate",
    },
  };
}

function bootstrapKnownCostPerAssigned(
  rows: readonly HeldOutStatisticsRowV1[],
  replicateCount: number,
  seed: number,
): HeldOutBootstrapIntervalV1 {
  const random = createMulberry32((seed ^ COST_SEED_DOMAIN) >>> 0);
  const estimates: number[] = [];
  for (let replicate = 0; replicate < replicateCount; replicate += 1) {
    let totalCost = 0;
    for (let index = 0; index < rows.length; index += 1) {
      totalCost += rows[sampledIndex(random, rows.length)]!
        .selectedCostMicrousd!;
    }
    estimates.push(stableNumber(totalCost / rows.length));
  }
  return {
    method: HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap,
    confidenceLevel: 0.95,
    seed,
    replicateCount,
    generatedReplicateCount: replicateCount,
    validReplicateCount: replicateCount,
    zeroSuccessReplicateCount: replicateCount,
    interval: percentile95(estimates),
    reason: null,
  };
}

export function wilson95IntervalV1(
  successesInput: number,
  trialsInput: number,
): Wilson95IntervalV1 {
  assertSafeIntegerInRange(
    trialsInput,
    0,
    HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumWilsonTrials,
    "statistics_input_invalid",
  );
  assertSafeIntegerInRange(
    successesInput,
    0,
    trialsInput,
    "statistics_input_invalid",
  );
  if (trialsInput === 0) {
    return {
      numerator: successesInput,
      denominator: trialsInput,
      estimate: null,
      interval: null,
      reason: "zero_denominator",
    };
  }

  const proportion = successesInput / trialsInput;
  const zSquared = WILSON_Z_95 * WILSON_Z_95;
  const denominator = 1 + zSquared / trialsInput;
  const center = (proportion + zSquared / (2 * trialsInput)) / denominator;
  const margin =
    (WILSON_Z_95 / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / trialsInput +
        zSquared / (4 * trialsInput * trialsInput),
    );
  return {
    numerator: successesInput,
    denominator: trialsInput,
    estimate: stableNumber(proportion),
    interval: {
      method: HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.wilson,
      confidenceLevel: 0.95,
      lower: stableNumber(Math.max(0, center - margin)),
      upper: stableNumber(Math.min(1, center + margin)),
    },
    reason: null,
  };
}

export function computeHeldOutOperationalStatisticsV1(input: {
  rows: readonly HeldOutStatisticsRowV1[];
  replicateCount: number;
  seed: number;
}): HeldOutOperationalStatisticsV1 {
  if (!isPlainRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw statisticsError("statistics_input_invalid");
  }
  assertSafeIntegerInRange(
    input.replicateCount,
    1,
    HELD_OUT_REVIEW_STATISTICS_V1_LIMITS.maximumBootstrapReplicates,
    "statistics_input_invalid",
  );
  assertSafeIntegerInRange(
    input.seed,
    0,
    UINT32_MAX,
    "statistics_input_invalid",
  );
  const rows = validateRows(input.rows);
  const outcomeCounts: Record<HeldOutStatisticsOutcomeV1, number> = {
    accepted: 0,
    invalid: 0,
    blocked: 0,
    cancelled: 0,
    unstarted: 0,
  };
  rows.forEach((row) => {
    outcomeCounts[row.outcome] += 1;
  });
  const successfulRows = rows.filter((row) => row.outcome === "accepted");
  const latencies = successfulRows.map((row) => row.latencyMs!);
  const knownCostRows = rows.filter(
    (row) => row.selectedCostMicrousd !== null,
  );
  const totalKnownCost = knownCostRows.reduce(
    (total, row) => total + row.selectedCostMicrousd!,
    0,
  );
  const unknownCostCount = rows.length - knownCostRows.length;
  const allCostsKnown = unknownCostCount === 0;
  const costs = bootstrapCosts(rows, input.replicateCount, input.seed);
  const noSuccessfulReviews = successfulRows.length === 0;

  return {
    schemaVersion: "heldout-review-operational-statistics-v1",
    algorithms: {
      bootstrap: HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.bootstrap,
      latencyEstimator:
        HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.latencyEstimator,
      costPerAssignedEstimator:
        HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.costPerAssignedEstimator,
      costPerSuccessfulEstimator:
        HELD_OUT_REVIEW_STATISTICS_V1_ALGORITHMS.costPerSuccessfulEstimator,
    },
    seed: input.seed,
    replicateCount: input.replicateCount,
    assignedCount: rows.length,
    successfulReviewCount: successfulRows.length,
    validReviewYield: wilson95IntervalV1(successfulRows.length, rows.length),
    outcomeCounts,
    latencyMs: {
      successfulReviewCount: successfulRows.length,
      mean: {
        value: noSuccessfulReviews ? null : mean(latencies),
        reason: noSuccessfulReviews ? "zero_successful_reviews" : null,
      },
      bootstrap95: bootstrapLatency(
        latencies,
        input.replicateCount,
        input.seed,
      ),
    },
    selectedCostMicrousd: {
      knownAssignmentCount: knownCostRows.length,
      unknownAssignmentCount: unknownCostCount,
      totalKnown: totalKnownCost,
      total: {
        value: allCostsKnown ? totalKnownCost : null,
        reason: allCostsKnown ? null : "unknown_selected_cost",
      },
      perAssigned: {
        value: allCostsKnown
          ? stableNumber(totalKnownCost / rows.length)
          : null,
        reason: allCostsKnown ? null : "unknown_selected_cost",
        numeratorKnown: totalKnownCost,
        denominator: rows.length,
      },
      perSuccessful: {
        value:
          allCostsKnown && !noSuccessfulReviews
            ? stableNumber(totalKnownCost / successfulRows.length)
            : null,
        reason: noSuccessfulReviews
          ? "zero_successful_reviews"
          : allCostsKnown
            ? null
            : "unknown_selected_cost",
        numeratorKnown: totalKnownCost,
        denominator: successfulRows.length,
      },
      perAssignedBootstrap95: costs.perAssigned,
      perSuccessfulBootstrap95: costs.perSuccessful,
    },
  };
}
