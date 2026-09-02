import { describe, expect, it } from "vitest";

import { sha256Hex } from "../../src/shared/context-compiler";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  reviewResultV1ResponseFormat,
} from "../../src/shared/review-result-contract";
import {
  CloudApplicationBodyV1Schema,
  CloudApplicationRequestV1Schema,
  PR6R_ALLOWLISTED_NON_SECRET_HEADERS,
  PR6R_CALIBRATION_SET_ID,
  PR6R_CAMPAIGN_ID,
  PR6R_CAMPAIGN_FALLBACK_ID,
  PR6R_COMMON_INVESTIGATION_ID,
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_V1,
  PR6R_FIXTURE_CHANGED_LINE_COUNT,
  PR6R_FIXTURE_CHANGED_PATHS,
  PR6R_FIXTURE_DISCOVERY_SHA256,
  PR6R_FIXTURE_ID,
  PR6R_FIXTURE_INDEX_SHA256,
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_FROZEN_FIXTURE_V1,
  PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH,
  PR6R_MAX_ADMITTED_INPUT_TOKENS,
  PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES,
  PR6R_MAX_CANONICAL_PACKET_BYTES,
  PR6R_MAX_COMMON_TOOL_CALLS,
  PR6R_MAX_RECORDED_DURATION_MS,
  PR6R_MAX_SIMULATED_RESERVATION_MICROUSD,
  PR6R_MODEL_SLUG,
  PR6R_OS_AUTHORITY_CLAIM_ID,
  PR6R_PROVIDER_VALIDATION_ID,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHESIS_SLOT_IDS,
  PR6R_SYNTHESIS_SLOTS_V1,
  PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  Pr6rCampaignV1Schema,
  Pr6rCommonCheckpointV1Schema,
  Pr6rCommonInvestigationV1Schema,
  Pr6rComparisonV1Schema,
  Pr6rDevelopmentAuthorityV1Schema,
  Pr6rFixtureV1Schema,
  Pr6rLoopbackProviderValidationV1Schema,
  Pr6rOsAuthorityClaimV1Schema,
  Pr6rOutputValidityV1Schema,
  Pr6rPostSchemaValidityDeferredOutputValidityV1Schema,
  Pr6rSafeProjectionV1Schema,
  Pr6rSimulationCostV1Schema,
  Pr6rSimulationPricingSnapshotV1Schema,
  Pr6rSynthesisSlotsV1Schema,
  Pr6rTokenAccountingV1Schema,
  buildPr6rCommonCheckpointV1,
  buildPr6rCommonInvestigationV1,
  buildPr6rLoopbackProviderValidationV1,
  buildPr6rOsAuthorityClaimV1,
  buildPr6rSimulationPricingSnapshotV1,
  calculatePr6rHostPricedSimulationCostMicrousd,
  canonicalPr6rCloudApplicationRequestSha256,
  canonicalPr6rCommonCheckpointSha256,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResultSha256,
  projectPr6rSafeCampaignFallbackStateV1,
  sealCloudApplicationRequestV1,
  type CloudApplicationRequestV1,
  type Pr6rCommonCheckpointV1,
} from "../../src/shared/pr6r-development-contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const PARENT_SESSION_ID = "pr6r-parent-session";
const PACKET_UTF8 = '{"fixture":"cal-007","scope":"public"}';
const IMPLEMENTATION_REVISION = "1".repeat(40);
const CLAIMED_AT = "2026-09-02T00:00:00.000Z";
const VALIDATED_AT = "2026-09-02T00:00:01.000Z";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function applicationBody() {
  return {
    model: PR6R_MODEL_SLUG,
    messages: [
      { role: "system", content: "Review the frozen public change. 你好" },
      { role: "user", content: "Return only the strict review result." },
    ],
    max_completion_tokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    temperature: 0,
    stream: false,
    response_format: reviewResultV1ResponseFormat(),
    provider: {
      only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
}

function commonCheckpoint(): Pr6rCommonCheckpointV1 {
  return buildPr6rCommonCheckpointV1({
    parentSessionId: PARENT_SESSION_ID,
    packetUtf8: PACKET_UTF8,
    semanticMessages: applicationBody().messages,
  });
}

function sealInput(body: unknown = applicationBody()) {
  return {
    requestId: "request-1",
    parentSessionId: PARENT_SESSION_ID,
    synthesisSessionId: "cloud-session-1",
    attemptId: "attempt-1",
    slotId: "cloud_synthesis" as const,
    commonCheckpoint: commonCheckpoint(),
    packetUtf8: PACKET_UTF8,
    origin: "http://127.0.0.1:43117",
    body,
  };
}

function sealedRequest(): CloudApplicationRequestV1 {
  return sealCloudApplicationRequestV1(sealInput());
}

function osAuthorityClaim() {
  return buildPr6rOsAuthorityClaimV1({
    implementationRevision: IMPLEMENTATION_REVISION,
    claimedAt: CLAIMED_AT,
    ledgerCampaignRecordSha256: HASH_D,
    ledgerGuardRecordSha256: HASH_E,
  });
}

function providerValidation() {
  return buildPr6rLoopbackProviderValidationV1({
    implementationRevision: IMPLEMENTATION_REVISION,
    validatedAt: VALIDATED_AT,
  });
}

function pricingSnapshot() {
  const validation = providerValidation();
  return buildPr6rSimulationPricingSnapshotV1({
    implementationRevision: IMPLEMENTATION_REVISION,
    providerValidationSha256: validation.validationSha256,
    validatedAt: VALIDATED_AT,
  });
}

function commonInvestigation(checkpoint = commonCheckpoint()) {
  return buildPr6rCommonInvestigationV1({
    implementationRevision: IMPLEMENTATION_REVISION,
    parentSessionId: PARENT_SESSION_ID,
    commonCheckpointSha256: checkpoint.checkpointSha256,
    durationMs: 2_500,
    toolCallCount: 7,
  });
}

function unreportedTokens() {
  return {
    schemaVersion: "pr6r-token-accounting-v1" as const,
    reported: false as const,
    provenance: "provider_unreported" as const,
    inputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    visibleOutputTokens: null,
    totalTokens: null,
  };
}

function reportedTokens() {
  return {
    schemaVersion: "pr6r-token-accounting-v1" as const,
    reported: true as const,
    provenance: "provider_reported" as const,
    inputTokens: 600,
    cacheReadTokens: 100,
    cacheWriteTokens: 0,
    reasoningTokens: 50,
    visibleOutputTokens: 25,
    totalTokens: 675,
  };
}

function unavailableOutputValidity() {
  return {
    schemaVersion: "pr6r-output-validity-v1" as const,
    status: "not_available" as const,
    schemaAccepted: null,
    citationSupport: null,
    evidenceIntegrity: null,
    snapshotFreshness: null,
    coverageComplete: null,
  };
}

function deferredOutputValidity() {
  return {
    schemaVersion: "pr6r-output-validity-v1" as const,
    status: "post_schema_validity_deferred" as const,
    schemaAccepted: true as const,
    citationSupport: null,
    evidenceIntegrity: null,
    snapshotFreshness: null,
    coverageComplete: null,
  };
}

function callerAssertedPassedOutputValidity() {
  return {
    schemaVersion: "pr6r-output-validity-v1" as const,
    status: "passed" as const,
    schemaAccepted: true as const,
    citationSupport: true as const,
    evidenceIntegrity: true as const,
    snapshotFreshness: true as const,
    coverageComplete: true as const,
  };
}

function failedOutputValidity() {
  return {
    schemaVersion: "pr6r-output-validity-v1" as const,
    status: "failed" as const,
    schemaAccepted: false,
    citationSupport: false,
    evidenceIntegrity: false,
    snapshotFreshness: false,
    coverageComplete: false,
  };
}

function postSchemaFailedOutputValidity() {
  return {
    schemaVersion: "pr6r-output-validity-v1" as const,
    status: "failed" as const,
    schemaAccepted: true as const,
    citationSupport: false,
    evidenceIntegrity: true,
    snapshotFreshness: true,
    coverageComplete: false,
  };
}

function fallbackAvailable() {
  return {
    schemaVersion: "pr6r-campaign-fallback-state-v1" as const,
    fallbackId: PR6R_CAMPAIGN_FALLBACK_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false as const,
    actualExternalSpendMicrousd: 0 as const,
    state: "available" as const,
    triggerSlotId: null,
    triggerTerminalSha256: null,
    fallbackClaimSha256: null,
    claimedAt: null,
    resolution: null,
    sourceSlotId: null,
    sourceSynthesisSessionId: null,
    sourceReviewResultSha256: null,
    terminalAt: null,
    terminalReason: null,
  };
}

function fullNotReservedCost() {
  return {
    schemaVersion: "pr6r-simulation-cost-v1" as const,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    pricingSnapshotSha256: pricingSnapshot().pricingSnapshotSha256,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false as const,
    actualExternalSpendMicrousd: 0 as const,
    settlementState: "not_reserved" as const,
    reservationId: null,
    projectedMicrousd: 0 as const,
    reservedMicrousd: 0 as const,
    settledMicrousd: 0 as const,
    provenance: "not_settled" as const,
  };
}

function fullSettledCost(
  reservationId = "simulation-reservation-1",
) {
  return {
    schemaVersion: "pr6r-simulation-cost-v1" as const,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    pricingSnapshotSha256: pricingSnapshot().pricingSnapshotSha256,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false as const,
    actualExternalSpendMicrousd: 0 as const,
    settlementState: "settled" as const,
    reservationId,
    projectedMicrousd: 2_500,
    reservedMicrousd: 3_000,
    settledMicrousd: 800,
    provenance: "host_pricing_snapshot" as const,
  };
}

function fullUnknownCost(
  reservationId = "simulation-reservation-1",
) {
  return {
    schemaVersion: "pr6r-simulation-cost-v1" as const,
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    pricingSnapshotSha256: pricingSnapshot().pricingSnapshotSha256,
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false as const,
    actualExternalSpendMicrousd: 0 as const,
    settlementState: "unknown" as const,
    reservationId,
    projectedMicrousd: 2_500,
    reservedMicrousd: 3_000,
    settledMicrousd: null,
    provenance: "reserved_unknown" as const,
  };
}

function safeNotReservedCost() {
  const { reservationId: _reservationId, ...safe } = fullNotReservedCost();
  return {
    ...safe,
    schemaVersion: "pr6r-safe-simulation-cost-v1" as const,
  };
}

function safeSettledCost() {
  const { reservationId: _reservationId, ...safe } = fullSettledCost();
  return {
    ...safe,
    schemaVersion: "pr6r-safe-simulation-cost-v1" as const,
  };
}

function safeUnknownCost() {
  const { reservationId: _reservationId, ...safe } = fullUnknownCost();
  return {
    ...safe,
    schemaVersion: "pr6r-safe-simulation-cost-v1" as const,
  };
}

function campaign() {
  const checkpoint = commonCheckpoint();
  return {
    schemaVersion: "pr6r-campaign-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    authority: PR6R_DEVELOPMENT_AUTHORITY_V1,
    osAuthorityClaim: osAuthorityClaim(),
    providerValidation: providerValidation(),
    pricingSnapshot: pricingSnapshot(),
    fixture: PR6R_FROZEN_FIXTURE_V1,
    parent: {
      sessionId: PARENT_SESSION_ID,
      commonCheckpoint: checkpoint,
    },
    commonInvestigation: commonInvestigation(checkpoint),
    synthesisDecisions: PR6R_SYNTHESIS_SLOTS_V1.map((slot) => ({
      schemaVersion: "pr6r-synthesis-decision-v1",
      slot,
      parentSessionId: PARENT_SESSION_ID,
      commonCheckpointSha256: checkpoint.checkpointSha256,
    })),
    fallbackState: fallbackAvailable(),
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
  };
}

function reviewResult() {
  return {
    schemaVersion: "change-review-result-v1",
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: "No blocking findings were identified in the admitted evidence.",
    conclusion: "no_blocking_findings",
    evidenceSetId: HASH_E,
    omissions: [],
    findings: [],
  };
}

function reviewResultWithEvidencePath(path: string) {
  return {
    ...reviewResult(),
    conclusion: "blocking_findings" as const,
    findings: [
      {
        findingId: "finding-1",
        severity: "P2" as const,
        title: "A bounded finding",
        impact: "The admitted change may behave incorrectly.",
        suggestedCorrection: "Keep the correction inside the admitted change.",
        suggestedTest: "Exercise the corrected behavior with a focused test.",
        evidence: [
          {
            kind: "change" as const,
            snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
            path,
            side: "working" as const,
            line: 1,
            hunkSha256: HASH_A,
          },
        ],
      },
    ],
  };
}

function reviewResultWithRepositoryObservation(observationId: string) {
  return {
    ...reviewResult(),
    conclusion: "blocking_findings" as const,
    findings: [
      {
        findingId: "finding-1",
        severity: "P2" as const,
        title: "A bounded repository finding",
        impact: "The admitted change may behave incorrectly.",
        suggestedCorrection: "Keep the correction inside the admitted change.",
        suggestedTest: "Exercise the corrected behavior with a focused test.",
        evidence: [
          {
            kind: "repository" as const,
            snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
            evidenceSetId: HASH_E,
            observationId,
            path: "src/flask/templating.py",
            line: 1,
            contentSha256: HASH_A,
          },
        ],
      },
    ],
  };
}

function comparison() {
  const checkpoint = commonCheckpoint();
  const checkpointSha256 = checkpoint.checkpointSha256;
  return {
    schemaVersion: "pr6r-comparison-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    fixtureId: PR6R_FIXTURE_ID,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    parentSessionId: PARENT_SESSION_ID,
    commonCheckpointSha256: checkpointSha256,
    osAuthorityClaim: osAuthorityClaim(),
    providerValidation: providerValidation(),
    pricingSnapshot: pricingSnapshot(),
    commonInvestigation: commonInvestigation(checkpoint),
    fallbackState: fallbackAvailable(),
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    synthesisDecisions: [
      {
        slotId: "local_synthesis",
        ordinal: 1,
        parentSessionId: PARENT_SESSION_ID,
        synthesisSessionId: "local-session-1",
        commonCheckpointSha256: checkpointSha256,
        state: "completed",
        requestDisposition: null,
        applicationRequestSha256: null,
        authoritySlotClaimSha256: null,
        authoritySlotTerminalSha256: null,
        requestBodySha256: null,
        responseBodySha256: null,
        reviewResultSha256: HASH_B,
        synthesisLatencyMs: 800,
        tokenAccounting: reportedTokens(),
        simulationCost: fullNotReservedCost(),
        outputValidity: deferredOutputValidity(),
        terminalReason: "completed",
      },
      {
        slotId: "cloud_synthesis",
        ordinal: 2,
        parentSessionId: PARENT_SESSION_ID,
        synthesisSessionId: "cloud-session-1",
        commonCheckpointSha256: checkpointSha256,
        state: "failed",
        requestDisposition: "sent",
        applicationRequestSha256: HASH_A,
        authoritySlotClaimSha256: HASH_B,
        authoritySlotTerminalSha256: HASH_F,
        requestBodySha256: HASH_C,
        responseBodySha256: HASH_D,
        reviewResultSha256: null,
        synthesisLatencyMs: 900,
        tokenAccounting: reportedTokens(),
        simulationCost: fullSettledCost(),
        outputValidity: failedOutputValidity(),
        terminalReason: "loopback.invalid_response",
      },
      {
        slotId: "hybrid_cloud_if_selected",
        ordinal: 3,
        parentSessionId: PARENT_SESSION_ID,
        synthesisSessionId: null,
        commonCheckpointSha256: checkpointSha256,
        state: "not_selected",
        requestDisposition: null,
        applicationRequestSha256: null,
        authoritySlotClaimSha256: null,
        authoritySlotTerminalSha256: null,
        requestBodySha256: null,
        responseBodySha256: null,
        reviewResultSha256: null,
        synthesisLatencyMs: null,
        tokenAccounting: unreportedTokens(),
        simulationCost: fullNotReservedCost(),
        outputValidity: unavailableOutputValidity(),
        terminalReason: "route.not_selected",
      },
    ],
  };
}

function safeProjection() {
  const result = reviewResult();
  const checkpoint = commonCheckpoint();
  return {
    schemaVersion: "pr6r-safe-projection-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    fixtureId: PR6R_FIXTURE_ID,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    commonCheckpointSha256: checkpoint.checkpointSha256,
    packetSha256: checkpoint.packetSha256,
    semanticMessagesSha256: checkpoint.semanticMessagesSha256,
    outputContractSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    osAuthorityClaim: {
      authorityClaimId: PR6R_OS_AUTHORITY_CLAIM_ID,
      authorityClaimSha256: osAuthorityClaim().authorityClaimSha256,
      implementationRevision: IMPLEMENTATION_REVISION,
      storageScope: "os_user_local",
      claimedAt: CLAIMED_AT,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
    },
    providerValidation: {
      validationId: PR6R_PROVIDER_VALIDATION_ID,
      validationSha256: providerValidation().validationSha256,
      syntheticProviderId: PR6R_SYNTHETIC_PROVIDER_ID,
      implementationRevision: IMPLEMENTATION_REVISION,
      model: PR6R_MODEL_SLUG,
      upstreamSlug: PR6R_SYNTHETIC_UPSTREAM_SLUG,
      providerKind: "synthetic_loopback",
      transport: "loopback_only",
      validationOutcome: "accepted",
      validatedAt: VALIDATED_AT,
      externalProviderContact: false,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
    },
    pricingSnapshot: {
      pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
      pricingSnapshotSha256: pricingSnapshot().pricingSnapshotSha256,
      providerValidationId: PR6R_PROVIDER_VALIDATION_ID,
      providerValidationSha256: providerValidation().validationSha256,
      implementationRevision: IMPLEMENTATION_REVISION,
      model: PR6R_MODEL_SLUG,
      upstreamSlug: PR6R_SYNTHETIC_UPSTREAM_SLUG,
      currency: "USD",
      rateUnit: "microusd_per_million_tokens",
      inputRateMicrousdPerMillion:
        PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
      outputRateMicrousdPerMillion:
        PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
      cacheReadRateMicrousdPerMillion: 0,
      cacheWriteRateMicrousdPerMillion: 0,
      reasoningBilling: "included_in_output",
      source: "synthetic_fixed_v1",
      costScope: PR6R_COST_SCOPE,
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
    },
    commonInvestigation: {
      investigationId: PR6R_COMMON_INVESTIGATION_ID,
      investigationSha256:
        commonInvestigation(checkpoint).investigationSha256,
      implementationRevision: IMPLEMENTATION_REVISION,
      durationMs: 2_500,
      toolCallCount: 7,
      terminalReason: "completed",
    },
    fallbackState: projectPr6rSafeCampaignFallbackStateV1(
      fallbackAvailable(),
    ),
    costScope: PR6R_COST_SCOPE,
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    synthesisDecisions: [
      {
        slotId: "local_synthesis",
        ordinal: 1,
        state: "completed",
        requestDisposition: null,
        synthesisLatencyMs: 800,
        tokenAccounting: reportedTokens(),
        simulationCost: safeNotReservedCost(),
        outputValidity: deferredOutputValidity(),
        terminalReason: "completed",
        output: {
          reviewResult: result,
          reviewResultSha256: canonicalPr6rReviewResultSha256(result),
        },
      },
      {
        slotId: "cloud_synthesis",
        ordinal: 2,
        state: "failed",
        requestDisposition: "sent",
        synthesisLatencyMs: 900,
        tokenAccounting: reportedTokens(),
        simulationCost: safeSettledCost(),
        outputValidity: failedOutputValidity(),
        terminalReason: "loopback.invalid_response",
        output: null,
      },
      {
        slotId: "hybrid_cloud_if_selected",
        ordinal: 3,
        state: "not_selected",
        requestDisposition: null,
        synthesisLatencyMs: null,
        tokenAccounting: unreportedTokens(),
        simulationCost: safeNotReservedCost(),
        outputValidity: unavailableOutputValidity(),
        terminalReason: "route.not_selected",
        output: null,
      },
    ],
  };
}

describe("PR6R-A1 frozen development contracts", () => {
  it("freezes the exact cal-007 identity, nine paths, 62 lines, hashes, and bounds", () => {
    expect(Pr6rFixtureV1Schema.parse(PR6R_FROZEN_FIXTURE_V1)).toEqual(
      PR6R_FROZEN_FIXTURE_V1,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.calibrationSetId).toBe(
      PR6R_CALIBRATION_SET_ID,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.fixtureId).toBe(PR6R_FIXTURE_ID);
    expect(PR6R_FROZEN_FIXTURE_V1.snapshotId).toBe(
      PR6R_FIXTURE_SNAPSHOT_ID,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.indexSha256).toBe(
      PR6R_FIXTURE_INDEX_SHA256,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.discoverySha256).toBe(
      PR6R_FIXTURE_DISCOVERY_SHA256,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.changedPaths).toEqual(
      PR6R_FIXTURE_CHANGED_PATHS,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.changedPaths).toHaveLength(9);
    expect(PR6R_FROZEN_FIXTURE_V1.changedLineCount).toBe(
      PR6R_FIXTURE_CHANGED_LINE_COUNT,
    );
    expect(PR6R_FROZEN_FIXTURE_V1.bounds).toEqual({
      maxCanonicalPacketBytes: PR6R_MAX_CANONICAL_PACKET_BYTES,
      maxAdmittedInputTokens: PR6R_MAX_ADMITTED_INPUT_TOKENS,
      requestedOutputTokens: PR6R_REQUESTED_OUTPUT_TOKENS,
    });
    expect(Object.isFrozen(PR6R_FROZEN_FIXTURE_V1)).toBe(true);
    expect(Object.isFrozen(PR6R_FROZEN_FIXTURE_V1.changedPaths)).toBe(true);
    expect(Object.isFrozen(PR6R_FROZEN_FIXTURE_V1.bounds)).toBe(true);
  });

  it("fails closed on any fixture path, count, hash, bound, or unknown field drift", () => {
    const driftCases = [
      { ...clone(PR6R_FROZEN_FIXTURE_V1), changedLineCount: 61 },
      { ...clone(PR6R_FROZEN_FIXTURE_V1), indexSha256: HASH_A },
      {
        ...clone(PR6R_FROZEN_FIXTURE_V1),
        changedPaths: [...PR6R_FIXTURE_CHANGED_PATHS].reverse(),
      },
      {
        ...clone(PR6R_FROZEN_FIXTURE_V1),
        bounds: {
          ...PR6R_FROZEN_FIXTURE_V1.bounds,
          maxCanonicalPacketBytes: PR6R_MAX_CANONICAL_PACKET_BYTES + 1,
        },
      },
      { ...clone(PR6R_FROZEN_FIXTURE_V1), rawFixture: "forbidden" },
    ];
    for (const drift of driftCases) {
      expect(Pr6rFixtureV1Schema.safeParse(drift).success).toBe(false);
    }
  });

  it("admits only the fixed simulation authority and fixed ordered slots", () => {
    expect(
      Pr6rDevelopmentAuthorityV1Schema.parse(
        PR6R_DEVELOPMENT_AUTHORITY_V1,
      ),
    ).toEqual(PR6R_DEVELOPMENT_AUTHORITY_V1);
    expect(PR6R_DEVELOPMENT_AUTHORITY_V1.costScope).toBe("simulation");
    expect(PR6R_DEVELOPMENT_AUTHORITY_V1.actualPaidAuthority).toBe(false);
    expect(PR6R_DEVELOPMENT_AUTHORITY_V1.maxExternalProviderRequests).toBe(0);
    expect(PR6R_DEVELOPMENT_AUTHORITY_V1.maxActualExternalSpendMicrousd).toBe(
      0,
    );
    expect(PR6R_SYNTHESIS_SLOTS_V1.map((slot) => slot.slotId)).toEqual(
      PR6R_SYNTHESIS_SLOT_IDS,
    );
    expect(Pr6rSynthesisSlotsV1Schema.parse(PR6R_SYNTHESIS_SLOTS_V1)).toEqual(
      PR6R_SYNTHESIS_SLOTS_V1,
    );
    expect(Object.isFrozen(PR6R_DEVELOPMENT_AUTHORITY_V1)).toBe(true);
    expect(Object.isFrozen(PR6R_SYNTHESIS_SLOTS_V1)).toBe(true);

    expect(
      Pr6rDevelopmentAuthorityV1Schema.safeParse({
        ...PR6R_DEVELOPMENT_AUTHORITY_V1,
        costScope: "actual",
      }).success,
    ).toBe(false);
    expect(
      Pr6rDevelopmentAuthorityV1Schema.safeParse({
        ...PR6R_DEVELOPMENT_AUTHORITY_V1,
        actualPaidAuthority: true,
      }).success,
    ).toBe(false);
    expect(
      Pr6rSynthesisSlotsV1Schema.safeParse([
        PR6R_SYNTHESIS_SLOTS_V1[1],
        PR6R_SYNTHESIS_SLOTS_V1[0],
        PR6R_SYNTHESIS_SLOTS_V1[2],
      ]).success,
    ).toBe(false);
  });
});

describe("PR6R-A1 sealed CloudApplicationRequestV1", () => {
  it("derives and binds the canonical common-checkpoint preimage", () => {
    const checkpoint = commonCheckpoint();
    const preimage = {
      schemaVersion: "pr6r-common-checkpoint-preimage-v1",
      campaignId: checkpoint.campaignId,
      parentSessionId: checkpoint.parentSessionId,
      fixtureId: checkpoint.fixtureId,
      snapshotId: checkpoint.snapshotId,
      packetSha256: checkpoint.packetSha256,
      semanticMessagesSha256: checkpoint.semanticMessagesSha256,
      responseSchemaSha256: checkpoint.responseSchemaSha256,
      packetByteLength: checkpoint.packetByteLength,
      estimatedInputTokens: checkpoint.estimatedInputTokens,
      requestedOutputTokens: checkpoint.requestedOutputTokens,
      costScope: checkpoint.costScope,
    };
    expect(checkpoint.checkpointSha256).toBe(
      canonicalPr6rCommonCheckpointSha256(preimage),
    );
    expect(checkpoint.packetSha256).toBe(sha256Hex(PACKET_UTF8));
    expect(checkpoint.packetByteLength).toBe(
      new TextEncoder().encode(PACKET_UTF8).byteLength,
    );
    expect(Object.isFrozen(checkpoint)).toBe(true);

    expect(
      Pr6rCommonCheckpointV1Schema.safeParse({
        ...checkpoint,
        packetSha256: HASH_A,
      }).success,
    ).toBe(false);
    expect(() =>
      buildPr6rCommonCheckpointV1({
        parentSessionId: PARENT_SESSION_ID,
        packetUtf8: JSON.stringify(JSON.parse(PACKET_UTF8), null, 2),
        semanticMessages: applicationBody().messages,
      }),
    ).toThrow(/canonical JSON bytes/u);
  });

  it("seals the exact model, loopback path, synthetic identities, headers, and canonical UTF-8 body", () => {
    const request = sealedRequest();
    const parsedBody = CloudApplicationBodyV1Schema.parse(applicationBody());
    const checkpoint = commonCheckpoint();

    expect(CloudApplicationRequestV1Schema.parse(request)).toEqual(request);
    expect(request.model).toBe(PR6R_MODEL_SLUG);
    expect(request.path).toBe(PR6R_LOOPBACK_CHAT_COMPLETIONS_PATH);
    expect(request.upstreamSlug).toBe(PR6R_SYNTHETIC_UPSTREAM_SLUG);
    expect(request.credentialMetadataId).toBe(
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    );
    expect(request.headers).toEqual(PR6R_ALLOWLISTED_NON_SECRET_HEADERS);
    expect(request.costScope).toBe("simulation");
    expect(request.actualPaidAuthority).toBe(false);
    expect(request.commonCheckpoint).toEqual(checkpoint);
    expect(request.commonCheckpointSha256).toBe(checkpoint.checkpointSha256);
    expect(request.semanticMessagesSha256).toBe(
      checkpoint.semanticMessagesSha256,
    );
    expect(request.packetSha256).toBe(sha256Hex(PACKET_UTF8));
    expect(request.packetByteLength).toBe(
      new TextEncoder().encode(PACKET_UTF8).byteLength,
    );
    expect(request.canonicalBodyUtf8).toBe(
      canonicalPr6rJsonV1(parsedBody),
    );
    expect(request.canonicalBodyByteLength).toBe(
      new TextEncoder().encode(request.canonicalBodyUtf8).byteLength,
    );
    expect(request.canonicalBodySha256).toBe(
      sha256Hex(request.canonicalBodyUtf8),
    );
    expect(request.canonicalBodyByteLength).toBeLessThanOrEqual(
      PR6R_MAX_CANONICAL_APPLICATION_BODY_BYTES,
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
  });

  it("hashes the fully parsed sealed request and changes on an admitted mutation", () => {
    const request = sealedRequest();
    const requestSha256 = canonicalPr6rCloudApplicationRequestSha256(request);

    expect(requestSha256).toBe(
      sha256Hex(canonicalPr6rJsonV1(request)),
    );
    expect(canonicalPr6rCloudApplicationRequestSha256(request)).toBe(
      requestSha256,
    );
    expect(
      canonicalPr6rCloudApplicationRequestSha256({
        ...request,
        requestId: "request-2",
      }),
    ).not.toBe(requestSha256);
    expect(() =>
      canonicalPr6rCloudApplicationRequestSha256({
        ...request,
        canonicalBodySha256: HASH_A,
      }),
    ).toThrow();
  });

  it("rejects message, packet, checkpoint, and measured-bound drift", () => {
    expect(() =>
      sealCloudApplicationRequestV1({
        ...sealInput(),
        body: {
          ...applicationBody(),
          messages: [
            { role: "system", content: "Different admitted instructions." },
            applicationBody().messages[1],
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      sealCloudApplicationRequestV1({
        ...sealInput(),
        packetUtf8: '{"fixture":"different"}',
      }),
    ).toThrow(/packet bytes/u);
    expect(() =>
      sealCloudApplicationRequestV1({
        ...sealInput(),
        commonCheckpoint: {
          ...commonCheckpoint(),
          estimatedInputTokens: 1,
        },
      }),
    ).toThrow();
    expect(() =>
      buildPr6rCommonCheckpointV1({
        parentSessionId: PARENT_SESSION_ID,
        packetUtf8: canonicalPr6rJsonV1({
          content: "x".repeat(PR6R_MAX_CANONICAL_PACKET_BYTES),
        }),
        semanticMessages: applicationBody().messages,
      }),
    ).toThrow();
    expect(() =>
      buildPr6rCommonCheckpointV1({
        parentSessionId: PARENT_SESSION_ID,
        packetUtf8: PACKET_UTF8,
        semanticMessages: [
          {
            role: "system",
            content: "x".repeat(PR6R_MAX_ADMITTED_INPUT_TOKENS),
          },
          { role: "user", content: "bounded" },
        ],
      }),
    ).toThrow();
  });

  it("rejects non-loopback origins, localhost, path drift, and secret or unknown headers", () => {
    const request = sealedRequest();
    const invalid = [
      { ...request, origin: "https://openrouter.ai" },
      { ...request, origin: "http://localhost:43117" },
      { ...request, origin: "http://127.0.0.1:43117/path" },
      { ...request, path: "/v1/chat/completions" },
      {
        ...request,
        headers: { ...request.headers, authorization: "Bearer forbidden" },
      },
      { ...request, rawRequestBytes: request.canonicalBodyUtf8 },
    ];
    for (const candidate of invalid) {
      expect(CloudApplicationRequestV1Schema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  it("requires Cloud synthesis to use a child session distinct from the campaign parent", () => {
    expect(() =>
      sealCloudApplicationRequestV1({
        ...sealInput(),
        synthesisSessionId: PARENT_SESSION_ID,
      }),
    ).toThrow(/child session distinct/u);
    expect(
      CloudApplicationRequestV1Schema.safeParse({
        ...sealedRequest(),
        synthesisSessionId: PARENT_SESSION_ID,
      }).success,
    ).toBe(false);
  });

  it("rejects model, provider-routing, tool, and response-schema drift before sealing", () => {
    expect(() =>
      sealCloudApplicationRequestV1(
        sealInput({ ...applicationBody(), model: "another-model" }),
      ),
    ).toThrow();
    expect(() =>
      sealCloudApplicationRequestV1(
        sealInput({ ...applicationBody(), tools: [] }),
      ),
    ).toThrow();
    expect(() =>
      sealCloudApplicationRequestV1(
        sealInput({
          ...applicationBody(),
          provider: {
            only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
            order: ["another-upstream"],
            allow_fallbacks: false,
            require_parameters: true,
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      sealCloudApplicationRequestV1(
        sealInput({
          ...applicationBody(),
          provider: {
            only: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
            order: [PR6R_SYNTHETIC_UPSTREAM_SLUG],
            allow_fallbacks: true,
            require_parameters: true,
          },
        }),
      ),
    ).toThrow();
  });

  it("requires every exact synthetic provider-routing field and rejects max_price", () => {
    const body = applicationBody();
    const invalidProviders = [
      {
        ...body.provider,
        only: ["another-upstream"],
      },
      {
        ...body.provider,
        order: ["another-upstream"],
      },
      {
        ...body.provider,
        allow_fallbacks: true,
      },
      {
        ...body.provider,
        require_parameters: false,
      },
      {
        ...body.provider,
        max_price: { prompt: 0.01, completion: 0.02 },
      },
    ];
    for (const provider of invalidProviders) {
      expect(
        CloudApplicationBodyV1Schema.safeParse({ ...body, provider }).success,
      ).toBe(false);
    }
  });

  it("rejects noncanonical body bytes and body length or hash mismatches", () => {
    const request = sealedRequest();
    const noncanonicalBody = JSON.stringify(
      JSON.parse(request.canonicalBodyUtf8),
      null,
      2,
    );
    expect(
      CloudApplicationRequestV1Schema.safeParse({
        ...request,
        canonicalBodyUtf8: noncanonicalBody,
        canonicalBodyByteLength: new TextEncoder().encode(noncanonicalBody)
          .byteLength,
        canonicalBodySha256: sha256Hex(noncanonicalBody),
      }).success,
    ).toBe(false);
    expect(
      CloudApplicationRequestV1Schema.safeParse({
        ...request,
        canonicalBodyByteLength: request.canonicalBodyByteLength + 1,
      }).success,
    ).toBe(false);
    expect(
      CloudApplicationRequestV1Schema.safeParse({
        ...request,
        canonicalBodySha256: HASH_A,
      }).success,
    ).toBe(false);
  });

  it("canonicalizes object keys and rejects non-JSON, sparse, and non-plain values", () => {
    expect(canonicalPr6rJsonV1({ z: [2, 1], a: "你好" })).toBe(
      '{"a":"你好","z":[2,1]}',
    );
    expect(() => canonicalPr6rJsonV1({ value: undefined })).toThrow();
    expect(() => canonicalPr6rJsonV1([, 1])).toThrow(/sparse/u);
    expect(() => canonicalPr6rJsonV1(new Date())).toThrow(/plain objects/u);
    expect(() => canonicalPr6rJsonV1(-0)).toThrow(/negative zero/u);
  });
});

describe("PR6R-A1 campaign, comparison, and safe projection", () => {
  it("binds one parent and one common checkpoint to exactly three synthesis decisions", () => {
    expect(Pr6rCampaignV1Schema.parse(campaign())).toEqual(campaign());

    const wrongParent = clone(campaign());
    wrongParent.synthesisDecisions[1]!.parentSessionId = "another-parent";
    expect(Pr6rCampaignV1Schema.safeParse(wrongParent).success).toBe(false);

    const wrongCheckpoint = clone(campaign());
    wrongCheckpoint.synthesisDecisions[2]!.commonCheckpointSha256 = HASH_B;
    expect(Pr6rCampaignV1Schema.safeParse(wrongCheckpoint).success).toBe(false);

    const reordered = clone(campaign());
    [reordered.synthesisDecisions[0], reordered.synthesisDecisions[1]] = [
      reordered.synthesisDecisions[1]!,
      reordered.synthesisDecisions[0]!,
    ];
    expect(Pr6rCampaignV1Schema.safeParse(reordered).success).toBe(false);
  });

  it("canonically binds implementation, OS authority, loopback validation, price, and investigation evidence", () => {
    const claim = osAuthorityClaim();
    const validation = providerValidation();
    const pricing = pricingSnapshot();
    const investigation = commonInvestigation();

    expect(Pr6rOsAuthorityClaimV1Schema.parse(claim)).toEqual(claim);
    expect(Pr6rLoopbackProviderValidationV1Schema.parse(validation)).toEqual(
      validation,
    );
    expect(Pr6rSimulationPricingSnapshotV1Schema.parse(pricing)).toEqual(
      pricing,
    );
    expect(Pr6rCommonInvestigationV1Schema.parse(investigation)).toEqual(
      investigation,
    );
    expect(claim.actualPaidAuthority).toBe(false);
    expect(claim.actualExternalSpendMicrousd).toBe(0);
    expect(claim.ledgerCampaignRecordSha256).toBe(HASH_D);
    expect(claim.ledgerGuardRecordSha256).toBe(HASH_E);
    expect(
      Pr6rOsAuthorityClaimV1Schema.safeParse({
        ...claim,
        ledgerCampaignRecordSha256: HASH_A,
      }).success,
    ).toBe(false);
    expect(validation.externalProviderContact).toBe(false);
    expect(pricing.inputRateMicrousdPerMillion).toBe(
      PR6R_SIMULATION_INPUT_RATE_MICROUSD_PER_MILLION,
    );
    expect(pricing.outputRateMicrousdPerMillion).toBe(
      PR6R_SIMULATION_OUTPUT_RATE_MICROUSD_PER_MILLION,
    );
    expect(investigation.durationMs).toBe(2_500);
    expect(investigation.toolCallCount).toBe(7);

    expect(
      Pr6rOsAuthorityClaimV1Schema.safeParse({
        ...claim,
        claimedAt: "2026-09-02T00:00:02.000Z",
      }).success,
    ).toBe(false);
    const invalidTimestampClaim = {
      ...claim,
      claimedAt: "2026-13-01T00:00:00.000Z",
    };
    expect(() =>
      Pr6rOsAuthorityClaimV1Schema.safeParse(invalidTimestampClaim),
    ).not.toThrow();
    expect(
      Pr6rOsAuthorityClaimV1Schema.safeParse(invalidTimestampClaim).success,
    ).toBe(false);
    expect(
      Pr6rLoopbackProviderValidationV1Schema.safeParse({
        ...validation,
        validatedAt: "2026-09-02T00:00:02.000Z",
      }).success,
    ).toBe(false);
    expect(
      Pr6rSimulationPricingSnapshotV1Schema.safeParse({
        ...pricing,
        source: "provider_current",
      }).success,
    ).toBe(false);
    expect(
      Pr6rCommonInvestigationV1Schema.safeParse({
        ...investigation,
        durationMs: 2_501,
      }).success,
    ).toBe(false);
    expect(
      Pr6rCommonInvestigationV1Schema.safeParse({
        ...investigation,
        toolCallCount: PR6R_MAX_COMMON_TOOL_CALLS + 1,
      }).success,
    ).toBe(false);

    const wrongValidationPrice = clone(campaign());
    wrongValidationPrice.pricingSnapshot =
      buildPr6rSimulationPricingSnapshotV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        providerValidationSha256: HASH_A,
        validatedAt: VALIDATED_AT,
      });
    expect(Pr6rCampaignV1Schema.safeParse(wrongValidationPrice).success).toBe(
      false,
    );

    const providerAfterPrice = clone(campaign());
    providerAfterPrice.providerValidation =
      buildPr6rLoopbackProviderValidationV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        validatedAt: "2026-09-02T00:00:02.000Z",
      });
    providerAfterPrice.pricingSnapshot =
      buildPr6rSimulationPricingSnapshotV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        providerValidationSha256:
          providerAfterPrice.providerValidation.validationSha256,
        validatedAt: VALIDATED_AT,
      });
    expect(Pr6rCampaignV1Schema.safeParse(providerAfterPrice).success).toBe(
      false,
    );

    const comparisonWithProviderAfterPrice = clone(
      comparison(),
    );
    comparisonWithProviderAfterPrice.providerValidation =
      providerAfterPrice.providerValidation;
    comparisonWithProviderAfterPrice.pricingSnapshot =
      providerAfterPrice.pricingSnapshot;
    expect(
      Pr6rComparisonV1Schema.safeParse(comparisonWithProviderAfterPrice)
        .success,
    ).toBe(false);
  });

  it("bounds reported or unreported tokens, simulation costs, and output-validity claims", () => {
    expect(Pr6rTokenAccountingV1Schema.parse(reportedTokens())).toEqual(
      reportedTokens(),
    );
    expect(Pr6rTokenAccountingV1Schema.parse(unreportedTokens())).toEqual(
      unreportedTokens(),
    );
    expect(
      calculatePr6rHostPricedSimulationCostMicrousd(reportedTokens()),
    ).toBe(800);
    expect(
      Pr6rTokenAccountingV1Schema.safeParse({
        ...reportedTokens(),
        totalTokens: 674,
      }).success,
    ).toBe(false);
    expect(
      Pr6rTokenAccountingV1Schema.safeParse({
        ...unreportedTokens(),
        inputTokens: 0,
      }).success,
    ).toBe(false);

    const settled = fullSettledCost();
    expect(Pr6rSimulationCostV1Schema.parse(settled)).toEqual(settled);
    expect(
      Pr6rSimulationCostV1Schema.safeParse({
        ...settled,
        settledMicrousd: settled.reservedMicrousd + 1,
      }).success,
    ).toBe(true);
    expect(
      Pr6rSimulationCostV1Schema.safeParse({
        ...settled,
        reservedMicrousd: PR6R_MAX_SIMULATED_RESERVATION_MICROUSD + 1,
      }).success,
    ).toBe(false);
    expect(
      Pr6rSimulationCostV1Schema.safeParse({
        ...settled,
        projectedMicrousd: settled.reservedMicrousd + 1,
      }).success,
    ).toBe(false);
    expect(
      Pr6rSimulationCostV1Schema.safeParse({
        ...settled,
        actualPaidAuthority: true,
      }).success,
    ).toBe(false);
    expect(
      Pr6rSimulationCostV1Schema.safeParse({
        ...settled,
        actualExternalSpendMicrousd: 1,
      }).success,
    ).toBe(false);

    expect(
      Pr6rPostSchemaValidityDeferredOutputValidityV1Schema.parse(
        deferredOutputValidity(),
      ),
    ).toEqual(deferredOutputValidity());
    expect(Pr6rOutputValidityV1Schema.parse(deferredOutputValidity())).toEqual(
      deferredOutputValidity(),
    );
    expect(
      Pr6rOutputValidityV1Schema.safeParse(
        callerAssertedPassedOutputValidity(),
      ).success,
    ).toBe(false);
    expect(
      Pr6rOutputValidityV1Schema.safeParse(
        postSchemaFailedOutputValidity(),
      ).success,
    ).toBe(false);
    expect(
      Pr6rPostSchemaValidityDeferredOutputValidityV1Schema.safeParse({
        ...deferredOutputValidity(),
        citationSupport: true,
      }).success,
    ).toBe(false);
    expect(
      Pr6rPostSchemaValidityDeferredOutputValidityV1Schema.safeParse({
        ...deferredOutputValidity(),
        schemaAccepted: false,
      }).success,
    ).toBe(false);
    expect(Pr6rOutputValidityV1Schema.parse(failedOutputValidity())).toEqual(
      failedOutputValidity(),
    );
    expect(
      Pr6rOutputValidityV1Schema.safeParse({
        ...failedOutputValidity(),
        schemaAccepted: true,
        citationSupport: true,
        evidenceIntegrity: true,
        snapshotFreshness: true,
        coverageComplete: true,
      }).success,
    ).toBe(false);
  });

  it("keeps the campaign-wide fallback a single revision-bound ratchet state", () => {
    const claimed = clone(comparison()) as any;
    claimed.fallbackState = {
      ...fallbackAvailable(),
      state: "claimed",
      triggerSlotId: "cloud_synthesis",
      triggerTerminalSha256: HASH_F,
      fallbackClaimSha256: HASH_B,
      claimedAt: "2026-09-02T00:00:02.000Z",
      resolution: "reuse_local_synthesis",
      sourceSlotId: "local_synthesis",
      sourceSynthesisSessionId: "local-session-1",
      sourceReviewResultSha256: HASH_B,
      terminalAt: null,
      terminalReason: "fallback.claimed",
    };
    expect(Pr6rComparisonV1Schema.safeParse(claimed).success).toBe(true);

    const localTrigger = clone(claimed);
    localTrigger.fallbackState.triggerSlotId = "local_synthesis";
    expect(Pr6rComparisonV1Schema.safeParse(localTrigger).success).toBe(false);

    const paidFallback = clone(claimed);
    paidFallback.fallbackState.actualPaidAuthority = true;
    expect(Pr6rComparisonV1Schema.safeParse(paidFallback).success).toBe(false);

    const pendingTrigger = clone(claimed);
    pendingTrigger.synthesisDecisions[1] = {
      ...pendingTrigger.synthesisDecisions[1],
      synthesisSessionId: null,
      state: "pending",
      requestDisposition: null,
      applicationRequestSha256: null,
      authoritySlotClaimSha256: null,
      authoritySlotTerminalSha256: null,
      requestBodySha256: null,
      responseBodySha256: null,
      reviewResultSha256: null,
      synthesisLatencyMs: null,
      tokenAccounting: unreportedTokens(),
      simulationCost: fullNotReservedCost(),
      outputValidity: unavailableOutputValidity(),
      terminalReason: null,
    };
    expect(Pr6rComparisonV1Schema.safeParse(pendingTrigger).success).toBe(
      false,
    );

    const completedTrigger = clone(claimed);
    completedTrigger.synthesisDecisions[1] = {
      ...completedTrigger.synthesisDecisions[1],
      state: "completed",
      responseBodySha256: HASH_D,
      reviewResultSha256: HASH_E,
      outputValidity: deferredOutputValidity(),
      terminalReason: "completed",
    };
    expect(Pr6rComparisonV1Schema.safeParse(completedTrigger).success).toBe(
      false,
    );

    const completedFallback = clone(claimed);
    completedFallback.fallbackState.state = "completed";
    completedFallback.fallbackState.terminalAt =
      "2026-09-02T00:00:03.000Z";
    completedFallback.fallbackState.terminalReason =
      "fallback.local_result_reused";
    expect(Pr6rComparisonV1Schema.safeParse(completedFallback).success).toBe(
      true,
    );

    const wrongLocalResult = clone(completedFallback);
    wrongLocalResult.fallbackState.sourceReviewResultSha256 = HASH_A;
    expect(Pr6rComparisonV1Schema.safeParse(wrongLocalResult).success).toBe(
      false,
    );
  });

  it("keeps comparison decisions in fixed order and bound to the common parent/checkpoint", () => {
    expect(Pr6rComparisonV1Schema.parse(comparison())).toEqual(comparison());

    const wrongCheckpoint = clone(comparison());
    wrongCheckpoint.synthesisDecisions[1]!.commonCheckpointSha256 = HASH_B;
    expect(Pr6rComparisonV1Schema.safeParse(wrongCheckpoint).success).toBe(
      false,
    );

    const actualCost = { ...comparison(), costScope: "actual" };
    expect(Pr6rComparisonV1Schema.safeParse(actualCost).success).toBe(false);

    const reordered = clone(comparison());
    [reordered.synthesisDecisions[1], reordered.synthesisDecisions[2]] = [
      reordered.synthesisDecisions[2]!,
      reordered.synthesisDecisions[1]!,
    ];
    expect(Pr6rComparisonV1Schema.safeParse(reordered).success).toBe(false);
  });

  it("keeps Cloud and Hybrid application, authority, and reservation identities distinct", () => {
    const bothLoopback = clone(comparison()) as any;
    bothLoopback.synthesisDecisions[2] = {
      ...bothLoopback.synthesisDecisions[2],
      synthesisSessionId: "hybrid-session-1",
      state: "failed",
      requestDisposition: "sent",
      applicationRequestSha256: HASH_C,
      authoritySlotClaimSha256: HASH_D,
      authoritySlotTerminalSha256: HASH_E,
      requestBodySha256: HASH_C,
      responseBodySha256: HASH_A,
      reviewResultSha256: null,
      synthesisLatencyMs: 901,
      tokenAccounting: reportedTokens(),
      simulationCost: fullSettledCost("simulation-reservation-2"),
      outputValidity: failedOutputValidity(),
      terminalReason: "loopback.invalid_response",
    };
    expect(Pr6rComparisonV1Schema.safeParse(bothLoopback).success).toBe(true);

    for (const field of [
      "applicationRequestSha256",
      "authoritySlotClaimSha256",
      "authoritySlotTerminalSha256",
    ] as const) {
      const reused = clone(bothLoopback);
      reused.synthesisDecisions[2][field] =
        reused.synthesisDecisions[1][field];
      expect(Pr6rComparisonV1Schema.safeParse(reused).success).toBe(false);
    }
    const reusedSession = clone(bothLoopback);
    reusedSession.synthesisDecisions[2].synthesisSessionId =
      reusedSession.synthesisDecisions[1].synthesisSessionId;
    expect(Pr6rComparisonV1Schema.safeParse(reusedSession).success).toBe(false);

    const reusedReservation = clone(bothLoopback);
    reusedReservation.synthesisDecisions[2].simulationCost.reservationId =
      reusedReservation.synthesisDecisions[1].simulationCost.reservationId;
    expect(Pr6rComparisonV1Schema.safeParse(reusedReservation).success).toBe(
      false,
    );

    const changedRequestBody = clone(bothLoopback);
    changedRequestBody.synthesisDecisions[2].requestBodySha256 = HASH_A;
    expect(
      Pr6rComparisonV1Schema.safeParse(changedRequestBody).success,
    ).toBe(false);
  });

  it("enforces discriminated terminal-state hash invariants", () => {
    const completedCloud = clone(comparison()) as any;
    completedCloud.synthesisDecisions[1] = {
      ...completedCloud.synthesisDecisions[1],
      state: "completed",
      requestBodySha256: HASH_B,
      responseBodySha256: HASH_C,
      reviewResultSha256: HASH_D,
      outputValidity: deferredOutputValidity(),
      terminalReason: "completed",
    };
    expect(Pr6rComparisonV1Schema.safeParse(completedCloud).success).toBe(true);

    const completedWithCallerAssertedPass = clone(completedCloud);
    completedWithCallerAssertedPass.synthesisDecisions[1].outputValidity =
      callerAssertedPassedOutputValidity();
    expect(
      Pr6rComparisonV1Schema.safeParse(completedWithCallerAssertedPass).success,
    ).toBe(false);

    const completedWithFailedValidity = clone(completedCloud);
    completedWithFailedValidity.synthesisDecisions[1].outputValidity =
      postSchemaFailedOutputValidity();
    expect(
      Pr6rComparisonV1Schema.safeParse(completedWithFailedValidity).success,
    ).toBe(false);

    const completedWithSchemaRejection = clone(completedCloud);
    completedWithSchemaRejection.synthesisDecisions[1].outputValidity =
      failedOutputValidity();
    expect(
      Pr6rComparisonV1Schema.safeParse(completedWithSchemaRejection).success,
    ).toBe(false);

    const failedWithDiscardedAcceptedOutput = clone(comparison());
    failedWithDiscardedAcceptedOutput.synthesisDecisions[1].outputValidity =
      postSchemaFailedOutputValidity();
    expect(
      Pr6rComparisonV1Schema.safeParse(failedWithDiscardedAcceptedOutput)
        .success,
    ).toBe(false);

    const hostPricedWithoutUsage = clone(completedCloud);
    hostPricedWithoutUsage.synthesisDecisions[1].tokenAccounting =
      unreportedTokens();
    expect(
      Pr6rComparisonV1Schema.safeParse(hostPricedWithoutUsage).success,
    ).toBe(false);

    const forgedHostPrice = clone(completedCloud);
    forgedHostPrice.synthesisDecisions[1].simulationCost.settledMicrousd = 801;
    expect(Pr6rComparisonV1Schema.safeParse(forgedHostPrice).success).toBe(
      false,
    );

    const overlongSynthesis = clone(completedCloud);
    overlongSynthesis.synthesisDecisions[1].synthesisLatencyMs =
      PR6R_MAX_RECORDED_DURATION_MS + 1;
    expect(
      Pr6rComparisonV1Schema.safeParse(overlongSynthesis).success,
    ).toBe(false);

    const completedWithUnknownSettlement = clone(completedCloud);
    completedWithUnknownSettlement.synthesisDecisions[1].simulationCost = {
      ...fullSettledCost(),
      settlementState: "unknown",
      settledMicrousd: null,
      provenance: "reserved_unknown",
    };
    expect(
      Pr6rComparisonV1Schema.safeParse(completedWithUnknownSettlement).success,
    ).toBe(false);

    const missingCompletedResponse = clone(completedCloud);
    missingCompletedResponse.synthesisDecisions[1].responseBodySha256 = null;
    expect(
      Pr6rComparisonV1Schema.safeParse(missingCompletedResponse).success,
    ).toBe(false);

    const failedWithResult = clone(comparison()) as any;
    failedWithResult.synthesisDecisions[1].reviewResultSha256 = HASH_D;
    expect(Pr6rComparisonV1Schema.safeParse(failedWithResult).success).toBe(
      false,
    );

    const failedWithSuccessCode = clone(comparison()) as any;
    failedWithSuccessCode.synthesisDecisions[1].terminalReason = "completed";
    expect(
      Pr6rComparisonV1Schema.safeParse(failedWithSuccessCode).success,
    ).toBe(false);
    for (const contradictoryCode of [
      "success",
      "passed",
      "ok",
      "fallback.completed",
    ]) {
      const contradictoryFailure = clone(comparison()) as any;
      contradictoryFailure.synthesisDecisions[1].terminalReason =
        contradictoryCode;
      expect(
        Pr6rComparisonV1Schema.safeParse(contradictoryFailure).success,
      ).toBe(false);
    }

    const localFailure = clone(comparison()) as any;
    localFailure.synthesisDecisions[0] = {
      ...localFailure.synthesisDecisions[0],
      state: "failed",
      reviewResultSha256: null,
      outputValidity: unavailableOutputValidity(),
      terminalReason: "local_synthesis.failed",
    };
    expect(Pr6rComparisonV1Schema.safeParse(localFailure).success).toBe(true);
    localFailure.synthesisDecisions[0].terminalReason = "loopback.http_error";
    expect(Pr6rComparisonV1Schema.safeParse(localFailure).success).toBe(false);

    const cloudWithLocalReason = clone(comparison()) as any;
    cloudWithLocalReason.synthesisDecisions[1].terminalReason =
      "local_synthesis.failed";
    expect(
      Pr6rComparisonV1Schema.safeParse(cloudWithLocalReason).success,
    ).toBe(false);

    const budgetDenied = clone(comparison()) as any;
    budgetDenied.synthesisDecisions[1] = {
      ...budgetDenied.synthesisDecisions[1],
      requestDisposition: "not_sent",
      responseBodySha256: null,
      tokenAccounting: unreportedTokens(),
      simulationCost: fullNotReservedCost(),
      outputValidity: unavailableOutputValidity(),
      terminalReason: "loopback.budget_denied",
    };
    expect(Pr6rComparisonV1Schema.safeParse(budgetDenied).success).toBe(true);
    const budgetDeniedWithSettledCost = clone(budgetDenied);
    budgetDeniedWithSettledCost.synthesisDecisions[1].simulationCost =
      fullSettledCost();
    expect(
      Pr6rComparisonV1Schema.safeParse(budgetDeniedWithSettledCost).success,
    ).toBe(false);
    const budgetDeniedWithUsage = clone(budgetDenied);
    budgetDeniedWithUsage.synthesisDecisions[1].tokenAccounting =
      reportedTokens();
    expect(
      Pr6rComparisonV1Schema.safeParse(budgetDeniedWithUsage).success,
    ).toBe(false);
    budgetDenied.synthesisDecisions[1].responseBodySha256 = HASH_D;
    expect(Pr6rComparisonV1Schema.safeParse(budgetDenied).success).toBe(false);

    const sentTransportFailure = clone(comparison()) as any;
    sentTransportFailure.synthesisDecisions[1] = {
      ...sentTransportFailure.synthesisDecisions[1],
      responseBodySha256: null,
      outputValidity: unavailableOutputValidity(),
      terminalReason: "loopback.http_error",
    };
    expect(
      Pr6rComparisonV1Schema.safeParse(sentTransportFailure).success,
    ).toBe(true);
    sentTransportFailure.synthesisDecisions[1].simulationCost =
      fullNotReservedCost();
    sentTransportFailure.synthesisDecisions[1].tokenAccounting =
      unreportedTokens();
    expect(
      Pr6rComparisonV1Schema.safeParse(sentTransportFailure).success,
    ).toBe(false);

    const schemaRejectedWithoutResponse = clone(comparison()) as any;
    schemaRejectedWithoutResponse.synthesisDecisions[1].responseBodySha256 =
      null;
    expect(
      Pr6rComparisonV1Schema.safeParse(schemaRejectedWithoutResponse).success,
    ).toBe(false);

    const cancelledCloud = clone(comparison()) as any;
    cancelledCloud.synthesisDecisions[1] = {
      ...cancelledCloud.synthesisDecisions[1],
      state: "cancelled",
      requestDisposition: "unknown",
      responseBodySha256: null,
      tokenAccounting: unreportedTokens(),
      simulationCost: fullUnknownCost(),
      outputValidity: unavailableOutputValidity(),
      terminalReason: "loopback.cancelled_after_dispatch",
    };
    expect(Pr6rComparisonV1Schema.safeParse(cancelledCloud).success).toBe(
      true,
    );
    cancelledCloud.synthesisDecisions[1].terminalReason =
      "loopback.cancelled_before_dispatch";
    expect(Pr6rComparisonV1Schema.safeParse(cancelledCloud).success).toBe(
      false,
    );
    cancelledCloud.synthesisDecisions[1].requestDisposition = "not_sent";
    cancelledCloud.synthesisDecisions[1].simulationCost =
      fullNotReservedCost();
    expect(Pr6rComparisonV1Schema.safeParse(cancelledCloud).success).toBe(
      true,
    );
    cancelledCloud.synthesisDecisions[1].terminalReason =
      "loopback.cancelled_after_dispatch";
    expect(Pr6rComparisonV1Schema.safeParse(cancelledCloud).success).toBe(
      false,
    );
    cancelledCloud.synthesisDecisions[1].terminalReason =
      "loopback.invalid_response";
    expect(Pr6rComparisonV1Schema.safeParse(cancelledCloud).success).toBe(
      false,
    );

    const pendingWithAttempt = clone(comparison()) as any;
    pendingWithAttempt.synthesisDecisions[0] = {
      ...pendingWithAttempt.synthesisDecisions[0],
      state: "pending",
      synthesisSessionId: "premature-session",
      reviewResultSha256: null,
    };
    expect(Pr6rComparisonV1Schema.safeParse(pendingWithAttempt).success).toBe(
      false,
    );

    const forcedCloudNotSelected = clone(comparison()) as any;
    forcedCloudNotSelected.synthesisDecisions[1] = {
      ...forcedCloudNotSelected.synthesisDecisions[1],
      state: "not_selected",
      synthesisSessionId: null,
      requestDisposition: null,
      applicationRequestSha256: null,
      authoritySlotClaimSha256: null,
      authoritySlotTerminalSha256: null,
      requestBodySha256: null,
      responseBodySha256: null,
      reviewResultSha256: null,
    };
    expect(
      Pr6rComparisonV1Schema.safeParse(forcedCloudNotSelected).success,
    ).toBe(false);
    cancelledCloud.synthesisDecisions[1].requestDisposition = "unknown";
    cancelledCloud.synthesisDecisions[1].simulationCost = fullSettledCost();
    expect(Pr6rComparisonV1Schema.safeParse(cancelledCloud).success).toBe(
      false,
    );

    const projectionWithTransportHash = clone(safeProjection()) as any;
    projectionWithTransportHash.synthesisDecisions[1].requestBodySha256 =
      HASH_B;
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(projectionWithTransportHash).success,
    ).toBe(false);

    const safeBudgetDenied = clone(safeProjection()) as any;
    safeBudgetDenied.synthesisDecisions[1] = {
      ...safeBudgetDenied.synthesisDecisions[1],
      requestDisposition: "not_sent",
      tokenAccounting: unreportedTokens(),
      simulationCost: safeNotReservedCost(),
      outputValidity: unavailableOutputValidity(),
      terminalReason: "loopback.budget_denied",
    };
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(safeBudgetDenied).success,
    ).toBe(true);
    safeBudgetDenied.synthesisDecisions[1].simulationCost = safeSettledCost();
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(safeBudgetDenied).success,
    ).toBe(false);

    const safeCancelledAfterDispatch = clone(safeProjection()) as any;
    safeCancelledAfterDispatch.synthesisDecisions[1] = {
      ...safeCancelledAfterDispatch.synthesisDecisions[1],
      state: "cancelled",
      requestDisposition: "unknown",
      tokenAccounting: unreportedTokens(),
      simulationCost: safeUnknownCost(),
      outputValidity: unavailableOutputValidity(),
      terminalReason: "loopback.cancelled_after_dispatch",
    };
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(safeCancelledAfterDispatch).success,
    ).toBe(true);
    safeCancelledAfterDispatch.synthesisDecisions[1].simulationCost =
      safeNotReservedCost();
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(safeCancelledAfterDispatch).success,
    ).toBe(false);

    const failedWithoutCode = clone(safeProjection()) as any;
    failedWithoutCode.synthesisDecisions[1].terminalReason = null;
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(failedWithoutCode).success,
    ).toBe(false);
  });

  it("admits only schema-parsed canonical ReviewResultV1 output plus safe hashes", () => {
    const validProjection = safeProjection();
    expect(Pr6rSafeProjectionV1Schema.parse(validProjection)).toEqual(
      validProjection,
    );

    const completedWithCallerAssertedPass = clone(safeProjection());
    completedWithCallerAssertedPass.synthesisDecisions[0]!.outputValidity =
      callerAssertedPassedOutputValidity() as never;
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(completedWithCallerAssertedPass)
        .success,
    ).toBe(false);

    const completedWithFailedValidity = clone(safeProjection());
    completedWithFailedValidity.synthesisDecisions[0]!.outputValidity =
      postSchemaFailedOutputValidity();
    expect(
      Pr6rSafeProjectionV1Schema.safeParse(completedWithFailedValidity).success,
    ).toBe(false);

    const stringOutput = clone(safeProjection());
    stringOutput.synthesisDecisions[0]!.output!.reviewResult =
      JSON.stringify(reviewResult()) as never;
    expect(Pr6rSafeProjectionV1Schema.safeParse(stringOutput).success).toBe(
      false,
    );

    const badHash = clone(safeProjection());
    badHash.synthesisDecisions[0]!.output!.reviewResultSha256 = HASH_A;
    expect(Pr6rSafeProjectionV1Schema.safeParse(badHash).success).toBe(false);

    const wrongSnapshot = clone(safeProjection());
    wrongSnapshot.synthesisDecisions[0]!.output!.reviewResult.snapshotId =
      HASH_A as never;
    wrongSnapshot.synthesisDecisions[0]!.output!.reviewResultSha256 =
      canonicalPr6rReviewResultSha256(
        wrongSnapshot.synthesisDecisions[0]!.output!.reviewResult,
      );
    expect(Pr6rSafeProjectionV1Schema.safeParse(wrongSnapshot).success).toBe(
      false,
    );

    for (const forbiddenSummary of [
      "Provider endpoint https://example.invalid/v1 returned a result.",
      "Provider endpoint ssh://example.invalid/repository was observed.",
      "Read the raw artifact at /Users/private/workspace/trace.json.",
      "Read the raw artifact at /System/Library/private.log.",
      "Read the raw artifact at /usr/local/private.log.",
      "Read the raw artifact at /workspace/private/trace.json.",
      "See:/System/Library/private.log",
      "Path=[/opt/private/trace.log]",
      "Endpoint api.example.com:443",
      "Host=(api.example.invalid:8443)",
      "Synthetic numeric endpoint 198.51.100.42:58000",
      "Numeric address 203.0.113.9 was returned.",
      "Bracketed IPv6 endpoint [2001:db8::1]:443",
      "Raw IPv6 endpoint 2001:db8:0:1::9",
      "Compressed raw IPv6 endpoint ::1",
      "Scoped IPv6 endpoint fe80::1%en0",
      "Single-label host buildbox:43117",
      "URI mailto:operator@example.invalid",
      "URI urn:example:transport",
      "Traversal ../private/trace.log",
      "Home path ~/private/trace.log",
      "URI:(ftp://example.invalid/private)",
      'Envelope:{"status":500}',
      'Envelope=[{"status":500}]',
      "Raw response follows:\n{\"status\":500}",
      "Raw response diagnostic: upstream envelope follows.",
    ]) {
      const unsafeText = clone(safeProjection());
      unsafeText.synthesisDecisions[0]!.output!.reviewResult.summary =
        forbiddenSummary;
      unsafeText.synthesisDecisions[0]!.output!.reviewResultSha256 =
        canonicalPr6rReviewResultSha256(
          unsafeText.synthesisDecisions[0]!.output!.reviewResult,
        );
      expect(Pr6rSafeProjectionV1Schema.safeParse(unsafeText).success).toBe(
        false,
      );
    }
  });

  it("screens every provider-authored prose field for endpoint and high-confidence credential material", () => {
    const syntheticApiKey = `sk-${"x".repeat(24)}`;
    const syntheticOpenRouterKey = `sk-or-v1-${"y".repeat(24)}`;
    const syntheticJwt = [
      `eyJ${"a".repeat(12)}`,
      "b".repeat(16),
      "c".repeat(16),
    ].join(".");
    const forbiddenValues = [
      "RFC 5737 documentation address 192.0.2.44",
      "RFC 3849 documentation address 2001:db8::44",
      "Documentation host api.example:443",
      `Synthetic API key ${syntheticApiKey}`,
      `Synthetic provider key ${syntheticOpenRouterKey}`,
      `Synthetic repository token ghp_${"g".repeat(24)}`,
      `Synthetic access-key ID AKIA${"A".repeat(16)}`,
      `Synthetic browser API key AIza${"q".repeat(24)}`,
      `Synthetic chat token xoxb-${"s".repeat(24)}`,
      `Synthetic token ${syntheticJwt}`,
      ["Synthetic private key -----BEGIN", "PRIVATE", "KEY-----"].join(" "),
      `Synthetic key assignment api_key=${"z".repeat(24)}`,
      `Synthetic token assignment AUTH_TOKEN=${"t".repeat(24)}`,
    ];
    const proseMutations: Array<
      [string, (result: any, value: string) => void]
    > = [
      ["summary", (result, value) => (result.summary = value)],
      [
        "omission description",
        (result, value) =>
          (result.omissions = [
            { code: "bounded-omission", description: value },
          ]),
      ],
      ["finding title", (result, value) => (result.findings[0].title = value)],
      ["finding impact", (result, value) => (result.findings[0].impact = value)],
      [
        "suggested correction",
        (result, value) =>
          (result.findings[0].suggestedCorrection = value),
      ],
      [
        "suggested test",
        (result, value) => (result.findings[0].suggestedTest = value),
      ],
    ];

    for (const [field, mutate] of proseMutations) {
      for (const forbidden of forbiddenValues) {
        const projection = clone(safeProjection());
        const result = reviewResultWithEvidencePath(
          "src/flask/templating.py",
        ) as any;
        mutate(result, forbidden);
        projection.synthesisDecisions[0]!.output!.reviewResult = result;
        projection.synthesisDecisions[0]!.output!.reviewResultSha256 =
          canonicalPr6rReviewResultSha256(result);
        expect(
          Pr6rSafeProjectionV1Schema.safeParse(projection).success,
          `${field} admitted ${forbidden}`,
        ).toBe(false);
      }
    }
  });

  it("screens finding IDs, omission codes, and repository observation IDs", () => {
    const syntheticIdentifierKey = `sk-${"x".repeat(24)}`;
    for (const forbiddenId of ["198.51.100.42", syntheticIdentifierKey]) {
      const findingProjection = clone(safeProjection());
      const findingResult = reviewResultWithEvidencePath(
        "src/flask/templating.py",
      );
      findingResult.findings[0]!.findingId = forbiddenId;
      findingProjection.synthesisDecisions[0]!.output!.reviewResult =
        findingResult as never;
      findingProjection.synthesisDecisions[0]!.output!.reviewResultSha256 =
        canonicalPr6rReviewResultSha256(findingResult);
      expect(
        Pr6rSafeProjectionV1Schema.safeParse(findingProjection).success,
      ).toBe(false);

      const omissionProjection = clone(safeProjection());
      const omissionResult = {
        ...reviewResult(),
        omissions: [
          { code: forbiddenId, description: "A bounded omission." },
        ],
      };
      omissionProjection.synthesisDecisions[0]!.output!.reviewResult =
        omissionResult as never;
      omissionProjection.synthesisDecisions[0]!.output!.reviewResultSha256 =
        canonicalPr6rReviewResultSha256(omissionResult);
      expect(
        Pr6rSafeProjectionV1Schema.safeParse(omissionProjection).success,
      ).toBe(false);
    }

    for (const forbiddenObservationId of [
      "api.example:443",
      syntheticIdentifierKey,
    ]) {
      const projection = clone(safeProjection());
      const result = reviewResultWithRepositoryObservation(
        forbiddenObservationId,
      );
      projection.synthesisDecisions[0]!.output!.reviewResult = result as never;
      projection.synthesisDecisions[0]!.output!.reviewResultSha256 =
        canonicalPr6rReviewResultSha256(result);
      expect(
        Pr6rSafeProjectionV1Schema.safeParse(projection).success,
      ).toBe(false);
    }
  });

  it("omits the internal Local child-session ID from renderer-safe fallback state", () => {
    const claimedFallback = {
      ...fallbackAvailable(),
      state: "claimed" as const,
      triggerSlotId: "cloud_synthesis" as const,
      triggerTerminalSha256: HASH_F,
      fallbackClaimSha256: HASH_B,
      claimedAt: "2026-09-02T00:00:02.000Z",
      resolution: "reuse_local_synthesis" as const,
      sourceSlotId: "local_synthesis" as const,
      sourceSynthesisSessionId: "local-session-internal",
      sourceReviewResultSha256: HASH_B,
      terminalAt: null,
      terminalReason: "fallback.claimed" as const,
    };
    const safeFallback = projectPr6rSafeCampaignFallbackStateV1(
      claimedFallback,
    );
    expect(safeFallback).not.toHaveProperty("sourceSynthesisSessionId");

    const projection = clone(safeProjection());
    projection.fallbackState = {
      ...safeFallback,
      sourceSynthesisSessionId: `sk-${"x".repeat(24)}`,
    } as never;
    expect(Pr6rSafeProjectionV1Schema.safeParse(projection).success).toBe(
      false,
    );
  });

  it.each([
    "../private/trace.ts",
    "src/../../private/trace.ts",
    "%2e%2e/private/trace.ts",
    "/absolute/private/trace.ts",
    "C:\\private\\trace.ts",
    "\\\\server\\share\\trace.ts",
    "https://example.invalid/private/trace.ts",
    "api.example.invalid:443/private/trace.ts",
    "198.51.100.42:58000/private/trace.ts",
    "203.0.113.9/trace.ts",
    "[2001:db8::1]/trace.ts",
    "2001:db8::1/trace.ts",
    `sk-${"x".repeat(24)}/trace.ts`,
    `token=${"t".repeat(24)}/trace.ts`,
    "transport-envelope/response.json",
  ])("rejects endpoint, absolute, traversal, or envelope evidence path %s", (path) => {
    const unsafePath = clone(safeProjection());
    const result = reviewResultWithEvidencePath(path);
    unsafePath.synthesisDecisions[0]!.output!.reviewResult = result as never;
    unsafePath.synthesisDecisions[0]!.output!.reviewResultSha256 =
      sha256Hex(canonicalPr6rJsonV1(result));
    expect(Pr6rSafeProjectionV1Schema.safeParse(unsafePath).success).toBe(
      false,
    );
  });

  it("retains ordinary repository-relative evidence paths", () => {
    const safePath = clone(safeProjection());
    const result = reviewResultWithEvidencePath("src/flask/templating.py");
    safePath.synthesisDecisions[0]!.output!.reviewResult = result as never;
    safePath.synthesisDecisions[0]!.output!.reviewResultSha256 =
      canonicalPr6rReviewResultSha256(result);
    expect(Pr6rSafeProjectionV1Schema.safeParse(safePath).success).toBe(true);
  });

  it("rejects a safe-looking repository path outside the frozen admitted change", () => {
    const outsidePacket = clone(safeProjection());
    const result = reviewResultWithEvidencePath("README.md");
    outsidePacket.synthesisDecisions[0]!.output!.reviewResult = result as never;
    outsidePacket.synthesisDecisions[0]!.output!.reviewResultSha256 =
      canonicalPr6rReviewResultSha256(result);
    expect(Pr6rSafeProjectionV1Schema.safeParse(outsidePacket).success).toBe(
      false,
    );
  });

  it.each([
    ["raw HTTP envelope", { httpEnvelope: { status: 200 } }],
    ["raw headers", { headers: { authorization: "secret" } }],
    ["raw error", { rawError: "provider body" }],
    ["request bytes", { requestBytes: "forbidden" }],
    ["endpoint", { endpointUrl: "http://127.0.0.1:43117" }],
    ["path", { path: "/api/v1/chat/completions" }],
    ["request hash", { requestBodySha256: HASH_A }],
    ["application request hash", { applicationRequestSha256: HASH_A }],
    ["authority claim hash", { authoritySlotClaimSha256: HASH_A }],
    ["authority terminal hash", { authoritySlotTerminalSha256: HASH_A }],
    ["response hash", { responseBodySha256: HASH_B }],
    ["diagnostic", { diagnostic: "provider internals" }],
  ])("rejects %s from the persisted safe output", (_label, forbidden) => {
    const projection = clone(safeProjection()) as Record<string, unknown> & {
      synthesisDecisions: Array<Record<string, unknown>>;
    };
    projection.synthesisDecisions[1] = {
      ...projection.synthesisDecisions[1],
      ...forbidden,
    };
    expect(Pr6rSafeProjectionV1Schema.safeParse(projection).success).toBe(
      false,
    );
  });

  it("rejects raw transport material at the safe projection root", () => {
    const projection = {
      ...safeProjection(),
      rawResponseBody: "forbidden",
      requestHeaders: PR6R_ALLOWLISTED_NON_SECRET_HEADERS,
    };
    expect(Pr6rSafeProjectionV1Schema.safeParse(projection).success).toBe(
      false,
    );
  });

  it("serializes a bounded safe subset with no endpoint, path, request, response, credential, reservation ID, or diagnostic field", () => {
    const serialized = JSON.stringify(
      Pr6rSafeProjectionV1Schema.parse(safeProjection()),
    );
    expect(serialized).not.toMatch(
      /"(?:endpoint(?:Url)?|path|request(?!Disposition")[A-Za-z0-9_]*|response[A-Za-z0-9_]*|credential[A-Za-z0-9_]*|reservationId|diagnostic[A-Za-z0-9_]*)"\s*:/iu,
    );
    expect(serialized).toContain('"actualPaidAuthority":false');
    expect(serialized).toContain('"actualExternalSpendMicrousd":0');
  });
});
