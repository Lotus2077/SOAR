import { z } from "zod";

import {
  AgenticExecutionPolicyV2Schema,
  ProviderHealthSnapshotV0Schema,
  ProviderPricingSnapshotV0Schema,
  RouterInputSnapshotV0Schema,
  RouterProviderInputSnapshotV0Schema,
  RoutingDecisionPayloadSchema,
  type AgenticExecutionPolicyV2,
  type ProviderHealthSnapshotV0,
  type ProviderPricingSnapshotV0,
  type RouterInputSnapshotV0,
  type RouterProviderInputSnapshotV0,
  type RoutingAdmission,
  type RoutingDecisionPayload,
} from "./session-events";

export const CHECKPOINT_ROUTER_POLICY_VERSION =
  "hybrid-lease-router-v0" as const;
export const PROVIDER_HEALTH_MAX_AGE_MS = 60_000 as const;
export const PROVIDER_PRICING_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export const CHECKPOINT_PROVIDER_CAPABILITIES = [
  "chat_completions",
  "reasoning_effort",
  "streaming",
  "structured_json_schema",
  "tool_calling",
] as const;

export const CheckpointProviderCapabilitySchema = z.enum(
  CHECKPOINT_PROVIDER_CAPABILITIES,
);
export type CheckpointProviderCapability = z.infer<
  typeof CheckpointProviderCapabilitySchema
>;

export const LOCAL_INVESTIGATION_CAPABILITIES = [
  "chat_completions",
  "streaming",
  "tool_calling",
] as const satisfies readonly CheckpointProviderCapability[];

export const SYNTHESIS_CAPABILITIES = [
  "chat_completions",
  "streaming",
] as const satisfies readonly CheckpointProviderCapability[];

/** PR 5 review synthesis is stricter than PR 4's fake-only generic synthesis. */
export const CHANGE_REVIEW_SYNTHESIS_CAPABILITIES = [
  "chat_completions",
  "streaming",
  "structured_json_schema",
] as const satisfies readonly CheckpointProviderCapability[];

const boundedId = z.string().trim().min(1).max(256);
const boundedCode = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const safePositiveInteger = z.number().int().positive().safe();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const ROUTER_RISK_SIGNAL_DEFINITIONS = [
  { name: "changed_file_count", weight: 1, triggerAt: 8, value: "number" },
  { name: "changed_line_count", weight: 1, triggerAt: 300, value: "number" },
  { name: "changed_surface_count", weight: 2, triggerAt: 3, value: "number" },
  {
    name: "runtime_without_relevant_test",
    weight: 2,
    triggerAt: true,
    value: "boolean",
  },
  {
    name: "sensitive_subsystem",
    weight: 2,
    triggerAt: true,
    value: "boolean",
  },
] as const;

const canonicalCapabilitiesSchema = z
  .array(CheckpointProviderCapabilitySchema)
  .min(1)
  .max(CHECKPOINT_PROVIDER_CAPABILITIES.length)
  .superRefine((capabilities, context) => {
    for (let index = 1; index < capabilities.length; index += 1) {
      const previous = capabilities[index - 1];
      const current = capabilities[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous >= current
      ) {
        context.addIssue({
          code: "custom",
          message: "capabilities must be sorted and unique",
          path: [index],
        });
      }
    }
  });

export const CheckpointProviderV0Schema = RouterProviderInputSnapshotV0Schema
  .safeExtend({
    capabilities: canonicalCapabilitiesSchema,
  })
  .strict();

export type CheckpointProviderV0 = z.infer<
  typeof CheckpointProviderV0Schema
>;

const activeLeaseSchema = z
  .object({
    leaseId: boundedId,
    decisionId: boundedId,
    providerId: boundedId,
    model: boundedId,
    phase: z.enum(["investigation", "synthesis"]),
  })
  .strict();

const completedBoundariesSchema = z
  .array(z.enum(["session_start", "evidence_complete", "provider_failure"]))
  .max(3)
  .superRefine((boundaries, context) => {
    if (new Set(boundaries).size !== boundaries.length) {
      context.addIssue({
        code: "custom",
        message: "completed routing boundaries must be unique",
      });
    }
  });

const lastAttemptSchema = z
  .object({
    attemptId: boundedId,
    providerId: boundedId,
    leaseId: boundedId,
    decisionReasonCode: boundedCode,
    outcome: z.enum([
      "succeeded",
      "provider_error",
      "protocol_error",
      "cancelled",
      "timeout",
      "interrupted",
    ]),
    requestDisposition: z.enum(["not_sent", "sent", "unknown"]),
    budgetReservationId: boundedId.optional(),
  })
  .strict();

export const RouterStateViewV0Schema = z
  .object({
    activeLease: activeLeaseSchema.optional(),
    completedBoundaries: completedBoundariesSchema,
    providerChangeCount: z.number().int().min(0).max(2).safe(),
    paidAttemptCount: z.number().int().min(0).max(1).safe(),
    hasStreamingAssistant: z.boolean(),
    hasOpenAttempt: z.boolean(),
    hasPendingToolCall: z.boolean(),
    finishedAttemptCount: safeNonNegativeInteger,
    successfulInvestigationAttemptCount: safeNonNegativeInteger,
    evidenceReady: z.boolean(),
    lastAttempt: lastAttemptSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.evidenceReady &&
      state.successfulInvestigationAttemptCount < 1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "evidence readiness requires a successful investigation attempt",
        path: ["successfulInvestigationAttemptCount"],
      });
    }
  });

export type RouterStateViewV0 = z.infer<typeof RouterStateViewV0Schema>;

const routerRiskSignalSchema = z
  .object({
    name: z.enum([
      "changed_file_count",
      "changed_line_count",
      "changed_surface_count",
      "runtime_without_relevant_test",
      "sensitive_subsystem",
    ]),
    value: z.union([z.boolean(), safeNonNegativeInteger]),
    weight: z.number().int().min(0).max(10).safe(),
    contribution: z.number().int().min(0).max(10).safe(),
  })
  .strict();

