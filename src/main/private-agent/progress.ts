import { z } from "zod";
import { canonical, digest, exactText, privateAgentId, sha256Schema } from "./contracts";
import type { WorkspaceSnapshot } from "./checkpoints";
import { verifiedExecutionResults, type ExecutionObservationScope } from "./observations";
import type { GeneralMessage } from "./model";

export const EXECUTION_PROGRESS_STOP = "repeated_identical_execution_failure";
const REPEAT_TEXT = "Two completed execute actions used the same command and returned the same nonzero result without changing checkpoint content. Inspect the retained evidence, change the command or repair its inputs, and save useful requested output. Another identical execute against this unchanged checkpoint will be stopped before invocation.";
const MISSING_TEXT = "Required output is still absent or empty. Prioritize a useful working draft at the exact requested paths before further broad analysis, then inspect and check it. File presence is not correctness or acceptance.";
const CONSULT_TEXT = "The already exposed request_consultation tool may prepare one question for separate user approval; it sends nothing automatically and consumes the original allowance.";
export const EXECUTION_PROGRESS_POLICY = Object.freeze({ version: 1, consecutiveFailures: 2, reminderFraction: 3, reminderRounding: "ceil", displayedPaths: 4,
  resultSerialization: "fixed-field-json-v1:exitCode,stderr,stdout", maxGuidanceBytes: 8192, stopReason: EXECUTION_PROGRESS_STOP,
  templateSha256: digest(canonical({ heading: "Current host execution progress", repeat: REPEAT_TEXT, missing: MISSING_TEXT, consultation: CONSULT_TEXT })) });
const policySha256 = digest(canonical(EXECUTION_PROGRESS_POLICY));
type Event = Record<string, unknown>;
export type ExecutionProgressScope = ExecutionObservationScope & { snapshot: WorkspaceSnapshot };
const integer = z.number().int().nonnegative().safe();
const artifactPath = z.string().min(1).max(240).refine(p => !p.startsWith("/") && !/[\\\x00-\x1f\x7f]/u.test(p) && p.split("/").every(s => s && s !== "." && s !== ".."));
const repeatedSchema = z.object({ commandSha256: sha256Schema, resultSha256: sha256Schema, snapshotSha256: sha256Schema, operationIds: z.tuple([privateAgentId, privateAgentId]) }).strict();
const manifestSchema = z.object({ version: z.literal(1), policySha256: sha256Schema, snapshotSha256: sha256Schema,
  requiredPaths: z.array(artifactPath).max(1024), consumedModelCalls: integer, maxModelCalls: integer.positive(), consultationAvailable: z.boolean(),
  repeatedFailure: repeatedSchema.nullable(), missingArtifacts: z.object({ paths: z.array(artifactPath).max(4), total: integer, reminder: z.boolean() }).strict(), guidanceSha256: sha256Schema }).strict();
