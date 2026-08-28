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
import type { ContextPacket } from "../../src/shared/context-compiler";

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

function executionPolicy(
  overrides: Partial<SoarConfig["limits"]> = {},
) {
  const configured = limits(overrides);
  return {
    schemaVersion: "agentic-execution-v1" as const,
    inferenceRounds: configured.inferenceRounds,
    toolCalls: configured.toolCalls,
  };
}

function parseContextPacket(messages: ProviderMessage[]): ContextPacket {
  const packetMessage = messages.find((message) => message.role === "user");
  const prefix = "SOAR_CONTEXT_PACKET_V1\n";
  const content = packetMessage?.content;
  if (typeof content !== "string" || !content.startsWith(prefix)) {
    throw new Error("Expected a SOAR context packet user message.");
  }
  return JSON.parse(content.slice(prefix.length)) as ContextPacket;
}

class RecordingFakeProvider implements InferenceProvider {
  private readonly delegate = new FakeProvider();
  readonly id = this.delegate.id;
  readonly model = this.delegate.model;
  readonly costPolicy = this.delegate.costPolicy;
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

class NeverCalledProvider implements InferenceProvider {
  readonly id = "never-called-local";
  readonly model = "never-called-test-model";
  calls = 0;

  constructor(private readonly reserve = 0) {}

  estimateInputTokenReserve(_allowTools: boolean): number {
    return this.reserve;
  }

  async complete(_input: CompleteInput): Promise<ProviderResult> {
    this.calls += 1;
    throw new Error("Provider must not be called when context compilation fails.");
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

interface RecordedProviderPolicy {
  allowTools: boolean | undefined;
  allowedToolNames: string[] | undefined;
  requireToolCall: boolean | undefined;
  systemPrompt: string | undefined;
}

function recordProviderPolicy(input: CompleteInput): RecordedProviderPolicy {
  return {
    allowTools: input.allowTools,
    allowedToolNames:
      input.allowedToolNames === undefined
        ? undefined
        : [...input.allowedToolNames],
    requireToolCall: input.requireToolCall,
    systemPrompt:
      typeof input.messages[0]?.content === "string"
        ? input.messages[0].content
        : undefined,
  };
}

function toolCallResult(
  id: string,
  name: "list_files" | "search_text" | "read_text_file",
  arguments_: object,
): ProviderResult {
  return {
    content: "",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(arguments_),
        },
      },
    ],
    finishReason: "tool_calls",
    usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    durationMs: 1,
  };
}

function answerResult(input: CompleteInput, content: string): ProviderResult {
  input.onDelta(content);
  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
    durationMs: 1,
  };
}

class OrderedObligationProvider implements InferenceProvider {
  readonly id = "ordered-obligation-local";
  readonly model = "ordered-obligation-test-model";
  readonly policies: RecordedProviderPolicy[] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.policies.push(recordProviderPolicy(input));
    switch (this.policies.length) {
      case 1:
        return toolCallResult("list-workspace", "list_files", {
          relativePath: ".",
          recursive: true,
          maxItems: 20,
        });
      case 2:
        return toolCallResult("search-marker", "search_text", {
          query: "marker",
          relativePath: "src",
        });
      case 3:
        return toolCallResult("read-marker", "read_text_file", {
          relativePath: "src/fixture.ts",
        });
      default:
        return answerResult(
          input,
          "The marker is defined at src/fixture.ts:1 and used at src/fixture.ts:2.",
        );
    }
  }
}

class ObligationRetryProvider implements InferenceProvider {
  readonly id = "obligation-retry-local";
  readonly model = "obligation-retry-test-model";
  readonly policies: RecordedProviderPolicy[] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.policies.push(recordProviderPolicy(input));
    switch (this.policies.length) {
      case 1:
        return toolCallResult("read-retry-source", "read_text_file", {
          relativePath: "src/retry.ts",
        });
      case 2:
        return answerResult(input, "The answer is supported, but has no citations yet.");
      default:
        return answerResult(
          input,
          "The evidence is at src/retry.ts:1 and src/retry.ts:2.",
        );
    }
  }
}

