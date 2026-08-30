import { execFileSync } from "node:child_process";
import path from "node:path";

import { SessionRunner } from "../main/agent/run-session";
import type { LocalChangeReviewRuntimeV1 } from "../main/agent/run-local-change-review";
import { toChangeReviewView } from "../main/change-review-view";
import { loadConfig, type SoarConfig } from "../main/config";
import { createSoarDatabase } from "../main/database";
import { EventStore } from "../main/event-store";
import { startLocalChangeReviewSession } from "../main/local-change-review-session";
import {
  createRuntimeProviderCatalog,
  type RuntimeProviderCatalog,
} from "../main/providers/runtime-catalog";
import type { ProviderRegistration } from "../main/providers/provider-registry";
import type { ProviderModelAvailabilityResult } from "../main/providers/types";
import type { SessionState } from "../shared/session-reducer";
import {
  claimLocalReviewLiveAuthority,
  releaseLocalReviewLiveAuthorityAfterNoDispatch,
  type ClaimedLocalReviewAuthority,
  type LocalReviewAuthorityResult,
} from "./local-review-authority";
import {
  LOCAL_REVIEW_FIXTURE_ID,
  materializeLocalReviewFixtureV1,
  type MaterializedLocalReviewFixtureV1,
} from "./local-review-fixture";
import {
  LOCAL_REVIEW_EVALUATION_NON_CLAIMS,
  acceptedReviewForRecord,
  assertSafeLocalReviewArtifactContents,
  canonicalLocalReviewEvents,
  exportLocalReviewEvaluationV1,
  reserveLocalReviewRunNamespaceV1,
  sessionData,
  type LocalReviewEvaluationRecordV1,
  type LocalReviewRunReservationV1,
  type SafeLocalReviewEventV1,
} from "./local-review-safe-record";

export const LIVE_LOCAL_REVIEW_OPT_IN =
  "SOAR_RUN_LIVE_LOCAL_REVIEW_V1" as const;

export class LocalReviewEvaluationAdmissionError extends Error {
  constructor(
    readonly code:
      | "implementation_revision_unavailable"
      | "fixture_unavailable"
      | "run_namespace_unavailable",
  ) {
    super(code);
    this.name = "LocalReviewEvaluationAdmissionError";
  }
}

const REQUIRED_LIVE_CONFIGURATION = Object.freeze({
  maxInputTokens: 163_840,
  safetyMargin: 0.2,
  inferenceRounds: 4,
  toolCalls: 3,
  maxOutputTokens: 8_192,
});

const IMPLEMENTATION_GIT_ENVIRONMENT: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  TMPDIR: "/tmp",
  TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_PROTOCOL_FROM_USER: "0",
  GIT_TERMINAL_PROMPT: "0",
};

const IMPLEMENTATION_GIT_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "diff.external=",
  "-c",
  "diff.trustExitCode=false",
  "-c",
  "protocol.allow=never",
] as const;

function dispatchedOrUncertain(
  state: Pick<SessionState, "inferenceAttempts">,
): boolean {
  return state.inferenceAttempts.some(
    (attempt) =>
      attempt.finished === undefined ||
      attempt.finished.requestDisposition === "sent" ||
      attempt.finished.requestDisposition === "unknown",
  );
}

export type LocalReviewEvaluationStatus = LocalReviewEvaluationRecordV1["status"];

export interface LocalReviewEvaluationSummaryV1 {
  schemaVersion: "local-review-evaluation-summary-v1";
  status: LocalReviewEvaluationStatus;
  runId: string;
  implementationRevision: string;
  fixtureId: typeof LOCAL_REVIEW_FIXTURE_ID;
  resultRelativePath: string;
  safeTraceRelativePath: string;
  publicationMarkerRelativePath: string;
  resultSha256: string;
  safeTraceSha256: string;
  publicationMarkerSha256: string;
  resultBytes: number;
  safeTraceBytes: number;
  publicationMarkerBytes: number;
  eventCount: number;
  selectedMeteredExposureMicrousd: 0;
  failureCode?: string;
}

