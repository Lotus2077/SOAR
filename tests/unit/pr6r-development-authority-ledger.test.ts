import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const authorityTestOs = vi.hoisted(() => ({
  homeDirectory: "/soar-pr6r-authority-test-home-not-configured",
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    userInfo: (...args: Parameters<typeof actual.userInfo>) => ({
      ...actual.userInfo(...args),
      homedir: authorityTestOs.homeDirectory,
    }),
  };
});

vi.mock("../../src/main/pr6r-development/loopback-attempt-adapter", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/main/pr6r-development/loopback-attempt-adapter")
  >();
  const consumed = new WeakSet<object>();
  const consumedFinishes = new WeakSet<object>();
  return {
    ...actual,
    consumePr6rPreparedLoopbackAttemptAuthority(
      authority: object,
      input: {
        applicationRequest: { requestId?: string };
        reservationId: string;
      },
    ) {
      if (
        consumed.has(authority) ||
        input.applicationRequest.requestId !== "pr6r-a2-request" ||
        input.reservationId !== "pr6r-a2-reservation"
      ) {
        throw new Error("test prepared-attempt authority mismatch");
      }
      const selectedStart = (
        authority as {
          __testOnlySelectedStart?: {
            resolution: unknown;
            events: readonly unknown[];
          };
        }
      ).__testOnlySelectedStart;
      consumed.add(authority);
      return {
        childSessionId: "pr6r-a2-child",
        expectedSequence: 4,
        createdAt: "2026-09-02T00:00:02.000Z",
        campaignId: "pr6r-cal-007-v1",
        attemptId: "pr6r-a2-attempt",
        providerId: "pr6r-loopback-provider-v1",
        pricingSnapshotId: "pr6r-loopback-simulation-pricing-v1",
        costScope: "simulation",
        cloudEgressAdmissionId: "pr6r-a2-egress",
        reservationId: "pr6r-a2-reservation",
        ...(selectedStart === undefined ? {} : { selectedStart }),
      };
    },
    consumePr6rPreparedLoopbackFinishAuthority(
      authority: object,
      input: {
        applicationRequest: { requestId?: string };
        reservationId: string;
      },
    ) {
      const binding = (
        authority as {
          __testOnlyBinding?: {
            childSessionId: string;
            attemptId: string;
            reservationId: string;
            terminal: {
              terminalOutcome: "completed" | "failed" | "cancelled";
              requestDisposition: "sent" | "unknown";
              stableCode: string;
            };
            events: readonly unknown[];
            sqliteDispatchChain: {
              kind: "pr6r_sqlite_dispatch_chain";
              attemptId: string;
              reservationId: string;
            };
          };
        }
      ).__testOnlyBinding;
      if (
        consumedFinishes.has(authority) ||
        input.applicationRequest.requestId !== "pr6r-a2-request" ||
        input.reservationId !== "pr6r-a2-reservation" ||
        binding === undefined
      ) {
        throw new Error("test prepared-finish authority mismatch");
      }
      consumedFinishes.add(authority);
      return binding;
    },
  };
});

import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  reviewResultV1ResponseFormat,
} from "../../src/shared/review-result-contract";
import {
  createPr6rA2AdmittedSqliteFixture,
  createPr6rA2DeniedSqliteFixture,
  finishPr6rA2FixtureWithSchemaRejection,
} from "../helpers/pr6r-a2-sqlite-fixture";
import {
  PR6R_CAMPAIGN_FALLBACK_ID,
  PR6R_CAMPAIGN_ID,
  PR6R_DEVELOPMENT_AUTHORITY_V1,
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_FROZEN_FIXTURE_V1,
  PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS,
  PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS,
  PR6R_MODEL_SLUG,
  PR6R_REQUESTED_OUTPUT_TOKENS,
  PR6R_SYNTHETIC_UPSTREAM_SLUG,
  PR6R_SYNTHESIS_SLOTS_V1,
  Pr6rCampaignV1Schema,
  Pr6rComparisonV1Schema,
  Pr6rSafeProjectionV1Schema,
  buildPr6rCommonCheckpointV1,
  buildPr6rCommonInvestigationV1,
  buildPr6rLoopbackProviderValidationV1,
  buildPr6rSimulationPricingSnapshotV1,
  canonicalPr6rCloudApplicationRequestSha256,
  projectPr6rSafeCampaignFallbackStateV1,
  sealCloudApplicationRequestV1,
  type CloudApplicationRequestV1,
  type Pr6rCampaignV1,
  type Pr6rComparisonV1,
  type Pr6rSafeProjectionV1,
} from "../../src/shared/pr6r-development-contracts";
import {
  appendPr6rInitialComparisonProjectionWithCampaignAuthority,
  appendPr6rComparisonProjectionWithReconciledAuthority,
  bindPr6rCampaignExecutionAuthority,
  assertPr6rCrossStoreReconciledTerminalAuthority,
  assertPr6rCrossStoreReconciledTerminalLedger,
  buildPr6rOsAuthorityClaimFromLedger,
  buildPr6rCloudSlotBinding,
  claimPr6rCampaignAuthority,
  claimPr6rCloudSlot as claimPr6rCloudSlotProduction,
  claimPr6rLocalFallback as claimPr6rLocalFallbackProduction,
  consumePr6rCloudSlotDispatchArm,
  consumePr6rComparisonProjectionUseAuthority,
  inspectPr6rAuthorityLedger as inspectPr6rAuthorityLedgerProduction,
  preparePr6rCloudSlotDispatchArm,
  recoverPr6rCloudSlot,
  recoverPr6rFailedTerminalForFallback,
  terminalizePr6rCloudSlotFromSqliteReceipt,
  terminalizePr6rCloudSlot as terminalizePr6rCloudSlotProduction,
  terminalizeRecoveredPr6rCloudSlot as terminalizeRecoveredPr6rCloudSlotProduction,
  type Pr6rCloudSlotBinding,
  type Pr6rCampaignAuthority,
  type Pr6rComparisonProjectionAppendInput,
  type Pr6rComparisonProjectionStore,
  type Pr6rComparisonProjectionUseAuthority,
  type Pr6rCrossStoreReconciledTerminalAuthority,
  type Pr6rSlotTerminalAuthority,
} from "../../src/main/pr6r-development/authority-ledger";
import {
  Pr6rCanaryStore,
  type Pr6rCanaryReplay,
} from "../../src/main/pr6r-development/canary-store";

const REVISION = "a".repeat(40);
const roots: string[] = [];
let activeAuthorityTestClockUsers = 0;
let activeAuthorityTestClockIso: string | undefined;
const PACKET_UTF8 = '{"fixture":"cal-007","scope":"public"}';
const PARENT_SESSION_ID = "pr6r-parent-session";

interface SlotBindingOverrides {
  requestId?: string;
  synthesisSessionId?: string;
  attemptId?: string;
  reservationId?: string;
  origin?: string;
  packetUtf8?: string;
  body?: ReturnType<typeof applicationBody>;
}

