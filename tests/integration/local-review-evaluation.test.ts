import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runLocalReviewEvaluationV1,
} from "../../src/benchmark/local-review-evaluation";
import {
  localReviewAuthorityInternals,
  releaseLocalReviewLiveAuthorityAfterNoDispatch,
} from "../../src/benchmark/local-review-authority";
import { parseProviderDescriptor } from "../../src/main/providers/provider-descriptor";
import { ProviderRegistry } from "../../src/main/providers/provider-registry";
import type {
  CompleteInput,
  DescribedInferenceProvider,
  ProviderResult,
} from "../../src/main/providers/types";
import type { ReviewSynthesisPacketV1 } from "../../src/shared/review-synthesis-packet";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const MODEL = "scripted-local-review-evaluation";
const PROVIDER_ID = "scripted-local-review-evaluation";
const REVIEW_PACKET_PREFIX = "SOAR_REVIEW_SYNTHESIS_PACKET_V1\n";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function environment(optIn = true): NodeJS.ProcessEnv {
  return {
    SOAR_VLLM_BASE_URL: "http://localhost:8000/v1",
    SOAR_VLLM_API_KEY: "",
    SOAR_VLLM_MODEL: MODEL,
    SOAR_VLLM_COST_POLICY: "local_zero_cost",
    SOAR_ALLOW_INSECURE_VLLM_HTTP: "false",
    SOAR_PROVIDER_MODE: "local",
    SOAR_MAX_INFERENCE_ROUNDS: "4",
    SOAR_MAX_TOOL_CALLS: "3",
    SOAR_MAX_OUTPUT_TOKENS: "8192",
    SOAR_REQUEST_TIMEOUT_MS: "300000",
    SOAR_CONTEXT_MAX_INPUT_TOKENS: "163840",
    SOAR_CONTEXT_SAFETY_MARGIN: "0.2",
    SOAR_RUN_LIVE_LOCAL_REVIEW_V1: optIn ? "true" : "false",
  };
}

function providerResult(options: {
  content: string;
  finishReason: "tool_calls" | "stop";
  toolCalls: ProviderResult["toolCalls"];
  outputTokens: number;
}): ProviderResult {
  return {
    content: options.content,
    finishReason: options.finishReason,
    toolCalls: options.toolCalls,
    servedModel: MODEL,
    usage: {
      inputTokens: 128,
      outputTokens: options.outputTokens,
      totalTokens: 128 + options.outputTokens,
      reasoningTokens: 0,
    },
    durationMs: 2,
  };
}

class ScriptedEvaluationProvider implements DescribedInferenceProvider {
  readonly id = PROVIDER_ID;
  readonly model = MODEL;
  readonly costPolicy = "local_zero_cost" as const;
  readonly descriptor = parseProviderDescriptor({
    id: PROVIDER_ID,
    adapter: "openai-compatible",
    locality: "local",
    model: MODEL,
    enabled: true,
    capabilities: [
      "chat_completions",
      "streaming",
      "structured_json_schema",
      "tool_calling",
    ],
    contextWindowTokens: 172_032,
    maxOutputTokens: 8_192,
    requestReserveTokens: 0,
    accounting: { kind: "local_zero_cost" },
  });
  completionCalls = 0;
  healthCheckCalls = 0;
  private readIndex = 0;

  constructor(
    private readonly summary =
      "The documentation-only change is internally consistent.",
    private readonly healthStatuses: readonly ("healthy" | "unhealthy")[] = [
      "healthy",
    ],
    private readonly onHealthCheck?: (callNumber: number) => void,
    private readonly onCompletionCall?: (callNumber: number) => void,
  ) {}

  estimateInputTokenReserve(): number {
    return 0;
  }

  async checkConfiguredModelAvailability() {
    const status =
      this.healthStatuses[
        Math.min(this.healthCheckCalls, this.healthStatuses.length - 1)
      ] ?? "unhealthy";
    this.healthCheckCalls += 1;
    this.onHealthCheck?.(this.healthCheckCalls);
    return {
      providerId: this.id,
      model: this.model,
      locality: "local" as const,
      status,
      code:
        status === "healthy"
          ? ("configured_model_available" as const)
          : ("configured_model_missing" as const),
    };
  }

