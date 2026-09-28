import { z } from "zod";
import { canonical, digest, exactText, privateAgentId, sha256Schema } from "./contracts";
import type { PrivateCheckpointStore } from "./checkpoints";
import type { PrivateAgentStore } from "./store";
import type { GeneralMessage, GeneralToolDefinition } from "./model";
import type { SandboxExecution } from "./sandbox";

export const EXECUTION_OBSERVATION_POLICY_VERSION = 1;
export const EXECUTION_OBSERVATION_MAX_BYTES = 8 * 1024;
export const EXECUTION_OBSERVATION_BUDGET_BYTES = 48 * 1024;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const integer = z.number().int().nonnegative().safe();
const decodedText = z.string().refine(text => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text));
const resultSchema = z.object({ exitCode: z.number().int().safe(), stdout: decodedText, stderr: decodedText }).strict();
const toolCallIdSchema = z.string().min(1).refine(value => { try { exactText(value); return true; } catch { return false; } });
const identityShape = { version: z.literal(1), jobId: privateAgentId, contextId: privateAgentId, operationId: privateAgentId, toolCallId: toolCallIdSchema };
const blobSchema = z.object({ ...identityShape, result: resultSchema }).strict();
const snapshotItemSchema = z.object({ path: z.string(), sha256: sha256Schema, bytes: integer.max(MAX_BLOB_BYTES) }).strict();
const referenceSchema = z.object({ ...identityShape, observationId: privateAgentId, sha256: sha256Schema, bytes: integer.max(MAX_BLOB_BYTES),
  exitCode: z.number().int().safe(), stdoutBytes: integer, stderrBytes: integer, snapshot: z.array(snapshotItemSchema).length(1) }).strict();
export type ExecutionObservationReference = z.infer<typeof referenceSchema>;

export const readObservationArguments = z.object({ observationId: privateAgentId, sha256: sha256Schema,
  stream: z.enum(["stdout", "stderr"]), offset: integer, maxBytes: z.number().int().min(4).max(EXECUTION_OBSERVATION_MAX_BYTES) }).strict();
export type ReadObservationArguments = z.infer<typeof readObservationArguments>;
const readReferenceSchema = readObservationArguments.extend({ version: z.literal(1), start: integer, end: integer, nextOffset: integer,
  totalBytes: integer, exitCode: z.number().int().safe() }).strict();
export type ObservationReadReference = z.infer<typeof readReferenceSchema>;
export interface ExecutionObservationScope { store: Pick<PrivateAgentStore, "events" | "context">; checkpoints: PrivateCheckpointStore; jobId: string; contextId: string }

export const READ_OBSERVATION_TOOL: GeneralToolDefinition = { type: "function", function: { name: "read_observation",
  description: "Read a bounded byte range from this task's retained execute stdout or stderr using its observation ID and exact SHA. Actual UTF-8 boundaries and nextOffset are returned. This is local evidence, not permission or artifact acceptance.",
  parameters: { type: "object", properties: { observationId: { type: "string" }, sha256: { type: "string" }, stream: { type: "string", enum: ["stdout", "stderr"] },
    offset: { type: "integer", minimum: 0 }, maxBytes: { type: "integer", minimum: 4, maximum: EXECUTION_OBSERVATION_MAX_BYTES } }, required: ["observationId", "sha256", "stream", "offset", "maxBytes"], additionalProperties: false } } };

export class ObservationIntegrityError extends Error {
  constructor() { super("execution_observation_integrity_failed"); }
}
function integrity(value: unknown): asserts value { if (!value) throw new ObservationIntegrityError(); }
function protectedRead<T>(fn: () => T): T { try { return fn(); } catch { throw new ObservationIntegrityError(); } }
const encode = (value: unknown): string => JSON.stringify(value);
const size = (value: string): number => Buffer.byteLength(value, "utf8");
const equal = (a: unknown, b: unknown): boolean => encode(a) === encode(b);
const wireSize = (output: string): number => size(encode(output));
const failedInstruction = "The process failed. Inspect retained stdout/stderr with read_observation, repair the cause and rerun the check within the original allowance.";

