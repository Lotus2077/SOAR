import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionRunner } from "../../src/main/agent/run-session";
import type { SoarConfig } from "../../src/main/config";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { startLocalChangeReviewSession } from "../../src/main/local-change-review-session";

const databases: SoarDatabase[] = [];

function store(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
}

function config(
  limits: SoarConfig["limits"] = { inferenceRounds: 4, toolCalls: 3 },
): SoarConfig {
  return {
    providerMode: "local",
    hybridSimulationEnabled: false,
    fakeCloudScenario: "success",
    fakeDelayMs: 0,
    vllm: {
      baseUrl: "http://localhost:8000/v1",
      apiKey: "local-vllm",
      model: "test-model",
      costPolicy: "local_zero_cost",
      maxOutputTokens: 8_192,
      timeoutMs: 950_000,
    },
    limits,
    context: { maxInputTokens: 18_432, safetyMargin: 0.2 },
  };
}

function runner(input: {
  ready?: boolean;
  completion?: Promise<void>;
} = {}): Pick<
  SessionRunner,
  "getLocalReviewProviderDescriptor" | "startSession"
> {
  return {
    getLocalReviewProviderDescriptor: vi.fn().mockReturnValue(
      input.ready === false
        ? undefined
        : { id: "local-vllm", model: "local-review-model" },
    ),
    startSession: vi.fn().mockReturnValue(input.completion ?? Promise.resolve()),
  } as unknown as Pick<
    SessionRunner,
    "getLocalReviewProviderDescriptor" | "startSession"
  >;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("local change-review session service", () => {
  it.each([
    {
      label: "missing structured local provider",
      ready: false,
      limits: { inferenceRounds: 4, toolCalls: 3 },
    },
    {
      label: "insufficient inference rounds",
      ready: true,
      limits: { inferenceRounds: 1, toolCalls: 3 },
    },
    {
      label: "insufficient tool calls",
      ready: true,
      limits: { inferenceRounds: 4, toolCalls: 0 },
    },
  ])("rejects $label before creating or starting a session", ({ ready, limits }) => {
    const events = store();
    const sessionRunner = runner({ ready });

    expect(() =>
      startLocalChangeReviewSession({
        store: events,
        runner: sessionRunner,
        config: config(limits),
        workspaceRoot: "/tmp/soar-local-review-service",
      }),
    ).toThrow(
      "The configured local provider cannot run structured change reviews.",
    );
    expect(events.listSessions()).toEqual([]);
    expect(sessionRunner.startSession).not.toHaveBeenCalled();
  });

  it("creates the exact production policy, starts once, and returns the same completion", () => {
    const events = store();
    const completion = new Promise<void>(() => undefined);
    const sessionRunner = runner({ completion });

    const started = startLocalChangeReviewSession({
      store: events,
      runner: sessionRunner,
      config: config(),
      workspaceRoot: "/tmp/soar-local-review-service",
    });

    expect(started.completion).toBe(completion);
    expect(sessionRunner.startSession).toHaveBeenCalledOnce();
    expect(sessionRunner.startSession).toHaveBeenCalledWith(started.session.id);
    expect(started.session).toMatchObject({
      title: "Review current changes",
      objective:
        "Review the current Git working-tree changes. Identify concrete defects or bounded risks, cite only host-verified evidence, and state any incomplete coverage.",
      workspaceRoot: "/tmp/soar-local-review-service",
      profile: "balanced",
      status: "created",
    });
    expect(events.getProjectedState(started.session.id)).toMatchObject({
      taskTrack: "change-review-v1",
      completionObligations: {
        requiredSuccessfulTools: ["inspect_git_changes"],
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: {
        schemaVersion: "agentic-execution-v2",
        inferenceRounds: 4,
        toolCalls: 3,
        routingPolicy: "local_only_v1",
        maxProviderChanges: 2,
        maxPaidAttempts: 1,
        maxPaidEpisodeMicrousd: 250_000,
        maxEpisodeDurationMs: 900_000,
        attemptTimeoutMs: 900_000,
        egressConsent: "none",
      },
    });
  });
});
