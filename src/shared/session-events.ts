import { z } from "zod";

import { ReviewCoverageV1Schema } from "./change-review-contracts";
import {
  REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  ReviewResultV1Schema,
} from "./review-result-contract";
import {
  CostScopeSchema,
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_ROUTING_POLICY_ID,
  HybridSimulationSessionAuthorityV1Schema,
  RuntimeCostScopeSchema,
} from "./hybrid-simulation-contracts";

export {
  CostScopeSchema,
  RuntimeCostScopeSchema,
  type CostScope,
  type RuntimeCostScope,
} from "./hybrid-simulation-contracts";

export const SESSION_STATUSES = [
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export const SessionStatusSchema = z.enum(SESSION_STATUSES);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const APP_TASK_TRACKS = [
  "repository-investigator-v1",
  "change-review-v1",
] as const;

export const AppTaskTrackSchema = z.enum(APP_TASK_TRACKS);

export type AppTaskTrack = z.infer<typeof AppTaskTrackSchema>;

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

export const AssistantCompletionStateSchema = z.enum(["complete", "incomplete"]);

export type AssistantCompletionState = z.infer<
  typeof AssistantCompletionStateSchema
>;

export const CitationCorrectionSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export type CitationCorrection = z.infer<typeof CitationCorrectionSchema>;

export const COMPLETION_OBLIGATION_TOOL_NAMES = [
  "list_files",
  "search_text",
  "read_text_file",
  "inspect_git_changes",
] as const;

export const CompletionObligationToolNameSchema = z.enum(
  COMPLETION_OBLIGATION_TOOL_NAMES,
);

export type CompletionObligationToolName = z.infer<
  typeof CompletionObligationToolNameSchema
>;

const maximumAgenticPolicySteps = 32;

const orderedRequiredToolsSchema = z
  .array(CompletionObligationToolNameSchema)
  .max(maximumAgenticPolicySteps);

const maximumVerifiedPathLineCitations = 100;

export const CompletionObligationsSchema = z
  .object({
    requiredSuccessfulTools: orderedRequiredToolsSchema,
    minimumVerifiedPathLineCitations: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .max(maximumVerifiedPathLineCitations),
  })
  .strict();

export type CompletionObligations = z.infer<
  typeof CompletionObligationsSchema
>;

export const AgenticExecutionPolicyV1Schema = z
  .object({
    schemaVersion: z.literal("agentic-execution-v1"),
    inferenceRounds: z
      .number()
      .int()
      .min(1)
      .max(maximumAgenticPolicySteps)
      .safe(),
    toolCalls: z
      .number()
      .int()
      .min(1)
      .max(maximumAgenticPolicySteps)
      .safe(),
  })
  .strict();

export const ROUTING_POLICY_IDS = [
  "local_only_v1",
  "hybrid_v0",
  HYBRID_SIMULATION_ROUTING_POLICY_ID,
] as const;
export const RoutingPolicyIdSchema = z.enum(ROUTING_POLICY_IDS);
export type RoutingPolicyId = z.infer<typeof RoutingPolicyIdSchema>;

export const EGRESS_CONSENTS = [
  "none",
  "session_cloud_synthesis_v1",
] as const;
export const EgressConsentSchema = z.enum(EGRESS_CONSENTS);
export type EgressConsent = z.infer<typeof EgressConsentSchema>;

export const SimulationConsentSchema = z.literal(
  HYBRID_SIMULATION_CONSENT_ID,
);
export type SimulationConsent = z.infer<typeof SimulationConsentSchema>;

export const AgenticExecutionPolicyV2Schema = z
  .object({
    schemaVersion: z.literal("agentic-execution-v2"),
    inferenceRounds: z
      .number()
      .int()
      .min(1)
      .max(maximumAgenticPolicySteps)
      .safe(),
    toolCalls: z
      .number()
      .int()
      .min(1)
      .max(maximumAgenticPolicySteps)
      .safe(),
    routingPolicy: RoutingPolicyIdSchema,
    maxProviderChanges: z.literal(2),
    maxPaidAttempts: z.literal(1),
    maxPaidEpisodeMicrousd: z.number().int().nonnegative().safe(),
    maxEpisodeDurationMs: z.number().int().positive().safe(),
    attemptTimeoutMs: z.number().int().positive().safe(),
    egressConsent: EgressConsentSchema,
    simulationConsent: SimulationConsentSchema.optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.attemptTimeoutMs > policy.maxEpisodeDurationMs) {
      context.addIssue({
        code: "custom",
        message: "attemptTimeoutMs must not exceed maxEpisodeDurationMs",
        path: ["attemptTimeoutMs"],
      });
    }
    if (
      policy.routingPolicy === "local_only_v1" &&
      policy.egressConsent !== "none"
    ) {
      context.addIssue({
        code: "custom",
        message: "local_only_v1 requires egressConsent none",
        path: ["egressConsent"],
      });
    }
    if (policy.routingPolicy === HYBRID_SIMULATION_ROUTING_POLICY_ID) {
      if (
        policy.egressConsent !== "none" ||
        policy.simulationConsent !== HYBRID_SIMULATION_CONSENT_ID
      ) {
        context.addIssue({
          code: "custom",
          message:
            "hybrid_simulation_v1 requires simulation consent and real egress consent none",
          path: ["simulationConsent"],
        });
      }
      if (
        policy.maxPaidAttempts !== 1 ||
        policy.maxPaidEpisodeMicrousd !==
          HYBRID_SIMULATION_MAX_SPEND_MICROUSD
      ) {
        context.addIssue({
          code: "custom",
          message:
            "hybrid_simulation_v1 requires one attempt and the fixed simulated cap",
          path: ["maxPaidEpisodeMicrousd"],
        });
      }
    } else if (policy.simulationConsent !== undefined) {
      context.addIssue({
        code: "custom",
        message: "simulation consent is reserved for hybrid_simulation_v1",
        path: ["simulationConsent"],
      });
    }
  });

export const AgenticExecutionPolicySchema = z.discriminatedUnion(
  "schemaVersion",
  [AgenticExecutionPolicyV1Schema, AgenticExecutionPolicyV2Schema],
);

export type AgenticExecutionPolicyV1 = z.infer<
  typeof AgenticExecutionPolicyV1Schema
>;
export type AgenticExecutionPolicyV2 = z.infer<
  typeof AgenticExecutionPolicyV2Schema
>;

export type AgenticExecutionPolicy = z.infer<
  typeof AgenticExecutionPolicySchema
>;

export const CompletionObligationOutcomeSchema = z.enum([
  "accepted",
  "retry",
  "exhausted",
]);

export type CompletionObligationOutcome = z.infer<
  typeof CompletionObligationOutcomeSchema
>;

export const CONTEXT_COMPILATION_MODES = ["working", "finalization"] as const;
export const ContextCompilationModeSchema = z.enum(CONTEXT_COMPILATION_MODES);
export type ContextCompilationMode = z.infer<
  typeof ContextCompilationModeSchema
>;

export const CONTEXT_COMPILATION_REASONS = [
  "session_start",
  "tool_result_boundary",
  "obligation_retry_boundary",
  "no_progress_boundary",
  "finalization_boundary",
  "no_progress_finalization_boundary",
] as const;
export const ContextCompilationReasonSchema = z.enum(
  CONTEXT_COMPILATION_REASONS,
);
export type ContextCompilationReason = z.infer<
  typeof ContextCompilationReasonSchema
>;

export const OptimizationProfileSchema = z.enum([
  "quality",
  "balanced",
  "economy",
  "fast",
]);

export type OptimizationProfile = z.infer<typeof OptimizationProfileSchema>;

export const SessionEventTypeSchema = z.enum([
  "session.created",
  "session.started",
  "user.message",
  "cloud.egress.admission.recorded",
  "routing.decision.recorded",
  "route.assigned",
  "assistant.message.started",
  "assistant.message.delta",
  "assistant.message.completed",
  "tool.call.requested",
  "tool.call.completed",
  "context.compiled",
  "inference.attempt.started",
  "inference.attempt.finished",
  "completion.obligations.checked",
  "usage.recorded",
  "session.completed",
  "session.failed",
  "session.cancelled",
  "session.interrupted",
]);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const requiredId = z.string().trim().min(1);
const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeNumber = z.number().finite().nonnegative();
const safeNonNegativeInteger = z.number().int().nonnegative().safe();
const safePositiveInteger = z.number().int().positive().safe();
const boundedV2Id = requiredId.max(256);
const boundedCode = z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const sortedCloudEgressReasonCodesSchema = z
  .array(boundedCode)
  .max(64)
  .superRefine((reasonCodes, context) => {
    for (let index = 1; index < reasonCodes.length; index += 1) {
      const previous = reasonCodes[index - 1];
      const current = reasonCodes[index];
      if (previous !== undefined && current !== undefined && previous >= current) {
        context.addIssue({
          code: "custom",
          message: "cloud egress reason codes must be sorted and unique",
          path: [index],
        });
      }
    }
  });

