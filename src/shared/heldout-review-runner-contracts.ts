import { z } from "zod";

import {
  ChangeKindSchema,
  ChangePathSchema,
  Sha256Schema,
} from "./change-review-contracts.ts";

export const HELD_OUT_REVIEW_PROTOCOL_ID = "change-review-eval-v1" as const;
export const HELD_OUT_EVALUATOR_VERSION =
  "change-review-evaluator-v1" as const;
export const HELD_OUT_COMMITMENT_SCHEME =
  "soar-heldout-commitment-v1" as const;
export const HELD_OUT_FIXTURE_COUNT = 24 as const;

const boundedId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) => value.trim() === value && value.trim().length > 0,
      "Expected a bounded non-blank string without surrounding whitespace.",
    );
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const safePositiveInteger = z.number().int().positive().safe();
const safeNonNegativeNumber = z.number().finite().nonnegative();
const fixtureOrdinal = z
  .number()
  .int()
  .min(1)
  .max(HELD_OUT_FIXTURE_COUNT)
  .safe();
const implementationRevision = z.string().regex(/^[0-9a-f]{40}$/u);

interface RefinementContext {
  addIssue(issue: {
    code: "custom";
    path?: PropertyKey[];
    message: string;
  }): void;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  context: RefinementContext,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function requireExactOrderedOrdinals(
  values: readonly { ordinal: number }[],
  context: RefinementContext,
  path: PropertyKey[],
): void {
  values.forEach((value, index) => {
    if (value.ordinal !== index + 1) {
      issue(
        context,
        [...path, index, "ordinal"],
        `Ordinals must be exactly 1 through ${HELD_OUT_FIXTURE_COUNT} in order.`,
      );
    }
  });
}

function requireUnique(
  values: readonly string[],
  context: RefinementContext,
  path: PropertyKey[],
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    issue(context, path, `${label} must be unique.`);
  }
}

/** Sort object keys, preserve array order, and reject non-JSON values. */
export function canonicalHeldOutJsonV1(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(
        "Canonical JSON numbers must be finite and cannot be negative zero.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      throw new TypeError("Canonical JSON arrays cannot be sparse.");
    }
    return `[${value.map((entry) => canonicalHeldOutJsonV1(entry)).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError("Canonical JSON contains a non-JSON value.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON accepts plain objects only.");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => {
      if (record[key] === undefined) {
        throw new TypeError("Canonical JSON cannot contain undefined.");
      }
      return `${JSON.stringify(key)}:${canonicalHeldOutJsonV1(record[key])}`;
    })
    .join(",")}}`;
}

export const HeldOutRunnerFixtureV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-runner-fixture-v1"),
    ordinal: fixtureOrdinal,
    fixtureCommitment: Sha256Schema,
    snapshotCommitment: Sha256Schema,
    evidencePacketCommitment: Sha256Schema,
    promptSchemaCommitment: Sha256Schema,
    evidenceLimitsCommitment: Sha256Schema,
  })
  .strict();

export type HeldOutRunnerFixtureV1 = z.infer<
  typeof HeldOutRunnerFixtureV1Schema
>;

export const HeldOutRunnerBundleV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-runner-bundle-v1"),
    protocolId: z.literal(HELD_OUT_REVIEW_PROTOCOL_ID),
    setVersion: boundedId,
    commitmentScheme: z.literal(HELD_OUT_COMMITMENT_SCHEME),
    setCommitment: Sha256Schema,
    fixtures: z
      .array(HeldOutRunnerFixtureV1Schema)
      .length(HELD_OUT_FIXTURE_COUNT),
  })
  .strict()
  .superRefine((bundle, context) => {
    requireExactOrderedOrdinals(bundle.fixtures, context, ["fixtures"]);
    requireUnique(
      bundle.fixtures.map((fixture) => fixture.fixtureCommitment),
      context,
      ["fixtures"],
      "Fixture commitments",
    );
  });

export type HeldOutRunnerBundleV1 = z.infer<
  typeof HeldOutRunnerBundleV1Schema
>;

