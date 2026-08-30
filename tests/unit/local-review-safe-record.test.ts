import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_REVIEW_EVALUATION_NON_CLAIMS,
  LocalReviewEvaluationRecordV1Schema,
  assertSafeLocalReviewArtifactContents,
  exportLocalReviewEvaluationV1,
  projectSafeLocalReviewEventV1,
  projectSafeLocalReviewEventsV1,
  reserveLocalReviewRunNamespaceV1,
  type SafeLocalReviewEventV1,
} from "../../src/benchmark/local-review-safe-record";
import { createSoarDatabase, type SoarDatabase } from "../../src/main/database";
import { EventStore } from "../../src/main/event-store";
import type { StoredSessionEvent } from "../../src/shared/session-events";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];
const databases: SoarDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createdEvent(): StoredSessionEvent {
  const database = createSoarDatabase();
  databases.push(database);
  const store = new EventStore(database);
  const session = store.createSession({
    id: "safe-projection-session",
    title: "PRIVATE_TITLE_SENTINEL",
    objective: "PRIVATE_OBJECTIVE_SENTINEL",
    workspaceRoot: "/private/tmp/PRIVATE_ROOT_SENTINEL",
    profile: "balanced",
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
      attemptTimeoutMs: 300_000,
      egressConsent: "none",
    },
  });
  return store.getEvents(session.id)[0]!;
}

function fixtureRecord() {
  return {
    id: "cal-001-soar-plan-approval" as const,
    manifestSha256: "1".repeat(64),
    snapshotId: "2".repeat(64),
    baseRevision: "3".repeat(40),
    changeRevision: "4".repeat(40),
    changedPathCount: 2,
    changedLineCount: 43,
  };
}

function storedEvent(
  sequence: number,
  data: Pick<StoredSessionEvent, "type" | "payload">,
): StoredSessionEvent {
  return {
    id: `event-${sequence}`,
    sessionId: "safe-projection-session",
    sequence,
    createdAt: new Date(sequence * 1_000).toISOString(),
    ...data,
  } as StoredSessionEvent;
}

function preflightExportInput(outputRoot: string, runId = "safe-record-001") {
  return {
    projectRoot,
    outputRoot,
    runId,
    record: {
      schemaVersion: "local-change-review-evaluation-v1" as const,
      runId,
      implementationRevision: "5".repeat(40),
      status: "blocked" as const,
      source: "preflight" as const,
      projection: "local-review-safe-v1" as const,
      lossy: true as const,
      rawCanonicalTraceExported: false as const,
      fixture: fixtureRecord(),
      failureCode: "deterministic_test",
      nonClaims: [...LOCAL_REVIEW_EVALUATION_NON_CLAIMS],
    },
    safeEvents: [],
    sensitiveValues: ["PRIVATE_SECRET_SENTINEL"],
  };
}

function validPersistedPassingRecord() {
  const fixture = fixtureRecord();
  return {
    schemaVersion: "local-change-review-evaluation-v1" as const,
    runId: "passing-record",
    implementationRevision: "5".repeat(40),
    status: "passed" as const,
    source: "canonical_event_store" as const,
    projection: "local-review-safe-v1" as const,
    lossy: true as const,
    rawCanonicalTraceExported: false as const,
    fixture,
    execution: {
      sessionId: "session-1",
      terminalStatus: "completed" as const,
      providerId: "local-vllm",
      model: "RM-01 VLM",
      locality: "local" as const,
      routingBoundaries: ["session_start", "evidence_complete"] as const,
      routingDecisionCount: 2,
      providerSwitchCount: 0,
      inferenceAttemptCount: 4,
      successfulToolCount: 3,
      healthCheckCount: 2,
      eventCount: 30,
      usage: {
        inputTokens: 400,
        outputTokens: 80,
        reasoningTokens: 20,
        cacheReadTokens: 0,
        reportedAttempts: 4,
      },
      latency: { inferenceMs: 40, toolMs: 3, endToEndMs: 50 },
      cost: {
        amountMicrousd: 0 as const,
        provenance: "local_zero_cost_policy" as const,
        endpointBillingVerified: false as const,
        infrastructureCostMeasured: false as const,
      },
    },
    review: {
      freshness: "fresh_complete" as const,
      result: {
        schemaVersion: "change-review-result-v1" as const,
        snapshotId: fixture.snapshotId,
        summary: "No blocking finding was identified.",
        conclusion: "no_blocking_findings" as const,
        evidenceSetId: "6".repeat(64),
        omissions: [],
        findings: [],
      },
      coverage: {
        schemaVersion: "review-coverage-view-v1" as const,
        status: "complete" as const,
        counts: {
          changedPaths: 2,
          admittedPaths: 2,
          omittedPaths: 0,
          changedHunks: 2,
          admittedHunks: 2,
          omittedHunks: 0,
        },
        changedTestCount: 1,
        runtimeCodeChangedWithoutChangedTest: false,
        snapshotRevalidated: true,
        omissionCodes: [],
      },
    },
    artifacts: {
      safeTrace: {
        relativePath: "canonical-events.safe-v1.jsonl" as const,
        sha256: "7".repeat(64),
        bytes: 1_024,
        events: 30,
      },
    },
    nonClaims: [...LOCAL_REVIEW_EVALUATION_NON_CLAIMS],
  };
}