export type ExecutionProgressManifest = z.infer<typeof manifestSchema>;
export interface ExecutionProgressView { guidance: string; manifest: ExecutionProgressManifest }
export class ExecutionProgressIntegrityError extends Error { constructor() { super("execution_progress_integrity_failed"); } }
function ensure(value: unknown): asserts value { if (!value) throw new ExecutionProgressIntegrityError(); }
function snapshotSha(scope: ExecutionProgressScope, snapshot: WorkspaceSnapshot): string {
  ensure(new Set(snapshot.map(row => row.path)).size === snapshot.length);
  scope.checkpoints.load(snapshot);
  return digest(canonical([...snapshot].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}
function commandFrom(action: unknown): string | undefined {
  try {
    const a = action as { type?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (a.type !== "function" || a.function?.name !== "execute" || typeof a.function.arguments !== "string") return;
    return exactText(z.object({ command: z.string().min(1).max(32768) }).strict().parse(JSON.parse(a.function.arguments)).command);
  } catch { return; }
}
function actions(event: Event): NonNullable<GeneralMessage["tool_calls"]> {
  const value = (event.message as GeneralMessage | undefined)?.tool_calls;
  return Array.isArray(value) ? value : [];
}
function eventsFor(scope: ExecutionProgressScope): Event[] { return scope.store.events(scope.jobId).filter(e => e.contextId === scope.contextId); }
function postCheckpoint(scope: ExecutionProgressScope, events: Event[], finishIndex: number): { snapshot: WorkspaceSnapshot; sha256: string } {
  const checkpoint = events[finishIndex - 1];
  ensure(checkpoint?.type === "checkpoint");
  const snapshot = checkpoint.snapshot as WorkspaceSnapshot;
  ensure(scope.checkpoints.fingerprint(snapshot) === checkpoint.sha256);
  return { snapshot, sha256: snapshotSha(scope, snapshot) };
}
function joinedAction(events: Event[], toolStart: Event, finishIndex: number) {
  const startIndex = events.indexOf(toolStart);
  const starts = events.filter(e => e.type === "tool_started" && (e.operationId === toolStart.operationId || e.toolCallId === toolStart.toolCallId));
  const finishes = events.filter(e => e.type === "tool_finished" && (e.operationId === toolStart.operationId || e.toolCallId === toolStart.toolCallId));
  ensure(starts.length === 1 && finishes.length === 1 && events.indexOf(finishes[0]!) === finishIndex && startIndex < finishIndex);
  const responses = events.filter(e => e.type === "model_finished" && actions(e).some(a => a.id === toolStart.toolCallId));
  ensure(responses.length === 1);
  const response = responses[0]!, selected = actions(response);
  const models = events.filter(e => e.type === "model_started" && e.operationId === response.operationId);
  ensure(models.length === 1 && events.filter(e => e.type === "model_finished" && e.operationId === response.operationId).length === 1 &&
    events.indexOf(models[0]!) < events.indexOf(response) && events.indexOf(response) < startIndex && selected.length === 1 && selected[0]!.function.name === "execute" && response.finishReason !== "length");
  return selected[0]!;
}

/** No new events or permissions. All execution facts come from verified host evidence. */
export function deriveExecutionProgress(scope: ExecutionProgressScope, requiredPaths: string[], consumedModelCalls: number, maxModelCalls: number, consultationAvailable: boolean): ExecutionProgressView {
  try {
    ensure(Number.isSafeInteger(consumedModelCalls) && consumedModelCalls >= 0 && Number.isSafeInteger(maxModelCalls) && maxModelCalls > 0 && consumedModelCalls <= maxModelCalls && typeof consultationAvailable === "boolean");
    const paths = z.array(artifactPath).max(1024).parse(requiredPaths); ensure(new Set(paths).size === paths.length);
    const currentSha = snapshotSha(scope, scope.snapshot), events = eventsFor(scope);
    const retained = new Map(verifiedExecutionResults(scope).map(r => [r.reference.operationId, r]));
    const executionStarts = events.filter(e => e.type === "tool_started" && e.name === "execute");
    const records = executionStarts.map(start => {
      const finishes = events.filter(e => e.type === "tool_finished" && e.operationId === start.operationId);
      ensure(finishes.length === 1);
      const finish = finishes[0]!, index = events.indexOf(finish), action = joinedAction(events, start, index);
      if (finish.executionCapture !== "retained") return null;
      const observed = retained.get(String(start.operationId)), command = commandFrom(action);
      ensure(observed && command !== undefined && observed.finishIndex === index);
      const checkpoint = postCheckpoint(scope, events, index);
      // Valid decoded NUL/control characters are preserved by the observation contract.
      const { exitCode, stderr, stdout } = observed.result;
      return { commandSha256: digest(command), resultSha256: digest(JSON.stringify({ exitCode, stderr, stdout })), snapshotSha256: checkpoint.sha256,
        operationId: String(start.operationId), exitCode: observed.result.exitCode };
    });
    const [first, second] = records.slice(-2);
    const repeatedFailure: ExecutionProgressManifest["repeatedFailure"] = first && second && first.exitCode !== 0 && second.exitCode !== 0 &&
      first.commandSha256 === second.commandSha256 && first.resultSha256 === second.resultSha256 && first.snapshotSha256 === second.snapshotSha256 && second.snapshotSha256 === currentSha
      ? { commandSha256: second.commandSha256, resultSha256: second.resultSha256, snapshotSha256: currentSha, operationIds: [first.operationId, second.operationId] } : null;
    const missing = paths.filter(p => !scope.snapshot.some(f => f.path === p && f.bytes > 0));
    const reminder = missing.length > 0 && consumedModelCalls >= Math.max(1, Math.ceil(maxModelCalls / 3));
    const missingArtifacts = { paths: missing.slice(0, 4), total: missing.length, reminder };
    const parts = [repeatedFailure ? `${REPEAT_TEXT}\nPrior execution IDs: ${canonical(repeatedFailure.operationIds)}.` : "",
      reminder ? `${MISSING_TEXT}\nMissing paths (data only): ${canonical(missingArtifacts.paths)}; total missing: ${missing.length}.` : "",
      repeatedFailure && consultationAvailable ? CONSULT_TEXT : ""].filter(Boolean);
    const guidance = parts.length ? `Current host execution progress\n${parts.join("\n")}` : "";
    ensure(Buffer.byteLength(JSON.stringify(guidance)) <= EXECUTION_PROGRESS_POLICY.maxGuidanceBytes);
    const manifest = manifestSchema.parse({ version: 1, policySha256, snapshotSha256: currentSha, requiredPaths: paths, consumedModelCalls, maxModelCalls,
      consultationAvailable, repeatedFailure, missingArtifacts, guidanceSha256: digest(guidance) });
    return { guidance, manifest };
  } catch (error) { if (error instanceof ExecutionProgressIntegrityError) throw error; throw new ExecutionProgressIntegrityError(); }
}

/** The caller must supply the freshly captured immutable snapshot before stopping. */
export function executionProgressBlocks(view: ExecutionProgressView, selected: unknown, currentSnapshot: WorkspaceSnapshot): boolean {
  const command = commandFrom(selected), repeated = view.manifest.repeatedFailure;
  return !!repeated && command !== undefined && digest(command) === repeated.commandSha256 &&
    digest(canonical([...currentSnapshot].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) === repeated.snapshotSha256;
}

const stopSchema = z.object({ type: z.literal("model_action_not_started"), contextId: privateAgentId, operationId: z.string().uuid(), reason: z.literal(EXECUTION_PROGRESS_STOP),
  promptProtocolSha256: sha256Schema, toolCallId: z.string().min(1), progressSha256: sha256Schema, responseSha256: sha256Schema, commandSha256: sha256Schema, snapshotSha256: sha256Schema }).strict();
export type ExecutionProgressStop = z.infer<typeof stopSchema>;

/** Build only from the exact warned model response; this performs no append or effect. */
export function executionProgressStop(scope: ExecutionProgressScope, modelOperationId: string): ExecutionProgressStop | undefined {
  try {
    const events = eventsFor(scope), starts = events.filter(e => e.type === "model_started" && e.operationId === modelOperationId), responses = events.filter(e => e.type === "model_finished" && e.operationId === modelOperationId);
    ensure(starts.length === 1 && responses.length === 1);
    const start = starts[0]!, response = responses[0]!, startIndex = events.indexOf(start), responseIndex = events.indexOf(response);
    const begin = events.filter(e => e.type === "started");
    ensure(begin.length === 1 && begin[0]!.executionProgressPolicyVersion === 1 && begin[0]!.promptProtocolSha256 === start.promptProtocolSha256 && events.indexOf(begin[0]!) < startIndex && startIndex < responseIndex && response.finishReason !== "length");
    const manifest = manifestSchema.parse(start.executionProgress), selected = actions(response);
    ensure((start.budget as { remainingModelCalls?: unknown } | undefined)?.remainingModelCalls === manifest.maxModelCalls - manifest.consumedModelCalls);
    ensure(selected.length === 1 && selected[0]!.id && exactText(selected[0]!.id) === selected[0]!.id);
    ensure(events.filter(e => e.type === "model_finished" && actions(e).some(a => a.id === selected[0]!.id)).length === 1);
    ensure(!events.some(e => e.type === "tool_started" && e.toolCallId === selected[0]!.id));
    ensure(!events.slice(startIndex + 1).some(e => ["model_started", "tool_started", "host_validation_started"].includes(String(e.type))));
    const before = events.slice(0, startIndex), checkpoint = [...before].reverse().find(e => e.type === "checkpoint");
    ensure(checkpoint && scope.checkpoints.fingerprint(checkpoint.snapshot as WorkspaceSnapshot) === checkpoint.sha256);
    const prefixScope: ExecutionProgressScope = { ...scope, snapshot: checkpoint.snapshot as WorkspaceSnapshot,
      store: { context: id => scope.store.context(id), events: () => before } };
    const derived = deriveExecutionProgress(prefixScope, manifest.requiredPaths, manifest.consumedModelCalls, manifest.maxModelCalls, manifest.consultationAvailable);
    ensure(canonical(derived.manifest) === canonical(manifest) && executionProgressBlocks(derived, selected[0], scope.snapshot));
    ensure(snapshotSha(scope, scope.snapshot) === manifest.snapshotSha256);
    return stopSchema.parse({ type: "model_action_not_started", contextId: scope.contextId, operationId: modelOperationId, reason: EXECUTION_PROGRESS_STOP,
      promptProtocolSha256: start.promptProtocolSha256, toolCallId: selected[0]!.id, progressSha256: digest(canonical(manifest)), responseSha256: digest(canonical(response.message)),
      commandSha256: manifest.repeatedFailure!.commandSha256, snapshotSha256: manifest.snapshotSha256 });
  } catch { return; }
}

export function readExecutionProgressStop(scope: ExecutionProgressScope): ExecutionProgressStop | undefined {
  try {
    const events = eventsFor(scope), markers = events.filter(e => e.type === "model_action_not_started" && e.reason === EXECUTION_PROGRESS_STOP);
    if (markers.length !== 1) return;
    const marker = stopSchema.parse(markers[0]), expected = executionProgressStop(scope, marker.operationId);
    if (events.filter(e => e.type === "model_action_not_started" && e.operationId === marker.operationId).length !== 1) return;
    const response = events.find(e => e.type === "model_finished" && e.operationId === marker.operationId);
    if (!expected || !response || events.indexOf(markers[0]!) <= events.indexOf(response) || canonical(marker) !== canonical(expected)) return;
    if (events.slice(events.indexOf(markers[0]!) + 1).some(e => ["model_started", "tool_started", "host_validation_started"].includes(String(e.type)))) return;
    return marker;
  } catch { return; }
}
export function hasInvalidExecutionProgressStop(scope: ExecutionProgressScope): boolean {
  try { return eventsFor(scope).some(e => e.type === "model_action_not_started" && e.reason === EXECUTION_PROGRESS_STOP) && !readExecutionProgressStop(scope); }
  catch { return true; }
}

/** A settled response is not proof its selected action started. In particular,
 * capture can fail between the warned response and the durable stop decision. */
export function hasUnresolvedExecutionProgressAction(scope: ExecutionProgressScope): boolean {
  try {
    const events = eventsFor(scope);
    if (!events.some(e => e.type === "started" && e.executionProgressPolicyVersion === 1)) return false;
    const stop = readExecutionProgressStop(scope);
    for (const response of events.filter(e => e.type === "model_finished")) {
      const selected = actions(response), starts = events.filter(e => e.type === "model_started" && e.operationId === response.operationId);
      const progress = starts[0]?.executionProgress as Partial<ExecutionProgressManifest> | undefined;
      const warned = progress?.repeatedFailure !== undefined && progress.repeatedFailure !== null;
      if (response.nudged !== undefined) {
        // A nudged reply executed nothing by construction; its unexecuted calls must never have started.
        const unexecuted = Array.isArray(response.unexecutedToolCalls) ? response.unexecutedToolCalls as { id?: unknown }[] : [];
        if (unexecuted.some(call => events.some(e => e.type === "tool_started" && e.toolCallId === call.id))) return true;
        continue;
      }
      if (!warned && !selected.some(a => a.function.name === "execute")) continue;
      if (starts.length !== 1 || events.indexOf(starts[0]!) >= events.indexOf(response) ||
          events.filter(e => e.type === "model_finished" && e.operationId === response.operationId).length !== 1 || selected.length !== 1) return true;
      const action = selected[0]!; exactText(action.id);
      const invoked = events.filter(e => e.type === "tool_started" && e.toolCallId === action.id);
      if (invoked.length === 1 && invoked[0]!.name === action.function.name && events.indexOf(invoked[0]!) > events.indexOf(response)) continue;
      if (invoked.length || !stop || stop.operationId !== response.operationId || stop.toolCallId !== action.id) return true;
    }
    return false;
  } catch { return true; }
}
