import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import type { SoarConfig } from "../../src/main/config";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import { FakeProvider } from "../../src/main/providers/fake-provider";
import {
  ProviderAbortedError,
  type CompleteInput,
  type InferenceProvider,
  type ProviderMessage,
  type ProviderResult,
} from "../../src/main/providers/types";

const databases: SoarDatabase[] = [];
const temporaryDirectories: string[] = [];

function createStore(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
}

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "soar-session-runner-"));
  temporaryDirectories.push(workspaceRoot);
  return workspaceRoot;
}

function limits(
  overrides: Partial<SoarConfig["limits"]> = {},
): SoarConfig["limits"] {
  return { inferenceRounds: 4, toolCalls: 8, ...overrides };
}

class RecordingFakeProvider implements InferenceProvider {
  private readonly delegate = new FakeProvider();
  readonly id = this.delegate.id;
  readonly model = this.delegate.model;
  readonly contexts: ProviderMessage[][] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.contexts.push(structuredClone(input.messages));
    return this.delegate.complete(input);
  }
}

class BlockingProvider implements InferenceProvider {
  readonly id = "blocking-local";
  readonly model = "blocking-test-model";

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const partialContent = "A useful partial answer";
    input.onDelta(partialContent);

    return new Promise<ProviderResult>((_resolve, reject) => {
      const rejectAsCancelled = (): void => {
        reject(new ProviderAbortedError("Fake inference cancelled", partialContent));
      };

      if (input.signal.aborted) {
        rejectAsCancelled();
      } else {
        input.signal.addEventListener("abort", rejectAsCancelled, { once: true });
      }
    });
  }
}

class AlwaysToolProvider implements InferenceProvider {
  readonly id = "always-tool-local";
  readonly model = "always-tool-test-model";
  calls = 0;

  async complete(_input: CompleteInput): Promise<ProviderResult> {
    this.calls += 1;
    return {
      content: "",
      toolCalls: [
        {
          id: `read-${this.calls}`,
          type: "function",
          function: {
            name: "read_text_file",
            arguments: JSON.stringify({ relativePath: "SOAR_PROBE.txt" }),
          },
        },
      ],
      finishReason: "tool_calls",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      durationMs: 3,
    };
  }
}

class ToolBurstProvider implements InferenceProvider {
  readonly id = "tool-burst-local";
  readonly model = "tool-burst-test-model";