const HeldOutChangeEvidenceRegionV1Schema = z
  .object({
    kind: z.literal("change"),
    path: ChangePathSchema,
    side: z.enum(["base", "working"]),
    startLine: safePositiveInteger,
    endLine: safePositiveInteger,
    hunkSha256: Sha256Schema,
  })
  .strict()
  .superRefine((region, context) => {
    if (region.endLine < region.startLine) {
      issue(
        context,
        ["endLine"],
        "Evidence-region endLine cannot precede startLine.",
      );
    }
  });

const HeldOutMetadataEvidenceRegionV1Schema = z
  .object({
    kind: z.literal("change_metadata"),
    path: ChangePathSchema,
    changeKind: ChangeKindSchema,
  })
  .strict();

export const HeldOutEvidenceRegionV1Schema = z.discriminatedUnion("kind", [
  HeldOutChangeEvidenceRegionV1Schema,
  HeldOutMetadataEvidenceRegionV1Schema,
]);

export type HeldOutEvidenceRegionV1 = z.infer<
  typeof HeldOutEvidenceRegionV1Schema
>;

export const HeldOutRunManifestV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-run-manifest-v1"),
    protocolId: z.literal(HELD_OUT_REVIEW_PROTOCOL_ID),
    evaluatorVersion: z.literal(HELD_OUT_EVALUATOR_VERSION),
    setVersion: boundedId,
    setCommitment: Sha256Schema,
    implementationRevision,
    policy: z.enum([
      "local_only_v1",
      "cloud_synthesis_all_eval",
      "hybrid_v0",
    ]),
    providerIdentity: z
      .object({
        providerId: boundedId,
        requestedModel: boundedText(256),
        servedModel: boundedText(256),
      })
      .strict(),
    deploymentFingerprint: Sha256Schema,
    configurationFingerprint: Sha256Schema,
    limits: z
      .object({
        maxInputTokens: safePositiveInteger,
        maxOutputTokens: safePositiveInteger,
        maxInferenceRounds: safePositiveInteger,
        maxToolCalls: safePositiveInteger,
        attemptTimeoutMs: safePositiveInteger,
        episodeTimeoutMs: safePositiveInteger,
      })
      .strict()
      .superRefine((limits, context) => {
        if (limits.attemptTimeoutMs > limits.episodeTimeoutMs) {
          issue(
            context,
            ["attemptTimeoutMs"],
            "Attempt timeout cannot exceed episode timeout.",
          );
        }
      }),
    retryRule: z.literal("one_shot_no_retry_after_sent_or_unknown_v1"),
    statistics: z
      .object({
        wilsonIntervalId: z.literal("wilson-score-95-v1"),
        bootstrapAlgorithmId: z.literal("mulberry32-percentile-95-v1"),
        bootstrapSeedUint32: z.number().int().min(0).max(0xffff_ffff).safe(),
        bootstrapReplicateCount: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .safe(),
      })
      .strict(),
    campaignAuthorityId: boundedId,
    coordinator: z
      .object({
        signatureAlgorithm: z.literal("Ed25519"),
        verificationKeyFingerprint: Sha256Schema,
      })
      .strict(),
  })
  .strict();

export type HeldOutRunManifestV1 = z.infer<
  typeof HeldOutRunManifestV1Schema
>;

export function canonicalHeldOutRunManifestV1(input: unknown): string {
  return canonicalHeldOutJsonV1(HeldOutRunManifestV1Schema.parse(input));
}

