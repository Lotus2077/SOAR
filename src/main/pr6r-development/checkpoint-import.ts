import {
  AgenticExecutionPolicyV2Schema,
  SynthesisCheckpointImportedPayloadSchema,
  type AgenticExecutionPolicyV2,
  type CompletionObligationToolName,
} from "../../shared/session-events";
import type { SynthesisCheckpointImportRecord } from "../../shared/session-reducer";
import type {
  HybridSimulationSessionAuthorityV1,
} from "../../shared/hybrid-simulation-contracts";
import { HybridSimulationSessionAuthorityV1Schema } from "../../shared/hybrid-simulation-contracts";
import {
  CloudApplicationRequestV1Schema,
  PR6R_CAMPAIGN_ID,
  PR6R_MODEL_SLUG,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  Pr6rCommonCheckpointV1Schema,
  Pr6rCommonInvestigationV1Schema,
  Pr6rSemanticMessagesV1Schema,
  buildPr6rCommonCheckpointV1,
  canonicalPr6rJsonV1,
  type Pr6rCommonCheckpointV1,
  type Pr6rCommonInvestigationV1,
} from "../../shared/pr6r-development-contracts";
import { ReviewSynthesisPacketV1Schema } from "../../shared/review-synthesis-packet";
import { EventStore } from "../event-store";
import { deriveVerifiedReviewEvidenceV1 } from "../review-event-provenance";

export class Pr6rCheckpointImportError extends Error {
  readonly code = "PR6R_CHECKPOINT_IMPORT_INVALID";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Pr6rCheckpointImportError";
  }
}

export interface Pr6rCheckpointImportCapability {
  readonly kind: "pr6r_checkpoint_import_capability";
  readonly parentSessionId: string;
  readonly parentLastSequence: number;
  readonly childSessionId: string;
  readonly importId: string;
}

interface CheckpointImportPrivateState {
  store: EventStore;
  consumed: boolean;
  parentSessionId: string;
  parentLastSequence: number;
  parentTitle: string;
  parentObjective: string;
  parentWorkspaceRoot: string;
  parentProfile: "quality" | "balanced" | "economy" | "fast";
  completedRequiredToolNames: CompletionObligationToolName[];
  commonInvestigation: Pr6rCommonInvestigationV1;
  commonCheckpoint: Pr6rCommonCheckpointV1;
  reviewSnapshotId: string;
  reviewEvidenceSetId: string;
  reviewProvenanceSha256: string;
  childSessionId: string;
  importId: string;
  retainedLocalLeaseId: string;
  localProviderId: string;
  localModel: string;
}

const checkpointImportPrivateState = new WeakMap<
  Pr6rCheckpointImportCapability,
  CheckpointImportPrivateState
>();

export interface MintPr6rCheckpointImportCapabilityInput {
  store: EventStore;
  parentLastSequence: number;
  commonInvestigation: unknown;
  commonCheckpoint: unknown;
  packetUtf8: string;
  semanticMessages: unknown;
  target: {
    childSessionId: string;
    importId: string;
    retainedLocalLeaseId: string;
  };
}