function boundary(bytes: Buffer, offset: number): number { while (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) offset++; return offset; }
function range(bytes: Buffer, offset: number, maximum: number): { start: number; end: number; text: string } {
  const start = boundary(bytes, Math.min(offset, bytes.length));
  let end = Math.min(bytes.length, start + maximum);
  while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return { start, end, text: bytes.subarray(start, end).toString("utf8") };
}
function excerpt(text: string, count: number) {
  const bytes = Buffer.from(text, "utf8"), head = range(bytes, 0, Math.min(count, bytes.length));
  const tail = range(bytes, Math.max(head.end, bytes.length - count), count);
  return { bytes: bytes.length, head, tail, omittedBytes: Math.max(0, tail.start - head.end) };
}
function executionOutput(reference: ExecutionObservationReference, result: SandboxExecution): string {
  const small = encode({ ...result, ...(result.exitCode !== 0 ? { instruction: "The process failed. Inspect this stdout/stderr, repair the cause and rerun the check within the original allowance." } : {}) });
  if (wireSize(small) <= EXECUTION_OBSERVATION_MAX_BYTES) return small;
  const render = (count: number) => encode({ version: 1, kind: "execution_observation", observationId: reference.observationId, sha256: reference.sha256,
    exitCode: result.exitCode, stdout: excerpt(result.stdout, count), stderr: excerpt(result.stderr, count), truncated: true,
    instruction: result.exitCode === 0 ? "Process exit zero does not prove semantic correctness. Inspect the visible evidence and use read_observation for omitted ranges before claiming a check passed." :
      failedInstruction });
  let low = 0, high = EXECUTION_OBSERVATION_MAX_BYTES, output = render(0);
  while (low <= high) { const middle = Math.floor((low + high) / 2), candidate = render(middle); if (wireSize(candidate) <= EXECUTION_OBSERVATION_MAX_BYTES) { output = candidate; low = middle + 1; } else high = middle - 1; }
  integrity(wireSize(output) <= EXECUTION_OBSERVATION_MAX_BYTES);
  return output;
}

/** Blob persistence is complete before the caller atomically acknowledges tool completion. */
export function retainExecutionObservation(checkpoints: PrivateCheckpointStore, input: {
  jobId: string; contextId: string; operationId: string; toolCallId: string; result: SandboxExecution;
}): { reference: ExecutionObservationReference; output: string } {
  return protectedRead(() => {
    const blob = blobSchema.parse({ version: 1, ...input });
    // JSON encoding preserves decoded NUL/control characters instead of rejecting or replacing them.
    const bytes = Buffer.from(encode(blob), "utf8"); integrity(bytes.length <= MAX_BLOB_BYTES);
    const snapshot = checkpoints.save([{ path: `execution-observations/${blob.operationId}.json`, bytes }]);
    const reference = referenceSchema.parse({ version: 1, jobId: blob.jobId, contextId: blob.contextId, operationId: blob.operationId, toolCallId: blob.toolCallId,
      observationId: blob.operationId, sha256: digest(bytes), bytes: bytes.length, exitCode: blob.result.exitCode,
      stdoutBytes: size(blob.result.stdout), stderrBytes: size(blob.result.stderr), snapshot });
    return { reference, output: executionOutput(reference, blob.result) };
  });
}

interface Verified { reference: ExecutionObservationReference; result: SandboxExecution; output: string; finishIndex: number }
interface Eligible { toolCallId: string; output: string; compact: string; reference: ExecutionObservationReference | ObservationReadReference }
function compactExecution(ref: ExecutionObservationReference): string {
  return encode({ version: 1, kind: "execution_observation_reference", observationId: ref.observationId, sha256: ref.sha256, exitCode: ref.exitCode,
    stdoutBytes: ref.stdoutBytes, stderrBytes: ref.stderrBytes, excerptOmitted: true, instruction: "Use read_observation for retained evidence. Process exit is not semantic acceptance." });
}
function readOutput(ref: ExecutionObservationReference, result: SandboxExecution, args: ReadObservationArguments): { reference: ObservationReadReference; output: string } {
  const bytes = Buffer.from(result[args.stream], "utf8");
  if (args.offset > bytes.length) throw new Error("observation_range_invalid");
  let maximum = args.maxBytes;
  for (;;) {
    const part = range(bytes, args.offset, maximum);
    const reference = { ...args, version: 1 as const, start: part.start, end: part.end, nextOffset: part.end, totalBytes: bytes.length, exitCode: ref.exitCode };
    const output = encode({ ...reference, kind: "execution_observation_read", text: part.text, truncated: part.end < bytes.length });
    if (wireSize(output) <= EXECUTION_OBSERVATION_MAX_BYTES) return { reference, output };
    integrity(maximum > 4); maximum = Math.max(4, Math.floor(maximum / 2));
  }
}
function compactRead(ref: ObservationReadReference): string { return encode({ ...ref, kind: "execution_observation_read_reference", excerptOmitted: true }); }