export const HeldOutRunTelemetryV1Schema = z
  .object({
    inferenceAttemptCount: safeNonNegativeInteger,
    successfulToolCount: safeNonNegativeInteger,
    usage: z
      .object({
        inputTokens: safeNonNegativeInteger,
        outputTokens: safeNonNegativeInteger,
        reasoningTokens: safeNonNegativeInteger,
        cacheReadTokens: safeNonNegativeInteger,
        reportedAttempts: safeNonNegativeInteger,
      })
      .strict(),
    endToEndLatencyMs: safeNonNegativeNumber.nullable(),
    selectedTokenCostMicrousd: safeNonNegativeInteger.nullable(),
    selectedCostProvenance: z.enum([
      "no_dispatch",
      "local_zero_cost_policy",
      "provider_reported",
      "host_pricing_snapshot",
      "unknown",
    ]),
    infrastructureCostMicrousd: safeNonNegativeInteger.nullable(),
  })
  .strict()
  .superRefine((telemetry, context) => {
    const usage = telemetry.usage;
    if (usage.cacheReadTokens > usage.inputTokens) {
      issue(
        context,
        ["usage", "cacheReadTokens"],
        "Cache-read tokens cannot exceed aggregate input tokens.",
      );
    }
    if (
      usage.reportedAttempts === 0 &&
      (usage.inputTokens !== 0 ||
        usage.outputTokens !== 0 ||
        usage.reasoningTokens !== 0 ||
        usage.cacheReadTokens !== 0)
    ) {
      issue(
        context,
        ["usage"],
        "Zero reported attempts require every provider token count to be zero.",
      );
    }
    if (usage.reportedAttempts > 0 && usage.inputTokens === 0) {
      issue(
        context,
        ["usage", "inputTokens"],
        "Reported provider attempts require positive aggregate input tokens.",
      );
    }
    if (telemetry.selectedCostProvenance === "unknown") {
      if (telemetry.selectedTokenCostMicrousd !== null) {
        issue(
          context,
          ["selectedTokenCostMicrousd"],
          "Unknown cost provenance requires a null selected token cost.",
        );
      }
    } else if (telemetry.selectedTokenCostMicrousd === null) {
      issue(
        context,
        ["selectedTokenCostMicrousd"],
        "Known selected-cost provenance requires a numeric token cost.",
      );
    }
    if (
      (telemetry.selectedCostProvenance === "no_dispatch" ||
        telemetry.selectedCostProvenance === "local_zero_cost_policy") &&
      telemetry.selectedTokenCostMicrousd !== 0
    ) {
      issue(
        context,
        ["selectedTokenCostMicrousd"],
        "No-dispatch and local-zero-cost provenance require exactly zero token cost.",
      );
    }
    if (
      telemetry.selectedCostProvenance === "no_dispatch" &&
      (telemetry.inferenceAttemptCount !== 0 ||
        telemetry.usage.inputTokens !== 0 ||
        telemetry.usage.outputTokens !== 0 ||
        telemetry.usage.reasoningTokens !== 0 ||
        telemetry.usage.cacheReadTokens !== 0 ||
        telemetry.usage.reportedAttempts !== 0)
    ) {
      issue(
        context,
        ["selectedCostProvenance"],
        "No-dispatch provenance cannot contain inference attempts or provider usage.",
      );
    }
    if (
      telemetry.inferenceAttemptCount === 0 &&
      (telemetry.selectedCostProvenance !== "no_dispatch" ||
        telemetry.selectedTokenCostMicrousd !== 0 ||
        telemetry.usage.inputTokens !== 0 ||
        telemetry.usage.outputTokens !== 0 ||
        telemetry.usage.reasoningTokens !== 0 ||
        telemetry.usage.cacheReadTokens !== 0 ||
        telemetry.usage.reportedAttempts !== 0)
    ) {
      issue(
        context,
        ["inferenceAttemptCount"],
        "Zero inference attempts require no-dispatch provenance, zero selected token cost, and zero provider usage.",
      );
    }
    if (telemetry.usage.reportedAttempts > telemetry.inferenceAttemptCount) {
      issue(
        context,
        ["usage", "reportedAttempts"],
        "Reported usage attempts cannot exceed inference attempts.",
      );
    }
  });

export type HeldOutRunTelemetryV1 = z.infer<
  typeof HeldOutRunTelemetryV1Schema
>;

const HeldOutRunResultBaseV1Schema = z.object({
  schemaVersion: z.literal("heldout-run-result-v1"),
  ordinal: fixtureOrdinal,
  fixtureCommitment: Sha256Schema,
  telemetry: HeldOutRunTelemetryV1Schema,
});

const HeldOutRunFindingV1Schema = z
  .object({
    findingId: boundedId,
    evidenceRegions: z.array(HeldOutEvidenceRegionV1Schema).min(1).max(32),
    privateFindingSha256: Sha256Schema,
  })
  .strict();