export const CloudEgressAdmissionRecordV1Schema = z
  .object({
    schemaVersion: z.literal("cloud-egress-admission-record-v1"),
    admissionId: boundedV2Id,
    policyVersion: z.literal("cloud-egress-policy-v1"),
    decision: z.enum(["pass", "deny"]),
    reasonCodes: sortedCloudEgressReasonCodesSchema,
    messagesSemanticSha256: sha256,
    provenanceSemanticSha256: sha256,
    checkpointId: boundedV2Id,
    simulationAuthorityId: boundedCode,
    evaluatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      (record.decision === "pass" && record.reasonCodes.length !== 0) ||
      (record.decision === "deny" && record.reasonCodes.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "passing egress has no reasons and denied egress has at least one reason",
        path: ["reasonCodes"],
      });
    }
  });
export type CloudEgressAdmissionRecordV1 = z.infer<
  typeof CloudEgressAdmissionRecordV1Schema
>;

export const ROUTING_BOUNDARIES = [
  "session_start",
  "evidence_complete",
  "provider_failure",
] as const;
export const RoutingBoundarySchema = z.enum(ROUTING_BOUNDARIES);
export type RoutingBoundary = z.infer<typeof RoutingBoundarySchema>;

export const ROUTING_PHASES = ["investigation", "synthesis"] as const;
export const RoutingPhaseSchema = z.enum(ROUTING_PHASES);
export type RoutingPhase = z.infer<typeof RoutingPhaseSchema>;

export const ROUTING_DECISION_ACTIONS = [
  "assign_new_lease",
  "retain_lease",
] as const;
export const RoutingDecisionActionSchema = z.enum(ROUTING_DECISION_ACTIONS);
export type RoutingDecisionAction = z.infer<
  typeof RoutingDecisionActionSchema
>;

export const ROUTING_REASON_CODES = [
  "local_policy",
  "local_investigation",
  "low_risk_local_review",
  "cloud_admitted",
  "disabled_provider",
  "missing_credential",
  "unhealthy_provider",
  "pricing_denial",
  "capability_mismatch",
  "egress_denial",
  "budget_denial",
  "deadline_denial",
  "cloud_failure",
  "local_fallback",
] as const;
export const RoutingReasonCodeSchema = z.enum(ROUTING_REASON_CODES);
export type RoutingReasonCode = z.infer<typeof RoutingReasonCodeSchema>;

const CLOUD_PROPOSAL_DENIAL_REASON_CODES = [
  "disabled_provider",
  "missing_credential",
  "unhealthy_provider",
  "pricing_denial",
  "capability_mismatch",
  "egress_denial",
  "budget_denial",
  "deadline_denial",
] as const satisfies readonly RoutingReasonCode[];

export function isCloudProposalDenialReason(
  reasonCode: RoutingReasonCode,
): boolean {
  return CLOUD_PROPOSAL_DENIAL_REASON_CODES.some(
    (candidate) => candidate === reasonCode,
  );
}

export const ROUTING_ADMISSION_STATUSES = [
  "passed",
  "denied",
  "not_applicable",
] as const;
export const RoutingAdmissionStatusSchema = z.enum(
  ROUTING_ADMISSION_STATUSES,
);

export const ROUTING_ADMISSION_REASON_CODES = [
  "capability_ok",
  "credential_ok",
  "health_ok",
  "pricing_ok",
  "egress_ok",
  "deadline_ok",
  "budget_ok",
  "not_applicable",
  "capability_mismatch",
  "missing_credential",
  "unhealthy_provider",
  "pricing_denial",
  "egress_denial",
  "deadline_denial",
  "budget_denial",
] as const;
export const RoutingAdmissionReasonCodeSchema = z.enum(
  ROUTING_ADMISSION_REASON_CODES,
);

export const RoutingAdmissionCheckSchema = z
  .object({
    status: RoutingAdmissionStatusSchema,
    reasonCode: RoutingAdmissionReasonCodeSchema,
  })
  .strict()
  .superRefine((check, context) => {
    if (
      (check.status === "not_applicable") !==
      (check.reasonCode === "not_applicable")
    ) {
      context.addIssue({
        code: "custom",
        message: "not_applicable status and reason must be used together",
      });
    }
    if (check.status === "passed" && !check.reasonCode.endsWith("_ok")) {
      context.addIssue({
        code: "custom",
        message: "passed admission checks require an *_ok reason",
        path: ["reasonCode"],
      });
    }
    if (
      check.status === "denied" &&
      (check.reasonCode.endsWith("_ok") ||
        check.reasonCode === "not_applicable")
    ) {
      context.addIssue({
        code: "custom",
        message: "denied admission checks require a denial reason",
        path: ["reasonCode"],
      });
    }
  });

const routingAdmissionExpectations = {
  capability: {
    passed: "capability_ok",
    denied: "capability_mismatch",
  },
  credential: {
    passed: "credential_ok",
    denied: "missing_credential",
  },
  health: { passed: "health_ok", denied: "unhealthy_provider" },
  pricing: { passed: "pricing_ok", denied: "pricing_denial" },
  egress: { passed: "egress_ok", denied: "egress_denial" },
  deadline: { passed: "deadline_ok", denied: "deadline_denial" },
  budget: { passed: "budget_ok", denied: "budget_denial" },
} as const;

export const RoutingAdmissionSchema = z
  .object({
    capability: RoutingAdmissionCheckSchema,
    credential: RoutingAdmissionCheckSchema,
    health: RoutingAdmissionCheckSchema,
    // Added by checkpoint-router-v0. Optional input preserves replay of the
    // already-persisted PR 1 v2 fixtures; every PR 4 router decision emits it.
    pricing: RoutingAdmissionCheckSchema.optional(),
    egress: RoutingAdmissionCheckSchema,
    deadline: RoutingAdmissionCheckSchema,
    budget: RoutingAdmissionCheckSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    for (const name of Object.keys(
      routingAdmissionExpectations,
    ) as Array<keyof typeof routingAdmissionExpectations>) {
      const check = admission[name];
      if (check === undefined || check.status === "not_applicable") continue;
      const expected = routingAdmissionExpectations[name][check.status];
      if (check.reasonCode !== expected) {
        context.addIssue({
          code: "custom",
          message: `${name} ${check.status} requires reason ${expected}`,
          path: [name, "reasonCode"],
        });
      }
    }
  });

export type RoutingAdmission = z.infer<typeof RoutingAdmissionSchema>;

const routingRiskSignalNameSchema = z.enum([
  "changed_file_count",
  "changed_line_count",
  "changed_surface_count",
  "runtime_without_relevant_test",
  "sensitive_subsystem",
]);

const routingRiskSignalSchema = z
  .object({
    name: routingRiskSignalNameSchema,
    value: z.union([z.boolean(), safeNonNegativeInteger]),
    weight: z.number().int().min(0).max(10).safe(),
    contribution: z.number().int().min(0).max(10).safe(),
  })
  .strict();

const routingRiskSignalsSchema = z
  .array(routingRiskSignalSchema)
  .max(16)
  .superRefine((signals, context) => {
    for (let index = 1; index < signals.length; index += 1) {
      const previous = signals[index - 1];
      const current = signals[index];
      if (previous !== undefined && current !== undefined && previous.name >= current.name) {
        context.addIssue({
          code: "custom",
          message: "risk signals must be sorted by name and unique",
          path: [index, "name"],
        });
      }
    }
  });

const routingTriggerFactSchema = z
  .object({
    key: boundedCode,
    value: z.union([
      z.boolean(),
      z.number().finite().safe(),
      z.string().max(256),
    ]),
  })
  .strict();

const routingTriggerFactsSchema = z
  .array(routingTriggerFactSchema)
  .max(32)
  .superRefine((facts, context) => {
    for (let index = 1; index < facts.length; index += 1) {
      const previous = facts[index - 1];
      const current = facts[index];
      if (previous !== undefined && current !== undefined && previous.key >= current.key) {
        context.addIssue({
          code: "custom",
          message: "trigger facts must be sorted by key and unique",
          path: [index, "key"],
        });
      }
    }
  });

const sortedProviderIdsSchema = z
  .array(boundedV2Id)
  .min(1)
  .max(32)
  .superRefine((providerIds, context) => {
    for (let index = 1; index < providerIds.length; index += 1) {
      const previous = providerIds[index - 1];
      const current = providerIds[index];
      if (previous !== undefined && current !== undefined && previous >= current) {
        context.addIssue({
          code: "custom",
          message: "candidate provider IDs must be sorted and unique",
          path: [index],
        });
      }
    }
  });