class PrematureRequiredToolProvider implements InferenceProvider {
  readonly id = "premature-required-tool-local";
  readonly model = "premature-required-tool-test-model";
  readonly policies: RecordedProviderPolicy[] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.policies.push(recordProviderPolicy(input));
    if (this.policies.length === 1) {
      return answerResult(input, "I stopped before using the required tool.");
    }
    if (this.policies.length === 2) {
      return toolCallResult("list-after-retry", "list_files", {
        relativePath: ".",
        recursive: false,
      });
    }
    return answerResult(input, "The required workspace listing is complete.");
  }
}

class FailedRequiredToolsProvider implements InferenceProvider {
  readonly id = "failed-required-tools-local";
  readonly model = "failed-required-tools-test-model";
  readonly policies: RecordedProviderPolicy[] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.policies.push(recordProviderPolicy(input));
    if (this.policies.length <= 2) {
      return toolCallResult(
        `failed-required-tool-${this.policies.length}`,
        "list_files",
        { relativePath: "../outside" },
      );
    }
    return answerResult(input, "Required tool execution did not succeed.");
  }
}

class DuplicateObservationProvider implements InferenceProvider {
  readonly id = "duplicate-observation-local";
  readonly model = "duplicate-observation-test-model";
  readonly policies: RecordedProviderPolicy[] = [];

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.policies.push(recordProviderPolicy(input));
    if (this.policies.length <= 3) {
      return toolCallResult(
        `duplicate-read-${this.policies.length}`,
        "read_text_file",
        { relativePath: "SOAR_PROBE.txt" },
      );
    }
    return answerResult(input, "Final synthesis from the persisted probe evidence.");
  }
}

class DistinctSameContentProvider implements InferenceProvider {
  readonly id = "distinct-same-content-local";
  readonly model = "distinct-same-content-test-model";
  private calls = 0;

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.calls += 1;
    if (this.calls <= 2) {
      return toolCallResult(
        `same-content-${this.calls}`,
        "read_text_file",
        { relativePath: `file-${this.calls}.txt` },
      );
    }
    return answerResult(input, "Both distinct files were inspected.");
  }
}

