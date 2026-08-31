import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_ROUTER_POLICY_VERSION,
  PROVIDER_HEALTH_MAX_AGE_MS,
  PROVIDER_PRICING_MAX_AGE_MS,
  proposeCheckpointRouteV0,
  resolveCheckpointRouteV0,
  type CheckpointProviderV0,
  type CheckpointResolutionInputV0,
  type RouterRiskV0,
  type RouterStateViewV0,
} from "../../src/shared/checkpoint-router";
import type {
  AgenticExecutionPolicyV2,
  ProviderHealthSnapshotV0,
  ProviderPricingSnapshotV0,
} from "../../src/shared/session-events";
import {
  AgenticExecutionPolicyV2Schema,
  RoutingDecisionPayloadSchema,
} from "../../src/shared/session-events";
import {
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
} from "../../src/shared/hybrid-simulation-contracts";

const AS_OF = "2026-08-29T12:00:00.000Z";
const LOCAL_PROVIDER_ID = "local-primary";
const CLOUD_PROVIDER_ID = "cloud-primary";
const LOCAL_LEASE_ID = "lease-local-investigation";
const CLOUD_LEASE_ID = "lease-cloud-synthesis";

const policy: AgenticExecutionPolicyV2 = {
  schemaVersion: "agentic-execution-v2",
  inferenceRounds: 12,
  toolCalls: 24,
  routingPolicy: "hybrid_v0",
  maxProviderChanges: 2,
  maxPaidAttempts: 1,
  maxPaidEpisodeMicrousd: 250_000,
  maxEpisodeDurationMs: 600_000,
  attemptTimeoutMs: 60_000,
  egressConsent: "session_cloud_synthesis_v1",
};

const simulationPolicy: AgenticExecutionPolicyV2 = {
  ...policy,
  routingPolicy: "hybrid_simulation_v1",
  maxPaidEpisodeMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  egressConsent: "none",
  simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
};

const localProvider: CheckpointProviderV0 = {
  providerId: LOCAL_PROVIDER_ID,
  model: "local-model",
  locality: "local",
  enabled: true,
  capabilities: ["chat_completions", "streaming", "tool_calling"],
  accountingKind: "local_zero_cost",
  contextWindowTokens: 32_768,
  maxOutputTokens: 4_096,
  requestReserveTokens: 512,
};

const cloudProvider: CheckpointProviderV0 = {
  providerId: CLOUD_PROVIDER_ID,
  model: "cloud-model",
  locality: "cloud",
  enabled: true,
  capabilities: ["chat_completions", "streaming"],
  accountingKind: "metered",
  contextWindowTokens: 65_536,
  maxOutputTokens: 8_192,
  requestReserveTokens: 1_024,
};

function timestampAfter(milliseconds: number): string {
  return new Date(Date.parse(AS_OF) + milliseconds).toISOString();
}

function health(
  provider: CheckpointProviderV0,
  overrides: Partial<ProviderHealthSnapshotV0> = {},
): ProviderHealthSnapshotV0 {
  const checkedAt = timestampAfter(-30_000);
  return {
    snapshotId: `health-${provider.providerId}`,
    providerId: provider.providerId,
    model: provider.model,
    checkedAt,
    expiresAt: new Date(
      Date.parse(checkedAt) + PROVIDER_HEALTH_MAX_AGE_MS,
    ).toISOString(),
    status: "healthy",
    resultCode: "model_available",
    ...overrides,
  };
}

function pricing(
  overrides: Partial<ProviderPricingSnapshotV0> = {},
): ProviderPricingSnapshotV0 {
  const verifiedAt = timestampAfter(-3_600_000);
  return {
    snapshotId: "pricing-cloud-primary",
    providerId: CLOUD_PROVIDER_ID,
    model: cloudProvider.model,
    verifiedAt,
    expiresAt: new Date(
      Date.parse(verifiedAt) + PROVIDER_PRICING_MAX_AGE_MS,
    ).toISOString(),
    status: "available",
    inputMicrousdPerMillionTokens: 100_000,
    outputMicrousdPerMillionTokens: 200_000,
    cacheReadMicrousdPerMillionTokens: 10_000,
    pricingSourceSha256: "a".repeat(64),
    ...overrides,
  };
}