const routerProviderCapabilitiesSchema = z
  .array(boundedCode)
  .min(1)
  .max(32)
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
          message: "router provider capabilities must be sorted and unique",
          path: [index],
        });
      }
    }
  });

export const RouterProviderInputSnapshotV0Schema = z
  .object({
    providerId: boundedV2Id,
    model: boundedV2Id,
    locality: z.enum(["local", "cloud"]),
    enabled: z.boolean(),
    capabilities: routerProviderCapabilitiesSchema,
    accountingKind: z.enum(["local_zero_cost", "metered"]),
    contextWindowTokens: safePositiveInteger,
    maxOutputTokens: safePositiveInteger,
    requestReserveTokens: safeNonNegativeInteger,
  })
  .strict()
  .superRefine((provider, context) => {
    if (
      (provider.locality === "local") !==
      (provider.accountingKind === "local_zero_cost")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "router provider locality must match its explicit accounting kind",
        path: ["accountingKind"],
      });
    }
    if (
      provider.maxOutputTokens + provider.requestReserveTokens >=
      provider.contextWindowTokens
    ) {
      context.addIssue({
        code: "custom",
        message:
          "router provider context must exceed output and request reserves",
        path: ["contextWindowTokens"],
      });
    }
  });

export type RouterProviderInputSnapshotV0 = z.infer<
  typeof RouterProviderInputSnapshotV0Schema
>;

export const ProviderHealthSnapshotV0Schema = z
  .object({
    snapshotId: boundedV2Id,
    providerId: boundedV2Id,
    model: boundedV2Id,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    status: z.enum(["healthy", "unhealthy", "unavailable"]),
    resultCode: boundedCode,
  })
  .strict();

export type ProviderHealthSnapshotV0 = z.infer<
  typeof ProviderHealthSnapshotV0Schema
>;

export const ProviderPricingSnapshotV0Schema = z
  .object({
    snapshotId: boundedV2Id,
    providerId: boundedV2Id,
    model: boundedV2Id,
    verifiedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    status: z.enum(["available", "unavailable"]),
    inputMicrousdPerMillionTokens: safeNonNegativeInteger,
    outputMicrousdPerMillionTokens: safeNonNegativeInteger,
    cacheReadMicrousdPerMillionTokens: safeNonNegativeInteger,
    pricingSourceSha256: sha256,
  })
  .strict()
  .superRefine((pricing, context) => {
    if (
      pricing.status === "available" &&
      (pricing.inputMicrousdPerMillionTokens === 0 ||
        pricing.outputMicrousdPerMillionTokens === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "available paid pricing requires positive input and output rates",
        path: ["status"],
      });
    }
    if (
      pricing.cacheReadMicrousdPerMillionTokens >
      pricing.inputMicrousdPerMillionTokens
    ) {
      context.addIssue({
        code: "custom",
        message:
          "no_cache_credit requires the cache-read rate not to exceed the input rate",
        path: ["cacheReadMicrousdPerMillionTokens"],
      });
    }
  });

export type ProviderPricingSnapshotV0 = z.infer<
  typeof ProviderPricingSnapshotV0Schema
>;

export const RouterInputSnapshotV0Schema = z
  .object({
    schemaVersion: z.literal("checkpoint-router-input-v0"),
    boundary: RoutingBoundarySchema,
    asOf: z.string().datetime({ offset: true }),
    providers: z
      .array(RouterProviderInputSnapshotV0Schema)
      .min(1)
      .max(32),
    targetProviderId: boundedV2Id,
    targetModel: boundedV2Id,
    requiredCapabilities: routerProviderCapabilitiesSchema,
    deadline: z
      .object({
        deadlineAt: z.string().datetime({ offset: true }),
        remainingMs: safeNonNegativeInteger,
        attemptTimeoutMs: safePositiveInteger,
        requiredRemainingMs: safePositiveInteger,
        sufficient: z.boolean(),
      })
      .strict(),
    healthSnapshots: z.array(ProviderHealthSnapshotV0Schema).max(2),
    pricingSnapshot: ProviderPricingSnapshotV0Schema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (let index = 1; index < snapshot.providers.length; index += 1) {
      const previous = snapshot.providers[index - 1];
      const current = snapshot.providers[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous.providerId >= current.providerId
      ) {
        context.addIssue({
          code: "custom",
          message: "router providers must be sorted by providerId and unique",
          path: ["providers", index, "providerId"],
        });
      }
    }
    for (let index = 1; index < snapshot.healthSnapshots.length; index += 1) {
      const previous = snapshot.healthSnapshots[index - 1];
      const current = snapshot.healthSnapshots[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        previous.providerId >= current.providerId
      ) {
        context.addIssue({
          code: "custom",
          message: "router health snapshots must be sorted and provider-unique",
          path: ["healthSnapshots", index, "providerId"],
        });
      }
    }
    const target = snapshot.providers.find(
      (provider) => provider.providerId === snapshot.targetProviderId,
    );
    if (target === undefined || target.model !== snapshot.targetModel) {
      context.addIssue({
        code: "custom",
        message: "router target must match one persisted provider snapshot",
        path: ["targetProviderId"],
      });
    }
    const remainingMs = Math.max(
      0,
      Date.parse(snapshot.deadline.deadlineAt) - Date.parse(snapshot.asOf),
    );
    if (
      !Number.isSafeInteger(remainingMs) ||
      snapshot.deadline.remainingMs !== remainingMs
    ) {
      context.addIssue({
        code: "custom",
        message: "router deadline remainingMs must be derived from asOf",
        path: ["deadline", "remainingMs"],
      });
    }
    if (
      snapshot.deadline.sufficient !==
      (remainingMs >= snapshot.deadline.requiredRemainingMs)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "router deadline sufficiency must match its persisted required window",
        path: ["deadline", "sufficient"],
      });
    }
    if (
      snapshot.deadline.requiredRemainingMs >
      snapshot.deadline.attemptTimeoutMs
    ) {
      context.addIssue({
        code: "custom",
        message:
          "router required deadline window cannot exceed the attempt timeout",
        path: ["deadline", "requiredRemainingMs"],
      });
    }
  });

export type RouterInputSnapshotV0 = z.infer<
  typeof RouterInputSnapshotV0Schema
>;