class EquivalentPathDuplicateProvider implements InferenceProvider {
  readonly id = "equivalent-path-duplicate-local";
  readonly model = "equivalent-path-duplicate-test-model";
  private calls = 0;

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.calls += 1;
    if (this.calls <= 2) {
      return toolCallResult(
        `equivalent-path-${this.calls}`,
        "read_text_file",
        {
          relativePath:
            this.calls === 1 ? "SOAR_PROBE.txt" : "./SOAR_PROBE.txt",
        },
      );
    }
    return answerResult(input, "The equivalent path was read once.");
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
    expect(streamed.join("")).toBe(
      "The workspace marker at SOAR_PROBE.txt:1 is vertical-slice.",
    );
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
      result: "The workspace marker at SOAR_PROBE.txt:1 is vertical-slice.",
    });

    const events = store.getEvents(session.id);
    const routes = events.filter((event) => event.type === "route.assigned");
    const usage = events.filter((event) => event.type === "usage.recorded");
    const contextCompilations = events.filter(
      (event) => event.type === "context.compiled",
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]?.payload).toMatchObject({
      providerId: "local-vllm",
      model: "RM-01 VLM (deterministic test double)",
      reason: "MVP_LOCAL_PROOF",
      leaseId: expect.any(String),
    });
    expect(usage).toHaveLength(2);
    expect(usage.every((event) => event.payload.costUsd === 0)).toBe(true);
    expect(
      usage.every(
        (event) =>
          event.payload.costProvenance === "local_zero_cost_policy" &&
          event.payload.reported === true,
      ),
    ).toBe(true);
    expect(contextCompilations).toHaveLength(2);
    expect(contextCompilations.map((event) => event.payload.reason)).toEqual([
      "session_start",
      "tool_result_boundary",
    ]);
    expect(
      contextCompilations.map((event) => event.payload.sourceMessageCount),
    ).toEqual([1, 3]);
    expect(
      contextCompilations.map((event) => ({
        estimator: event.payload.estimator,
        reservedInputTokens: event.payload.reservedInputTokens,
        effectiveInputTokenBudget: event.payload.effectiveInputTokenBudget,
      })),
    ).toEqual([
      {
        estimator: "utf8-bytes-v1",
        reservedInputTokens: 0,
        effectiveInputTokenBudget: 13_107,
      },
      {
        estimator: "utf8-bytes-v1",
        reservedInputTokens: 0,
        effectiveInputTokenBudget: 13_107,
      },
    ]);
    expect(
      contextCompilations.every(
        (event) => event.payload.estimatedTokens <= event.payload.maxTokens,
      ),
    ).toBe(true);
    expect(
      contextCompilations.every((event) => /^[a-f0-9]{64}$/u.test(event.payload.packetSha256)),
    ).toBe(true);
    expect(
      contextCompilations.every((event) => /^[a-f0-9]{64}$/u.test(event.payload.messagesSha256)),
    ).toBe(true);

    expect(provider.contexts).toHaveLength(2);
    expect(provider.contexts[0]?.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(provider.contexts[1]?.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    const packet = parseContextPacket(provider.contexts[1] ?? []);
    expect(packet.schema).toBe("soar.context-packet.v1");
    expect(packet.objective).toBe("Read SOAR_PROBE.txt and report its marker.");
    const toolEvidence = packet.evidence.find(
      (entry) => entry.kind === "tool_evidence",
    );
    expect(toolEvidence).toMatchObject({
      kind: "tool_evidence",
      toolName: "read_text_file",
      workspaceRelativePath: "SOAR_PROBE.txt",
      argumentsExcerpt: '{"relativePath":"SOAR_PROBE.txt"}',
      content: "Complete file lines are represented by citationSnippets.",
      sourceResultCount: 1,
      sourceResultTruncated: false,
      citationSnippets: [
        { citation: "SOAR_PROBE.txt:1", text: "vertical-slice" },
      ],
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

  it("schedules persisted required tools in order and accepts two verified citations", async () => {
    const workspaceRoot = await createWorkspace();
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/fixture.ts"),
      "export const marker = 1;\nexport const useMarker = marker;\n",
      "utf8",
    );
    const store = createStore();
    const provider = new OrderedObligationProvider();
    const session = store.createSession({
      id: "ordered-completion-obligations",
      title: "Ordered completion obligations",
      objective: "Inspect the marker and return two verified citations.",
      workspaceRoot,
      completionObligations: {
        requiredSuccessfulTools: [
          "list_files",
          "search_text",
          "read_text_file",
        ],
        minimumVerifiedPathLineCitations: 2,
      },
      executionPolicy: executionPolicy({ inferenceRounds: 6 }),
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 6 }),
    });

    await runner.startSession(session.id);

    expect(
      provider.policies.map(
        ({ allowTools, allowedToolNames, requireToolCall }) => ({
          allowTools,
          allowedToolNames,
          requireToolCall,
        }),
      ),
    ).toEqual([
      {
        allowTools: true,
        allowedToolNames: ["list_files"],
        requireToolCall: true,
      },
      {
        allowTools: true,
        allowedToolNames: ["search_text"],
        requireToolCall: true,
      },
      {
        allowTools: true,
        allowedToolNames: ["read_text_file"],
        requireToolCall: true,
      },
      {
        allowTools: true,
        allowedToolNames: undefined,
        requireToolCall: undefined,
      },
    ]);

    const events = store.getEvents(session.id);
    expect(
      events
        .filter((event) => event.type === "tool.call.requested")
        .map((event) => event.payload.name),
    ).toEqual(["list_files", "search_text", "read_text_file"]);
    const checks = events.filter(
      (event) => event.type === "completion.obligations.checked",
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.payload).toMatchObject({
      round: 4,
      successfulRequiredTools: [
        "list_files",
        "search_text",
        "read_text_file",
      ],
      missingRequiredTools: [],
      verifiedPathLineCitations: [
        "src/fixture.ts:1",
        "src/fixture.ts:2",
      ],
      unresolvedCitationCount: 0,
      outcome: "accepted",
    });
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result:
        "The marker is defined at src/fixture.ts:1 and used at src/fixture.ts:2.",
    });
    expect(store.getProjectedState(session.id).completionObligations).toEqual({
      requiredSuccessfulTools: [
        "list_files",
        "search_text",
        "read_text_file",
      ],
      minimumVerifiedPathLineCitations: 2,
    });
  });

  it("persists an unmet citation candidate as incomplete and retries at an obligation boundary", async () => {
    const workspaceRoot = await createWorkspace();
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/retry.ts"),
      "export const first = true;\nexport const second = first;\n",
      "utf8",
    );
    const store = createStore();
    const provider = new ObligationRetryProvider();
    const session = store.createSession({
      id: "completion-obligation-retry",
      title: "Completion obligation retry",
      objective: "Return two verified citations after reading the source.",
      workspaceRoot,
      completionObligations: {
        requiredSuccessfulTools: ["read_text_file"],
        minimumVerifiedPathLineCitations: 2,
      },
      executionPolicy: executionPolicy({ inferenceRounds: 5 }),
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 5 }),
    });

    await runner.startSession(session.id);

    const events = store.getEvents(session.id);
    expect(
      events
        .filter((event) => event.type === "context.compiled")
        .map((event) => event.payload.reason),
    ).toEqual([
      "session_start",
      "tool_result_boundary",
      "obligation_retry_boundary",
    ]);
    expect(
      events
        .filter((event) => event.type === "completion.obligations.checked")
        .map((event) => ({
          outcome: event.payload.outcome,
          citations: event.payload.verifiedPathLineCitations,
        })),
    ).toEqual([
      { outcome: "retry", citations: [] },
      {
        outcome: "accepted",
        citations: ["src/retry.ts:1", "src/retry.ts:2"],
      },
    ]);
    expect(
      events.find(
        (event) =>
          event.type === "assistant.message.completed" &&
          event.payload.content ===
            "The answer is supported, but has no citations yet.",
      )?.payload,
    ).toMatchObject({
      stopReason: "stop",
      completionState: "incomplete",
    });
    expect(
      store
        .getProjectedState(session.id)
        .messages.find(
          (message) =>
            message.content ===
            "The answer is supported, but has no citations yet.",
        ),
    ).toMatchObject({ status: "failed", completionState: "incomplete" });
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "The evidence is at src/retry.ts:1 and src/retry.ts:2.",
    });
    expect(
      events.some((event) => event.type === "session.failed"),
    ).toBe(false);
  });

  it("preserves an obligation-retry checkpoint when tool capacity already forced finalization", async () => {
    const workspaceRoot = await createWorkspace();
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/retry.ts"),
      "export const first = true;\nexport const second = first;\n",
      "utf8",
    );
    const store = createStore();
    const session = store.createSession({
      id: "tool-cap-obligation-retry",
      title: "Tool-cap obligation retry",
      objective: "Return two verified citations after one required read.",
      workspaceRoot,
      completionObligations: {
        requiredSuccessfulTools: ["read_text_file"],
        minimumVerifiedPathLineCitations: 2,
      },
      executionPolicy: executionPolicy({ inferenceRounds: 5, toolCalls: 1 }),
    });
    const provider = new ObligationRetryProvider();
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 5, toolCalls: 1 }),
    });

    await runner.startSession(session.id);

    const contextEvents = store
      .getEvents(session.id)
      .filter((event) => event.type === "context.compiled");
    expect(
      contextEvents.map((event) => ({
        reason: event.payload.reason,
        mode: event.payload.mode,
      })),
    ).toEqual([
      { reason: "session_start", mode: "working" },
      { reason: "finalization_boundary", mode: "finalization" },
      { reason: "obligation_retry_boundary", mode: "finalization" },
    ]);
    expect(
      provider.policies.map(({ allowTools, requireToolCall }) => ({
        allowTools,
        requireToolCall,
      })),
    ).toEqual([
      { allowTools: true, requireToolCall: true },
      { allowTools: false, requireToolCall: undefined },
      { allowTools: false, requireToolCall: undefined },
    ]);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "The evidence is at src/retry.ts:1 and src/retry.ts:2.",
    });
  });

  it("fails once when a provider omits a scheduler-required tool call", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "marker.txt"), "marker\n", "utf8");
    const store = createStore();
    const provider = new PrematureRequiredToolProvider();
    const session = store.createSession({
      id: "premature-required-tool",
      title: "Premature required tool",
      objective: "List the workspace before answering.",
      workspaceRoot,
      completionObligations: {
        requiredSuccessfulTools: ["list_files"],
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: executionPolicy({ inferenceRounds: 4 }),
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 4 }),
    });

    await runner.startSession(session.id);

    expect(provider.policies).toHaveLength(1);
    expect(provider.policies[0]).toMatchObject({
      allowTools: true,
      allowedToolNames: ["list_files"],
      requireToolCall: true,
    });
    const events = store.getEvents(session.id);
    expect(
      events
        .filter((event) => event.type === "context.compiled")
        .map((event) => event.payload.reason),
    ).toEqual(["session_start"]);
    expect(
      events.some((event) => event.type === "completion.obligations.checked"),
    ).toBe(false);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining(
        "violated the required-tool protocol",
      ),
    });
  });

  it("exhausts immediately when the remaining rounds cannot run every missing tool and a final answer", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "marker.txt"), "marker\n", "utf8");
    const store = createStore();
    const provider = new FailedRequiredToolsProvider();
    const session = store.createSession({
      id: "infeasible-required-tools",
      title: "Infeasible required tools",
      objective: "List and search the workspace before answering.",
      workspaceRoot,
      completionObligations: {
        requiredSuccessfulTools: ["list_files", "search_text"],
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: executionPolicy({ inferenceRounds: 3, toolCalls: 2 }),
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 3, toolCalls: 2 }),
    });

    await runner.startSession(session.id);

    expect(provider.policies).toHaveLength(3);
    expect(
      store
        .getEvents(session.id)
        .find((event) => event.type === "completion.obligations.checked")
        ?.payload,
    ).toMatchObject({
      outcome: "exhausted",
      remainingRounds: 0,
      missingRequiredTools: ["list_files", "search_text"],
    });
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining(
        "missing successful tools: list_files, search_text",
      ),
    });
  });

  it("marks duplicate observations failed and finalizes after two no-progress results", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), "probe\n", "utf8");
    const store = createStore();
    const provider = new DuplicateObservationProvider();
    const session = store.createSession({
      id: "duplicate-observation-finalization",
      title: "Duplicate observation finalization",
      objective: "Read the probe without looping forever.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits({ inferenceRounds: 6 }),
    });

    await runner.startSession(session.id);

    expect(provider.policies.map((policy) => policy.allowTools)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(provider.policies[3]?.systemPrompt).toContain(
      "SOAR ended tool use after 2 duplicate observations.",
    );

    const events = store.getEvents(session.id);
    const toolCompletions = events.filter(
      (event) => event.type === "tool.call.completed",
    );
    expect(toolCompletions).toHaveLength(3);
    expect(toolCompletions.map((event) => event.payload.isError)).toEqual([
      false,
      true,
      true,
    ]);
    for (const duplicate of toolCompletions.slice(1)) {
      expect(JSON.parse(duplicate.payload.content)).toMatchObject({
        ok: false,
        error: {
          code: "DUPLICATE_OBSERVATION",
          duplicateOfToolCallId: "duplicate-read-1",
        },
      });
    }
    expect(
      events
        .filter((event) => event.type === "context.compiled")
        .map((event) => event.payload.reason),
    ).toEqual([
      "session_start",
      "tool_result_boundary",
      "no_progress_boundary",
      "no_progress_finalization_boundary",
    ]);
    expect(
      store
        .getProjectedState(session.id)
        .messages.flatMap((message) => message.toolCalls ?? [])
        .map((toolCall) => toolCall.status),
    ).toEqual(["completed", "failed", "failed"]);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "Final synthesis from the persisted probe evidence.",
    });
  });

  it("does not conflate identical result bytes from different semantic paths", async () => {
    const workspaceRoot = await createWorkspace();
    await Promise.all([
      writeFile(path.join(workspaceRoot, "file-1.txt"), "same\n", "utf8"),
      writeFile(path.join(workspaceRoot, "file-2.txt"), "same\n", "utf8"),
    ]);
    const store = createStore();
    const session = store.createSession({
      id: "distinct-same-content",
      title: "Distinct same-content observations",
      objective: "Inspect two distinct files with identical content.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new DistinctSameContentProvider(),
      limits: limits(),
    });

    await runner.startSession(session.id);

    const toolCompletions = store
      .getEvents(session.id)
      .filter((event) => event.type === "tool.call.completed");
    expect(toolCompletions).toHaveLength(2);
    expect(toolCompletions.every((event) => !event.payload.isError)).toBe(true);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "Both distinct files were inspected.",
    });
  });

  it("treats equivalent workspace path spellings as duplicate observations", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, "SOAR_PROBE.txt"), "probe\n", "utf8");
    const store = createStore();
    const session = store.createSession({
      id: "equivalent-path-observation",
      title: "Equivalent path observation",
      objective: "Avoid repeating the same file read through a lexical path alias.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new EquivalentPathDuplicateProvider(),
      limits: limits(),
    });

    await runner.startSession(session.id);

    const toolCompletions = store
      .getEvents(session.id)
      .filter((event) => event.type === "tool.call.completed");
    expect(toolCompletions.map((event) => event.payload.isError)).toEqual([
      false,
      true,
    ]);
    expect(JSON.parse(toolCompletions[1]?.payload.content ?? "{}")).toMatchObject({
      ok: false,
      error: {
        code: "DUPLICATE_OBSERVATION",
        duplicateOfToolCallId: "equivalent-path-1",
      },
    });
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "The equivalent path was read once.",
    });
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
      completionObligations: {
        requiredSuccessfulTools: ["list_files"],
        minimumVerifiedPathLineCitations: 0,
      },
      executionPolicy: executionPolicy(),
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

  it("marks token usage unavailable instead of presenting missing telemetry as reported zero", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "missing-provider-usage",
      title: "Missing usage",
      objective: "Return a visible answer.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider: new FixedResultProvider({
        content: "A visible answer without usage metadata.",
        toolCalls: [],
        finishReason: "stop",
        durationMs: 1,
      }),
      limits: limits(),
    });

    await runner.startSession(session.id);

    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(
      store.getEvents(session.id).find((event) => event.type === "usage.recorded")
        ?.payload,
    ).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      reported: false,
    });
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
    const packet = parseContextPacket(provider.contexts[1] ?? []);
    expect(packet.mode).toBe("finalization");
    expect(packet.evidence).toContainEqual(
      expect.objectContaining({
        kind: "tool_evidence",
        toolName: "read_text_file",
        workspaceRelativePath: "SOAR_PROBE.txt",
        argumentsExcerpt: '{"relativePath":"SOAR_PROBE.txt"}',
        content: "Complete file lines are represented by citationSnippets.",
        citationSnippets: [
          { citation: "SOAR_PROBE.txt:1", text: "probe" },
        ],
      }),
    );
    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === "context.compiled")
        .map((event) => event.payload.mode),
    ).toEqual(["working", "finalization"]);
  });

  it("fails closed before inference when the context budget cannot fit the task envelope", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const provider = new NeverCalledProvider(4_096);
    const session = store.createSession({
      id: "context-budget-too-small",
      title: "Budget guard",
      objective: "Return a useful answer.",
      workspaceRoot,
    });
    const runner = new SessionRunner({
      store,
      provider,
      limits: limits(),
      context: { maxInputTokens: 4_096, safetyMargin: 0.2 },
    });

    await runner.startSession(session.id);

    expect(provider.calls).toBe(0);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("reserved provider-overhead tokens"),
    });
    const events = store.getEvents(session.id);
    expect(events.filter((event) => event.type === "context.compiled")).toHaveLength(0);
    expect(events.filter((event) => event.type === "usage.recorded")).toHaveLength(0);
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

  it("rejects a provider burst before persisting or executing tool requests", async () => {
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
    expect(events.filter((event) => event.type === "tool.call.requested")).toHaveLength(0);
    expect(events.filter((event) => event.type === "tool.call.completed")).toHaveLength(0);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "failed",
      error:
        "The provider returned multiple tool calls, but SOAR permits exactly one sequential tool call per inference round.",
      totalCostUsd: 0,
    });
  });

  it("uses session_start for a one-round finalization checkpoint", async () => {
    const workspaceRoot = await createWorkspace();
    const store = createStore();
    const session = store.createSession({
      id: "one-round-finalization",
      title: "One round",
      objective: "Return one final answer without tools.",
      workspaceRoot,
      executionPolicy: executionPolicy({ inferenceRounds: 1 }),
    });
    const runner = new SessionRunner({
      store,
      provider: new FixedResultProvider({
        content: "One-round final answer.",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
        durationMs: 1,
      }),
      limits: limits({ inferenceRounds: 1 }),
    });

    await runner.startSession(session.id);

    expect(
      store
        .getEvents(session.id)
        .filter((event) => event.type === "context.compiled")
        .map((event) => ({
          reason: event.payload.reason,
          mode: event.payload.mode,
        })),
    ).toEqual([{ reason: "session_start", mode: "finalization" }]);
    expect(store.requireSession(session.id)).toMatchObject({
      status: "completed",
      result: "One-round final answer.",
    });
  });
});