  async complete(input: CompleteInput): Promise<ProviderResult> {
    this.completionCalls += 1;
    this.onCompletionCall?.(this.completionCalls);
    if (input.structuredOutputContract === "change-review-result-v1") {
      const packetMessage = input.messages.find(
        (message) =>
          message.role === "user" &&
          message.content.startsWith(REVIEW_PACKET_PREFIX),
      );
      if (packetMessage?.role !== "user") {
        throw new Error("Missing review synthesis packet.");
      }
      const packet = JSON.parse(
        packetMessage.content.slice(REVIEW_PACKET_PREFIX.length),
      ) as ReviewSynthesisPacketV1;
      const content = JSON.stringify({
        schemaVersion: "change-review-result-v1",
        snapshotId: packet.snapshot.snapshotId,
        summary: this.summary,
        conclusion: "no_blocking_findings",
        evidenceSetId: packet.evidenceSet.evidenceSetId,
        omissions: [],
        findings: [],
      });
      input.onDelta(content);
      return providerResult({
        content,
        finishReason: "stop",
        toolCalls: [],
        outputTokens: 32,
      });
    }

    const toolName = input.allowedToolNames?.[0];
    if (
      input.allowTools !== true ||
      input.requireToolCall !== true ||
      input.allowedToolNames?.length !== 1 ||
      (toolName !== "inspect_git_changes" && toolName !== "read_text_file")
    ) {
      throw new Error("Unexpected local-review acquisition request.");
    }
    const relativePath = [
      "docs/BUILD_LOG.md",
      "docs/plans/HYBRID_LEASE_ROUTER_V0.md",
    ][this.readIndex];
    if (toolName === "read_text_file") this.readIndex += 1;
    return providerResult({
      content: "bounded acquisition",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: `scripted-${this.completionCalls}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(
              toolName === "inspect_git_changes"
                ? { schemaVersion: "inspect-git-changes-v1" }
                : { relativePath },
            ),
          },
        },
      ],
      outputTokens: 8,
    });
  }
}

async function outputRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "soar-local-review-run-"));
  temporaryDirectories.push(root);
  return root;
}

function dependencies(
  provider: ScriptedEvaluationProvider,
  authorityRoot: string,
) {
  return {
    resolveCleanImplementationRevision: () => "a".repeat(40),
    createProviderCatalog: () => ({
      registry: new ProviderRegistry([
        { descriptor: provider.descriptor, provider },
      ]),
      defaultLocalProviderId: provider.id,
    }),
    claimLiveAuthority: (input: {
      runId: string;
      implementationRevision: string;
    }) =>
      localReviewAuthorityInternals.claimAtLedgerRoot(input, {
        ledgerRoot: authorityRoot,
      }),
    releaseLiveAuthorityAfterNoDispatch:
      releaseLocalReviewLiveAuthorityAfterNoDispatch,
  };
}

describe("local review evaluation bridge", () => {
  it("runs the frozen nonempty fixture through the production coordinator", async () => {
    const provider = new ScriptedEvaluationProvider();
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-pass",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(provider, authorityRoot),
    });
    expect(summary).toMatchObject({
      status: "passed",
      implementationRevision: "a".repeat(40),
      eventCount: expect.any(Number),
      selectedMeteredExposureMicrousd: 0,
      resultRelativePath:
        "local-review-v1/deterministic-pass/cal-001-soar-plan-approval/result.json",
      publicationMarkerRelativePath:
        "local-review-v1/deterministic-pass/cal-001-soar-plan-approval/publication.complete-v1.json",
    });
    expect(provider.completionCalls).toBe(4);
    const record = JSON.parse(
      await readFile(path.join(root, summary.resultRelativePath), "utf8"),
    );
    expect(record).toMatchObject({
      status: "passed",
      source: "canonical_event_store",
      projection: "local-review-safe-v1",
      lossy: true,
      rawCanonicalTraceExported: false,
      fixture: { changedPathCount: 2, changedLineCount: 43 },
      execution: {
        routingBoundaries: ["session_start", "evidence_complete"],
        providerSwitchCount: 0,
        inferenceAttemptCount: 4,
        successfulToolCount: 3,
        cost: { amountMicrousd: 0, provenance: "local_zero_cost_policy" },
      },
      review: { freshness: "fresh_complete" },
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(root, summary.publicationMarkerRelativePath),
          "utf8",
        ),
      ),
    ).toMatchObject({
      schemaVersion: "local-review-publication-complete-v1",
      resultSha256: summary.resultSha256,
      safeTraceSha256: summary.safeTraceSha256,
    });

    const secondProvider = new ScriptedEvaluationProvider();
    const blocked = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-second-run",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(secondProvider, authorityRoot),
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      failureCode: "live_authority_already_consumed",
    });
    expect(secondProvider.completionCalls).toBe(0);
  }, 30_000);

  it("accepts the coordinator's synthesis health revalidation after its TTL", async () => {
    // Keep the injected clock decisively ahead of wall time so parallel full-
    // suite load cannot let EventStore creation timestamps overtake it.
    let clockMs = Date.now() + 86_400_000;
    const provider = new ScriptedEvaluationProvider(
      "The documentation-only change is internally consistent.",
      ["healthy", "healthy", "healthy"],
      undefined,
      (callNumber) => {
        if (callNumber === 3) clockMs += 60_001;
      },
    );
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-health-ttl-revalidation",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: {
        ...dependencies(provider, authorityRoot),
        createLocalReviewRuntime: (healthCheck) => ({
          healthCheck,
          clock: () => new Date(clockMs),
        }),
      },
    });
    expect(summary.status).toBe("passed");
    expect(provider.healthCheckCalls).toBe(3);
    expect(provider.completionCalls).toBe(4);
  }, 30_000);

  it("blocks before catalog construction when either live opt-in is absent", async () => {
    const provider = new ScriptedEvaluationProvider();
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    let catalogConstructions = 0;
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-block",
      allowProviderDispatch: true,
      environment: environment(false),
      dependencies: {
        ...dependencies(provider, authorityRoot),
        createProviderCatalog: () => {
          catalogConstructions += 1;
          return dependencies(provider, authorityRoot).createProviderCatalog();
        },
      },
    });
    expect(summary).toMatchObject({
      status: "blocked",
      failureCode: "live_opt_in_missing",
      eventCount: 0,
    });
    expect(catalogConstructions).toBe(0);
    expect(provider.completionCalls).toBe(0);

    const commandFlagBlocked = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-command-flag-block",
      allowProviderDispatch: false,
      environment: environment(true),
      dependencies: {
        ...dependencies(provider, authorityRoot),
        createProviderCatalog: () => {
          catalogConstructions += 1;
          return dependencies(provider, authorityRoot).createProviderCatalog();
        },
      },
    });
    expect(commandFlagBlocked).toMatchObject({
      status: "blocked",
      failureCode: "live_opt_in_missing",
      eventCount: 0,
    });
    expect(catalogConstructions).toBe(0);
    expect(provider.completionCalls).toBe(0);

    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelled = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-cancelled-before-catalog",
      allowProviderDispatch: true,
      environment: environment(true),
      signal: cancelledController.signal,
      dependencies: {
        ...dependencies(provider, authorityRoot),
        createProviderCatalog: () => {
          catalogConstructions += 1;
          return dependencies(provider, authorityRoot).createProviderCatalog();
        },
      },
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      failureCode: "cancelled_before_dispatch",
      eventCount: 0,
    });
    expect(catalogConstructions).toBe(0);
    expect(provider.healthCheckCalls).toBe(0);
    expect(provider.completionCalls).toBe(0);

    await expect(
      runLocalReviewEvaluationV1({
        projectRoot,
        sourceRepository: projectRoot,
        outputRoot: root,
        runId: "deterministic-block",
        allowProviderDispatch: true,
        environment: environment(true),
        dependencies: {
          ...dependencies(provider, authorityRoot),
          createProviderCatalog: () => {
            catalogConstructions += 1;
            return dependencies(
              provider,
              authorityRoot,
            ).createProviderCatalog();
          },
        },
      }),
    ).rejects.toMatchObject({
      name: "LocalReviewEvaluationAdmissionError",
      code: "run_namespace_unavailable",
    });
    expect(catalogConstructions).toBe(0);
    expect(provider.completionCalls).toBe(0);
  }, 30_000);

  it("classifies unavailable implementation and fixture inputs before dispatch", async () => {
    const provider = new ScriptedEvaluationProvider();
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    await expect(
      runLocalReviewEvaluationV1({
        projectRoot,
        sourceRepository: projectRoot,
        outputRoot: root,
        runId: "deterministic-missing-revision",
        allowProviderDispatch: true,
        environment: environment(),
        dependencies: {
          ...dependencies(provider, authorityRoot),
          resolveCleanImplementationRevision: () => {
            throw new Error("dirty or missing revision");
          },
        },
      }),
    ).rejects.toMatchObject({
      name: "LocalReviewEvaluationAdmissionError",
      code: "implementation_revision_unavailable",
    });

    await expect(
      runLocalReviewEvaluationV1({
        projectRoot,
        sourceRepository: path.join(root, "missing-source"),
        outputRoot: root,
        runId: "deterministic-missing-fixture",
        allowProviderDispatch: true,
        environment: environment(),
        dependencies: dependencies(provider, authorityRoot),
      }),
    ).rejects.toMatchObject({
      name: "LocalReviewEvaluationAdmissionError",
      code: "fixture_unavailable",
    });
    expect(provider.healthCheckCalls).toBe(0);
    expect(provider.completionCalls).toBe(0);
  });

  it("records a second model-list failure as blocked and releases unused authority", async () => {
    const unavailable = new ScriptedEvaluationProvider(
      "The unavailable provider must not synthesize.",
      ["healthy", "unhealthy"],
    );
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const blocked = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-health-block",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(unavailable, authorityRoot),
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      failureCode: "provider_health_unavailable",
    });
    expect(unavailable.healthCheckCalls).toBe(2);
    expect(unavailable.completionCalls).toBe(0);

    const healthy = new ScriptedEvaluationProvider();
    const recovered = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-health-recovered",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(healthy, authorityRoot),
    });
    expect(recovered.status).toBe("passed");
    expect(healthy.completionCalls).toBe(4);
  }, 30_000);

  it("preserves cancellation during the coordinator health check and releases unused authority", async () => {
    const controller = new AbortController();
    const cancelledProvider = new ScriptedEvaluationProvider(
      "The cancelled provider must not synthesize.",
      ["healthy", "healthy"],
      (callNumber) => {
        if (callNumber === 2) controller.abort();
      },
    );
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const cancelled = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-health-cancelled",
      allowProviderDispatch: true,
      environment: environment(),
      signal: controller.signal,
      dependencies: dependencies(cancelledProvider, authorityRoot),
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      failureCode: "session_cancelled",
    });
    expect(cancelled.eventCount).toBeGreaterThan(0);
    expect(cancelledProvider.healthCheckCalls).toBe(2);
    expect(cancelledProvider.completionCalls).toBe(0);

    const healthy = new ScriptedEvaluationProvider();
    const recovered = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-health-cancelled-recovered",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(healthy, authorityRoot),
    });
    expect(recovered.status).toBe("passed");
    expect(healthy.completionCalls).toBe(4);
  }, 30_000);

  it("retains live authority when a no-dispatch result cannot be published", async () => {
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const runId = "deterministic-publication-failure";
    const unavailable = new ScriptedEvaluationProvider(
      "The unavailable provider must not synthesize.",
      ["healthy", "unhealthy"],
      (callNumber) => {
        if (callNumber === 2) {
          mkdirSync(
            path.join(
              root,
              "local-review-v1",
              runId,
              "cal-001-soar-plan-approval",
            ),
            { recursive: true },
          );
        }
      },
    );
    await expect(
      runLocalReviewEvaluationV1({
        projectRoot,
        sourceRepository: projectRoot,
        outputRoot: root,
        runId,
        allowProviderDispatch: true,
        environment: environment(),
        dependencies: dependencies(unavailable, authorityRoot),
      }),
    ).rejects.toThrow(/final run target already exists/u);
    expect(unavailable.completionCalls).toBe(0);

    const healthy = new ScriptedEvaluationProvider();
    const blocked = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-after-publication-failure",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(healthy, authorityRoot),
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      failureCode: "live_authority_already_consumed",
    });
    expect(healthy.completionCalls).toBe(0);
  }, 30_000);

  it("revalidates the exact clean revision after health and before authority", async () => {
    const provider = new ScriptedEvaluationProvider();
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    let revisionChecks = 0;
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-revision-change",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: {
        ...dependencies(provider, authorityRoot),
        resolveCleanImplementationRevision: () => {
          revisionChecks += 1;
          return revisionChecks === 1 ? "a".repeat(40) : "b".repeat(40);
        },
      },
    });
    expect(summary).toMatchObject({
      status: "blocked",
      failureCode: "implementation_revision_changed",
    });
    expect(revisionChecks).toBe(2);
    expect(provider.healthCheckCalls).toBe(1);
    expect(provider.completionCalls).toBe(0);
  }, 30_000);

  it("invalidates a completed episode if the committed revision changes after dispatch", async () => {
    const provider = new ScriptedEvaluationProvider();
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    let revisionChecks = 0;
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-post-dispatch-revision-change",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: {
        ...dependencies(provider, authorityRoot),
        resolveCleanImplementationRevision: () => {
          revisionChecks += 1;
          return revisionChecks <= 2 ? "a".repeat(40) : "b".repeat(40);
        },
      },
    });
    expect(summary).toMatchObject({
      status: "invalid",
      failureCode: "implementation_revision_changed",
    });
    expect(revisionChecks).toBe(3);
    expect(provider.completionCalls).toBe(4);

    const secondProvider = new ScriptedEvaluationProvider();
    const blocked = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-after-revision-change",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(secondProvider, authorityRoot),
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      failureCode: "live_authority_already_consumed",
    });
    expect(secondProvider.completionCalls).toBe(0);
  }, 30_000);

  it("fails closed when the provider echoes a configured sensitive value", async () => {
    const provider = new ScriptedEvaluationProvider("http://localhost:8000/v1");
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-sensitive",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(provider, authorityRoot),
    });
    expect(summary).toMatchObject({
      status: "failed",
      failureCode: "unsafe_output",
      eventCount: 0,
    });
    const result = await readFile(
      path.join(root, summary.resultRelativePath),
      "utf8",
    );
    const trace = await readFile(
      path.join(root, summary.safeTraceRelativePath),
      "utf8",
    );
    expect(`${result}\n${trace}`).not.toContain("http://localhost:8000/v1");
  }, 30_000);

  it("drops an unsafe accepted review while retaining safe canonical execution evidence", async () => {
    const provider = new ScriptedEvaluationProvider(
      "See https://example.invalid/private-report for the result.",
    );
    const root = await outputRoot();
    const authorityRoot = path.join(await realpath(root), "authority-ledger");
    const summary = await runLocalReviewEvaluationV1({
      projectRoot,
      sourceRepository: projectRoot,
      outputRoot: root,
      runId: "deterministic-unsafe-review",
      allowProviderDispatch: true,
      environment: environment(),
      dependencies: dependencies(provider, authorityRoot),
    });
    expect(summary).toMatchObject({
      status: "invalid",
      failureCode: "unsafe_output",
    });
    expect(summary.eventCount).toBeGreaterThan(0);
    const result = JSON.parse(
      await readFile(path.join(root, summary.resultRelativePath), "utf8"),
    );
    const trace = await readFile(
      path.join(root, summary.safeTraceRelativePath),
      "utf8",
    );
    expect(result).toMatchObject({
      status: "invalid",
      failureCode: "unsafe_output",
      execution: {
        terminalStatus: "completed",
        inferenceAttemptCount: 4,
        successfulToolCount: 3,
      },
      artifacts: { safeTrace: { events: summary.eventCount } },
    });
    expect(JSON.stringify(result)).not.toContain("https://example.invalid");
    expect(trace).not.toContain("https://example.invalid");
  }, 30_000);
});