function validateFailure(event: Record<string, unknown>, tool: "execute" | "read_observation", unavailable: boolean): void {
  integrity(event.allowanceFinalizationEligible === false && typeof event.output === "string" && typeof event.invalidExecuteAtOutputLimit === "boolean");
  const output = JSON.parse(event.output as string);
  const generic = { error: "action_failed_or_not_permitted", completed: false };
  if (unavailable || tool === "read_observation" && output?.error === generic.error) {
    integrity(event.invalidExecuteAtOutputLimit === false && event.output === canonical(generic)); return;
  }
  const parameters = tool === "read_observation" ? READ_OBSERVATION_TOOL.function.parameters :
    { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false };
  const ordinary = { error: "invalid_tool_arguments", completed: false, actionInvoked: false, requiredArguments: parameters,
    instruction: "Return one tool call with a complete JSON object matching this schema. No action was invoked; retry only within the remaining allowance." };
  if (event.invalidExecuteAtOutputLimit) {
    const max = output?.configuredMaxOutputTokens;
    integrity(tool === "execute" && Number.isSafeInteger(max) && max >= 128 && max <= 4096 && output.observedOutputTokens === max);
    integrity(event.output === canonical({ ...ordinary, observedOutputTokens: max, configuredMaxOutputTokens: max,
      instruction: `The response used the configured ${max}-token output limit, but execute arguments were invalid. Zero command invocations occurred for this action. This observation does not establish why the arguments were incomplete. Next, return a complete execute JSON object with a command of at most 1500 characters: make one small incremental file write and read it back. Do not resend the full file; use only the remaining allowance.` }));
  } else integrity(event.output === canonical(ordinary));
}

function validated(scope: ExecutionObservationScope): { retained: Map<string, Verified>; eligible: Map<string, Eligible> } {
  return protectedRead(() => {
    privateAgentId.parse(scope.jobId); privateAgentId.parse(scope.contextId);
    integrity(scope.store.context(scope.contextId).jobId === scope.jobId);
    const events = scope.store.events(scope.jobId).filter(e => e.contextId === scope.contextId);
    const policy = events.some(e => e.type === "started" && e.executionObservationPolicyVersion === EXECUTION_OBSERVATION_POLICY_VERSION);
    const retained = new Map<string, Verified>(), eligible = new Map<string, Eligible>();
    const join = (event: Record<string, unknown>, index: number, name: string): number => {
      privateAgentId.parse(event.operationId); toolCallIdSchema.parse(event.toolCallId);
      const starts = events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === "tool_started" && (e.operationId === event.operationId || e.toolCallId === event.toolCallId));
      const finishes = events.filter(e => e.type === "tool_finished" && (e.operationId === event.operationId || e.toolCallId === event.toolCallId));
      integrity(starts.length === 1 && finishes.length === 1);
      const start = starts[0]!;
      integrity(start.i < index && start.e.name === name && start.e.operationId === event.operationId && start.e.toolCallId === event.toolCallId);
      return start.i;
    };
    for (const [index, event] of events.entries()) {
      if (event.type !== "tool_finished") continue;
      const start = events.find(e => e.type === "tool_started" && e.operationId === event.operationId && e.toolCallId === event.toolCallId);
      if (event.executionCapture !== undefined || event.executionObservation !== undefined || policy && start?.name === "execute") {
        join(event, index, "execute");
        integrity(["retained", "unavailable", "not_invoked"].includes(String(event.executionCapture)));
        integrity(event.observationRead === undefined && event.observationCapture === undefined);
        if (event.executionCapture !== "retained") { integrity(event.executionObservation === undefined); validateFailure(event, "execute", event.executionCapture === "unavailable"); continue; }
        const ref = referenceSchema.parse(event.executionObservation), item = ref.snapshot[0]!;
        integrity(ref.jobId === scope.jobId && ref.contextId === scope.contextId && ref.operationId === event.operationId && ref.toolCallId === event.toolCallId &&
          ref.observationId === ref.operationId && item.path === `execution-observations/${ref.operationId}.json` && item.sha256 === ref.sha256 && item.bytes === ref.bytes && !retained.has(ref.observationId));
        const file = scope.checkpoints.load(ref.snapshot)[0]!;
        const blob = blobSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
        integrity(blob.jobId === ref.jobId && blob.contextId === ref.contextId && blob.operationId === ref.operationId && blob.toolCallId === ref.toolCallId &&
          blob.result.exitCode === ref.exitCode && size(blob.result.stdout) === ref.stdoutBytes && size(blob.result.stderr) === ref.stderrBytes && file.bytes.length === ref.bytes && digest(file.bytes) === ref.sha256);
        const output = executionOutput(ref, blob.result);
        integrity(event.output === output && !eligible.has(ref.toolCallId));
        retained.set(ref.observationId, { reference: ref, result: blob.result, output, finishIndex: index });
        eligible.set(ref.toolCallId, { toolCallId: ref.toolCallId, output, compact: compactExecution(ref), reference: ref });
      } else if (event.observationRead !== undefined || event.observationCapture !== undefined || policy && start?.name === "read_observation") {
        const startIndex = join(event, index, "read_observation");
        integrity(event.executionObservation === undefined && event.executionCapture === undefined);
        if (event.observationCapture === "not_invoked") { integrity(event.observationRead === undefined); validateFailure(event, "read_observation", false); continue; }
        integrity(event.observationCapture === "retained");
        const ref = readReferenceSchema.parse(event.observationRead), original = retained.get(ref.observationId);
        integrity(original && original.finishIndex < startIndex && original.reference.sha256 === ref.sha256);
        const expected = readOutput(original.reference, original.result, readObservationArguments.parse({ observationId: ref.observationId, sha256: ref.sha256, stream: ref.stream, offset: ref.offset, maxBytes: ref.maxBytes }));
        integrity(equal(expected.reference, ref) && event.output === expected.output && !eligible.has(String(event.toolCallId)));
        eligible.set(String(event.toolCallId), { toolCallId: String(event.toolCallId), output: expected.output, compact: compactRead(ref), reference: ref });
      }
    }
    return { retained, eligible };
  });
}