function pristineState(): RouterStateViewV0 {
  return {
    completedBoundaries: [],
    providerChangeCount: 0,
    paidAttemptCount: 0,
    hasStreamingAssistant: false,
    hasOpenAttempt: false,
    hasPendingToolCall: false,
    finishedAttemptCount: 0,
    successfulInvestigationAttemptCount: 0,
    evidenceReady: false,
  };
}

function evidenceState(): RouterStateViewV0 {
  return {
    activeLease: {
      leaseId: LOCAL_LEASE_ID,
      decisionId: "decision-session-start",
      providerId: LOCAL_PROVIDER_ID,
      model: localProvider.model,
      phase: "investigation",
    },
    completedBoundaries: ["session_start"],
    providerChangeCount: 0,
    paidAttemptCount: 0,
    hasStreamingAssistant: false,
    hasOpenAttempt: false,
    hasPendingToolCall: false,
    finishedAttemptCount: 1,
    successfulInvestigationAttemptCount: 1,
    evidenceReady: true,
  };
}

function providerFailureState(
  outcome: "provider_error" | "protocol_error" | "timeout" =
    "provider_error",
): RouterStateViewV0 {
  return {
    activeLease: {
      leaseId: CLOUD_LEASE_ID,
      decisionId: "decision-cloud",
      providerId: CLOUD_PROVIDER_ID,
      model: cloudProvider.model,
      phase: "synthesis",
    },
    completedBoundaries: ["session_start", "evidence_complete"],
    providerChangeCount: 1,
    paidAttemptCount: 1,
    hasStreamingAssistant: false,
    hasOpenAttempt: false,
    hasPendingToolCall: false,
    finishedAttemptCount: 2,
    successfulInvestigationAttemptCount: 1,
    evidenceReady: true,
    lastAttempt: {
      attemptId: "attempt-cloud",
      providerId: CLOUD_PROVIDER_ID,
      leaseId: CLOUD_LEASE_ID,
      decisionReasonCode: "cloud_admitted",
      outcome,
      requestDisposition: "sent",
      budgetReservationId: "reservation-cloud",
    },
  };
}

function completeRisk(classification: "low_risk" | "high_risk"): RouterRiskV0 {
  const high = classification === "high_risk";
  return {
    policyId: "review-risk-v1",
    snapshotId: "b".repeat(64),
    classification,
    score: high ? 4 : 0,
    signals: [
      {
        name: "changed_file_count",
        value: high ? 2 : 1,
        weight: 1,
        contribution: 0,
      },
      {
        name: "changed_line_count",
        value: high ? 200 : 1,
        weight: 1,
        contribution: 0,
      },
      {
        name: "changed_surface_count",
        value: high ? 2 : 1,
        weight: 2,
        contribution: 0,
      },
      {
        name: "runtime_without_relevant_test",
        value: high,
        weight: 2,
        contribution: high ? 2 : 0,
      },
      {
        name: "sensitive_subsystem",
        value: high,
        weight: 2,
        contribution: high ? 2 : 0,
      },
    ],
    triggerFacts: [
      { key: "risk_classification", value: classification },
      { key: "risk_snapshot_id", value: "b".repeat(64) },
    ],
  };
}

function incompleteRisk(): RouterRiskV0 {
  return {
    policyId: "review-risk-v1",
    snapshotId: "c".repeat(64),
    classification: "incomplete",
    signals: [],
    incompleteReason: `review-risk-v1-incomplete:1:${"d".repeat(64)}`,
    triggerFacts: [
      { key: "risk_classification", value: "incomplete" },
      { key: "risk_incomplete_count", value: 1 },
      { key: "risk_incomplete_sha256", value: "d".repeat(64) },
      { key: "risk_snapshot_id", value: "c".repeat(64) },
    ],
  };
}

function commonInput() {
  return {
    policy,
    asOf: AS_OF,
    deadlineAt: timestampAfter(300_000),
    // Deliberately reverse canonical order; the pure router normalizes it.
    providers: [localProvider, cloudProvider],
    localProviderId: LOCAL_PROVIDER_ID,
    cloudProviderId: CLOUD_PROVIDER_ID,
  };
}

function sessionStartInput(): CheckpointResolutionInputV0 {
  return {
    ...commonInput(),
    boundary: "session_start",
    state: pristineState(),
    decisionId: "decision-session-start",
    selectedLeaseId: LOCAL_LEASE_ID,
    targetHealthSnapshot: health(localProvider),
  };
}

