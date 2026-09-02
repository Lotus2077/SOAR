import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  PR6R_CAMPAIGN_ID,
  PR6R_CAMPAIGN_FALLBACK_ID,
  PR6R_DEVELOPMENT_AUTHORITY_V1,
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_FROZEN_FIXTURE_V1,
  PR6R_SYNTHESIS_SLOTS_V1,
  Pr6rCampaignFallbackStateV1Schema,
  Pr6rCampaignV1Schema,
  Pr6rComparisonV1Schema,
  Pr6rSafeProjectionV1Schema,
  buildPr6rCommonCheckpointV1,
  buildPr6rCommonInvestigationV1,
  buildPr6rLoopbackProviderValidationV1,
  buildPr6rOsAuthorityClaimV1,
  buildPr6rSimulationPricingSnapshotV1,
  canonicalPr6rJsonV1,
  canonicalPr6rReviewResultSha256,
  projectPr6rSafeCampaignFallbackStateV1,
  type Pr6rComparisonV1,
  type Pr6rSafeProjectionV1,
} from "../../src/shared/pr6r-development-contracts";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  REVIEW_RESULT_V1_LIMITS,
  ReviewResultV1Schema,
  type ReviewResultV1,
} from "../../src/shared/review-result-contract";
import {
  PR6R_CANARY_MAX_PAYLOAD_BYTES,
  PR6R_CANARY_MAX_RECORDS,
  PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256,
  PR6R_CANARY_PAYLOAD_CONTRACT_VERSION,
  PR6R_CANARY_STORE_MIGRATION_NAME,
  PR6R_CANARY_STORE_SCHEMA_VERSION,
  Pr6rCanarySequenceConflictError,
  Pr6rCanaryStore,
} from "../../src/main/pr6r-development/canary-store";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const IMPLEMENTATION_REVISION = HASH_C;
const PARENT_SESSION_ID = "parent-session";
const PACKET_UTF8 = canonicalPr6rJsonV1({
  fixtureId: PR6R_FROZEN_FIXTURE_V1.fixtureId,
  schemaVersion: "pr6r-test-packet-v1",
  snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
});
const SEMANTIC_MESSAGES = [
  { role: "system" as const, content: "Review only the admitted public fixture." },
  { role: "user" as const, content: `Packet:\n${PACKET_UTF8}` },
] as const;
const CHECKPOINT = buildPr6rCommonCheckpointV1({
  parentSessionId: PARENT_SESSION_ID,
  packetUtf8: PACKET_UTF8,
  semanticMessages: SEMANTIC_MESSAGES,
});
const EVIDENCE_AT = "2026-09-02T00:00:00.000Z";
const OS_AUTHORITY_CLAIM = buildPr6rOsAuthorityClaimV1({
  implementationRevision: IMPLEMENTATION_REVISION,
  claimedAt: EVIDENCE_AT,
  ledgerCampaignRecordSha256: HASH_D,
  ledgerGuardRecordSha256: HASH_E,
});
const PROVIDER_VALIDATION = buildPr6rLoopbackProviderValidationV1({
  implementationRevision: IMPLEMENTATION_REVISION,
  validatedAt: EVIDENCE_AT,
});
const PRICING_SNAPSHOT = buildPr6rSimulationPricingSnapshotV1({
  implementationRevision: IMPLEMENTATION_REVISION,
  providerValidationSha256: PROVIDER_VALIDATION.validationSha256,
  validatedAt: EVIDENCE_AT,
});
const COMMON_INVESTIGATION = buildPr6rCommonInvestigationV1({
  implementationRevision: IMPLEMENTATION_REVISION,
  parentSessionId: PARENT_SESSION_ID,
  commonCheckpointSha256: CHECKPOINT.checkpointSha256,
  durationMs: 1,
  toolCallCount: 1,
});
const AVAILABLE_FALLBACK_STATE = {
  schemaVersion: "pr6r-campaign-fallback-state-v1",
  fallbackId: PR6R_CAMPAIGN_FALLBACK_ID,
  campaignId: PR6R_CAMPAIGN_ID,
  implementationRevision: IMPLEMENTATION_REVISION,
  costScope: "simulation",
  actualPaidAuthority: false,
  actualExternalSpendMicrousd: 0,
  state: "available",
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
} as const;

type DecisionState =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_selected";
type DecisionStates = readonly [DecisionState, DecisionState, DecisionState];
type FallbackState = Pr6rComparisonV1["fallbackState"]["state"];

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "soar-pr6r-store-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "canary.sqlite");
}

