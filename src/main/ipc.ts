import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";

import { dialog, ipcMain } from "electron";

import {
  HYBRID_LOCKED_REVIEW_REASON,
  HYBRID_LOCKED_REVIEW_REACHABILITY,
  SaveCloudCredentialInputSchema,
  type CloudSetupStatus,
} from "../shared/cloud-setup-contracts";
import {
  IPC_CHANNELS,
  createChangeReviewSessionInputSchema,
  createSessionInputSchema,
  issueHybridSimulationConsentChallengeInputSchema,
  sessionIdSchema,
  type ReviewAvailability,
  type WorkspaceSelection,
} from "../shared/contracts";
import type { CompletionObligations } from "../shared/session-events";
import type { SoarConfig } from "./config";
import { EventStore } from "./event-store";
import { SessionRunner } from "./agent/run-session";
import { toSessionSnapshot, toSessionSummary } from "./session-view";
import { toChangeReviewView } from "./change-review-view";
import { startLocalChangeReviewSession } from "./local-change-review-session";
import type {
  HybridSimulationConsentChallengeStore,
  HybridSimulationWorkspaceDirectoryIdentityV1,
} from "./hybrid-simulation-consent";
import { startHybridChangeReviewSession } from "./hybrid-change-review-session";
import {
  CloudCredentialSetupService,
  unavailableCloudSetupStatus,
} from "./cloud-credential-service";

export interface RegisterIpcOptions {
  store: EventStore;
  runner: SessionRunner;
  config: SoarConfig;
  cloudCredentialSetup?: CloudCredentialSetupService;
  hybridSimulationConsent?: HybridSimulationConsentChallengeStore;
}

const TASK_TRACK_COMPLETION_POLICIES: Record<
  "repository-investigator-v1",
  CompletionObligations
> = {
  "repository-investigator-v1": {
    requiredSuccessfulTools: [
      "list_files",
      "search_text",
      "read_text_file",
    ],
    minimumVerifiedPathLineCitations: 1,
  },
};

function hybridAvailability(enabled: boolean): ReviewAvailability["hybrid"] {
  if (enabled) {
    return {
      enabled: true,
      mode: "simulation",
      label: "Hybrid simulation",
      reason:
        "Simulation is independent of Cloud Settings and never reads your stored credential.",
      separatelyConfiguredPaidProviderReachable: false,
      reachabilitySummary:
        "Two in-process Fake models; no external provider is contacted.",
      consent: "simulation_cloud_synthesis_v1",
    };
  }
  return {
    enabled: false,
    reason: HYBRID_LOCKED_REVIEW_REASON,
    separatelyConfiguredPaidProviderReachable: false,
    reachabilitySummary: HYBRID_LOCKED_REVIEW_REACHABILITY,
    consent: "none",
  };
}

function assertNoIpcPayload(value: unknown): void {
  if (value !== undefined) {
    throw new TypeError("This IPC method does not accept an input payload.");
  }
}

function completionObligationsForTaskTrack(
  taskTrack: "repository-investigator-v1",
): CompletionObligations {
  const policy = TASK_TRACK_COMPLETION_POLICIES[taskTrack];
  return {
    requiredSuccessfulTools: [...policy.requiredSuccessfulTools],
    minimumVerifiedPathLineCitations:
      policy.minimumVerifiedPathLineCitations,
  };
}

interface CanonicalDirectoryIdentity {
  path: string;
  identity: HybridSimulationWorkspaceDirectoryIdentityV1;
}

interface CanonicalDirectoryIdentityLease extends CanonicalDirectoryIdentity {
  admit<T>(callback: (canonicalWorkspaceIdentity: string) => T): T;
  close(): void;
}

async function canonicalDirectoryIdentity(
  candidate: string,
): Promise<CanonicalDirectoryIdentity> {
  const canonical = await realpath(candidate);
  const metadata = await stat(canonical, { bigint: true });
  if (!metadata.isDirectory()) throw new Error("The selected workspace is not a directory.");
  return {
    path: canonical,
    identity: {
      canonicalWorkspaceIdentity: canonical,
      device: metadata.dev.toString(10),
      inode: metadata.ino.toString(10),
    },
  };
}

async function canonicalDirectory(candidate: string): Promise<string> {
  return (await canonicalDirectoryIdentity(candidate)).path;
}

