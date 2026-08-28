import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

class TimedOutProvider implements InferenceProvider {
  readonly id = "timed-out-local";
  readonly model = "timed-out-test-model";

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const partialContent = "Partial work before timeout";
    input.onDelta(partialContent);
    throw new ProviderAbortedError(
      "Inference timed out",
      partialContent,
      "timeout",
    );
  }
}

class TimeoutBeforeLateCancellationProvider implements InferenceProvider {
  readonly id = "timeout-before-late-cancellation-local";
  readonly model = "timeout-before-late-cancellation-test-model";

  constructor(private readonly afterTimeout: () => void) {}

  async complete(input: CompleteInput): Promise<ProviderResult> {
    const partialContent = "Timeout won the abort race";
    input.onDelta(partialContent);
    return new Promise<ProviderResult>((_resolve, reject) => {
      reject(
        new ProviderAbortedError(
          "Inference timed out",
          partialContent,
          "timeout",
        ),
      );
      this.afterTimeout();
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

class HistorySensitiveProvider implements InferenceProvider {
  readonly id = "history-sensitive-local";
  readonly model = "history-sensitive-test-model";
  readonly contexts: ProviderMessage[][] = [];
  readonly toolModes: boolean[] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.contexts.push(structuredClone(input.messages));
    this.toolModes.push(input.allowTools ?? true);

    const nativeToolHistory = input.messages.some(
      (message) =>
        message.role === "tool" ||
        ("tool_calls" in message && Boolean(message.tool_calls?.length)),
    );
    if (this.contexts.length === 1 || nativeToolHistory) {
      return {
        content: "",
        toolCalls: [
          {
            id: `read-${this.contexts.length}`,
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

    const content = "Final answer based on the recorded probe evidence.";
    input.onDelta(content);
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
      durationMs: 4,
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

class FixedResultProvider implements InferenceProvider {
  readonly id = "fixed-local";
  readonly model = "fixed-test-model";

  constructor(private readonly result: ProviderResult) {}

  async complete(input: CompleteInput): Promise<ProviderResult> {
    if (this.result.content) input.onDelta(this.result.content);
    return this.result;
  }
}

class EvidenceThenAnswerProvider implements InferenceProvider {
  readonly id = "citation-local";
  readonly model = "citation-test-model";
  private calls = 0;

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: "",
        toolCalls: [
          {
            id: "read-citation-source",
            type: "function",
            function: {
              name: "read_text_file",
              arguments: JSON.stringify({ relativePath: "src/preload/index.ts" }),
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
        durationMs: 1,
      };
    }

    const content = "The bridge is defined at `preload/index.ts:2`.";
    input.onDelta(content);
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      durationMs: 1,
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

  it("persists a uniquely canonicalized final citation with its deterministic correction", async () => {
    const workspaceRoot = await createWorkspace();
    await mkdir(path.join(workspaceRoot, "src/preload"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/preload/index.ts"),
      "first line\nexport const bridge = true;\n",
      "utf8",
    );
    const store = createStore();
    const session = store.createSession({
      id: "canonical-citation",
      title: "Canonical citation",
      objective: "Find the bridge.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new EvidenceThenAnswerProvider(),
      limits: limits({ inferenceRounds: 2 }),
    });

    await runner.startSession(session.id);

    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "The bridge is defined at `src/preload/index.ts:2`.",
    });
    const finalMessage = store
      .getEvents(session.id)
      .filter((event) => event.type === "assistant.message.completed")
      .at(-1);
    expect(finalMessage?.payload).toMatchObject({
      content: "The bridge is defined at `src/preload/index.ts:2`.",
      completionState: "complete",
      citationCorrections: [
        { from: "preload/index.ts:2", to: "src/preload/index.ts:2" },
      ],
    });
    expect(store.replay(session.id)).toEqual(store.getProjectedState(session.id));
  });

  it("fails the session instead of accepting a final citation absent from tool evidence", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "unsupported-citation",
      title: "Unsupported citation",
      objective: "Return an evidenced answer.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new FixedResultProvider({
        content: "This is supposedly in `missing/file.ts:99`.",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
        durationMs: 1,
      }),
      limits: limits(),
    });

    await runner.startSession(session.id);

    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining(
        '"missing/file.ts:99" has no matching path in tool evidence',
      ),
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      content: "This is supposedly in `missing/file.ts:99`.",
      status: "failed",
      completionState: "incomplete",
    });
    expect(
      store.getEvents(session.id).some((event) => event.type === "session.completed"),
    ).toBe(false);
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
      completionState: "incomplete",
    });
    expect(terminalEvents.map((event) => event.type)).toEqual(["session.cancelled"]);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "cancelled",
      error: "Cancelled by the user.",
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "A useful partial answer",
      status: "failed",
      stopReason: "cancelled",
      completionState: "incomplete",
    });
  });

  it("records a provider timeout as failure rather than user cancellation", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "timed-out-run",
      title: "Timed out task",
      objective: "Begin a task that times out.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new TimedOutProvider(),
      limits: limits(),
    });

    await runner.startSession(session.id);

    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "session.cancelled")).toHaveLength(0);
    expect(events.filter((event) => event.type === "session.failed")).toHaveLength(1);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: "Inference timed out",
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Partial work before timeout",
      status: "failed",
      stopReason: "timeout",
      completionState: "incomplete",
    });
  });

  it("keeps the provider's first abort cause when user cancellation arrives later", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "timeout-wins-race",
      title: "Abort race",
      objective: "Preserve the first abort cause.",
      workspaceRoot,
    });
    let runner: SessionRunner;
    const provider = new TimeoutBeforeLateCancellationProvider(() => {
      runner.cancelSession(session.id);
    });
    runner = new SessionRunner({ store, provider, limits: limits() });

    await runner.startSession(session.id);

    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: "Inference timed out",
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      content: "Timeout won the abort race",
      stopReason: "timeout",
      completionState: "incomplete",
    });
    expect(
      store.getEvents(session.id).some((event) => event.type === "session.cancelled"),
    ).toBe(false);
  });

  it("fails honestly when reasoning exhausts the token budget without visible output", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "reasoning-only-length",
      title: "Reasoning-only response",
      objective: "Return a visible answer.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new FixedResultProvider({
        content: "",
        toolCalls: [],
        finishReason: "length",
        usage: {
          inputTokens: 32,
          outputTokens: 0,
          reasoningTokens: 64,
          totalTokens: 96,
        },
        durationMs: 2.5,
      }),
      limits: limits(),
    });

    await runner.startSession(session.id);

    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "session.completed")).toHaveLength(0);
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(0);
    expect(events.find((event) => event.type === "usage.recorded")?.payload).toMatchObject({
      inputTokens: 32,
      outputTokens: 0,
      reasoningTokens: 64,
    });
    expect(
      events.find((event) => event.type === "assistant.message.completed")?.payload,
    ).toMatchObject({
      content: "",
      stopReason: "length",
      completionState: "incomplete",
    });
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      totalInputTokens: 32,
      totalOutputTokens: 0,
      totalReasoningTokens: 64,
      error:
        "The provider exhausted its output-token limit during reasoning and returned no " +
        "visible answer (finish_reason: length; reasoning tokens: 64).",
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "",
      status: "failed",
      stopReason: "length",
      completionState: "incomplete",
    });
    expect(store.replay(session.id)).toEqual(store.getProjectedState(session.id));
  });

  it("retains partial visible text when content filtering makes a response incomplete", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "filtered-partial",
      title: "Filtered response",
      objective: "Return an answer.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new FixedResultProvider({
        content: "Visible partial answer",
        toolCalls: [],
        finishReason: "content_filter",
        usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
        durationMs: 1,
      }),
      limits: limits(),
    });

    await runner.startSession(session.id);

    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("finish_reason: content_filter"),
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      content: "Visible partial answer",
      status: "failed",
      stopReason: "content_filter",
      completionState: "incomplete",
    });
    expect(
      store.getEvents(session.id).some((event) => event.type === "session.completed"),
    ).toBe(false);
  });

  it("does not execute a truncated tool call", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "truncated-tool-call",
      title: "Truncated tool call",
      objective: "Read a file.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new FixedResultProvider({
        content: "I will inspect the file.",
        toolCalls: [
          {
            id: "truncated-call",
            type: "function",
            function: {
              name: "read_text_file",
              arguments: '{"relativePath":"SOAR_PROBE.txt"',
            },
          },
        ],
        finishReason: "tool_calls",
        usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
        durationMs: 1,
      }),
      limits: limits(),
    });

    await runner.startSession(session.id);

    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(0);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(0);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("incomplete tool call"),
    });
    expect(store.getProjectedState(session.id).messages.at(-1)).toMatchObject({
      content: "I will inspect the file.",
      status: "failed",
      stopReason: "tool_calls",
      completionState: "incomplete",
    });
  });

  it("uses a text-only evidence packet for the reserved final answer round", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), "probe\n", "utf8");
    const store = createStore();
    const provider = new HistorySensitiveProvider();
    const session = store.createSession({
      id: "clean-finalizer-context",
      title: "Finalizer task",
      objective: "Read the marker and report it.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 2 }),
    });

    await runner.startSession(session.id);

    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "Final answer based on the recorded probe evidence.",
      totalCostUsd: 0,
    });
    expect(provider.toolModes).toEqual([true, false]);
    expect(provider.contexts[1]?.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(
      provider.contexts[1]?.some(
        (message) =>
          message.role === "tool" ||
          ("tool_calls" in message && Boolean(message.tool_calls?.length)),
      ),
    ).toBe(false);
    expect(provider.contexts[1]?.[0]?.content).toContain(
      "Never request, invoke, or emit a tool call.",
    );
    expect(provider.contexts[1]?.[1]?.content).toContain("tool: read_text_file");
    expect(provider.contexts[1]?.[1]?.content).toContain(
      "workspace_relative_path: SOAR_PROBE.txt",
    );
    expect(provider.contexts[1]?.[1]?.content).toContain(
      'arguments: {"relativePath":"SOAR_PROBE.txt"}',
    );
    expect(provider.contexts[1]?.[1]?.content).toContain('"text":"probe\\n"');
    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(1);
  });

  it("fails closed when a provider still calls a tool from the finalizer", async () => {
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
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(1);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error:
        "The provider returned a tool call after tools were disabled for the reserved final-answer round.",
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
