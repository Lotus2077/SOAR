import Database from "better-sqlite3";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { sha256Schema } from "./contracts";
import { join } from "node:path";
import { z } from "zod";
import { canonical, digest } from "./contracts";

/**
 * H4 select-and-repair loop (design BL-20261026 H4 entry): the host-checked, deterministic selection between two
 * candidate runs. A candidate is a complete headless run summarised into counts from its own `result.json`,
 * `freeze.json` and event ledger; nothing here reads a prompt, an output or any model text.
 */
export const SELECTION_PROTOCOL_VERSION = 1;
const EMPTY_SHA256 = digest(Buffer.alloc(0));
export const ENTAILMENT_KEYS = Object.freeze(["supported", "partial", "unsupported", "contradicted", "not_judged"] as const);
export type EntailmentCounts = Record<(typeof ENTAILMENT_KEYS)[number], number>;
/** Step (4) decides only on two untruncated passes that each judged at least this many claims and whose balance rates differ by at least this margin. */
export const ENTAILMENT_MIN_JUDGED = 10;
export const ENTAILMENT_MIN_MARGIN = 0.1;
export interface CandidateSummary {
  jobId: string;
  /** The task the run was bound to and the reviewed-source hash it ran under; the loop refuses a candidate that is not its own. */
  taskJobSha256: string; taskBriefSha256: string; runtimeSha256: string;
  /** The packet a seeded run wrote from (its freeze's `researchFrom`), or null. */
  researchFrom: { sourceJobId: string; snapshotSha256: string } | null;
  /** The run a repair started from (its freeze's repair binding source), or null. */
  repairSource: { resultSha256: string; freezeSha256: string } | null;
  status: "submitted" | "paused" | "incomplete";
  reason: string;
  /** Critical checks passed of those the run's last verification reported (the `completed` event, else the last host validation, else the last finish result the agent saw); 0 of 0 when the run never verified. */
  checksPassed: number; checksTotal: number;
  /** Deliverables present and non-empty under `candidate/`. */
  artifactsPresent: number; artifactsTotal: number;
  /** The entailment pass's counts and whether the pass was cut short, or null when the run has none. */
  entailment: (EntailmentCounts & { truncated: boolean }) | null;
  /** The private context's `started.identity`, which binds the write phase's contract, files, checks and prompt protocol; null before the write phase started. */
  writeIdentity: string | null;
  /** Whether the checks counted above were verified on the run's final snapshot; false means a later edit left them stale and they count as 0 of 0. */
  checksCurrent: boolean;
  modelCalls: number; toolCalls: number; inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; lengthStops: number;
  feeMicrousd: number; unknownDispatches: number; retriedDispatches: number; failedDispatches: number;
  candidateSha256: string; freezeSha256: string; resultSha256: string;
  startedAt: string; finishedAt: string;
}
export type SelectionStep = "submitted" | "checks" | "artifacts" | "entailment" | "tie";
export interface Selection { winner: "first" | "second"; step: SelectionStep; entailmentRates: [number | null, number | null] }

/** The entailment balance rate over judged claims: (supported minus unsupported and contradicted) / judged; null when the pass is missing, truncated or too small to compare. */
export function entailmentRate(entailment: CandidateSummary["entailment"]): number | null {
  if (!entailment || entailment.truncated) return null;
  const judged = entailment.supported + entailment.partial + entailment.unsupported + entailment.contradicted;
  return judged >= ENTAILMENT_MIN_JUDGED ? (entailment.supported - entailment.unsupported - entailment.contradicted) / judged : null;
}
/**
 * The order the rule applies, most important first; the caller's `first` wins every tie, which is how the loop prefers
 * sample a and the repair. Step (4) is a local judge's verdict used as host-recorded evidence: it decides only between two
 * untruncated passes of at least ENTAILMENT_MIN_JUDGED claims whose rates differ by at least ENTAILMENT_MIN_MARGIN.
 */
