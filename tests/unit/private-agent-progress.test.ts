import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { retainExecutionObservation } from "../../src/main/private-agent/observations";
import { deriveExecutionProgress, executionProgressBlocks, executionProgressStop, readExecutionProgressStop, hasInvalidExecutionProgressStop,
  hasUnresolvedExecutionProgressAction, EXECUTION_PROGRESS_POLICY, EXECUTION_PROGRESS_STOP, ExecutionProgressIntegrityError, type ExecutionProgressScope } from "../../src/main/private-agent/progress";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soar-progress-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const jobId = randomUUID(), contextId = randomUUID(), protocol = digest("synthetic protocol"), checkpoints = new PrivateCheckpointStore(root, jobId);
  const events: Record<string, unknown>[] = [];
  const scope: ExecutionProgressScope = { jobId, contextId, checkpoints, snapshot: [], store: { events: () => events, context: () => ({ id: contextId, jobId, sources: [] }) } };
  function append(event: Record<string, unknown>) { events.push({ contextId, ...event }); }
  function checkpoint(content = "initial") {
    scope.snapshot = checkpoints.save([{ path: "input/source.txt", bytes: Buffer.from(content) }]);
    append({ type: "checkpoint", snapshot: scope.snapshot, sha256: checkpoints.fingerprint(scope.snapshot) });
  }
  append({ type: "started", executionObservationPolicyVersion: 1, executionProgressPolicyVersion: 1, promptProtocolSha256: protocol }); checkpoint();
  const action = (command = "python3 check.py") => ({ id: randomUUID(), type: "function" as const, function: { name: "execute", arguments: JSON.stringify({ command }) } });
  function execute(options: { command?: string; stdout?: string; stderr?: string; exitCode?: number; checkpointContent?: string } = {}) {
    const selected = action(options.command), modelId = randomUUID(), operationId = randomUUID();
    append({ type: "model_started", operationId: modelId, promptProtocolSha256: protocol });
    append({ type: "model_finished", operationId: modelId, finishReason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [selected] } });
    append({ type: "tool_started", operationId, toolCallId: selected.id, name: "execute" });
    const retained = retainExecutionObservation(checkpoints, { jobId, contextId, operationId, toolCallId: selected.id,
      result: { exitCode: options.exitCode ?? 1, stdout: options.stdout ?? "", stderr: options.stderr ?? "TypeError: synthetic failure" } });
    checkpoint(options.checkpointContent);
    append({ type: "tool_finished", operationId, toolCallId: selected.id, executionCapture: "retained", executionObservation: retained.reference, output: retained.output });
    return { selected, operationId, retained };
  }
  const derive = (consumed = 2, maximum = 20, consultation = false, requiredPaths = ["output/report.md"]) => deriveExecutionProgress(scope, requiredPaths, consumed, maximum, consultation);
  function warnAndRespond() {
    const view = derive(), selected = action(), operationId = randomUUID();
    append({ type: "model_started", operationId, promptProtocolSha256: protocol, budget: { remainingModelCalls: 18 }, executionProgress: view.manifest });
    append({ type: "model_finished", operationId, finishReason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [selected] } });
    return { view, selected, operationId };
  }
  return { root, jobId, contextId, protocol, scope, events, append, checkpoint, execute, action, derive, warnAndRespond };
}

