import {
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_ROUTING_POLICY_ID,
  type ConsumedHybridSimulationConsentV1,
} from "../shared/hybrid-simulation-contracts";
import type { SessionRunner } from "./agent/run-session";
import { BudgetLedger } from "./budget-ledger";
import type { SoarConfig } from "./config";
import { EventStore, type SessionRecord } from "./event-store";

const REVIEW_OBJECTIVE =
  "Review the current Git working-tree changes. Identify concrete defects or bounded risks, cite only host-verified evidence, and state any incomplete coverage.";

export interface StartHybridChangeReviewSessionOptions {
  store: EventStore;
  runner: Pick<
    SessionRunner,
    "getLocalReviewProviderDescriptor" | "startSession"
  >;
  config: Pick<
    SoarConfig,
    "hybridSimulationEnabled" | "limits" | "providerMode" | "vllm"
  >;
  workspaceRoot: string;
  consumedConsent: ConsumedHybridSimulationConsentV1;
}

export interface StartedHybridChangeReviewSession {
  session: SessionRecord;
  completion: Promise<void>;
}

/**
 * Create the fixed fake-provider Hybrid simulation session after main has
 * consumed a matching one-use consent challenge.
 */
export function startHybridChangeReviewSession({
  store,
  runner,
  config,
  workspaceRoot,
  consumedConsent,
}: StartHybridChangeReviewSessionOptions): StartedHybridChangeReviewSession {
  if (
    config.providerMode !== "fake" ||
    !config.hybridSimulationEnabled ||
    runner.getLocalReviewProviderDescriptor() === undefined ||
    config.limits.inferenceRounds < 2 ||
    config.limits.toolCalls < 1
  ) {
    throw new Error("Hybrid simulation is not available in this app runtime.");
  }
  if (consumedConsent.canonicalWorkspaceIdentity !== workspaceRoot) {
    throw new Error("Hybrid simulation consent does not match this workspace.");
  }
  const authority = consumedConsent.authority;

  // Invalid, stale, mismatched, or replayed challenges never reach this point.
  // The fixed campaign is idempotent across restart and refuses any authority
  // drift before a session or provider attempt exists.
  new BudgetLedger(store).ensureCampaign({
    id: authority.campaignId,
    providerId: authority.fakeCloudProvider.providerId,
    credentialMetadataId: authority.credentialMetadataId,
    openingExposureMicrousd: 0,
    automaticStopMicrousd: authority.maxSimulatedSpendMicrousd,
    hardCeilingMicrousd: authority.maxSimulatedSpendMicrousd,
    costScope: "simulation",
    createdAt: authority.campaignCreatedAt,
  });

  const session = store.createSession({
    title: "Review current changes — Hybrid simulation",
    objective: REVIEW_OBJECTIVE,
    workspaceRoot,
    profile: "balanced",
    taskTrack: "change-review-v1",
    completionObligations: {
      requiredSuccessfulTools: ["inspect_git_changes"],
      minimumVerifiedPathLineCitations: 0,
    },
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      inferenceRounds: config.limits.inferenceRounds,
      toolCalls: config.limits.toolCalls,
      routingPolicy: HYBRID_SIMULATION_ROUTING_POLICY_ID,
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
      maxEpisodeDurationMs: 900_000,
      attemptTimeoutMs: Math.min(config.vllm.timeoutMs, 900_000),
      egressConsent: "none",
      simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    },
    hybridSimulation: authority,
  });
  const completion = runner.startSession(session.id);
  return { session, completion };
}