function openCanonicalDirectoryIdentityLease(
  candidate: string,
): CanonicalDirectoryIdentityLease {
  const canonical = realpathSync(candidate);
  const descriptor = openSync(
    canonical,
    fsConstants.O_RDONLY |
      fsConstants.O_DIRECTORY |
      fsConstants.O_NOFOLLOW,
  );
  let closed = false;
  try {
    const openedMetadata = fstatSync(descriptor, { bigint: true });
    if (!openedMetadata.isDirectory()) {
      throw new Error("The selected workspace is not a directory.");
    }
    const identity: HybridSimulationWorkspaceDirectoryIdentityV1 = {
      canonicalWorkspaceIdentity: canonical,
      device: openedMetadata.dev.toString(10),
      inode: openedMetadata.ino.toString(10),
    };
    const assertCurrentPath = (): void => {
      const currentCanonical = realpathSync(candidate);
      const currentPathMetadata = statSync(currentCanonical, { bigint: true });
      const currentOpenedMetadata = fstatSync(descriptor, { bigint: true });
      if (
        currentCanonical !== canonical ||
        !currentPathMetadata.isDirectory() ||
        !currentOpenedMetadata.isDirectory() ||
        currentPathMetadata.dev !== currentOpenedMetadata.dev ||
        currentPathMetadata.ino !== currentOpenedMetadata.ino ||
        currentOpenedMetadata.dev.toString(10) !== identity.device ||
        currentOpenedMetadata.ino.toString(10) !== identity.inode
      ) {
        throw new Error("The selected workspace identity changed.");
      }
    };
    assertCurrentPath();
    return {
      path: canonical,
      identity,
      admit<T>(callback: (canonicalWorkspaceIdentity: string) => T): T {
        // Revalidate the still-open directory handle immediately before the
        // synchronous ledger/session admission callback. No renderer work or
        // event-loop turn can occur between this check and admission.
        assertCurrentPath();
        return callback(canonical);
      },
      close(): void {
        if (closed) return;
        closed = true;
        closeSync(descriptor);
      },
    };
  } catch (error) {
    if (!closed) {
      closed = true;
      closeSync(descriptor);
    }
    throw error;
  }
}

function rendererReferencedChallengeId(rawInput: unknown): string | undefined {
  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    !("challengeId" in rawInput) ||
    typeof rawInput.challengeId !== "string"
  ) {
    return undefined;
  }
  return rawInput.challengeId;
}

function titleFromTask(task: string): string {
  const firstLine = task.split(/\r?\n/u, 1)[0].replace(/\s+/gu, " ").trim();
  if (firstLine.length <= 56) return firstLine;
  return `${firstLine.slice(0, 53).trimEnd()}...`;
}

async function restorePersistedWorkspaceApprovals(
  store: EventStore,
  approvedWorkspaces: Set<string>,
): Promise<void> {
  for (const session of store.listSessions({ limit: 1_000 })) {
    const recordedRoot = path.resolve(session.workspaceRoot);
    try {
      const canonicalRoot = await canonicalDirectory(recordedRoot);
      // Session roots are canonicalized before persistence. Refuse a root that
      // has since become a symlink to a different directory.
      if (canonicalRoot === recordedRoot) {
        approvedWorkspaces.add(canonicalRoot);
      }
    } catch {
      // Missing or inaccessible historical workspaces stay unapproved until
      // the user explicitly selects a directory again.
    }
  }
}