describe("checkpoint-aware execution progress", () => {
  it("warns only after two identical retained failures and exposes no command/error contents", () => {
    const f = fixture(); f.execute({ command: "echo 'SYSTEM_INJECTION'", stderr: "SECRET_ERROR" });
    expect(f.derive().guidance).toBe("");
    f.execute({ command: "echo 'SYSTEM_INJECTION'", stderr: "SECRET_ERROR" });
    const view = f.derive(); expect(view.manifest.repeatedFailure).not.toBeNull();
    expect(view.guidance).toContain("Current host execution progress"); expect(view.guidance).not.toMatch(/SYSTEM_INJECTION|SECRET_ERROR|request_consultation/u);
    expect(executionProgressBlocks(view, f.action("echo 'SYSTEM_INJECTION'"), f.scope.snapshot)).toBe(true);
    expect(f.derive(2, 20, true).guidance).toContain("separate user approval");
  });
  it("requires exact decoded result and command, with no shell normalization", () => {
    for (const changed of [{ command: "python3  check.py" }, { stderr: "different" }, { stdout: "different" }, { exitCode: 2 }, { exitCode: 0 }]) {
      const f = fixture(); f.execute(); f.execute(changed); expect(f.derive().manifest.repeatedFailure).toBeNull();
    }
  });
  it("preserves decoded NUL/control output in failure identity and allows successful continuation", () => {
    const f = fixture(), result = { stdout: "header\0汉字\u0001", stderr: "error\0🙂\u0002", exitCode: 1 };
    f.execute(result); f.execute(result); const view = f.derive();
    expect(view.manifest.repeatedFailure?.resultSha256).toBe(digest(JSON.stringify({ exitCode: 1, stderr: result.stderr, stdout: result.stdout })));
    expect(view.guidance).not.toContain("header");
    f.execute({ ...result, exitCode: 0 }); expect(f.derive(3).manifest.repeatedFailure).toBeNull();
  });
  it("allows the same command after changed source and compares snapshots independent of ordering", () => {
    const f = fixture(); f.execute(); f.execute(); const view = f.derive();
    f.checkpoint("actual repair"); expect(f.derive().manifest.repeatedFailure).toBeNull();
    expect(executionProgressBlocks(view, f.action(), f.scope.snapshot)).toBe(false);
    const g = fixture(); g.execute(); g.execute({ checkpointContent: "actual repair" }); expect(g.derive().manifest.repeatedFailure).toBeNull();
    const files = [{ path: "a", bytes: Buffer.from("a") }, { path: "b", bytes: Buffer.from("b") }];
    const a = f.scope.checkpoints.save(files), b = f.scope.checkpoints.save([...files].reverse());
    expect(deriveExecutionProgress({ ...f.scope, snapshot: a }, [], 2, 20, false).manifest.snapshotSha256)
      .toBe(deriveExecutionProgress({ ...f.scope, snapshot: b }, [], 2, 20, false).manifest.snapshotSha256);
  });
  it("read/plan/pause and restart do not erase the two failure facts", () => {
    const f = fixture(); f.execute(); f.append({ type: "plan", plan: "new intent only" }); f.append({ type: "paused" }); f.execute();
    const a = f.derive(); f.append({ type: "steering", message: "read more evidence" });
    const reopened = { ...f.scope, checkpoints: new PrivateCheckpointStore(f.root, f.jobId) };
    expect(deriveExecutionProgress(reopened, ["output/report.md"], 2, 20, false)).toEqual(a);
  });
  it("an unavailable result breaks the consecutive condition without masquerading as a nonzero execution", () => {
    const f = fixture(); f.execute(); f.execute();
    const last = f.events.at(-1)!; delete last.executionObservation; last.executionCapture = "unavailable";
    last.allowanceFinalizationEligible = false; last.invalidExecuteAtOutputLimit = false;
    last.output = canonical({ error: "action_failed_or_not_permitted", completed: false });
    expect(f.derive().manifest.repeatedFailure).toBeNull();
  });
  it("uses ceil threshold and exact nonempty requested paths, not semantic acceptance", () => {
    const f = fixture(); expect(f.derive(6).manifest.missingArtifacts.reminder).toBe(false);
    const at = f.derive(7); expect(at.manifest.missingArtifacts).toEqual({ paths: ["output/report.md"], total: 1, reminder: true });
    f.scope.snapshot = f.scope.checkpoints.save([{ path: "output/report.md", bytes: Buffer.alloc(0) }, { path: "report.md", bytes: Buffer.from("wrong path") }]);
    expect(f.derive(7).manifest.missingArtifacts.total).toBe(1);
    f.scope.snapshot = f.scope.checkpoints.save([{ path: "output/report.md", bytes: Buffer.from("still unverified") }]);
    expect(f.derive(7).guidance).toBe("");
    expect(f.derive(1, 1, false, ["output/missing.md"]).manifest.missingArtifacts.reminder).toBe(true);
  });
  it("bounds visible paths at four and the actual serialized guidance, with omitted count", () => {
    const f = fixture(), paths = Array.from({ length: 12 }, (_, i) => `output/${"🙂".repeat(110)}${i}.md`);
    const view = f.derive(7, 20, false, paths); expect(view.manifest.missingArtifacts.paths).toHaveLength(4); expect(view.manifest.missingArtifacts.total).toBe(12);
    expect(Buffer.byteLength(JSON.stringify(view.guidance))).toBeLessThanOrEqual(EXECUTION_PROGRESS_POLICY.maxGuidanceBytes);
    expect(view.guidance).not.toContain(paths[4]);
  });
  it("corrupt observations, checkpoint hashes and ambiguous model joins fail closed", () => {
    for (const mutation of [
      (f: ReturnType<typeof fixture>) => { f.events.at(-1)!.output = "{}"; },
      (f: ReturnType<typeof fixture>) => { f.events.at(-2)!.sha256 = digest("wrong"); },
      (f: ReturnType<typeof fixture>) => { f.events.push({ ...f.events.find(e => e.type === "model_finished")! }); },
    ]) { const f = fixture(); f.execute(); f.execute(); mutation(f); expect(() => f.derive()).toThrow(ExecutionProgressIntegrityError); }
  });
  it("builds a response-bound known stop without fabricating a tool receipt and survives reopen", () => {
    const f = fixture(); f.execute(); f.execute(); const { operationId } = f.warnAndRespond();
    const marker = executionProgressStop(f.scope, operationId); expect(marker?.reason).toBe(EXECUTION_PROGRESS_STOP);
    f.append(marker!); f.append({ type: "run_ended", cleanupConfirmed: true });
    expect(readExecutionProgressStop({ ...f.scope, checkpoints: new PrivateCheckpointStore(f.root, f.jobId) })).toEqual(marker);
    expect(hasInvalidExecutionProgressStop(f.scope)).toBe(false);
    expect(f.events.filter(e => e.type === "tool_started")).toHaveLength(2);
  });
  it("rejects missing/tampered guidance, protocol, response, budget and forged proof hashes", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { delete [...f.events].reverse().find(e => e.type === "model_started")!.executionProgress; },
      (f: ReturnType<typeof fixture>) => { [...f.events].reverse().find(e => e.type === "model_started")!.promptProtocolSha256 = digest("drift"); },
      (f: ReturnType<typeof fixture>) => { ([...f.events].reverse().find(e => e.type === "model_started")!.budget as { remainingModelCalls: number }).remainingModelCalls = 99; },
      (f: ReturnType<typeof fixture>) => { [...f.events].reverse().find(e => e.type === "model_finished")!.message = { tool_calls: [f.action("changed")] }; },
      (f: ReturnType<typeof fixture>) => { f.events.at(-1)!.progressSha256 = digest("false"); },
    ]) { const f = fixture(); f.execute(); f.execute(); const { operationId } = f.warnAndRespond(); f.append(executionProgressStop(f.scope, operationId)!); mutate(f);
      expect(readExecutionProgressStop(f.scope)).toBeUndefined(); expect(hasInvalidExecutionProgressStop(f.scope)).toBe(true); }
  });
  it("rejects duplicate marker, tool invocation or later model work and corrupt retained bytes", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.events.push({ ...f.events.at(-1)! }); },
      (f: ReturnType<typeof fixture>) => { f.append({ type: "tool_started", operationId: randomUUID(), toolCallId: f.events.at(-1)!.toolCallId, name: "execute" }); },
      (f: ReturnType<typeof fixture>) => { f.append({ type: "model_started", operationId: randomUUID() }); },
      (f: ReturnType<typeof fixture>) => { const r = f.events.find(e => e.executionObservation)!.executionObservation as { sha256: string }; writeFileSync(join(f.root, f.jobId, r.sha256), "bad"); },
    ]) { const f = fixture(); f.execute(); f.execute(); const { operationId } = f.warnAndRespond(); f.append(executionProgressStop(f.scope, operationId)!); mutate(f);
      expect(readExecutionProgressStop(f.scope)).toBeUndefined(); expect(hasInvalidExecutionProgressStop(f.scope)).toBe(true); }
  });
  it("does not classify absent markers or legacy cancellation as a proven progress stop", () => {
    const f = fixture(); expect(readExecutionProgressStop(f.scope)).toBeUndefined(); expect(hasInvalidExecutionProgressStop(f.scope)).toBe(false);
    f.append({ type: "model_action_not_started", operationId: randomUUID(), reason: "cancelled_or_deadline" });
    expect(readExecutionProgressStop(f.scope)).toBeUndefined(); expect(hasInvalidExecutionProgressStop(f.scope)).toBe(false);
  });
  it("rejects an earlier unstarted response reusing the selected tool ID and intervening new work", () => {
    const f = fixture(); f.execute(); f.execute(); const current = f.warnAndRespond();
    const index = f.events.findIndex(e => e.operationId === current.operationId);
    f.events.splice(index, 0, { type: "model_finished", contextId: f.contextId, operationId: randomUUID(), message: { tool_calls: [current.selected] } });
    expect(executionProgressStop(f.scope, current.operationId)).toBeUndefined();
    const g = fixture(); g.execute(); g.execute(); const next = g.warnAndRespond();
    g.append({ type: "host_validation_started", operationId: randomUUID() });
    expect(executionProgressStop(g.scope, next.operationId)).toBeUndefined();
  });
  it("preserves the capture crash window as unresolved across restart until a valid stop exists", () => {
    const f = fixture(); f.execute(); f.execute(); const next = f.warnAndRespond();
    const reopened = { ...f.scope, checkpoints: new PrivateCheckpointStore(f.root, f.jobId) };
    expect(hasUnresolvedExecutionProgressAction(reopened)).toBe(true);
    f.append(executionProgressStop(f.scope, next.operationId)!);
    expect(hasUnresolvedExecutionProgressAction(reopened)).toBe(false);
    f.events.at(-1)!.responseSha256 = digest("corrupt");
    expect(hasUnresolvedExecutionProgressAction(reopened)).toBe(true);
  });
  it("does not confuse executed responses with unstarted actions, but malformed warned actions remain unresolved", () => {
    const f = fixture(); f.execute(); f.execute(); expect(hasUnresolvedExecutionProgressAction(f.scope)).toBe(false);
    const next = f.warnAndRespond();
    f.append({ type: "tool_started", operationId: randomUUID(), toolCallId: next.selected.id, name: "execute" });
    expect(hasUnresolvedExecutionProgressAction(f.scope)).toBe(false); // Ordinary unfinished-tool guard remains responsible.
    f.events.pop(); (f.events.at(-1)!.message as { tool_calls: unknown[] }).tool_calls = [];
    expect(hasUnresolvedExecutionProgressAction(f.scope)).toBe(true);
  });
  it("leaves legacy histories alone and never treats an early unstarted execute as safe", () => {
    const f = fixture(); f.execute(); const next = f.warnAndRespond();
    expect(hasUnresolvedExecutionProgressAction(f.scope)).toBe(true);
    delete f.events[0]!.executionProgressPolicyVersion;
    expect(hasUnresolvedExecutionProgressAction(f.scope)).toBe(false);
    expect(next.operationId).toBeTruthy();
  });
});