const routerRiskSignalsSchema = z
  .array(routerRiskSignalSchema)
  .max(5)
  .superRefine((signals, context) => {
    for (let index = 1; index < signals.length; index += 1) {
      const previous = signals[index - 1];
      const current = signals[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous.name >= current.name
      ) {
        context.addIssue({
          code: "custom",
          message: "risk signals must be sorted and unique",
          path: [index, "name"],
        });
      }
    }
  });

const triggerFactSchema = z
  .object({
    key: boundedCode,
    value: z.union([z.boolean(), z.number().finite().safe(), z.string().max(256)]),
  })
  .strict();

const triggerFactsSchema = z
  .array(triggerFactSchema)
  .max(16)
  .superRefine((facts, context) => {
    for (let index = 1; index < facts.length; index += 1) {
      const previous = facts[index - 1];
      const current = facts[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous.key >= current.key
      ) {
        context.addIssue({
          code: "custom",
          message: "risk trigger facts must be sorted and unique",
          path: [index, "key"],
        });
      }
    }
  });

export const RouterRiskV0Schema = z
  .object({
    policyId: z.literal("review-risk-v1"),
    snapshotId: sha256,
    classification: z.enum(["low_risk", "high_risk", "incomplete"]),
    score: safeNonNegativeInteger.optional(),
    signals: routerRiskSignalsSchema,
    incompleteReason: z.string().trim().min(1).max(512).optional(),
    triggerFacts: triggerFactsSchema,
  })
  .strict()
  .superRefine((risk, context) => {
    const incomplete = risk.classification === "incomplete";
    if (
      incomplete !== (risk.incompleteReason !== undefined) ||
      incomplete === (risk.score !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "incomplete risk requires only incompleteReason; scored risk requires only score",
      });
    }
    if (incomplete && risk.signals.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "incomplete risk cannot contain scored signals",
        path: ["signals"],
      });
    }
    if (incomplete) {
      const match = risk.incompleteReason?.match(
        /^review-risk-v1-incomplete:([1-9][0-9]*):([a-f0-9]{64})$/u,
      );
      const count = match === null || match === undefined ? undefined : Number(match[1]);
      const digest = match?.[2];
      const expectedFacts =
        count === undefined ||
        !Number.isSafeInteger(count) ||
        digest === undefined
          ? undefined
          : [
              { key: "risk_classification", value: "incomplete" },
              { key: "risk_incomplete_count", value: count },
              { key: "risk_incomplete_sha256", value: digest },
              { key: "risk_snapshot_id", value: risk.snapshotId },
            ];
      if (
        expectedFacts === undefined ||
        JSON.stringify(risk.triggerFacts) !== JSON.stringify(expectedFacts)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "incomplete risk requires its canonical count, digest, and snapshot facts",
          path: ["triggerFacts"],
        });
      }
    }
    if (!incomplete) {
      for (
        let index = 0;
        index < ROUTER_RISK_SIGNAL_DEFINITIONS.length;
        index += 1
      ) {
        const signal = risk.signals[index];
        const definition = ROUTER_RISK_SIGNAL_DEFINITIONS[index];
        if (signal === undefined || definition === undefined) continue;
        const valueTypeMatches = typeof signal.value === definition.value;
        const triggered =
          definition.value === "number"
            ? typeof signal.value === "number" &&
              signal.value >= definition.triggerAt
            : signal.value === definition.triggerAt;
        if (
          signal.name !== definition.name ||
          signal.weight !== definition.weight ||
          !valueTypeMatches ||
          signal.contribution !== (triggered ? definition.weight : 0)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "risk signal must match the frozen review-risk-v1 mapping and threshold",
            path: ["signals", index],
          });
        }
      }
      const contribution = risk.signals.reduce(
        (total, signal) => total + signal.contribution,
        0,
      );
      if (risk.signals.length !== 5 || contribution !== risk.score) {
        context.addIssue({
          code: "custom",
          message: "complete risk must contain five signals summing to score",
          path: ["signals"],
        });
      }
      if (
        risk.score !== undefined &&
        risk.classification !== (risk.score >= 3 ? "high_risk" : "low_risk")
      ) {
        context.addIssue({
          code: "custom",
          message: "risk classification must match review-risk-v1 threshold",
          path: ["classification"],
        });
      }
      const expectedFacts = [
        { key: "risk_classification", value: risk.classification },
        { key: "risk_snapshot_id", value: risk.snapshotId },
      ];
      if (JSON.stringify(risk.triggerFacts) !== JSON.stringify(expectedFacts)) {
        context.addIssue({
          code: "custom",
          message:
            "scored risk requires canonical classification and snapshot facts",
          path: ["triggerFacts"],
        });
      }
    }
  });

export type RouterRiskV0 = z.infer<typeof RouterRiskV0Schema>;

const commonProposalShape = {
  policy: AgenticExecutionPolicyV2Schema,
  asOf: z.string().datetime({ offset: true }),
  deadlineAt: z.string().datetime({ offset: true }),
  providers: z.array(CheckpointProviderV0Schema).min(1).max(32),
  localProviderId: boundedId,
  cloudProviderId: boundedId.optional(),
  structuredOutputContract: z
    .literal("change-review-result-v1")
    .optional(),
  state: RouterStateViewV0Schema,
} as const;

const sessionStartProposalSchema = z
  .object({
    ...commonProposalShape,
    boundary: z.literal("session_start"),
  })
  .strict();

const evidenceCompleteProposalSchema = z
  .object({
    ...commonProposalShape,
    boundary: z.literal("evidence_complete"),
    risk: RouterRiskV0Schema,
  })
  .strict();

const providerFailureProposalSchema = z
  .object({
    ...commonProposalShape,
    boundary: z.literal("provider_failure"),
  })
  .strict();

export const CheckpointProposalInputV0Schema = z.discriminatedUnion(
  "boundary",
  [
    sessionStartProposalSchema,
    evidenceCompleteProposalSchema,
    providerFailureProposalSchema,
  ],
);