const HeldOutAcceptedRunResultV1Schema = HeldOutRunResultBaseV1Schema.extend({
  outcome: z.literal("accepted"),
  conclusion: z.enum(["blocking_findings", "no_blocking_findings"]),
  freshness: z.literal("fresh_complete"),
  coverage: z
    .object({
      status: z.literal("complete"),
      snapshotRevalidated: z.literal(true),
      changedPaths: safeNonNegativeInteger,
      admittedPaths: safeNonNegativeInteger,
      omittedPaths: z.literal(0),
      changedHunks: safeNonNegativeInteger,
      admittedHunks: safeNonNegativeInteger,
      omittedHunks: z.literal(0),
      omissionCount: z.literal(0),
    })
    .strict(),
  findings: z.array(HeldOutRunFindingV1Schema).max(64),
  reviewResultSha256: Sha256Schema,
  safeTraceSha256: Sha256Schema,
})
  .strict()
  .superRefine((result, context) => {
    requireUnique(
      result.findings.map((finding) => finding.findingId),
      context,
      ["findings"],
      "Finding IDs",
    );
    if (
      result.coverage.admittedPaths + result.coverage.omittedPaths !==
        result.coverage.changedPaths ||
      result.coverage.admittedHunks + result.coverage.omittedHunks !==
        result.coverage.changedHunks
    ) {
      issue(
        context,
        ["coverage"],
        "Admitted and omitted coverage must partition changed counts.",
      );
    }
    if (result.telemetry.endToEndLatencyMs === null) {
      issue(
        context,
        ["telemetry", "endToEndLatencyMs"],
        "An accepted result requires measured end-to-end latency.",
      );
    }
    if (result.telemetry.inferenceAttemptCount < 1) {
      issue(
        context,
        ["telemetry", "inferenceAttemptCount"],
        "An accepted result requires at least one inference attempt.",
      );
    }
    if (
      result.telemetry.usage.reportedAttempts !==
      result.telemetry.inferenceAttemptCount
    ) {
      issue(
        context,
        ["telemetry", "usage", "reportedAttempts"],
        "An accepted result requires reported usage for every inference attempt.",
      );
    }
    if (result.telemetry.usage.inputTokens < 1) {
      issue(
        context,
        ["telemetry", "usage", "inputTokens"],
        "An accepted result requires positive reported input usage.",
      );
    }
    if (result.telemetry.usage.outputTokens < 1) {
      issue(
        context,
        ["telemetry", "usage", "outputTokens"],
        "An accepted result requires positive reported output usage.",
      );
    }
    if (result.telemetry.selectedCostProvenance === "no_dispatch") {
      issue(
        context,
        ["telemetry", "selectedCostProvenance"],
        "An accepted result cannot use no-dispatch cost provenance.",
      );
    }
    if (
      result.conclusion === "blocking_findings" &&
      result.findings.length === 0
    ) {
      issue(
        context,
        ["findings"],
        "A blocking conclusion requires at least one emitted finding.",
      );
    }
  });

function nonAcceptedRunResultSchema(
  outcome: "invalid" | "blocked" | "cancelled",
) {
  return HeldOutRunResultBaseV1Schema.extend({
    outcome: z.literal(outcome),
    failureCode: boundedId,
    safeTraceSha256: Sha256Schema.optional(),
  }).strict();
}

const HeldOutUnstartedRunResultV1Schema = HeldOutRunResultBaseV1Schema.extend({
  outcome: z.literal("unstarted"),
  failureCode: boundedId,
})
  .strict()
  .superRefine((result, context) => {
    const usage = result.telemetry.usage;
    if (
      result.telemetry.inferenceAttemptCount !== 0 ||
      result.telemetry.successfulToolCount !== 0 ||
      usage.inputTokens !== 0 ||
      usage.outputTokens !== 0 ||
      usage.reasoningTokens !== 0 ||
      usage.cacheReadTokens !== 0 ||
      usage.reportedAttempts !== 0 ||
      result.telemetry.endToEndLatencyMs !== null ||
      result.telemetry.selectedTokenCostMicrousd !== 0 ||
      result.telemetry.selectedCostProvenance !== "no_dispatch"
    ) {
      issue(
        context,
        ["telemetry"],
        "An unstarted result cannot contain execution or latency evidence.",
      );
    }
  });

