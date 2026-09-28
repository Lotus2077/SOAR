import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import type { GeneralMessage } from "../../src/main/private-agent/model";
import { EXECUTION_OBSERVATION_MAX_BYTES, EXECUTION_OBSERVATION_BUDGET_BYTES, ObservationIntegrityError,
  retainExecutionObservation, readExecutionObservation, projectExecutionObservations, verifyExecutionObservations,
  readObservationArguments, type ExecutionObservationScope, type ExecutionObservationReference } from "../../src/main/private-agent/observations";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fn of cleanups.splice(0).reverse()) fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soar-observations-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const filename = join(root, "state.sqlite"), db = new Database(filename); cleanups.push(() => db.close());
  const store = new PrivateAgentStore(db), jobId = randomUUID(), contextId = randomUUID();
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: [], maxRequests: 40, maxFeeMicrousd: 0 });
  store.createContext({ id: contextId, jobId, sources: [{ id: "synthetic", version: digest("fixture"), classification: "private", synthetic: true }] });
  const checkpoints = new PrivateCheckpointStore(join(root, "blobs"), jobId);
  const scope: ExecutionObservationScope = { store, checkpoints, jobId, contextId };
  store.append(jobId, { type: "started", contextId, executionObservationPolicyVersion: 1 });
  const messages: GeneralMessage[] = [{ role: "system", content: "host system" }, { role: "user", content: "synthetic goal" }];
  const append = (stdout: string, stderr = "", exitCode = 0, toolCallId: string = randomUUID()) => {
    const operationId = randomUUID();
    store.append(jobId, { type: "tool_started", contextId, operationId, toolCallId, name: "execute" });
    const result = { exitCode, stdout, stderr };
    const kept = retainExecutionObservation(checkpoints, { jobId, contextId, operationId, toolCallId, result });
    store.atomic(() => store.append(jobId, { type: "tool_finished", contextId, operationId, toolCallId, output: kept.output, executionCapture: "retained", executionObservation: kept.reference }));
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: toolCallId, type: "function", function: { name: "execute", arguments: '{"command":"synthetic"}' } }] },
      { role: "tool", tool_call_id: toolCallId, content: kept.output });
    return kept;
  };
  const read = (ref: ExecutionObservationReference, offset: number, maxBytes = 512, stream: "stdout" | "stderr" = "stdout") => {
    const operationId = randomUUID(), toolCallId = randomUUID(), args = { observationId: ref.observationId, sha256: ref.sha256, stream, offset, maxBytes };
    store.append(jobId, { type: "tool_started", contextId, operationId, toolCallId, name: "read_observation" });
    const value = readExecutionObservation(scope, args);
    store.append(jobId, { type: "tool_finished", contextId, operationId, toolCallId, output: value.output, observationCapture: "retained", observationRead: value.reference });
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: toolCallId, type: "function", function: { name: "read_observation", arguments: JSON.stringify(args) } }] },
      { role: "tool", tool_call_id: toolCallId, content: value.output });
    return value;
  };
  const events = () => store.events(jobId);
  const altered = (mutate: (rows: Record<string, unknown>[]) => void): ExecutionObservationScope => {
    const rows = structuredClone(events()); mutate(rows);
    return { ...scope, store: { context: id => store.context(id), events: () => rows } };
  };
  return { root, filename, db, store, checkpoints, jobId, contextId, scope, append, read, messages, events, altered };
}