function fail(message: string, cause?: unknown): never {
  throw new Pr6rCheckpointImportError(
    message,
    cause === undefined ? undefined : { cause },
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalPr6rJsonV1(left) === canonicalPr6rJsonV1(right);
}

/**
 * Mint a target-bound import capability from exact canonical parent replay.
 * Raw packet and semantic messages are validated here and are never retained.
 */
export function mintPr6rCheckpointImportCapability(
  input: MintPr6rCheckpointImportCapabilityInput,
): Pr6rCheckpointImportCapability {
  try {
    const commonCheckpoint = Pr6rCommonCheckpointV1Schema.parse(
      input.commonCheckpoint,
    );
    const commonInvestigation = Pr6rCommonInvestigationV1Schema.parse(
      input.commonInvestigation,
    );
    const semanticMessages = Pr6rSemanticMessagesV1Schema.parse(
      input.semanticMessages,
    );
    const parentEvents = input.store.getEvents(commonCheckpoint.parentSessionId);
    const parent = input.store.replay(commonCheckpoint.parentSessionId);
    if (
      !Number.isSafeInteger(input.parentLastSequence) ||
      input.parentLastSequence <= 0 ||
      parent.lastSequence !== input.parentLastSequence ||
      parentEvents.at(-1)?.sequence !== input.parentLastSequence
    ) {
      fail("Parent replay does not match the bound last sequence.");
    }
    if (
      parent.status !== "running" ||
      parent.taskTrack !== "change-review-v1" ||
      parent.executionPolicy?.schemaVersion !== "agentic-execution-v2" ||
      parent.inferenceAttempts.some((attempt) => attempt.finished === undefined) ||
      parent.messages.some((message) => message.status === "streaming")
    ) {
      fail("Parent is not a completed, replay-valid investigation boundary.");
    }
    if (
      commonInvestigation.parentSessionId !== parent.id ||
      commonInvestigation.commonCheckpointSha256 !==
        commonCheckpoint.checkpointSha256
    ) {
      fail("Common investigation does not bind the replayed parent checkpoint.");
    }
    if (
      input.target.childSessionId === parent.id ||
      input.target.childSessionId.trim().length === 0 ||
      input.target.childSessionId.length > 256 ||
      input.target.importId.trim().length === 0 ||
      input.target.importId.length > 256 ||
      input.target.retainedLocalLeaseId.trim().length === 0 ||
      input.target.retainedLocalLeaseId.length > 256
    ) {
      fail("Checkpoint import target contains an invalid or transplanted identity.");
    }
    const activeRoute = parent.routes.at(-1);
    if (
      activeRoute?.leaseId !== input.target.retainedLocalLeaseId ||
      activeRoute.phase !== "investigation"
    ) {
      fail("Checkpoint import must inherit the parent's active Local lease.");
    }

    const packetUnknown = JSON.parse(input.packetUtf8) as unknown;
    const packet = ReviewSynthesisPacketV1Schema.parse(packetUnknown);
    if (canonicalPr6rJsonV1(packet) !== input.packetUtf8) {
      fail("Checkpoint packet is not canonical PR6R JSON.");
    }
    const verified = deriveVerifiedReviewEvidenceV1(parentEvents);
    if (
      packet.objective !== parent.objective ||
      packet.snapshot.snapshotId !== commonCheckpoint.snapshotId ||
      !exactJson(packet.snapshot, verified.snapshot) ||
      !exactJson(packet.evidenceSet, verified.evidenceSet) ||
      !exactJson(packet.evidenceBodies, verified.evidenceBodies) ||
      packet.provenanceSha256 !== verified.provenance.provenanceSha256
    ) {
      fail("Checkpoint packet does not match evidence derived from the parent replay.");
    }
    const rebuiltCheckpoint = buildPr6rCommonCheckpointV1({
      parentSessionId: parent.id,
      packetUtf8: input.packetUtf8,
      semanticMessages,
    });
    if (!exactJson(rebuiltCheckpoint, commonCheckpoint)) {
      fail("Common checkpoint does not match the supplied packet and messages.");
    }
    if (
      commonInvestigation.toolCallCount !==
      verified.provenance.toolResults.length
    ) {
      fail("Common investigation tool count does not match parent evidence.");
    }
    const successfulInvestigationAttempts = new Set(
      parent.inferenceAttempts
        .filter(
          (attempt) =>
            attempt.phase === "investigation" &&
            attempt.finished?.outcome === "succeeded",
        )
        .map((attempt) => attempt.attemptId),
    );
    if (successfulInvestigationAttempts.size === 0) {
      fail("Parent has no successful investigation attempt.");
    }
    const completedToolNames = new Set<string>(
      verified.provenance.toolResults
        .filter((tool) => successfulInvestigationAttempts.has(tool.attemptId))
        .map((tool) => tool.toolName),
    );
    const completedRequiredToolNames = [
      ...parent.completionObligations.requiredSuccessfulTools,
    ]
      .filter((toolName) => completedToolNames.has(toolName))
      .sort();
    if (
      completedRequiredToolNames.length !==
      parent.completionObligations.requiredSuccessfulTools.length
    ) {
      fail("Parent has not completed every required investigation tool.");
    }

    const capability = Object.freeze({
      kind: "pr6r_checkpoint_import_capability" as const,
      parentSessionId: parent.id,
      parentLastSequence: parent.lastSequence,
      childSessionId: input.target.childSessionId,
      importId: input.target.importId,
    });
    checkpointImportPrivateState.set(capability, {
      store: input.store,
      consumed: false,
      parentSessionId: parent.id,
      parentLastSequence: parent.lastSequence,
      parentTitle: parent.title,
      parentObjective: parent.objective,
      parentWorkspaceRoot: parent.workspaceRoot,
      parentProfile: parent.profile,
      completedRequiredToolNames,
      commonInvestigation,
      commonCheckpoint,
      reviewSnapshotId: verified.snapshot.snapshotId,
      reviewEvidenceSetId: verified.evidenceSet.evidenceSetId,
      reviewProvenanceSha256: verified.provenance.provenanceSha256,
      childSessionId: input.target.childSessionId,
      importId: input.target.importId,
      retainedLocalLeaseId: input.target.retainedLocalLeaseId,
      localProviderId: activeRoute.providerId,
      localModel: activeRoute.model,
    });
    return capability;
  } catch (error) {
    if (error instanceof Pr6rCheckpointImportError) throw error;
    return fail("Checkpoint import capability input is invalid.", error);
  }
}

export interface ConsumePr6rCheckpointImportCapabilityInput {
  store: EventStore;
  capability: Pr6rCheckpointImportCapability;
  executionPolicy: AgenticExecutionPolicyV2;
  hybridSimulation: HybridSimulationSessionAuthorityV1;
  importedAt: string;
  startEventId: string;
  importEventId: string;
}

export interface Pr6rImportedCheckpointAuthority {
  readonly kind: "pr6r_imported_checkpoint";
  readonly childSessionId: string;
  readonly importId: string;
}

interface ImportedCheckpointPrivateState {
  store: EventStore;
  childSessionId: string;
  importId: string;
  expectedImportSequence: number;
}

const importedCheckpointPrivateState = new WeakMap<
  Pr6rImportedCheckpointAuthority,
  ImportedCheckpointPrivateState
>();

export interface Pr6rImportedCheckpointBinding {
  readonly childSessionId: string;
  readonly childLastSequence: number;
  readonly imported: SynthesisCheckpointImportRecord;
  readonly localRoute: {
    readonly providerId: string;
    readonly model: string;
    readonly leaseId: string;
  };
  readonly executionPolicy: AgenticExecutionPolicyV2;
  readonly hybridSimulation: HybridSimulationSessionAuthorityV1;
}

function mintImportedAuthority(
  store: EventStore,
  childSessionId: string,
  importId: string,
  expectedImportSequence: number,
): Pr6rImportedCheckpointAuthority {
  const authority = Object.freeze({
    kind: "pr6r_imported_checkpoint" as const,
    childSessionId,
    importId,
  });
  importedCheckpointPrivateState.set(authority, {
    store,
    childSessionId,
    importId,
    expectedImportSequence,
  });
  return authority;
}

function exactImportOnlyBinding(
  store: EventStore,
  childSessionId: string,
  importId: string,
  expectedImportSequence: number,
): Pr6rImportedCheckpointBinding {
  const state = store.replay(childSessionId);
  const imported = state.synthesisCheckpointImport;
  const localRoute = state.routes.at(-1);
  if (
    imported === undefined ||
    imported.importId !== importId ||
    imported.sequence !== expectedImportSequence ||
    state.lastSequence !== expectedImportSequence ||
    state.status !== "running" ||
    state.lastV2EventType !== "synthesis.checkpoint.imported" ||
    state.messages.length !== 1 ||
    state.messages[0]?.id !== `${childSessionId}:objective` ||
    state.messages[0].role !== "user" ||
    state.messages[0].content !== state.objective ||
    state.messages[0].status !== "completed" ||
    state.routes.length !== 1 ||
    state.routingDecisions.length !== 0 ||
    state.cloudEgressAdmissions.length !== 0 ||
    state.contextCompilations.length !== 0 ||
    state.inferenceAttempts.length !== 0 ||
    localRoute?.leaseId !== imported.retainedLocalLeaseId ||
    state.executionPolicy?.schemaVersion !== "agentic-execution-v2" ||
    state.hybridSimulation === undefined
  ) {
    fail("Imported child replay no longer matches its exact checkpoint boundary.");
  }
  return Object.freeze({
    childSessionId,
    childLastSequence: state.lastSequence,
    imported: Object.freeze({
      ...imported,
      completedRequiredToolNames: [
        ...imported.completedRequiredToolNames,
      ],
    }),
    localRoute: Object.freeze({
      providerId: localRoute.providerId,
      model: localRoute.model,
      leaseId: localRoute.leaseId,
    }),
    executionPolicy: Object.freeze({ ...state.executionPolicy }),
    hybridSimulation: Object.freeze(structuredClone(state.hybridSimulation)),
  });
}

/** Atomically creates, or exactly observes, one imported synthesis child. */
export function consumePr6rCheckpointImportCapability(
  input: ConsumePr6rCheckpointImportCapabilityInput,
): {
  readonly status: "imported" | "already_imported";
  readonly authority: Pr6rImportedCheckpointAuthority;
  readonly binding: Pr6rImportedCheckpointBinding;
} {
  const privateState = checkpointImportPrivateState.get(input.capability);
  if (
    privateState === undefined ||
    privateState.consumed ||
    privateState.store !== input.store
  ) {
    fail("Checkpoint import capability is forged, transplanted, or already used.");
  }
  privateState.consumed = true;
  const policy = AgenticExecutionPolicyV2Schema.parse(input.executionPolicy);
  const hybridSimulation = HybridSimulationSessionAuthorityV1Schema.parse(
    input.hybridSimulation,
  );
  if (
    policy.routingPolicy !== "hybrid_simulation_v1" ||
    hybridSimulation.campaignId !== PR6R_CAMPAIGN_ID ||
    hybridSimulation.pricingSnapshotId !==
      PR6R_SIMULATION_PRICING_SNAPSHOT_ID ||
    hybridSimulation.credentialMetadataId !==
      PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID ||
    hybridSimulation.fakeCloudProvider.providerId !==
      PR6R_SYNTHETIC_PROVIDER_ID ||
    hybridSimulation.fakeCloudProvider.model !== PR6R_MODEL_SLUG ||
    hybridSimulation.fakeLocalProvider.providerId !==
      privateState.localProviderId ||
    hybridSimulation.fakeLocalProvider.model !== privateState.localModel
  ) {
    fail("Child Hybrid simulation authority does not match the imported route.");
  }

  const importPayload = SynthesisCheckpointImportedPayloadSchema.parse({
    schemaVersion: "synthesis-checkpoint-import-v1",
    importId: privateState.importId,
    parentSessionId: privateState.parentSessionId,
    parentLastSequence: privateState.parentLastSequence,
    commonInvestigationSha256:
      privateState.commonInvestigation.investigationSha256,
    commonCheckpointSha256: privateState.commonCheckpoint.checkpointSha256,
    checkpointId: `${privateState.childSessionId}:context:1`,
    packetSha256: privateState.commonCheckpoint.packetSha256,
    semanticMessagesSha256:
      privateState.commonCheckpoint.semanticMessagesSha256,
    responseSchemaSha256: privateState.commonCheckpoint.responseSchemaSha256,
    provenanceSemanticSha256: privateState.reviewProvenanceSha256,
    reviewSnapshotId: privateState.reviewSnapshotId,
    reviewEvidenceSetId: privateState.reviewEvidenceSetId,
    reviewProvenanceSha256: privateState.reviewProvenanceSha256,
    completedRequiredToolNames: privateState.completedRequiredToolNames,
    retainedLocalLeaseId: privateState.retainedLocalLeaseId,
    importedAt: input.importedAt,
  });

  const status = input.store.runImmediatePersistenceTransaction(() => {
    const parent = input.store.replay(privateState.parentSessionId);
    if (parent.lastSequence !== privateState.parentLastSequence) {
      fail("Parent changed after checkpoint import capability minting.");
    }
    const existing = input.store.getSession(privateState.childSessionId);
    if (existing !== undefined) {
      const events = input.store.getEvents(privateState.childSessionId);
      const expectedStartedPayload = {
        startedAt: input.importedAt,
        deadlineAt: new Date(
          Date.parse(input.importedAt) + policy.maxEpisodeDurationMs,
        ).toISOString(),
      };
      const state = input.store.replay(privateState.childSessionId);
      if (
        events.length !== 4 ||
        events[2]?.type !== "session.started" ||
        events[3]?.type !== "synthesis.checkpoint.imported" ||
        events[2].id !== input.startEventId ||
        events[3].id !== input.importEventId ||
        events[2].createdAt !== input.importedAt ||
        events[3].createdAt !== input.importedAt ||
        !exactJson(events[2].payload, expectedStartedPayload) ||
        !exactJson(events[3].payload, importPayload) ||
        state.title !== `${privateState.parentTitle} — PR6R synthesis` ||
        state.objective !== privateState.parentObjective ||
        state.workspaceRoot !== privateState.parentWorkspaceRoot ||
        state.profile !== privateState.parentProfile ||
        state.taskTrack !== "change-review-v1" ||
        !exactJson(state.executionPolicy, policy) ||
        !exactJson(state.hybridSimulation, hybridSimulation) ||
        !exactJson(state.completionObligations, {
          requiredSuccessfulTools: privateState.completedRequiredToolNames,
          minimumVerifiedPathLineCitations: 0,
        })
      ) {
        fail("Existing synthesis child conflicts with the requested import.");
      }
      return "already_imported" as const;
    }
    input.store.createSession({
      id: privateState.childSessionId,
      title: `${privateState.parentTitle} — PR6R synthesis`,
      objective: privateState.parentObjective,
      workspaceRoot: privateState.parentWorkspaceRoot,
      profile: privateState.parentProfile,
      taskTrack: "change-review-v1",
      completionObligations: {
        requiredSuccessfulTools: privateState.completedRequiredToolNames,
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: policy,
      hybridSimulation,
      createdAt: input.importedAt,
    });
    input.store.appendMany(
      privateState.childSessionId,
      [
        {
          type: "session.started",
          payload: {
            startedAt: input.importedAt,
            deadlineAt: new Date(
              Date.parse(input.importedAt) + policy.maxEpisodeDurationMs,
            ).toISOString(),
          },
        },
        {
          type: "synthesis.checkpoint.imported",
          payload: importPayload,
        },
      ],
      {
        expectedSequence: 2,
        createdAt: input.importedAt,
        eventIds: [input.startEventId, input.importEventId],
      },
    );
    return "imported" as const;
  });
  const authority = mintImportedAuthority(
    input.store,
    privateState.childSessionId,
    privateState.importId,
    4,
  );
  return Object.freeze({
    status,
    authority,
    binding: exactImportOnlyBinding(
      input.store,
      privateState.childSessionId,
      privateState.importId,
      4,
    ),
  });
}

/** Revalidate a genuine, still-import-only child before preparing A2 start. */
export function assertPr6rImportedCheckpoint(
  authority: Pr6rImportedCheckpointAuthority,
  input: { store: EventStore; childSessionId: string },
): Pr6rImportedCheckpointBinding {
  const privateState = importedCheckpointPrivateState.get(authority);
  if (
    privateState === undefined ||
    privateState.store !== input.store ||
    privateState.childSessionId !== input.childSessionId ||
    authority.childSessionId !== input.childSessionId ||
    authority.importId !== privateState.importId
  ) {
    fail("Imported checkpoint authority is forged or transplanted.");
  }
  return exactImportOnlyBinding(
    input.store,
    privateState.childSessionId,
    privateState.importId,
    privateState.expectedImportSequence,
  );
}

export interface ReobservePr6rImportedCheckpointAuthorityInput {
  readonly store: EventStore;
  readonly childSessionId: string;
  /** Rehydrated proof input; validated transiently and never persisted here. */
  readonly commonInvestigation: unknown;
  /** Rehydrated hash-only checkpoint metadata. */
  readonly commonCheckpoint: unknown;
  /** Rehydrated canonical packet bytes; never retained by the returned token. */
  readonly packetUtf8: string;
  /** Rehydrated semantic messages; never retained by the returned token. */
  readonly semanticMessages: unknown;
}

/**
 * Re-observe an already imported child after process restart and mint a fresh
 * nominal authority. This deliberately reruns the original parent evidence,
 * packet, checkpoint, provenance, and exact-child checks; persisted hashes
 * alone are not treated as proof that a structural import was authorized.
 */
export function reobservePr6rImportedCheckpointAuthority(
  input: ReobservePr6rImportedCheckpointAuthorityInput,
): {
  readonly authority: Pr6rImportedCheckpointAuthority;
  readonly binding: Pr6rImportedCheckpointBinding;
} {
  try {
    const child = input.store.replay(input.childSessionId);
    const imported = child.synthesisCheckpointImport;
    const events = input.store.getEvents(input.childSessionId);
    if (
      imported === undefined ||
      child.executionPolicy?.schemaVersion !== "agentic-execution-v2" ||
      child.hybridSimulation === undefined ||
      events.length !== 4 ||
      events[2]?.type !== "session.started" ||
      events[3]?.type !== "synthesis.checkpoint.imported"
    ) {
      fail("Persisted synthesis child is not an exact import-only boundary.");
    }
    exactImportOnlyBinding(
      input.store,
      input.childSessionId,
      imported.importId,
      imported.sequence,
    );
    const capability = mintPr6rCheckpointImportCapability({
      store: input.store,
      parentLastSequence: imported.parentLastSequence,
      commonInvestigation: input.commonInvestigation,
      commonCheckpoint: input.commonCheckpoint,
      packetUtf8: input.packetUtf8,
      semanticMessages: input.semanticMessages,
      target: {
        childSessionId: input.childSessionId,
        importId: imported.importId,
        retainedLocalLeaseId: imported.retainedLocalLeaseId,
      },
    });
    const observed = consumePr6rCheckpointImportCapability({
      store: input.store,
      capability,
      executionPolicy: child.executionPolicy,
      hybridSimulation: child.hybridSimulation,
      importedAt: imported.importedAt,
      startEventId: events[2].id,
      importEventId: events[3].id,
    });
    if (observed.status !== "already_imported") {
      fail("Checkpoint recovery unexpectedly created a new synthesis child.");
    }
    return Object.freeze({
      authority: observed.authority,
      binding: observed.binding,
    });
  } catch (error) {
    if (error instanceof Pr6rCheckpointImportError) throw error;
    return fail("Persisted checkpoint import could not be re-observed.", error);
  }
}

/** Exact imported-evidence facts accepted by the session reducer. */
export function pr6rImportedEvidenceTriggerFacts(
  binding: Pr6rImportedCheckpointBinding,
): readonly {
  readonly key: string;
  readonly value: string | number | boolean;
}[] {
  return Object.freeze([
    Object.freeze({
      key: "router_evidence_import_id",
      value: binding.imported.importId,
    }),
    Object.freeze({ key: "router_evidence_ready", value: true }),
    Object.freeze({
      key: "router_evidence_source",
      value: "pr6r_imported_checkpoint_v1",
    }),
    Object.freeze({
      key: "router_successful_investigation_attempt_count",
      value: 0,
    }),
  ]);
}

/** Convenience guard used by the SQLite adapter for exact request binding. */
export function assertRequestMatchesImportedCheckpoint(
  requestValue: unknown,
  binding: Pr6rImportedCheckpointBinding,
): void {
  const request = CloudApplicationRequestV1Schema.parse(requestValue);
  if (
    request.synthesisSessionId !== binding.childSessionId ||
    request.parentSessionId !== binding.imported.parentSessionId ||
    request.snapshotId !== binding.imported.reviewSnapshotId ||
    request.commonCheckpointSha256 !==
      binding.imported.commonCheckpointSha256 ||
    request.packetSha256 !== binding.imported.packetSha256 ||
    request.semanticMessagesSha256 !==
      binding.imported.semanticMessagesSha256 ||
    request.responseSchemaSha256 !== binding.imported.responseSchemaSha256
  ) {
    fail("Application request does not match the imported checkpoint.");
  }
}