export type CheckpointProposalInputV0 = z.infer<
  typeof CheckpointProposalInputV0Schema
>;

export const CheckpointProposalV0Schema = z
  .object({
    schemaVersion: z.literal("checkpoint-route-proposal-v0"),
    boundary: z.enum(["session_start", "evidence_complete", "provider_failure"]),
    phase: z.enum(["investigation", "synthesis"]),
    intent: z.enum([
      "local_investigation",
      "local_policy",
      "low_risk_local_review",
      "cloud_synthesis",
      "local_fallback",
    ]),
    action: z.enum(["assign_new_lease", "retain_lease"]),
    targetProviderId: boundedId,
    targetModel: boundedId,
    targetLocality: z.enum(["local", "cloud"]),
    candidateProviderIds: z.array(boundedId).min(1).max(32),
    priorLeaseId: boundedId.optional(),
    requiredCapabilities: canonicalCapabilitiesSchema,
    allowTools: z.boolean(),
    requireToolCall: z.boolean(),
  })
  .strict();

export type CheckpointProposalV0 = z.infer<
  typeof CheckpointProposalV0Schema
>;

const packetAdmissionSchema = z
  .object({
    checkpointId: boundedId,
    packetSha256: sha256,
    messagesSha256: sha256,
    egressAllowed: z.boolean(),
  })
  .strict();

const budgetAdmissionSchema = z
  .object({
    campaignId: boundedId,
    reservationId: boundedId,
    billableInputTokens: safeNonNegativeInteger,
    billableCacheReadTokens: safeNonNegativeInteger,
    requestedMaxOutputTokens: safePositiveInteger,
    providerFeeCeilingMicrousd: safeNonNegativeInteger,
    remainingEpisodeMicrousd: safeNonNegativeInteger,
    remainingCampaignMicrousd: safeNonNegativeInteger,
    budgetDenialReason: z
      .enum([
        "campaign_overrun",
        "episode_cap",
        "campaign_automatic_stop",
        "campaign_hard_ceiling",
      ])
      .optional(),
  })
  .strict();

export const CloudAdmissionInputV0Schema = z
  .object({
    credentialMetadataId: boundedId,
    credentialAvailable: z.boolean(),
    retainedLocalHealthSnapshot: ProviderHealthSnapshotV0Schema,
    pricingSnapshot: ProviderPricingSnapshotV0Schema,
    packet: packetAdmissionSchema,
    budget: budgetAdmissionSchema,
  })
  .strict();

export type CloudAdmissionInputV0 = z.infer<
  typeof CloudAdmissionInputV0Schema
>;

const resolutionShape = {
  decisionId: boundedId,
  selectedLeaseId: boundedId,
  targetHealthSnapshot: ProviderHealthSnapshotV0Schema,
  cloudAdmission: CloudAdmissionInputV0Schema.optional(),
} as const;

const sessionStartResolutionSchema = sessionStartProposalSchema.extend(
  resolutionShape,
);
const evidenceCompleteResolutionSchema = evidenceCompleteProposalSchema.extend(
  resolutionShape,
);
const providerFailureResolutionSchema = providerFailureProposalSchema.extend(
  resolutionShape,
);

export const CheckpointResolutionInputV0Schema = z.discriminatedUnion(
  "boundary",
  [
    sessionStartResolutionSchema,
    evidenceCompleteResolutionSchema,
    providerFailureResolutionSchema,
  ],
);

export type CheckpointResolutionInputV0 = z.infer<
  typeof CheckpointResolutionInputV0Schema
>;

export const AttemptPlanV0Schema = z
  .object({
    providerId: boundedId,
    model: boundedId,
    leaseId: boundedId,
    phase: z.enum(["investigation", "synthesis"]),
    requestedMaxOutputTokens: safePositiveInteger,
    allowTools: z.boolean(),
    allowedToolNames: z
      .array(
        z.enum([
          "inspect_git_changes",
          "list_files",
          "read_text_file",
          "search_text",
        ]),
      )
      .optional(),
    requireToolCall: z.boolean(),
    budgetReservationId: boundedId.optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.phase === "synthesis" && attempt.allowTools) {
      context.addIssue({
        code: "custom",
        message: "synthesis attempt plans must be tool-free",
        path: ["allowTools"],
      });
    }
    if (!attempt.allowTools && attempt.allowedToolNames !== undefined) {
      context.addIssue({
        code: "custom",
        message: "tool-free attempt plans cannot include tool names",
        path: ["allowedToolNames"],
      });
    }
  });

export type AttemptPlanV0 = z.infer<typeof AttemptPlanV0Schema>;

export const CheckpointRouterResultV0Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("decision"),
      decision: RoutingDecisionPayloadSchema,
      attempt: AttemptPlanV0Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("terminal_denial"),
      code: z.enum([
        "busy_boundary",
        "deadline_exhausted",
        "invalid_boundary_state",
        "local_provider_unavailable",
        "provider_change_limit",
      ]),
    })
    .strict(),
]);

export type CheckpointRouterResultV0 = z.infer<
  typeof CheckpointRouterResultV0Schema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeProviders(
  providers: readonly CheckpointProviderV0[],
): CheckpointProviderV0[] {
  const parsed = providers.map((provider) =>
    CheckpointProviderV0Schema.parse(provider),
  );
  if (new Set(parsed.map((provider) => provider.providerId)).size !== parsed.length) {
    throw new Error("checkpoint router provider IDs must be unique");
  }
  return parsed
    .map((provider) => ({
      ...provider,
      capabilities: [...provider.capabilities],
    }))
    .sort((left, right) => compareText(left.providerId, right.providerId));
}

function requireProvider(
  providers: readonly CheckpointProviderV0[],
  providerId: string,
  locality: "local" | "cloud",
): CheckpointProviderV0 {
  const provider = providers.find(
    (candidate) => candidate.providerId === providerId,
  );
  if (provider === undefined || provider.locality !== locality) {
    throw new Error(
      `checkpoint router requires configured ${locality} provider ${providerId}`,
    );
  }
  return provider;
}