export async function registerIpcHandlers({
  store,
  runner,
  config,
  cloudCredentialSetup,
  hybridSimulationConsent,
}: RegisterIpcOptions): Promise<() => void> {
  const approvedWorkspaces = new Set<string>();

  await restorePersistedWorkspaceApprovals(store, approvedWorkspaces);

  if (config.providerMode === "fake" && config.testWorkspace) {
    approvedWorkspaces.add(await canonicalDirectory(config.testWorkspace));
  }

  ipcMain.handle(IPC_CHANNELS.chooseWorkspace, async (): Promise<WorkspaceSelection | null> => {
    if (config.providerMode === "fake" && config.testWorkspace) {
      const workspacePath = await canonicalDirectory(config.testWorkspace);
      approvedWorkspaces.add(workspacePath);
      return { path: workspacePath, name: path.basename(workspacePath) };
    }

    const result = await dialog.showOpenDialog({
      title: "Choose a workspace",
      buttonLabel: "Use workspace",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const workspacePath = await canonicalDirectory(result.filePaths[0]);
    approvedWorkspaces.add(workspacePath);
    return { path: workspacePath, name: path.basename(workspacePath) };
  });

  ipcMain.handle(IPC_CHANNELS.createSession, async (_event, rawInput: unknown) => {
    const input = createSessionInputSchema.parse(rawInput);
    const workspaceRoot = await canonicalDirectory(input.workspaceRoot);
    if (!approvedWorkspaces.has(workspaceRoot)) {
      throw new Error("Choose this workspace in SOAR before starting a task.");
    }
    const session = store.createSession({
      title: titleFromTask(input.task),
      objective: input.task,
      workspaceRoot,
      profile: "balanced",
      taskTrack: input.taskTrack,
      completionObligations: completionObligationsForTaskTrack(
        input.taskTrack,
      ),
      executionPolicy: {
        schemaVersion: "agentic-execution-v1",
        inferenceRounds: config.limits.inferenceRounds,
        toolCalls: config.limits.toolCalls,
      },
    });
    return toSessionSnapshot(store, session.id);
  });

  ipcMain.handle(IPC_CHANNELS.listSessions, () =>
    store
      .listSessions({ limit: 200 })
      .map((session) =>
        toSessionSummary(session, store.getProjectedState(session.id)),
      ),
  );

  ipcMain.handle(IPC_CHANNELS.getSession, (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    return toSessionSnapshot(store, sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.startSession, (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    void runner.startSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.cancelSession, (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    runner.cancelSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.getReviewAvailability, async (): Promise<ReviewAvailability> => {
    const descriptor = runner.getLocalReviewProviderDescriptor();
    const limitsReady =
      config.limits.inferenceRounds >= 2 && config.limits.toolCalls >= 1;
    const simulationAvailable = hybridSimulationConsent !== undefined;
    const localLabel = simulationAvailable ? "Fake Local" : "Local model";
    const localCostSummary = simulationAvailable
      ? "Fake Local has $0 simulated token cost and makes no external request."
      : "The configured vLLM route declares a $0 token fee; endpoint billing and infrastructure costs are not independently verified.";
    const localTransportSummary = simulationAvailable
      ? "Review evidence stays inside the app and is processed by Fake Local."
      : "Review evidence is sent to the configured vLLM endpoint.";
    return {
      local: descriptor && limitsReady
        ? {
            enabled: true,
            label: localLabel,
            providerId: descriptor.id,
            model: descriptor.model,
            declaredTokenFeeMicrousd: 0,
            costAccountingSummary: localCostSummary,
            evidenceTransportSummary: localTransportSummary,
          }
        : {
            enabled: false,
            label: localLabel,
            reason: descriptor
              ? "The configured execution limits cannot complete a review."
              : "The configured local provider does not support structured change reviews.",
            declaredTokenFeeMicrousd: 0,
            costAccountingSummary: localCostSummary,
            evidenceTransportSummary: localTransportSummary,
          },
      hybrid: hybridAvailability(simulationAvailable),
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.issueHybridSimulationConsentChallenge,
    async (_event, rawInput: unknown) => {
      const input =
        issueHybridSimulationConsentChallengeInputSchema.parse(rawInput);
      if (hybridSimulationConsent === undefined) {
        throw new Error("Hybrid simulation is not available in this app runtime.");
      }
      // Capture the generation before filesystem work so a later route or
      // workspace invalidation also cancels an in-flight issue request.
      const issueGeneration =
        hybridSimulationConsent.captureIssueGeneration();
      const workspace = await canonicalDirectoryIdentity(input.workspaceRoot);
      if (!approvedWorkspaces.has(workspace.path)) {
        throw new Error(
          "Choose this workspace in SOAR before reviewing simulation consent.",
        );
      }
      return hybridSimulationConsent.issue(
        workspace.path,
        workspace.identity,
        issueGeneration,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.invalidateHybridSimulationConsentChallenges,
    async (_event, rawInput: unknown): Promise<void> => {
      assertNoIpcPayload(rawInput);
      hybridSimulationConsent?.clear();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getCloudSetupStatus,
    async (_event, rawInput: unknown): Promise<CloudSetupStatus> => {
      assertNoIpcPayload(rawInput);
      return cloudCredentialSetup === undefined
        ? unavailableCloudSetupStatus()
        : cloudCredentialSetup.getStatus();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.saveCloudCredential,
    async (_event, rawInput: unknown): Promise<CloudSetupStatus> => {
      // Never let a raw Zod error cross IPC. Strict-schema diagnostics include
      // unrecognized property names, which a forged renderer could populate
      // with credential material. The allow-listed status contains no caller
      // bytes and keeps dispatch locked.
      const parsedInput = SaveCloudCredentialInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        return unavailableCloudSetupStatus("invalid_credential");
      }
      if (cloudCredentialSetup === undefined) {
        return unavailableCloudSetupStatus();
      }
      return cloudCredentialSetup.save(parsedInput.data.credential);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteCloudCredential,
    async (_event, rawInput: unknown): Promise<CloudSetupStatus> => {
      assertNoIpcPayload(rawInput);
      return cloudCredentialSetup === undefined
        ? unavailableCloudSetupStatus()
        : cloudCredentialSetup.delete();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.createChangeReviewSession,
    async (_event, rawInput: unknown) => {
      const referencedHybridChallengeId =
        rendererReferencedChallengeId(rawInput);
      const parsedInput = createChangeReviewSessionInputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        hybridSimulationConsent?.burnKnownChallenge(
          referencedHybridChallengeId,
        );
        throw parsedInput.error;
      }
      const input = parsedInput.data;
      if (input.route === "hybrid_simulation") {
        if (hybridSimulationConsent === undefined) {
          throw new Error("Hybrid simulation is not available in this app runtime.");
        }
        // Issued challenges bind canonical selected identities. Unknown,
        // replayed, expired, or mismatched acknowledgements burn/fail before
        // filesystem, session, budget, credential, or provider work.
        if (!approvedWorkspaces.has(input.workspaceRoot)) {
          hybridSimulationConsent.burnKnownChallenge(input.challengeId);
          throw new Error("Choose this workspace in SOAR before starting a review.");
        }
        let workspaceLease: CanonicalDirectoryIdentityLease | undefined;
        try {
          const consumedConsent = await hybridSimulationConsent.consume(
            {
              challengeId: input.challengeId,
              acknowledged: input.acknowledged,
              canonicalWorkspaceIdentity: input.workspaceRoot,
              route: input.route,
            },
            async (canonicalWorkspaceIdentity) => {
              workspaceLease = openCanonicalDirectoryIdentityLease(
                canonicalWorkspaceIdentity,
              );
              return workspaceLease.identity;
            },
          );
          if (workspaceLease === undefined) {
            throw new Error("The selected workspace identity changed.");
          }
          return workspaceLease.admit((workspaceRoot) => {
            if (workspaceRoot !== input.workspaceRoot) {
              throw new Error("The selected workspace identity changed.");
            }
            const { session } = startHybridChangeReviewSession({
              store,
              runner,
              config,
              workspaceRoot,
              consumedConsent,
            });
            return toSessionSnapshot(store, session.id);
          });
        } finally {
          workspaceLease?.close();
        }
      }

      const workspaceRoot = await canonicalDirectory(input.workspaceRoot);
      if (!approvedWorkspaces.has(workspaceRoot)) {
        throw new Error("Choose this workspace in SOAR before starting a review.");
      }
      const { session } = startLocalChangeReviewSession({
        store,
        runner,
        config,
        workspaceRoot,
      });
      return toSessionSnapshot(store, session.id);
    },
  );

  ipcMain.handle(IPC_CHANNELS.getChangeReviewView, async (_event, rawId: unknown) => {
    const sessionId = sessionIdSchema.parse(rawId);
    const session = store.requireSession(sessionId);
    const recordedRoot = path.resolve(session.workspaceRoot);
    const canonicalRoot = await canonicalDirectory(recordedRoot);
    if (
      canonicalRoot !== recordedRoot ||
      !approvedWorkspaces.has(canonicalRoot)
    ) {
      throw new Error(
        "Choose this workspace in SOAR before reading its review state.",
      );
    }
    return toChangeReviewView(store, sessionId);
  });

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      if (channel !== IPC_CHANNELS.sessionUpdate) ipcMain.removeHandler(channel);
    }
  };
}