export function compareCandidates(first: CandidateSummary, second: CandidateSummary): Selection {
  const rates: [number | null, number | null] = [entailmentRate(first.entailment), entailmentRate(second.entailment)];
  const steps: [SelectionStep, number, number][] = [["submitted", first.status === "submitted" ? 1 : 0, second.status === "submitted" ? 1 : 0],
    ["checks", first.checksPassed, second.checksPassed], ["artifacts", first.artifactsPresent, second.artifactsPresent]];
  for (const [step, a, b] of steps) {
    if (a > b) return { winner: "first", step, entailmentRates: rates };
    if (a < b) return { winner: "second", step, entailmentRates: rates };
  }
  if (rates[0] !== null && rates[1] !== null && Math.abs(rates[0] - rates[1]) >= ENTAILMENT_MIN_MARGIN) return { winner: rates[0] > rates[1] ? "first" : "second", step: "entailment", entailmentRates: rates };
  return { winner: "first", step: "tie", entailmentRates: rates };
}

const resultSchema = z.object({ status: z.enum(["submitted", "paused", "incomplete"]), reason: z.string(), finishedAt: z.string(), snapshotSha256: z.string(),
  candidateFiles: z.array(z.object({ path: z.string(), sha256: z.string() }).passthrough()),
  dispatches: z.array(z.object({ status: z.string(), feeMicrousd: z.number().optional().nullable() }).passthrough()) }).passthrough();
const freezeSchema = z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u), startedAt: z.string(), sourceFreezeSha256: sha256Schema,
  taskBinding: z.object({ jobSha256: sha256Schema, briefSha256: sha256Schema }).passthrough(),
  researchFrom: z.object({ sourceJobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u), snapshotSha256: sha256Schema }).passthrough().optional(),
  repair: z.object({ source: z.object({ resultSha256: sha256Schema, freezeSha256: sha256Schema }).passthrough() }).passthrough().optional() }).passthrough();
const checksSchema = z.array(z.object({ id: z.string(), passed: z.boolean() }).strict());

function insidePath(path: string, base: string): string {
  if (lstatSync(path).isSymbolicLink() || !realpathSync(path).startsWith(base + "/")) throw new Error("selection_run_directory_invalid");
  return path;
}
function insideFile(path: string, base: string): Buffer { return readFileSync(insidePath(path, base)); }
const usageNumber = (usage: unknown, key: string) => { const value = (usage as Record<string, unknown> | null | undefined)?.[key]; return typeof value === "number" && Number.isFinite(value) ? value : 0; };