describe("retained bounded execution observations", () => {
  it("preserves small decoded output, including escaped NUL, and full metadata-bound blob bytes", () => {
    const f = fixture(), result = { exitCode: 1, stdout: "汉字\0🙂\n", stderr: "failed\u0001" }, kept = f.append(result.stdout, result.stderr, result.exitCode);
    expect(JSON.parse(kept.output)).toMatchObject(result);
    expect(JSON.parse(kept.output).instruction).toContain("repair");
    expect(JSON.parse(kept.output).instruction).toContain("Inspect this stdout/stderr");
    expect(JSON.parse(kept.output).instruction).not.toContain("read_observation");
    const bytes = f.checkpoints.load(kept.reference.snapshot)[0]!.bytes;
    expect(JSON.parse(bytes.toString())).toMatchObject({ jobId: f.jobId, contextId: f.contextId, operationId: kept.reference.observationId, result });
    expect(digest(bytes)).toBe(kept.reference.sha256); expect(kept.reference.stdoutBytes).toBe(Buffer.byteLength(result.stdout));
    expect(() => verifyExecutionObservations(f.scope)).not.toThrow();
  });

  it("keeps large failed output head/tail and exact omissions within 8 KiB even for escaped control characters", () => {
    const f = fixture(), stdout = `HEAD_${"\0汉🙂".repeat(20000)}_TAIL`, kept = f.append(stdout, "ERROR_".repeat(10000), 7);
    expect(Buffer.byteLength(JSON.stringify(kept.output))).toBeLessThanOrEqual(EXECUTION_OBSERVATION_MAX_BYTES);
    const view = JSON.parse(kept.output);
    expect(view).toMatchObject({ kind: "execution_observation", observationId: kept.reference.observationId, sha256: kept.reference.sha256, exitCode: 7, truncated: true });
    expect(view.stdout.head.text).toMatch(/^HEAD_/); expect(view.stdout.tail.text).toMatch(/_TAIL$/);
    expect(view.stdout.head.text + view.stdout.tail.text).not.toContain("�");
    expect(view.stdout.omittedBytes).toBe(view.stdout.tail.start - view.stdout.head.end);
    expect(view.stdout.bytes).toBe(Buffer.byteLength(stdout)); expect(view.instruction).toContain("process failed");
    expect(f.checkpoints.load(kept.reference.snapshot)[0]!.bytes.length).toBe(kept.reference.bytes);
  });

  it("retrieves head, middle and tail evidence from the same context and reports actual Unicode byte boundaries", () => {
    const f = fixture(), stdout = `prefix\n${"x".repeat(100000)}FAIL row=73 expected=42 actual=41\n${"x".repeat(100000)}tail🙂`, kept = f.append(stdout, "错误🙂\0end");
    expect(JSON.parse(f.read(kept.reference, 0, 16).output).text).toContain("prefix");
    const middle = JSON.parse(f.read(kept.reference, 100007, 100).output); expect(middle.text).toContain("FAIL row=73 expected=42 actual=41");
    const tail = JSON.parse(f.read(kept.reference, Buffer.byteLength(stdout) - 8, 32).output); expect(tail.text).toBe("tail🙂");
    const unicode = JSON.parse(f.read(kept.reference, 1, 8, "stderr").output);
    expect(unicode.start).toBe(3); expect(unicode.end).toBe(unicode.nextOffset); expect(unicode.text).not.toContain("�");
    expect(unicode.end - unicode.start).toBeLessThanOrEqual(8);
    const end = JSON.parse(f.read(kept.reference, Buffer.byteLength(stdout), 4).output); expect(end.text).toBe(""); expect(end.truncated).toBe(false);
  });

  it("shortens escaped reads to the serialized cap while preserving nextOffset and progress", () => {
    const f = fixture(), kept = f.append("\0".repeat(30000));
    const value = f.read(kept.reference, 0, 8192), parsed = JSON.parse(value.output);
    expect(Buffer.byteLength(JSON.stringify(value.output))).toBeLessThanOrEqual(8192);
    expect(parsed.text.length).toBeGreaterThan(0); expect(parsed.nextOffset).toBe(parsed.end);
    expect(parsed.end).toBeLessThan(8192); expect(parsed.text).toBe("\0".repeat(parsed.end));
  });

  it("rejects arbitrary paths, wrong hashes, foreign context IDs and out-of-range offsets", () => {
    const f = fixture(), kept = f.append("hello");
    const args = { observationId: kept.reference.observationId, sha256: kept.reference.sha256, stream: "stdout" as const, offset: 0, maxBytes: 4 };
    expect(() => readObservationArguments.parse({ ...args, observationId: "../../file" })).toThrow();
    expect(() => readObservationArguments.parse({ ...args, maxBytes: 3 })).toThrow();
    expect(() => readObservationArguments.parse({ ...args, path: "/host" })).toThrow();
    expect(() => readExecutionObservation(f.scope, { ...args, sha256: digest("wrong") })).toThrow("observation_not_authorized");
    expect(() => readExecutionObservation(f.scope, { ...args, offset: 6 })).toThrow("observation_range_invalid");
    const foreign = randomUUID(); f.store.createContext({ id: foreign, jobId: f.jobId, sources: [{ id: "other", version: digest("other"), classification: "private", synthetic: true }] });
    expect(() => readExecutionObservation({ ...f.scope, contextId: foreign }, args)).toThrow("observation_not_authorized");
  });

  it.each(["missing", "corrupt"])("treats an authorized %s blob as integrity failure, never ordinary unavailable evidence", kind => {
    const f = fixture(), kept = f.append("retained original");
    const file = join(f.root, "blobs", f.jobId, kept.reference.sha256);
    if (kind === "missing") unlinkSync(file); else writeFileSync(file, "X".repeat(readFileSync(file).length));
    expect(() => readExecutionObservation(f.scope, { observationId: kept.reference.observationId, sha256: kept.reference.sha256, stream: "stdout", offset: 0, maxBytes: 16 })).toThrow(ObservationIntegrityError);
    expect(() => projectExecutionObservations(f.scope, f.messages)).toThrow(ObservationIntegrityError);
  });

  it("does not authorize a saved blob before its unique completed execute event", () => {
    const f = fixture(), operationId = randomUUID(), toolCallId = randomUUID();
    f.store.append(f.jobId, { type: "tool_started", contextId: f.contextId, operationId, toolCallId, name: "execute" });
    const kept = retainExecutionObservation(f.checkpoints, { jobId: f.jobId, contextId: f.contextId, operationId, toolCallId, result: { exitCode: 0, stdout: "saved before crash", stderr: "" } });
    expect(() => readExecutionObservation(f.scope, { observationId: kept.reference.observationId, sha256: kept.reference.sha256, stream: "stdout", offset: 0, maxBytes: 16 })).toThrow("observation_not_authorized");
  });

  it("rejects dropped metadata, forged output, cross-context references and duplicate or reversed operation joins", () => {
    const f = fixture(); f.append("original");
    const mutations: ((events: Record<string, any>[]) => void)[] = [
      rows => { delete rows.at(-1)!.executionObservation; }, rows => { delete rows.at(-1)!.executionObservation; delete rows.at(-1)!.executionCapture; },
      rows => { rows.at(-1)!.output = '{"exitCode":0,"stdout":"forged","stderr":""}'; },
      rows => { rows.at(-1)!.executionObservation.contextId = "foreign"; }, rows => { rows.at(-1)!.executionCapture = "unavailable"; },
      rows => { rows.at(-1)!.observationCapture = "retained"; }, rows => { rows.push(structuredClone(rows.at(-1)!)); },
      rows => { rows.at(-1)!.executionCapture = "not_invoked"; delete rows.at(-1)!.executionObservation; rows.at(-1)!.allowanceFinalizationEligible = false; rows.at(-1)!.invalidExecuteAtOutputLimit = false; },
      rows => { const start = rows.splice(1, 1)[0]!; rows.push(start); }, rows => { rows[1]!.name = "remember_plan"; },
    ];
    for (const mutate of mutations) expect(() => verifyExecutionObservations(f.altered(mutate))).toThrow(ObservationIntegrityError);
  });

  it("accepts exact model tool-call IDs with punctuation without using them as storage paths", () => {
    const f = fixture();
    for (const toolCallId of ["call:1", "path.foo", "call/with/slash"]) {
      const kept = f.append("ok", "", 0, toolCallId);
      expect(kept.reference.toolCallId).toBe(toolCallId);
      expect(kept.reference.snapshot[0]!.path).toBe(`execution-observations/${kept.reference.operationId}.json`);
    }
    expect(() => verifyExecutionObservations(f.scope)).not.toThrow();
  });

  it("accepts only fixed host failure feedback for non-retained completion, with no successful finalization eligibility", () => {
    const f = fixture();
    const op = randomUUID(), call = "execute:failure";
    f.store.append(f.jobId, { type: "tool_started", contextId: f.contextId, operationId: op, toolCallId: call, name: "execute" });
    f.store.append(f.jobId, { type: "tool_finished", contextId: f.contextId, operationId: op, toolCallId: call, executionCapture: "unavailable",
      invalidExecuteAtOutputLimit: false, allowanceFinalizationEligible: false, output: canonical({ error: "action_failed_or_not_permitted", completed: false }) });
    expect(() => verifyExecutionObservations(f.scope)).not.toThrow();
    for (const mutate of [
      (rows: Record<string, any>[]) => { rows.at(-1)!.allowanceFinalizationEligible = true; },
      (rows: Record<string, any>[]) => { rows.at(-1)!.output = " ".repeat(60_000) + rows.at(-1)!.output; },
      (rows: Record<string, any>[]) => { rows.at(-1)!.output = '{"completed":false,"error":"ignored duplicate","error":"action_failed_or_not_permitted"}'; },
      (rows: Record<string, any>[]) => { rows.at(-1)!.output = JSON.stringify({ error: "action_failed_or_not_permitted", completed: false, stdout: "arbitrary output" }); },
      (rows: Record<string, any>[]) => { rows.at(-1)!.output = JSON.stringify({ error: "action_failed_or_not_permitted", completed: false, actionInvoked: false }); },
    ]) expect(() => verifyExecutionObservations(f.altered(mutate))).toThrow(ObservationIntegrityError);
  });

  it("rejects readback range/identity/output tampering and an unacknowledged read under the new policy", () => {
    const f = fixture(), kept = f.append("x".repeat(20000)); f.read(kept.reference, 100, 32);
    for (const mutate of [
      (rows: Record<string, any>[]) => { rows.at(-1)!.observationRead.start++; },
      (rows: Record<string, any>[]) => { rows.at(-1)!.observationRead.sha256 = digest("other"); },
      (rows: Record<string, any>[]) => { rows.at(-1)!.output = "fabricated"; },
      (rows: Record<string, any>[]) => { delete rows.at(-1)!.observationRead; delete rows.at(-1)!.observationCapture; },
      (rows: Record<string, any>[]) => { delete rows.at(-1)!.observationRead; rows.at(-1)!.observationCapture = "not_invoked"; rows.at(-1)!.allowanceFinalizationEligible = false; rows.at(-1)!.invalidExecuteAtOutputLimit = false; },
    ]) expect(() => verifyExecutionObservations(f.altered(mutate))).toThrow(ObservationIntegrityError);
  });

  it("does not let older cheap full results crowd out newer useful excerpts", () => {
    const f = fixture();
    for (let i = 0; i < 40; i++) f.append("ok");
    for (let i = 0; i < 5; i++) f.append(`recent${i} ${"x".repeat(20000)}`);
    const projected = projectExecutionObservations(f.scope, f.messages);
    expect(projected.manifest.bytes).toBeLessThanOrEqual(EXECUTION_OBSERVATION_BUDGET_BYTES);
    expect(projected.messages).toEqual(f.messages);
  });

  it("bounds repeated outputs and readbacks together, retaining recent excerpts and exact deterministic restart projection", () => {
    const f = fixture();
    for (let i = 0; i < 12; i++) { const kept = f.append(`HEAD ${i} ${"repeated\0汉🙂".repeat(18000)} TAIL ${i}`); f.read(kept.reference, 10000, 8192); }
    const before = structuredClone(f.messages), first = projectExecutionObservations(f.scope, f.messages);
    expect(first.manifest.bytes).toBeLessThanOrEqual(EXECUTION_OBSERVATION_BUDGET_BYTES);
    expect(first.messages).toHaveLength(f.messages.length); expect(f.messages).toEqual(before);
    expect(first.messages.at(-1)!.content).toBe(f.messages.at(-1)!.content);
    expect(first.messages.filter(m => m.role === "tool" && m.content?.includes('"excerptOmitted":true')).length).toBeGreaterThan(0);
    expect(first.messages.filter(m => m.role === "assistant")).toEqual(f.messages.filter(m => m.role === "assistant"));
    for (const m of first.messages.filter(m => m.role === "tool")) expect(JSON.parse(m.content!).exitCode).toBe(0);
    const serialized = first.messages.filter(m => m.role === "tool").reduce((n, m) => n + Buffer.byteLength(JSON.stringify(m.content)), 0);
    expect(first.manifest.bytes).toBe(serialized);
    const reopened = new Database(f.filename); cleanups.push(() => reopened.close());
    const scope = { ...f.scope, store: new PrivateAgentStore(reopened), checkpoints: new PrivateCheckpointStore(join(f.root, "blobs"), f.jobId) };
    expect(projectExecutionObservations(scope, structuredClone(before))).toEqual(first);
  });

  it("leaves public/advice/unmarked legacy messages untouched and never trusts metadata inside model text", () => {
    const f = fixture(), kept = f.append("small");
    const extras: GeneralMessage[] = [{ role: "tool", tool_call_id: "public-fetch", content: "PUBLIC SOURCE\n".repeat(5000) },
      { role: "tool", tool_call_id: "advice", content: JSON.stringify({ executionObservation: kept.reference, maliciousClaim: true }) },
      { role: "tool", tool_call_id: "legacy", content: "legacy evidence" }];
    f.messages.push(...extras);
    expect(projectExecutionObservations(f.scope, f.messages).messages.slice(-3)).toEqual(extras);
    const changed = structuredClone(f.messages); changed[3]!.content = "changed retained content";
    expect(() => projectExecutionObservations(f.scope, changed)).toThrow(ObservationIntegrityError);
    expect(() => projectExecutionObservations(f.scope, f.messages.filter(m => m.tool_call_id !== kept.reference.toolCallId))).toThrow(ObservationIntegrityError);
  });

  it("propagates retention failure before any acknowledged tool output is available", () => {
    const f = fixture(); vi.spyOn(f.checkpoints, "save").mockImplementation(() => { throw new Error("private filesystem diagnostic"); });
    expect(() => retainExecutionObservation(f.checkpoints, { jobId: f.jobId, contextId: f.contextId, operationId: randomUUID(), toolCallId: randomUUID(), result: { exitCode: 0, stdout: "returned", stderr: "" } })).toThrow(ObservationIntegrityError);
    expect(f.events().filter(e => e.type === "tool_finished")).toEqual([]);
  });
});