export const RoutingDecisionPayloadSchema = z
  .object({
    decisionId: boundedV2Id,
    policyVersion: z.literal("hybrid-lease-router-v0"),
    // Optional only for replay compatibility. Current writers persist one of
    // the two runtime scopes; absence projects as legacy_unclassified.
    costScope: RuntimeCostScopeSchema.optional(),
    cloudEgressAdmissionId: boundedV2Id.optional(),
    boundary: RoutingBoundarySchema,
    phase: RoutingPhaseSchema,
    action: RoutingDecisionActionSchema,
    reasonCode: RoutingReasonCodeSchema,
    candidateProviderIds: sortedProviderIdsSchema,
    selectedProviderId: boundedV2Id,
    selectedModel: boundedV2Id,
    proposedProviderId: boundedV2Id.optional(),
    proposedModel: boundedV2Id.optional(),
    priorLeaseId: boundedV2Id.optional(),
    selectedLeaseId: boundedV2Id,
    riskPolicyId: boundedCode.optional(),
    riskScore: safeNonNegativeInteger.optional(),
    riskSignals: routingRiskSignalsSchema,
    riskIncompleteReason: z.string().trim().min(1).max(512).optional(),
    triggerFacts: routingTriggerFactsSchema,
    admission: RoutingAdmissionSchema,
    // Optional only for replay compatibility with PR 1 events. Every decision
    // produced by checkpoint-router-v0 carries this bounded immutable input.
    routerInputSnapshot: RouterInputSnapshotV0Schema.optional(),
    healthSnapshotId: boundedV2Id.optional(),
    pricingSnapshotId: boundedV2Id.optional(),
    campaignId: boundedV2Id.optional(),
    budgetReservationId: boundedV2Id.optional(),
    credentialMetadataId: boundedV2Id.optional(),
    billing: z
      .object({
        billableInputTokens: safeNonNegativeInteger,
        billableCacheReadTokens: safeNonNegativeInteger,
        requestedMaxOutputTokens: safePositiveInteger,
        inputMicrousdPerMillionTokens: safeNonNegativeInteger,
        outputMicrousdPerMillionTokens: safeNonNegativeInteger,
        cacheReadMicrousdPerMillionTokens: safeNonNegativeInteger.optional(),
        providerFeeCeilingMicrousd: safeNonNegativeInteger,
        roundingPolicy: z.literal("ceil_each_component_v1"),
        projectedCostMicrousd: safeNonNegativeInteger,
        remainingEpisodeMicrousd: safeNonNegativeInteger,
        remainingCampaignMicrousd: safeNonNegativeInteger,
      })
      .strict()
      .superRefine((billing, context) => {
        if (
          billing.cacheReadMicrousdPerMillionTokens === undefined &&
          billing.billableCacheReadTokens !== 0
        ) {
          context.addIssue({
            code: "custom",
            message: "cache-read tokens require a cache-read rate",
            path: ["billableCacheReadTokens"],
          });
        }
        if (
          (billing.cacheReadMicrousdPerMillionTokens ?? 0) >
          billing.inputMicrousdPerMillionTokens
        ) {
          context.addIssue({
            code: "custom",
            message:
              "no_cache_credit requires the cache-read rate not to exceed the input rate",
            path: ["cacheReadMicrousdPerMillionTokens"],
          });
        }
        const million = 1_000_000n;
        const ceilComponent = (tokens: number, rate: number): bigint => {
          const product = BigInt(tokens) * BigInt(rate);
          return (product + million - 1n) / million;
        };
        const expectedProjection =
          ceilComponent(
            billing.billableInputTokens,
            billing.inputMicrousdPerMillionTokens,
          ) +
          ceilComponent(
            billing.requestedMaxOutputTokens,
            billing.outputMicrousdPerMillionTokens,
          ) +
          ceilComponent(
            billing.billableCacheReadTokens,
            billing.cacheReadMicrousdPerMillionTokens ?? 0,
          ) +
          BigInt(billing.providerFeeCeilingMicrousd);
        if (expectedProjection > BigInt(Number.MAX_SAFE_INTEGER)) {
          context.addIssue({
            code: "custom",
            message: "projected cost exceeds the safe integer range",
            path: ["projectedCostMicrousd"],
          });
        } else if (
          billing.projectedCostMicrousd !== Number(expectedProjection)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "projected cost must equal ceil_each_component_v1 worst-case cost",
            path: ["projectedCostMicrousd"],
          });
        }
      })
      .optional(),
    checkpointId: boundedV2Id.optional(),
    packetSha256: sha256.optional(),
    messagesSha256: sha256.optional(),
    // Required by the PR6B0 simulation reducer whenever an immediate egress
    // admission record exists. Optional at the schema layer only for replay of
    // pre-PR6B0 routing decisions.
    provenanceSemanticSha256: sha256.optional(),
    proposalCheckpointId: boundedV2Id.optional(),
    proposalPacketSha256: sha256.optional(),
    proposalMessagesSha256: sha256.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (!decision.candidateProviderIds.includes(decision.selectedProviderId)) {
      context.addIssue({
        code: "custom",
        message: "selected provider must be one of the sorted candidates",
        path: ["selectedProviderId"],
      });
    }
    if (
      decision.proposedProviderId !== undefined &&
      !decision.candidateProviderIds.includes(decision.proposedProviderId)
    ) {
      context.addIssue({
        code: "custom",
        message: "proposed provider must be one of the sorted candidates",
        path: ["proposedProviderId"],
      });
    }
    if (
      decision.action === "retain_lease" &&
      (decision.priorLeaseId === undefined ||
        decision.priorLeaseId !== decision.selectedLeaseId)
    ) {
      context.addIssue({
        code: "custom",
        message: "retain_lease requires matching prior and selected lease IDs",
        path: ["selectedLeaseId"],
      });
    }
    if (
      decision.action === "assign_new_lease" &&
      decision.priorLeaseId === decision.selectedLeaseId
    ) {
      context.addIssue({
        code: "custom",
        message: "assign_new_lease cannot reuse the prior lease ID",
        path: ["selectedLeaseId"],
      });
    }
    if (
      (decision.boundary === "session_start") !==
      (decision.phase === "investigation")
    ) {
      context.addIssue({
        code: "custom",
        message: "only session_start decisions use the investigation phase",
        path: ["phase"],
      });
    }
    if (decision.routerInputSnapshot !== undefined) {
      const snapshot = decision.routerInputSnapshot;
      if (snapshot.boundary !== decision.boundary) {
        context.addIssue({
          code: "custom",
          message: "router input boundary must match the routing decision",
          path: ["routerInputSnapshot", "boundary"],
        });
      }
      const snapshotProviderIds = snapshot.providers.map(
        (provider) => provider.providerId,
      );
      if (
        JSON.stringify(snapshotProviderIds) !==
        JSON.stringify(decision.candidateProviderIds)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "routing candidates must exactly match the persisted provider inputs",
          path: ["candidateProviderIds"],
        });
      }
      const selectedProviderSnapshot = snapshot.providers.find(
        (provider) => provider.providerId === decision.selectedProviderId,
      );
      const selectedMustBeCloud = decision.reasonCode === "cloud_admitted";
      if (
        selectedProviderSnapshot === undefined ||
        selectedProviderSnapshot.model !== decision.selectedModel ||
        selectedProviderSnapshot.locality !==
          (selectedMustBeCloud ? "cloud" : "local") ||
        selectedProviderSnapshot.accountingKind !==
          (selectedMustBeCloud ? "metered" : "local_zero_cost")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "selected provider locality and accounting must match the routing reason",
          path: ["selectedProviderId"],
        });
      }
      if (decision.proposedProviderId !== undefined) {
        const proposedProviderSnapshot = snapshot.providers.find(
          (provider) => provider.providerId === decision.proposedProviderId,
        );
        if (
          proposedProviderSnapshot === undefined ||
          proposedProviderSnapshot.model !== decision.proposedModel ||
          proposedProviderSnapshot.locality !== "cloud" ||
          proposedProviderSnapshot.accountingKind !== "metered"
        ) {
          context.addIssue({
            code: "custom",
            message:
              "a proposed cloud provider must be persisted as metered cloud input",
            path: ["proposedProviderId"],
          });
        }
      }
      const referencedHealth = snapshot.healthSnapshots.find(
        (health) => health.snapshotId === decision.healthSnapshotId,
      );
      if (
        decision.healthSnapshotId !== undefined &&
        (referencedHealth === undefined ||
          referencedHealth.providerId !== snapshot.targetProviderId ||
          referencedHealth.model !== snapshot.targetModel)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "health snapshot must match the persisted router target provider and model",
          path: ["healthSnapshotId"],
        });
      }
      const referencedPricing = snapshot.pricingSnapshot;
      if (
        decision.pricingSnapshotId !== undefined &&
        (decision.pricingSnapshotId !== referencedPricing?.snapshotId ||
          referencedPricing.providerId !== snapshot.targetProviderId ||
          referencedPricing.model !== snapshot.targetModel)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "pricing snapshot must match the persisted router target provider and model",
          path: ["pricingSnapshotId"],
        });
      }
      if (
        decision.billing !== undefined &&
        (referencedPricing === undefined ||
          decision.billing.inputMicrousdPerMillionTokens !==
            referencedPricing.inputMicrousdPerMillionTokens ||
          decision.billing.outputMicrousdPerMillionTokens !==
            referencedPricing.outputMicrousdPerMillionTokens ||
          (decision.billing.cacheReadMicrousdPerMillionTokens ?? 0) !==
            referencedPricing.cacheReadMicrousdPerMillionTokens)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "billing component rates must match the persisted pricing snapshot",
          path: ["billing"],
        });
      }
      const deadlineStatus = decision.admission.deadline.status;
      if (
        deadlineStatus !== "not_applicable" &&
        (deadlineStatus === "passed") !== snapshot.deadline.sufficient
      ) {
        context.addIssue({
          code: "custom",
          message:
            "deadline admission must match the persisted deadline calculation",
          path: ["admission", "deadline", "status"],
        });
      }
    }
    const hasRiskPolicy = decision.riskPolicyId !== undefined;
    const hasRiskScore = decision.riskScore !== undefined;
    const hasIncompleteRisk = decision.riskIncompleteReason !== undefined;
    if (!hasRiskPolicy && (hasRiskScore || hasIncompleteRisk || decision.riskSignals.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "risk data requires a riskPolicyId",
        path: ["riskPolicyId"],
      });
    }
    if (hasRiskPolicy && hasRiskScore === hasIncompleteRisk) {
      context.addIssue({
        code: "custom",
        message: "risk policy requires exactly one of riskScore or riskIncompleteReason",
        path: ["riskScore"],
      });
    }
    if (hasRiskPolicy && decision.boundary !== "evidence_complete") {
      context.addIssue({
        code: "custom",
        message: "risk data is allowed only at evidence_complete",
        path: ["riskPolicyId"],
      });
    }
    if (
      hasRiskScore &&
      decision.riskSignals.reduce((sum, signal) => sum + signal.contribution, 0) !==
        decision.riskScore
    ) {
      context.addIssue({
        code: "custom",
        message: "riskScore must equal the sum of signal contributions",
        path: ["riskScore"],
      });
    }
    if (decision.reasonCode === "cloud_admitted") {
      if (decision.action !== "assign_new_lease") {
        context.addIssue({
          code: "custom",
          message: "cloud admission must assign a new lease",
          path: ["action"],
        });
      }
      if (decision.boundary !== "evidence_complete") {
        context.addIssue({
          code: "custom",
          message: "cloud admission is allowed only at evidence_complete",
          path: ["boundary"],
        });
      }
      const cloudChecks = Object.entries(decision.admission);
      for (const [name, check] of cloudChecks) {
        if (check.status !== "passed") {
          context.addIssue({
            code: "custom",
            message: "cloud admission requires every admission check to pass",
            path: ["admission", name, "status"],
          });
        }
      }
      if (
        decision.routerInputSnapshot !== undefined &&
        decision.admission.pricing?.status !== "passed"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "checkpoint-router-v0 cloud admission requires passed pricing",
          path: ["admission", "pricing", "status"],
        });
      }
      const requiredCloudFields: Array<[keyof typeof decision, unknown]> = [
        ["healthSnapshotId", decision.healthSnapshotId],
        ["pricingSnapshotId", decision.pricingSnapshotId],
        ["campaignId", decision.campaignId],
        ["budgetReservationId", decision.budgetReservationId],
        ["credentialMetadataId", decision.credentialMetadataId],
        ["billing", decision.billing],
        ["checkpointId", decision.checkpointId],
        ["packetSha256", decision.packetSha256],
        ["messagesSha256", decision.messagesSha256],
      ];
      for (const [field, value] of requiredCloudFields) {
        if (value === undefined) {
          context.addIssue({
            code: "custom",
            message: `cloud admission requires ${String(field)}`,
            path: [field],
          });
        }
      }
      const forbiddenProposalFields: Array<[
        keyof typeof decision,
        unknown,
      ]> = [
        ["proposedProviderId", decision.proposedProviderId],
        ["proposedModel", decision.proposedModel],
        ["proposalCheckpointId", decision.proposalCheckpointId],
        ["proposalPacketSha256", decision.proposalPacketSha256],
        ["proposalMessagesSha256", decision.proposalMessagesSha256],
      ];
      for (const [field, value] of forbiddenProposalFields) {
        if (value !== undefined) {
          context.addIssue({
            code: "custom",
            message: `cloud admission cannot include ${String(field)}`,
            path: [field],
          });
        }
      }
    }
    const isCloudProposalDenial = isCloudProposalDenialReason(
      decision.reasonCode,
    );
    if (
      decision.routerInputSnapshot !== undefined &&
      !isCloudProposalDenial &&
      (decision.routerInputSnapshot.targetProviderId !==
        decision.selectedProviderId ||
        decision.routerInputSnapshot.targetModel !== decision.selectedModel)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "router target must match the selected provider for an executed decision",
        path: ["routerInputSnapshot", "targetProviderId"],
      });
    }
    if (isCloudProposalDenial) {
      if (
        decision.boundary !== "evidence_complete" ||
        decision.action !== "retain_lease"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "a denied cloud proposal must retain the evidence_complete lease",
          path: ["boundary"],
        });
      }
      if (
        decision.proposedProviderId === undefined ||
        decision.proposedModel === undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "a denied cloud proposal requires proposedProviderId and proposedModel",
          path: ["proposedProviderId"],
        });
      }
      if (decision.proposedProviderId === decision.selectedProviderId) {
        context.addIssue({
          code: "custom",
          message:
            "a denied cloud proposal cannot select its proposed provider",
          path: ["proposedProviderId"],
        });
      }
      if (
        decision.routerInputSnapshot !== undefined &&
        (decision.routerInputSnapshot.targetProviderId !==
          decision.proposedProviderId ||
          decision.routerInputSnapshot.targetModel !== decision.proposedModel)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "denied cloud proposal must persist its proposed provider as the router target",
          path: ["routerInputSnapshot", "targetProviderId"],
        });
      }
      if (decision.budgetReservationId !== undefined) {
        context.addIssue({
          code: "custom",
          message: "a denied cloud proposal cannot reserve paid budget",
          path: ["budgetReservationId"],
        });
      }
      const proposalPacketFields = [
        decision.proposalCheckpointId,
        decision.proposalPacketSha256,
        decision.proposalMessagesSha256,
      ];
      const proposalPacketFieldCount = proposalPacketFields.filter(
        (value) => value !== undefined,
      ).length;
      if (
        proposalPacketFieldCount !== 0 &&
        proposalPacketFieldCount !== proposalPacketFields.length
      ) {
        context.addIssue({
          code: "custom",
          message:
            "proposal checkpoint, packet hash, and message hash must be persisted together",
          path: ["proposalCheckpointId"],
        });
      }
      if (
        decision.admission.credential.status !== "not_applicable" &&
        decision.credentialMetadataId === undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "a completed credential admission check requires credentialMetadataId",
          path: ["credentialMetadataId"],
        });
      }
      if (
        decision.admission.health.status !== "not_applicable" &&
        decision.healthSnapshotId === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "a completed health admission check requires healthSnapshotId",
          path: ["healthSnapshotId"],
        });
      }
      if (
        decision.admission.pricing !== undefined &&
        decision.admission.pricing.status !== "not_applicable" &&
        decision.pricingSnapshotId === undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "a completed pricing admission check requires pricingSnapshotId",
          path: ["pricingSnapshotId"],
        });
      }
      if (
        decision.admission.egress.status !== "not_applicable" &&
        proposalPacketFieldCount !== proposalPacketFields.length
      ) {
        context.addIssue({
          code: "custom",
          message:
            "a completed egress admission check requires the exact proposal packet hashes",
          path: ["proposalCheckpointId"],
        });
      }
      if (decision.billing !== undefined) {
        if (
          decision.pricingSnapshotId === undefined ||
          decision.campaignId === undefined ||
          proposalPacketFieldCount !== proposalPacketFields.length
        ) {
          context.addIssue({
            code: "custom",
            message:
              "denied proposal billing requires pricing, campaign, and exact proposal packet evidence",
            path: ["billing"],
          });
        }
      }
      if (decision.reasonCode === "budget_denial") {
        const budgetDenialReason = decision.triggerFacts.find(
          (fact) => fact.key === "budget_denial_reason",
        )?.value;
        if (
          decision.routerInputSnapshot !== undefined &&
          ![
            "campaign_overrun",
            "episode_cap",
            "campaign_automatic_stop",
            "campaign_hard_ceiling",
          ].includes(String(budgetDenialReason))
        ) {
          context.addIssue({
            code: "custom",
            message:
              "checkpoint-router-v0 budget denial requires its exact locked ledger reason",
            path: ["triggerFacts"],
          });
        }
        if (decision.billing === undefined) {
          context.addIssue({
            code: "custom",
            message: "budget_denial requires an exact billing projection",
            path: ["billing"],
          });
        } else if (
          budgetDenialReason !== "campaign_overrun" &&
          decision.billing.projectedCostMicrousd <=
            decision.billing.remainingEpisodeMicrousd &&
          decision.billing.projectedCostMicrousd <=
            decision.billing.remainingCampaignMicrousd
        ) {
          context.addIssue({
            code: "custom",
            message:
              "budget_denial requires projected cost to exceed a remaining budget unless a prior campaign overrun disabled admission",
            path: ["billing", "projectedCostMicrousd"],
          });
        }
      }
    }
    if (
      decision.billing !== undefined &&
      decision.admission.budget.status === "passed" &&
      (decision.billing.projectedCostMicrousd >
        decision.billing.remainingEpisodeMicrousd ||
        decision.billing.projectedCostMicrousd >
          decision.billing.remainingCampaignMicrousd)
    ) {
      context.addIssue({
        code: "custom",
        message: "a passed budget check cannot exceed a remaining budget",
        path: ["billing", "projectedCostMicrousd"],
      });
    }
    if (
      decision.reasonCode !== "cloud_admitted" &&
      !isCloudProposalDenial
    ) {
      const forbiddenPaidFields: Array<[keyof typeof decision, unknown]> = [
        ["pricingSnapshotId", decision.pricingSnapshotId],
        ["campaignId", decision.campaignId],
        ["budgetReservationId", decision.budgetReservationId],
        ["credentialMetadataId", decision.credentialMetadataId],
        ["billing", decision.billing],
        ["checkpointId", decision.checkpointId],
        ["packetSha256", decision.packetSha256],
        ["messagesSha256", decision.messagesSha256],
        ["proposedProviderId", decision.proposedProviderId],
        ["proposedModel", decision.proposedModel],
        ["proposalCheckpointId", decision.proposalCheckpointId],
        ["proposalPacketSha256", decision.proposalPacketSha256],
        ["proposalMessagesSha256", decision.proposalMessagesSha256],
      ];
      for (const [field, value] of forbiddenPaidFields) {
        if (value !== undefined) {
          context.addIssue({
            code: "custom",
            message: `${String(field)} is reserved for cloud admission or proposal decisions`,
            path: [field],
          });
        }
      }
    }
    if (isCloudProposalDenial) {
      const forbiddenSelectedCloudFields: Array<[
        keyof typeof decision,
        unknown,
      ]> = [
        ["checkpointId", decision.checkpointId],
        ["packetSha256", decision.packetSha256],
        ["messagesSha256", decision.messagesSha256],
      ];
      for (const [field, value] of forbiddenSelectedCloudFields) {
        if (value !== undefined) {
          context.addIssue({
            code: "custom",
            message: `${String(field)} is reserved for the admitted selected attempt`,
            path: [field],
          });
        }
      }
    }
    const denialCheckByReason = {
      disabled_provider: undefined,
      missing_credential: "credential",
      unhealthy_provider: "health",
      pricing_denial: "pricing",
      capability_mismatch: "capability",
      egress_denial: "egress",
      budget_denial: "budget",
      deadline_denial: "deadline",
    } as const;
    if (decision.reasonCode in denialCheckByReason) {
      const checkName =
        denialCheckByReason[
          decision.reasonCode as keyof typeof denialCheckByReason
        ];
      if (
        checkName !== undefined &&
        decision.admission[checkName]?.status !== "denied"
      ) {
        context.addIssue({
          code: "custom",
          message: `${decision.reasonCode} requires a denied ${checkName} admission check`,
          path: ["admission", checkName, "status"],
        });
      }
    }
  });