function assertSafeBoundary(input: CheckpointProposalInputV0): void {
  if (
    input.state.hasStreamingAssistant ||
    input.state.hasOpenAttempt ||
    input.state.hasPendingToolCall
  ) {
    throw new Error("checkpoint router cannot run while session work is open");
  }
  if (input.state.completedBoundaries.includes(input.boundary)) {
    throw new Error(`checkpoint router boundary ${input.boundary} already ran`);
  }
}

function assertSessionStartState(input: CheckpointProposalInputV0): void {
  if (input.boundary !== "session_start") return;
  if (
    input.state.activeLease !== undefined ||
    input.state.completedBoundaries.length !== 0 ||
    input.state.finishedAttemptCount !== 0 ||
    input.state.successfulInvestigationAttemptCount !== 0 ||
    input.state.evidenceReady ||
    input.state.lastAttempt !== undefined ||
    input.state.providerChangeCount !== 0 ||
    input.state.paidAttemptCount !== 0
  ) {
    throw new Error("session_start requires pristine router state");
  }
}

function assertEvidenceCompleteState(
  input: CheckpointProposalInputV0,
  providers: readonly CheckpointProviderV0[],
): void {
  if (input.boundary !== "evidence_complete") return;
  const active = input.state.activeLease;
  if (
    active === undefined ||
    active.phase !== "investigation" ||
    input.state.finishedAttemptCount < 1 ||
    input.state.successfulInvestigationAttemptCount < 1 ||
    !input.state.evidenceReady ||
    !input.state.completedBoundaries.includes("session_start")
  ) {
    throw new Error(
      "evidence_complete requires a finished local investigation lease",
    );
  }
  const activeProvider = providers.find(
    (provider) => provider.providerId === active.providerId,
  );
  if (
    activeProvider?.locality !== "local" ||
    activeProvider.model !== active.model ||
    active.providerId !== input.localProviderId
  ) {
    throw new Error("evidence_complete active lease is not the configured local provider");
  }
}

const FALLBACK_OUTCOMES = [
  "provider_error",
  "protocol_error",
  "timeout",
] as const;