export function verifyExecutionObservations(scope: ExecutionObservationScope): void { validated(scope); }

/** Host-only, detached values from the same full integrity check used for replay. */
export function verifiedExecutionResults(scope: ExecutionObservationScope): { reference: ExecutionObservationReference; result: SandboxExecution; finishIndex: number }[] {
  return structuredClone([...validated(scope).retained.values()].map(({ reference, result, finishIndex }) => ({ reference, result, finishIndex })));
}

export function readExecutionObservation(scope: ExecutionObservationScope, args: ReadObservationArguments): { reference: ObservationReadReference; output: string } {
  const parsed = readObservationArguments.parse(args);
  const original = validated(scope).retained.get(parsed.observationId);
  if (!original || original.reference.sha256 !== parsed.sha256) throw new Error("observation_not_authorized");
  return readOutput(original.reference, original.result, parsed);
}

export function projectExecutionObservations(scope: ExecutionObservationScope, messages: GeneralMessage[]): { messages: GeneralMessage[]; manifest: { version: 1; bytes: number; sha256: string } } {
  const { eligible } = validated(scope), seen = new Set<string>();
  const selected: { index: number; item: Eligible }[] = [];
  const projected = messages.map((message, index) => {
    const item = message.role === "tool" && message.tool_call_id ? eligible.get(message.tool_call_id) : undefined;
    if (!item) return message;
    integrity(message.content === item.output && !seen.has(item.toolCallId)); seen.add(item.toolCallId); selected.push({ index, item });
    return { ...message, content: wireSize(item.output) <= wireSize(item.compact) ? item.output : item.compact };
  });
  integrity(seen.size === eligible.size);
  const cost = wireSize;
  let bytes = selected.reduce((sum, { index }) => sum + cost(projected[index]!.content!), 0);
  integrity(bytes <= EXECUTION_OBSERVATION_BUDGET_BYTES);
  for (const { index, item } of [...selected].reverse()) {
    const difference = cost(item.output) - cost(projected[index]!.content!);
    if (bytes + difference <= EXECUTION_OBSERVATION_BUDGET_BYTES) { projected[index] = { ...projected[index]!, content: item.output }; bytes += difference; }
  }
  const sha256 = digest(encode({ version: 1, observationMaxBytes: EXECUTION_OBSERVATION_MAX_BYTES, budgetBytes: EXECUTION_OBSERVATION_BUDGET_BYTES,
    selected: selected.map(({ index, item }) => ({ index, toolCallId: item.toolCallId, reference: item.reference, outputSha256: digest(projected[index]!.content!) })) }));
  return { messages: projected, manifest: { version: 1, bytes, sha256 } };
}