/** Deliberately unsafe white-box access kept outside the production API. */
function databaseForTest(store: Pr6rCanaryStore): BetterSqlite3.Database {
  return (
    store as unknown as { readonly database: BetterSqlite3.Database }
  ).database;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function campaign() {
  return Pr6rCampaignV1Schema.parse({
    schemaVersion: "pr6r-campaign-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    authority: PR6R_DEVELOPMENT_AUTHORITY_V1,
    osAuthorityClaim: OS_AUTHORITY_CLAIM,
    providerValidation: PROVIDER_VALIDATION,
    pricingSnapshot: PRICING_SNAPSHOT,
    fixture: PR6R_FROZEN_FIXTURE_V1,
    parent: {
      sessionId: PARENT_SESSION_ID,
      commonCheckpoint: CHECKPOINT,
    },
    commonInvestigation: COMMON_INVESTIGATION,
    synthesisDecisions: PR6R_SYNTHESIS_SLOTS_V1.map((slot) => ({
      schemaVersion: "pr6r-synthesis-decision-v1",
      slot,
      parentSessionId: PARENT_SESSION_ID,
      commonCheckpointSha256: CHECKPOINT.checkpointSha256,
    })),
    fallbackState: AVAILABLE_FALLBACK_STATE,
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
  });
}

function reviewResult() {
  return {
    schemaVersion: "change-review-result-v1" as const,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: "No structurally invalid output was observed.",
    conclusion: "no_blocking_findings" as const,
    evidenceSetId: HASH_B,
    omissions: [],
    findings: [],
  };
}

function largeReviewResult(): ReviewResultV1 {
  const boundedText = "x".repeat(4_096);
  return ReviewResultV1Schema.parse({
    schemaVersion: "change-review-result-v1",
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    summary: "A large but contract-valid review result.",
    conclusion: "blocking_findings",
    evidenceSetId: HASH_B,
    omissions: [],
    findings: Array.from({ length: 12 }, (_value, index) => ({
      findingId: `large-finding-${index + 1}`,
      severity: "P2",
      title: `Large finding ${index + 1}`,
      impact: boundedText,
      suggestedCorrection: boundedText,
      suggestedTest: boundedText,
      evidence: [
        {
          kind: "change_metadata",
          snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
          path: "CHANGES.rst",
          changeKind: "modified",
        },
      ],
    })),
  });
}

function sessionId(index: number): string {
  if (index === 0) return PARENT_SESSION_ID;
  return index === 1 ? "cloud-session" : "hybrid-session";
}

function decisionForState(
  index: number,
  state: DecisionState,
): Record<string, unknown> {
  const slot = PR6R_SYNTHESIS_SLOTS_V1[index]!;
  const identity = {
    slotId: slot.slotId,
    ordinal: slot.ordinal,
    parentSessionId: PARENT_SESSION_ID,
    commonCheckpointSha256: CHECKPOINT.checkpointSha256,
  };
  const unreportedTokenAccounting = {
    schemaVersion: "pr6r-token-accounting-v1",
    reported: false,
    provenance: "provider_unreported",
    inputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    visibleOutputTokens: null,
    totalTokens: null,
  } as const;
  const reportedTokenAccounting = {
    schemaVersion: "pr6r-token-accounting-v1",
    reported: true,
    provenance: "provider_reported",
    inputTokens: 600,
    cacheReadTokens: 100,
    cacheWriteTokens: 0,
    reasoningTokens: 50,
    visibleOutputTokens: 25,
    totalTokens: 675,
  } as const;
  const notReservedCost = {
    schemaVersion: "pr6r-simulation-cost-v1",
    pricingSnapshotId: PRICING_SNAPSHOT.pricingSnapshotId,
    pricingSnapshotSha256: PRICING_SNAPSHOT.pricingSnapshotSha256,
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    settlementState: "not_reserved",
    reservationId: null,
    projectedMicrousd: 0,
    reservedMicrousd: 0,
    settledMicrousd: 0,
    provenance: "not_settled",
  } as const;
  const unknownCost = {
    schemaVersion: "pr6r-simulation-cost-v1",
    pricingSnapshotId: PRICING_SNAPSHOT.pricingSnapshotId,
    pricingSnapshotSha256: PRICING_SNAPSHOT.pricingSnapshotSha256,
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    settlementState: "unknown",
    reservationId: `reservation-${index}`,
    projectedMicrousd: 2_500,
    reservedMicrousd: 3_000,
    settledMicrousd: null,
    provenance: "reserved_unknown",
  } as const;
  const unavailableValidity = {
    schemaVersion: "pr6r-output-validity-v1",
    status: "not_available",
    schemaAccepted: null,
    citationSupport: null,
    evidenceIntegrity: null,
    snapshotFreshness: null,
    coverageComplete: null,
  } as const;
  if (state === "pending" || state === "not_selected") {
    return {
      ...identity,
      synthesisSessionId: null,
      state,
      requestDisposition: null,
      applicationRequestSha256: null,
      authoritySlotClaimSha256: null,
      authoritySlotTerminalSha256: null,
      requestBodySha256: null,
      responseBodySha256: null,
      reviewResultSha256: null,
      synthesisLatencyMs: null,
      tokenAccounting: unreportedTokenAccounting,
      simulationCost: notReservedCost,
      outputValidity: unavailableValidity,
      terminalReason:
        state === "not_selected" ? "route.not_selected" : null,
    };
  }
  const loopback = index !== 0;
  const completed = state === "completed";
  const requestDisposition =
    !loopback
      ? null
      : completed || state === "failed"
        ? "sent"
        : "unknown";
  const applicationRequestSha256 = index === 1 ? "1".repeat(64) : "4".repeat(64);
  const authoritySlotClaimSha256 = index === 1 ? "2".repeat(64) : "5".repeat(64);
  const authoritySlotTerminalSha256 = index === 1 ? "3".repeat(64) : "6".repeat(64);
  return {
    ...identity,
    synthesisSessionId: sessionId(index),
    state,
    requestDisposition,
    applicationRequestSha256: loopback ? applicationRequestSha256 : null,
    authoritySlotClaimSha256: loopback ? authoritySlotClaimSha256 : null,
    authoritySlotTerminalSha256: loopback ? authoritySlotTerminalSha256 : null,
    requestBodySha256: loopback ? HASH_D : null,
    responseBodySha256: completed && loopback ? HASH_E : null,
    reviewResultSha256:
      completed
        ? canonicalPr6rReviewResultSha256(reviewResult())
        : null,
    synthesisLatencyMs: 1,
    tokenAccounting: completed
      ? reportedTokenAccounting
      : unreportedTokenAccounting,
    simulationCost:
      completed && loopback
        ? {
            schemaVersion: "pr6r-simulation-cost-v1",
            pricingSnapshotId: PRICING_SNAPSHOT.pricingSnapshotId,
            pricingSnapshotSha256: PRICING_SNAPSHOT.pricingSnapshotSha256,
            costScope: "simulation",
            actualPaidAuthority: false,
            actualExternalSpendMicrousd: 0,
            settlementState: "settled",
            reservationId: `reservation-${index}`,
            projectedMicrousd: 2_500,
            reservedMicrousd: 3_000,
            // ceil((600 - 100 - 0) * 1_000_000 / 1_000_000)
            // + ceil((50 + 25) * 4_000_000 / 1_000_000)
            settledMicrousd: 800,
            provenance: "host_pricing_snapshot",
          }
        : loopback
          ? unknownCost
          : notReservedCost,
    outputValidity: completed
      ? {
          schemaVersion: "pr6r-output-validity-v1",
          status: "post_schema_validity_deferred",
          schemaAccepted: true,
          citationSupport: null,
          evidenceIntegrity: null,
          snapshotFreshness: null,
          coverageComplete: null,
        }
      : unavailableValidity,
    terminalReason: completed
      ? "completed"
      : !loopback
        ? state === "failed"
          ? "local_synthesis.failed"
          : "local_synthesis.cancelled"
        : state === "failed"
          ? "loopback.http_error"
          : "loopback.cancelled_after_dispatch",
  };
}

function comparison(states: DecisionStates): Pr6rComparisonV1 {
  return Pr6rComparisonV1Schema.parse({
    schemaVersion: "pr6r-comparison-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    fixtureId: PR6R_FROZEN_FIXTURE_V1.fixtureId,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    parentSessionId: PARENT_SESSION_ID,
    commonCheckpointSha256: CHECKPOINT.checkpointSha256,
    osAuthorityClaim: OS_AUTHORITY_CLAIM,
    providerValidation: PROVIDER_VALIDATION,
    pricingSnapshot: PRICING_SNAPSHOT,
    commonInvestigation: COMMON_INVESTIGATION,
    fallbackState: AVAILABLE_FALLBACK_STATE,
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    synthesisDecisions: states.map((state, index) =>
      decisionForState(index, state),
    ),
  });
}

function comparisonForOutput(
  states: DecisionStates,
  output: ReviewResultV1,
): Pr6rComparisonV1 {
  const value = clone(comparison(states));
  const outputSha256 = canonicalPr6rReviewResultSha256(output);
  value.synthesisDecisions.forEach((decision) => {
    if (decision.state === "completed") {
      decision.reviewResultSha256 = outputSha256;
    }
  });
  return Pr6rComparisonV1Schema.parse(value);
}

function fallbackState(
  state: FallbackState,
  overrides: Readonly<Record<string, unknown>> = {},
): Pr6rComparisonV1["fallbackState"] {
  const triggered = {
    ...AVAILABLE_FALLBACK_STATE,
    state,
    triggerSlotId: "cloud_synthesis",
    triggerTerminalSha256: HASH_A,
    fallbackClaimSha256: HASH_B,
    claimedAt: "2026-09-02T00:00:02.000Z",
    resolution: "reuse_local_synthesis",
    sourceSlotId: "local_synthesis",
    sourceSynthesisSessionId: PARENT_SESSION_ID,
    sourceReviewResultSha256:
      canonicalPr6rReviewResultSha256(reviewResult()),
    terminalAt:
      state === "completed" ? "2026-09-02T00:00:03.000Z" : null,
    terminalReason:
      state === "claimed"
        ? "fallback.claimed"
        : "fallback.local_result_reused",
    ...overrides,
  };
  return Pr6rCampaignFallbackStateV1Schema.parse(
    state === "available"
      ? { ...AVAILABLE_FALLBACK_STATE, ...overrides }
      : state === "not_used"
        ? {
            ...AVAILABLE_FALLBACK_STATE,
            state,
            terminalReason: "fallback.not_used",
            ...overrides,
          }
        : triggered,
  );
}

function comparisonWithFallback(
  state: FallbackState,
  overrides: Readonly<Record<string, unknown>> = {},
): Pr6rComparisonV1 {
  const triggerSlotId =
    overrides.triggerSlotId === "hybrid_cloud_if_selected"
      ? "hybrid_cloud_if_selected"
      : "cloud_synthesis";
  const value = clone(
    comparison(
      state === "available"
        ? ["pending", "pending", "pending"]
        : state === "not_used"
          ? ["completed", "completed", "not_selected"]
        : triggerSlotId === "hybrid_cloud_if_selected"
          ? ["completed", "failed", "failed"]
          : ["completed", "failed", "pending"],
    ),
  );
  value.fallbackState = fallbackState(state, overrides);
  if (typeof overrides.sourceReviewResultSha256 === "string") {
    value.synthesisDecisions[0].reviewResultSha256 =
      overrides.sourceReviewResultSha256;
  }
  if (
    value.fallbackState.state !== "available" &&
    value.fallbackState.state !== "not_used"
  ) {
    const triggerDecision =
      value.synthesisDecisions[
        triggerSlotId === "cloud_synthesis" ? 1 : 2
      ];
    if (typeof overrides.triggerTerminalSha256 === "string") {
      triggerDecision.authoritySlotTerminalSha256 =
        overrides.triggerTerminalSha256;
    }
    const triggerTerminalSha256 =
      triggerDecision.authoritySlotTerminalSha256;
    if (triggerTerminalSha256 === null) {
      throw new Error("test fixture requires a failed Cloud terminal");
    }
    value.fallbackState.triggerTerminalSha256 = triggerTerminalSha256;
  }
  return Pr6rComparisonV1Schema.parse(value);
}

function projectionFor(
  value: Pr6rComparisonV1,
  completedReviewResult: ReviewResultV1 = reviewResult(),
): Pr6rSafeProjectionV1 {
  return Pr6rSafeProjectionV1Schema.parse({
    schemaVersion: "pr6r-safe-projection-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: IMPLEMENTATION_REVISION,
    fixtureId: PR6R_FROZEN_FIXTURE_V1.fixtureId,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    commonCheckpointSha256: CHECKPOINT.checkpointSha256,
    packetSha256: CHECKPOINT.packetSha256,
    semanticMessagesSha256: CHECKPOINT.semanticMessagesSha256,
    outputContractSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    osAuthorityClaim: {
      authorityClaimId: value.osAuthorityClaim.authorityClaimId,
      authorityClaimSha256: value.osAuthorityClaim.authorityClaimSha256,
      implementationRevision: value.osAuthorityClaim.implementationRevision,
      storageScope: value.osAuthorityClaim.storageScope,
      claimedAt: value.osAuthorityClaim.claimedAt,
      actualPaidAuthority: value.osAuthorityClaim.actualPaidAuthority,
      actualExternalSpendMicrousd:
        value.osAuthorityClaim.actualExternalSpendMicrousd,
    },
    providerValidation: {
      validationId: value.providerValidation.validationId,
      validationSha256: value.providerValidation.validationSha256,
      syntheticProviderId: value.providerValidation.syntheticProviderId,
      implementationRevision:
        value.providerValidation.implementationRevision,
      model: value.providerValidation.model,
      upstreamSlug: value.providerValidation.upstreamSlug,
      providerKind: value.providerValidation.providerKind,
      transport: value.providerValidation.transport,
      validationOutcome: value.providerValidation.validationOutcome,
      validatedAt: value.providerValidation.validatedAt,
      externalProviderContact:
        value.providerValidation.externalProviderContact,
      actualPaidAuthority: value.providerValidation.actualPaidAuthority,
      actualExternalSpendMicrousd:
        value.providerValidation.actualExternalSpendMicrousd,
    },
    pricingSnapshot: {
      pricingSnapshotId: value.pricingSnapshot.pricingSnapshotId,
      pricingSnapshotSha256: value.pricingSnapshot.pricingSnapshotSha256,
      providerValidationId: value.pricingSnapshot.providerValidationId,
      providerValidationSha256:
        value.pricingSnapshot.providerValidationSha256,
      implementationRevision: value.pricingSnapshot.implementationRevision,
      model: value.pricingSnapshot.model,
      upstreamSlug: value.pricingSnapshot.upstreamSlug,
      currency: value.pricingSnapshot.currency,
      rateUnit: value.pricingSnapshot.rateUnit,
      inputRateMicrousdPerMillion:
        value.pricingSnapshot.inputRateMicrousdPerMillion,
      outputRateMicrousdPerMillion:
        value.pricingSnapshot.outputRateMicrousdPerMillion,
      cacheReadRateMicrousdPerMillion:
        value.pricingSnapshot.cacheReadRateMicrousdPerMillion,
      cacheWriteRateMicrousdPerMillion:
        value.pricingSnapshot.cacheWriteRateMicrousdPerMillion,
      reasoningBilling: value.pricingSnapshot.reasoningBilling,
      source: value.pricingSnapshot.source,
      costScope: value.pricingSnapshot.costScope,
      actualPaidAuthority: value.pricingSnapshot.actualPaidAuthority,
      actualExternalSpendMicrousd:
        value.pricingSnapshot.actualExternalSpendMicrousd,
    },
    commonInvestigation: {
      investigationId: value.commonInvestigation.investigationId,
      investigationSha256: value.commonInvestigation.investigationSha256,
      implementationRevision:
        value.commonInvestigation.implementationRevision,
      durationMs: value.commonInvestigation.durationMs,
      toolCallCount: value.commonInvestigation.toolCallCount,
      terminalReason: value.commonInvestigation.terminalReason,
    },
    fallbackState: projectPr6rSafeCampaignFallbackStateV1(
      value.fallbackState,
    ),
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    synthesisDecisions: value.synthesisDecisions.map((decision) => {
      const { reservationId: _reservationId, ...simulationCost } =
        decision.simulationCost;
      return {
        slotId: decision.slotId,
        ordinal: decision.ordinal,
        state: decision.state,
        requestDisposition: decision.requestDisposition,
        synthesisLatencyMs: decision.synthesisLatencyMs,
        tokenAccounting: decision.tokenAccounting,
        simulationCost: {
          ...simulationCost,
          schemaVersion: "pr6r-safe-simulation-cost-v1",
        },
        outputValidity: decision.outputValidity,
        terminalReason: decision.terminalReason,
        output:
          decision.state === "completed"
            ? {
                reviewResult: completedReviewResult,
                reviewResultSha256: canonicalPr6rReviewResultSha256(
                  completedReviewResult,
                ),
              }
            : null,
      };
    }),
  });
}

function createCampaign(store: Pr6rCanaryStore): void {
  store.createCampaign({
    recordId: "campaign-created",
    campaign: campaign(),
    createdAt: "2026-09-02T00:00:00.000Z",
  });
}

function appendPair(
  store: Pr6rCanaryStore,
  value: Pr6rComparisonV1,
  expectedSequence: number,
  createdAt: string,
  projection: unknown = projectionFor(value),
): void {
  store.appendComparisonProjection({
    comparisonRecordId: `comparison-${expectedSequence}`,
    safeProjectionRecordId: `projection-${expectedSequence}`,
    expectedSequence,
    comparison: value,
    safeProjection: projection,
    createdAt,
  });
}

function insertRawRecord(
  database: BetterSqlite3.Database,
  input: {
    id: string;
    sequence: number;
    recordType: "campaign" | "comparison" | "safe_projection";
    payload: unknown;
    createdAt?: string;
    campaignId?: string;
  },
): void {
  const payloadJson = canonicalPr6rJsonV1(input.payload);
  database
    .prepare(
      `INSERT INTO pr6r_campaign_records (
         id, campaign_id, sequence, record_type, payload_json,
         payload_sha256, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.campaignId ?? PR6R_CAMPAIGN_ID,
      input.sequence,
      input.recordType,
      payloadJson,
      sha256(payloadJson),
      input.createdAt ?? "2026-09-02T00:00:01.000Z",
    );
}

describe("PR6R development canary store", () => {
  it.each(["", " canary.sqlite", "canary.sqlite", ":memory:"])(
    "requires an explicit absolute durable database path (%j)",
    (invalidPath) => {
      expect(() => new Pr6rCanaryStore(invalidPath)).toThrow(
        /explicit absolute database path/u,
      );
    },
  );

  it("persists a valid three-output safe projection larger than one result bound", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      appendPair(
        store,
        comparison(["pending", "pending", "pending"]),
        1,
        "2026-09-02T00:00:01.000Z",
      );
      const output = largeReviewResult();
      const localCompleted = comparisonForOutput(
        ["completed", "pending", "pending"],
        output,
      );
      appendPair(
        store,
        localCompleted,
        3,
        "2026-09-02T00:00:02.000Z",
        projectionFor(localCompleted, output),
      );
      const cloudCompleted = comparisonForOutput(
        ["completed", "completed", "pending"],
        output,
      );
      appendPair(
        store,
        cloudCompleted,
        5,
        "2026-09-02T00:00:03.000Z",
        projectionFor(cloudCompleted, output),
      );

      const terminal = comparisonForOutput(
        ["completed", "completed", "completed"],
        output,
      );
      const projection = projectionFor(terminal, output);
      const projectionBytes = Buffer.byteLength(
        canonicalPr6rJsonV1(projection),
        "utf8",
      );
      expect(projectionBytes).toBeGreaterThan(
        REVIEW_RESULT_V1_LIMITS.maxSerializedRecordBytes,
      );
      expect(projectionBytes).toBeLessThanOrEqual(
        PR6R_CANARY_MAX_PAYLOAD_BYTES,
      );

      appendPair(
        store,
        terminal,
        7,
        "2026-09-02T00:00:04.000Z",
        projection,
      );
      expect(store.replay()?.safeProjection).toEqual(projection);
    } finally {
      store.close();
    }
  });

  it("rejects no-op comparison snapshots", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      const pending = comparison(["pending", "pending", "pending"]);
      appendPair(store, pending, 1, "2026-09-02T00:00:01.000Z");
      expect(() =>
        appendPair(store, pending, 3, "2026-09-02T00:00:02.000Z"),
      ).toThrow(/must change state/u);
      expect(store.replay()?.records).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it("fails closed before replaying an overlong raw record history", () => {
    const file = databasePath();
    const store = new Pr6rCanaryStore(file);
    createCampaign(store);
    const pending = comparison(["pending", "pending", "pending"]);
    const projection = projectionFor(pending);
    for (let sequence = 2; sequence <= PR6R_CANARY_MAX_RECORDS + 1; sequence += 1) {
      const comparisonRecord = sequence % 2 === 0;
      insertRawRecord(databaseForTest(store), {
        id: `flood-${sequence}`,
        sequence,
        recordType: comparisonRecord ? "comparison" : "safe_projection",
        payload: comparisonRecord ? pending : projection,
      });
    }
    store.close();

    expect(() => new Pr6rCanaryStore(file)).toThrow(/record-count bound/u);
  });

  it("fails closed before materializing an oversized raw payload on reopen", () => {
    const file = databasePath();
    const store = new Pr6rCanaryStore(file);
    createCampaign(store);
    store.close();

    const raw = new BetterSqlite3(file);
    raw.pragma("ignore_check_constraints = ON");
    insertRawRecord(raw, {
      id: "oversized-raw-payload",
      sequence: 2,
      recordType: "comparison",
      payload: { padding: "x".repeat(PR6R_CANARY_MAX_PAYLOAD_BYTES + 1) },
    });
    raw.close();

    expect(() => new Pr6rCanaryStore(file)).toThrow(/payload byte bound/u);
  });

  it("owns a checksummed schema fingerprint, index, and append-only triggers", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      expect(
        databaseForTest(store)
          .prepare(
            `SELECT version, name, schema_fingerprint_sha256,
                    payload_contract_version,
                    payload_contract_fingerprint_sha256
             FROM pr6r_schema_migrations`,
          )
          .get(),
      ).toMatchObject({
        version: PR6R_CANARY_STORE_SCHEMA_VERSION,
        name: PR6R_CANARY_STORE_MIGRATION_NAME,
        schema_fingerprint_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        payload_contract_version: PR6R_CANARY_PAYLOAD_CONTRACT_VERSION,
        payload_contract_fingerprint_sha256:
          PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256,
      });
      expect(
        databaseForTest(store)
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type IN ('index', 'trigger') AND sql IS NOT NULL
             ORDER BY name`,
          )
          .all()
          .map((row) => (row as { name: string }).name),
      ).toEqual([
        "pr6r_campaign_records_no_delete",
        "pr6r_campaign_records_no_update",
        "pr6r_campaign_records_sequence_idx",
        "pr6r_campaigns_no_delete",
        "pr6r_campaigns_no_update",
        "pr6r_schema_migrations_no_delete",
        "pr6r_schema_migrations_no_update",
      ]);

      createCampaign(store);
      expect(() =>
        databaseForTest(store).prepare("DELETE FROM pr6r_campaigns").run(),
      ).toThrow(/append-only/u);
      expect(() =>
        databaseForTest(store)
          .prepare("UPDATE pr6r_campaign_records SET sequence = 2")
          .run(),
      ).toThrow(/append-only/u);
    } finally {
      store.close();
    }
  });

  it.each([
    [
      "payload-contract version",
      "payload_contract_version",
      "pr6r-canary-payload-contract-v999",
    ],
    [
      "payload-contract fingerprint",
      "payload_contract_fingerprint_sha256",
      HASH_A,
    ],
  ] as const)(
    "rejects a reopened database with a tampered %s",
    (_label, column, replacement) => {
      const file = databasePath();
      const store = new Pr6rCanaryStore(file);
      store.close();

      const raw = new BetterSqlite3(file);
      const trigger = raw
        .prepare(
          `SELECT sql FROM sqlite_schema
           WHERE type = 'trigger' AND name = 'pr6r_schema_migrations_no_update'`,
        )
        .get() as { sql: string };
      raw.pragma("ignore_check_constraints = ON");
      raw.exec("DROP TRIGGER pr6r_schema_migrations_no_update");
      raw
        .prepare(`UPDATE pr6r_schema_migrations SET ${column} = ?`)
        .run(replacement);
      raw.exec(trigger.sql);
      raw.close();

      expect(() => new Pr6rCanaryStore(file)).toThrow(/migration ledger/u);
    },
  );

  it("atomically persists and replays one monotonic three-slot topology", () => {
    const file = databasePath();
    const first = new Pr6rCanaryStore(file);
    createCampaign(first);
    appendPair(
      first,
      comparison(["pending", "pending", "pending"]),
      1,
      "2026-09-02T00:00:01.000Z",
    );
    appendPair(
      first,
      comparison(["completed", "pending", "pending"]),
      3,
      "2026-09-02T00:00:02.000Z",
    );
    appendPair(
      first,
      comparison(["completed", "completed", "pending"]),
      5,
      "2026-09-02T00:00:03.000Z",
    );
    appendPair(
      first,
      comparison(["completed", "completed", "completed"]),
      7,
      "2026-09-02T00:00:04.000Z",
    );
    first.close();

    const reopened = new Pr6rCanaryStore(file);
    try {
      const replay = reopened.replay();
      expect(replay?.records).toHaveLength(9);
      expect(replay?.records.map((record) => record.recordType)).toEqual([
        "campaign",
        "comparison",
        "safe_projection",
        "comparison",
        "safe_projection",
        "comparison",
        "safe_projection",
        "comparison",
        "safe_projection",
      ]);
      expect(
        replay?.comparison?.synthesisDecisions.map((decision) => decision.state),
      ).toEqual(["completed", "completed", "completed"]);
      expect(replay?.safeProjection?.actualExternalSpendMicrousd).toBe(0);
      expect(Object.isFrozen(replay)).toBe(true);
      expect(Object.isFrozen(replay?.records)).toBe(true);
      expect(JSON.stringify(replay?.safeProjection)).not.toMatch(
        /authorization|headers|canonicalBodyUtf8|raw error|endpoint/iu,
      );
    } finally {
      reopened.close();
    }
  });

  it("rolls back stale, duplicate-ID, and unsafe projection pairs", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      const pending = comparison(["pending", "pending", "pending"]);
      expect(() =>
        store.appendComparisonProjection({
          comparisonRecordId: "stale-comparison",
          safeProjectionRecordId: "stale-projection",
          expectedSequence: 0,
          comparison: pending,
          safeProjection: projectionFor(pending),
          createdAt: "2026-09-02T00:00:01.000Z",
        }),
      ).toThrow(Pr6rCanarySequenceConflictError);
      expect(() =>
        store.appendComparisonProjection({
          comparisonRecordId: "duplicate-record",
          safeProjectionRecordId: "duplicate-record",
          expectedSequence: 1,
          comparison: pending,
          safeProjection: projectionFor(pending),
          createdAt: "2026-09-02T00:00:01.000Z",
        }),
      ).toThrow();
      expect(() =>
        appendPair(store, pending, 1, "2026-09-02T00:00:01.000Z", {
          ...projectionFor(pending),
          headers: { authorization: "synthetic-secret" },
        }),
      ).toThrow();
      expect(store.replay()?.records).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("never admits an internal fallback session ID into the safe projection", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      const available = comparisonWithFallback("available");
      appendPair(store, available, 1, "2026-09-02T00:00:01.000Z");
      const claimed = comparisonWithFallback("claimed");
      const safeProjection = projectionFor(claimed);
      expect(safeProjection.fallbackState).not.toHaveProperty(
        "sourceSynthesisSessionId",
      );
      const unsafeProjection = clone(safeProjection) as any;
      unsafeProjection.fallbackState.sourceSynthesisSessionId =
        "api.example.invalid:443";

      expect(() =>
        appendPair(
          store,
          claimed,
          3,
          "2026-09-02T00:00:02.000Z",
          unsafeProjection,
        ),
      ).toThrow();
      expect(store.replay()?.records).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it("rejects campaign rows that predate authority, provider, or pricing evidence", () => {
    const futureAt = "2026-09-02T00:00:01.000Z";
    const futureAuthority = clone(campaign());
    futureAuthority.osAuthorityClaim = buildPr6rOsAuthorityClaimV1({
      implementationRevision: IMPLEMENTATION_REVISION,
      claimedAt: futureAt,
      ledgerCampaignRecordSha256: HASH_D,
      ledgerGuardRecordSha256: HASH_E,
    });

    const futureProvider = clone(campaign());
    futureProvider.providerValidation = buildPr6rLoopbackProviderValidationV1({
      implementationRevision: IMPLEMENTATION_REVISION,
      validatedAt: futureAt,
    });
    futureProvider.pricingSnapshot = buildPr6rSimulationPricingSnapshotV1({
      implementationRevision: IMPLEMENTATION_REVISION,
      providerValidationSha256:
        futureProvider.providerValidation.validationSha256,
      validatedAt: futureAt,
    });

    const futurePricing = clone(campaign());
    futurePricing.pricingSnapshot = buildPr6rSimulationPricingSnapshotV1({
      implementationRevision: IMPLEMENTATION_REVISION,
      providerValidationSha256: PROVIDER_VALIDATION.validationSha256,
      validatedAt: futureAt,
    });

    const store = new Pr6rCanaryStore(databasePath());
    try {
      [futureAuthority, futureProvider, futurePricing].forEach(
        (futureEvidence, index) => {
          expect(() =>
            store.createCampaign({
              recordId: `future-evidence-${index}`,
              campaign: futureEvidence,
              createdAt: EVIDENCE_AT,
            }),
          ).toThrow(/timestamp precedes embedded .* evidence/u);
        },
      );
      expect(store.replay()).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("rejects pricing evidence that predates its hash-bound provider validation", () => {
    const invalidChronology = clone(campaign());
    invalidChronology.providerValidation =
      buildPr6rLoopbackProviderValidationV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        validatedAt: "2026-09-02T00:00:01.000Z",
      });
    invalidChronology.pricingSnapshot =
      buildPr6rSimulationPricingSnapshotV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        providerValidationSha256:
          invalidChronology.providerValidation.validationSha256,
        validatedAt: EVIDENCE_AT,
      });

    const store = new Pr6rCanaryStore(databasePath());
    try {
      expect(() =>
        store.createCampaign({
          recordId: "provider-after-pricing",
          campaign: invalidChronology,
          createdAt: "2026-09-02T00:00:02.000Z",
        }),
      ).toThrow(/price cannot predate the provider validation/u);
      expect(store.replay()).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("rejects comparison rows that predate fallback claim or terminal evidence", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      appendPair(
        store,
        comparisonWithFallback("available"),
        1,
        "2026-09-02T00:00:01.000Z",
      );
      expect(() =>
        appendPair(
          store,
          comparisonWithFallback("claimed"),
          3,
          "2026-09-02T00:00:01.500Z",
        ),
      ).toThrow(/timestamp precedes embedded fallback claim evidence/u);
      expect(store.replay()?.records).toHaveLength(3);

      appendPair(
        store,
        comparisonWithFallback("claimed"),
        3,
        "2026-09-02T00:00:02.000Z",
      );
      expect(() =>
        appendPair(
          store,
          comparisonWithFallback("completed"),
          5,
          "2026-09-02T00:00:02.500Z",
        ),
      ).toThrow(/timestamp precedes embedded fallback terminal evidence/u);
      expect(store.replay()?.records).toHaveLength(5);
    } finally {
      store.close();
    }
  });

  it("rejects backdated embedded fallback evidence during reopen replay", () => {
    const file = databasePath();
    const store = new Pr6rCanaryStore(file);
    createCampaign(store);
    const available = comparisonWithFallback("available");
    insertRawRecord(databaseForTest(store), {
      id: "raw-available-comparison",
      sequence: 2,
      recordType: "comparison",
      payload: available,
      createdAt: "2026-09-02T00:00:01.000Z",
    });
    insertRawRecord(databaseForTest(store), {
      id: "raw-available-projection",
      sequence: 3,
      recordType: "safe_projection",
      payload: projectionFor(available),
      createdAt: "2026-09-02T00:00:01.000Z",
    });
    const claimed = comparisonWithFallback("claimed");
    insertRawRecord(databaseForTest(store), {
      id: "raw-backdated-comparison",
      sequence: 4,
      recordType: "comparison",
      payload: claimed,
      createdAt: "2026-09-02T00:00:01.500Z",
    });
    insertRawRecord(databaseForTest(store), {
      id: "raw-backdated-projection",
      sequence: 5,
      recordType: "safe_projection",
      payload: projectionFor(claimed),
      createdAt: "2026-09-02T00:00:01.500Z",
    });
    store.close();

    expect(() => new Pr6rCanaryStore(file)).toThrow(
      /timestamp precedes embedded fallback claim evidence/u,
    );
  });

  it("rejects cross-parent, cross-checkpoint, child-session, and projection drift", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      const pending = comparison(["pending", "pending", "pending"]);
      const wrongParent = clone(pending);
      wrongParent.parentSessionId = "another-parent";
      wrongParent.synthesisDecisions.forEach((decision) => {
        decision.parentSessionId = "another-parent";
      });
      wrongParent.commonInvestigation = buildPr6rCommonInvestigationV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        parentSessionId: "another-parent",
        commonCheckpointSha256: CHECKPOINT.checkpointSha256,
        durationMs: 1,
        toolCallCount: 1,
      });
      expect(() =>
        appendPair(
          store,
          Pr6rComparisonV1Schema.parse(wrongParent),
          1,
          "2026-09-02T00:00:01.000Z",
        ),
      ).toThrow(/topology/u);

      const wrongCheckpoint = clone(pending);
      wrongCheckpoint.commonCheckpointSha256 = HASH_A;
      wrongCheckpoint.synthesisDecisions.forEach((decision) => {
        decision.commonCheckpointSha256 = HASH_A;
      });
      wrongCheckpoint.commonInvestigation = buildPr6rCommonInvestigationV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        parentSessionId: PARENT_SESSION_ID,
        commonCheckpointSha256: HASH_A,
        durationMs: 1,
        toolCallCount: 1,
      });
      expect(() =>
        appendPair(
          store,
          Pr6rComparisonV1Schema.parse(wrongCheckpoint),
          1,
          "2026-09-02T00:00:01.000Z",
        ),
      ).toThrow(/topology/u);

      const wrongProjection = clone(projectionFor(pending));
      wrongProjection.packetSha256 = HASH_A;
      expect(() =>
        appendPair(
          store,
          pending,
          1,
          "2026-09-02T00:00:01.000Z",
          Pr6rSafeProjectionV1Schema.parse(wrongProjection),
        ),
      ).toThrow(/projection topology/u);

      const otherProviderValidation = buildPr6rLoopbackProviderValidationV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        validatedAt: "2026-09-02T00:00:01.000Z",
      });
      const otherPricingSnapshot = buildPr6rSimulationPricingSnapshotV1({
        implementationRevision: IMPLEMENTATION_REVISION,
        providerValidationSha256:
          otherProviderValidation.validationSha256,
        validatedAt: "2026-09-02T00:00:01.000Z",
      });
      const wrongEvidence = clone(pending);
      wrongEvidence.providerValidation = otherProviderValidation;
      wrongEvidence.pricingSnapshot = otherPricingSnapshot;
      wrongEvidence.synthesisDecisions.forEach((decision) => {
        decision.simulationCost.pricingSnapshotSha256 =
          otherPricingSnapshot.pricingSnapshotSha256;
      });
      expect(() =>
        appendPair(
          store,
          Pr6rComparisonV1Schema.parse(wrongEvidence),
          1,
          "2026-09-02T00:00:01.000Z",
        ),
      ).toThrow(/evidence/u);

      appendPair(
        store,
        pending,
        1,
        "2026-09-02T00:00:01.000Z",
      );
      const localDone = comparison(["completed", "pending", "pending"]);
      const latencyDrift = clone(projectionFor(localDone));
      latencyDrift.synthesisDecisions[0].synthesisLatencyMs = 2;
      expect(() =>
        appendPair(
          store,
          localDone,
          3,
          "2026-09-02T00:00:02.000Z",
          Pr6rSafeProjectionV1Schema.parse(latencyDrift),
        ),
      ).toThrow(/does not equal/u);
      appendPair(store, localDone, 3, "2026-09-02T00:00:02.000Z");
      const badChild = clone(
        comparison(["completed", "completed", "pending"]),
      );
      badChild.synthesisDecisions[1].synthesisSessionId = PARENT_SESSION_ID;
      expect(() =>
        appendPair(
          store,
          Pr6rComparisonV1Schema.parse(badChild),
          5,
          "2026-09-02T00:00:03.000Z",
        ),
      ).toThrow(/distinct children/u);
    } finally {
      store.close();
    }
  });

  it("rejects different canonical request bodies across Cloud and Hybrid", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      const differentBody = clone(
        comparison(["completed", "failed", "failed"]),
      );
      differentBody.synthesisDecisions[2].requestBodySha256 = HASH_A;
      expect(() =>
        appendPair(
          store,
          differentBody,
          1,
          "2026-09-02T00:00:02.000Z",
        ),
      ).toThrow(/share the exact canonical request body/u);
      expect(store.replay()?.records).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rejects projection disagreement and every terminal regression", () => {
    const store = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(store);
      const pending = comparison(["pending", "pending", "pending"]);
      const mismatchedProjection = projectionFor(
        comparison(["completed", "pending", "pending"]),
      );
      expect(() =>
        appendPair(
          store,
          pending,
          1,
          "2026-09-02T00:00:01.000Z",
          mismatchedProjection,
        ),
      ).toThrow(/does not equal/u);

      appendPair(
        store,
        pending,
        1,
        "2026-09-02T00:00:01.000Z",
      );
      const localDone = comparison(["completed", "pending", "pending"]);
      appendPair(store, localDone, 3, "2026-09-02T00:00:02.000Z");

      expect(() =>
        appendPair(
          store,
          pending,
          5,
          "2026-09-02T00:00:03.000Z",
        ),
      ).toThrow(/terminal synthesis state/u);
      expect(() =>
        appendPair(
          store,
          comparison(["failed", "pending", "pending"]),
          5,
          "2026-09-02T00:00:03.000Z",
        ),
      ).toThrow(/terminal synthesis state/u);
      expect(() =>
        appendPair(
          store,
          comparison(["pending", "completed", "pending"]),
          5,
          "2026-09-02T00:00:03.000Z",
        ),
      ).toThrow(/slot order/u);
      expect(() =>
        appendPair(
          store,
          comparison(["completed", "pending", "pending"]),
          5,
          "2026-09-01T23:59:59.000Z",
        ),
      ).toThrow(/timestamps/u);
      expect(store.replay()?.records).toHaveLength(5);
    } finally {
      store.close();
    }
  });

  it.each(["claimed", "not_used"] as const)(
    "rejects %s as the initial fallback state",
    (state) => {
      const store = new Pr6rCanaryStore(databasePath());
      try {
        createCampaign(store);
        const invalidInitial = comparisonWithFallback(state);
        expect(() =>
          appendPair(
            store,
            invalidInitial,
            1,
            "2026-09-02T00:00:01.000Z",
          ),
        ).toThrow(/begin with fallback available/u);
        expect(store.replay()?.records).toHaveLength(1);
      } finally {
        store.close();
      }
    },
  );

  it("allows the fallback ratchet and rejects terminal regressions", () => {
    const claimedStore = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(claimedStore);
      const available = comparisonWithFallback("available");
      const claimed = comparisonWithFallback("claimed");
      const completed = comparisonWithFallback("completed");
      appendPair(
        claimedStore,
        available,
        1,
        "2026-09-02T00:00:01.000Z",
      );
      appendPair(
        claimedStore,
        claimed,
        3,
        "2026-09-02T00:00:02.000Z",
      );
      expect(() =>
        appendPair(
          claimedStore,
          claimed,
          5,
          "2026-09-02T00:00:03.000Z",
        ),
      ).toThrow(/must change state/u);
      appendPair(
        claimedStore,
        completed,
        5,
        "2026-09-02T00:00:04.000Z",
      );
      expect(() =>
        appendPair(
          claimedStore,
          completed,
          7,
          "2026-09-02T00:00:05.000Z",
        ),
      ).toThrow(/must change state/u);
      expect(() =>
        appendPair(
          claimedStore,
          claimed,
          7,
          "2026-09-02T00:00:06.000Z",
        ),
      ).toThrow(/terminal fallback state is immutable/u);
      expect(claimedStore.replay()?.records).toHaveLength(7);
    } finally {
      claimedStore.close();
    }

    const notUsedStore = new Pr6rCanaryStore(databasePath());
    try {
      createCampaign(notUsedStore);
      appendPair(
        notUsedStore,
        comparisonWithFallback("available"),
        1,
        "2026-09-02T00:00:01.000Z",
      );
      const notUsed = comparisonWithFallback("not_used");
      appendPair(
        notUsedStore,
        notUsed,
        3,
        "2026-09-02T00:00:02.000Z",
      );
      expect(() =>
        appendPair(
          notUsedStore,
          notUsed,
          5,
          "2026-09-02T00:00:03.000Z",
        ),
      ).toThrow(/must change state/u);
      expect(() =>
        appendPair(
          notUsedStore,
          comparisonWithFallback("available"),
          5,
          "2026-09-02T00:00:04.000Z",
        ),
      ).toThrow(/terminal fallback state is immutable/u);
      expect(notUsedStore.replay()?.records).toHaveLength(5);
    } finally {
      notUsedStore.close();
    }
  });

  it("allows a claimed fallback to reuse the completed Local result", () => {
      const store = new Pr6rCanaryStore(databasePath());
      try {
        createCampaign(store);
        appendPair(
          store,
          comparisonWithFallback("available"),
          1,
          "2026-09-02T00:00:01.000Z",
        );
        appendPair(
          store,
          comparisonWithFallback("claimed"),
          3,
          "2026-09-02T00:00:02.000Z",
        );
        appendPair(
          store,
          comparisonWithFallback("completed"),
          5,
          "2026-09-02T00:00:03.000Z",
        );
        expect(store.replay()?.comparison?.fallbackState.state).toBe(
          "completed",
        );
      } finally {
        store.close();
      }
  });

  it.each([
    ["triggerSlotId", "hybrid_cloud_if_selected"],
    ["triggerTerminalSha256", HASH_C],
    ["fallbackClaimSha256", HASH_D],
    ["claimedAt", "2026-09-02T00:00:03.000Z"],
    ["sourceReviewResultSha256", HASH_D],
  ] as const)(
    "rejects fallback trigger-identity drift in %s",
    (field, replacement) => {
      const store = new Pr6rCanaryStore(databasePath());
      try {
        createCampaign(store);
        appendPair(
          store,
          comparisonWithFallback("available"),
          1,
          "2026-09-02T00:00:01.000Z",
        );
        appendPair(
          store,
          comparisonWithFallback("claimed"),
          3,
          "2026-09-02T00:00:02.000Z",
        );
        expect(() =>
          appendPair(
            store,
            comparisonWithFallback("completed", {
              [field]: replacement,
            }),
            5,
            "2026-09-02T00:00:04.000Z",
          ),
        ).toThrow(/fallback trigger identity is immutable/u);
        expect(store.replay()?.records).toHaveLength(5);
      } finally {
        store.close();
      }
    },
  );

  it.each([
    ["trigger", "DROP TRIGGER pr6r_campaign_records_no_update"],
    ["index", "DROP INDEX pr6r_campaign_records_sequence_idx"],
  ])("rejects a reopened database with a missing %s", (_label, statement) => {
    const file = databasePath();
    const store = new Pr6rCanaryStore(file);
    store.close();
    const raw = new BetterSqlite3(file);
    raw.exec(statement);
    raw.close();
    expect(() => new Pr6rCanaryStore(file)).toThrow(/schema fingerprint/u);
  });

  it("rejects lookalike schemas and extra migration rows without repairing them", () => {
    const lookalikePath = databasePath();
    const lookalike = new BetterSqlite3(lookalikePath);
    lookalike.exec("CREATE TABLE pr6r_campaigns (campaign_id TEXT)");
    lookalike.close();
    expect(() => new Pr6rCanaryStore(lookalikePath)).toThrow(
      /schema fingerprint/u,
    );

    const extraMigrationPath = databasePath();
    const store = new Pr6rCanaryStore(extraMigrationPath);
    databaseForTest(store)
      .prepare(
        `INSERT INTO pr6r_schema_migrations (
           version, name, checksum_sha256, schema_fingerprint_sha256,
           payload_contract_version,
           payload_contract_fingerprint_sha256, applied_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        2,
        "lookalike-v2",
        HASH_A,
        HASH_B,
        PR6R_CANARY_PAYLOAD_CONTRACT_VERSION,
        PR6R_CANARY_PAYLOAD_CONTRACT_FINGERPRINT_SHA256,
        "2026-09-02T00:00:00.000Z",
      );
    store.close();
    expect(() => new Pr6rCanaryStore(extraMigrationPath)).toThrow(
      /migration ledger/u,
    );
  });

  it("runs foreign-key checks on reopen", () => {
    const file = databasePath();
    const store = new Pr6rCanaryStore(file);
    createCampaign(store);
    store.close();

    const raw = new BetterSqlite3(file);
    raw.pragma("foreign_keys = OFF");
    insertRawRecord(raw, {
      id: "orphan-record",
      campaignId: "another-campaign",
      sequence: 1,
      recordType: "campaign",
      payload: {},
    });
    raw.close();
    expect(() => new Pr6rCanaryStore(file)).toThrow(/foreign-key check/u);
  });

  it("detects canonical-payload tampering after an exact trigger restoration", () => {
    const file = databasePath();
    const store = new Pr6rCanaryStore(file);
    createCampaign(store);
    const pending = comparison(["pending", "pending", "pending"]);
    appendPair(
      store,
      pending,
      1,
      "2026-09-02T00:00:01.000Z",
    );
    store.close();

    const raw = new BetterSqlite3(file);
    const trigger = raw
      .prepare(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'trigger' AND name = 'pr6r_campaign_records_no_update'`,
      )
      .get() as { sql: string };
    raw.exec("DROP TRIGGER pr6r_campaign_records_no_update");
    raw
      .prepare(
        "UPDATE pr6r_campaign_records SET payload_json = ? WHERE sequence = 2",
      )
      .run("{}");
    raw.exec(trigger.sql);
    raw.close();

    expect(() => new Pr6rCanaryStore(file)).toThrow(/integrity check/u);
  });

  it("rejects unpaired and projection-before-comparison replay histories", () => {
    const unpairedPath = databasePath();
    const unpaired = new Pr6rCanaryStore(unpairedPath);
    createCampaign(unpaired);
    const pending = comparison(["pending", "pending", "pending"]);
    insertRawRecord(databaseForTest(unpaired), {
      id: "unpaired-comparison",
      sequence: 2,
      recordType: "comparison",
      payload: pending,
    });
    expect(() => unpaired.replay()).toThrow(/atomic safe projection/u);
    unpaired.close();

    const reorderedPath = databasePath();
    const reordered = new Pr6rCanaryStore(reorderedPath);
    createCampaign(reordered);
    insertRawRecord(databaseForTest(reordered), {
      id: "projection-first",
      sequence: 2,
      recordType: "safe_projection",
      payload: projectionFor(pending),
    });
    insertRawRecord(databaseForTest(reordered), {
      id: "comparison-second",
      sequence: 3,
      recordType: "comparison",
      payload: pending,
    });
    expect(() => reordered.replay()).toThrow(/record order/u);
    reordered.close();
  });
});