function assertProviderFailureState(
  input: CheckpointProposalInputV0,
  providers: readonly CheckpointProviderV0[],
): void {
  if (input.boundary !== "provider_failure") return;
  const active = input.state.activeLease;
  const attempt = input.state.lastAttempt;
  const activeProvider = active
    ? providers.find((provider) => provider.providerId === active.providerId)
    : undefined;
  if (
    active === undefined ||
    active.phase !== "synthesis" ||
    activeProvider?.locality !== "cloud" ||
    activeProvider.model !== active.model ||
    attempt === undefined ||
    attempt.providerId !== active.providerId ||
    attempt.leaseId !== active.leaseId ||
    attempt.decisionReasonCode !== "cloud_admitted" ||
    attempt.budgetReservationId === undefined ||
    !FALLBACK_OUTCOMES.some((outcome) => outcome === attempt.outcome) ||
    !input.state.completedBoundaries.includes("session_start") ||
    !input.state.completedBoundaries.includes("evidence_complete") ||
    input.state.paidAttemptCount !== 1
  ) {
    throw new Error(
      "provider_failure requires the immediately preceding failed admitted-cloud attempt",
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function freezeProposal(proposal: CheckpointProposalV0): CheckpointProposalV0 {
  return deepFreeze(proposal);
}

export function proposeCheckpointRouteV0(
  inputValue: CheckpointProposalInputV0,
): CheckpointProposalV0 {
  const input = CheckpointProposalInputV0Schema.parse(inputValue);
  const providers = normalizeProviders(input.providers);
  assertSafeBoundary(input);
  assertSessionStartState(input);
  assertEvidenceCompleteState(input, providers);
  assertProviderFailureState(input, providers);

  const local = requireProvider(providers, input.localProviderId, "local");
  const active = input.state.activeLease;
  let target = local;
  let phase: "investigation" | "synthesis" = "synthesis";
  let intent: CheckpointProposalV0["intent"] = "local_policy";
  let action: "assign_new_lease" | "retain_lease" = "retain_lease";
  let allowTools = false;
  let requireToolCall = false;
  let requiredCapabilities: readonly CheckpointProviderCapability[] =
    input.structuredOutputContract === "change-review-result-v1"
      ? CHANGE_REVIEW_SYNTHESIS_CAPABILITIES
      : SYNTHESIS_CAPABILITIES;

  if (input.boundary === "session_start") {
    phase = "investigation";
    intent = "local_investigation";
    action = "assign_new_lease";
    allowTools = true;
    requireToolCall = true;
    requiredCapabilities = LOCAL_INVESTIGATION_CAPABILITIES;
  } else if (input.boundary === "evidence_complete") {
    if (input.risk.classification === "low_risk") {
      intent = "low_risk_local_review";
    } else if (
      input.risk.classification === "high_risk" &&
      input.policy.routingPolicy === "hybrid_v0"
    ) {
      if (input.cloudProviderId === undefined) {
        throw new Error("hybrid high-risk routing requires a configured cloud provider");
      }
      target = requireProvider(providers, input.cloudProviderId, "cloud");
      intent = "cloud_synthesis";
      action = "assign_new_lease";
    }
  } else {
    intent = "local_fallback";
    action = "assign_new_lease";
  }

  const proposal = CheckpointProposalV0Schema.parse({
    schemaVersion: "checkpoint-route-proposal-v0",
    boundary: input.boundary,
    phase,
    intent,
    action,
    targetProviderId: target.providerId,
    targetModel: target.model,
    targetLocality: target.locality,
    candidateProviderIds: providers.map((provider) => provider.providerId),
    ...(active === undefined ? {} : { priorLeaseId: active.leaseId }),
    requiredCapabilities: [...requiredCapabilities],
    allowTools,
    requireToolCall,
  });
  return freezeProposal(proposal);
}

function hasCapabilities(
  provider: CheckpointProviderV0,
  required: readonly CheckpointProviderCapability[],
): boolean {
  const available = new Set(provider.capabilities);
  return required.every((capability) => available.has(capability));
}

function remainingMilliseconds(asOf: string, deadlineAt: string): number {
  const remaining = Math.max(0, Date.parse(deadlineAt) - Date.parse(asOf));
  if (!Number.isSafeInteger(remaining)) {
    throw new Error("checkpoint router deadline interval is not a safe integer");
  }
  return remaining;
}

function healthIsUsable(
  health: ProviderHealthSnapshotV0,
  provider: CheckpointProviderV0,
  asOf: string,
): boolean {
  const checkedAt = Date.parse(health.checkedAt);
  const expiresAt = Date.parse(health.expiresAt);
  const asOfMs = Date.parse(asOf);
  return (
    health.providerId === provider.providerId &&
    health.model === provider.model &&
    health.status === "healthy" &&
    checkedAt <= asOfMs &&
    asOfMs < expiresAt &&
    expiresAt - checkedAt === PROVIDER_HEALTH_MAX_AGE_MS
  );
}

function pricingIsUsable(
  pricing: ProviderPricingSnapshotV0,
  provider: CheckpointProviderV0,
  asOf: string,
): boolean {
  const verifiedAt = Date.parse(pricing.verifiedAt);
  const expiresAt = Date.parse(pricing.expiresAt);
  const asOfMs = Date.parse(asOf);
  return (
    pricing.providerId === provider.providerId &&
    pricing.model === provider.model &&
    pricing.status === "available" &&
    verifiedAt <= asOfMs &&
    asOfMs < expiresAt &&
    expiresAt - verifiedAt === PROVIDER_PRICING_MAX_AGE_MS
  );
}

const NOT_APPLICABLE = Object.freeze({
  status: "not_applicable" as const,
  reasonCode: "not_applicable" as const,
});

type AdmissionCheck = NonNullable<RoutingAdmission["pricing"]>;
type CompleteRoutingAdmission = Omit<RoutingAdmission, "pricing"> & {
  pricing: AdmissionCheck;
};

function passed(reasonCode: AdmissionCheck["reasonCode"]): AdmissionCheck {
  return { status: "passed" as const, reasonCode };
}

function denied(reasonCode: AdmissionCheck["reasonCode"]): AdmissionCheck {
  return { status: "denied" as const, reasonCode };
}

function initialAdmission(): CompleteRoutingAdmission {
  return {
    capability: NOT_APPLICABLE,
    credential: NOT_APPLICABLE,
    health: NOT_APPLICABLE,
    pricing: NOT_APPLICABLE,
    egress: NOT_APPLICABLE,
    deadline: NOT_APPLICABLE,
    budget: NOT_APPLICABLE,
  };
}

function canonicalFacts(
  input: CheckpointResolutionInputV0,
  proposal: CheckpointProposalV0,
): Array<{ key: string; value: boolean | number | string }> {
  const facts = new Map<string, boolean | number | string>([
    ["router_boundary", proposal.boundary],
    ["router_evidence_ready", input.state.evidenceReady],
    ["router_paid_attempt_count", input.state.paidAttemptCount],
    ["router_provider_change_count", input.state.providerChangeCount],
    [
      "router_successful_investigation_attempt_count",
      input.state.successfulInvestigationAttemptCount,
    ],
    ["router_target_locality", proposal.targetLocality],
  ]);
  if (input.boundary === "evidence_complete") {
    for (const fact of input.risk.triggerFacts) {
      if (facts.has(fact.key)) {
        throw new Error(`duplicate router trigger fact ${fact.key}`);
      }
      facts.set(fact.key, fact.value);
    }
  }
  if (input.boundary === "provider_failure" && input.state.lastAttempt) {
    facts.set("fallback_attempt_id", input.state.lastAttempt.attemptId);
    facts.set("fallback_outcome", input.state.lastAttempt.outcome);
  }
  return [...facts.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => compareText(left.key, right.key));
}

function riskFields(input: CheckpointResolutionInputV0) {
  if (input.boundary !== "evidence_complete") {
    return { riskSignals: [] };
  }
  return {
    riskPolicyId: input.risk.policyId,
    ...(input.risk.score === undefined ? {} : { riskScore: input.risk.score }),
    riskSignals: input.risk.signals.map((signal) => ({ ...signal })),
    ...(input.risk.incompleteReason === undefined
      ? {}
      : { riskIncompleteReason: input.risk.incompleteReason }),
  };
}

function buildRouterInputSnapshot(options: {
  input: CheckpointResolutionInputV0;
  proposal: CheckpointProposalV0;
  providers: readonly CheckpointProviderV0[];
  healthSnapshots: readonly ProviderHealthSnapshotV0[];
  pricingSnapshot?: ProviderPricingSnapshotV0;
  requiredRemainingMs: number;
}): RouterInputSnapshotV0 {
  const remainingMs = remainingMilliseconds(
    options.input.asOf,
    options.input.deadlineAt,
  );
  return RouterInputSnapshotV0Schema.parse({
    schemaVersion: "checkpoint-router-input-v0",
    boundary: options.input.boundary,
    asOf: options.input.asOf,
    providers: options.providers.map((provider) => ({
      ...provider,
      capabilities: [...provider.capabilities],
    })),
    targetProviderId: options.proposal.targetProviderId,
    targetModel: options.proposal.targetModel,
    requiredCapabilities: [...options.proposal.requiredCapabilities],
    deadline: {
      deadlineAt: options.input.deadlineAt,
      remainingMs,
      attemptTimeoutMs: options.input.policy.attemptTimeoutMs,
      requiredRemainingMs: options.requiredRemainingMs,
      sufficient: remainingMs >= options.requiredRemainingMs,
    },
    healthSnapshots: [...options.healthSnapshots]
      .map((health) => ({ ...health }))
      .sort((left, right) => compareText(left.providerId, right.providerId)),
    ...(options.pricingSnapshot === undefined
      ? {}
      : { pricingSnapshot: { ...options.pricingSnapshot } }),
  });
}

function ceilComponent(tokens: number, rate: number): bigint {
  const million = 1_000_000n;
  const product = BigInt(tokens) * BigInt(rate);
  return (product + million - 1n) / million;
}

function billingProjection(
  input: CheckpointResolutionInputV0,
  pricing: ProviderPricingSnapshotV0,
  admission: CloudAdmissionInputV0,
) {
  const budget = admission.budget;
  const projected =
    ceilComponent(
      budget.billableInputTokens,
      pricing.inputMicrousdPerMillionTokens,
    ) +
    ceilComponent(
      budget.requestedMaxOutputTokens,
      pricing.outputMicrousdPerMillionTokens,
    ) +
    ceilComponent(
      budget.billableCacheReadTokens,
      pricing.cacheReadMicrousdPerMillionTokens,
    ) +
    BigInt(budget.providerFeeCeilingMicrousd);
  if (projected > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("checkpoint router projected cost exceeds safe integer range");
  }
  const remainingEpisodeMicrousd =
    input.state.paidAttemptCount >= input.policy.maxPaidAttempts
      ? 0
      : Math.min(
          budget.remainingEpisodeMicrousd,
          input.policy.maxPaidEpisodeMicrousd,
        );
  return {
    billableInputTokens: budget.billableInputTokens,
    billableCacheReadTokens: budget.billableCacheReadTokens,
    requestedMaxOutputTokens: budget.requestedMaxOutputTokens,
    inputMicrousdPerMillionTokens:
      pricing.inputMicrousdPerMillionTokens,
    outputMicrousdPerMillionTokens:
      pricing.outputMicrousdPerMillionTokens,
    cacheReadMicrousdPerMillionTokens:
      pricing.cacheReadMicrousdPerMillionTokens,
    providerFeeCeilingMicrousd: budget.providerFeeCeilingMicrousd,
    roundingPolicy: "ceil_each_component_v1" as const,
    projectedCostMicrousd: Number(projected),
    remainingEpisodeMicrousd,
    remainingCampaignMicrousd: budget.remainingCampaignMicrousd,
  };
}

function proposalInputFromResolution(
  input: CheckpointResolutionInputV0,
): CheckpointProposalInputV0 {
  const common = {
    policy: input.policy,
    asOf: input.asOf,
    deadlineAt: input.deadlineAt,
    providers: input.providers,
    localProviderId: input.localProviderId,
    ...(input.cloudProviderId === undefined
      ? {}
      : { cloudProviderId: input.cloudProviderId }),
    state: input.state,
    ...(input.structuredOutputContract === undefined
      ? {}
      : { structuredOutputContract: input.structuredOutputContract }),
  };
  return input.boundary === "evidence_complete"
    ? { ...common, boundary: input.boundary, risk: input.risk }
    : { ...common, boundary: input.boundary };
}

function terminal(
  code: Extract<CheckpointRouterResultV0, { kind: "terminal_denial" }>["code"],
): CheckpointRouterResultV0 {
  return CheckpointRouterResultV0Schema.parse({
    kind: "terminal_denial",
    code,
  });
}

function freezeResult(
  result: Extract<CheckpointRouterResultV0, { kind: "decision" }>,
): CheckpointRouterResultV0 {
  return deepFreeze(result);
}

function decisionResult(
  decisionInput: RoutingDecisionPayload,
  attemptInput: AttemptPlanV0,
): CheckpointRouterResultV0 {
  const result = CheckpointRouterResultV0Schema.parse({
    kind: "decision",
    decision: decisionInput,
    attempt: attemptInput,
  });
  if (result.kind !== "decision") {
    throw new Error("checkpoint router produced an invalid decision result");
  }
  return freezeResult(result);
}

function localReason(proposal: CheckpointProposalV0) {
  switch (proposal.intent) {
    case "local_investigation":
      return "local_investigation" as const;
    case "low_risk_local_review":
      return "low_risk_local_review" as const;
    case "local_fallback":
      return "local_fallback" as const;
    case "local_policy":
      return "local_policy" as const;
    case "cloud_synthesis":
      throw new Error("cloud proposal does not have a local decision reason");
  }
}

function localDecision(options: {
  input: CheckpointResolutionInputV0;
  proposal: CheckpointProposalV0;
  providers: readonly CheckpointProviderV0[];
  target: CheckpointProviderV0;
  requiredRemainingMs: number;
}): CheckpointRouterResultV0 {
  const { input, proposal, providers, target, requiredRemainingMs } = options;
  const health = ProviderHealthSnapshotV0Schema.parse(
    input.targetHealthSnapshot,
  );
  const remainingMs = remainingMilliseconds(input.asOf, input.deadlineAt);
  if (remainingMs < requiredRemainingMs) {
    return terminal("deadline_exhausted");
  }
  if (
    !target.enabled ||
    !hasCapabilities(target, proposal.requiredCapabilities) ||
    !healthIsUsable(health, target, input.asOf)
  ) {
    return terminal("local_provider_unavailable");
  }
  if (
    proposal.action === "retain_lease" &&
    input.selectedLeaseId !== proposal.priorLeaseId
  ) {
    throw new Error("retained checkpoint decision must reuse its active lease");
  }
  if (
    proposal.action === "assign_new_lease" &&
    input.selectedLeaseId === proposal.priorLeaseId
  ) {
    throw new Error("new checkpoint decision cannot reuse its prior lease");
  }
  if (
    proposal.boundary !== "session_start" &&
    proposal.action === "assign_new_lease" &&
    input.state.providerChangeCount + 1 > input.policy.maxProviderChanges
  ) {
    return terminal("provider_change_limit");
  }

  const routerInputSnapshot = buildRouterInputSnapshot({
    input,
    proposal,
    providers,
    healthSnapshots: [health],
    requiredRemainingMs,
  });
  const admission = initialAdmission();
  admission.capability = passed("capability_ok");
  admission.health = passed("health_ok");
  admission.deadline = passed("deadline_ok");
  const decision = RoutingDecisionPayloadSchema.parse({
    decisionId: input.decisionId,
    policyVersion: CHECKPOINT_ROUTER_POLICY_VERSION,
    boundary: proposal.boundary,
    phase: proposal.phase,
    action: proposal.action,
    reasonCode: localReason(proposal),
    candidateProviderIds: proposal.candidateProviderIds,
    selectedProviderId: target.providerId,
    selectedModel: target.model,
    ...(proposal.priorLeaseId === undefined
      ? {}
      : { priorLeaseId: proposal.priorLeaseId }),
    selectedLeaseId: input.selectedLeaseId,
    ...riskFields(input),
    triggerFacts: canonicalFacts(input, proposal),
    admission,
    routerInputSnapshot,
    healthSnapshotId: health.snapshotId,
  });
  const attempt = AttemptPlanV0Schema.parse({
    providerId: target.providerId,
    model: target.model,
    leaseId: input.selectedLeaseId,
    phase: proposal.phase,
    requestedMaxOutputTokens: target.maxOutputTokens,
    allowTools: proposal.allowTools,
    ...(proposal.allowTools
      ? {
          allowedToolNames: [
            "list_files",
            "read_text_file",
            "search_text",
          ],
        }
      : {}),
    requireToolCall: proposal.requireToolCall,
  });
  return decisionResult(decision, attempt);
}

type CloudDenialReason =
  | "disabled_provider"
  | "capability_mismatch"
  | "deadline_denial"
  | "missing_credential"
  | "unhealthy_provider"
  | "pricing_denial"
  | "egress_denial"
  | "budget_denial";

function cloudDecision(options: {
  input: CheckpointResolutionInputV0 & { boundary: "evidence_complete" };
  proposal: CheckpointProposalV0;
  providers: readonly CheckpointProviderV0[];
  cloud: CheckpointProviderV0;
  local: CheckpointProviderV0;
  admissionInput: CloudAdmissionInputV0;
}): CheckpointRouterResultV0 {
  const { input, proposal, providers, cloud, local } = options;
  const admissionInput = CloudAdmissionInputV0Schema.parse(
    options.admissionInput,
  );
  const cloudHealth = ProviderHealthSnapshotV0Schema.parse(
    input.targetHealthSnapshot,
  );
  const localHealth = ProviderHealthSnapshotV0Schema.parse(
    admissionInput.retainedLocalHealthSnapshot,
  );
  const pricing = ProviderPricingSnapshotV0Schema.parse(
    admissionInput.pricingSnapshot,
  );
  const remainingMs = remainingMilliseconds(input.asOf, input.deadlineAt);

  const requiredRemainingMs = input.policy.attemptTimeoutMs;
  const routerInputSnapshot = buildRouterInputSnapshot({
    input,
    proposal,
    providers,
    healthSnapshots: [cloudHealth, localHealth],
    pricingSnapshot: pricing,
    requiredRemainingMs,
  });
  const admission = initialAdmission();
  let denialReason: CloudDenialReason | undefined;

  if (!cloud.enabled) {
    denialReason = "disabled_provider";
  } else if (!hasCapabilities(cloud, proposal.requiredCapabilities)) {
    admission.capability = denied("capability_mismatch");
    denialReason = "capability_mismatch";
  } else {
    admission.capability = passed("capability_ok");
    if (remainingMs < requiredRemainingMs) {
      admission.deadline = denied("deadline_denial");
      denialReason = "deadline_denial";
    } else {
      admission.deadline = passed("deadline_ok");
      if (!admissionInput.credentialAvailable) {
        admission.credential = denied("missing_credential");
        denialReason = "missing_credential";
      } else {
        admission.credential = passed("credential_ok");
        if (!healthIsUsable(cloudHealth, cloud, input.asOf)) {
          admission.health = denied("unhealthy_provider");
          denialReason = "unhealthy_provider";
        } else {
          admission.health = passed("health_ok");
          if (!pricingIsUsable(pricing, cloud, input.asOf)) {
            admission.pricing = denied("pricing_denial");
            denialReason = "pricing_denial";
          } else {
            admission.pricing = passed("pricing_ok");
            if (
              input.policy.egressConsent !==
                "session_cloud_synthesis_v1" ||
              !admissionInput.packet.egressAllowed
            ) {
              admission.egress = denied("egress_denial");
              denialReason = "egress_denial";
            } else {
              admission.egress = passed("egress_ok");
            }
          }
        }
      }
    }
  }

  let billing: ReturnType<typeof billingProjection> | undefined;
  if (denialReason === undefined) {
    if (
      admissionInput.budget.requestedMaxOutputTokens > cloud.maxOutputTokens ||
      admissionInput.budget.billableInputTokens +
          admissionInput.budget.requestedMaxOutputTokens >
        cloud.contextWindowTokens
    ) {
      throw new Error(
        "cloud packet token allowances exceed the persisted provider limits",
      );
    }
    billing = billingProjection(input, pricing, admissionInput);
    const exceedsPersistedBudget =
      billing.projectedCostMicrousd > billing.remainingEpisodeMicrousd ||
      billing.projectedCostMicrousd > billing.remainingCampaignMicrousd;
    const lockedDenialReason = admissionInput.budget.budgetDenialReason;
    const campaignDisabled = lockedDenialReason === "campaign_overrun";
    if (exceedsPersistedBudget || campaignDisabled) {
      if (admissionInput.budget.budgetDenialReason === undefined) {
        throw new Error(
          "budget denial requires the exact locked ledger denial reason",
        );
      }
      admission.budget = denied("budget_denial");
      denialReason = "budget_denial";
    } else {
      if (lockedDenialReason !== undefined) {
        throw new Error(
          "budget denial reason cannot accompany an admitted locked budget position",
        );
      }
      admission.budget = passed("budget_ok");
    }
  }

  const reachedCredential = admission.credential.status !== "not_applicable";
  const reachedHealth = admission.health.status !== "not_applicable";
  const reachedPricing = admission.pricing.status !== "not_applicable";
  const reachedEgress = admission.egress.status !== "not_applicable";

  if (denialReason !== undefined) {
    const localCanRetain =
      remainingMs >= 1 &&
      local.enabled &&
      hasCapabilities(local, proposal.requiredCapabilities) &&
      healthIsUsable(localHealth, local, input.asOf);
    if (!localCanRetain) {
      return terminal(
        remainingMs < 1 ? "deadline_exhausted" : "local_provider_unavailable",
      );
    }
    const triggerFacts = canonicalFacts(input, proposal);
    if (denialReason === "budget_denial") {
      triggerFacts.push({
        key: "budget_denial_reason",
        value: admissionInput.budget.budgetDenialReason!,
      });
      triggerFacts.sort((left, right) => compareText(left.key, right.key));
    }
    const decision = RoutingDecisionPayloadSchema.parse({
      decisionId: input.decisionId,
      policyVersion: CHECKPOINT_ROUTER_POLICY_VERSION,
      boundary: proposal.boundary,
      phase: proposal.phase,
      action: "retain_lease",
      reasonCode: denialReason,
      candidateProviderIds: proposal.candidateProviderIds,
      selectedProviderId: local.providerId,
      selectedModel: local.model,
      proposedProviderId: cloud.providerId,
      proposedModel: cloud.model,
      priorLeaseId: proposal.priorLeaseId,
      selectedLeaseId: proposal.priorLeaseId,
      ...riskFields(input),
      triggerFacts,
      admission,
      routerInputSnapshot,
      ...(reachedHealth ? { healthSnapshotId: cloudHealth.snapshotId } : {}),
      ...(reachedPricing ? { pricingSnapshotId: pricing.snapshotId } : {}),
      ...(reachedCredential
        ? { credentialMetadataId: admissionInput.credentialMetadataId }
        : {}),
      ...(reachedEgress
        ? {
            proposalCheckpointId: admissionInput.packet.checkpointId,
            proposalPacketSha256: admissionInput.packet.packetSha256,
            proposalMessagesSha256: admissionInput.packet.messagesSha256,
          }
        : {}),
      ...(billing === undefined
        ? {}
        : {
            pricingSnapshotId: pricing.snapshotId,
            campaignId: admissionInput.budget.campaignId,
            billing,
            proposalCheckpointId: admissionInput.packet.checkpointId,
            proposalPacketSha256: admissionInput.packet.packetSha256,
            proposalMessagesSha256: admissionInput.packet.messagesSha256,
          }),
    });
    const attempt = AttemptPlanV0Schema.parse({
      providerId: local.providerId,
      model: local.model,
      leaseId: proposal.priorLeaseId,
      phase: "synthesis",
      requestedMaxOutputTokens: local.maxOutputTokens,
      allowTools: false,
      requireToolCall: false,
    });
    return decisionResult(decision, attempt);
  }

  if (billing === undefined) {
    throw new Error("cloud admission did not produce a billing projection");
  }
  if (input.selectedLeaseId === proposal.priorLeaseId) {
    throw new Error("admitted cloud checkpoint must receive a new lease ID");
  }
  if (input.state.providerChangeCount + 1 > input.policy.maxProviderChanges) {
    return terminal("provider_change_limit");
  }
  const decision = RoutingDecisionPayloadSchema.parse({
    decisionId: input.decisionId,
    policyVersion: CHECKPOINT_ROUTER_POLICY_VERSION,
    boundary: proposal.boundary,
    phase: proposal.phase,
    action: "assign_new_lease",
    reasonCode: "cloud_admitted",
    candidateProviderIds: proposal.candidateProviderIds,
    selectedProviderId: cloud.providerId,
    selectedModel: cloud.model,
    priorLeaseId: proposal.priorLeaseId,
    selectedLeaseId: input.selectedLeaseId,
    ...riskFields(input),
    triggerFacts: canonicalFacts(input, proposal),
    admission,
    routerInputSnapshot,
    healthSnapshotId: cloudHealth.snapshotId,
    pricingSnapshotId: pricing.snapshotId,
    campaignId: admissionInput.budget.campaignId,
    budgetReservationId: admissionInput.budget.reservationId,
    credentialMetadataId: admissionInput.credentialMetadataId,
    billing,
    checkpointId: admissionInput.packet.checkpointId,
    packetSha256: admissionInput.packet.packetSha256,
    messagesSha256: admissionInput.packet.messagesSha256,
  });
  const attempt = AttemptPlanV0Schema.parse({
    providerId: cloud.providerId,
    model: cloud.model,
    leaseId: input.selectedLeaseId,
    phase: "synthesis",
    requestedMaxOutputTokens: billing.requestedMaxOutputTokens,
    allowTools: false,
    requireToolCall: false,
    budgetReservationId: admissionInput.budget.reservationId,
  });
  return decisionResult(decision, attempt);
}

export function resolveCheckpointRouteV0(
  inputValue: CheckpointResolutionInputV0,
): CheckpointRouterResultV0 {
  const input = CheckpointResolutionInputV0Schema.parse(inputValue);
  const proposalInput = proposalInputFromResolution(input);
  const proposal = proposeCheckpointRouteV0(proposalInput);
  const providers = normalizeProviders(input.providers);
  const target = requireProvider(
    providers,
    proposal.targetProviderId,
    proposal.targetLocality,
  );

  if (proposal.intent !== "cloud_synthesis") {
    const requiredRemainingMs =
      proposal.intent === "local_fallback" ? input.policy.attemptTimeoutMs : 1;
    return localDecision({
      input,
      proposal,
      providers,
      target,
      requiredRemainingMs,
    });
  }
  if (
    input.boundary !== "evidence_complete" ||
    input.cloudAdmission === undefined
  ) {
    return terminal("invalid_boundary_state");
  }
  const local = requireProvider(providers, input.localProviderId, "local");
  return cloudDecision({
    input,
    proposal,
    providers,
    cloud: target,
    local,
    admissionInput: input.cloudAdmission,
  });
}