export type RoutingDecisionPayload = z.infer<
  typeof RoutingDecisionPayloadSchema
>;

export const INFERENCE_ATTEMPT_OUTCOMES = [
  "succeeded",
  "provider_error",
  "protocol_error",
  "cancelled",
  "timeout",
  "interrupted",
] as const;
export const InferenceAttemptOutcomeSchema = z.enum(
  INFERENCE_ATTEMPT_OUTCOMES,
);
export type InferenceAttemptOutcome = z.infer<
  typeof InferenceAttemptOutcomeSchema
>;

export const REQUEST_DISPOSITIONS = ["not_sent", "sent", "unknown"] as const;
export const RequestDispositionSchema = z.enum(REQUEST_DISPOSITIONS);
export type RequestDisposition = z.infer<typeof RequestDispositionSchema>;

const allowedToolNamesSchema = z
  .array(boundedCode)
  .max(64)
  .superRefine((names, context) => {
    for (let index = 1; index < names.length; index += 1) {
      const previous = names[index - 1];
      const current = names[index];
      if (previous !== undefined && current !== undefined && previous >= current) {
        context.addIssue({
          code: "custom",
          message: "allowed tool names must be sorted and unique",
          path: [index],
        });
      }
    }
  });

export const InferenceAttemptStartedPayloadSchema = z
  .object({
    attemptId: boundedV2Id,
    round: safePositiveInteger,
    checkpointId: boundedV2Id,
    messageId: boundedV2Id,
    decisionId: boundedV2Id,
    leaseId: boundedV2Id,
    providerId: boundedV2Id,
    requestedModel: boundedV2Id,
    phase: RoutingPhaseSchema,
    requestedMaxOutputTokens: safePositiveInteger,
    allowTools: z.boolean(),
    allowedToolNames: allowedToolNamesSchema.optional(),
    requireToolCall: z.boolean(),
    structuredOutputContract: z
      .literal("change-review-result-v1")
      .optional(),
    structuredOutputSchemaSha256: z
      .literal(REVIEW_RESULT_V1_JSON_SCHEMA_SHA256)
      .optional(),
    budgetReservationId: boundedV2Id.optional(),
    // Optional only for replay compatibility with pre-PR6B0 attempts.
    costScope: RuntimeCostScopeSchema.optional(),
    cloudEgressAdmissionId: boundedV2Id.optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (!attempt.allowTools) {
      if (attempt.allowedToolNames !== undefined) {
        context.addIssue({
          code: "custom",
          message: "tool-free attempts cannot include allowedToolNames",
          path: ["allowedToolNames"],
        });
      }
      if (attempt.requireToolCall) {
        context.addIssue({
          code: "custom",
          message: "tool-free attempts cannot require a tool call",
          path: ["requireToolCall"],
        });
      }
    } else if ((attempt.allowedToolNames?.length ?? 0) === 0) {
      context.addIssue({
        code: "custom",
        message: "tool-enabled attempts require a non-empty allowedToolNames list",
        path: ["allowedToolNames"],
      });
    }
    if (attempt.phase === "synthesis" && attempt.allowTools) {
      context.addIssue({
        code: "custom",
        message: "synthesis attempts are tool-free",
        path: ["allowTools"],
      });
    }
    const hasStructuredContract =
      attempt.structuredOutputContract !== undefined;
    const hasStructuredHash =
      attempt.structuredOutputSchemaSha256 !== undefined;
    if (hasStructuredContract !== hasStructuredHash) {
      context.addIssue({
        code: "custom",
        message:
          "structured output contract and schema hash must be persisted together",
        path: ["structuredOutputContract"],
      });
    }
    if (
      hasStructuredContract &&
      (attempt.phase !== "synthesis" || attempt.allowTools)
    ) {
      context.addIssue({
        code: "custom",
        message: "structured output is limited to tool-free synthesis attempts",
        path: ["structuredOutputContract"],
      });
    }
  });