function cloudAdmission() {
  return {
    credentialMetadataId: "credential-cloud",
    credentialAvailable: true,
    retainedLocalHealthSnapshot: health(localProvider),
    pricingSnapshot: pricing(),
    packet: {
      checkpointId: "checkpoint-cloud",
      packetSha256: "e".repeat(64),
      messagesSha256: "f".repeat(64),
      egressAllowed: true,
    },
    budget: {
      campaignId: "campaign-test",
      reservationId: "reservation-cloud",
      billableInputTokens: 1_000,
      billableCacheReadTokens: 0,
      requestedMaxOutputTokens: 1_000,
      providerFeeCeilingMicrousd: 0,
      remainingEpisodeMicrousd: 250_000,
      remainingCampaignMicrousd: 1_000_000,
    },
  };
}

function highRiskCloudInput(): Extract<
  CheckpointResolutionInputV0,
  { boundary: "evidence_complete" }
> {
  return {
    ...commonInput(),
    boundary: "evidence_complete",
    state: evidenceState(),
    risk: completeRisk("high_risk"),
    decisionId: "decision-cloud",
    selectedLeaseId: CLOUD_LEASE_ID,
    targetHealthSnapshot: health(cloudProvider),
    cloudAdmission: cloudAdmission(),
  };
}

function localEvidenceInput(
  risk: RouterRiskV0,
  policyOverride: AgenticExecutionPolicyV2 = policy,
): Extract<CheckpointResolutionInputV0, { boundary: "evidence_complete" }> {
  return {
    ...commonInput(),
    policy: policyOverride,
    boundary: "evidence_complete",
    state: evidenceState(),
    risk,
    decisionId: "decision-local-review",
    selectedLeaseId: LOCAL_LEASE_ID,
    targetHealthSnapshot: health(localProvider),
  };
}

function fallbackInput(
  remainingMs: number,
): Extract<CheckpointResolutionInputV0, { boundary: "provider_failure" }> {
  return {
    ...commonInput(),
    deadlineAt: timestampAfter(remainingMs),
    boundary: "provider_failure",
    state: providerFailureState(),
    decisionId: "decision-local-fallback",
    selectedLeaseId: "lease-local-fallback",
    targetHealthSnapshot: health(localProvider),
  };
}

function requireDecision(result: ReturnType<typeof resolveCheckpointRouteV0>) {
  expect(result.kind).toBe("decision");
  if (result.kind !== "decision") {
    throw new Error(`expected decision, received ${result.code}`);
  }
  return result;
}

