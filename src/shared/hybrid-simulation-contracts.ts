import { z } from "zod";

export const COST_SCOPES = [
  "simulation",
  "actual",
  "legacy_unclassified",
] as const;
export const CostScopeSchema = z.enum(COST_SCOPES);
export type CostScope = z.infer<typeof CostScopeSchema>;

export const RUNTIME_COST_SCOPES = ["simulation", "actual"] as const;
export const RuntimeCostScopeSchema = z.enum(RUNTIME_COST_SCOPES);
export type RuntimeCostScope = z.infer<typeof RuntimeCostScopeSchema>;

export const HYBRID_SIMULATION_ROUTE = "hybrid_simulation" as const;
export const HYBRID_SIMULATION_ROUTING_POLICY_ID =
  "hybrid_simulation_v1" as const;
export const HYBRID_SIMULATION_CONSENT_ID =
  "simulation_cloud_synthesis_v1" as const;
export const HYBRID_SIMULATION_DISCLOSURE_VERSION =
  "hybrid-simulation-disclosure-v1" as const;
export const HYBRID_SIMULATION_MAX_SPEND_MICROUSD = 250_000 as const;
/** Fixed synthetic authority epoch; never derived from a session wall clock. */
export const HYBRID_SIMULATION_CAMPAIGN_CREATED_AT =
  "2026-09-01T00:00:00.000Z" as const;
export const HYBRID_SIMULATION_RESULT_MARKER =
  "Simulation only — fake models; no external provider contacted; not a real review." as const;

export const HYBRID_SIMULATION_DISCLOSURE_TEXT = [
  "Hybrid simulation never contacts an external provider, and no content leaves this machine. It may simulate one fake cloud synthesis attempt.",
  "A future real Hybrid request would include task instructions, bounded repository excerpts, and relative paths; tools and tool definitions are excluded.",
  "The bounded egress guard denies canonical workspace or user-home roots, explicitly supplied sensitive values, recognized token or private-key forms, denied paths or artifacts, and known provenance gaps. This guard is bounded policy defense, not general data-loss prevention, and cannot recognize every credential or absolute-path representation.",
  "The $0.25 maximum is a simulated reservation, not a charge. Denial or one eligible fake-cloud failure may continue with one Local fallback; cancellation creates no fallback.",
].join("\n\n");
export const HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256 =
  "380f45647cc954c1d582d74f37fb64ad6423681cac4044db728b7e4f68b676e1" as const;

const boundedId = z.string().trim().min(1).max(256);
const boundedCode = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const HybridSimulationProviderIdentityV1Schema = z
  .object({
    providerId: boundedId,
    model: boundedId,
  })
  .strict();
export type HybridSimulationProviderIdentityV1 = z.infer<
  typeof HybridSimulationProviderIdentityV1Schema
>;

/**
 * Durable, host-owned simulation authority. It contains no credential, endpoint,
 * workspace path, disclosure acknowledgement ID, or provider request content.
 */
export const HybridSimulationSessionAuthorityV1Schema = z
  .object({
    schemaVersion: z.literal("hybrid-simulation-session-authority-v1"),
    simulationAuthorityId: boundedCode,
    disclosureVersion: z.literal(HYBRID_SIMULATION_DISCLOSURE_VERSION),
    disclosureTextSha256: z.literal(
      HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    ),
    route: z.literal(HYBRID_SIMULATION_ROUTE),
    resultMarker: z.literal(HYBRID_SIMULATION_RESULT_MARKER),
    costScope: z.literal("simulation"),
    simulationConsent: z.literal(HYBRID_SIMULATION_CONSENT_ID),
    egressConsent: z.literal("none"),
    maxSimulatedSpendMicrousd: z.literal(
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    ),
    fakeLocalProvider: HybridSimulationProviderIdentityV1Schema,
    fakeCloudProvider: HybridSimulationProviderIdentityV1Schema,
    riskPolicyId: boundedCode,
    routerPolicyVersion: z.literal("hybrid-lease-router-v0"),
    healthSnapshotId: boundedId,
    pricingSnapshotId: boundedId,
    credentialMetadataId: boundedId,
    campaignId: boundedId,
    campaignCreatedAt: z.literal(HYBRID_SIMULATION_CAMPAIGN_CREATED_AT),
  })
  .strict()
  .superRefine((authority, context) => {
    if (
      authority.fakeLocalProvider.providerId ===
      authority.fakeCloudProvider.providerId
    ) {
      context.addIssue({
        code: "custom",
        message: "fake Local and fake cloud provider IDs must be distinct",
        path: ["fakeCloudProvider", "providerId"],
      });
    }
  });
export type HybridSimulationSessionAuthorityV1 = z.infer<
  typeof HybridSimulationSessionAuthorityV1Schema
>;

/** Renderer-safe challenge. Canonical workspace and runtime authority stay main-only. */
export const HybridSimulationConsentChallengeV1Schema = z
  .object({
    schemaVersion: z.literal("hybrid-simulation-consent-challenge-v1"),
    challengeId: boundedId,
    expiresAt: z.string().datetime({ offset: true }),
    disclosureText: z.literal(HYBRID_SIMULATION_DISCLOSURE_TEXT),
    disclosureVersion: z.literal(HYBRID_SIMULATION_DISCLOSURE_VERSION),
    disclosureTextSha256: z.literal(
      HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    ),
    route: z.literal(HYBRID_SIMULATION_ROUTE),
    maxSimulatedSpendMicrousd: z.literal(
      HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    ),
  })
  .strict();
export type HybridSimulationConsentChallengeV1 = z.infer<
  typeof HybridSimulationConsentChallengeV1Schema
>;

export const HybridSimulationConsentAcknowledgementV1Schema = z
  .object({
    challengeId: boundedId,
    acknowledged: z.literal(true),
    canonicalWorkspaceIdentity: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes("\0"), "workspace identity contains NUL"),
    route: z.literal(HYBRID_SIMULATION_ROUTE),
  })
  .strict();
export type HybridSimulationConsentAcknowledgementV1 = z.infer<
  typeof HybridSimulationConsentAcknowledgementV1Schema
>;

export interface ConsumedHybridSimulationConsentV1 {
  schemaVersion: "consumed-hybrid-simulation-consent-v1";
  canonicalWorkspaceIdentity: string;
  authority: HybridSimulationSessionAuthorityV1;
}