export type InferenceAttemptStartedPayload = z.infer<
  typeof InferenceAttemptStartedPayloadSchema
>;

export const InferenceAttemptFinishedPayloadSchema = z
  .object({
    attemptId: boundedV2Id,
    checkpointId: boundedV2Id,
    outcome: InferenceAttemptOutcomeSchema,
    requestDisposition: RequestDispositionSchema,
    finishReason: z.string().trim().min(1).max(256).nullable().optional(),
    servedModel: boundedV2Id.optional(),
    usage: z
      .object({
        inputTokens: safeNonNegativeInteger,
        outputTokens: safeNonNegativeInteger,
        reasoningTokens: safeNonNegativeInteger,
        cacheReadTokens: safeNonNegativeInteger.optional(),
        reported: z.boolean(),
      })
      .strict(),
    cost: z
      .object({
        amountMicrousd: safeNonNegativeInteger,
        provenance: z.enum([
          "local_zero_cost_policy",
          "provider_reported",
          "host_pricing_snapshot",
          "reserved_unknown",
        ]),
        reservationId: boundedV2Id.optional(),
        // Optional only for replay compatibility with pre-PR6B0 finishes.
        costScope: RuntimeCostScopeSchema.optional(),
      })
      .strict(),
    latencyMs: nonNegativeNumber,
    ttftMs: nonNegativeNumber.optional(),
    errorCode: boundedCode.optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.ttftMs !== undefined && attempt.ttftMs > attempt.latencyMs) {
      context.addIssue({
        code: "custom",
        message: "ttftMs must not exceed latencyMs",
        path: ["ttftMs"],
      });
    }
    if (attempt.outcome === "succeeded") {
      if (attempt.requestDisposition !== "sent") {
        context.addIssue({
          code: "custom",
          message: "successful attempts require requestDisposition sent",
          path: ["requestDisposition"],
        });
      }
      if (attempt.servedModel === undefined) {
        context.addIssue({
          code: "custom",
          message: "successful attempts require servedModel",
          path: ["servedModel"],
        });
      }
      if (attempt.errorCode !== undefined) {
        context.addIssue({
          code: "custom",
          message: "successful attempts cannot include errorCode",
          path: ["errorCode"],
        });
      }
    } else if (attempt.errorCode === undefined) {
      context.addIssue({
        code: "custom",
        message: "unsuccessful attempts require errorCode",
        path: ["errorCode"],
      });
    }
    if (
      attempt.requestDisposition === "not_sent" &&
      (attempt.usage.inputTokens !== 0 ||
        attempt.usage.outputTokens !== 0 ||
        attempt.usage.reasoningTokens !== 0 ||
        (attempt.usage.cacheReadTokens ?? 0) !== 0 ||
        attempt.cost.amountMicrousd !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "not_sent attempts must record zero usage and cost",
        path: ["requestDisposition"],
      });
    }
    if (
      attempt.cost.provenance === "local_zero_cost_policy" &&
      attempt.cost.amountMicrousd !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "local zero-cost policy must record zero micro-USD",
        path: ["cost", "amountMicrousd"],
      });
    }
    if (
      attempt.cost.provenance === "reserved_unknown" &&
      (attempt.cost.reservationId === undefined ||
        attempt.requestDisposition === "not_sent")
    ) {
      context.addIssue({
        code: "custom",
        message: "reserved_unknown requires a sent or unknown reserved request",
        path: ["cost", "reservationId"],
      });
    }
  });