function applicationBody() {
  return {
    model: PR6R_MODEL_SLUG,
    messages: [
      { role: "system" as const, content: "Review the frozen public change." },
      { role: "user" as const, content: "Return the strict review result." },
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

function applicationRequestForSlot(
  slotId: Pr6rCloudSlotBinding["slotId"],
  overrides: SlotBindingOverrides = {},
): CloudApplicationRequestV1 {
  const requestId = overrides.requestId ?? `request-${slotId}`;
  const synthesisSessionId =
    overrides.synthesisSessionId ?? `session-${slotId}`;
  const attemptId = overrides.attemptId ?? `attempt-${slotId}`;
  const body = overrides.body ?? applicationBody();
  const packetUtf8 = overrides.packetUtf8 ?? PACKET_UTF8;
  const checkpoint = buildPr6rCommonCheckpointV1({
    parentSessionId: PARENT_SESSION_ID,
    packetUtf8,
    semanticMessages: body.messages,
  });
  return sealCloudApplicationRequestV1({
    requestId,
    parentSessionId: PARENT_SESSION_ID,
    synthesisSessionId,
    attemptId,
    slotId,
    commonCheckpoint: checkpoint,
    packetUtf8,
    origin: overrides.origin ?? "http://127.0.0.1:43123",
    body,
  });
}

function slotBinding(
  slotId: Pr6rCloudSlotBinding["slotId"],
  overrides: SlotBindingOverrides = {},
): Pr6rCloudSlotBinding {
  const digit = slotId === "cloud_synthesis" ? "c" : "d";
  return buildPr6rCloudSlotBinding({
    applicationRequest: applicationRequestForSlot(slotId, overrides),
    reservationId: overrides.reservationId ?? `reservation-${digit}`,
  });
}

function hybridBindingFromRequest(
  request: CloudApplicationRequestV1,
): Pr6rCloudSlotBinding {
  return buildPr6rCloudSlotBinding({
    applicationRequest: sealCloudApplicationRequestV1({
      requestId: "request-hybrid-reconciled",
      parentSessionId: request.parentSessionId,
      synthesisSessionId: "session-hybrid-reconciled",
      attemptId: "attempt-hybrid-reconciled",
      slotId: "hybrid_cloud_if_selected",
      commonCheckpoint: request.commonCheckpoint,
      packetUtf8: PACKET_UTF8,
      origin: request.origin,
      body: JSON.parse(request.canonicalBodyUtf8),
    }),
    reservationId: "reservation-hybrid-reconciled",
  });
}

function comparisonProjectionAppendInput(
  comparison: unknown,
  safeProjection: unknown = Object.freeze({ test: "projection" }),
  expectedSequence = 1,
) {
  return {
    comparisonRecordId: `comparison-reconciled-${expectedSequence}`,
    safeProjectionRecordId: `projection-reconciled-${expectedSequence}`,
    expectedSequence,
    comparison,
    safeProjection,
    createdAt: "2026-09-02T00:00:03.000Z",
  };
}

function authorityRecordSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeProjectionFor(
  request: CloudApplicationRequestV1,
  comparison: Pr6rComparisonV1,
): Pr6rSafeProjectionV1 {
  return Pr6rSafeProjectionV1Schema.parse({
    schemaVersion: "pr6r-safe-projection-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: comparison.implementationRevision,
    fixtureId: comparison.fixtureId,
    snapshotId: comparison.snapshotId,
    commonCheckpointSha256: comparison.commonCheckpointSha256,
    packetSha256: request.packetSha256,
    semanticMessagesSha256: request.semanticMessagesSha256,
    outputContractSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
    osAuthorityClaim: {
      authorityClaimId: comparison.osAuthorityClaim.authorityClaimId,
      authorityClaimSha256: comparison.osAuthorityClaim.authorityClaimSha256,
      implementationRevision:
        comparison.osAuthorityClaim.implementationRevision,
      storageScope: comparison.osAuthorityClaim.storageScope,
      claimedAt: comparison.osAuthorityClaim.claimedAt,
      actualPaidAuthority: comparison.osAuthorityClaim.actualPaidAuthority,
      actualExternalSpendMicrousd:
        comparison.osAuthorityClaim.actualExternalSpendMicrousd,
    },
    providerValidation: {
      validationId: comparison.providerValidation.validationId,
      validationSha256: comparison.providerValidation.validationSha256,
      syntheticProviderId: comparison.providerValidation.syntheticProviderId,
      implementationRevision:
        comparison.providerValidation.implementationRevision,
      model: comparison.providerValidation.model,
      upstreamSlug: comparison.providerValidation.upstreamSlug,
      providerKind: comparison.providerValidation.providerKind,
      transport: comparison.providerValidation.transport,
      validationOutcome: comparison.providerValidation.validationOutcome,
      validatedAt: comparison.providerValidation.validatedAt,
      externalProviderContact:
        comparison.providerValidation.externalProviderContact,
      actualPaidAuthority:
        comparison.providerValidation.actualPaidAuthority,
      actualExternalSpendMicrousd:
        comparison.providerValidation.actualExternalSpendMicrousd,
    },
    pricingSnapshot: {
      pricingSnapshotId: comparison.pricingSnapshot.pricingSnapshotId,
      pricingSnapshotSha256:
        comparison.pricingSnapshot.pricingSnapshotSha256,
      providerValidationId:
        comparison.pricingSnapshot.providerValidationId,
      providerValidationSha256:
        comparison.pricingSnapshot.providerValidationSha256,
      implementationRevision:
        comparison.pricingSnapshot.implementationRevision,
      model: comparison.pricingSnapshot.model,
      upstreamSlug: comparison.pricingSnapshot.upstreamSlug,
      currency: comparison.pricingSnapshot.currency,
      rateUnit: comparison.pricingSnapshot.rateUnit,
      inputRateMicrousdPerMillion:
        comparison.pricingSnapshot.inputRateMicrousdPerMillion,
      outputRateMicrousdPerMillion:
        comparison.pricingSnapshot.outputRateMicrousdPerMillion,
      cacheReadRateMicrousdPerMillion:
        comparison.pricingSnapshot.cacheReadRateMicrousdPerMillion,
      cacheWriteRateMicrousdPerMillion:
        comparison.pricingSnapshot.cacheWriteRateMicrousdPerMillion,
      reasoningBilling: comparison.pricingSnapshot.reasoningBilling,
      source: comparison.pricingSnapshot.source,
      costScope: comparison.pricingSnapshot.costScope,
      actualPaidAuthority: comparison.pricingSnapshot.actualPaidAuthority,
      actualExternalSpendMicrousd:
        comparison.pricingSnapshot.actualExternalSpendMicrousd,
    },
    commonInvestigation: {
      investigationId: comparison.commonInvestigation.investigationId,
      investigationSha256:
        comparison.commonInvestigation.investigationSha256,
      implementationRevision:
        comparison.commonInvestigation.implementationRevision,
      durationMs: comparison.commonInvestigation.durationMs,
      toolCallCount: comparison.commonInvestigation.toolCallCount,
      terminalReason: comparison.commonInvestigation.terminalReason,
    },
    fallbackState: projectPr6rSafeCampaignFallbackStateV1(
      comparison.fallbackState,
    ),
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    synthesisDecisions: comparison.synthesisDecisions.map((decision) => {
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
        output: null,
      };
    }),
  });
}

interface DeniedComparisonEvidence {
  readonly campaign: Pr6rCampaignV1;
  readonly baseline: Pr6rComparisonV1;
  readonly baselineProjection: Pr6rSafeProjectionV1;
  readonly terminal?: Pr6rComparisonV1;
  readonly terminalProjection?: Pr6rSafeProjectionV1;
}

async function deniedComparisonEvidenceFor(
  authority: Pr6rCampaignAuthority,
  request: CloudApplicationRequestV1,
  terminalInput?: {
    root: string;
    authority: Pr6rCrossStoreReconciledTerminalAuthority;
  },
): Promise<DeniedComparisonEvidence> {
  const osAuthorityClaim = await buildPr6rOsAuthorityClaimFromLedger(authority);
  const providerValidation = buildPr6rLoopbackProviderValidationV1({
    implementationRevision: REVISION,
    validatedAt: "2026-09-02T00:00:00.000Z",
  });
  const pricingSnapshot = buildPr6rSimulationPricingSnapshotV1({
    implementationRevision: REVISION,
    providerValidationSha256: providerValidation.validationSha256,
    validatedAt: "2026-09-02T00:00:00.000Z",
  });
  const commonInvestigation = buildPr6rCommonInvestigationV1({
    implementationRevision: REVISION,
    parentSessionId: request.parentSessionId,
    commonCheckpointSha256: request.commonCheckpointSha256,
    durationMs: 1,
    toolCallCount: 1,
  });
  const unreported = {
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
  const notReserved = {
    schemaVersion: "pr6r-simulation-cost-v1",
    pricingSnapshotId: pricingSnapshot.pricingSnapshotId,
    pricingSnapshotSha256: pricingSnapshot.pricingSnapshotSha256,
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
  const unavailable = {
    schemaVersion: "pr6r-output-validity-v1",
    status: "not_available",
    schemaAccepted: null,
    citationSupport: null,
    evidenceIntegrity: null,
    snapshotFreshness: null,
    coverageComplete: null,
  } as const;
  const pending = (
    slotId: "local_synthesis" | "cloud_synthesis" | "hybrid_cloud_if_selected",
    ordinal: 1 | 2 | 3,
  ) => ({
    slotId,
    ordinal,
    parentSessionId: request.parentSessionId,
    commonCheckpointSha256: request.commonCheckpointSha256,
    synthesisSessionId: null,
    state: "pending" as const,
    requestDisposition: null,
    applicationRequestSha256: null,
    authoritySlotClaimSha256: null,
    authoritySlotTerminalSha256: null,
    requestBodySha256: null,
    responseBodySha256: null,
    reviewResultSha256: null,
    synthesisLatencyMs: null,
    tokenAccounting: unreported,
    simulationCost: notReserved,
    outputValidity: unavailable,
    terminalReason: null,
  });
  const fallbackState = {
    schemaVersion: "pr6r-campaign-fallback-state-v1",
    fallbackId: PR6R_CAMPAIGN_FALLBACK_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: REVISION,
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
  const campaign = Pr6rCampaignV1Schema.parse({
    schemaVersion: "pr6r-campaign-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: REVISION,
    authority: PR6R_DEVELOPMENT_AUTHORITY_V1,
    osAuthorityClaim,
    providerValidation,
    pricingSnapshot,
    fixture: PR6R_FROZEN_FIXTURE_V1,
    parent: {
      sessionId: request.parentSessionId,
      commonCheckpoint: request.commonCheckpoint,
    },
    commonInvestigation,
    synthesisDecisions: PR6R_SYNTHESIS_SLOTS_V1.map((slot) => ({
      schemaVersion: "pr6r-synthesis-decision-v1",
      slot,
      parentSessionId: request.parentSessionId,
      commonCheckpointSha256: request.commonCheckpointSha256,
    })),
    fallbackState,
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
  });
  const baseline = Pr6rComparisonV1Schema.parse({
    schemaVersion: "pr6r-comparison-v1",
    campaignId: PR6R_CAMPAIGN_ID,
    implementationRevision: REVISION,
    fixtureId: PR6R_FROZEN_FIXTURE_V1.fixtureId,
    snapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
    parentSessionId: request.parentSessionId,
    commonCheckpointSha256: request.commonCheckpointSha256,
    osAuthorityClaim,
    providerValidation,
    pricingSnapshot,
    commonInvestigation,
    fallbackState,
    costScope: "simulation",
    actualPaidAuthority: false,
    actualExternalSpendMicrousd: 0,
    synthesisDecisions: [
      pending("local_synthesis", 1),
      pending("cloud_synthesis", 2),
      pending("hybrid_cloud_if_selected", 3),
    ],
  });
  const base = {
    campaign,
    baseline,
    baselineProjection: safeProjectionFor(request, baseline),
  };
  if (terminalInput === undefined) return base;
  const snapshot = await inspectPr6rAuthorityLedger(terminalInput.root);
  const slotClaim = snapshot?.slots.cloud_synthesis?.claim;
  if (slotClaim === undefined) throw new Error("Cloud claim must be durable");
  const terminal = structuredClone(baseline);
  terminal.synthesisDecisions[1] = {
    slotId: "cloud_synthesis",
    ordinal: 2,
    parentSessionId: request.parentSessionId,
    commonCheckpointSha256: request.commonCheckpointSha256,
    synthesisSessionId: request.synthesisSessionId,
    state: "failed",
    requestDisposition: "not_sent",
    applicationRequestSha256:
      canonicalPr6rCloudApplicationRequestSha256(request),
    authoritySlotClaimSha256: authorityRecordSha256(slotClaim),
    authoritySlotTerminalSha256:
      terminalInput.authority.osTerminalRecordSha256,
    requestBodySha256: request.canonicalBodySha256,
    responseBodySha256: null,
    reviewResultSha256: null,
    synthesisLatencyMs: 0,
    tokenAccounting: unreported,
    simulationCost: notReserved,
    outputValidity: unavailable,
    terminalReason: "loopback.budget_denied",
  };
  const parsedTerminal = Pr6rComparisonV1Schema.parse(terminal);
  return {
    ...base,
    terminal: parsedTerminal,
    terminalProjection: safeProjectionFor(request, parsedTerminal),
  };
}

async function deniedComparisonFor(
  authority: Pr6rCampaignAuthority,
  root: string,
  request: CloudApplicationRequestV1,
  terminal: Pr6rCrossStoreReconciledTerminalAuthority,
): Promise<Pr6rComparisonV1> {
  const evidence = await deniedComparisonEvidenceFor(authority, request, {
    root,
    authority: terminal,
  });
  if (evidence.terminal === undefined) {
    throw new Error("Denied terminal comparison must be available");
  }
  return evidence.terminal;
}

async function initialComparisonReplayFor(
  authority: Pr6rCampaignAuthority,
  request: CloudApplicationRequestV1,
): Promise<{
  readonly evidence: DeniedComparisonEvidence;
  readonly replay: Pr6rCanaryReplay;
}> {
  const evidence = await deniedComparisonEvidenceFor(authority, request);
  const directory = await mkdtemp(
    path.join(tmpdir(), "soar-pr6r-initial-comparison-"),
  );
  roots.push(directory);
  const store = new Pr6rCanaryStore(path.join(directory, "canary.sqlite"));
  try {
    store.createCampaign({
      recordId: "campaign-created",
      campaign: evidence.campaign,
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    await appendPr6rInitialComparisonProjectionWithCampaignAuthority(
      authority,
      store,
      {
        ...comparisonProjectionAppendInput(
          evidence.baseline,
          evidence.baselineProjection,
          1,
        ),
        createdAt: "2026-09-02T00:00:00.500Z",
      },
    );
    const replay = store.replay();
    if (replay === undefined) {
      throw new Error("Initial comparison replay must exist");
    }
    return { evidence, replay };
  } finally {
    store.close();
  }
}

async function deniedTerminalScenario() {
  const sqlite = createPr6rA2DeniedSqliteFixture();
  const root = await ledgerRoot();
  const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
    implementationRevision: REVISION,
    ledgerRoot: root,
    now: () => "2026-09-02T00:00:00.000Z",
  });
  const initial = await initialComparisonReplayFor(
    authority,
    sqlite.applicationRequest,
  );
  const cloud = await claimPr6rCloudSlot(
    authority,
    buildPr6rCloudSlotBinding({
      applicationRequest: sqlite.applicationRequest,
      reservationId: sqlite.reservationId,
    }),
    { now: () => "2026-09-02T00:00:01.000Z" },
  );
  if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
  await preparePr6rCloudSlotDispatchArm(cloud);
  const reconciled = await withAuthorityTestTime(
    () => "2026-09-02T00:00:02.000Z",
    () =>
      terminalizePr6rCloudSlotFromSqliteReceipt(cloud, {
        sqliteTerminalReceipt: sqlite.terminalReceipt,
        applicationRequest: sqlite.applicationRequest,
        reservationId: sqlite.reservationId,
      }),
  );
  const terminalEvidence = await deniedComparisonEvidenceFor(
    authority,
    sqlite.applicationRequest,
    { root, authority: reconciled },
  );
  if (
    terminalEvidence.terminal === undefined ||
    terminalEvidence.terminalProjection === undefined
  ) {
    throw new Error("Denied terminal evidence must be available");
  }
  return {
    sqlite,
    root,
    authority,
    initial,
    reconciled,
    comparison: terminalEvidence.terminal,
    projection: terminalEvidence.terminalProjection,
  };
}

async function schemaRejectedTerminalScenario() {
  const sqlite = createPr6rA2AdmittedSqliteFixture();
  const reservation = sqlite.ledger.listOutstandingReservations({
    sessionId: sqlite.applicationRequest.synthesisSessionId,
  })[0];
  if (reservation === undefined) {
    throw new Error("Schema-rejection scenario requires one reservation");
  }
  const root = await ledgerRoot();
  const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
    implementationRevision: REVISION,
    ledgerRoot: root,
    now: () => "2026-09-02T00:00:00.000Z",
  });
  const initial = await initialComparisonReplayFor(
    authority,
    sqlite.applicationRequest,
  );
  const cloud = await claimPr6rCloudSlot(
    authority,
    buildPr6rCloudSlotBinding({
      applicationRequest: sqlite.applicationRequest,
      reservationId: sqlite.reservationId,
    }),
    { now: () => "2026-09-02T00:00:01.000Z" },
  );
  if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
  const dispatchArm = await preparePr6rCloudSlotDispatchArm(cloud);
  consumePr6rCloudSlotDispatchArm(dispatchArm);
  const terminalReceipt = finishPr6rA2FixtureWithSchemaRejection(sqlite);
  const reconciled = await withAuthorityTestTime(
    () => "2026-09-02T00:00:04.000Z",
    () =>
      terminalizePr6rCloudSlotFromSqliteReceipt(cloud, {
        sqliteTerminalReceipt: terminalReceipt,
        applicationRequest: sqlite.applicationRequest,
        reservationId: sqlite.reservationId,
      }),
  );
  const snapshot = await inspectPr6rAuthorityLedger(root);
  const slotClaim = snapshot?.slots.cloud_synthesis?.claim;
  const terminalBudgetEntry = sqlite.ledger.runImmediate((transaction) =>
    transaction.getTerminalEntry(sqlite.reservationId),
  );
  if (slotClaim === undefined || terminalBudgetEntry === undefined) {
    throw new Error("Schema-rejection terminal evidence must be durable");
  }
  const comparison = structuredClone(initial.evidence.baseline);
  comparison.synthesisDecisions[1] = {
    slotId: "cloud_synthesis",
    ordinal: 2,
    parentSessionId: sqlite.applicationRequest.parentSessionId,
    commonCheckpointSha256:
      sqlite.applicationRequest.commonCheckpointSha256,
    synthesisSessionId: sqlite.applicationRequest.synthesisSessionId,
    state: "failed",
    requestDisposition: "sent",
    applicationRequestSha256:
      canonicalPr6rCloudApplicationRequestSha256(sqlite.applicationRequest),
    authoritySlotClaimSha256: authorityRecordSha256(slotClaim),
    authoritySlotTerminalSha256: reconciled.osTerminalRecordSha256,
    requestBodySha256: sqlite.applicationRequest.canonicalBodySha256,
    responseBodySha256: "e".repeat(64),
    reviewResultSha256: null,
    synthesisLatencyMs: 11,
    tokenAccounting: {
      schemaVersion: "pr6r-token-accounting-v1",
      reported: true,
      provenance: "provider_reported",
      inputTokens: sqlite.applicationRequest.estimatedInputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      visibleOutputTokens: 1,
      totalTokens: sqlite.applicationRequest.estimatedInputTokens + 1,
    },
    simulationCost: {
      schemaVersion: "pr6r-simulation-cost-v1",
      pricingSnapshotId: comparison.pricingSnapshot.pricingSnapshotId,
      pricingSnapshotSha256:
        comparison.pricingSnapshot.pricingSnapshotSha256,
      costScope: "simulation",
      actualPaidAuthority: false,
      actualExternalSpendMicrousd: 0,
      settlementState: "settled",
      reservationId: sqlite.reservationId,
      projectedMicrousd: reservation.amountMicrousd,
      reservedMicrousd: reservation.amountMicrousd,
      settledMicrousd: terminalBudgetEntry.amountMicrousd,
      provenance: "host_pricing_snapshot",
    },
    outputValidity: {
      schemaVersion: "pr6r-output-validity-v1",
      status: "failed",
      schemaAccepted: false,
      citationSupport: false,
      evidenceIntegrity: false,
      snapshotFreshness: false,
      coverageComplete: false,
    },
    terminalReason: "loopback.review_result_invalid",
  };
  const parsedComparison = Pr6rComparisonV1Schema.parse(comparison);
  return {
    sqlite,
    initial,
    reconciled,
    comparison: parsedComparison,
    projection: safeProjectionFor(sqlite.applicationRequest, parsedComparison),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function ledgerRoot(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "soar-pr6r-authority-"));
  roots.push(home);
  return productionLedgerRootForHome(await realpath(home));
}

function productionLedgerRootForHome(homeDirectory: string): string {
  return process.platform === "darwin"
    ? path.join(
        homeDirectory,
        "Library",
        "Application Support",
        "ai.soar.shared-authority",
        "pr6r-v1",
      )
    : path.join(
        homeDirectory,
        ".local",
        "state",
        "SOAR",
        "shared-authority",
        "pr6r-v1",
      );
}

function homeForProductionLedgerRoot(ledgerRoot: string): string {
  const segmentCount = process.platform === "darwin" ? 4 : 5;
  let homeDirectory = ledgerRoot;
  for (let index = 0; index < segmentCount; index += 1) {
    homeDirectory = path.dirname(homeDirectory);
  }
  if (productionLedgerRootForHome(homeDirectory) !== ledgerRoot) {
    throw new Error("Test ledger root is not a fixed production-layout root.");
  }
  return homeDirectory;
}

const pr6rAuthorityTestAccess = Object.freeze({
  async claimAtLedgerRoot(input: {
    implementationRevision: string;
    ledgerRoot: string;
    now?: () => string;
  }) {
    authorityTestOs.homeDirectory = homeForProductionLedgerRoot(
      input.ledgerRoot,
    );
    if (input.now === undefined) {
      return claimPr6rCampaignAuthority({
        implementationRevision: input.implementationRevision,
      });
    }
    return withAuthorityTestTime(input.now, () =>
      claimPr6rCampaignAuthority({
        implementationRevision: input.implementationRevision,
      }),
    );
  },
});

async function withAuthorityTestTime<T>(
  now: (() => string) | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (now === undefined) return operation();
  const instant = new Date(now());
  const instantIso = instant.toISOString();
  if (activeAuthorityTestClockUsers === 0) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);
    activeAuthorityTestClockIso = instantIso;
  } else if (activeAuthorityTestClockIso !== instantIso) {
    throw new Error("Concurrent authority test clocks must use one instant.");
  }
  activeAuthorityTestClockUsers += 1;
  try {
    return await operation();
  } finally {
    activeAuthorityTestClockUsers -= 1;
    if (activeAuthorityTestClockUsers === 0) {
      activeAuthorityTestClockIso = undefined;
      vi.useRealTimers();
    }
  }
}

function claimPr6rCloudSlot(
  authority: Parameters<typeof claimPr6rCloudSlotProduction>[0],
  binding: Parameters<typeof claimPr6rCloudSlotProduction>[1],
  options: {
    now?: () => string;
    priorTerminalAuthority?: Pr6rCrossStoreReconciledTerminalAuthority;
  } = {},
) {
  return withAuthorityTestTime(options.now, () =>
    claimPr6rCloudSlotProduction(
      authority,
      binding,
      options.priorTerminalAuthority,
    ),
  );
}

function terminalizePr6rCloudSlot(
  authority: Parameters<typeof terminalizePr6rCloudSlotProduction>[0],
  input: Parameters<typeof terminalizePr6rCloudSlotProduction>[1] & {
    now?: () => string;
  },
) {
  const { now, ...terminal } = input;
  return withAuthorityTestTime(now, () =>
    terminalizePr6rCloudSlotProduction(authority, terminal),
  );
}

function terminalizeRecoveredPr6rCloudSlot(
  authority: Parameters<
    typeof terminalizeRecoveredPr6rCloudSlotProduction
  >[0],
  options: { now?: () => string } = {},
) {
  return withAuthorityTestTime(options.now, () =>
    terminalizeRecoveredPr6rCloudSlotProduction(authority),
  );
}

function claimPr6rLocalFallback(
  authority:
    | Parameters<typeof claimPr6rLocalFallbackProduction>[0]
    | Pr6rSlotTerminalAuthority,
  options: { now?: () => string } = {},
) {
  return withAuthorityTestTime(options.now, () =>
    claimPr6rLocalFallbackProduction(
      authority as Parameters<typeof claimPr6rLocalFallbackProduction>[0],
    ),
  );
}

function inspectPr6rAuthorityLedger(ledgerRoot?: string) {
  if (ledgerRoot !== undefined) {
    authorityTestOs.homeDirectory = homeForProductionLedgerRoot(ledgerRoot);
  }
  return inspectPr6rAuthorityLedgerProduction();
}

function recordGuardPath(root: string, fileName: string): string {
  return path.join(
    path.dirname(root),
    `${path.basename(root)}.pr6r-record.${fileName}.guard`,
  );
}

describe("PR6R development authority ledger", () => {
  it("accepts every canonical cancellation reason under its matching disposition", async () => {
    const cancellationCases = [
      ["not_sent", PR6R_LOOPBACK_CANCELLED_NOT_SENT_REASONS],
      ["unknown", PR6R_LOOPBACK_CANCELLED_UNKNOWN_REASONS],
    ] as const;

    for (const [requestDisposition, stableCodes] of cancellationCases) {
      for (const stableCode of stableCodes) {
        const root = await ledgerRoot();
        const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
          implementationRevision: REVISION,
          ledgerRoot: root,
        });
        const claim = await claimPr6rCloudSlot(
          authority,
          slotBinding("cloud_synthesis"),
        );
        if (claim.status !== "claimed") {
          throw new Error("slot must be claimable");
        }
        await expect(
          terminalizePr6rCloudSlot(claim, {
            terminalOutcome: "cancelled",
            requestDisposition,
            stableCode,
          }),
        ).resolves.toMatchObject({
          terminalOutcome: "cancelled",
          requestDisposition,
          stableCode,
        });
      }
    }
  });

  it("projects the persisted campaign and guard identities only from a live ledger handle", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const claim = await buildPr6rOsAuthorityClaimFromLedger(authority);
    expect(claim).toMatchObject({
      implementationRevision: REVISION,
      claimedAt: "2026-09-02T00:00:00.000Z",
      ledgerCampaignRecordSha256: authority.recordSha256,
      ledgerGuardRecordSha256: authority.guardRecordSha256,
    });
    await expect(
      buildPr6rOsAuthorityClaimFromLedger({ ...authority }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
  });

  it("binds reacquired campaign handles to one exact execution authority", async () => {
    const root = await ledgerRoot();
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:01.000Z",
    });
    const executionAuthority = Object.freeze({ id: "canonical-ledger-a" });
    await expect(
      bindPr6rCampaignExecutionAuthority(first, {
        executionAuthority,
        implementationRevision: REVISION,
      }),
    ).resolves.toBeUndefined();
    await expect(
      bindPr6rCampaignExecutionAuthority(resumed, {
        executionAuthority,
        implementationRevision: REVISION,
      }),
    ).resolves.toBeUndefined();
    await expect(
      bindPr6rCampaignExecutionAuthority(resumed, {
        executionAuthority: Object.freeze({ id: "canonical-ledger-b" }),
        implementationRevision: REVISION,
      }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    await expect(
      bindPr6rCampaignExecutionAuthority(resumed, {
        executionAuthority,
        implementationRevision: "b".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("durably claims one campaign and each loopback slot at most once", async () => {
    const root = await ledgerRoot();
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    expect(first.status).toBe("claimed");
    const [rootState, guardState, campaignState] = await Promise.all([
      stat(root),
      stat(`${root}.pr6r-authority.guard.json`),
      stat(path.join(root, "campaign.json")),
    ]);
    expect(rootState.mode & 0o777).toBe(0o700);
    expect(guardState.mode & 0o777).toBe(0o600);
    expect(campaignState.mode & 0o777).toBe(0o600);
    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:01.000Z",
    });
    expect(resumed).toMatchObject({
      status: "resumed",
      claimedAt: "2026-09-02T00:00:00.000Z",
    });

    const [left, right] = await Promise.all([
      claimPr6rCloudSlot(first, slotBinding("cloud_synthesis"), {
        now: () => "2026-09-02T00:00:02.000Z",
      }),
      claimPr6rCloudSlot(resumed, slotBinding("cloud_synthesis"), {
        now: () => "2026-09-02T00:00:02.000Z",
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual([
      "already_consumed",
      "claimed",
    ]);
    const claimed =
      left.status === "claimed"
        ? left
        : right.status === "claimed"
          ? right
          : undefined;
    expect(claimed).toBeDefined();
    if (claimed === undefined) throw new Error("one slot claim must win");
    await terminalizePr6rCloudSlot(claimed, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
      now: () => "2026-09-02T00:00:03.000Z",
    });

    const snapshot = await inspectPr6rAuthorityLedger(root);
    expect(snapshot?.slots.cloud_synthesis).toMatchObject({
      claim: { slotId: "cloud_synthesis" },
      terminal: {
        requestDisposition: "sent",
        stableCode: "completed",
      },
    });
  });

  it("does not restore authority when unrelated app state is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(
      await claimPr6rCloudSlot(
        authority,
        slotBinding("cloud_synthesis"),
      ),
    ).toMatchObject({ status: "claimed" });

    const unrelated = await mkdtemp(path.join(tmpdir(), "soar-pr6r-app-state-"));
    roots.push(unrelated);
    await writeFile(path.join(unrelated, "app.sqlite"), "not the authority\n");
    await rm(unrelated, { recursive: true, force: true });
    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(
      await claimPr6rCloudSlot(
        resumed,
        slotBinding("cloud_synthesis"),
      ),
    ).toMatchObject({ status: "already_consumed" });
  });

  it("fails closed when the ledger directory is deleted but its durable guard remains", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(
      await claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis")),
    ).toMatchObject({ status: "claimed" });

    await rm(root, { recursive: true });
    expect(await readFile(`${root}.pr6r-authority.guard.json`, "utf8")).toContain(
      '"recordType":"authority_guard"',
    );
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: root,
      }),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("does not recreate a slot after one copy of its claim record is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const binding = slotBinding("cloud_synthesis");
    expect(await claimPr6rCloudSlot(authority, binding)).toMatchObject({
      status: "claimed",
    });
    await rm(path.join(root, "slot.cloud_synthesis.claimed.json"));
    expect(
      await readFile(
        recordGuardPath(root, "slot.cloud_synthesis.claimed.json"),
        "utf8",
      ),
    ).toContain('"recordType":"slot_claimed"');
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rCloudSlot(authority, binding),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("does not let a raw OS terminal create a campaign-wide fallback", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const slot = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (slot.status !== "claimed") throw new Error("slot must be claimed");
    const terminal = await terminalizePr6rCloudSlot(slot, {
      terminalOutcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
    });
    await expect(claimPr6rLocalFallback(terminal)).rejects.toMatchObject({
      code: "authority_handle_invalid",
    });
    await expect(stat(path.join(root, "fallback.claimed.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not rewrite a terminal after one copy of its record is deleted", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const binding = slotBinding("cloud_synthesis");
    const slot = await claimPr6rCloudSlot(authority, binding);
    if (slot.status !== "claimed") throw new Error("slot must be claimed");
    await terminalizePr6rCloudSlot(slot, {
      terminalOutcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
    });
    await rm(path.join(root, "slot.cloud_synthesis.terminal.json"));
    expect(
      await readFile(
        recordGuardPath(root, "slot.cloud_synthesis.terminal.json"),
        "utf8",
      ),
    ).toContain('"recordType":"slot_terminal"');
    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      recoverPr6rCloudSlot(authority, binding),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("requires reconciled Cloud evidence before Hybrid can be claimed", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    await expect(
      claimPr6rCloudSlot(
        authority,
        slotBinding("hybrid_cloud_if_selected"),
      ),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });

    const cloud = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
    await terminalizePr6rCloudSlot(cloud, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    await expect(
      claimPr6rCloudSlot(
        authority,
        slotBinding("hybrid_cloud_if_selected"),
      ),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
  });

  it("rejects contradictory terminal outcome, disposition, and code combinations", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimed");

    for (const terminal of [
      {
        terminalOutcome: "completed" as const,
        requestDisposition: "not_sent" as const,
        stableCode: "completed",
      },
      {
        terminalOutcome: "completed" as const,
        requestDisposition: "sent" as const,
        stableCode: "loopback.http_error",
      },
      {
        terminalOutcome: "failed" as const,
        requestDisposition: "not_sent" as const,
        stableCode: "loopback.http_error",
      },
      {
        terminalOutcome: "failed" as const,
        requestDisposition: "not_sent" as const,
        stableCode: "loopback.authority_invalid",
      },
    ]) {
      await expect(
        terminalizePr6rCloudSlot(claim, terminal),
      ).rejects.toMatchObject({ code: "authority_input_invalid" });
    }
    await expect(
      terminalizePr6rCloudSlot(claim, {
        terminalOutcome: "completed",
        requestDisposition: "sent",
        stableCode: "completed",
      }),
    ).resolves.toMatchObject({ stableCode: "completed" });
  });

  it("keeps raw failed terminals inert for fallback and the second slot", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const cloudClaim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (cloudClaim.status !== "claimed") throw new Error("slot must be claimed");
    const cloudFailure = await terminalizePr6rCloudSlot(cloudClaim, {
      terminalOutcome: "failed",
      requestDisposition: "sent",
      stableCode: "loopback.http_error",
    });
    await expect(claimPr6rLocalFallback(cloudFailure)).rejects.toMatchObject({
      code: "authority_handle_invalid",
    });
    await expect(
      claimPr6rCloudSlot(
        authority,
        slotBinding("hybrid_cloud_if_selected"),
      ),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    let appendCalls = 0;
    await expect(
      appendPr6rComparisonProjectionWithReconciledAuthority(
        cloudFailure as unknown as Pr6rCrossStoreReconciledTerminalAuthority,
        {
          replay() {
            return undefined;
          },
          appendComparisonProjection() {
            appendCalls += 1;
            return undefined;
          },
        },
        comparisonProjectionAppendInput({}),
      ),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    expect(appendCalls).toBe(0);
  });

  it("denies raw and forged authority at the canary append boundary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "soar-pr6r-canary-auth-"));
    roots.push(directory);
    const store = new Pr6rCanaryStore(path.join(directory, "canary.sqlite"));
    const rawInput = comparisonProjectionAppendInput({});
    try {
      expect(() =>
        store.appendComparisonProjection(
          rawInput as Parameters<
            typeof store.appendComparisonProjection
          >[0],
        ),
      ).toThrowError(expect.objectContaining({ code: "authority_handle_invalid" }));
      expect(() =>
        store.appendComparisonProjection({
          ...rawInput,
          authority: {
            kind: "pr6r_comparison_projection_use",
            scope: "terminal_transition",
            campaignId: PR6R_CAMPAIGN_ID,
            requestId: "forged-request",
            attemptId: "forged-attempt",
            reservationId: "forged-reservation",
          },
        }),
      ).toThrowError(expect.objectContaining({ code: "authority_handle_invalid" }));
    } finally {
      store.close();
    }
  });

  it("authorizes exactly one canonical all-pending baseline for a live empty campaign", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const request = applicationRequestForSlot("cloud_synthesis");
    const evidence = await deniedComparisonEvidenceFor(authority, request);
    const directory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-baseline-authority-"),
    );
    roots.push(directory);
    const store = new Pr6rCanaryStore(path.join(directory, "canary.sqlite"));
    const appendInput = {
      ...comparisonProjectionAppendInput(
        evidence.baseline,
        evidence.baselineProjection,
        1,
      ),
      createdAt: "2026-09-02T00:00:00.500Z",
    };
    try {
      store.createCampaign({
        recordId: "campaign-created",
        campaign: evidence.campaign,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      await expect(
        appendPr6rInitialComparisonProjectionWithCampaignAuthority(
          authority,
          store,
          appendInput,
        ),
      ).resolves.toMatchObject({
        comparison: { sequence: 2, recordType: "comparison" },
        safeProjection: { sequence: 3, recordType: "safe_projection" },
      });
      expect(
        store.replay()?.comparison?.synthesisDecisions.map(
          (decision) => decision.state,
        ),
      ).toEqual(["pending", "pending", "pending"]);
      await expect(
        appendPr6rInitialComparisonProjectionWithCampaignAuthority(
          authority,
          store,
          appendInput,
        ),
      ).rejects.toMatchObject({ code: "authority_slot_consumed" });
      expect(store.replay()?.records).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it("burns an invalid initial-baseline attempt without appending a partial pair", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const request = applicationRequestForSlot("cloud_synthesis");
    const evidence = await deniedComparisonEvidenceFor(authority, request);
    const directory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-invalid-baseline-"),
    );
    roots.push(directory);
    const store = new Pr6rCanaryStore(path.join(directory, "canary.sqlite"));
    const invalidProjection = structuredClone(evidence.baselineProjection);
    invalidProjection.commonInvestigation.durationMs += 1;
    const validInput = {
      ...comparisonProjectionAppendInput(
        evidence.baseline,
        evidence.baselineProjection,
        1,
      ),
      createdAt: "2026-09-02T00:00:00.500Z",
    };
    try {
      store.createCampaign({
        recordId: "campaign-created",
        campaign: evidence.campaign,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      await expect(
        appendPr6rInitialComparisonProjectionWithCampaignAuthority(
          authority,
          store,
          {
            ...validInput,
            safeProjection: invalidProjection,
          },
        ),
      ).rejects.toThrow(/projection/u);
      expect(store.replay()?.records).toHaveLength(1);
      await expect(
        appendPr6rInitialComparisonProjectionWithCampaignAuthority(
          authority,
          store,
          validInput,
        ),
      ).rejects.toMatchObject({ code: "authority_slot_consumed" });
      expect(store.replay()?.records).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rejects an initial baseline after any OS slot has been claimed", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const request = applicationRequestForSlot("cloud_synthesis");
    const binding = buildPr6rCloudSlotBinding({
      applicationRequest: request,
      reservationId: "reservation-c",
    });
    const evidence = await deniedComparisonEvidenceFor(
      authority,
      request,
    );
    const directory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-late-baseline-"),
    );
    roots.push(directory);
    const store = new Pr6rCanaryStore(path.join(directory, "canary.sqlite"));
    try {
      store.createCampaign({
        recordId: "campaign-created",
        campaign: evidence.campaign,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      await claimPr6rCloudSlot(authority, binding, {
        now: () => "2026-09-02T00:00:01.000Z",
      });
      await expect(
        appendPr6rInitialComparisonProjectionWithCampaignAuthority(
          authority,
          store,
          {
            ...comparisonProjectionAppendInput(
              evidence.baseline,
              evidence.baselineProjection,
              1,
            ),
            createdAt: "2026-09-02T00:00:01.000Z",
          },
        ),
      ).rejects.toMatchObject({ code: "authority_record_invalid" });
      expect(store.replay()?.records).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("unlocks fallback and the second slot only from exact cross-store reconciliation", async () => {
    const sqlite = createPr6rA2DeniedSqliteFixture();
    try {
      const root = await ledgerRoot();
      const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: root,
        now: () => "2026-09-02T00:00:00.000Z",
      });
      const binding = buildPr6rCloudSlotBinding({
        applicationRequest: sqlite.applicationRequest,
        reservationId: sqlite.reservationId,
      });
      const cloud = await claimPr6rCloudSlot(authority, binding, {
        now: () => "2026-09-02T00:00:01.000Z",
      });
      if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
      const arm = await preparePr6rCloudSlotDispatchArm(cloud);
      expect(arm).toMatchObject({ status: "armed", slotId: "cloud_synthesis" });

      const reconciled = await withAuthorityTestTime(
        () => "2026-09-02T00:00:02.000Z",
        () =>
          terminalizePr6rCloudSlotFromSqliteReceipt(cloud, {
            sqliteTerminalReceipt: sqlite.terminalReceipt,
            applicationRequest: sqlite.applicationRequest,
            reservationId: sqlite.reservationId,
          }),
      );
      expect(reconciled).toMatchObject({
        status: "cross_store_reconciled",
        terminalOutcome: "failed",
        requestDisposition: "not_sent",
        stableCode: "loopback.budget_denied",
      });
      await expect(
        claimPr6rLocalFallback(reconciled, {
          now: () => "2026-09-02T00:00:03.000Z",
        }),
      ).resolves.toMatchObject({ status: "claimed" });
      await expect(
        claimPr6rCloudSlot(
          authority,
          hybridBindingFromRequest(sqlite.applicationRequest),
          {
            now: () => "2026-09-02T00:00:03.000Z",
            priorTerminalAuthority: reconciled,
          },
        ),
      ).resolves.toMatchObject({ status: "claimed" });

      await expect(
        claimPr6rLocalFallback({ ...reconciled } as typeof reconciled),
      ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    } finally {
      sqlite.database.close();
    }
  });

  it("publishes budget denial at max(host now, SQLite terminal time)", async () => {
    const sqlite = createPr6rA2DeniedSqliteFixture();
    try {
      const root = await ledgerRoot();
      const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: root,
        now: () => "2026-09-02T00:00:04.000Z",
      });
      const cloud = await claimPr6rCloudSlot(
        authority,
        buildPr6rCloudSlotBinding({
          applicationRequest: sqlite.applicationRequest,
          reservationId: sqlite.reservationId,
        }),
        { now: () => "2026-09-02T00:00:05.000Z" },
      );
      if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
      await preparePr6rCloudSlotDispatchArm(cloud);

      const reconciled = await withAuthorityTestTime(
        () => "2026-09-02T00:00:06.000Z",
        () =>
          terminalizePr6rCloudSlotFromSqliteReceipt(cloud, {
            sqliteTerminalReceipt: sqlite.terminalReceipt,
            applicationRequest: sqlite.applicationRequest,
            reservationId: sqlite.reservationId,
          }),
      );
      expect(
        (await inspectPr6rAuthorityLedger(root))?.slots.cloud_synthesis
          ?.terminal?.terminalAt,
      ).toBe("2026-09-02T00:00:06.000Z");
      await expect(
        assertPr6rCrossStoreReconciledTerminalAuthority(reconciled),
      ).resolves.toBeUndefined();
    } finally {
      sqlite.database.close();
    }
  });

  it("binds comparison/projection use to one exact store, input, and prior replay", async () => {
    const sqlite = createPr6rA2DeniedSqliteFixture();
    try {
      const root = await ledgerRoot();
      const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: root,
        now: () => "2026-09-02T00:00:00.000Z",
      });
      const initial = await initialComparisonReplayFor(
        authority,
        sqlite.applicationRequest,
      );
      const cloud = await claimPr6rCloudSlot(
        authority,
        buildPr6rCloudSlotBinding({
          applicationRequest: sqlite.applicationRequest,
          reservationId: sqlite.reservationId,
        }),
        { now: () => "2026-09-02T00:00:01.000Z" },
      );
      if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");
      await preparePr6rCloudSlotDispatchArm(cloud);
      const reconciled = await withAuthorityTestTime(
        () => "2026-09-02T00:00:02.000Z",
        () =>
          terminalizePr6rCloudSlotFromSqliteReceipt(cloud, {
            sqliteTerminalReceipt: sqlite.terminalReceipt,
            applicationRequest: sqlite.applicationRequest,
            reservationId: sqlite.reservationId,
          }),
      );
      const terminalEvidence = await deniedComparisonEvidenceFor(
        authority,
        sqlite.applicationRequest,
        { root, authority: reconciled },
      );
      const comparison = terminalEvidence.terminal;
      const terminalProjection = terminalEvidence.terminalProjection;
      if (comparison === undefined || terminalProjection === undefined) {
        throw new Error("Denied terminal evidence must be available");
      }
      let appendCalls = 0;
      let consumedAppendInput:
        | (Pr6rComparisonProjectionAppendInput & {
            authority: Pr6rComparisonProjectionUseAuthority;
          })
        | undefined;
      let currentReplay: Pr6rCanaryReplay = initial.replay;
      const store = {
        replay() {
          return currentReplay;
        },
        appendComparisonProjection(
          input: Pr6rComparisonProjectionAppendInput & {
            authority: Pr6rComparisonProjectionUseAuthority;
          },
        ) {
          const priorReplay = store.replay();
          expect(Object.isFrozen(input)).toBe(true);
          expect(Object.isFrozen(input.comparison)).toBe(true);
          expect(
            Object.isFrozen(
              (input.comparison as Pr6rComparisonV1).synthesisDecisions,
            ),
          ).toBe(true);
          expect(Object.isFrozen(input.safeProjection)).toBe(true);
          consumePr6rComparisonProjectionUseAuthority(input.authority, {
            store,
            appendInput: input,
            priorReplay,
          });
          const nextComparison = Pr6rComparisonV1Schema.parse(input.comparison);
          const nextProjection = Pr6rSafeProjectionV1Schema.parse(
            input.safeProjection,
          );
          currentReplay = {
            campaign: priorReplay.campaign,
            comparison: nextComparison,
            safeProjection: nextProjection,
            records: [
              ...priorReplay.records,
              {
                id: input.comparisonRecordId,
                campaignId: PR6R_CAMPAIGN_ID,
                sequence: priorReplay.records.length + 1,
                recordType: "comparison",
                createdAt: input.createdAt,
                payload: nextComparison,
              },
              {
                id: input.safeProjectionRecordId,
                campaignId: PR6R_CAMPAIGN_ID,
                sequence: priorReplay.records.length + 2,
                recordType: "safe_projection",
                createdAt: input.createdAt,
                payload: nextProjection,
              },
            ],
          };
          consumedAppendInput = input;
          appendCalls += 1;
          return Object.freeze({ appended: true });
        },
      };
      await expect(
        appendPr6rComparisonProjectionWithReconciledAuthority(
          reconciled,
          store,
          comparisonProjectionAppendInput(
            comparison,
            terminalProjection,
            initial.replay.records.length,
          ),
        ),
      ).resolves.toEqual({ appended: true });
      expect(appendCalls).toBe(1);
      if (consumedAppendInput === undefined) {
        throw new Error("Authorized append input must be observed");
      }
      const exactConsumedAppendInput = consumedAppendInput as
        Pr6rComparisonProjectionAppendInput & {
          authority: Pr6rComparisonProjectionUseAuthority;
        };
      expect(() =>
        consumePr6rComparisonProjectionUseAuthority(
          exactConsumedAppendInput.authority,
          {
            store,
            appendInput: exactConsumedAppendInput,
            priorReplay: store.replay(),
          },
        ),
      ).toThrowError(
        expect.objectContaining({ code: "authority_handle_invalid" }),
      );
      expect(() =>
        consumePr6rComparisonProjectionUseAuthority(
          { ...exactConsumedAppendInput.authority },
          {
            store,
            appendInput: exactConsumedAppendInput,
            priorReplay: store.replay(),
          },
        ),
      ).toThrowError(
        expect.objectContaining({ code: "authority_handle_invalid" }),
      );
    } finally {
      sqlite.database.close();
    }
  });

  it("binds a reconciled terminal to its exact SQLite ledger", async () => {
    const scenario = await deniedTerminalScenario();
    const copied = createPr6rA2DeniedSqliteFixture();
    try {
      await expect(
        assertPr6rCrossStoreReconciledTerminalLedger(
          scenario.reconciled,
          scenario.sqlite.ledger,
        ),
      ).resolves.toBeUndefined();
      await expect(
        assertPr6rCrossStoreReconciledTerminalLedger(
          scenario.reconciled,
          copied.ledger,
        ),
      ).rejects.toMatchObject({ code: "authority_record_invalid" });
    } finally {
      scenario.sqlite.database.close();
      copied.database.close();
    }
  });

  it("burns an unconsumed comparison token before a callback can retain it", async () => {
    const scenario = await deniedTerminalScenario();
    try {
      let retained:
        | (Pr6rComparisonProjectionAppendInput & {
            authority: Pr6rComparisonProjectionUseAuthority;
          })
        | undefined;
      const store = {
        replay() {
          return scenario.initial.replay;
        },
        appendComparisonProjection(
          input: Pr6rComparisonProjectionAppendInput & {
            authority: Pr6rComparisonProjectionUseAuthority;
          },
        ) {
          retained = input;
          return Object.freeze({ pretended: true });
        },
      };
      await expect(
        appendPr6rComparisonProjectionWithReconciledAuthority(
          scenario.reconciled,
          store,
          comparisonProjectionAppendInput(
            scenario.comparison,
            scenario.projection,
            scenario.initial.replay.records.length,
          ),
        ),
      ).rejects.toMatchObject({ code: "authority_handle_invalid" });
      if (retained === undefined) {
        throw new Error("The adversarial callback must retain the append input");
      }
      const retainedInput = retained as Pr6rComparisonProjectionAppendInput & {
        authority: Pr6rComparisonProjectionUseAuthority;
      };
      expect(() =>
        consumePr6rComparisonProjectionUseAuthority(retainedInput.authority, {
          store,
          appendInput: retainedInput,
          priorReplay: store.replay(),
        }),
      ).toThrowError(
        expect.objectContaining({ code: "authority_handle_invalid" }),
      );
    } finally {
      scenario.sqlite.database.close();
    }
  });

  it("rejects unrelated Hybrid mutation and a changed prior replay", async () => {
    for (const attack of ["unrelated_decision", "changed_prior"] as const) {
      const scenario = await deniedTerminalScenario();
      try {
        const candidate = structuredClone(scenario.comparison);
        if (attack === "unrelated_decision") {
          candidate.synthesisDecisions[2] = {
            ...candidate.synthesisDecisions[2],
            state: "not_selected",
            terminalReason: "route.not_selected",
          } as (typeof candidate.synthesisDecisions)[2];
        }
        let appendCalls = 0;
        const store = {
          replay() {
            return scenario.initial.replay;
          },
          appendComparisonProjection(
            input: Pr6rComparisonProjectionAppendInput & {
              authority: Pr6rComparisonProjectionUseAuthority;
            },
          ) {
            appendCalls += 1;
            const priorReplay = store.replay();
            consumePr6rComparisonProjectionUseAuthority(input.authority, {
              store,
              appendInput: input,
              priorReplay:
                attack === "changed_prior"
                  ? {
                      ...priorReplay,
                      records: priorReplay.records.slice(0, -1),
                    }
                  : priorReplay,
            });
            return undefined;
          },
        };
        await expect(
          appendPr6rComparisonProjectionWithReconciledAuthority(
            scenario.reconciled,
            store,
            comparisonProjectionAppendInput(
              candidate,
              scenario.projection,
              scenario.initial.replay.records.length,
            ),
          ),
        ).rejects.toMatchObject({ code: "authority_record_invalid" });
        expect(appendCalls).toBe(attack === "changed_prior" ? 1 : 0);
      } finally {
        scenario.sqlite.database.close();
      }
    }
  });

  it("requires failed output validity for a schema-rejected response", async () => {
    const rejected = await schemaRejectedTerminalScenario();
    try {
      const mislabeled = Pr6rComparisonV1Schema.parse({
        ...rejected.comparison,
        synthesisDecisions: rejected.comparison.synthesisDecisions.map(
          (decision) =>
            decision.slotId === "cloud_synthesis"
              ? {
                  ...decision,
                  outputValidity: {
                    schemaVersion: "pr6r-output-validity-v1",
                    status: "not_available",
                    schemaAccepted: null,
                    citationSupport: null,
                    evidenceIntegrity: null,
                    snapshotFreshness: null,
                    coverageComplete: null,
                  },
                }
              : decision,
        ),
      });
      let appendCalls = 0;
      await expect(
        appendPr6rComparisonProjectionWithReconciledAuthority(
          rejected.reconciled,
          {
            replay() {
              return rejected.initial.replay;
            },
            appendComparisonProjection() {
              appendCalls += 1;
              return undefined;
            },
          },
          {
            ...comparisonProjectionAppendInput(
              mislabeled,
              safeProjectionFor(
                rejected.sqlite.applicationRequest,
                mislabeled,
              ),
              rejected.initial.replay.records.length,
            ),
            createdAt: "2026-09-02T00:00:04.000Z",
          },
        ),
      ).rejects.toMatchObject({ code: "authority_record_invalid" });
      expect(appendCalls).toBe(0);
    } finally {
      rejected.sqlite.database.close();
    }

    const accepted = await schemaRejectedTerminalScenario();
    try {
      let currentReplay: Pr6rCanaryReplay = accepted.initial.replay;
      let appendCalls = 0;
      const store = {
        replay() {
          return currentReplay;
        },
        appendComparisonProjection(
          input: Pr6rComparisonProjectionAppendInput & {
            authority: Pr6rComparisonProjectionUseAuthority;
          },
        ) {
          const priorReplay = store.replay();
          consumePr6rComparisonProjectionUseAuthority(input.authority, {
            store,
            appendInput: input,
            priorReplay,
          });
          const comparison = Pr6rComparisonV1Schema.parse(input.comparison);
          const safeProjection = Pr6rSafeProjectionV1Schema.parse(
            input.safeProjection,
          );
          currentReplay = {
            campaign: priorReplay.campaign,
            comparison,
            safeProjection,
            records: [
              ...priorReplay.records,
              {
                id: input.comparisonRecordId,
                campaignId: PR6R_CAMPAIGN_ID,
                sequence: priorReplay.records.length + 1,
                recordType: "comparison",
                createdAt: input.createdAt,
                payload: comparison,
              },
              {
                id: input.safeProjectionRecordId,
                campaignId: PR6R_CAMPAIGN_ID,
                sequence: priorReplay.records.length + 2,
                recordType: "safe_projection",
                createdAt: input.createdAt,
                payload: safeProjection,
              },
            ],
          };
          appendCalls += 1;
          return Object.freeze({ appended: true });
        },
      };
      await expect(
        appendPr6rComparisonProjectionWithReconciledAuthority(
          accepted.reconciled,
          store,
          {
            ...comparisonProjectionAppendInput(
              accepted.comparison,
              accepted.projection,
              accepted.initial.replay.records.length,
            ),
            createdAt: "2026-09-02T00:00:04.000Z",
          },
        ),
      ).resolves.toEqual({ appended: true });
      expect(appendCalls).toBe(1);
    } finally {
      accepted.sqlite.database.close();
    }
  });

  it("rejects far-future baseline and terminal record timestamps", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const request = applicationRequestForSlot("cloud_synthesis");
    const evidence = await deniedComparisonEvidenceFor(authority, request);
    const directory = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-future-baseline-"),
    );
    roots.push(directory);
    const baselineStore = new Pr6rCanaryStore(
      path.join(directory, "canary.sqlite"),
    );
    try {
      baselineStore.createCampaign({
        recordId: "campaign-created",
        campaign: evidence.campaign,
        createdAt: "2026-09-02T00:00:00.000Z",
      });
      await expect(
        appendPr6rInitialComparisonProjectionWithCampaignAuthority(
          authority,
          baselineStore,
          {
            ...comparisonProjectionAppendInput(
              evidence.baseline,
              evidence.baselineProjection,
              1,
            ),
            createdAt: "9999-12-31T23:59:59.999Z",
          },
        ),
      ).rejects.toMatchObject({ code: "authority_record_invalid" });
      expect(baselineStore.replay()?.records).toHaveLength(1);
    } finally {
      baselineStore.close();
    }

    const scenario = await deniedTerminalScenario();
    try {
      let appendCalls = 0;
      await expect(
        appendPr6rComparisonProjectionWithReconciledAuthority(
          scenario.reconciled,
          {
            replay() {
              return scenario.initial.replay;
            },
            appendComparisonProjection() {
              appendCalls += 1;
              return undefined;
            },
          },
          {
            ...comparisonProjectionAppendInput(
              scenario.comparison,
              scenario.projection,
              scenario.initial.replay.records.length,
            ),
            createdAt: "9999-12-31T23:59:59.999Z",
          },
        ),
      ).rejects.toMatchObject({ code: "authority_input_invalid" });
      expect(appendCalls).toBe(0);
    } finally {
      scenario.sqlite.database.close();
    }
  });

  it("invalidates comparison/projection use after SQLite mismatch or OS deletion", async () => {
    const cases = ["sqlite_mismatch", "os_deleted"] as const;
    for (const corruption of cases) {
      const sqlite = createPr6rA2DeniedSqliteFixture();
      try {
        const root = await ledgerRoot();
        const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
          implementationRevision: REVISION,
          ledgerRoot: root,
          now: () => "2026-09-02T00:00:00.000Z",
        });
        const initial = await initialComparisonReplayFor(
          authority,
          sqlite.applicationRequest,
        );
        const cloud = await claimPr6rCloudSlot(
          authority,
          buildPr6rCloudSlotBinding({
            applicationRequest: sqlite.applicationRequest,
            reservationId: sqlite.reservationId,
          }),
          { now: () => "2026-09-02T00:00:01.000Z" },
        );
        if (cloud.status !== "claimed") {
          throw new Error("Cloud slot must be claimed");
        }
        await preparePr6rCloudSlotDispatchArm(cloud);
        const reconciled = await withAuthorityTestTime(
          () => "2026-09-02T00:00:02.000Z",
          () =>
            terminalizePr6rCloudSlotFromSqliteReceipt(cloud, {
              sqliteTerminalReceipt: sqlite.terminalReceipt,
              applicationRequest: sqlite.applicationRequest,
              reservationId: sqlite.reservationId,
            }),
        );
        const terminalEvidence = await deniedComparisonEvidenceFor(
          authority,
          sqlite.applicationRequest,
          { root, authority: reconciled },
        );
        const comparison = terminalEvidence.terminal;
        const terminalProjection = terminalEvidence.terminalProjection;
        if (comparison === undefined || terminalProjection === undefined) {
          throw new Error("Denied terminal evidence must be available");
        }
        if (corruption === "sqlite_mismatch") {
          sqlite.database.exec("DROP TRIGGER session_events_no_update");
          sqlite.database
            .prepare(
              "UPDATE session_events SET payload_json = ? WHERE session_id = ? AND sequence = ?",
            )
            .run("{}", sqlite.applicationRequest.synthesisSessionId, 9);
        } else {
          await rm(path.join(root, "slot.cloud_synthesis.terminal.json"));
        }
        let appendCalls = 0;
        const store = {
          replay() {
            return initial.replay;
          },
          appendComparisonProjection() {
            appendCalls += 1;
            return undefined;
          },
        };
        await expect(
          appendPr6rComparisonProjectionWithReconciledAuthority(
            reconciled,
            store,
            comparisonProjectionAppendInput(
              comparison,
              terminalProjection,
              initial.replay.records.length,
            ),
          ),
        ).rejects.toMatchObject({ code: "authority_record_invalid" });
        expect(appendCalls).toBe(0);
      } finally {
        sqlite.database.close();
      }
    }
  });

  it("makes OS dispatch arming mutually exclusive with raw terminalization", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const cloud = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (cloud.status !== "claimed") throw new Error("Cloud slot must be claimed");

    const [first, second] = await Promise.allSettled([
      preparePr6rCloudSlotDispatchArm(cloud),
      preparePr6rCloudSlotDispatchArm(cloud),
    ]);
    expect([first.status, second.status].sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await expect(
      terminalizePr6rCloudSlot(cloud, {
        terminalOutcome: "completed",
        requestDisposition: "sent",
        stableCode: "completed",
      }),
    ).rejects.toMatchObject({ code: "authority_slot_consumed" });
  });

  it("rejects fallback without a genuine failed terminal", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimed");
    const completed = await terminalizePr6rCloudSlot(claim, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    await expect(claimPr6rLocalFallback(completed)).rejects.toMatchObject({
      code: "authority_handle_invalid",
    });
    await expect(
      claimPr6rLocalFallback({ ...completed }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
  });

  it("recovers a failed terminal for the one campaign-wide fallback", async () => {
    const root = await ledgerRoot();
    const binding = slotBinding("cloud_synthesis");
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(authority, binding);
    if (claim.status !== "claimed") throw new Error("slot must be claimed");
    await terminalizePr6rCloudSlot(claim, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });

    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const recoveredTerminal = await recoverPr6rFailedTerminalForFallback(
      resumed,
      binding,
    );
    await expect(
      claimPr6rLocalFallback(recoveredTerminal),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
  });

  it("fails closed when a terminal record is orphaned from its slot claim", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimable");
    await terminalizePr6rCloudSlot(claim, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });

    await rm(path.join(root, "slot.cloud_synthesis.claimed.json"));

    await expect(inspectPr6rAuthorityLedger(root)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis")),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("refuses to terminalize a deleted or replaced persisted claim", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const claim = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
    );
    if (claim.status !== "claimed") throw new Error("slot must be claimable");
    await rm(path.join(root, "slot.cloud_synthesis.claimed.json"));

    await expect(
      terminalizePr6rCloudSlot(claim, {
        terminalOutcome: "cancelled",
        requestDisposition: "not_sent",
        stableCode: "loopback.cancelled_before_dispatch",
      }),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("keeps the raw recovery terminalizer downstream-inert", async () => {
    const root = await ledgerRoot();
    const binding = slotBinding("cloud_synthesis");
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    expect(await claimPr6rCloudSlot(first, binding)).toMatchObject({
      status: "claimed",
      requestId: binding.requestId,
      reservationId: binding.reservationId,
    });

    const resumed = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    await expect(
      recoverPr6rCloudSlot(
        resumed,
        slotBinding("cloud_synthesis", {
          reservationId: "reservation-mismatch",
        }),
      ),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });

    const recovery = await recoverPr6rCloudSlot(resumed, binding);
    expect(recovery).toMatchObject({
      status: "recovery_only",
      requestId: binding.requestId,
      attemptId: binding.attemptId,
    });
    if (recovery.status !== "recovery_only") {
      throw new Error("slot must require recovery terminalization");
    }
    await expect(
      terminalizeRecoveredPr6rCloudSlot(recovery, {
        now: () => "2099-09-02T00:00:04.000Z",
      }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    expect(await recoverPr6rCloudSlot(resumed, binding)).toMatchObject({
      status: "recovery_only",
    });
  });

  it("rejects a terminal transplanted from a differently bound claim", async () => {
    const firstRoot = await ledgerRoot();
    const secondRoot = await ledgerRoot();
    const firstBinding = slotBinding("cloud_synthesis");
    const secondBinding = slotBinding("cloud_synthesis", {
      requestId: "request-second",
      synthesisSessionId: "session-second",
      attemptId: "attempt-second",
      reservationId: "reservation-second",
    });
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: firstRoot,
    });
    const second = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: secondRoot,
    });
    const firstClaim = await claimPr6rCloudSlot(first, firstBinding);
    const secondClaim = await claimPr6rCloudSlot(second, secondBinding);
    if (firstClaim.status !== "claimed" || secondClaim.status !== "claimed") {
      throw new Error("both isolated slots must be claimed");
    }
    await terminalizePr6rCloudSlot(firstClaim, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
    });
    await terminalizePr6rCloudSlot(secondClaim, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
    });

    const firstTerminal = await readFile(
      path.join(firstRoot, "slot.cloud_synthesis.terminal.json"),
    );
    await writeFile(
      path.join(secondRoot, "slot.cloud_synthesis.terminal.json"),
      firstTerminal,
      { mode: 0o600 },
    );
    await expect(inspectPr6rAuthorityLedger(secondRoot)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      recoverPr6rCloudSlot(second, secondBinding),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("rejects slot and terminal records transplanted from another campaign claim", async () => {
    const firstRoot = await ledgerRoot();
    const secondRoot = await ledgerRoot();
    const first = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: firstRoot,
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const second = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: secondRoot,
      now: () => "2026-09-02T00:00:00.500Z",
    });
    const cloud = await claimPr6rCloudSlot(
      first,
      slotBinding("cloud_synthesis"),
      { now: () => "2026-09-02T00:00:01.000Z" },
    );
    if (cloud.status !== "claimed") throw new Error("slot must be claimed");
    await terminalizePr6rCloudSlot(cloud, {
      terminalOutcome: "completed",
      requestDisposition: "sent",
      stableCode: "completed",
      now: () => "2026-09-02T00:00:02.000Z",
    });

    for (const fileName of [
      "slot.cloud_synthesis.claimed.json",
      "slot.cloud_synthesis.terminal.json",
    ]) {
      await writeFile(
        path.join(secondRoot, fileName),
        await readFile(path.join(firstRoot, fileName)),
        { mode: 0o600 },
      );
    }
    await expect(inspectPr6rAuthorityLedger(secondRoot)).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
    await expect(
      claimPr6rCloudSlot(
        second,
        slotBinding("hybrid_cloud_if_selected"),
        { now: () => "2026-09-02T00:00:03.000Z" },
      ),
    ).rejects.toMatchObject({ code: "authority_record_invalid" });
  });

  it("enforces campaign, slot, and terminal chronology", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
      now: () => "2026-09-02T10:00:00.000Z",
    });
    await expect(
      claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis"), {
        now: () => "2026-09-02T09:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });
    const cloud = await claimPr6rCloudSlot(
      authority,
      slotBinding("cloud_synthesis"),
      { now: () => "2026-09-02T11:00:00.000Z" },
    );
    if (cloud.status !== "claimed") throw new Error("slot must be claimed");
    await expect(
      terminalizePr6rCloudSlot(cloud, {
        terminalOutcome: "failed",
        requestDisposition: "unknown",
        stableCode: "loopback.dispatch_unknown",
        now: () => "2026-09-02T10:30:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });
    await terminalizePr6rCloudSlot(cloud, {
      terminalOutcome: "failed",
      requestDisposition: "unknown",
      stableCode: "loopback.dispatch_unknown",
      now: () => "2026-09-02T12:00:00.000Z",
    });
  });

  it("rejects forged handles, revision drift, symlinks, and corrupt records", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const forged = {
      ...authority,
    } as Pr6rCampaignAuthority;
    await expect(
      claimPr6rCloudSlot(forged, slotBinding("cloud_synthesis")),
    ).rejects.toMatchObject({
      code: "authority_handle_invalid",
    });
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: "b".repeat(40),
        ledgerRoot: root,
      }),
    ).rejects.toMatchObject({
      code: "authority_record_invalid",
    });

    const parent = await mkdtemp(path.join(tmpdir(), "soar-pr6r-symlink-"));
    roots.push(parent);
    const canonicalParent = await realpath(parent);
    const real = path.join(canonicalParent, "real");
    const linked = path.join(
      canonicalParent,
      process.platform === "darwin" ? "Library" : ".local",
    );
    await mkdir(real);
    await symlink(real, linked);
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: REVISION,
        ledgerRoot: productionLedgerRootForHome(canonicalParent),
      }),
    ).rejects.toMatchObject({
      code: "authority_path_unsafe",
    });

    await writeFile(path.join(root, "slot.cloud_synthesis.claimed.json"), "{}\n", {
      mode: 0o600,
    });
    await expect(
      claimPr6rCloudSlot(authority, slotBinding("cloud_synthesis")),
    ).rejects.toMatchObject({
      code: "authority_record_invalid",
    });
  });

  it("maps caller validation failures to stable input errors", async () => {
    const root = await ledgerRoot();
    await expect(
      pr6rAuthorityTestAccess.claimAtLedgerRoot({
        implementationRevision: "not-a-revision",
        ledgerRoot: root,
      }),
    ).rejects.toMatchObject({ code: "authority_input_invalid" });

    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const genuine = slotBinding("cloud_synthesis");
    await expect(
      claimPr6rCloudSlot(authority, { ...genuine }),
    ).rejects.toMatchObject({ code: "authority_handle_invalid" });
    expect(() =>
      buildPr6rCloudSlotBinding({
        applicationRequest: {},
        reservationId: "reservation-invalid",
      }),
    ).toThrow("authority_input_invalid");
  });

  it("rejects a parent-session synthesis binding before consuming slot authority", async () => {
    const root = await ledgerRoot();
    const authority = await pr6rAuthorityTestAccess.claimAtLedgerRoot({
      implementationRevision: REVISION,
      ledgerRoot: root,
    });
    const checkpoint = buildPr6rCommonCheckpointV1({
      parentSessionId: PARENT_SESSION_ID,
      packetUtf8: PACKET_UTF8,
      semanticMessages: applicationBody().messages,
    });
    const genuineRequest = sealCloudApplicationRequestV1({
      requestId: "request-parent-session-adversary",
      parentSessionId: PARENT_SESSION_ID,
      synthesisSessionId: "session-parent-session-adversary",
      attemptId: "attempt-parent-session-adversary",
      slotId: "cloud_synthesis",
      commonCheckpoint: checkpoint,
      packetUtf8: PACKET_UTF8,
      origin: "http://127.0.0.1:43123",
      body: applicationBody(),
    });

    expect(() =>
      buildPr6rCloudSlotBinding({
        applicationRequest: {
          ...genuineRequest,
          synthesisSessionId: PARENT_SESSION_ID,
        },
        reservationId: "reservation-parent-session-adversary",
      }),
    ).toThrow("authority_input_invalid");

    expect(
      await claimPr6rCloudSlot(
        authority,
        buildPr6rCloudSlotBinding({
          applicationRequest: genuineRequest,
          reservationId: "reservation-parent-session-adversary",
        }),
      ),
    ).toMatchObject({ status: "claimed" });
  });
});