export const HeldOutRunResultV1Schema = z.discriminatedUnion("outcome", [
  HeldOutAcceptedRunResultV1Schema,
  nonAcceptedRunResultSchema("invalid"),
  nonAcceptedRunResultSchema("blocked"),
  nonAcceptedRunResultSchema("cancelled"),
  HeldOutUnstartedRunResultV1Schema,
]);

export type HeldOutRunResultV1 = z.infer<
  typeof HeldOutRunResultV1Schema
>;

export const HeldOutRunResultsV1Schema = z
  .object({
    schemaVersion: z.literal("heldout-run-results-v1"),
    protocolId: z.literal(HELD_OUT_REVIEW_PROTOCOL_ID),
    evaluatorVersion: z.literal(HELD_OUT_EVALUATOR_VERSION),
    setVersion: boundedId,
    setCommitment: Sha256Schema,
    runManifestSha256: Sha256Schema,
    results: z.array(HeldOutRunResultV1Schema).length(HELD_OUT_FIXTURE_COUNT),
  })
  .strict()
  .superRefine((bundle, context) => {
    requireExactOrderedOrdinals(bundle.results, context, ["results"]);
    requireUnique(
      bundle.results.map((result) => result.fixtureCommitment),
      context,
      ["results"],
      "Result fixture commitments",
    );
  });

export type HeldOutRunResultsV1 = z.infer<
  typeof HeldOutRunResultsV1Schema
>;

export function validateHeldOutRunResultsV1(input: {
  runner: unknown;
  manifest: unknown;
  runManifestSha256: unknown;
  runResults: unknown;
}): HeldOutRunResultsV1 {
  const runner = HeldOutRunnerBundleV1Schema.parse(input.runner);
  const manifest = HeldOutRunManifestV1Schema.parse(input.manifest);
  const runManifestSha256 = Sha256Schema.parse(input.runManifestSha256);
  const runResults = HeldOutRunResultsV1Schema.parse(input.runResults);
  if (
    runner.setVersion !== manifest.setVersion ||
    runner.setVersion !== runResults.setVersion ||
    runner.setCommitment !== manifest.setCommitment ||
    runner.setCommitment !== runResults.setCommitment ||
    runResults.runManifestSha256 !== runManifestSha256
  ) {
    throw new TypeError("Runner, manifest, and result bindings differ.");
  }
  if (
    manifest.policy === "cloud_synthesis_all_eval" &&
    runResults.results.some(
      (result) =>
        result.telemetry.selectedCostProvenance === "local_zero_cost_policy",
    )
  ) {
    throw new TypeError(
      "A cloud-only run cannot claim local-zero-cost provenance.",
    );
  }
  runner.fixtures.forEach((fixture, index) => {
    const result = runResults.results[index];
    if (
      !result ||
      result.ordinal !== fixture.ordinal ||
      result.fixtureCommitment !== fixture.fixtureCommitment
    ) {
      throw new TypeError("Result does not match its ordered fixture.");
    }
    const telemetry = result.telemetry;
    const usage = telemetry.usage;
    if (
      telemetry.inferenceAttemptCount > manifest.limits.maxInferenceRounds ||
      telemetry.successfulToolCount > manifest.limits.maxToolCalls ||
      (telemetry.endToEndLatencyMs !== null &&
        telemetry.endToEndLatencyMs > manifest.limits.episodeTimeoutMs)
    ) {
      throw new TypeError(
        "Run result exceeds the committed manifest execution envelope.",
      );
    }
    const reportedAttempts = BigInt(usage.reportedAttempts);
    const maximumInputTokens =
      BigInt(manifest.limits.maxInputTokens) * reportedAttempts;
    const maximumOutputTokens =
      BigInt(manifest.limits.maxOutputTokens) * reportedAttempts;
    if (
      BigInt(usage.inputTokens) > maximumInputTokens ||
      BigInt(usage.outputTokens) + BigInt(usage.reasoningTokens) >
        maximumOutputTokens
    ) {
      throw new TypeError(
        "Run result exceeds the committed manifest token envelope.",
      );
    }
  });
  return runResults;
}