export type InferenceAttemptFinishedPayload = z.infer<
  typeof InferenceAttemptFinishedPayloadSchema
>;

const sessionCreatedSchema = z
  .object({
    type: z.literal("session.created"),
    payload: z
      .object({
        title: z.string().trim().min(1),
        objective: z.string().trim().min(1),
        workspaceRoot: z.string().trim().min(1),
        profile: OptimizationProfileSchema.default("balanced"),
        taskTrack: AppTaskTrackSchema.optional(),
        completionObligations: CompletionObligationsSchema.optional(),
        executionPolicy: AgenticExecutionPolicySchema.optional(),
        hybridSimulation: HybridSimulationSessionAuthorityV1Schema.optional(),
      })
      .strict()
      .superRefine((payload, context) => {
        const obligations = payload.completionObligations;
        const active =
          obligations !== undefined &&
          (obligations.requiredSuccessfulTools.length > 0 ||
            obligations.minimumVerifiedPathLineCitations > 0);
        if (active && payload.executionPolicy === undefined) {
          context.addIssue({
            code: "custom",
            message:
              "active completion obligations require agentic-execution-v1 policy",
            path: ["executionPolicy"],
          });
        }
        if (active && payload.executionPolicy !== undefined) {
          const minimumToolRounds = Math.max(
            obligations?.requiredSuccessfulTools.length ?? 0,
            (obligations?.minimumVerifiedPathLineCitations ?? 0) > 0 ? 1 : 0,
          );
          if (payload.executionPolicy.toolCalls < minimumToolRounds) {
            context.addIssue({
              code: "custom",
              message:
                "execution policy needs enough tool calls for the completion obligations",
              path: ["executionPolicy", "toolCalls"],
            });
          }
          if (
            payload.executionPolicy.inferenceRounds <
            minimumToolRounds + 1
          ) {
            context.addIssue({
              code: "custom",
              message:
                "execution policy needs one inference round per required tool plus final synthesis",
              path: ["executionPolicy", "inferenceRounds"],
            });
          }
        }
        if (payload.taskTrack === "change-review-v1") {
          const policy = payload.executionPolicy;
          const allowedChangeReviewPolicy =
            policy?.schemaVersion === "agentic-execution-v2" &&
            policy.egressConsent === "none" &&
            (policy.routingPolicy === "local_only_v1" ||
              policy.routingPolicy === HYBRID_SIMULATION_ROUTING_POLICY_ID);
          if (!allowedChangeReviewPolicy) {
            context.addIssue({
              code: "custom",
              message:
                "change-review-v1 requires an approved Local or Hybrid simulation v2 policy with no real egress consent",
              path: ["executionPolicy"],
            });
          }
          if (
            JSON.stringify(obligations?.requiredSuccessfulTools) !==
              JSON.stringify(["inspect_git_changes"]) ||
            obligations?.minimumVerifiedPathLineCitations !== 0
          ) {
            context.addIssue({
              code: "custom",
              message:
                "change-review-v1 starts with the host-enforced inspect_git_changes obligation",
              path: ["completionObligations"],
            });
          }
        }
        const isHybridSimulation =
          payload.executionPolicy?.schemaVersion === "agentic-execution-v2" &&
          payload.executionPolicy.routingPolicy ===
            HYBRID_SIMULATION_ROUTING_POLICY_ID;
        if (isHybridSimulation !== (payload.hybridSimulation !== undefined)) {
          context.addIssue({
            code: "custom",
            message:
              "hybrid simulation policy and authority snapshot must be persisted together",
            path: ["hybridSimulation"],
          });
        }
        if (isHybridSimulation && payload.taskTrack !== "change-review-v1") {
          context.addIssue({
            code: "custom",
            message:
              "hybrid_simulation_v1 is restricted to change-review-v1 sessions",
            path: ["taskTrack"],
          });
        }
      }),
  })
  .strict();