function validPassingSafeTrace(): SafeLocalReviewEventV1[] {
  const events: Array<Record<string, unknown>> = [];
  const append = (type: string, payload: Record<string, unknown>): void => {
    const sequence = events.length + 1;
    events.push({
      schemaVersion: "local-review-safe-event-v1",
      id: `safe-event-${sequence}`,
      sequence,
      type,
      createdAt: new Date(1_700_000_000_000 + sequence * 1_000).toISOString(),
      payload,
    });
  };
  const providerId = "local-vllm";
  const model = "RM-01 VLM";
  const leaseId = "lease-1";
  const snapshotId = "2".repeat(64);
  const evidenceSetId = "6".repeat(64);
  append("session.created", {
    profile: "balanced",
    taskTrack: "change-review-v1",
    executionSchemaVersion: "agentic-execution-v2",
    routingPolicy: "local_only_v1",
    egressConsent: "none",
  });
  append("user.message", { messageId: "user-message", contentBytes: 32 });
  append("session.started", { hasPersistedDeadline: true });

  const toolNames = [
    "inspect_git_changes",
    "read_text_file",
    "read_text_file",
  ] as const;
  for (let index = 0; index < 4; index += 1) {
    const round = index + 1;
    const attemptId = `attempt-${round}`;
    const checkpointId = `checkpoint-${round}`;
    const messageId = `assistant-message-${round}`;
    const synthesis = index === 3;
    const decisionId = synthesis ? "decision-2" : "decision-1";
    if (index === 0 || synthesis) {
      append("routing.decision.recorded", {
        decisionId,
        boundary: synthesis ? "evidence_complete" : "session_start",
        phase: synthesis ? "synthesis" : "investigation",
        action: index === 0 ? "assign_new_lease" : "retain_lease",
        reasonCode: synthesis ? "local_lease_retained" : "local_only",
        selectedProviderId: providerId,
        selectedModel: model,
        selectedLeaseId: leaseId,
        ...(synthesis ? { priorLeaseId: leaseId, checkpointId } : {}),
      });
    }
    if (index === 0) {
      append("route.assigned", {
        providerId,
        model,
        leaseId,
        decisionId,
        phase: "investigation",
      });
    }
    append("assistant.message.started", {
      messageId,
      providerId,
      model,
      decisionId,
      leaseId,
      checkpointId,
      attemptId,
    });
    append("context.compiled", {
      checkpointId,
      compilerVersion: synthesis
        ? "review-context-compiler-v1"
        : "context-compiler-v1",
      reason: synthesis ? "finalization_boundary" : "tool_result_boundary",
      mode: synthesis ? "finalization" : "working",
      providerId,
      model,
      maxTokens: 16_384,
      estimatedTokens: 1_024,
      reservedInputTokens: 0,
      effectiveInputTokenBudget: 16_384,
      sourceMessageCount: 2,
      messageCount: 2,
      evidenceCount: synthesis ? 3 : index,
      deduplicatedEvidenceCount: synthesis ? 3 : index,
      omittedEvidenceCount: 0,
      packetSha256: `${round}`.repeat(64),
      messagesSha256: `${round + 4}`.repeat(64),
      decisionId,
      leaseId,
      messageId,
      attemptId,
      ...(synthesis
        ? {
            reviewSnapshotId: snapshotId,
            reviewEvidenceSetId: evidenceSetId,
            reviewProvenanceSha256: "9".repeat(64),
          }
        : {}),
    });
    append("inference.attempt.started", {
      attemptId,
      round,
      checkpointId,
      messageId,
      decisionId,
      leaseId,
      providerId,
      requestedModel: model,
      phase: synthesis ? "synthesis" : "investigation",
      requestedMaxOutputTokens: 8_192,
      allowTools: !synthesis,
      ...(!synthesis ? { allowedToolNames: [toolNames[index]] } : {}),
      requireToolCall: !synthesis,
      ...(synthesis
        ? {
            structuredOutputContract: "change-review-result-v1",
            structuredOutputSchemaSha256: "a".repeat(64),
          }
        : {}),
    });
    append("assistant.message.completed", {
      messageId,
      contentBytes: synthesis ? 256 : 19,
      stopReason: synthesis ? "stop" : "tool_calls",
      completionState: "complete",
      ...(synthesis ? { reviewParseStatus: "accepted" } : {}),
      attemptId,
    });
    append("inference.attempt.finished", {
      attemptId,
      checkpointId,
      outcome: "succeeded",
      requestDisposition: "sent",
      finishReason: synthesis ? "stop" : "tool_calls",
      servedModelMatchesRequested: true,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        reported: true,
      },
      cost: {
        amountMicrousd: 0,
        provenance: "local_zero_cost_policy",
      },
      latencyMs: 10,
    });
    if (!synthesis) {
      const toolName = toolNames[index]!;
      append("tool.call.requested", {
        toolCallId: `tool-call-${round}`,
        name: toolName,
        messageId,
      });
      append("tool.call.completed", {
        toolCallId: `tool-call-${round}`,
        name: toolName,
        status: "completed",
        durationMs: 1,
      });
    }
  }
  append("completion.obligations.checked", {
    checkId: "completion-4",
    messageId: "assistant-message-4",
    round: 4,
    remainingRounds: 0,
    successfulRequiredTools: ["inspect_git_changes"],
    missingRequiredTools: [],
    verifiedCitationCount: 0,
    unresolvedCitationCount: 0,
    outcome: "accepted",
  });
  append("session.completed", { resultBytes: 256 });
  return events as unknown as SafeLocalReviewEventV1[];
}

