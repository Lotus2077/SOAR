import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRunner } from "../../src/main/agent/run-session";
import type { LocalChangeReviewRuntimeV1 } from "../../src/main/agent/run-local-change-review";
import { toChangeReviewView } from "../../src/main/change-review-view";
import {
  createSoarDatabase,
  type SoarDatabase,
} from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import {
  parseProviderDescriptor,
  type ProviderDescriptor,
} from "../../src/main/providers/provider-descriptor";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";
import {
  ProviderAbortedError,
  type CompleteInput,
  type DescribedInferenceProvider,
  type ProviderResult,
} from "../../src/main/providers/types";
import { toSessionSnapshot } from "../../src/main/session-view";
import type { ReviewSynthesisPacketV1 } from "../../src/shared/review-synthesis-packet";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const databases: SoarDatabase[] = [];

const PROVIDER_ID = "scripted-local-review";
const PROVIDER_MODEL = "scripted-local-review-model";
const TARGET_PATH = "src/review-target.ts";
const TOOL_CONTENT_SENTINEL = "RAW_TOOL_CONTENT_MUST_NOT_REACH_RENDERER";
const REVIEW_CONTENT_SENTINEL = "RAW_REVIEW_JSON_MUST_NOT_REACH_SESSION_VIEW";
const REVIEW_SUMMARY = `${REVIEW_CONTENT_SENTINEL} at ${TARGET_PATH}:1`;
const REVIEW_PACKET_PREFIX = "SOAR_REVIEW_SYNTHESIS_PACKET_V1\n";
const LIMITS = { inferenceRounds: 4, toolCalls: 3 } as const;

interface CapturedCall {
  structuredOutputContract?: CompleteInput["structuredOutputContract"];
  allowTools?: boolean;
  allowedToolNames?: CompleteInput["allowedToolNames"];
  requireToolCall?: boolean;
}

type StructuredReviewFactory = (
  packet: ReviewSynthesisPacketV1,
  input: CompleteInput,
) => Record<string, unknown>;

class LocalStructuredReviewProvider implements DescribedInferenceProvider {
  readonly id = PROVIDER_ID;
  readonly model = PROVIDER_MODEL;
  readonly costPolicy = "local_zero_cost" as const;
  readonly capturedCalls: CapturedCall[] = [];
  private toolCallOrdinal = 0;

  constructor(
    readonly descriptor: ProviderDescriptor,
    private readonly beforeStructuredResult?: () => void,
    private readonly structuredResultOverrides?: Partial<ProviderResult>,
    private readonly structuredReviewFactory?: StructuredReviewFactory,
  ) {}