const sessionStartedSchema = z
  .object({
    type: z.literal("session.started"),
    payload: z
      .object({
        startedAt: z.string().datetime({ offset: true }).optional(),
        deadlineAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict()
      .superRefine((payload, context) => {
        if ((payload.startedAt === undefined) !== (payload.deadlineAt === undefined)) {
          context.addIssue({
            code: "custom",
            message: "startedAt and deadlineAt must be provided together",
          });
          return;
        }
        if (
          payload.startedAt !== undefined &&
          payload.deadlineAt !== undefined &&
          Date.parse(payload.deadlineAt) <= Date.parse(payload.startedAt)
        ) {
          context.addIssue({
            code: "custom",
            message: "deadlineAt must be later than startedAt",
            path: ["deadlineAt"],
          });
        }
      }),
  })
  .strict();

const userMessageSchema = z
  .object({
    type: z.literal("user.message"),
    payload: z
      .object({
        messageId: requiredId,
        content: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const cloudEgressAdmissionRecordedSchema = z
  .object({
    type: z.literal("cloud.egress.admission.recorded"),
    payload: CloudEgressAdmissionRecordV1Schema,
  })
  .strict();

const routingDecisionRecordedSchema = z
  .object({
    type: z.literal("routing.decision.recorded"),
    payload: RoutingDecisionPayloadSchema,
  })
  .strict();

const routeAssignedSchema = z
  .object({
    type: z.literal("route.assigned"),
    payload: z
      .object({
        providerId: requiredId,
        model: requiredId,
        reason: z.string().trim().min(1),
        leaseId: requiredId.optional(),
        decisionId: requiredId.optional(),
        phase: RoutingPhaseSchema.optional(),
      })
      .strict(),
  })
  .strict();

const assistantMessageStartedSchema = z
  .object({
    type: z.literal("assistant.message.started"),
    payload: z
      .object({
        messageId: requiredId,
        providerId: requiredId,
        model: requiredId,
        decisionId: requiredId.optional(),
        leaseId: requiredId.optional(),
        checkpointId: requiredId.optional(),
        attemptId: requiredId.optional(),
      })
      .strict(),
  })
  .strict();

const assistantMessageDeltaSchema = z
  .object({
    type: z.literal("assistant.message.delta"),
    payload: z
      .object({
        messageId: requiredId,
        delta: z.string(),
      })
      .strict(),
  })
  .strict();

const assistantMessageCompletedSchema = z
  .object({
    type: z.literal("assistant.message.completed"),
    payload: z
      .object({
        messageId: requiredId,
        content: z.string().optional(),
        stopReason: z.string().trim().min(1).nullable().optional(),
        completionState: AssistantCompletionStateSchema.optional(),
        citationCorrections: z.array(CitationCorrectionSchema).optional(),
        reviewParseStatus: z
          .enum([
            "accepted",
            "invalid_json",
            "schema_invalid",
            "semantic_invalid",
            "snapshot_stale",
            "not_received",
          ])
          .optional(),
        reviewResult: ReviewResultV1Schema.optional(),
        reviewCoverage: ReviewCoverageV1Schema.optional(),
        attemptId: requiredId.optional(),
      })
      .strict()
      .superRefine((payload, context) => {
        const accepted = payload.reviewParseStatus === "accepted";
        const hasResult = payload.reviewResult !== undefined;
        const hasCoverage = payload.reviewCoverage !== undefined;
        if (hasResult !== hasCoverage || accepted !== (hasResult && hasCoverage)) {
          context.addIssue({
            code: "custom",
            message:
              "accepted review completion requires both the review result and host-derived coverage",
            path: ["reviewParseStatus"],
          });
        }
        if (
          payload.reviewParseStatus !== undefined &&
          payload.completionState !== (accepted ? "complete" : "incomplete")
        ) {
          context.addIssue({
            code: "custom",
            message:
              "review parse status must agree with the assistant completion state",
            path: ["completionState"],
          });
        }
      }),
  })
  .strict();

const toolCallRequestedSchema = z
  .object({
    type: z.literal("tool.call.requested"),
    payload: z
      .object({
        toolCallId: requiredId,
        name: requiredId,
        arguments: JsonValueSchema,
        messageId: requiredId.optional(),
      })
      .strict(),
  })
  .strict();

const toolCallCompletedSchema = z
  .object({
    type: z.literal("tool.call.completed"),
    payload: z
      .object({
        toolCallId: requiredId,
        name: requiredId,
        content: z.string(),
        isError: z.boolean().default(false),
        durationMs: nonNegativeNumber.optional(),
      })
      .strict(),
  })
  .strict();

const contextCompiledSchema = z
  .object({
    type: z.literal("context.compiled"),
    payload: z
      .object({
        checkpointId: requiredId,
        compilerVersion: z.enum([
          "context-compiler-v1",
          "review-context-compiler-v1",
        ]),
        reason: ContextCompilationReasonSchema,
        mode: ContextCompilationModeSchema,
        providerId: requiredId,
        model: requiredId,
        maxTokens: safePositiveInteger,
        estimatedTokens: safeNonNegativeInteger,
        estimator: z.literal("utf8-bytes-v1"),
        reservedInputTokens: safeNonNegativeInteger,
        effectiveInputTokenBudget: safeNonNegativeInteger,
        sourceMessageCount: safeNonNegativeInteger,
        messageCount: safeNonNegativeInteger,
        evidenceCount: safeNonNegativeInteger,
        deduplicatedEvidenceCount: safeNonNegativeInteger,
        omittedEvidenceCount: safeNonNegativeInteger,
        packetSha256: z.string().regex(/^[a-f0-9]{64}$/),
        messagesSha256: z.string().regex(/^[a-f0-9]{64}$/),
        safetyMargin: z.number().finite().min(0).lt(1),
        decisionId: requiredId.optional(),
        leaseId: requiredId.optional(),
        messageId: requiredId.optional(),
        attemptId: requiredId.optional(),
        reviewSnapshotId: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
        reviewEvidenceSetId: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
        reviewProvenanceSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        structuredOutputContract: z
          .literal("change-review-result-v1")
          .optional(),
        structuredOutputSchemaSha256: z
          .literal(REVIEW_RESULT_V1_JSON_SCHEMA_SHA256)
          .optional(),
      })
      .strict()
      .superRefine((payload, context) => {
        const expectedEffectiveBudget =
          payload.maxTokens -
          Math.ceil(payload.maxTokens * payload.safetyMargin) -
          payload.reservedInputTokens;
        if (
          expectedEffectiveBudget < 0 ||
          payload.effectiveInputTokenBudget !== expectedEffectiveBudget
        ) {
          context.addIssue({
            code: "custom",
            message:
              "effectiveInputTokenBudget must equal maxTokens minus the safety margin and reservedInputTokens",
            path: ["effectiveInputTokenBudget"],
          });
        }
        if (payload.estimatedTokens > payload.effectiveInputTokenBudget) {
          context.addIssue({
            code: "custom",
            message:
              "estimatedTokens must not exceed effectiveInputTokenBudget",
            path: ["estimatedTokens"],
          });
        }
        const reviewFields = [
          payload.reviewSnapshotId,
          payload.reviewEvidenceSetId,
          payload.reviewProvenanceSha256,
          payload.structuredOutputContract,
          payload.structuredOutputSchemaSha256,
        ];
        const presentReviewFields = reviewFields.filter(
          (value) => value !== undefined,
        ).length;
        if (
          payload.compilerVersion === "review-context-compiler-v1" &&
          presentReviewFields !== reviewFields.length
        ) {
          context.addIssue({
            code: "custom",
            message:
              "review context checkpoints require snapshot, evidence, provenance, and schema identities",
            path: ["compilerVersion"],
          });
        }
        if (
          payload.compilerVersion === "context-compiler-v1" &&
          presentReviewFields !== 0
        ) {
          context.addIssue({
            code: "custom",
            message:
              "generic context checkpoints cannot carry review packet identities",
            path: ["compilerVersion"],
          });
        }
      }),
  })
  .strict();

const inferenceAttemptStartedSchema = z
  .object({
    type: z.literal("inference.attempt.started"),
    payload: InferenceAttemptStartedPayloadSchema,
  })
  .strict();

const inferenceAttemptFinishedSchema = z
  .object({
    type: z.literal("inference.attempt.finished"),
    payload: InferenceAttemptFinishedPayloadSchema,
  })
  .strict();

const verifiedPathLineCitationSchema = z
  .string()
  .min(3)
  .max(4_096)
  .regex(/^[^\r\n]+:[1-9][0-9]*$/u);

const canonicalVerifiedCitationListSchema = z
  .array(verifiedPathLineCitationSchema)
  .max(maximumVerifiedPathLineCitations)
  .superRefine((citations, context) => {
    for (let index = 1; index < citations.length; index += 1) {
      const previous = citations[index - 1];
      const current = citations[index];
      if (previous !== undefined && current !== undefined && previous >= current) {
        context.addIssue({
          code: "custom",
          message: "verified path-line citations must be sorted and unique",
          path: [index],
        });
      }
    }
  });

export const CompletionObligationCheckPayloadSchema = z
  .object({
    checkId: requiredId,
    messageId: requiredId,
    round: safePositiveInteger,
    remainingRounds: safeNonNegativeInteger,
    successfulRequiredTools: orderedRequiredToolsSchema,
    missingRequiredTools: orderedRequiredToolsSchema,
    verifiedPathLineCitations: canonicalVerifiedCitationListSchema,
    unresolvedCitationCount: safeNonNegativeInteger,
    outcome: CompletionObligationOutcomeSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.outcome === "accepted" &&
      (payload.missingRequiredTools.length > 0 ||
        payload.unresolvedCitationCount > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "accepted obligation checks cannot have missing tools or unresolved citations",
        path: ["outcome"],
      });
    }
    if (payload.outcome === "retry" && payload.remainingRounds === 0) {
      context.addIssue({
        code: "custom",
        message: "retry obligation checks require at least one remaining round",
        path: ["remainingRounds"],
      });
    }
    if (payload.outcome === "exhausted" && payload.remainingRounds !== 0) {
      context.addIssue({
        code: "custom",
        message: "exhausted obligation checks cannot have remaining rounds",
        path: ["remainingRounds"],
      });
    }
  });

export type CompletionObligationCheckPayload = z.infer<
  typeof CompletionObligationCheckPayloadSchema
>;

const completionObligationsCheckedSchema = z
  .object({
    type: z.literal("completion.obligations.checked"),
    payload: CompletionObligationCheckPayloadSchema,
  })
  .strict();

const usageRecordedSchema = z
  .object({
    type: z.literal("usage.recorded"),
    payload: z
      .object({
        inputTokens: nonNegativeInteger,
        outputTokens: nonNegativeInteger,
        reasoningTokens: nonNegativeInteger.default(0),
        reported: z.boolean().optional(),
        costUsd: nonNegativeNumber,
        costProvenance: z
          .enum(["provider_reported", "local_zero_cost_policy", "unreported"])
          .optional(),
        servedModel: requiredId.optional(),
        latencyMs: nonNegativeNumber.optional(),
        ttftMs: nonNegativeNumber.optional(),
      })
      .strict(),
  })
  .strict();

const sessionCompletedSchema = z
  .object({
    type: z.literal("session.completed"),
    payload: z
      .object({
        result: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const sessionFailedSchema = z
  .object({
    type: z.literal("session.failed"),
    payload: z
      .object({
        error: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const sessionCancelledSchema = z
  .object({
    type: z.literal("session.cancelled"),
    payload: z
      .object({
        reason: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const sessionInterruptedSchema = z
  .object({
    type: z.literal("session.interrupted"),
    payload: z
      .object({
        reason: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export const SessionEventDataSchema = z.discriminatedUnion("type", [
  sessionCreatedSchema,
  sessionStartedSchema,
  userMessageSchema,
  cloudEgressAdmissionRecordedSchema,
  routingDecisionRecordedSchema,
  routeAssignedSchema,
  assistantMessageStartedSchema,
  assistantMessageDeltaSchema,
  assistantMessageCompletedSchema,
  toolCallRequestedSchema,
  toolCallCompletedSchema,
  contextCompiledSchema,
  inferenceAttemptStartedSchema,
  inferenceAttemptFinishedSchema,
  completionObligationsCheckedSchema,
  usageRecordedSchema,
  sessionCompletedSchema,
  sessionFailedSchema,
  sessionCancelledSchema,
  sessionInterruptedSchema,
]);

export type SessionEventData = z.infer<typeof SessionEventDataSchema>;
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>;

export const StoredSessionEventSchema = z
  .object({
    id: requiredId,
    sessionId: requiredId,
    sequence: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    type: SessionEventTypeSchema,
    payload: z.record(z.string(), JsonValueSchema),
  })
  .strict();

export type StoredSessionEvent = Omit<
  z.infer<typeof StoredSessionEventSchema>,
  "type" | "payload"
> &
  SessionEventData;

export function parseSessionEventData(value: unknown): SessionEventData {
  return SessionEventDataSchema.parse(value);
}

export function parseStoredSessionEvent(value: unknown): StoredSessionEvent {
  const envelope = StoredSessionEventSchema.parse(value);
  const data = parseSessionEventData({
    type: envelope.type,
    payload: envelope.payload,
  });

  return {
    id: envelope.id,
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,
    createdAt: envelope.createdAt,
    ...data,
  };
}