function passingExportInput(
  outputRoot: string,
  runId: string,
  safeEvents = validPassingSafeTrace(),
) {
  const parsed = LocalReviewEvaluationRecordV1Schema.parse(
    validPersistedPassingRecord(),
  );
  const { artifacts: _artifacts, ...record } = structuredClone(parsed);
  record.runId = runId;
  record.execution!.eventCount = safeEvents.length;
  return {
    projectRoot,
    outputRoot,
    runId,
    record,
    safeEvents,
    sensitiveValues: [] as string[],
  };
}

describe("local review safe evaluation records", () => {
  it("projects canonical events through an allow-list and rejects unknown types", () => {
    const projected = projectSafeLocalReviewEventV1(createdEvent());
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("PRIVATE_TITLE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_OBJECTIVE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_ROOT_SENTINEL");
    expect(projected).toMatchObject({
      sequence: 1,
      type: "session.created",
      payload: {
        taskTrack: "change-review-v1",
        executionSchemaVersion: "agentic-execution-v2",
        routingPolicy: "local_only_v1",
        egressConsent: "none",
      },
    });
    expect(() =>
      projectSafeLocalReviewEventV1({
        ...createdEvent(),
        type: "future.unknown",
      } as unknown as StoredSessionEvent),
    ).toThrow();
  });

  it("publishes once with restrictive permissions and content hashes", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-record-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot);
    const exported = await exportLocalReviewEvaluationV1(input);
    const result = await readFile(exported.resultPath);
    const trace = await readFile(exported.safeTracePath);
    const marker = await readFile(exported.commitMarkerPath);
    expect(createHash("sha256").update(result).digest("hex")).toBe(
      exported.resultSha256,
    );
    expect(createHash("sha256").update(trace).digest("hex")).toBe(
      exported.safeTraceSha256,
    );
    expect(createHash("sha256").update(marker).digest("hex")).toBe(
      exported.commitMarkerSha256,
    );
    expect((await stat(exported.runDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(exported.resultPath)).mode & 0o777).toBe(0o600);
    expect((await stat(exported.safeTracePath)).mode & 0o777).toBe(0o600);
    expect((await stat(exported.commitMarkerPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(marker.toString("utf8"))).toMatchObject({
      schemaVersion: "local-review-publication-complete-v1",
      resultSha256: exported.resultSha256,
      safeTraceSha256: exported.safeTraceSha256,
      resultBytes: result.byteLength,
      safeTraceBytes: trace.byteLength,
    });
    expect((await readdir(exported.runDirectory)).sort()).toEqual([
      "canonical-events.safe-v1.jsonl",
      "publication.complete-v1.json",
      "result.json",
    ]);
    expect(result.toString("utf8")).not.toContain("PRIVATE_SECRET_SENTINEL");
    const ledgerPath = path.join(
      outputRoot,
      "local-review-v1",
      ".run-ledger",
      "safe-record-001.json",
    );
    expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(ledgerPath, "utf8")).toContain(
      '"schemaVersion": "local-review-run-reservation-v1"',
    );
    await expect(exportLocalReviewEvaluationV1(input)).rejects.toThrow(
      /reserved|write-once|already/u,
    );
    await rm(exported.runDirectory, { recursive: true });
    await expect(exportLocalReviewEvaluationV1(input)).rejects.toThrow(
      /reserved|write-once|already/u,
    );
  });

  it("publishes one passing record only when the full safe trace proves it", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-passing-"));
    temporaryDirectories.push(outputRoot);
    const exported = await exportLocalReviewEvaluationV1(
      passingExportInput(outputRoot, "passing-trace"),
    );
    const record = JSON.parse(await readFile(exported.resultPath, "utf8"));
    expect(record).toMatchObject({
      status: "passed",
      execution: {
        inferenceAttemptCount: 4,
        successfulToolCount: 3,
      },
      artifacts: { safeTrace: { events: 34 } },
    });
  });

  it("uses an explicit permanent reservation before publication", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-reserve-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "reserved-run");
    const reservation = await reserveLocalReviewRunNamespaceV1({
      projectRoot,
      outputRoot,
      runId: input.runId,
      fixtureId: input.record.fixture.id,
      implementationRevision: input.record.implementationRevision,
    });
    await expect(
      reserveLocalReviewRunNamespaceV1({
        projectRoot,
        outputRoot,
        runId: input.runId,
        fixtureId: input.record.fixture.id,
        implementationRevision: input.record.implementationRevision,
      }),
    ).rejects.toThrow(/reserved/u);
    const exported = await exportLocalReviewEvaluationV1({
      ...input,
      reservation,
    });
    expect(await readFile(exported.resultPath, "utf8")).toContain(
      '"runId": "reserved-run"',
    );
  });

  it("allows only one concurrent publication under one reservation", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-concurrent-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "concurrent-run");
    const reservation = await reserveLocalReviewRunNamespaceV1({
      projectRoot,
      outputRoot,
      runId: input.runId,
      fixtureId: input.record.fixture.id,
      implementationRevision: input.record.implementationRevision,
    });
    const outcomes = await Promise.allSettled([
      exportLocalReviewEvaluationV1({ ...input, reservation }),
      exportLocalReviewEvaluationV1({ ...input, reservation }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(
      1,
    );
  });

  it("rejects symlinked output roots before writing through them", async () => {
    const container = await mkdtemp(path.join(tmpdir(), "soar-safe-symlink-"));
    temporaryDirectories.push(container);
    const target = path.join(container, "target");
    const linkedOutput = path.join(container, "linked-output");
    await mkdir(target);
    await symlink(target, linkedOutput, "dir");

    await expect(
      exportLocalReviewEvaluationV1(
        preflightExportInput(linkedOutput, "symlink-run"),
      ),
    ).rejects.toThrow(/symbolic link/u);
    await expect(lstat(path.join(target, "local-review-v1"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("rejects a symlinked artifact parent inside a real output root", async () => {
    const container = await mkdtemp(
      path.join(tmpdir(), "soar-safe-parent-symlink-"),
    );
    temporaryDirectories.push(container);
    const outputRoot = path.join(container, "output");
    const target = path.join(container, "target");
    await mkdir(outputRoot);
    await mkdir(target);
    const targetMode = (await stat(target)).mode & 0o777;
    await symlink(target, path.join(outputRoot, "local-review-v1"), "dir");

    await expect(
      exportLocalReviewEvaluationV1(
        preflightExportInput(outputRoot, "parent-symlink-run"),
      ),
    ).rejects.toThrow(/symbolic link/u);
    expect((await lstat(path.join(outputRoot, "local-review-v1"))).isSymbolicLink()).toBe(
      true,
    );
    expect((await stat(target)).mode & 0o777).toBe(targetMode);
  });

  it("rejects a symlinked run namespace before creating its ledger claim", async () => {
    const container = await mkdtemp(
      path.join(tmpdir(), "soar-safe-run-namespace-symlink-"),
    );
    temporaryDirectories.push(container);
    const outputRoot = path.join(container, "output");
    const target = path.join(container, "target");
    const runId = "symlinked-run-namespace";
    await mkdir(path.join(outputRoot, "local-review-v1"), { recursive: true });
    await mkdir(target);
    await symlink(
      target,
      path.join(outputRoot, "local-review-v1", runId),
      "dir",
    );

    await expect(
      reserveLocalReviewRunNamespaceV1({
        projectRoot,
        outputRoot,
        runId,
        fixtureId: fixtureRecord().id,
        implementationRevision: "5".repeat(40),
      }),
    ).rejects.toThrow(/namespace|unsafe/u);
    await expect(
      lstat(
        path.join(
          outputRoot,
          "local-review-v1",
          ".run-ledger",
          `${runId}.json`,
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await lstat(path.join(outputRoot, "local-review-v1", runId))).isSymbolicLink(),
    ).toBe(true);
  });

  it("does not create a missing output root through a symlinked ancestor", async () => {
    const container = await mkdtemp(
      path.join(tmpdir(), "soar-safe-output-ancestor-"),
    );
    temporaryDirectories.push(container);
    const target = path.join(container, "target");
    const linkedAncestor = path.join(container, "linked-ancestor");
    await mkdir(path.join(target, "existing-child"), { recursive: true });
    await symlink(target, linkedAncestor, "dir");
    const outputRoot = path.join(
      linkedAncestor,
      "existing-child",
      "new-output",
    );

    await expect(
      exportLocalReviewEvaluationV1(
        preflightExportInput(outputRoot, "ancestor-symlink-run"),
      ),
    ).rejects.toThrow(/symbolic link|symlink/u);
    await expect(
      lstat(path.join(target, "existing-child", "new-output")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a missing output root below a canonicalized system temp path", async () => {
    const container = await mkdtemp(path.join(tmpdir(), "soar-safe-missing-root-"));
    temporaryDirectories.push(container);
    const outputRoot = path.join(container, "missing", "runs");
    const exported = await exportLocalReviewEvaluationV1(
      preflightExportInput(outputRoot, "missing-root-run"),
    );
    expect(await readFile(exported.resultPath, "utf8")).toContain(
      '"runId": "missing-root-run"',
    );
  });

  it("keeps a reservation after an unsafe export is refused", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-refusal-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "unsafe-reserved-run");
    const reservation = await reserveLocalReviewRunNamespaceV1({
      projectRoot,
      outputRoot,
      runId: input.runId,
      fixtureId: input.record.fixture.id,
      implementationRevision: input.record.implementationRevision,
    });
    const unsafe = {
      ...input,
      reservation,
      record: {
        ...input.record,
        nonClaims: ["Do not persist ssh://private.invalid/repository"],
      },
    };

    await expect(exportLocalReviewEvaluationV1(unsafe)).rejects.toThrow(/URL/u);
    await expect(exportLocalReviewEvaluationV1(input)).rejects.toThrow(/reserved/u);
  });

  it("permits only the bounded zero-trace emergency failure record", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-emergency-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "emergency-run");
    const emergency = {
      ...input,
      record: {
        ...input.record,
        status: "failed" as const,
        source: "canonical_event_store" as const,
        failureCode: "safe_projection_failed",
      },
    };

    const exported = await exportLocalReviewEvaluationV1(emergency);
    expect(JSON.parse(await readFile(exported.resultPath, "utf8"))).toMatchObject({
      status: "failed",
      source: "canonical_event_store",
      failureCode: "safe_projection_failed",
      artifacts: { safeTrace: { events: 0 } },
    });

    const invalid = validPersistedPassingRecord() as any;
    invalid.status = "failed";
    invalid.execution = undefined;
    invalid.review = undefined;
    invalid.failureCode = "unbounded_failure";
    invalid.artifacts.safeTrace.events = 0;
    expect(LocalReviewEvaluationRecordV1Schema.safeParse(invalid).success).toBe(
      false,
    );
  });

  it("retains safe execution or trace evidence in bounded emergency records", async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), "soar-safe-emergency-evidence-"),
    );
    temporaryDirectories.push(outputRoot);
    const passing = LocalReviewEvaluationRecordV1Schema.parse(
      validPersistedPassingRecord(),
    );
    const execution = structuredClone(passing.execution!);
    execution.terminalStatus = "failed";

    const noEvidenceRunId = "emergency-invalid-no-evidence";
    const noEvidence = preflightExportInput(outputRoot, noEvidenceRunId);
    const noEvidenceExport = await exportLocalReviewEvaluationV1({
      ...noEvidence,
      record: {
        ...noEvidence.record,
        status: "invalid",
        source: "canonical_event_store",
        failureCode: "unsafe_output",
      },
    });
    expect(
      JSON.parse(await readFile(noEvidenceExport.resultPath, "utf8")),
    ).toMatchObject({
      status: "invalid",
      failureCode: "unsafe_output",
      artifacts: { safeTrace: { events: 0 } },
    });

    const emptyTraceRunId = "emergency-execution-empty-trace";
    const emptyTrace = preflightExportInput(outputRoot, emptyTraceRunId);
    const emptyTraceExport = await exportLocalReviewEvaluationV1({
      ...emptyTrace,
      record: {
        ...emptyTrace.record,
        status: "failed",
        source: "canonical_event_store",
        execution,
        failureCode: "safe_projection_failed",
      },
    });
    expect(JSON.parse(await readFile(emptyTraceExport.resultPath, "utf8"))).toMatchObject(
      {
        failureCode: "safe_projection_failed",
        execution: { terminalStatus: "failed", eventCount: 30 },
        artifacts: { safeTrace: { events: 0 } },
      },
    );

    const failedCanonicalEvents = projectSafeLocalReviewEventsV1([
      createdEvent(),
      storedEvent(2, {
        type: "session.failed",
        payload: { error: "bounded host failure" },
      }),
    ]);
    const retainedTraceRunId = "emergency-retained-trace";
    const retainedTrace = preflightExportInput(outputRoot, retainedTraceRunId);
    const retainedExecution = {
      ...execution,
      routingBoundaries: [],
      routingDecisionCount: 0,
      providerSwitchCount: 0,
      inferenceAttemptCount: 0,
      successfulToolCount: 0,
      eventCount: failedCanonicalEvents.length,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        reportedAttempts: 0,
      },
    };
    const retainedTraceExport = await exportLocalReviewEvaluationV1({
      ...retainedTrace,
      safeEvents: failedCanonicalEvents,
      record: {
        ...retainedTrace.record,
        status: "failed",
        source: "canonical_event_store",
        execution: retainedExecution,
        failureCode: "unsafe_output",
      },
    });
    expect(
      JSON.parse(await readFile(retainedTraceExport.resultPath, "utf8")),
    ).toMatchObject({
      failureCode: "unsafe_output",
      execution: { eventCount: 2 },
      artifacts: { safeTrace: { events: 2 } },
    });

    const invalid = {
      ...retainedTrace.record,
      status: "failed" as const,
      source: "canonical_event_store" as const,
      execution: retainedExecution,
      failureCode: "ordinary_failure",
      artifacts: {
        safeTrace: {
          relativePath: "canonical-events.safe-v1.jsonl" as const,
          sha256: "7".repeat(64),
          bytes: 0,
          events: 0,
        },
      },
    };
    expect(LocalReviewEvaluationRecordV1Schema.safeParse(invalid).success).toBe(
      false,
    );
  });

  it("does not replace an existing empty final run directory", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-existing-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "existing-run");
    const finalDirectory = path.join(
      outputRoot,
      "local-review-v1",
      input.runId,
      input.record.fixture.id,
    );
    await mkdir(finalDirectory, { recursive: true });

    await expect(exportLocalReviewEvaluationV1(input)).rejects.toThrow(
      /already exists/u,
    );
    expect((await lstat(finalDirectory)).isDirectory()).toBe(true);
  });

  it.each(["file", "symlink"] as const)(
    "does not replace an existing final run %s",
    async (kind) => {
      const outputRoot = await mkdtemp(
        path.join(tmpdir(), `soar-safe-existing-${kind}-`),
      );
      temporaryDirectories.push(outputRoot);
      const input = preflightExportInput(outputRoot, `existing-${kind}-run`);
      const reservation = await reserveLocalReviewRunNamespaceV1({
        projectRoot,
        outputRoot,
        runId: input.runId,
        fixtureId: input.record.fixture.id,
        implementationRevision: input.record.implementationRevision,
      });
      const finalTarget = path.join(
        outputRoot,
        "local-review-v1",
        input.runId,
        input.record.fixture.id,
      );
      if (kind === "file") {
        await writeFile(finalTarget, "preserve-me", "utf8");
      } else {
        const target = path.join(outputRoot, "symlink-target");
        await mkdir(target);
        await symlink(target, finalTarget, "dir");
      }

      await expect(
        exportLocalReviewEvaluationV1({ ...input, reservation }),
      ).rejects.toThrow(/already exists/u);
      const information = await lstat(finalTarget);
      expect(kind === "file" ? information.isFile() : information.isSymbolicLink()).toBe(
        true,
      );
      if (kind === "file") {
        expect(await readFile(finalTarget, "utf8")).toBe("preserve-me");
      }
    },
  );

  it("binds the persisted run id before any filesystem mutation", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-identity-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "directory-run");
    input.record.runId = "different-record-run";

    await expect(exportLocalReviewEvaluationV1(input)).rejects.toThrow(
      /run id does not match/u,
    );
    await expect(
      lstat(path.join(outputRoot, "local-review-v1")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates contiguous safe traces again at export", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "soar-safe-trace-"));
    temporaryDirectories.push(outputRoot);
    const input = preflightExportInput(outputRoot, "bad-trace-run");
    const projected = projectSafeLocalReviewEventV1(createdEvent());

    await expect(
      exportLocalReviewEvaluationV1({
        ...input,
        safeEvents: [{ ...projected, sequence: 2 }],
      }),
    ).rejects.toThrow(/sequence is not contiguous/u);
  });

  it("rejects duplicate, post-terminal, and mismatched safe events", async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), "soar-safe-trace-structure-"),
    );
    temporaryDirectories.push(outputRoot);
    const mutations: Array<(events: Array<Record<string, any>>) => void> = [
      (events) => {
        events[1]!.id = events[0]!.id;
      },
      (events) => {
        const terminal = events.at(-1)!;
        const prior = events.at(-2)!;
        const terminalSequence = terminal.sequence;
        terminal.sequence = prior.sequence;
        prior.sequence = terminalSequence;
        events.splice(-2, 2, terminal, prior);
      },
      (events) => {
        const completion = events.find(
          (candidate) => candidate.type === "tool.call.completed",
        )!;
        completion.payload.name = "search_text";
      },
      (events) => {
        const finish = events.find(
          (candidate) => candidate.type === "inference.attempt.finished",
        )!;
        finish.payload.attemptId = "never-started-attempt";
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const safeEvents = structuredClone(
        validPassingSafeTrace(),
      ) as Array<Record<string, any>>;
      mutate(safeEvents);
      await expect(
        exportLocalReviewEvaluationV1(
          passingExportInput(
            outputRoot,
            `bad-structure-${index + 1}`,
            safeEvents as unknown as SafeLocalReviewEventV1[],
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it("replaces provider-owned identifiers and reasons with host-safe values", () => {
    const rawToolCallId = "PRIVATE_TOOL_CALL_ID /Users/person/private";
    const rawFinishReason = "PRIVATE_FINISH_REASON";
    const rawServedModel = "PRIVATE_SERVED_MODEL";
    const created = createdEvent();
    const projected = projectSafeLocalReviewEventsV1([
      created,
      storedEvent(2, {
        type: "tool.call.requested",
        payload: {
          toolCallId: rawToolCallId,
          name: "read_text_file",
          arguments: { relativePath: "src/main/app.ts" },
          messageId: "message-1",
        },
      }),
      storedEvent(3, {
        type: "tool.call.completed",
        payload: {
          toolCallId: rawToolCallId,
          name: "read_text_file",
          content: "PRIVATE_TOOL_RESULT_BODY",
          isError: false,
          durationMs: 1,
        },
      }),
      storedEvent(4, {
        type: "inference.attempt.started",
        payload: {
          attemptId: "attempt-1",
          round: 1,
          checkpointId: "checkpoint-1",
          messageId: "message-1",
          decisionId: "decision-1",
          leaseId: "lease-1",
          providerId: "local-vllm",
          requestedModel: "RM-01 VLM",
          phase: "investigation",
          requestedMaxOutputTokens: 128,
          allowTools: true,
          allowedToolNames: ["read_text_file"],
          requireToolCall: true,
        },
      }),
      storedEvent(5, {
        type: "inference.attempt.finished",
        payload: {
          attemptId: "attempt-1",
          checkpointId: "checkpoint-1",
          outcome: "succeeded",
          requestDisposition: "sent",
          finishReason: rawFinishReason,
          servedModel: rawServedModel,
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            reasoningTokens: 1,
            reported: true,
          },
          cost: { amountMicrousd: 0, provenance: "local_zero_cost_policy" },
          latencyMs: 1,
        },
      }),
      storedEvent(6, {
        type: "usage.recorded",
        payload: {
          inputTokens: 10,
          outputTokens: 2,
          reasoningTokens: 1,
          reported: true,
          costUsd: 0,
          costProvenance: "local_zero_cost_policy",
          servedModel: "PRIVATE_USAGE_MODEL",
        },
      }),
      storedEvent(7, {
        type: "assistant.message.completed",
        payload: {
          messageId: "message-1",
          content: "PRIVATE_ASSISTANT_BODY",
          stopReason: rawFinishReason,
          completionState: "complete",
          attemptId: "attempt-1",
        },
      }),
    ]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain(rawToolCallId);
    expect(serialized).not.toContain(rawFinishReason);
    expect(serialized).not.toContain(rawServedModel);
    expect(serialized).not.toContain("PRIVATE_USAGE_MODEL");
    expect(serialized).not.toContain("PRIVATE_TOOL_RESULT_BODY");
    expect(serialized).not.toContain("PRIVATE_ASSISTANT_BODY");
    expect(projected[1]).toMatchObject({
      type: "tool.call.requested",
      payload: { toolCallId: "tool-call-1" },
    });
    expect(projected[2]).toMatchObject({
      type: "tool.call.completed",
      payload: { toolCallId: "tool-call-1" },
    });
    expect(projected[4]).toMatchObject({
      type: "inference.attempt.finished",
      payload: {
        finishReason: "other",
        servedModelMatchesRequested: false,
      },
    });
    expect(projected[6]).toMatchObject({
      type: "assistant.message.completed",
      payload: { stopReason: "other" },
    });
  });

  it("rejects every single-field false-pass variant", () => {
    const valid = validPersistedPassingRecord();
    expect(LocalReviewEvaluationRecordV1Schema.safeParse(valid).success).toBe(true);
    const mutations: Array<[string, (record: any) => void]> = [
      ["terminal status", (record) => (record.execution.terminalStatus = "failed")],
      ["routing boundaries", (record) => (record.execution.routingBoundaries = [])],
      ["attempt count", (record) => (record.execution.inferenceAttemptCount = 3)],
      ["tool count", (record) => (record.execution.successfulToolCount = 2)],
      ["health checks", (record) => (record.execution.healthCheckCount = 0)],
      ["provider switch", (record) => (record.execution.providerSwitchCount = 1)],
      ["positive usage", (record) => (record.execution.usage.inputTokens = 0)],
      ["reported usage", (record) => (record.execution.usage.reportedAttempts = 3)],
      ["complete coverage", (record) => (record.review.coverage.status = "incomplete")],
      [
        "omitted paths",
        (record) => {
          record.review.coverage.counts.admittedPaths = 1;
          record.review.coverage.counts.omittedPaths = 1;
        },
      ],
      [
        "omitted hunks",
        (record) => {
          record.review.coverage.counts.admittedHunks = 1;
          record.review.coverage.counts.omittedHunks = 1;
        },
      ],
      [
        "coverage omission codes",
        (record) => record.review.coverage.omissionCodes.push("bounded_omission"),
      ],
      [
        "review omissions",
        (record) =>
          record.review.result.omissions.push({
            code: "bounded_omission",
            description: "Some evidence was not reviewed.",
          }),
      ],
      [
        "conclusion semantics",
        (record) => (record.review.result.conclusion = "blocking_findings"),
      ],
      [
        "snapshot revalidation",
        (record) => (record.review.coverage.snapshotRevalidated = false),
      ],
      ["event count", (record) => (record.execution.eventCount = 29)],
      [
        "snapshot identity",
        (record) => (record.review.result.snapshotId = "8".repeat(64)),
      ],
      ["failure code", (record) => (record.failureCode = "should_not_exist")],
    ];

    for (const [name, mutate] of mutations) {
      const candidate: any = structuredClone(valid);
      mutate(candidate);
      expect(
        LocalReviewEvaluationRecordV1Schema.safeParse(candidate).success,
        name,
      ).toBe(false);
    }
  });

  it("rejects passing traces with any falsified production gate", async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), "soar-safe-trace-gates-"),
    );
    temporaryDirectories.push(outputRoot);
    const mutations: Array<[
      string,
      (events: Array<Record<string, any>>) => void,
    ]> = [
      [
        "attempt provider identity",
        (events) => {
          const event = events.find(
            (candidate) => candidate.type === "inference.attempt.started",
          )!;
          event.payload.providerId = "different-provider";
        },
      ],
      [
        "served model equality",
        (events) => {
          const event = events.find(
            (candidate) => candidate.type === "inference.attempt.finished",
          )!;
          event.payload.servedModelMatchesRequested = false;
        },
      ],
      [
        "tool sequence",
        (events) => {
          for (const event of events.filter(
            (candidate) =>
              (candidate.type === "tool.call.requested" ||
                candidate.type === "tool.call.completed") &&
              candidate.payload.toolCallId === "tool-call-2",
          )) {
            event.payload.name = "search_text";
          }
        },
      ],
      [
        "context omission",
        (events) => {
          const event = events.find(
            (candidate) => candidate.type === "context.compiled",
          )!;
          event.payload.omittedEvidenceCount = 1;
        },
      ],
      [
        "review snapshot identity",
        (events) => {
          const contexts = events.filter(
            (candidate) => candidate.type === "context.compiled",
          );
          contexts.at(-1)!.payload.reviewSnapshotId = "f".repeat(64);
        },
      ],
      [
        "accepted synthesis",
        (events) => {
          const completions = events.filter(
            (candidate) => candidate.type === "assistant.message.completed",
          );
          completions.at(-1)!.payload.reviewParseStatus = "schema_invalid";
        },
      ],
      [
        "completion obligation",
        (events) => {
          const event = events.find(
            (candidate) => candidate.type === "completion.obligations.checked",
          )!;
          event.payload.outcome = "retry";
        },
      ],
    ];

    for (const [index, [name, mutate]] of mutations.entries()) {
      const safeEvents = structuredClone(
        validPassingSafeTrace(),
      ) as Array<Record<string, any>>;
      mutate(safeEvents);
      await expect(
        exportLocalReviewEvaluationV1(
          passingExportInput(
            outputRoot,
            `false-trace-${index + 1}`,
            safeEvents as unknown as SafeLocalReviewEventV1[],
          ),
        ),
        name,
      ).rejects.toThrow();
    }
  });

  it("binds non-passing record status to its canonical terminal state", () => {
    const valid = validPersistedPassingRecord() as any;
    const invalidMappings: Array<[string, string]> = [
      ["cancelled", "completed"],
      ["failed", "completed"],
      ["blocked", "completed"],
      ["invalid", "failed"],
    ];
    for (const [status, terminalStatus] of invalidMappings) {
      const candidate = structuredClone(valid);
      candidate.status = status;
      candidate.execution.terminalStatus = terminalStatus;
      candidate.review = undefined;
      candidate.failureCode = "deterministic_failure";
      expect(LocalReviewEvaluationRecordV1Schema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  it("rejects exact sensitive values, URLs, absolute paths, and credentials", () => {
    expect(() =>
      assertSafeLocalReviewArtifactContents("hidden-value", ["hidden-value"]),
    ).toThrow();
    expect(() =>
      assertSafeLocalReviewArtifactContents("ssh://example.invalid/repository", []),
    ).toThrow();
    expect(() =>
      assertSafeLocalReviewArtifactContents(
        '{"summary":"see /Volumes/Private/repository"}',
        [],
      ),
    ).toThrow();
    expect(() =>
      assertSafeLocalReviewArtifactContents(
        ["sk", "or", "v1", "abcdefghijklmnopqrstuvwxyz123456"].join("-"),
        [],
      ),
    ).toThrow();
    expect(() =>
      assertSafeLocalReviewArtifactContents(
        ["xoxb", "123456789012345678901234"].join("-"),
        [],
      ),
    ).toThrow();
    expect(() =>
      assertSafeLocalReviewArtifactContents(
        '{"path":"C:\\\\Users\\\\person\\\\repository"}',
        [],
      ),
    ).toThrow();
    for (const markdownDelimitedPath of [
      "`/Users/person/private`",
      "[/Users/person/private]",
      "`C:\\Users\\person\\private`",
      "[\\\\server\\share\\private]",
      "`~/private`",
    ]) {
      expect(() =>
        assertSafeLocalReviewArtifactContents(markdownDelimitedPath, []),
      ).toThrow();
    }
    const escapedSensitiveValue = "line-one\\line-two\nline-three";
    expect(() =>
      assertSafeLocalReviewArtifactContents(
        JSON.stringify({ value: escapedSensitiveValue }),
        [escapedSensitiveValue],
      ),
    ).toThrow();
    expect(() =>
      assertSafeLocalReviewArtifactContents(
        '{"path":"src/main/app.ts","model":"RM-01 VLM"}',
        [],
      ),
    ).not.toThrow();
  });
});
