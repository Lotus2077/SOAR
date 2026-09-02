import path from "node:path";
import { tmpdir } from "node:os";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

const authorityTestOs = vi.hoisted(() => ({
  homeDirectory: "/soar-pr6r-import-authority-home-not-configured",
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

import {
  assertPr6rImportedCheckpoint,
  consumePr6rCheckpointImportCapability,
  mintPr6rCheckpointImportCapability,
  reobservePr6rImportedCheckpointAuthority,
} from "../../src/main/pr6r-development/checkpoint-import";
import {
  createSoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import {
  claimPr6rCampaignAuthority,
  inspectPr6rAuthorityLedger,
} from "../../src/main/pr6r-development/authority-ledger";
import { materializePr6rDevelopmentFixtureV1 } from "../../src/main/pr6r-development/frozen-fixture";
import { compileReviewContextV1 } from "../../src/main/review-context-compiler-v1";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import {
  HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  HYBRID_SIMULATION_CONSENT_ID,
  HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
  HYBRID_SIMULATION_DISCLOSURE_VERSION,
  HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
  HYBRID_SIMULATION_RESULT_MARKER,
  HYBRID_SIMULATION_ROUTE,
  HybridSimulationSessionAuthorityV1Schema,
} from "../../src/shared/hybrid-simulation-contracts";
import {
  PR6R_CAMPAIGN_ID,
  PR6R_COST_SCOPE,
  PR6R_DEVELOPMENT_AUTHORITY_ID,
  PR6R_FIXTURE_CHANGED_LINE_COUNT,
  PR6R_FIXTURE_CHANGED_PATHS,
  PR6R_FIXTURE_SNAPSHOT_ID,
  PR6R_MODEL_SLUG,
  PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
  PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
  PR6R_SYNTHETIC_PROVIDER_ID,
  buildPr6rCommonCheckpointV1,
  buildPr6rCommonInvestigationV1,
  canonicalPr6rJsonV1,
} from "../../src/shared/pr6r-development-contracts";
import type { SessionEventData } from "../../src/shared/session-events";
import {
  REVIEW_FIXTURE_MODEL,
  REVIEW_FIXTURE_PROVIDER_ID,
  REVIEW_FIXTURE_SESSION_ID,
  reviewFixtureEvents,
} from "../helpers/review-event-fixture";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourceRepository = process.env.SOAR_PR6R_FLASK_REPO?.trim();
const proofRequired = process.env.SOAR_PR6R_FIXTURE_PROOF_REQUIRED === "true";

function hybridAuthority() {
  return HybridSimulationSessionAuthorityV1Schema.parse({
    schemaVersion: "hybrid-simulation-session-authority-v1",
    simulationAuthorityId: PR6R_DEVELOPMENT_AUTHORITY_ID,
    disclosureVersion: HYBRID_SIMULATION_DISCLOSURE_VERSION,
    disclosureTextSha256: HYBRID_SIMULATION_DISCLOSURE_TEXT_SHA256,
    route: HYBRID_SIMULATION_ROUTE,
    resultMarker: HYBRID_SIMULATION_RESULT_MARKER,
    costScope: PR6R_COST_SCOPE,
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    egressConsent: "none",
    maxSimulatedSpendMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    fakeLocalProvider: {
      providerId: REVIEW_FIXTURE_PROVIDER_ID,
      model: REVIEW_FIXTURE_MODEL,
    },
    fakeCloudProvider: {
      providerId: PR6R_SYNTHETIC_PROVIDER_ID,
      model: PR6R_MODEL_SLUG,
    },
    riskPolicyId: "review-risk-v1",
    routerPolicyVersion: "hybrid-lease-router-v0",
    healthSnapshotId: "pr6r-import-health",
    pricingSnapshotId: PR6R_SIMULATION_PRICING_SNAPSHOT_ID,
    credentialMetadataId: PR6R_SYNTHETIC_CREDENTIAL_METADATA_ID,
    campaignId: PR6R_CAMPAIGN_ID,
    campaignCreatedAt: HYBRID_SIMULATION_CAMPAIGN_CREATED_AT,
  });
}

function childPolicy() {
  return {
    schemaVersion: "agentic-execution-v2" as const,
    inferenceRounds: 2,
    toolCalls: 1,
    routingPolicy: "hybrid_simulation_v1" as const,
    maxProviderChanges: 2 as const,
    maxPaidAttempts: 1 as const,
    maxPaidEpisodeMicrousd: HYBRID_SIMULATION_MAX_SPEND_MICROUSD,
    maxEpisodeDurationMs: 120_000,
    attemptTimeoutMs: 30_000,
    egressConsent: "none" as const,
    simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
  };
}

function populateImportParent(
  store: EventStore,
  events: ReturnType<typeof reviewFixtureEvents>,
): void {
  const created = events[0];
  if (created?.type !== "session.created") {
    throw new Error("PR6R import parent fixture must start with session.created");
  }
  store.createSession({
    id: REVIEW_FIXTURE_SESSION_ID,
    title: created.payload.title,
    objective: created.payload.objective,
    workspaceRoot: created.payload.workspaceRoot,
    profile: created.payload.profile,
    taskTrack: created.payload.taskTrack,
    completionObligations: created.payload.completionObligations,
    executionPolicy: created.payload.executionPolicy,
    createdAt: created.createdAt,
  });
  for (const event of events.slice(1)) {
    store.append(
      REVIEW_FIXTURE_SESSION_ID,
      {
        type: event.type,
        payload: structuredClone(event.payload),
      } as SessionEventData,
      {
        expectedSequence: store.replay(REVIEW_FIXTURE_SESSION_ID).lastSequence,
        eventId: `import-parent:${event.id}`,
        createdAt: event.createdAt,
      },
    );
  }
}

describe("PR6R cal-007 frozen public fixture", () => {
  it.skipIf(
    !proofRequired && (sourceRepository === undefined || sourceRepository === ""),
  )(
    "reproduces the exact nine-path high-risk change from local Git objects only",
    async () => {
      if (sourceRepository === undefined || sourceRepository === "") {
        throw new Error(
          "SOAR_PR6R_FLASK_REPO is required for the explicit cal-007 proof gate.",
        );
      }
      const fixture = await materializePr6rDevelopmentFixtureV1({
        projectRoot,
        sourceRepository,
      });
      const workspaceRoot = fixture.workspaceRoot;
      try {
        expect(fixture.snapshot.snapshotId).toBe(PR6R_FIXTURE_SNAPSHOT_ID);
        expect(fixture.changedLineCount).toBe(PR6R_FIXTURE_CHANGED_LINE_COUNT);
        expect(fixture.snapshot.manifest.map((entry) => entry.newPath)).toEqual(
          PR6R_FIXTURE_CHANGED_PATHS,
        );
        expect(fixture.snapshot.omittedPathCount).toBe(0);
        expect(fixture.snapshot.omittedHunkCount).toBe(0);
      } finally {
        fixture.cleanup();
      }
      await expect(access(workspaceRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
    30_000,
  );

  it.skipIf(
    !proofRequired && (sourceRepository === undefined || sourceRepository === ""),
  )(
    "mints, consumes, replays, and fail-closes the nominal cal-007 checkpoint import",
    async () => {
      if (sourceRepository === undefined || sourceRepository === "") {
        throw new Error(
          "SOAR_PR6R_FLASK_REPO is required for the explicit cal-007 proof gate.",
        );
      }
      const fixture = await materializePr6rDevelopmentFixtureV1({
        projectRoot,
        sourceRepository,
      });
      const authorityHome = await realpath(
        await mkdtemp(path.join(tmpdir(), "soar-pr6r-import-authority-")),
      );
      authorityTestOs.homeDirectory = authorityHome;
      const databaseDirectory = await mkdtemp(
        path.join(tmpdir(), "soar-pr6r-import-reobserve-"),
      );
      const databasePath = path.join(databaseDirectory, "sessions.sqlite");
      let database = createSoarDatabase(databasePath);
      const transplantedDatabase = createSoarDatabase();
      try {
        await claimPr6rCampaignAuthority({
          implementationRevision: "a".repeat(40),
        });
        expect((await inspectPr6rAuthorityLedger())?.slots).toEqual({});
        let store = new EventStore(database);
        const parentEvents = reviewFixtureEvents({
          snapshot: fixture.snapshot,
        }).slice(0, 11);
        populateImportParent(store, parentEvents);
        const parent = store.replay(REVIEW_FIXTURE_SESSION_ID);
        const verified = deriveVerifiedReviewEvidenceV1(
          store.getEvents(REVIEW_FIXTURE_SESSION_ID),
        );
        const compiled = compileReviewContextV1({
          objective: parent.objective,
          verifiedEvidence: verified,
          systemPrompt: "Review only the host-verified public fixture.",
          maxInputTokens: 163_840,
          safetyMargin: 0,
        });
        const packetUtf8 = canonicalPr6rJsonV1(compiled.packet);
        const checkpoint = buildPr6rCommonCheckpointV1({
          parentSessionId: parent.id,
          packetUtf8,
          semanticMessages: compiled.messages,
        });
        const investigation = buildPr6rCommonInvestigationV1({
          implementationRevision: "a".repeat(40),
          parentSessionId: parent.id,
          commonCheckpointSha256: checkpoint.checkpointSha256,
          durationMs: 1,
          toolCallCount: verified.provenance.toolResults.length,
        });
        const mint = (childSessionId: string, importId: string) =>
          mintPr6rCheckpointImportCapability({
            store,
            parentLastSequence: parent.lastSequence,
            commonInvestigation: investigation,
            commonCheckpoint: checkpoint,
            packetUtf8,
            semanticMessages: compiled.messages,
            target: {
              childSessionId,
              importId,
              retainedLocalLeaseId: "review-lease-1",
            },
          });
        const consume = (
          capability: ReturnType<typeof mint>,
          childSessionId: string,
          importId: string,
        ) =>
          consumePr6rCheckpointImportCapability({
            store,
            capability,
            executionPolicy: childPolicy(),
            hybridSimulation: hybridAuthority(),
            importedAt: "2026-09-02T00:00:00.000Z",
            startEventId: `${childSessionId}:started`,
            importEventId: `${childSessionId}:${importId}`,
          });

        const genuine = mint("pr6r-import-child-1", "pr6r-import-1");
        expect(() =>
          consume(
            { ...genuine },
            "pr6r-import-child-1",
            "pr6r-import-1",
          ),
        ).toThrow(/forged|transplanted/u);
        expect(() =>
          consumePr6rCheckpointImportCapability({
            store: new EventStore(transplantedDatabase),
            capability: genuine,
            executionPolicy: childPolicy(),
            hybridSimulation: hybridAuthority(),
            importedAt: "2026-09-02T00:00:00.000Z",
            startEventId: "transplanted-start",
            importEventId: "transplanted-import",
          }),
        ).toThrow(/transplanted/u);
        const imported = consume(
          genuine,
          "pr6r-import-child-1",
          "pr6r-import-1",
        );
        expect(imported.status).toBe("imported");
        expect(imported.binding).toMatchObject({
          childSessionId: "pr6r-import-child-1",
          childLastSequence: 4,
          imported: {
            reviewSnapshotId: PR6R_FIXTURE_SNAPSHOT_ID,
            completedRequiredToolNames: ["inspect_git_changes"],
          },
          localRoute: {
            providerId: REVIEW_FIXTURE_PROVIDER_ID,
            model: REVIEW_FIXTURE_MODEL,
            leaseId: "review-lease-1",
          },
        });
        expect(store.replay("pr6r-import-child-1").inferenceAttempts).toEqual(
          [],
        );
        expect(() =>
          consume(genuine, "pr6r-import-child-1", "pr6r-import-1"),
        ).toThrow(/already used/u);

        const retry = consume(
          mint("pr6r-import-child-1", "pr6r-import-1"),
          "pr6r-import-child-1",
          "pr6r-import-1",
        );
        expect(retry.status).toBe("already_imported");

        database.close();
        database = createSoarDatabase(databasePath);
        store = new EventStore(database);
        const reobserved = reobservePr6rImportedCheckpointAuthority({
          store,
          childSessionId: "pr6r-import-child-1",
          commonInvestigation: investigation,
          commonCheckpoint: checkpoint,
          packetUtf8,
          semanticMessages: compiled.messages,
        });
        expect(reobserved.binding).toEqual(retry.binding);
        expect(() =>
          assertPr6rImportedCheckpoint(reobserved.authority, {
            store,
            childSessionId: "pr6r-import-child-1",
          }),
        ).not.toThrow();
        expect((await inspectPr6rAuthorityLedger())?.slots).toEqual({});

        expect(() =>
          reobservePr6rImportedCheckpointAuthority({
            store,
            childSessionId: "pr6r-import-child-missing",
            commonInvestigation: investigation,
            commonCheckpoint: checkpoint,
            packetUtf8,
            semanticMessages: compiled.messages,
          }),
        ).toThrow(/capability input is invalid|could not be re-observed/u);

        consume(
          mint("pr6r-import-child-mutated", "pr6r-import-mutated"),
          "pr6r-import-child-mutated",
          "pr6r-import-mutated",
        );
        const mutatedChild = store.replay("pr6r-import-child-mutated");
        store.append(
          mutatedChild.id,
          {
            type: "session.cancelled",
            payload: { reason: "child changed after import" },
          },
          {
            expectedSequence: mutatedChild.lastSequence,
            eventId: "pr6r-import-child-mutated-after-import",
            createdAt: "2026-09-02T00:00:01.000Z",
          },
        );
        expect(() =>
          reobservePr6rImportedCheckpointAuthority({
            store,
            childSessionId: mutatedChild.id,
            commonInvestigation: investigation,
            commonCheckpoint: checkpoint,
            packetUtf8,
            semanticMessages: compiled.messages,
          }),
        ).toThrow(/exact import-only boundary/u);

        const sourceChild = store.replay("pr6r-import-child-1");
        const sourceChildEvents = store.getEvents("pr6r-import-child-1");
        const sourceStarted = sourceChildEvents[2];
        const sourceImport = sourceChildEvents[3];
        if (
          sourceChild.taskTrack === undefined ||
          sourceChild.executionPolicy === undefined ||
          sourceChild.hybridSimulation === undefined ||
          sourceStarted?.type !== "session.started" ||
          sourceImport?.type !== "synthesis.checkpoint.imported"
        ) {
          throw new Error("import proof source child is incomplete");
        }
        const orphanStore = new EventStore(transplantedDatabase);
        orphanStore.createSession({
          id: sourceChild.id,
          title: sourceChild.title,
          objective: sourceChild.objective,
          workspaceRoot: sourceChild.workspaceRoot,
          profile: sourceChild.profile,
          taskTrack: sourceChild.taskTrack,
          completionObligations: sourceChild.completionObligations,
          executionPolicy: sourceChild.executionPolicy,
          hybridSimulation: sourceChild.hybridSimulation,
          createdAt: sourceChild.createdAt,
        });
        orphanStore.appendMany(
          sourceChild.id,
          [
            {
              type: sourceStarted.type,
              payload: structuredClone(sourceStarted.payload),
            },
            {
              type: sourceImport.type,
              payload: structuredClone(sourceImport.payload),
            },
          ],
          {
            expectedSequence: 2,
            createdAt: sourceImport.createdAt,
            eventIds: [sourceStarted.id, sourceImport.id],
          },
        );
        expect(() =>
          reobservePr6rImportedCheckpointAuthority({
            store: orphanStore,
            childSessionId: sourceChild.id,
            commonInvestigation: investigation,
            commonCheckpoint: checkpoint,
            packetUtf8,
            semanticMessages: compiled.messages,
          }),
        ).toThrow(/capability input is invalid|could not be re-observed/u);

        const stale = mint("pr6r-import-child-stale", "pr6r-import-stale");
        store.append(
          REVIEW_FIXTURE_SESSION_ID,
          {
            type: "session.cancelled",
            payload: { reason: "parent changed after mint" },
          },
          {
            expectedSequence: parent.lastSequence,
            eventId: "pr6r-import-parent-mutated",
            createdAt: "2026-09-02T00:00:01.000Z",
          },
        );
        expect(() =>
          consume(
            stale,
            "pr6r-import-child-stale",
            "pr6r-import-stale",
          ),
        ).toThrow(/Parent changed/u);
        expect(() =>
          reobservePr6rImportedCheckpointAuthority({
            store,
            childSessionId: "pr6r-import-child-1",
            commonInvestigation: investigation,
            commonCheckpoint: checkpoint,
            packetUtf8,
            semanticMessages: compiled.messages,
          }),
        ).toThrow(/Parent replay does not match/u);
        expect(store.getSession("pr6r-import-child-stale")).toBeUndefined();
      } finally {
        if (database.open) database.close();
        transplantedDatabase.close();
        await rm(databaseDirectory, { recursive: true, force: true });
        await rm(authorityHome, { recursive: true, force: true });
        fixture.cleanup();
      }
    },
    30_000,
  );
});