describe("checkpoint-router-v0", () => {
  it("proposes and resolves local investigation from pristine session state", () => {
    const input = sessionStartInput();
    const proposal = proposeCheckpointRouteV0({
      ...commonInput(),
      boundary: "session_start",
      state: pristineState(),
    });

    expect(proposal).toMatchObject({
      schemaVersion: "checkpoint-route-proposal-v0",
      boundary: "session_start",
      phase: "investigation",
      intent: "local_investigation",
      action: "assign_new_lease",
      targetProviderId: LOCAL_PROVIDER_ID,
      allowTools: true,
      requireToolCall: true,
      candidateProviderIds: [CLOUD_PROVIDER_ID, LOCAL_PROVIDER_ID],
    });
    expect(Object.isFrozen(proposal)).toBe(true);

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision).toMatchObject({
      policyVersion: CHECKPOINT_ROUTER_POLICY_VERSION,
      reasonCode: "local_investigation",
      selectedLeaseId: LOCAL_LEASE_ID,
      admission: {
        capability: { status: "passed", reasonCode: "capability_ok" },
        health: { status: "passed", reasonCode: "health_ok" },
        deadline: { status: "passed", reasonCode: "deadline_ok" },
      },
    });
    expect(result.attempt).toMatchObject({
      providerId: LOCAL_PROVIDER_ID,
      phase: "investigation",
      allowTools: true,
      allowedToolNames: ["list_files", "read_text_file", "search_text"],
      requireToolCall: true,
    });
    expect(result.decision.routerInputSnapshot).toMatchObject({
      asOf: AS_OF,
      targetProviderId: LOCAL_PROVIDER_ID,
      requiredCapabilities: [
        "chat_completions",
        "streaming",
        "tool_calling",
      ],
      deadline: { requiredRemainingMs: 1, sufficient: true },
    });
    expect(Object.isFrozen(result.decision.routerInputSnapshot)).toBe(true);
    expect(
      Object.isFrozen(result.decision.routerInputSnapshot?.deadline),
    ).toBe(true);
    expect(
      Object.isFrozen(result.decision.routerInputSnapshot?.providers[0]),
    ).toBe(true);
    expect(Object.isFrozen(result.attempt.allowedToolNames)).toBe(true);
  });

  it("retains the local lease for low or incomplete risk and for local-only policy", () => {
    const localOnlyPolicy: AgenticExecutionPolicyV2 = {
      ...policy,
      routingPolicy: "local_only_v1",
      egressConsent: "none",
    };
    const cases = [
      [completeRisk("low_risk"), policy, "low_risk_local_review"],
      [incompleteRisk(), policy, "local_policy"],
      [completeRisk("high_risk"), localOnlyPolicy, "local_policy"],
    ] as const;

    for (const [risk, selectedPolicy, expectedReason] of cases) {
      const result = requireDecision(
        resolveCheckpointRouteV0(localEvidenceInput(risk, selectedPolicy)),
      );
      expect(result.decision).toMatchObject({
        action: "retain_lease",
        reasonCode: expectedReason,
        priorLeaseId: LOCAL_LEASE_ID,
        selectedLeaseId: LOCAL_LEASE_ID,
        selectedProviderId: LOCAL_PROVIDER_ID,
      });
      expect(result.attempt).toMatchObject({
        leaseId: LOCAL_LEASE_ID,
        phase: "synthesis",
        allowTools: false,
        requireToolCall: false,
      });
      expect(result.attempt.allowedToolNames).toBeUndefined();
    }
  });

  it("keeps low-risk simulation local without inventing an egress identity", () => {
    const result = requireDecision(
      resolveCheckpointRouteV0(
        localEvidenceInput(completeRisk("low_risk"), simulationPolicy),
      ),
    );

    expect(result.decision).toMatchObject({
      reasonCode: "low_risk_local_review",
      costScope: "simulation",
      selectedProviderId: LOCAL_PROVIDER_ID,
    });
    expect(result.decision.cloudEgressAdmissionId).toBeUndefined();
    expect(result.attempt).toMatchObject({
      providerId: LOCAL_PROVIDER_ID,
      costScope: "simulation",
    });
    expect(result.attempt.cloudEgressAdmissionId).toBeUndefined();
  });

  it("binds simulation cloud decisions and attempts to one persisted egress identity", () => {
    const input = highRiskCloudInput();
    input.policy = simulationPolicy;
    input.cloudAdmission!.packet.cloudEgressAdmissionId =
      "egress-simulation-cloud";

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision).toMatchObject({
      reasonCode: "cloud_admitted",
      costScope: "simulation",
      cloudEgressAdmissionId: "egress-simulation-cloud",
    });
    expect(result.attempt).toMatchObject({
      providerId: CLOUD_PROVIDER_ID,
      costScope: "simulation",
      cloudEgressAdmissionId: "egress-simulation-cloud",
    });

    const missingIdentity = structuredClone(input);
    delete missingIdentity.cloudAdmission!.packet.cloudEgressAdmissionId;
    expect(() => resolveCheckpointRouteV0(missingIdentity)).toThrow(
      /requires a persisted egress admission identity/u,
    );
  });

  it("evaluates simulation DLP before all later cloud admission facts", () => {
    const afterDlp = highRiskCloudInput();
    afterDlp.policy = simulationPolicy;
    afterDlp.cloudAdmission!.packet.cloudEgressAdmissionId =
      "egress-simulation-pass";
    afterDlp.cloudAdmission!.credentialAvailable = false;
    const missingCredential = requireDecision(
      resolveCheckpointRouteV0(afterDlp),
    );
    expect(missingCredential.decision).toMatchObject({
      reasonCode: "missing_credential",
      costScope: "simulation",
      cloudEgressAdmissionId: "egress-simulation-pass",
      admission: {
        egress: { status: "passed", reasonCode: "egress_ok" },
        credential: {
          status: "denied",
          reasonCode: "missing_credential",
        },
      },
    });
    expect(missingCredential.attempt).toMatchObject({
      providerId: LOCAL_PROVIDER_ID,
      cloudEgressAdmissionId: "egress-simulation-pass",
    });

    const deniedByDlp = structuredClone(afterDlp);
    deniedByDlp.cloudAdmission!.packet.cloudEgressAdmissionId =
      "egress-simulation-denied";
    deniedByDlp.cloudAdmission!.packet.egressAllowed = false;
    const egressDenial = requireDecision(
      resolveCheckpointRouteV0(deniedByDlp),
    );
    expect(egressDenial.decision).toMatchObject({
      reasonCode: "egress_denial",
      cloudEgressAdmissionId: "egress-simulation-denied",
      admission: {
        egress: { status: "denied", reasonCode: "egress_denial" },
        capability: {
          status: "not_applicable",
          reasonCode: "not_applicable",
        },
        credential: {
          status: "not_applicable",
          reasonCode: "not_applicable",
        },
      },
    });
  });

  it("does not let simulation consent authorize another routing policy", () => {
    expect(() =>
      AgenticExecutionPolicyV2Schema.parse({
        ...policy,
        simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
      }),
    ).toThrow(/reserved for hybrid_simulation_v1/u);
    expect(() =>
      AgenticExecutionPolicyV2Schema.parse({
        ...simulationPolicy,
        egressConsent: "session_cloud_synthesis_v1",
      }),
    ).toThrow(/real egress consent none/u);
  });

  it("admits one high-risk cloud synthesis with exact replay and billing facts", () => {
    const input = highRiskCloudInput();
    const proposal = proposeCheckpointRouteV0({
      ...commonInput(),
      boundary: "evidence_complete",
      state: evidenceState(),
      risk: completeRisk("high_risk"),
    });
    expect(proposal).toMatchObject({
      intent: "cloud_synthesis",
      action: "assign_new_lease",
      priorLeaseId: LOCAL_LEASE_ID,
      targetProviderId: CLOUD_PROVIDER_ID,
      requiredCapabilities: ["chat_completions", "streaming"],
      allowTools: false,
    });

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision).toMatchObject({
      reasonCode: "cloud_admitted",
      action: "assign_new_lease",
      selectedProviderId: CLOUD_PROVIDER_ID,
      selectedLeaseId: CLOUD_LEASE_ID,
      healthSnapshotId: "health-cloud-primary",
      pricingSnapshotId: "pricing-cloud-primary",
      budgetReservationId: "reservation-cloud",
      billing: {
        projectedCostMicrousd: 300,
        remainingEpisodeMicrousd: 250_000,
        remainingCampaignMicrousd: 1_000_000,
      },
    });
    expect(
      Object.values(result.decision.admission).every(
        (check) => check.status === "passed",
      ),
    ).toBe(true);
    expect(result.attempt).toMatchObject({
      providerId: CLOUD_PROVIDER_ID,
      leaseId: CLOUD_LEASE_ID,
      allowTools: false,
      requireToolCall: false,
      requestedMaxOutputTokens: 1_000,
      budgetReservationId: "reservation-cloud",
    });
    expect(result.attempt.allowedToolNames).toBeUndefined();
    expect(result.decision.routerInputSnapshot).toMatchObject({
      targetProviderId: CLOUD_PROVIDER_ID,
      targetModel: cloudProvider.model,
      deadline: { requiredRemainingMs: policy.attemptTimeoutMs },
      pricingSnapshot: {
        pricingSourceSha256: "a".repeat(64),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/endpoint|api[_-]?key|workspace/iu);
  });

  it("counts the provider request reserve exactly once at the context boundary", () => {
    const exact = highRiskCloudInput();
    exact.providers[1] = {
      ...cloudProvider,
      contextWindowTokens: 2_025,
      maxOutputTokens: 1_000,
      requestReserveTokens: 1_024,
    };
    exact.cloudAdmission!.budget.billableInputTokens = 1_025;
    expect(
      requireDecision(resolveCheckpointRouteV0(exact)).decision.reasonCode,
    ).toBe("cloud_admitted");

    const over = structuredClone(exact);
    over.cloudAdmission!.budget.billableInputTokens = 1_026;
    expect(() => resolveCheckpointRouteV0(over)).toThrow(
      /token allowances exceed the persisted provider limits/u,
    );
  });

  it.each([
    [
      "disabled_provider",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.providers[1] = { ...cloudProvider, enabled: false };
      },
    ],
    [
      "capability_mismatch",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.providers[1] = {
          ...cloudProvider,
          capabilities: ["chat_completions"],
        };
      },
    ],
    [
      "deadline_denial",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.deadlineAt = timestampAfter(policy.attemptTimeoutMs - 1);
      },
    ],
    [
      "missing_credential",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.cloudAdmission!.credentialAvailable = false;
      },
    ],
    [
      "unhealthy_provider",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.targetHealthSnapshot.status = "unhealthy";
        input.targetHealthSnapshot.resultCode = "model_unavailable";
      },
    ],
    [
      "pricing_denial",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.cloudAdmission!.pricingSnapshot.status = "unavailable";
      },
    ],
    [
      "egress_denial",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.cloudAdmission!.packet.egressAllowed = false;
      },
    ],
    [
      "budget_denial",
      (input: ReturnType<typeof highRiskCloudInput>) => {
        input.cloudAdmission!.budget.remainingEpisodeMicrousd = 299;
        input.cloudAdmission!.budget.budgetDenialReason = "episode_cap";
      },
    ],
  ] as const)("retains local synthesis on %s", (expectedReason, mutate) => {
    const input = structuredClone(highRiskCloudInput());
    mutate(input);
    const result = requireDecision(resolveCheckpointRouteV0(input));

    expect(result.decision).toMatchObject({
      reasonCode: expectedReason,
      action: "retain_lease",
      selectedProviderId: LOCAL_PROVIDER_ID,
      proposedProviderId: CLOUD_PROVIDER_ID,
      priorLeaseId: LOCAL_LEASE_ID,
      selectedLeaseId: LOCAL_LEASE_ID,
    });
    expect(result.attempt).toMatchObject({
      providerId: LOCAL_PROVIDER_ID,
      leaseId: LOCAL_LEASE_ID,
      allowTools: false,
    });
    if (expectedReason === "budget_denial") {
      expect(result.decision.triggerFacts).toContainEqual({
        key: "budget_denial_reason",
        value: "episode_cap",
      });
    }
  });

  it("uses fixed denial precedence and leaves later checks not applicable", () => {
    const input = structuredClone(highRiskCloudInput());
    input.providers[1] = { ...cloudProvider, enabled: false };
    input.deadlineAt = timestampAfter(1);
    input.cloudAdmission!.credentialAvailable = false;
    input.targetHealthSnapshot.status = "unhealthy";
    input.cloudAdmission!.pricingSnapshot.status = "unavailable";
    input.cloudAdmission!.packet.egressAllowed = false;
    input.cloudAdmission!.budget.remainingEpisodeMicrousd = 0;
    input.cloudAdmission!.budget.budgetDenialReason = "episode_cap";

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision.reasonCode).toBe("disabled_provider");
    expect(result.decision.admission).toEqual({
      capability: { status: "not_applicable", reasonCode: "not_applicable" },
      credential: { status: "not_applicable", reasonCode: "not_applicable" },
      health: { status: "not_applicable", reasonCode: "not_applicable" },
      pricing: { status: "not_applicable", reasonCode: "not_applicable" },
      egress: { status: "not_applicable", reasonCode: "not_applicable" },
      deadline: { status: "not_applicable", reasonCode: "not_applicable" },
      budget: { status: "not_applicable", reasonCode: "not_applicable" },
    });
  });

  it("denies cloud egress when the persisted policy has no session consent", () => {
    const input = highRiskCloudInput();
    input.policy = { ...policy, egressConsent: "none" };

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision).toMatchObject({
      reasonCode: "egress_denial",
      selectedProviderId: LOCAL_PROVIDER_ID,
      proposedProviderId: CLOUD_PROVIDER_ID,
      admission: {
        egress: { status: "denied", reasonCode: "egress_denial" },
      },
    });
  });

  it("requires the locked ledger reason exactly when budget is denied", () => {
    const missing = structuredClone(highRiskCloudInput());
    missing.cloudAdmission!.budget.remainingEpisodeMicrousd = 299;
    expect(() => resolveCheckpointRouteV0(missing)).toThrow(
      /exact locked ledger denial reason/u,
    );

    const spurious = structuredClone(highRiskCloudInput());
    spurious.cloudAdmission!.budget.budgetDenialReason = "episode_cap";
    expect(() => resolveCheckpointRouteV0(spurious)).toThrow(
      /cannot accompany an admitted locked budget position/u,
    );
  });

  it("treats a locked campaign overrun as a denial even when current balances cover the projection", () => {
    const input = highRiskCloudInput();
    input.cloudAdmission!.budget.budgetDenialReason = "campaign_overrun";

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision).toMatchObject({
      reasonCode: "budget_denial",
      selectedProviderId: LOCAL_PROVIDER_ID,
      proposedProviderId: CLOUD_PROVIDER_ID,
      triggerFacts: expect.arrayContaining([
        { key: "budget_denial_reason", value: "campaign_overrun" },
      ]),
    });
  });

  it("does not let stale retained-local health block an otherwise valid cloud admission", () => {
    const input = highRiskCloudInput();
    input.cloudAdmission!.retainedLocalHealthSnapshot = health(localProvider, {
      checkedAt: timestampAfter(-PROVIDER_HEALTH_MAX_AGE_MS),
      expiresAt: AS_OF,
      status: "unhealthy",
      resultCode: "model_unavailable",
    });

    expect(
      requireDecision(resolveCheckpointRouteV0(input)).decision.reasonCode,
    ).toBe("cloud_admitted");
  });

  it("rejects evidence_complete when investigation evidence is not actually ready", () => {
    const input = highRiskCloudInput();
    input.state.evidenceReady = false;

    expect(() => resolveCheckpointRouteV0(input)).toThrow(
      /finished local investigation lease/u,
    );
  });

  it("rejects replay snapshots that forge locality, target health, pricing, or rates", () => {
    const fallback = requireDecision(
      resolveCheckpointRouteV0(fallbackInput(policy.attemptTimeoutMs)),
    ).decision;
    const forgedLocality = structuredClone(fallback);
    const selectedLocal = forgedLocality.routerInputSnapshot?.providers.find(
      (provider) => provider.providerId === LOCAL_PROVIDER_ID,
    );
    if (selectedLocal === undefined) throw new Error("missing local snapshot");
    selectedLocal.locality = "cloud";
    selectedLocal.accountingKind = "metered";
    expect(() => RoutingDecisionPayloadSchema.parse(forgedLocality)).toThrow(
      /selected provider locality and accounting/u,
    );

    const admitted = requireDecision(
      resolveCheckpointRouteV0(highRiskCloudInput()),
    ).decision;
    const forgedHealth = structuredClone(admitted);
    forgedHealth.healthSnapshotId = "health-local-primary";
    expect(() => RoutingDecisionPayloadSchema.parse(forgedHealth)).toThrow(
      /health snapshot must match the persisted router target/u,
    );

    const forgedPricing = structuredClone(admitted);
    if (forgedPricing.routerInputSnapshot?.pricingSnapshot === undefined) {
      throw new Error("missing pricing snapshot");
    }
    forgedPricing.routerInputSnapshot.pricingSnapshot.providerId =
      LOCAL_PROVIDER_ID;
    forgedPricing.routerInputSnapshot.pricingSnapshot.model = localProvider.model;
    expect(() => RoutingDecisionPayloadSchema.parse(forgedPricing)).toThrow(
      /pricing snapshot must match the persisted router target/u,
    );

    const forgedRate = structuredClone(admitted);
    if (forgedRate.billing === undefined) throw new Error("missing billing");
    forgedRate.billing.inputMicrousdPerMillionTokens += 1;
    expect(() => RoutingDecisionPayloadSchema.parse(forgedRate)).toThrow(
      /billing component rates must match the persisted pricing snapshot/u,
    );

    const unsafeCacheRate = highRiskCloudInput();
    unsafeCacheRate.cloudAdmission!.pricingSnapshot.cacheReadMicrousdPerMillionTokens =
      unsafeCacheRate.cloudAdmission!.pricingSnapshot
        .inputMicrousdPerMillionTokens + 1;
    expect(() => resolveCheckpointRouteV0(unsafeCacheRate)).toThrow(
      /no_cache_credit/u,
    );
  });

  it("admits local fallback only with one full persisted attempt window remaining", () => {
    const exact = requireDecision(
      resolveCheckpointRouteV0(fallbackInput(policy.attemptTimeoutMs)),
    );
    expect(exact.decision).toMatchObject({
      boundary: "provider_failure",
      reasonCode: "local_fallback",
      action: "assign_new_lease",
      priorLeaseId: CLOUD_LEASE_ID,
      selectedLeaseId: "lease-local-fallback",
      selectedProviderId: LOCAL_PROVIDER_ID,
    });
    expect(exact.decision.routerInputSnapshot?.deadline).toMatchObject({
      remainingMs: policy.attemptTimeoutMs,
      requiredRemainingMs: policy.attemptTimeoutMs,
      sufficient: true,
    });

    expect(
      resolveCheckpointRouteV0(fallbackInput(policy.attemptTimeoutMs - 1)),
    ).toEqual({ kind: "terminal_denial", code: "deadline_exhausted" });
  });

  it("propagates simulation fallback provenance and rejects forged cross-scope state", () => {
    const input = fallbackInput(policy.attemptTimeoutMs);
    input.policy = simulationPolicy;
    input.state.lastAttempt = {
      ...input.state.lastAttempt!,
      costScope: "simulation",
      cloudEgressAdmissionId: "egress-simulation-fallback",
    };

    const result = requireDecision(resolveCheckpointRouteV0(input));
    expect(result.decision).toMatchObject({
      reasonCode: "local_fallback",
      costScope: "simulation",
      cloudEgressAdmissionId: "egress-simulation-fallback",
    });
    expect(result.attempt).toMatchObject({
      providerId: LOCAL_PROVIDER_ID,
      costScope: "simulation",
      cloudEgressAdmissionId: "egress-simulation-fallback",
    });

    const forgedScope = structuredClone(input);
    forgedScope.state.lastAttempt!.costScope = "actual";
    expect(() => resolveCheckpointRouteV0(forgedScope)).toThrow(
      /cost scope does not match the routing policy/u,
    );

    const missingIdentity = structuredClone(input);
    delete missingIdentity.state.lastAttempt!.cloudEgressAdmissionId;
    expect(() => resolveCheckpointRouteV0(missingIdentity)).toThrow(
      /requires its persisted egress admission identity/u,
    );
  });

  it.each(["cancelled", "interrupted", "succeeded"] as const)(
    "does not fall back after a %s cloud attempt",
    (outcome) => {
      const input = fallbackInput(policy.attemptTimeoutMs);
      input.state = {
        ...providerFailureState(),
        lastAttempt: { ...providerFailureState().lastAttempt!, outcome },
      };
      expect(() => resolveCheckpointRouteV0(input)).toThrow(
        /immediately preceding failed admitted-cloud attempt/u,
      );
    },
  );

  it("fails closed on unsafe boundary state, provider health, and capabilities", () => {
    const busy = sessionStartInput();
    busy.state.hasOpenAttempt = true;
    expect(() => resolveCheckpointRouteV0(busy)).toThrow(
      /session work is open/u,
    );

    const stale = sessionStartInput();
    stale.targetHealthSnapshot = health(localProvider, {
      checkedAt: timestampAfter(-PROVIDER_HEALTH_MAX_AGE_MS),
      expiresAt: AS_OF,
    });
    expect(resolveCheckpointRouteV0(stale)).toEqual({
      kind: "terminal_denial",
      code: "local_provider_unavailable",
    });

    const incapable = sessionStartInput();
    incapable.providers[0] = {
      ...localProvider,
      capabilities: ["chat_completions", "streaming"],
    };
    expect(resolveCheckpointRouteV0(incapable)).toEqual({
      kind: "terminal_denial",
      code: "local_provider_unavailable",
    });
  });

  it("is deterministic from explicit IDs, clocks, snapshots, and state", () => {
    const first = resolveCheckpointRouteV0(highRiskCloudInput());
    const second = resolveCheckpointRouteV0(
      structuredClone(highRiskCloudInput()),
    );
    expect(second).toEqual(first);
  });

  it("rejects forged PR 3 signal thresholds and incomplete digests", () => {
    const forgedSignal = completeRisk("high_risk");
    forgedSignal.signals[0] = {
      ...forgedSignal.signals[0]!,
      value: 8,
      contribution: 0,
    };
    expect(() =>
      resolveCheckpointRouteV0(localEvidenceInput(forgedSignal)),
    ).toThrow(/frozen review-risk-v1 mapping/u);

    const forgedIncomplete = incompleteRisk();
    forgedIncomplete.triggerFacts[2] = {
      key: "risk_incomplete_sha256",
      value: "e".repeat(64),
    };
    expect(() =>
      resolveCheckpointRouteV0(localEvidenceInput(forgedIncomplete)),
    ).toThrow(/canonical count, digest, and snapshot facts/u);
  });
});