  estimateInputTokenReserve(): number {
    return 0;
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.capturedCalls.push({
      ...(input.structuredOutputContract === undefined
        ? {}
        : { structuredOutputContract: input.structuredOutputContract }),
      ...(input.allowTools === undefined ? {} : { allowTools: input.allowTools }),
      ...(input.allowedToolNames === undefined
        ? {}
        : { allowedToolNames: [...input.allowedToolNames] }),
      ...(input.requireToolCall === undefined
        ? {}
        : { requireToolCall: input.requireToolCall }),
    });

    if (input.structuredOutputContract === "change-review-result-v1") {
      const packet = parseReviewPacket(input);
      const rawReview = JSON.stringify(
        this.structuredReviewFactory?.(packet, input) ?? {
          schemaVersion: "change-review-result-v1",
          snapshotId: packet.snapshot.snapshotId,
          summary: REVIEW_SUMMARY,
          conclusion: "no_blocking_findings",
          evidenceSetId: packet.evidenceSet.evidenceSetId,
          omissions: [],
          findings: [],
        },
      );
      input.onDelta(rawReview);
      this.beforeStructuredResult?.();
      return {
        ...providerResult({
        content: rawReview,
        finishReason: "stop",
        toolCalls: [],
        outputTokens: 24,
        }),
        ...this.structuredResultOverrides,
      };
    }

    const toolName = input.allowedToolNames?.[0];
    if (
      input.allowTools !== true ||
      input.requireToolCall !== true ||
      input.allowedToolNames?.length !== 1 ||
      (toolName !== "inspect_git_changes" && toolName !== "read_text_file")
    ) {
      throw new Error("The review coordinator dispatched an unexpected acquisition call.");
    }
    this.toolCallOrdinal += 1;
    const arguments_ =
      toolName === "inspect_git_changes"
        ? { schemaVersion: "inspect-git-changes-v1" as const }
        : { relativePath: TARGET_PATH };
    return providerResult({
      content: `acquisition chatter ${TOOL_CONTENT_SENTINEL}`,
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: `scripted-tool-${this.toolCallOrdinal}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(arguments_),
          },
        },
      ],
      outputTokens: 8,
    });
  }
}

class ThrowingReviewProvider extends LocalStructuredReviewProvider {
  constructor(
    descriptor: ProviderDescriptor,
    private readonly providerError: Error,
  ) {
    super(descriptor);
  }

  override async complete(): Promise<ProviderResult> {
    throw this.providerError;
  }
}

class EchoingResultProvider extends LocalStructuredReviewProvider {
  constructor(
    descriptor: ProviderDescriptor,
    private readonly echoedValue: string,
  ) {
    super(descriptor);
  }

  override async complete(input: CompleteInput): Promise<ProviderResult> {
    const result = await super.complete(input);
    if (input.structuredOutputContract === undefined) return result;
    const review = JSON.parse(result.content) as Record<string, unknown>;
    return {
      ...result,
      content: JSON.stringify({
        ...review,
        summary: `${String(review.summary)} ${this.echoedValue}`,
      }),
    };
  }
}

class AbortedPartialProvider extends LocalStructuredReviewProvider {
  constructor(
    descriptor: ProviderDescriptor,
    private readonly partialContent: string,
  ) {
    super(descriptor);
  }

  override async complete(): Promise<ProviderResult> {
    throw new ProviderAbortedError(
      "Remote inference stopped.",
      this.partialContent,
      "timeout",
    );
  }
}

function providerResult(input: {
  content: string;
  finishReason: "stop" | "tool_calls";
  toolCalls: ProviderResult["toolCalls"];
  outputTokens: number;
}): ProviderResult {
  const inputTokens = 32;
  return {
    content: input.content,
    toolCalls: input.toolCalls,
    finishReason: input.finishReason,
    servedModel: PROVIDER_MODEL,
    usage: {
      inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: inputTokens + input.outputTokens,
    },
    durationMs: 2,
  };
}

function parseReviewPacket(input: CompleteInput): ReviewSynthesisPacketV1 {
  const packetMessage = input.messages.find(
    (message) =>
      message.role === "user" &&
      message.content.startsWith(REVIEW_PACKET_PREFIX),
  );
  if (packetMessage?.role !== "user") {
    throw new Error("The structured review call omitted its synthesis packet.");
  }
  return JSON.parse(
    packetMessage.content.slice(REVIEW_PACKET_PREFIX.length),
  ) as ReviewSynthesisPacketV1;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function createRepository(): Promise<string> {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "soar-local-change-review-"),
  );
  temporaryDirectories.push(workspaceRoot);
  await git(workspaceRoot, "init", "--quiet");
  await git(workspaceRoot, "config", "user.name", "SOAR Test");
  await git(workspaceRoot, "config", "user.email", "soar@example.invalid");
  await mkdir(path.join(workspaceRoot, "src"));
  await writeFile(
    path.join(workspaceRoot, TARGET_PATH),
    "export const reviewedValue = 1;\n",
    "utf8",
  );
  await git(workspaceRoot, "add", TARGET_PATH);
  await git(workspaceRoot, "commit", "--quiet", "-m", "base");
  await writeFile(
    path.join(workspaceRoot, TARGET_PATH),
    `export const reviewedValue = 2; // ${TOOL_CONTENT_SENTINEL}\n`,
    "utf8",
  );
  return workspaceRoot;
}

function createStore(): EventStore {
  const database = createSoarDatabase();
  databases.push(database);
  return new EventStore(database);
}

function descriptor(): ProviderDescriptor {
  return parseProviderDescriptor({
    id: PROVIDER_ID,
    adapter: "openai-compatible",
    locality: "local",
    model: PROVIDER_MODEL,
    enabled: true,
    capabilities: [
      "chat_completions",
      "streaming",
      "structured_json_schema",
      "tool_calling",
    ],
    contextWindowTokens: 65_536,
    maxOutputTokens: 4_096,
    requestReserveTokens: 0,
    accounting: { kind: "local_zero_cost" },
  });
}

function createReviewSession(
  store: EventStore,
  workspaceRoot: string,
  id: string,
  limits: { inferenceRounds: number; toolCalls: number } = LIMITS,
): void {
  store.createSession({
    id,
    title: "Review current changes",
    objective: "Review the current uncommitted changes for concrete defects.",
    workspaceRoot,
    profile: "balanced",
    taskTrack: "change-review-v1",
    completionObligations: {
      requiredSuccessfulTools: ["inspect_git_changes"],
      minimumVerifiedPathLineCitations: 0,
    },
    executionPolicy: {
      schemaVersion: "agentic-execution-v2",
      ...limits,
      routingPolicy: "local_only_v1",
      maxProviderChanges: 2,
      maxPaidAttempts: 1,
      maxPaidEpisodeMicrousd: 250_000,
      maxEpisodeDurationMs: 120_000,
      attemptTimeoutMs: 30_000,
      egressConsent: "none",
    },
  });
}

function createRunner(input: {
  store: EventStore;
  provider: LocalStructuredReviewProvider;
  onUpdate?: () => void;
  healthCheck?: LocalChangeReviewRuntimeV1["healthCheck"];
  limits?: { inferenceRounds: number; toolCalls: number };
  sensitiveValues?: readonly string[];
}): SessionRunner {
  return new SessionRunner({
    store: input.store,
    providerRegistry: new ProviderRegistry([
      { descriptor: input.provider.descriptor, provider: input.provider },
    ]),
    defaultLocalProviderId: PROVIDER_ID,
    limits: input.limits ?? LIMITS,
    context: { maxInputTokens: 32_768, safetyMargin: 0.1 },
    ...(input.sensitiveValues === undefined
      ? {}
      : { localReviewSensitiveValues: input.sensitiveValues }),
    ...(input.onUpdate === undefined ? {} : { onUpdate: input.onUpdate }),
    localReviewRuntime: {
      healthCheck:
        input.healthCheck ??
        (async () => ({
          providerId: PROVIDER_ID,
          model: PROVIDER_MODEL,
          locality: "local",
          status: "healthy",
          code: "configured_model_available",
        })),
    },
  });
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local change-review coordinator", () => {
  it("completes a real Git review locally, redacts raw renderer data, and withholds a drifted result", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const provider = new LocalStructuredReviewProvider(descriptor());
    const sessionId = "local-review-happy-path";
    createReviewSession(store, workspaceRoot, sessionId);
    const runner = createRunner({ store, provider });

    await runner.startSession(sessionId);

    const state = store.getProjectedState(sessionId);
    expect(state.status, state.error ?? "").toBe("completed");
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
      "evidence_complete",
    ]);
    expect(
      state.routingDecisions.at(-1)?.routerInputSnapshot?.requiredCapabilities,
    ).toContain("structured_json_schema");
    expect(
      state.routingDecisions.every(
        (decision) =>
          decision.selectedProviderId === PROVIDER_ID &&
          decision.selectedModel === PROVIDER_MODEL &&
          decision.routerInputSnapshot?.providers.every(
            (candidate) => candidate.locality === "local",
          ) !== false,
      ),
    ).toBe(true);
    expect(state.routes.every((route) => route.providerId === PROVIDER_ID)).toBe(
      true,
    );
    expect(state.inferenceAttempts).toHaveLength(3);
    expect(
      state.inferenceAttempts.every(
        (attempt) =>
          attempt.providerId === PROVIDER_ID &&
          attempt.budgetReservationId === undefined &&
          attempt.finished?.outcome === "succeeded" &&
          attempt.finished.cost.amountMicrousd === 0 &&
          attempt.finished.cost.provenance === "local_zero_cost_policy",
      ),
    ).toBe(true);
    expect(store.requireSession(sessionId).totalCostUsd).toBe(0);
    expect(
      state.messages.filter((message) => message.reviewParseStatus === "accepted"),
    ).toHaveLength(1);
    expect(provider.capturedCalls).toEqual([
      {
        allowTools: true,
        allowedToolNames: ["inspect_git_changes"],
        requireToolCall: true,
      },
      {
        allowTools: true,
        allowedToolNames: ["read_text_file"],
        requireToolCall: true,
      },
      {
        structuredOutputContract: "change-review-result-v1",
        allowTools: false,
        requireToolCall: false,
      },
    ]);

    const rawEvents = JSON.stringify(store.getEvents(sessionId));
    expect(rawEvents).toContain(TOOL_CONTENT_SENTINEL);
    expect(rawEvents).toContain(REVIEW_CONTENT_SENTINEL);

    const rendererSnapshot = JSON.stringify(toSessionSnapshot(store, sessionId));
    expect(rendererSnapshot).not.toContain(TOOL_CONTENT_SENTINEL);
    expect(rendererSnapshot).not.toContain(REVIEW_CONTENT_SENTINEL);

    const freshView = await toChangeReviewView(store, sessionId);
    expect(freshView).toMatchObject({
      status: "completed",
      freshness: "fresh_complete",
      route: {
        providerId: PROVIDER_ID,
        model: PROVIDER_MODEL,
        locality: "local",
      },
      reviewResult: {
        summary: REVIEW_SUMMARY,
        conclusion: "no_blocking_findings",
      },
      coverage: { status: "complete", snapshotRevalidated: true },
    });

    await writeFile(
      path.join(workspaceRoot, TARGET_PATH),
      "export const reviewedValue = 3; // workspace drift\n",
      "utf8",
    );
    const driftedView = await toChangeReviewView(store, sessionId);
    expect(driftedView.freshness).toBe("drifted");
    expect(driftedView).not.toHaveProperty("reviewResult");
    expect(driftedView).not.toHaveProperty("coverage");
  });

  it("communicates and accepts blocking precedence when host coverage is incomplete", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const limits = { inferenceRounds: 2, toolCalls: 1 };
    const provider = new LocalStructuredReviewProvider(
      descriptor(),
      undefined,
      undefined,
      (packet, input) => {
        const systemPrompt = input.messages.find(
          (message) => message.role === "system",
        )?.content;
        expect(systemPrompt).toContain(
          "if any finding is P0 or P1, use blocking_findings even when coverage is incomplete or omissions exist",
        );
        expect(systemPrompt).toContain(
          "otherwise, if coverage is incomplete or any omission exists, use incomplete",
        );
        expect(systemPrompt).toContain(
          "only complete coverage with no P0 or P1 finding may use no_blocking_findings",
        );

        const entry = packet.snapshot.manifest[0];
        const hunk = entry?.hunks[0];
        const line = hunk?.lines.find((candidate) => candidate.newLine !== null);
        if (!entry || !hunk || !hunk.newPath || line?.newLine === null || line === undefined) {
          throw new Error("The blocking-precedence fixture requires one working-side changed line.");
        }
        return {
          schemaVersion: "change-review-result-v1",
          snapshotId: packet.snapshot.snapshotId,
          summary:
            "A blocking defect is present, but full-file coverage is incomplete.",
          conclusion: "blocking_findings",
          evidenceSetId: packet.evidenceSet.evidenceSetId,
          omissions: [
            {
              code: "changed_file_not_fully_read",
              description:
                "The bounded run did not include a full read of every changed file.",
            },
          ],
          findings: [
            {
              findingId: "blocking-incomplete-coverage",
              severity: "P1",
              title: "Blocking defect in the changed line",
              impact: "The changed behavior can produce an incorrect runtime result.",
              suggestedCorrection: "Correct the changed expression before merging.",
              suggestedTest: "Add a regression that exercises the changed behavior.",
              evidence: [
                {
                  kind: "change",
                  snapshotId: packet.snapshot.snapshotId,
                  path: hunk.newPath,
                  side: "working",
                  line: line.newLine,
                  hunkSha256: hunk.hunkSha256,
                },
              ],
            },
          ],
        };
      },
    );
    const sessionId = "local-review-blocking-incomplete-precedence";
    createReviewSession(store, workspaceRoot, sessionId, limits);
    const runner = createRunner({ store, provider, limits });

    await runner.startSession(sessionId);

    const state = store.getProjectedState(sessionId);
    expect(state.status, state.error ?? "").toBe("completed");
    expect(state.inferenceAttempts).toHaveLength(2);
    expect(state.messages.at(-1)).toMatchObject({
      reviewParseStatus: "accepted",
      reviewResult: { conclusion: "blocking_findings" },
      reviewCoverage: {
        status: "incomplete",
        omissionCodes: ["changed_file_not_fully_read"],
      },
    });

    const view = await toChangeReviewView(store, sessionId);
    expect(view).toMatchObject({
      status: "completed",
      freshness: "identity_same_unverifiable",
      reviewResult: {
        conclusion: "blocking_findings",
        findings: [{ severity: "P1" }],
      },
      coverage: {
        status: "incomplete",
        omissionCodes: ["changed_file_not_fully_read"],
      },
    });
  });

  it("lets cancellation win immediately before a valid structured result resolves", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const sessionId = "local-review-cancellation-race";
    createReviewSession(store, workspaceRoot, sessionId);
    let cancel = (): void => {
      throw new Error("The cancellation callback ran before runner setup.");
    };
    const provider = new LocalStructuredReviewProvider(descriptor(), () =>
      cancel(),
    );
    const runner = createRunner({ store, provider });
    cancel = () => runner.cancelSession(sessionId);

    await runner.startSession(sessionId);

    const state = store.getProjectedState(sessionId);
    expect(state.status).toBe("cancelled");
    expect(state.result).toBeUndefined();
    expect(
      state.inferenceAttempts.every((attempt) => attempt.finished !== undefined),
    ).toBe(true);
    expect(state.inferenceAttempts.at(-1)?.finished?.outcome).toBe("cancelled");
    expect(
      state.messages.filter((message) => message.reviewParseStatus === "accepted"),
    ).toHaveLength(0);
    expect(
      state.messages.filter(
        (message) => message.reviewParseStatus === "not_received",
      ),
    ).toHaveLength(1);
    expect(
      state.messages.some(
        (message) =>
          message.reviewResult !== undefined || message.reviewCoverage !== undefined,
      ),
    ).toBe(false);
    expect(
      store
        .getEvents(sessionId)
        .filter((event) => event.type === "session.completed"),
    ).toHaveLength(0);

    const view = await toChangeReviewView(store, sessionId);
    expect(view).toMatchObject({
      status: "cancelled",
      freshness: "not_available",
    });
    expect(view).not.toHaveProperty("reviewResult");
    expect(view).not.toHaveProperty("coverage");
  });

  it("preserves cancellation when rejected telemetry also forces normalization fallback", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const sessionId = "local-review-cancelled-malformed-telemetry";
    createReviewSession(store, workspaceRoot, sessionId);
    let cancel = (): void => {
      throw new Error("The cancellation callback ran before runner setup.");
    };
    const provider = new LocalStructuredReviewProvider(
      descriptor(),
      () => cancel(),
      { timeToFirstTokenMs: Number.NaN },
    );
    const runner = createRunner({ store, provider });
    cancel = () => runner.cancelSession(sessionId);

    await runner.startSession(sessionId);

    const state = store.getProjectedState(sessionId);
    expect(state.status).toBe("cancelled");
    expect(state.inferenceAttempts.at(-1)?.finished).toMatchObject({
      outcome: "cancelled",
      requestDisposition: "sent",
      errorCode: "user_cancelled",
      usage: { reported: false },
    });
    expect(state.result).toBeUndefined();
    expect(state.messages.at(-1)).toMatchObject({
      completionState: "incomplete",
      stopReason: "cancelled",
      reviewParseStatus: "not_received",
    });
  });

  it("does not schedule synthesis after cancellation at the final evidence boundary", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const sessionId = "local-review-cancelled-after-evidence";
    createReviewSession(store, workspaceRoot, sessionId);
    const provider = new LocalStructuredReviewProvider(descriptor());
    let runner: SessionRunner;
    let cancelled = false;
    runner = createRunner({
      store,
      provider,
      onUpdate: () => {
        if (cancelled) return;
        const completedRead = store
          .getEvents(sessionId)
          .some(
            (event) =>
              event.type === "tool.call.completed" &&
              event.payload.name === "read_text_file",
          );
        if (completedRead) {
          cancelled = true;
          runner.cancelSession(sessionId);
        }
      },
    });

    await runner.startSession(sessionId);

    const state = store.getProjectedState(sessionId);
    expect(cancelled).toBe(true);
    expect(state.status).toBe("cancelled");
    expect(state.routingDecisions.map((decision) => decision.boundary)).toEqual([
      "session_start",
    ]);
    expect(
      state.inferenceAttempts.filter((attempt) => attempt.phase === "synthesis"),
    ).toHaveLength(0);
  });

  it("treats renderer update delivery as best-effort after canonical commits", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const provider = new LocalStructuredReviewProvider(descriptor());
    const sessionId = "local-review-update-subscriber-throws";
    createReviewSession(store, workspaceRoot, sessionId);
    const runner = createRunner({
      store,
      provider,
      onUpdate: () => {
        throw new Error("renderer disappeared");
      },
    });

    await runner.startSession(sessionId);

    const state = store.getProjectedState(sessionId);
    expect(state.status, state.error ?? "").toBe("completed");
    expect(
      state.inferenceAttempts.every(
        (attempt) => attempt.finished?.outcome === "succeeded",
      ),
    ).toBe(true);
  });

  it("persists running start intent before bounded model discovery", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const provider = new LocalStructuredReviewProvider(descriptor());
    const sessionId = "local-review-health-start-intent";
    createReviewSession(store, workspaceRoot, sessionId);
    let releaseHealth: (() => void) | undefined;
    const healthGate = new Promise<void>((resolve) => {
      releaseHealth = resolve;
    });
    const runner = createRunner({
      store,
      provider,
      healthCheck: async () => {
        await healthGate;
        return {
          providerId: PROVIDER_ID,
          model: PROVIDER_MODEL,
          locality: "local",
          status: "unhealthy",
          code: "network_error",
        };
      },
    });

    const pending = runner.startSession(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.requireSession(sessionId).status).toBe("running");
    expect(
      store.getEvents(sessionId).filter((event) => event.type === "session.started"),
    ).toHaveLength(1);

    releaseHealth?.();
    await pending;
    expect(store.requireSession(sessionId).status).toBe("failed");
    expect(provider.capturedCalls).toHaveLength(0);
  });

  it("never persists or renders opaque provider error secrets and endpoints", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const opaqueSecret = "opaque-review-bearer-7qZ2vN4mP9";
    const credentialedEndpoint =
      "https://endpoint-user:endpoint-password@review.example.invalid/v1";
    const provider = new ThrowingReviewProvider(
      descriptor(),
      new Error(
        `Remote server echoed authorization ${opaqueSecret} from ${credentialedEndpoint}`,
      ),
    );
    const sessionId = "local-review-provider-error-redaction";
    createReviewSession(store, workspaceRoot, sessionId);
    const runner = createRunner({
      store,
      provider,
      sensitiveValues: [opaqueSecret, credentialedEndpoint],
    });

    await runner.startSession(sessionId);

    const rawEvents = JSON.stringify(store.getEvents(sessionId));
    const rendererSnapshot = JSON.stringify(toSessionSnapshot(store, sessionId));
    expect(store.requireSession(sessionId).status).toBe("failed");
    expect(rawEvents).toContain(
      "The local review provider request failed (provider_error).",
    );
    for (const sensitiveValue of [opaqueSecret, credentialedEndpoint]) {
      expect(rawEvents).not.toContain(sensitiveValue);
      expect(rendererSnapshot).not.toContain(sensitiveValue);
    }
  });

  it("rejects a successful structured response that echoes exact sensitive values", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const opaqueSecret = "opaque-result-bearer-4Nq8Zp2L";
    const providerEndpoint = "https://review-provider.example.invalid/v1";
    const provider = new EchoingResultProvider(
      descriptor(),
      `${opaqueSecret} ${providerEndpoint}`,
    );
    const sessionId = "local-review-provider-result-sensitive";
    createReviewSession(store, workspaceRoot, sessionId);
    const runner = createRunner({
      store,
      provider,
      sensitiveValues: [opaqueSecret, providerEndpoint],
    });

    await runner.startSession(sessionId);

    const rawEvents = JSON.stringify(store.getEvents(sessionId));
    const rendererSnapshot = JSON.stringify(toSessionSnapshot(store, sessionId));
    expect(store.requireSession(sessionId).status).toBe("failed");
    expect(store.getProjectedState(sessionId).inferenceAttempts.at(-1)?.finished).toMatchObject({
      outcome: "protocol_error",
      requestDisposition: "sent",
      errorCode: "provider_sensitive_output",
    });
    expect(rawEvents).toContain("provider_sensitive_output");
    for (const sensitiveValue of [opaqueSecret, providerEndpoint]) {
      expect(rawEvents).not.toContain(sensitiveValue);
      expect(rendererSnapshot).not.toContain(sensitiveValue);
    }
  });

  it("never persists arbitrary partial provider content from an aborted review", async () => {
    const workspaceRoot = await createRepository();
    const store = createStore();
    const partialContent = "ARBITRARY_ABORT_PARTIAL_WITH_HALF_A_CREDENTIAL";
    const provider = new AbortedPartialProvider(descriptor(), partialContent);
    const sessionId = "local-review-provider-abort-partial";
    createReviewSession(store, workspaceRoot, sessionId);
    const runner = createRunner({ store, provider });

    await runner.startSession(sessionId);

    const rawEvents = JSON.stringify(store.getEvents(sessionId));
    const rendererSnapshot = JSON.stringify(toSessionSnapshot(store, sessionId));
    expect(store.requireSession(sessionId).status).toBe("failed");
    expect(store.getProjectedState(sessionId).inferenceAttempts.at(-1)?.finished).toMatchObject({
      outcome: "timeout",
      errorCode: "attempt_timeout",
    });
    expect(rawEvents).not.toContain(partialContent);
    expect(rendererSnapshot).not.toContain(partialContent);
  });
});