  async complete(_input: CompleteInput): Promise<ProviderResult> {
    return {
      content: "",
      toolCalls: ["first", "second"].map((id) => ({
        id,
        type: "function" as const,
        function: {
          name: "read_text_file",
          arguments: JSON.stringify({ relativePath: "SOAR_PROBE.txt" }),
        },
      })),
      finishReason: "tool_calls",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      durationMs: 2,
    };
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("SessionRunner", () => {
  it("runs local inference through read_text_file to a replayable zero-cost result", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), "vertical-slice\n", "utf8");
    const store = createStore();
    const provider = new RecordingFakeProvider();
    const streamed: string[] = [];
    const persistedUpdates: string[] = [];
    const session = store.createSession({
      id: "happy-path",
      title: "Read the marker",
      objective: "Read SOAR_PROBE.txt and report its marker.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits(),
      onUpdate: (update) => {
        if (update.kind === "stream") streamed.push(update.delta);
        else persistedUpdates.push(update.sessionId);
      },
    });

    await runner.startSession(session.id);

    expect(runner.isRunning(session.id)).toBe(false);
    expect(streamed.join("")).toBe("The workspace marker is vertical-slice.");
    expect(persistedUpdates.length).toBeGreaterThan(0);

    const record = store.requireSession(session.id);
    expect(record).toMatchObject({
      status: "completed",
      currentProviderId: "local-vllm",
      currentModel: "RM-01 VLM (deterministic test double)",
      routeReason: "MVP_LOCAL_PROOF",
      totalInputTokens: 72,
      totalOutputTokens: 28,
      totalReasoningTokens: 0,
      totalCostUsd: 0,
      result: "The workspace marker is vertical-slice.",
    });

    const events = store.getEvents(session.id);
    const routes = events.filter((event) => event.type === "route.assigned");
    const usage = events.filter((event) => event.type === "usage.recorded");
    expect(routes).toHaveLength(1);
    expect(routes[0]?.payload).toMatchObject({
      providerId: "local-vllm",
      model: "RM-01 VLM (deterministic test double)",
      reason: "MVP_LOCAL_PROOF",
      leaseId: expect.any(String),
    });
    expect(usage).toHaveLength(2);
    expect(usage.every((event) => event.payload.costUsd === 0)).toBe(true);

    expect(provider.contexts).toHaveLength(2);
    expect(provider.contexts[0]?.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(provider.contexts[1]?.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(provider.contexts[1]?.[2]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "read-probe",
          function: {
            name: "read_text_file",
            arguments: '{"relativePath":"SOAR_PROBE.txt"}',
          },
        },
      ],
    });
    const toolContext = provider.contexts[1]?.[3];
    expect(toolContext).toMatchObject({ role: "tool", tool_call_id: "read-probe" });
    expect(JSON.parse(toolContext?.content ?? "{}")).toMatchObject({
      ok: true,
      text: "vertical-slice\n",
      bytes: 15,
      truncated: false,
    });

    expect(store.replay(session.id)).toEqual(store.getProjectedState(session.id));
  });

  it("cancels an active inference once while preserving streamed partial output", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "cancelled-run",
      title: "Long task",
      objective: "Begin a long-running task.",
      workspaceRoot,
    });
    let sawPartial: () => void = () => undefined;
    const partialStreamed = new Promise<void>((resolve) => {
      sawPartial = resolve;
    });
    const runner = new SessionRunner({
      store,
      provider: new BlockingProvider(),
      limits: limits(),
      onUpdate: (update) => {
        if (update.kind === "stream") sawPartial();
      },
    });

    const running = runner.startSession(session.id);
    await partialStreamed;
    runner.cancelSession(session.id);
    runner.cancelSession(session.id);
    await running;

    const events = store.getEvents(session.id);
    const completedMessages = events.filter(
      (event) => event.type === "assistant.message.completed",
    );
    const terminalEvents = events.filter((event) =>
      ["session.completed", "session.failed", "session.cancelled"].includes(event.type),
    );
    expect(completedMessages).toHaveLength(1);
    expect(completedMessages[0]?.payload).toEqual({
      messageId: expect.any(String),
      content: "A useful partial answer",
      stopReason: "cancelled",
    });
    expect(terminalEvents.map((event) => event.type)).toEqual(["session.cancelled"]);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "cancelled",
      error: "Cancelled by the user.",
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "A useful partial answer",
      status: "completed",
    });
  });

  it("fails after the configured inference-round limit", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), "probe\n", "utf8");
    const store = createStore();
    const provider = new AlwaysToolProvider();
    const session = store.createSession({
      id: "round-limit",
      title: "Looping task",
      objective: "Keep reading the marker.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 2 }),
    });

    await runner.startSession(session.id);

    const events = store.getEvents(session.id);
    expect(provider.calls).toBe(2);
    expect(events.filter((event) => event.type === "usage.recorded")).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(2);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: "The local agent reached the 2-round inference limit.",
      totalCostUsd: 0,
    });
  });

  it("does not execute a provider burst that exceeds the tool-call limit", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), "probe\n", "utf8");
    const store = createStore();
    const session = store.createSession({
      id: "tool-limit",
      title: "Tool burst",
      objective: "Request too many tools.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new ToolBurstProvider(),
      limits: limits({ toolCalls: 1 }),
    });

    await runner.startSession(session.id);

    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(0);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: "Tool-call limit of 1 was exceeded.",
      totalCostUsd: 0,
    });
  });
});