/** Summarises one headless run; `deliverables` are the task's required artifacts plus those its host-checked mode adds. */
export function summarizeRun(runDirectory: string, deliverables: string[]): CandidateSummary {
  const root = realpathSync(runDirectory);
  const freezeBytes = insideFile(join(root, "freeze.json"), root), resultBytes = insideFile(join(root, "result.json"), root);
  const freeze = freezeSchema.parse(JSON.parse(freezeBytes.toString("utf8"))), result = resultSchema.parse(JSON.parse(resultBytes.toString("utf8")));
  const database = new Database(insidePath(join(root, "state.sqlite"), root), { readonly: true, fileMustExist: true });
  let events: Record<string, unknown>[];
  try { events = (database.prepare("SELECT value FROM private_agent_events WHERE job_id = ? ORDER BY sequence").all(freeze.jobId) as { value: string }[]).map(row => JSON.parse(row.value)); }
  finally { database.close(); }
  const start = events.find(event => event.type === "session_started");
  const privateContext = typeof start?.privateContextId === "string" ? start.privateContextId : undefined;
  const inPrivate = (event: Record<string, unknown>) => privateContext === undefined || event.contextId === privateContext;
  const names = new Map<string, string>();
  for (const event of events) if (event.type === "tool_started" && typeof event.operationId === "string" && typeof event.name === "string") names.set(event.operationId, event.name);
  // A verification counts only when it covered the run's final snapshot: a completion or an allowance validation records the
  // snapshot it verified; a finish result is written atomically after a checkpoint of the files it verified, and the agent
  // may edit again after a failed finish, so a later checkpoint makes that count stale (0 of 0).
  let checks: z.infer<typeof checksSchema> = [], checksCurrent = false;
  const finalSnapshot = result.snapshotSha256;
  const completed = events.find(event => event.type === "completed" && inPrivate(event));
  const validation = [...events].reverse().find(event => event.type === "host_validation_finished" && inPrivate(event));
  let finishIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) { const event = events[i]!; if (event.type === "tool_finished" && inPrivate(event) && names.get(String(event.operationId)) === "finish" && typeof event.output === "string") { finishIndex = i; break; } }
  const finish = finishIndex >= 0 ? events[finishIndex] : undefined, finishCheckpoint = finishIndex > 0 ? events[finishIndex - 1] : undefined;
  const candidates: [unknown, boolean][] = [[completed?.checks, completed?.verifiedSnapshotSha256 === finalSnapshot], [validation?.checks, validation?.verifiedSnapshotSha256 === finalSnapshot],
    [finish ? (() => { try { return (JSON.parse(finish.output as string) as { checks?: unknown }).checks; } catch { return undefined; } })() : undefined, finishCheckpoint?.type === "checkpoint" && finishCheckpoint.sha256 === finalSnapshot]];
  for (const [source, current] of candidates) {
    const parsed = checksSchema.safeParse(source);
    if (parsed.success) { if (current) { checks = parsed.data; checksCurrent = true; } break; }
  }
  const started = events.find(event => event.type === "started" && inPrivate(event));
  const entailmentEvent = [...events].reverse().find(event => event.type === "claims_entailment" && inPrivate(event));
  const counts = entailmentEvent?.counts as Record<string, unknown> | undefined;
  const entailment = counts && ENTAILMENT_KEYS.every(key => typeof counts[key] === "number")
    ? { ...Object.fromEntries(ENTAILMENT_KEYS.map(key => [key, counts[key] as number])) as EntailmentCounts, truncated: entailmentEvent?.truncated === true } : null;
  const finished = events.filter(event => event.type === "model_finished"), stages = events.filter(event => event.type === "research_stage");
  const sum = (key: string) => finished.reduce((total, event) => total + usageNumber(event.usage, key), 0) + stages.reduce((total, event) => total + usageNumber(event.usage, key), 0);
  const present = result.candidateFiles.filter(file => deliverables.includes(file.path) && file.sha256 !== EMPTY_SHA256).length;
  return { jobId: freeze.jobId, taskJobSha256: freeze.taskBinding.jobSha256, taskBriefSha256: freeze.taskBinding.briefSha256, runtimeSha256: freeze.sourceFreezeSha256,
    researchFrom: freeze.researchFrom ? { sourceJobId: freeze.researchFrom.sourceJobId, snapshotSha256: freeze.researchFrom.snapshotSha256 } : null,
    repairSource: freeze.repair ? { resultSha256: freeze.repair.source.resultSha256, freezeSha256: freeze.repair.source.freezeSha256 } : null,
    status: result.status, reason: result.reason,
    checksPassed: checks.filter(check => check.passed).length, checksTotal: checks.length, checksCurrent, artifactsPresent: present, artifactsTotal: deliverables.length, entailment,
    writeIdentity: typeof started?.identity === "string" ? started.identity : null,
    modelCalls: finished.length + stages.reduce((total, event) => total + (typeof event.calls === "number" ? event.calls : 0), 0),
    toolCalls: events.filter(event => event.type === "tool_finished").length,
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cachedTokens: sum("cacheReadTokens"), cacheWriteTokens: sum("cacheWriteTokens"),
    lengthStops: finished.filter(event => event.finishReason === "length").length,
    feeMicrousd: result.dispatches.reduce((total, row) => total + (row.feeMicrousd ?? 0), 0),
    unknownDispatches: result.dispatches.filter(row => row.status === "unknown" || row.status === "committed").length,
    retriedDispatches: result.dispatches.filter(row => row.status === "superseded").length,
    failedDispatches: result.dispatches.filter(row => row.status === "failed").length,
    candidateSha256: digest(canonical(result.candidateFiles.map(file => ({ path: file.path, sha256: file.sha256 })))), freezeSha256: digest(freezeBytes), resultSha256: digest(resultBytes),
    startedAt: freeze.startedAt, finishedAt: result.finishedAt };
}