interface EvaluationDependencies {
  createProviderCatalog(config: SoarConfig): RuntimeProviderCatalog;
  resolveCleanImplementationRevision(projectRoot: string): string;
  claimLiveAuthority(input: {
    runId: string;
    implementationRevision: string;
  }): Promise<LocalReviewAuthorityResult>;
  releaseLiveAuthorityAfterNoDispatch(
    claim: ClaimedLocalReviewAuthority,
    state: Pick<SessionState, "inferenceAttempts">,
  ): Promise<void>;
  createLocalReviewRuntime(
    healthCheck: NonNullable<LocalChangeReviewRuntimeV1["healthCheck"]>,
  ): LocalChangeReviewRuntimeV1;
}

function resolveCleanImplementationRevision(projectRoot: string): string {
  const revision = execFileSync(
    "/usr/bin/git",
    [
      ...IMPLEMENTATION_GIT_CONFIG,
      "-C",
      projectRoot,
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ],
    {
      encoding: "utf8",
      env: IMPLEMENTATION_GIT_ENVIRONMENT,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  const status = execFileSync(
    "/usr/bin/git",
    [
      ...IMPLEMENTATION_GIT_CONFIG,
      "-C",
      projectRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ],
    {
      encoding: "utf8",
      env: IMPLEMENTATION_GIT_ENVIRONMENT,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (!/^[0-9a-f]{40}$/u.test(revision) || status.length !== 0) {
    throw new Error("Local-review evaluation requires a clean committed revision.");
  }
  return revision;
}

/** @internal Deterministic admission-contract tests only. */
export const localReviewEvaluationInternals = Object.freeze({
  resolveCleanImplementationRevision,
});

const DEFAULT_DEPENDENCIES: EvaluationDependencies = {
  createProviderCatalog: createRuntimeProviderCatalog,
  resolveCleanImplementationRevision,
  claimLiveAuthority: claimLocalReviewLiveAuthority,
  releaseLiveAuthorityAfterNoDispatch:
    releaseLocalReviewLiveAuthorityAfterNoDispatch,
  createLocalReviewRuntime: (healthCheck) => ({ healthCheck }),
};

export interface RunLocalReviewEvaluationV1Input {
  projectRoot: string;
  sourceRepository: string;
  runId: string;
  allowProviderDispatch: boolean;
  environment?: NodeJS.ProcessEnv;
  outputRoot?: string;
  signal?: AbortSignal;
  /** Deterministic test seam; the CLI never exposes provider overrides. */
  dependencies?: Partial<EvaluationDependencies>;
}

function fixtureRecord(fixture: MaterializedLocalReviewFixtureV1) {
  return {
    id: fixture.fixtureId,
    manifestSha256: fixture.manifestSha256,
    snapshotId: fixture.snapshot.snapshotId,
    baseRevision: fixture.baseRevision,
    changeRevision: fixture.changeRevision,
    changedPathCount: fixture.changedPathCount,
    changedLineCount: fixture.changedLineCount,
  } as const;
}

function exactLiveConfiguration(config: SoarConfig): boolean {
  return (
    config.providerMode === "local" &&
    config.context.maxInputTokens === REQUIRED_LIVE_CONFIGURATION.maxInputTokens &&
    config.context.safetyMargin === REQUIRED_LIVE_CONFIGURATION.safetyMargin &&
    config.limits.inferenceRounds === REQUIRED_LIVE_CONFIGURATION.inferenceRounds &&
    config.limits.toolCalls === REQUIRED_LIVE_CONFIGURATION.toolCalls &&
    config.vllm.maxOutputTokens === REQUIRED_LIVE_CONFIGURATION.maxOutputTokens &&
    config.vllm.costPolicy === "local_zero_cost"
  );
}

interface HealthCheckTelemetry {
  value: number;
  lastStatus?: ProviderModelAvailabilityResult["status"];
  lastCode?: ProviderModelAvailabilityResult["code"];
}

function healthCheckWithCounter(counter: HealthCheckTelemetry) {
  return async (
    registration: ProviderRegistration,
    signal: AbortSignal,
  ): Promise<ProviderModelAvailabilityResult> => {
    counter.value += 1;
    const check = registration.provider.checkConfiguredModelAvailability;
    if (!check) {
      const result: ProviderModelAvailabilityResult = {
        providerId: registration.descriptor.id,
        model: registration.descriptor.model,
        locality: registration.descriptor.locality,
        status: "unhealthy",
        code: "network_error",
      };
      counter.lastStatus = result.status;
      counter.lastCode = result.code;
      return result;
    }
    const result = await check.call(registration.provider, signal);
    counter.lastStatus = result.status;
    counter.lastCode = result.code;
    return result;
  };
}

function providerSwitchCount(routes: SessionState["routes"]): number {
  let switches = 0;
  for (let index = 1; index < routes.length; index += 1) {
    const prior = routes[index - 1];
    const current = routes[index];
    if (
      prior &&
      current &&
      (prior.providerId !== current.providerId || prior.model !== current.model)
    ) {
      switches += 1;
    }
  }
  return switches;
}

function successfulTools(store: EventStore, sessionId: string) {
  return store.getEvents(sessionId).flatMap((event) => {
    const data = sessionData(event);
    return data.type === "tool.call.completed" && !data.payload.isError
      ? [
          {
            name: data.payload.name,
            durationMs: data.payload.durationMs ?? 0,
          },
        ]
      : [];
  });
}

function stableFailureCode(options: {
  state: SessionState;
  accepted: ReturnType<typeof acceptedReviewForRecord>;
  fixture: MaterializedLocalReviewFixtureV1;
  successfulToolNames: string[];
  healthChecks: HealthCheckTelemetry;
}): string | undefined {
  const { state, accepted, fixture, successfulToolNames, healthChecks } = options;
  if (state.status === "cancelled") return "session_cancelled";
  if (
    state.status !== "completed" &&
    state.inferenceAttempts.length === 0 &&
    healthChecks.lastStatus === "unhealthy"
  ) {
    return "provider_health_unavailable";
  }
  if (state.status !== "completed") return `session_${state.status}`;
  if (!accepted) return "review_not_fresh_complete";
  if (accepted.result.snapshotId !== fixture.snapshot.snapshotId) {
    return "fixture_snapshot_mismatch";
  }
  if (
    JSON.stringify(state.routingDecisions.map((decision) => decision.boundary)) !==
    JSON.stringify(["session_start", "evidence_complete"])
  ) {
    return "routing_boundaries_invalid";
  }
  if (
    state.routingDecisions.length !== 2 ||
    state.routingDecisions.some(
      (decision) =>
        decision.routerInputSnapshot?.providers.some(
          (provider) =>
            provider.locality !== "local" ||
            provider.accountingKind !== "local_zero_cost",
        ) !== false,
    )
  ) {
    return "routing_provider_set_invalid";
  }
  if (providerSwitchCount(state.routes) !== 0) return "provider_switch_detected";
  if (new Set(state.routes.map((route) => route.providerId)).size !== 1) {
    return "provider_identity_invalid";
  }
  if (new Set(state.routes.map((route) => route.model)).size !== 1) {
    return "model_identity_invalid";
  }
  if (new Set(state.routes.map((route) => route.leaseId)).size !== 1) {
    return "lease_identity_invalid";
  }
  if (state.inferenceAttempts.length !== fixture.changedPathCount + 2) {
    return "attempt_count_invalid";
  }
  if (
    state.inferenceAttempts.some(
      (attempt) =>
        attempt.finished?.outcome !== "succeeded" ||
        attempt.finished.requestDisposition !== "sent" ||
        attempt.finished.servedModel !== attempt.requestedModel ||
        !attempt.finished.usage.reported ||
        attempt.finished.usage.inputTokens <= 0 ||
        attempt.finished.usage.outputTokens <= 0 ||
        attempt.finished.cost.amountMicrousd !== 0 ||
        attempt.finished.cost.provenance !== "local_zero_cost_policy" ||
        attempt.finished.cost.reservationId !== undefined ||
        attempt.budgetReservationId !== undefined,
    )
  ) {
    return "attempt_terminal_evidence_invalid";
  }
  if (
    JSON.stringify(successfulToolNames) !==
    JSON.stringify([
      "inspect_git_changes",
      ...Array.from({ length: fixture.changedPathCount }, () => "read_text_file"),
    ])
  ) {
    return "tool_sequence_invalid";
  }
  if (
    state.contextCompilations.length !== state.inferenceAttempts.length ||
    state.contextCompilations.some(
      (checkpoint) =>
        checkpoint.providerId !== state.inferenceAttempts[0]?.providerId ||
        checkpoint.model !== state.inferenceAttempts[0]?.requestedModel ||
        checkpoint.omittedEvidenceCount !== 0,
    )
  ) {
    return "context_trace_invalid";
  }
  if (healthChecks.value < 2 || healthChecks.value > 3) {
    return "health_check_count_invalid";
  }
  if (state.usage.costUsd !== 0) return "nonzero_cost_detected";
  if (state.completionChecks.at(-1)?.outcome !== "accepted") {
    return "completion_not_accepted";
  }
  return undefined;
}

function executionRecord(options: {
  store: EventStore;
  state: SessionState;
  sessionId: string;
  healthCheckCount: number;
  endToEndMs: number;
  providerId: string;
  model: string;
}) {
  const terminalStatus =
    options.state.status === "completed" ||
    options.state.status === "failed" ||
    options.state.status === "cancelled" ||
    options.state.status === "interrupted"
      ? options.state.status
      : "interrupted";
  const finished = options.state.inferenceAttempts.flatMap((attempt) =>
    attempt.finished ? [attempt.finished] : [],
  );
  const tools = successfulTools(options.store, options.sessionId);
  return {
    sessionId: options.sessionId,
    terminalStatus,
    providerId: options.providerId,
    model: options.model,
    locality: "local" as const,
    routingBoundaries: options.state.routingDecisions.map(
      (decision) => decision.boundary,
    ),
    routingDecisionCount: options.state.routingDecisions.length,
    providerSwitchCount: providerSwitchCount(options.state.routes),
    inferenceAttemptCount: options.state.inferenceAttempts.length,
    successfulToolCount: tools.length,
    healthCheckCount: options.healthCheckCount,
    eventCount: options.store.getEvents(options.sessionId).length,
    usage: {
      inputTokens: finished.reduce(
        (total, attempt) => total + attempt.usage.inputTokens,
        0,
      ),
      outputTokens: finished.reduce(
        (total, attempt) => total + attempt.usage.outputTokens,
        0,
      ),
      reasoningTokens: finished.reduce(
        (total, attempt) => total + attempt.usage.reasoningTokens,
        0,
      ),
      cacheReadTokens: finished.reduce(
        (total, attempt) => total + (attempt.usage.cacheReadTokens ?? 0),
        0,
      ),
      reportedAttempts: finished.filter((attempt) => attempt.usage.reported).length,
    },
    latency: {
      inferenceMs: finished.reduce(
        (total, attempt) => total + attempt.latencyMs,
        0,
      ),
      toolMs: tools.reduce(
        (total, tool) => total + tool.durationMs,
        0,
      ),
      endToEndMs: options.endToEndMs,
    },
    cost: {
      amountMicrousd: 0 as const,
      provenance: "local_zero_cost_policy" as const,
      endpointBillingVerified: false as const,
      infrastructureCostMeasured: false as const,
    },
  };
}

function evaluationStatusForCanonicalState(
  state: Pick<SessionState, "status">,
): Exclude<LocalReviewEvaluationStatus, "passed" | "blocked"> {
  if (state.status === "cancelled") return "cancelled";
  if (state.status === "failed" || state.status === "interrupted") {
    return "failed";
  }
  return "invalid";
}

async function publishRecord(options: {
  input: RunLocalReviewEvaluationV1Input;
  fixture: MaterializedLocalReviewFixtureV1;
  implementationRevision: string;
  reservation: LocalReviewRunReservationV1;
  record: Omit<LocalReviewEvaluationRecordV1, "artifacts">;
  safeEvents: SafeLocalReviewEventV1[];
  sensitiveValues: readonly string[];
}): Promise<LocalReviewEvaluationSummaryV1> {
  const exported = await exportLocalReviewEvaluationV1({
    projectRoot: options.input.projectRoot,
    ...(options.input.outputRoot ? { outputRoot: options.input.outputRoot } : {}),
    runId: options.input.runId,
    record: options.record,
    safeEvents: options.safeEvents,
    sensitiveValues: options.sensitiveValues,
    reservation: options.reservation,
  });
  const configuredOutputRoot = path.resolve(
    options.input.outputRoot ??
      path.join(options.input.projectRoot, "benchmarks", "runs"),
  );
  const relativeRoot = path.relative(configuredOutputRoot, exported.runDirectory);
  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    throw new Error("Published local-review artifacts escaped the output root.");
  }
  return {
    schemaVersion: "local-review-evaluation-summary-v1",
    status: options.record.status,
    runId: options.input.runId,
    implementationRevision: options.implementationRevision,
    fixtureId: LOCAL_REVIEW_FIXTURE_ID,
    resultRelativePath: path.posix.join(
      ...relativeRoot.split(path.sep),
      "result.json",
    ),
    safeTraceRelativePath: path.posix.join(
      ...relativeRoot.split(path.sep),
      "canonical-events.safe-v1.jsonl",
    ),
    publicationMarkerRelativePath: path.posix.join(
      ...relativeRoot.split(path.sep),
      "publication.complete-v1.json",
    ),
    resultSha256: exported.resultSha256,
    safeTraceSha256: exported.safeTraceSha256,
    publicationMarkerSha256: exported.commitMarkerSha256,
    resultBytes: exported.resultBytes,
    safeTraceBytes: exported.safeTraceBytes,
    publicationMarkerBytes: exported.commitMarkerBytes,
    eventCount: options.safeEvents.length,
    selectedMeteredExposureMicrousd: 0,
    ...(options.record.failureCode
      ? { failureCode: options.record.failureCode }
      : {}),
  };
}

export async function runLocalReviewEvaluationV1(
  input: RunLocalReviewEvaluationV1Input,
): Promise<LocalReviewEvaluationSummaryV1> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  let implementationRevision: string;
  try {
    implementationRevision =
      dependencies.resolveCleanImplementationRevision(input.projectRoot);
  } catch {
    throw new LocalReviewEvaluationAdmissionError(
      "implementation_revision_unavailable",
    );
  }

  let fixture: MaterializedLocalReviewFixtureV1;
  try {
    fixture = await materializeLocalReviewFixtureV1({
      projectRoot: input.projectRoot,
      sourceRepository: input.sourceRepository,
    });
  } catch {
    throw new LocalReviewEvaluationAdmissionError("fixture_unavailable");
  }
  const environment = input.environment ?? process.env;
  const initialSensitiveValues = [
    fixture.workspaceRoot,
    path.resolve(input.sourceRepository),
    environment.SOAR_VLLM_BASE_URL ?? "",
    environment.SOAR_VLLM_API_KEY ?? "",
  ];
  try {
    let reservation: LocalReviewRunReservationV1;
    try {
      reservation = await reserveLocalReviewRunNamespaceV1({
        projectRoot: input.projectRoot,
        ...(input.outputRoot ? { outputRoot: input.outputRoot } : {}),
        runId: input.runId,
        fixtureId: LOCAL_REVIEW_FIXTURE_ID,
        implementationRevision,
      });
    } catch {
      throw new LocalReviewEvaluationAdmissionError(
        "run_namespace_unavailable",
      );
    }

    let config: SoarConfig;
    try {
      config = loadConfig({
        cwd: input.projectRoot,
        appPath: input.projectRoot,
        environment,
      });
    } catch {
      return await publishRecord({
        input,
        fixture,
        implementationRevision,
        reservation,
        record: {
          schemaVersion: "local-change-review-evaluation-v1",
          runId: input.runId,
          implementationRevision,
          status: "blocked",
          source: "preflight",
          projection: "local-review-safe-v1",
          lossy: true,
          rawCanonicalTraceExported: false,
          fixture: fixtureRecord(fixture),
          failureCode: "configuration_invalid",
          nonClaims: [...LOCAL_REVIEW_EVALUATION_NON_CLAIMS],
        },
        safeEvents: [],
        sensitiveValues: initialSensitiveValues,
      });
    }
    const sensitiveValues = [
      ...initialSensitiveValues,
      config.vllm.baseUrl,
      ...(config.vllm.sensitiveApiKey ? [config.vllm.sensitiveApiKey] : []),
    ];
    const publishPreflight = (
      failureCode: string,
      status: "blocked" | "cancelled" = "blocked",
    ) =>
      publishRecord({
        input,
        fixture,
        implementationRevision,
        reservation,
        record: {
          schemaVersion: "local-change-review-evaluation-v1",
          runId: input.runId,
          implementationRevision,
          status,
          source: "preflight",
          projection: "local-review-safe-v1",
          lossy: true,
          rawCanonicalTraceExported: false,
          fixture: fixtureRecord(fixture),
          failureCode,
          nonClaims: [...LOCAL_REVIEW_EVALUATION_NON_CLAIMS],
        },
        safeEvents: [],
        sensitiveValues,
      });

    const liveAdmitted =
      input.allowProviderDispatch &&
      environment[LIVE_LOCAL_REVIEW_OPT_IN] === "true";
    if (!liveAdmitted || !exactLiveConfiguration(config)) {
      const failureCode = !liveAdmitted
        ? "live_opt_in_missing"
        : config.providerMode !== "local"
          ? "provider_mode_not_local"
          : "live_configuration_mismatch";
      return await publishPreflight(failureCode);
    }
    if (input.signal?.aborted) {
      return await publishPreflight("cancelled_before_dispatch", "cancelled");
    }

    let catalog: RuntimeProviderCatalog;
    try {
      catalog = dependencies.createProviderCatalog(config);
    } catch {
      return await publishPreflight("provider_catalog_invalid");
    }
    let registration: ProviderRegistration;
    try {
      registration = catalog.registry.require(catalog.defaultLocalProviderId, [
        "chat_completions",
        "streaming",
        "structured_json_schema",
        "tool_calling",
      ]);
    } catch {
      return await publishPreflight("provider_contract_invalid");
    }
    if (
      registration.descriptor.locality !== "local" ||
      registration.descriptor.accounting.kind !== "local_zero_cost"
    ) {
      return await publishPreflight("provider_contract_invalid");
    }

    const healthChecks = { value: 0 };
    let availability: ProviderModelAvailabilityResult;
    try {
      availability = await healthCheckWithCounter(healthChecks)(
        registration,
        input.signal ?? new AbortController().signal,
      );
    } catch {
      return input.signal?.aborted
        ? await publishPreflight("cancelled_before_dispatch", "cancelled")
        : await publishPreflight("provider_health_unavailable");
    }
    if (input.signal?.aborted) {
      return await publishPreflight("cancelled_before_dispatch", "cancelled");
    }
    if (
      availability.providerId !== registration.descriptor.id ||
      availability.model !== registration.descriptor.model ||
      availability.locality !== registration.descriptor.locality
    ) {
      return await publishPreflight("provider_health_contract_invalid");
    }
    if (availability.status !== "healthy") {
      return await publishPreflight("provider_health_unavailable");
    }

    let cleanRevisionStillMatches = false;
    try {
      cleanRevisionStillMatches =
        dependencies.resolveCleanImplementationRevision(input.projectRoot) ===
        implementationRevision;
    } catch {
      cleanRevisionStillMatches = false;
    }
    if (!cleanRevisionStillMatches) {
      return await publishPreflight("implementation_revision_changed");
    }
    if (input.signal?.aborted) {
      return await publishPreflight("cancelled_before_dispatch", "cancelled");
    }

    let setup:
      | {
          database: ReturnType<typeof createSoarDatabase>;
          store: EventStore;
          runner: SessionRunner;
        }
      | undefined;
    let setupDatabase: ReturnType<typeof createSoarDatabase> | undefined;
    try {
      const database = createSoarDatabase();
      setupDatabase = database;
      const store = new EventStore(database);
      const runner = new SessionRunner({
        store,
        providerRegistry: catalog.registry,
        defaultLocalProviderId: catalog.defaultLocalProviderId,
        limits: config.limits,
        context: config.context,
        localReviewSensitiveValues: [
          config.vllm.baseUrl,
          ...(config.vllm.sensitiveApiKey ? [config.vllm.sensitiveApiKey] : []),
        ],
        localReviewRuntime: dependencies.createLocalReviewRuntime(
          healthCheckWithCounter(healthChecks),
        ),
      });
      setup = { database, store, runner };
    } catch {
      setupDatabase?.close();
      return await publishPreflight("execution_setup_failed");
    }
    const { database, store, runner } = setup;
    let authority: LocalReviewAuthorityResult;
    try {
      authority = await dependencies.claimLiveAuthority({
        runId: input.runId,
        implementationRevision,
      });
    } catch {
      database.close();
      return await publishPreflight("live_authority_unavailable");
    }
    if (authority.status === "already_consumed") {
      database.close();
      return await publishPreflight("live_authority_already_consumed");
    }

    const startedAt = performance.now();
    let sessionId: string | undefined;
    let durableResultPublished = false;
    let authorityEvidence: Pick<SessionState, "inferenceAttempts"> | undefined = {
      inferenceAttempts: [],
    };
    let removeAbortListener: () => void = () => {};
    try {
      let started: ReturnType<typeof startLocalChangeReviewSession>;
      try {
        started = startLocalChangeReviewSession({
          store,
          runner,
          config,
          workspaceRoot: fixture.workspaceRoot,
        });
      } catch {
        const summary = await publishPreflight("execution_setup_failed");
        durableResultPublished = true;
        return summary;
      }
      sessionId = started.session.id;
      const cancel = () => runner.cancelSession(started.session.id);
      input.signal?.addEventListener("abort", cancel, { once: true });
      removeAbortListener = () => input.signal?.removeEventListener("abort", cancel);
      if (input.signal?.aborted) cancel();
      await started.completion;
      const endToEndMs = performance.now() - startedAt;
      const state = store.replay(started.session.id);
      authorityEvidence = state;

      let revisionStable = false;
      try {
        revisionStable =
          dependencies.resolveCleanImplementationRevision(input.projectRoot) ===
          implementationRevision;
      } catch {
        revisionStable = false;
      }

      let safeEvents: SafeLocalReviewEventV1[] | undefined;
      let record: Omit<LocalReviewEvaluationRecordV1, "artifacts">;
      let execution: LocalReviewEvaluationRecordV1["execution"];
      try {
        execution = executionRecord({
          store,
          state,
          sessionId: started.session.id,
          healthCheckCount: healthChecks.value,
          endToEndMs,
          providerId: registration.descriptor.id,
          model: registration.descriptor.model,
        });
      } catch {
        execution = undefined;
      }
      const publishEmergency = async (
        failureCode: "safe_projection_failed" | "unsafe_output",
        candidateEvents: readonly SafeLocalReviewEventV1[] = [],
      ) => {
        let retainedExecution = execution;
        let retainedEvents = retainedExecution ? [...candidateEvents] : [];
        try {
          if (retainedExecution) {
            assertSafeLocalReviewArtifactContents(
              JSON.stringify(retainedExecution),
              sensitiveValues,
            );
          }
          assertSafeLocalReviewArtifactContents(
            retainedEvents.map((event) => JSON.stringify(event)).join("\n"),
            sensitiveValues,
          );
        } catch {
          retainedEvents = [];
          try {
            if (retainedExecution) {
              assertSafeLocalReviewArtifactContents(
                JSON.stringify(retainedExecution),
                sensitiveValues,
              );
            }
          } catch {
            retainedExecution = undefined;
          }
        }
        const summary = await publishRecord({
          input,
          fixture,
          implementationRevision,
          reservation,
          record: {
            schemaVersion: "local-change-review-evaluation-v1",
            runId: input.runId,
            implementationRevision,
            status: evaluationStatusForCanonicalState(state),
            source: "canonical_event_store",
            projection: "local-review-safe-v1",
            lossy: true,
            rawCanonicalTraceExported: false,
            fixture: fixtureRecord(fixture),
            ...(retainedExecution ? { execution: retainedExecution } : {}),
            failureCode,
            nonClaims: [...LOCAL_REVIEW_EVALUATION_NON_CLAIMS],
          },
          safeEvents: retainedEvents,
          sensitiveValues,
        });
        durableResultPublished = true;
        return summary;
      };
      try {
        safeEvents = canonicalLocalReviewEvents(store, started.session.id);
        const view = await toChangeReviewView(store, started.session.id);
        const accepted = acceptedReviewForRecord(view);
        const completedTools = successfulTools(store, started.session.id);
        const successfulToolNames = completedTools.map((tool) => tool.name);
        const failureCode = revisionStable
          ? stableFailureCode({
              state,
              accepted,
              fixture,
              successfulToolNames,
              healthChecks,
            })
          : "implementation_revision_changed";
        const status: LocalReviewEvaluationStatus = failureCode
          ? failureCode === "provider_health_unavailable" &&
            state.inferenceAttempts.length === 0
            ? "blocked"
            : state.status === "cancelled"
              ? "cancelled"
              : state.status === "failed" || state.status === "interrupted"
                ? "failed"
                : "invalid"
          : "passed";
        record = {
          schemaVersion: "local-change-review-evaluation-v1",
          runId: input.runId,
          implementationRevision,
          status,
          source: "canonical_event_store",
          projection: "local-review-safe-v1",
          lossy: true,
          rawCanonicalTraceExported: false,
          fixture: fixtureRecord(fixture),
          execution,
          ...(status === "passed" && accepted ? { review: accepted } : {}),
          ...(failureCode ? { failureCode } : {}),
          nonClaims: [...LOCAL_REVIEW_EVALUATION_NON_CLAIMS],
        };
      } catch {
        return await publishEmergency(
          "safe_projection_failed",
          safeEvents ?? [],
        );
      }
      try {
        assertSafeLocalReviewArtifactContents(
          JSON.stringify(record),
          sensitiveValues,
        );
        assertSafeLocalReviewArtifactContents(
          safeEvents.map((event) => JSON.stringify(event)).join("\n"),
          sensitiveValues,
        );
      } catch {
        return await publishEmergency("unsafe_output", safeEvents);
      }
      const summary = await publishRecord({
        input,
        fixture,
        implementationRevision,
        reservation,
        record,
        safeEvents,
        sensitiveValues,
      });
      durableResultPublished = true;
      return summary;
    } finally {
      removeAbortListener();
      if (sessionId && runner.isRunning(sessionId)) runner.cancelSession(sessionId);
      if (sessionId) {
        try {
          authorityEvidence = store.replay(sessionId);
        } catch {
          authorityEvidence = undefined;
        }
      }
      database.close();
      if (
        durableResultPublished &&
        authorityEvidence &&
        !dispatchedOrUncertain(authorityEvidence)
      ) {
        await dependencies.releaseLiveAuthorityAfterNoDispatch(
          authority,
          authorityEvidence,
        );
      }
    }
  } finally {
    fixture.cleanup();
  }
}
