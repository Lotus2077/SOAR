import type { SessionRunner } from "./agent/run-session";
import type { SoarConfig } from "./config";
import { EventStore, type SessionRecord } from "./event-store";

const REVIEW_OBJECTIVE =
  "Review the current Git working-tree changes. Identify concrete defects or bounded risks, cite only host-verified evidence, and state any incomplete coverage.";

export interface StartLocalChangeReviewSessionOptions {
  store: EventStore;
  runner: Pick<
    SessionRunner,
    "getLocalReviewProviderDescriptor" | "startSession"
  >;
  config: Pick<SoarConfig, "limits" | "vllm">;
  workspaceRoot: string;
}

export interface StartedLocalChangeReviewSession {
  session: SessionRecord;
  completion: Promise<void>;
}

/**
 * Create and start the fixed production local-only change-review session.
 *
 * Workspace authorization and canonicalization remain the caller's concern.
 * The returned completion lets non-Electron callers await the same production
 * run while IPC can deliberately return the created snapshot immediately.
 */
export function startLocalChangeReviewSession({
  store,
  runner,
  config,
  workspaceRoot,
}: StartLocalChangeReviewSessionOptions): StartedLocalChangeReviewSession {
  if (
    runner.getLocalReviewProviderDescriptor() === undefined ||
    config.limits.inferenceRounds < 2 ||
    config.limits.toolCalls < 1
  ) {
    throw new Error(
      "The configured local provider cannot run structured change reviews.",
    );
  }

  const session = store.createSession({
    title: "Review current changes",
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
      routingPolicy: "local_only_v1",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: 250_000,
      maxEpisodeDurationMs: 900_000,
      attemptTimeoutMs: Math.min(config.vllm.timeoutMs, 900_000),
      egressConsent: "none",
    },
  });
  const completion = runner.startSession(session.id);
  return { session, completion };
}
