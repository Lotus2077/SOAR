/**
 * H4 select-and-repair loop (design entry BL-20261026 H4): two local samples of the same task, a host-checked selection,
 * one local critique of the selected draft and one local repair from the identical draft, then a final host-checked
 * selection. Every stage is a complete headless run (or the Phase 2 critique tool) in its own directory under the loop
 * directory, so every existing tool (registry rows, the gold scorer, blind bundles) works on a stage unchanged. Under
 * selection protocol 2 (backlog item 11, BL-20261109-0331) a tie keeps sample a over b and the selected draft over its
 * repair, and the entailment rates are recorded evidence only.
 *
 *   node --import tsx scripts/phase4-loop.ts --select-and-repair --loop-directory LOOP <the driver's flags, without --output-directory, --repair-from or --research-from>
 *   node --import tsx scripts/phase4-loop.ts --close --loop-directory LOOP
 *
 * Research tasks (--pipeline research): sample a runs the one reading stage; sample b and the repair write from a's packet
 * (--research-from), so the loop makes at most one stage's planner and synthesiser calls under sample a's own fee cap. When
 * a's stage leaves no packet the loop ends there: no second stage is ever paid for.
 *
 * Resume (LOOP_VERSION 2, backlog item 11, part 3b, BL-20261113-0836-infra-resume-design): an invocation holds the loop's
 * lock (`loop.lock`) for its whole run and saves `loop.json` atomically. A stage whose directory holds its result is reused
 * after its freeze is checked against the loop's task, runtime and lineage. A stage that ended on infrastructure is resumed
 * once, at zero fee: the invocation that ran it stops with `loop_stage_infra`, and the next one moves it aside to
 * `<stage>.infra-1` under a write-ahead entry and runs it again (sample a, when its reading stage completed, as a writer
 * seeded from the moved run). A stage directory without a freeze is a start that sent nothing, moved to `<stage>.void-<n>`.
 * The operator never moves a directory by hand; every moved run's spend stays in the record's totals. A loop that cannot go
 * on stops for good (`stopped`), and `--close` ends a loop at any other stop. A loop is never resumed under another loop
 * version, selection protocol, runtime, task, arm or pipeline, and a loop that has chosen or stopped for good is terminal.
 */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, digest } from "../src/main/private-agent/contracts";
import { acquireLoopLock, directoryInode, recoverRunClaims, recoverRunLedger, syncDirectory, writeFileAtomically } from "../src/main/private-agent/loop-ledger";
import { repairDraftPaths } from "../src/main/private-agent/repair";
import { researchTransferStatus } from "../src/main/private-agent/research-seed";
import { LOOP_INTEGRITY_STOPS, RUN_CLASSIFICATION_VERSION, RUN_UNFINISHED_CAUSE, classifyCritiqueEnd, classifyLoopStop, classifyRunEnd, ledgerStop, type LoopStopRun, type RunClass,
  type RunEndEvidence } from "../src/main/private-agent/run-classification";
import { SELECTION_PROTOCOL_VERSION, ZERO_FEE_DESTINATIONS, compareCandidates, readRunEndEvidence, readRunLedger, readRunObject, summarizeRun, type CandidateSummary, type RunLedger,
  type SelectionStep } from "../src/main/private-agent/selection";
import { servingCardRefusal } from "../src/main/private-agent/serving-card";
import { critique, type CritiqueArguments } from "./phase2-repair";
import { loadPreparedOperatorTask } from "./private-agent-run";
import { localScreenSourceFreeze, parseLocalArtifactScreenArguments, runLocalArtifactScreen } from "./private-agent-local-screen";

export const LOOP_VERSION = 2;
export type DriverInput = Parameters<typeof runLocalArtifactScreen>[0];
export type LoopCandidate = "a" | "b" | "repair";
export type LoopStage = LoopCandidate | "critique";
const STAGES: readonly LoopStage[] = ["a", "b", "critique", "repair"];
export interface LoopInput {
  /** The driver's input for one sample; its output directory, repair and seed are set per stage by the loop. */
  base: Omit<DriverInput, "outputDirectory" | "repairFrom" | "researchFrom">;
  loopDirectory: string;
}
export interface CritiqueUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface CritiqueRecord { packetSha256: string; critiqueSha256: string; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null;
  source?: { resultSha256: string; freezeSha256: string }; researchSnapshotSha256?: string }
/** The critique tool's failure record (critique-failure.json): its code, and what the refused call cost when it reached the model. */
export interface CritiqueFailureRecord { code: string | null; usage: CritiqueUsage | null; feeMicrousd: number; finishReason: string | null }
export interface LoopDependencies {
  runSample(input: DriverInput): Promise<unknown>;
  /** The critique tool; `control.signal` is the loop's interrupt (backlog item 11, part 3a; E1's bug d), never part of the critique's arguments. */
  critique(input: CritiqueArguments, control?: { signal?: AbortSignal }): Promise<{ binding: { packetSha256: string; critiqueSha256: string; source: { resultSha256: string; freezeSha256: string } }; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null }>;
  /** The critique tool's own record of a finished critique (critique.json), read back when the stage is reused. */
  readCritique(directory: string): CritiqueRecord;
  /** Part 3b: the critique tool's failure record, or null when its directory holds none. */
  readCritiqueFailure(directory: string): CritiqueFailureRecord | null;
  summarize(runDirectory: string, deliverables: string[]): CandidateSummary;
  /** Part 3a's reading of how a run with a result ended (readRunEndEvidence); the loop adds the stage's interrupt mark. */
  readRunEnd(runDirectory: string): Omit<RunEndEvidence, "stopSignalled">;
  /** Part 3b: a run directory with or without a result (readRunLedger). */
  readLedger(runDirectory: string): RunLedger;
  /** Part 3b: a stage's ledger recovered in place under the loop's lock (recoverRunLedger). */
  recoverLedger(runDirectory: string): void;
  /** Part 3b: a stage's unreleased run claims recovered through the store's own recovery path (recoverRunClaims). */
  recoverClaims(runDirectory: string, ledger: RunLedger): Promise<"confirmed" | "not_needed">;
  /** Part 3b: the loop's lock (acquireLoopLock); refuses with `loop_locked`. */
  lock(loopDirectory: string): { release(): void };
  /** The packet fingerprint a run's stage produced (its research_transfer), or null beside the seed loader's refusal code (backlog item 4). */
  transferStatus(runDirectory: string): { snapshotSha256: string | null; code: string | null };
  deliverables(): string[];
  now(): string;
  /** The live source freeze's hash (`localScreenSourceFreeze`), checked against `--runtime-sha256` before the loop touches its directory. */
  runtimeSha256(): string;
}
export interface LoopStageRecord { stage: LoopStage; startedAt: string; finishedAt: string; reused: boolean;
  /** Backlog item 11: the loop's own interrupt fired while this stage ran; carried onto every later reuse of the stage, dropped once it runs afresh or moves aside. */
  interrupted?: true }
/** Part 3b: a moved directory's identity, which a rename keeps: its inode, and its record file's sha256 (a run's freeze, a critique's failure record), or null. */
export interface StageIdentity { inode: string; sha256: string | null; jobId: string | null }
/** Part 3b: one resume, written ahead of its move to `<stage>.infra-1`; the moved run's counts stay in the loop's totals through it. */
export interface ResumeEntry { stage: LoopStage; cause: string; as: "rerun" | "seeded_writer"; identity: StageIdentity; counts: Totals;
  span: { startedAt: string; endedAt: string }; cleanup: "confirmed" | "not_needed"; at: string }
/** Part 3b: one start that sent nothing (no freeze), written ahead of its move to `<stage>.void-<n>`. */
export interface VoidEntry { stage: LoopStage; n: number; identity: StageIdentity; at: string }
/** Part 3b: a stage whose current directory a run the loop started has created or is about to create. */
export interface BegunEntry { stage: LoopStage; at: string }
/** Part 3b: a loop that cannot go on, or that the operator closed. */
export interface LoopStopped { stage: LoopStage | null; failure: string; closed?: true }
type FinalStep = SelectionStep | "stage_failed" | "no_draft" | "critique_failed" | "repair_failed";
export interface LoopRecord {
  version: typeof LOOP_VERSION; selectionRule: typeof SELECTION_PROTOCOL_VERSION; startedAt: string; finishedAt: string | null;
  task: { jobSha256: string; briefSha256: string }; runtimeSha256: string; arm: "local" | "cloud"; pipeline: "research" | null;
  stages: LoopStageRecord[];
  begun: BegunEntry[]; resumes: ResumeEntry[]; voids: VoidEntry[];
  candidates: { a: CandidateSummary | null; b: CandidateSummary | null; repair: CandidateSummary | null };
  /** Whether a (after a seeded-writer resume), b and the repair wrote from a packet, and that packet's fingerprint. */
  seeded: { a: boolean; b: boolean; repair: boolean; snapshotSha256: string | null };
  writeIdentityEqual: boolean | null;
  critique: { packetSha256: string; critiqueSha256: string; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null; modelCalls: number }
    | { failure: string; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null; modelCalls: number } | null;
  selected: { stage1: { candidate: "a" | "b"; step: SelectionStep; entailmentRates: [number | null, number | null] } | null;
    /** `seedRefusal`: the seed loader's code at `stage_failed` (backlog item 4). `cause`: why a `critique_failed` or `repair_failed` loop stopped (part 3b). */
    final: { candidate: LoopCandidate; step: FinalStep; entailmentRates?: [number | null, number | null]; seedRefusal?: string; cause?: string } | null };
  totals: Totals;
  /**
   * Part 3b: a stopped stage's counts on disk while it is neither a candidate, the critique's record nor moved aside; carried across
   * invocations and counted in the totals until the stage is reused, moved or held again (decision (7)).
   */
  held: { stage: LoopStage; counts: Totals } | null;
  failure: string | null;
  /** The stage being run or checked when an invocation stopped, or null. */
  failedStage: LoopStage | null;
  stopped: LoopStopped | null;
  /** Part 3b: the operator ended the loop with `--close`, at a stop (`stopped`) or after stage 1 (a `critique_failed` or `repair_failed` final). */
  closed?: true;
}
const TOTAL_KEYS = ["modelCalls", "toolCalls", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops", "feeMicrousd", "unknownDispatches", "retriedDispatches", "failedDispatches", "assistSkippedDispatches", "assistFailedDispatches",
  "zeroFeeFailedDispatches"] as const;
type Totals = Record<(typeof TOTAL_KEYS)[number], number>;
const USAGE_KEYS = [["inputTokens", "inputTokens"], ["outputTokens", "outputTokens"], ["cachedTokens", "cacheReadTokens"], ["cacheWriteTokens", "cacheWriteTokens"]] as const;
/** A recorded failure is a code, never a message: a thrown message may carry a host path or a file excerpt. */
const CODE = /^[a-z0-9_]{1,80}$/u;
/** Whether a path names anything, a symbolic link included (Python's `os.path.lexists`). */
const present = (path: string) => { try { lstatSync(path); return true; } catch { return false; } };
export function failureCode(error: unknown, fallback: string): string {
  return error instanceof Error && CODE.test(error.message) ? error.message : fallback;
}
/** SC: a serving-card refusal's allowlisted key path, as " at <path>" after its code, as the driver's failure line names it; "" otherwise. */
function keyPathSuffix(error: unknown): string {
  const at = servingCardRefusal(error)?.parameter;
  return at ? ` at ${at}` : "";
}
/** The loop CLI's failure line: the failure code, plus a serving-card refusal's allowlisted key path; any other failure keeps its earlier bytes. */
export function loopFailureLine(error: unknown): string {
  const at = servingCardRefusal(error)?.parameter;
  return `${canonical({ state: "incomplete", error: failureCode(error, "loop_failed"), ...(at ? { parameter: at } : {}) })}\n`;
}

/**
 * Part 3b, decision (2): every key of the driver's input, marked by whether a rerun carrying it can spend. The mapped type makes the
 * table exhaustive, so a key added to the driver's input (item 10.b's assist policy, if it lands outside `cloudArm`) fails the
 * typecheck until it is classified here, and a key outside the table refuses at run time. The local destinations cost nothing: the
 * driver admits only a `local_zero_cost` provider.
 */
const DRIVER_INPUT_SPEND: { readonly [K in keyof Required<DriverInput>]: "free" | "spends" } = {
  taskDirectory: "free", expectedJobSha256: "free", expectedBriefSha256: "free", syntheticAuthoritySha256: "free", expectedRuntimeSha256: "free", imageId: "free",
  outputDirectory: "free", publicRetrieval: "free", publicSnapshot: "free", pauseAfterTools: "free", profile: "free", claimsLedger: "free", cacheSalt: "free",
  pipeline: "free", documentReview: "free", cloudArm: "spends", repairFrom: "free", researchFrom: "free", retainDiagnostics: "free",
};
/** Whether a rerun with this driver input cannot spend: every key set is marked spend-free, and none is unknown. */
export function rerunCannotSpend(input: Partial<DriverInput>): boolean {
  return Object.entries(input).every(([key, value]) => value === undefined || (DRIVER_INPUT_SPEND as Readonly<Record<string, string>>)[key] === "free");
}

/** The production dependencies: the headless driver, the Phase 2 critique tool, the run summariser and part 3b's ledger helpers. */
export function productionDependencies(input: LoopInput): LoopDependencies {
  return { runSample: runLocalArtifactScreen, critique, summarize: summarizeRun, transferStatus: researchTransferStatus, now: () => new Date().toISOString(), runtimeSha256: () => localScreenSourceFreeze().sha256,
    ...ledgerDependencies(),
    deliverables: () => {
      const task = loadPreparedOperatorTask(input.base.taskDirectory, { jobSha256: input.base.expectedJobSha256, briefSha256: input.base.expectedBriefSha256 });
      return repairDraftPaths({ requiredArtifacts: task.phase.contract.requiredArtifacts.map(artifact => artifact.path), claimsLedger: input.base.claimsLedger === true, documentReview: input.base.documentReview === true });
    } };
}
/** Part 3b's production helpers and the critique tool's records, which `--close` needs without a task. */
export function ledgerDependencies(): Pick<LoopDependencies, "readRunEnd" | "readLedger" | "recoverLedger" | "recoverClaims" | "lock" | "readCritique" | "readCritiqueFailure"> {
  return { readRunEnd: readRunEndEvidence, readLedger: readRunLedger, recoverLedger: recoverRunLedger, recoverClaims: (directory, ledger) => recoverRunClaims(directory, ledger), lock: acquireLoopLock,
    // The critique tool's records, read as a run's files are (readRunObject): a record that cannot be read is no answer.
    readCritique: directory => {
      const saved = readRunObject(directory, "critique.json")?.value as Partial<CritiqueRecord> | undefined;
      if (!saved) throw new Error("loop_critique_unreadable");
      return { packetSha256: saved.packetSha256 as string, critiqueSha256: saved.critiqueSha256 as string, feeMicrousd: saved.feeMicrousd ?? 0, finishReason: saved.finishReason ?? null,
        usage: saved.usage ?? null, ...(saved.source ? { source: { resultSha256: saved.source.resultSha256, freezeSha256: saved.source.freezeSha256 } } : {}),
        ...(saved.researchSnapshotSha256 ? { researchSnapshotSha256: saved.researchSnapshotSha256 } : {}) };
    },
    readCritiqueFailure: directory => {
      if (!present(join(directory, "critique-failure.json"))) return null;
      const saved = readRunObject(directory, "critique-failure.json")?.value;
      if (!saved) return { code: null, usage: null, feeMicrousd: 0, finishReason: null };
      // A recorded failure is a code, never a message: the critique tool records its error's message, which may carry a host path.
      return { code: typeof saved.code === "string" ? (CODE.test(saved.code) ? saved.code : "repair_critique_failed") : null, usage: isObject(saved.usage) ? saved.usage as CritiqueUsage : null,
        feeMicrousd: countOf(saved.feeMicrousd), finishReason: typeof saved.finishReason === "string" ? saved.finishReason : null };
    } };
}

/** Every sample runs under the heavy profile with a local writer: a cloud writer is the all-cloud arm, which is a single run and never a loop. */
export function checkLoopInput(base: LoopInput["base"]): void {
  if (base.profile !== "heavy" || (base.cloudArm !== undefined && base.pipeline !== "research")) throw new Error("loop_cli_invalid");
}

/** A stop the loop cannot resume past (decision (6)), with what the stopped stage left, for the stop's class. */
class LoopStop extends Error {
  constructor(readonly failure: string, readonly stage: LoopStage | null, readonly evidence: LoopStopRun) { super(failure); }
}
const zeroTotals = (): Totals => Object.fromEntries(TOTAL_KEYS.map(key => [key, 0])) as Totals;
const isCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isText = (value: unknown) => typeof value === "string" && value.length > 0;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/u;
/** A count the totals can add: a finite, non-negative number, else 0 (a record's malformed field never turns a total into NaN). */
const countOf = (value: unknown) => isCount(value) ? value as number : 0;
/** Whether a critique's refused call reached the model: its record carries a usage object with a field (registry-row.py `critique_totals`). */
const madeCall = (failure: CritiqueFailureRecord | null) => failure !== null && failure.usage !== null && typeof failure.usage === "object" && !Array.isArray(failure.usage) &&
  Object.keys(failure.usage).length > 0;
/** A critique's call, counted as the loop's totals count it: one model call when the refused call reached the model. */
function critiqueTotals(record: { usage: CritiqueUsage | null; feeMicrousd: number; finishReason: string | null } | null, made: boolean): Totals {
  const totals = zeroTotals();
  if (!record || !made) return totals;
  totals.modelCalls = 1; totals.feeMicrousd = countOf(record.feeMicrousd);
  if (record.finishReason === "length") totals.lengthStops = 1;
  const usage = record.usage !== null && typeof record.usage === "object" ? record.usage : null;
  for (const [key, field] of USAGE_KEYS) totals[key] = countOf(usage?.[field]);
  return totals;
}
function ledgerTotals(ledger: RunLedger): Totals {
  const totals = zeroTotals();
  for (const key of TOTAL_KEYS) totals[key] = countOf(ledger.counts[key]);
  return totals;
}
/** A critique directory's one call from the tool's own record (critique.json, else critique-failure.json); a record that cannot be read counts nothing. */
function critiqueCounts(directory: string, deps: Pick<LoopDependencies, "readCritique" | "readCritiqueFailure">): Totals {
  try {
    if (present(join(directory, "critique.json"))) return critiqueTotals(deps.readCritique(directory), true);
    const failure = deps.readCritiqueFailure(directory);
    return critiqueTotals(failure, madeCall(failure));
  } catch { return zeroTotals(); }
}
/** What a resumed invocation carries from the record it resumes: part 3b's entries, and the counts and choices saved so far. */
type CarriedFields = Pick<LoopRecord, "begun" | "resumes" | "voids" | "candidates" | "critique" | "seeded" | "writeIdentityEqual" | "held"> & { stage1: LoopRecord["selected"]["stage1"] };
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/**
 * A prior record's carried fields, each well-formed, or null: a malformed one refuses the resume (`loop_record_mismatch`). The saved
 * candidates and critique are carried so that every save of a resumed invocation counts what the earlier ones counted until the stage
 * is reused, moved aside or held (decision (7)); a stage reused replaces its carried summary.
 */
function priorFields(prior: Partial<LoopRecord>): CarriedFields | null {
  const { begun, resumes, voids, candidates, critique, seeded, writeIdentityEqual, held } = prior;
  if (!Array.isArray(begun) || !Array.isArray(resumes) || !Array.isArray(voids)) return null;
  if (!isObject(candidates) || !(["a", "b", "repair"] as const).every(name => candidates[name] === null || (isObject(candidates[name]) && TOTAL_KEYS.every(key => isCount(candidates[name]![key]))))) return null;
  if (critique !== null && !(isObject(critique) && (critique.modelCalls === 0 || critique.modelCalls === 1) && isCount(critique.feeMicrousd) &&
      (critique.finishReason === null || typeof critique.finishReason === "string") && (critique.usage === null || isObject(critique.usage)) &&
      ("failure" in critique ? typeof critique.failure === "string" : isText(critique.packetSha256) && isText(critique.critiqueSha256)))) return null;
  if (!isObject(seeded) || ![seeded.a, seeded.b, seeded.repair].every(value => typeof value === "boolean") || (seeded.snapshotSha256 !== null && !isText(seeded.snapshotSha256))) return null;
  if (writeIdentityEqual !== null && typeof writeIdentityEqual !== "boolean") return null;
  // A record saved before `held` existed carries none.
  if (held !== null && held !== undefined && !(isObject(held) && (STAGES as readonly unknown[]).includes(held.stage) && isObject(held.counts) && TOTAL_KEYS.every(key => isCount(held.counts[key])))) return null;
  const stage1 = isObject(prior.selected) ? prior.selected.stage1 : undefined;
  if (stage1 !== null && !(isObject(stage1) && (stage1.candidate === "a" || stage1.candidate === "b") && isText(stage1.step) && Array.isArray(stage1.entailmentRates) &&
      stage1.entailmentRates.length === 2 && stage1.entailmentRates.every(rate => rate === null || (typeof rate === "number" && Number.isFinite(rate))))) return null;
  const identity = (value: unknown) => { const item = value as StageIdentity | null; return item !== null && typeof item === "object" && isText(item.inode) &&
    (item.sha256 === null || isText(item.sha256)) && (item.jobId === null || isText(item.jobId)); };
  const stage = (value: unknown) => (STAGES as readonly unknown[]).includes(value);
  if (!begun.every(entry => entry && stage(entry.stage) && isText(entry.at)) || new Set(begun.map(entry => entry.stage)).size !== begun.length) return null;
  if (!resumes.every(entry => entry && stage(entry.stage) && typeof entry.cause === "string" && IDENTIFIER.test(entry.cause) && (entry.as === "rerun" || entry.as === "seeded_writer") &&
      identity(entry.identity) && entry.counts && TOTAL_KEYS.every(key => isCount(entry.counts[key])) && entry.span && isText(entry.span.startedAt) && isText(entry.span.endedAt) &&
      (entry.cleanup === "confirmed" || entry.cleanup === "not_needed") && isText(entry.at)) || new Set(resumes.map(entry => entry.stage)).size !== resumes.length) return null;
  if (!voids.every(entry => entry && stage(entry.stage) && Number.isSafeInteger(entry.n) && entry.n >= 1 && identity(entry.identity) && isText(entry.at)) ||
      new Set(voids.map(entry => `${entry.stage}.${entry.n}`)).size !== voids.length) return null;
  return { begun, resumes, voids, candidates: { a: candidates.a ?? null, b: candidates.b ?? null, repair: candidates.repair ?? null } as LoopRecord["candidates"],
    critique: critique as LoopRecord["critique"], seeded: seeded as LoopRecord["seeded"], writeIdentityEqual: writeIdentityEqual as boolean | null, held: (held ?? null) as LoopRecord["held"],
    stage1: stage1 as LoopRecord["selected"]["stage1"] };
}
/** Where a resume or a void start moves a stage. */
const movedName = (stage: LoopStage, kind: "infra" | "void", n = 1) => kind === "infra" ? `${stage}.infra-1` : `${stage}.void-${n}`;
/** A stage directory's identity: its inode and its record file's sha256 (a run's freeze, the critique's failure record), or null without one. */
function identityOf(stage: LoopStage, directory: string, jobId: string | null): StageIdentity {
  const file = join(directory, stage === "critique" ? "critique-failure.json" : "freeze.json");
  return { inode: directoryInode(directory), sha256: existsSync(file) ? digest(readFileSync(file)) : null, jobId };
}
const sameIdentity = (stage: LoopStage, directory: string, identity: StageIdentity) => {
  const found = identityOf(stage, directory, identity.jobId);
  return found.inode === identity.inode && found.sha256 === identity.sha256;
};
/**
 * Decision (3)'s reconciliation, at every start under the lock: each entry finds its moved directory with the identity it recorded,
 * or the stage's directory with that identity, whose rename it completes; any other subdirectory refuses with `loop_resume_mismatch`.
 */
function reconcile(loop: string, record: Pick<LoopRecord, "begun" | "resumes" | "voids">, log: (line: string) => void): void {
  const moved = new Set<string>();
  const check = (stage: LoopStage, name: string, identity: StageIdentity) => {
    moved.add(name);
    const target = join(loop, name), source = join(loop, stage);
    if (existsSync(target)) { if (!sameIdentity(stage, target, identity)) throw new Error("loop_resume_mismatch"); return; }
    if (existsSync(source) && sameIdentity(stage, source, identity)) { renameSync(source, target); syncDirectory(loop); log(`${stage} moved to ${name} (completed)`); return; }
    throw new Error("loop_resume_mismatch");
  };
  for (const entry of record.resumes) check(entry.stage, movedName(entry.stage, "infra"), entry.identity);
  for (const entry of record.voids) check(entry.stage, movedName(entry.stage, "void", entry.n), entry.identity);
  for (const name of readdirSync(loop)) {
    if (!statSync(join(loop, name)).isDirectory() || moved.has(name)) continue;
    if ((STAGES as readonly string[]).includes(name) && record.begun.some(entry => entry.stage === name)) continue;
    throw new Error("loop_resume_mismatch");
  }
}

export async function runSelectionLoop(input: LoopInput, deps: LoopDependencies, control: { signal?: AbortSignal } = {}): Promise<LoopRecord> {
  checkLoopInput(input.base);
  // The loop's own rule and every module a stage runs are in the source freeze, and a reused stage never calls the driver that
  // checks it: a stale --runtime-sha256 is refused before the loop directory is touched (backlog item 11).
  if (deps.runtimeSha256() !== input.base.expectedRuntimeSha256) throw new Error("loop_reviewed_source_changed");
  const loop = resolve(input.loopDirectory);
  mkdirSync(loop, { recursive: true, mode: 0o700 });
  // Decision (3): the lock before anything else is read or written; a held lock refuses and writes nothing.
  const lock = deps.lock(loop);
  try { return await runLocked(loop, input, deps, control); }
  finally { lock.release(); }
}

async function runLocked(loop: string, input: LoopInput, deps: LoopDependencies, control: { signal?: AbortSignal }): Promise<LoopRecord> {
  const log = (line: string) => appendFileSync(join(loop, "log.txt"), `${deps.now()} ${line}\n`, { mode: 0o600 });
  // A loop that already chose or stopped for good is terminal; a loop that stopped earlier keeps its start, the times of the stages
  // it reuses, its begun stages and its moves, and only under the version, selection rule, runtime, task, arm and pipeline it started
  // with (its record is left as it was).
  let prior: LoopRecord | undefined;
  if (existsSync(join(loop, "loop.json"))) {
    prior = JSON.parse(readFileSync(join(loop, "loop.json"), "utf8")) as LoopRecord;
    if (prior.selected?.final || prior.stopped) throw new Error("loop_terminal");
    if (!Array.isArray(prior.stages) || prior.version !== LOOP_VERSION || prior.selectionRule !== SELECTION_PROTOCOL_VERSION || prior.runtimeSha256 !== input.base.expectedRuntimeSha256 ||
        prior.task?.jobSha256 !== input.base.expectedJobSha256 || prior.task?.briefSha256 !== input.base.expectedBriefSha256 ||
        prior.arm !== (input.base.cloudArm ? "cloud" : "local") || prior.pipeline !== (input.base.pipeline ?? null) || !priorFields(prior)) throw new Error("loop_record_mismatch");
  }
  const carried: CarriedFields = prior ? priorFields(prior)! : { begun: [], resumes: [], voids: [], candidates: { a: null, b: null, repair: null }, critique: null,
    seeded: { a: false, b: false, repair: false, snapshotSha256: null }, writeIdentityEqual: null, held: null, stage1: null };
  // Decision (3): a crash between a move's save and its rename is completed here; anything the record does not explain refuses.
  reconcile(loop, carried, log);
  const record: LoopRecord = { version: LOOP_VERSION, selectionRule: SELECTION_PROTOCOL_VERSION, startedAt: prior?.startedAt ?? deps.now(), finishedAt: null,
    task: { jobSha256: input.base.expectedJobSha256, briefSha256: input.base.expectedBriefSha256 }, runtimeSha256: input.base.expectedRuntimeSha256, arm: input.base.cloudArm ? "cloud" : "local", pipeline: input.base.pipeline ?? null,
    // A stage's interrupt mark (backlog item 11) outlives every invocation that stops before reaching that stage.
    stages: (prior?.stages ?? []).filter(entry => entry.interrupted === true).map(entry => ({ ...entry })),
    begun: carried.begun.map(entry => ({ ...entry })), resumes: carried.resumes.map(entry => ({ ...entry })), voids: carried.voids.map(entry => ({ ...entry })),
    // Decision (7): what the earlier invocations counted stays counted until its stage is reused, moved aside or held.
    candidates: { ...carried.candidates }, seeded: { ...carried.seeded }, writeIdentityEqual: carried.writeIdentityEqual, critique: carried.critique,
    selected: { stage1: carried.stage1, final: null }, totals: zeroTotals(), held: carried.held, failure: null, failedStage: null, stopped: null };
  const save = () => {
    // Decision (7): totals are recomputed at every save, so a moved run is counted once, through its resume entry, and never also as a candidate.
    const totals = zeroTotals(), add = (counts: Totals) => { for (const key of TOTAL_KEYS) totals[key] += counts[key]; };
    for (const name of ["a", "b", "repair"] as const) { const summary = record.candidates[name]; if (summary) add(summary); }
    if (record.critique) add(critiqueTotals(record.critique, record.critique.modelCalls > 0));
    for (const entry of record.resumes) add(entry.counts);
    if (record.held) add(record.held.counts);
    record.totals = totals;
    writeFileAtomically(join(loop, "loop.json"), `${canonical(record)}\n`);
  };
  /** A stopped stage's counts on disk, held in place of what the record carried for it, so the saved totals count its run once. */
  const holdCounts = (stage: LoopStage, counts: Totals | null) => {
    if (!counts) return;
    record.held = { stage, counts };
    if (stage === "critique") record.critique = null; else record.candidates[stage] = null;
  };
  /** The full caught error, name and message, for the operator (backlog item 4, finding B6); loop.json and log.txt keep codes only, since a message may carry a host path or a file excerpt. */
  const sideError = (code: string, error: unknown) => appendFileSync(join(loop, "errors.txt"), `${deps.now()} ${code} ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}${keyPathSuffix(error)}\n`, { mode: 0o600 });
  const deliverables = deps.deliverables();
  const research = input.base.pipeline === "research", cloudArmed = input.base.cloudArm !== undefined;
  const interrupted = () => control.signal?.aborted === true;
  const directory = (stage: LoopStage) => join(loop, stage);
  const resumeOf = (stage: LoopStage) => record.resumes.find(entry => entry.stage === stage);
  const begunOf = (stage: LoopStage) => record.begun.find(entry => entry.stage === stage);
  const dropBegun = (stage: LoopStage) => { record.begun = record.begun.filter(entry => entry.stage !== stage); };
  const markOf = (stage: LoopStage) => record.stages.some(entry => entry.stage === stage && entry.interrupted === true);
  let current: LoopStage | null = null;
  const stop = (failure: string, evidence: LoopStopRun = { kind: "none" }) => new LoopStop(failure, current, evidence);
  /** A stage's counts on disk: a run's ledger, or the critique tool's own record; null when its directory is missing or its ledger cannot be read. */
  const onDisk = (stage: LoopStage): Totals | null => {
    const dir = directory(stage);
    if (!existsSync(dir)) return null;
    if (stage === "critique") return critiqueCounts(dir, deps);
    try { return ledgerTotals(deps.readLedger(dir)); } catch { return null; }
  };
  /** A held stage's counts leave the held slot once its run is counted otherwise (a candidate, the critique's record or a resume entry). */
  const clearHeld = (stage: LoopStage) => { if (record.held?.stage === stage) record.held = null; };
  /**
   * A stage's span (decision (7)): the times it was recorded with (this invocation's entry, else the earlier record's first run of it),
   * else its ledger's: the freeze's start, else its begun time, to its result's end, else its last commit after that start, else the
   * start. The wait between invocations is never part of it.
   */
  const spanOf = (stage: LoopStage, ledger: RunLedger | null): { startedAt: string; finishedAt: string } => {
    const recorded = record.stages.find(item => item.stage === stage) ?? prior?.stages.find(item => item.stage === stage && !item.reused) ?? prior?.stages.find(item => item.stage === stage);
    if (recorded && isText(recorded.startedAt) && isText(recorded.finishedAt)) return { startedAt: recorded.startedAt, finishedAt: recorded.finishedAt };
    const startedAt = ledger?.freeze?.startedAt ?? begunOf(stage)?.at ?? deps.now();
    const start = Date.parse(startedAt), last = ledger?.lastCommittedAt ?? null;
    return { startedAt, finishedAt: ledger?.finishedAt ?? (last !== null && Number.isFinite(start) && last > start ? new Date(last).toISOString() : startedAt) };
  };

  /**
   * Runs a stage afresh: nothing starts after an interrupt; the stage joins `begun` in a save before its run; a stage running when
   * the loop's interrupt fired is marked (the driver cancels it on the same signal), also when the run then threw, and a stage whose
   * run threw before its directory existed leaves `begun`. A stage that threw or was cut holds its counts on disk until it is examined.
   */
  const runStage = async (stage: LoopStage, run: () => Promise<unknown>) => {
    if (interrupted()) throw new Error("loop_interrupted");
    record.stages = record.stages.filter(entry => entry.stage !== stage);
    const startedAt = deps.now();
    record.begun.push({ stage, at: startedAt }); save(); log(`${stage} start`);
    try { await run(); }
    catch (error) {
      if (!existsSync(directory(stage))) dropBegun(stage); else holdCounts(stage, onDisk(stage));
      if (interrupted()) record.stages.push({ stage, startedAt, finishedAt: deps.now(), reused: false, interrupted: true });
      throw error;
    }
    const cut = interrupted();
    record.stages.push({ stage, startedAt, finishedAt: deps.now(), reused: false, ...(cut ? { interrupted: true as const } : {}) }); log(`${stage} end`);
    if (cut) { holdCounts(stage, onDisk(stage)); throw new Error("loop_interrupted"); }
  };
  /** A found stage reused: the span it was first recorded with (`spanOf`), and its carried mark, which goes with it. */
  const reuse = (stage: LoopStage, ledger: RunLedger | null) => {
    const marked = markOf(stage), span = spanOf(stage, ledger);
    record.stages = record.stages.filter(entry => entry.stage !== stage);
    record.stages.push({ stage, startedAt: span.startedAt, finishedAt: span.finishedAt, reused: true, ...(marked ? { interrupted: true as const } : {}) });
    log(`${stage} reused`);
  };
  /**
   * Decision (3)'s write-ahead move: the entry and the stage's leaving `begun` are saved before the rename, the loop directory is
   * synced after it, and the stage's interrupt mark and its carried summary or critique record leave with it (the entry counts the run).
   */
  const moveAside = (stage: LoopStage, entry: { kind: "void" } | { kind: "infra"; cause: string; as: ResumeEntry["as"]; counts: Totals; cleanup: ResumeEntry["cleanup"] },
    jobId: string | null, ledger: RunLedger | null) => {
    const source = directory(stage), identity = identityOf(stage, source, jobId), at = deps.now();
    const n = entry.kind === "void" ? 1 + Math.max(0, ...record.voids.filter(item => item.stage === stage).map(item => item.n)) : 1;
    const name = movedName(stage, entry.kind, n), target = join(loop, name);
    if (existsSync(target)) throw new Error("loop_resume_mismatch");
    if (entry.kind === "infra") {
      const span = spanOf(stage, ledger);
      record.resumes.push({ stage, cause: entry.cause, as: entry.as, identity, counts: entry.counts, span: { startedAt: span.startedAt, endedAt: span.finishedAt }, cleanup: entry.cleanup, at });
    } else record.voids.push({ stage, n, identity, at });
    dropBegun(stage);
    record.stages = record.stages.filter(item => item.stage !== stage);
    if (stage === "critique") record.critique = null; else record.candidates[stage] = null;
    clearHeld(stage);
    save();
    log(`${stage} moved to ${name} (${entry.kind === "infra" ? entry.cause : "void"})`);
    renameSync(source, target); syncDirectory(loop);
  };

  /** Every candidate, fresh or reused, must be this loop's: the task, the runtime the samples ran under, and the lineage the stage order implies. */
  type Expectation = { seededFrom?: string | null; packet?: string | null; sourceFreeze?: string | null; repairOf?: CandidateSummary };
  const summarise = (name: LoopCandidate, expect: Expectation, evidence: LoopStopRun, ledger: RunLedger) => {
    const summary = deps.summarize(directory(name), deliverables);
    const lineageOk = expect.seededFrom === undefined ? true
      : expect.seededFrom === null ? summary.researchFrom === null
      : summary.researchFrom?.sourceJobId === expect.seededFrom && summary.researchFrom.snapshotSha256 === expect.packet &&
        (!expect.sourceFreeze || summary.researchFrom.sourceFreezeSha256 === expect.sourceFreeze);
    const repairOk = expect.repairOf === undefined ? summary.repairSource === null
      : summary.repairSource?.resultSha256 === expect.repairOf.resultSha256 && summary.repairSource.freezeSha256 === expect.repairOf.freezeSha256;
    // A summary must carry every count the totals add (backlog item 11): a missing one would turn a total into NaN and lose the record.
    if (summary.taskJobSha256 !== record.task.jobSha256 || summary.taskBriefSha256 !== record.task.briefSha256 || summary.runtimeSha256 !== record.runtimeSha256 || !lineageOk || !repairOk ||
        TOTAL_KEYS.some(key => !Number.isFinite(summary[key]) || summary[key] < 0)) { holdCounts(name, ledgerTotals(ledger)); throw stop("loop_stage_mismatch", evidence); }
    record.candidates[name] = summary; clearHeld(name);
    // A completed research packet does not resolve a later writer request. Keep this stage's evidence and counts, but never admit
    // another stage past uncertain dispatches (including committed receipts) or any failed row but a zero-fee one. An assist skipped
    // (unknown) or failed into the host fallback is counted apart and admitted (backlog item 10). Part 3b: these stops are for good.
    if (summary.unknownDispatches !== 0) throw stop("loop_stage_unresolved_dispatch", evidence);
    if (summary.failedDispatches !== summary.zeroFeeFailedDispatches) throw stop("loop_stage_failed_dispatch", evidence);
    return summary;
  };
  /** A dispatch row that cost nothing: a zero-fee destination with nothing reserved. */
  const zeroFeeRow = (row: Record<string, unknown>) => (ZERO_FEE_DESTINATIONS as readonly unknown[]).includes(row.destinationId) && row.reservedFeeMicrousd === 0;
  /** Decision (2): a resumed stage's run must show it sent nothing priced: every row zero-fee in destination and reservation, and a local freeze capped at 0. */
  const spentNothing = (ledger: RunLedger) => ledger.freeze !== null && ledger.freeze.localArm && ledger.freeze.feeCapMicrousd === 0 && ledger.dispatches.every(zeroFeeRow);
  /** Decision (2): how a candidate that ended on infrastructure is resumed at zero fee, or null when it cannot be. */
  const resumePlan = (name: LoopCandidate, rerun: () => DriverInput): ResumeEntry["as"] | null => {
    if (name === "a" && research) {
      const transfer = deps.transferStatus(directory("a"));
      if (transfer.snapshotSha256) return rerunCannotSpend({ ...rerun(), ...seeded(join(loop, movedName("a", "infra"))) }) ? "seeded_writer" : null;
      if (transfer.code === "research_seed_load_failed") throw new Error("loop_stage_ledger_unreadable");
    }
    return rerunCannotSpend(rerun()) ? "rerun" : null;
  };
  /** A seeded stage writes from the packet of a sample whose stage completed, never with a stage or a cloud writer of its own. */
  const seeded = (from: string): Partial<DriverInput> => ({ researchFrom: from, pipeline: undefined, cloudArm: undefined });
  /** Whether a run directory holds a readable freeze (a start that froze nothing sent nothing); a ledger that cannot be read is examined. */
  const frozen = (dir: string) => { try { return deps.readLedger(dir).freeze !== null; } catch { return true; } };

  /**
   * One candidate stage (decisions (1) to (4)): a found directory is recovered, then reused, resumed (moved aside and run again),
   * moved aside as a void start, or stopped on; a missing one is run, and a fresh run that ended on infrastructure and can be
   * resumed stops the invocation with `loop_stage_infra`, so the next invocation, after the launcher's idle check, resumes it.
   */
  const candidate = async (name: LoopCandidate, rerun: () => DriverInput, expect: () => Expectation): Promise<CandidateSummary> => {
    current = name;
    const dir = directory(name);
    if (existsSync(dir)) {
      const kept = await examine(name, false, rerun, expect);
      if (kept) return kept;
    } else if (begunOf(name)) {
      // Decision (3): a begun stage whose directory is missing. Only a fresh cloud-armed a could be paid twice, so only it stops.
      if (name === "a" && cloudArmed && !resumeOf("a")) throw stop("loop_stage_missing");
      dropBegun(name); log(`${name} missing: started again`);
    }
    try { await runStage(name, () => deps.runSample(rerun())); }
    catch (error) {
      // The driver threw. The loop's interrupt stays resumable; a run that froze is examined as one that may not have finished, so its
      // end is classed and its spend held (`loop_stage_infra`, a ledger stop or `loop_stage_incomplete`); a start that froze nothing
      // keeps its own refusal, and the next invocation moves it aside.
      if (interrupted()) { if (failureCode(error, "") !== "loop_interrupted") sideError("loop_interrupted", error); throw new Error("loop_interrupted"); }
      if (error instanceof LoopStop || !existsSync(dir) || !frozen(dir)) throw error;
      sideError(failureCode(error, "loop_stage_failed"), error); log(`${name} threw: examined`);
    }
    const kept = await examine(name, true, rerun, expect);
    if (!kept) throw stop("loop_stage_mismatch");
    return kept;
  };
  const examine = async (name: LoopCandidate, fresh: boolean, rerun: () => DriverInput, expect: () => Expectation): Promise<CandidateSummary | null> => {
    const dir = directory(name);
    if (!fresh) { try { deps.recoverLedger(dir); } catch { throw new Error("loop_stage_ledger_unreadable"); } }
    let ledger: RunLedger;
    try { ledger = deps.readLedger(dir); } catch { throw new Error("loop_stage_ledger_unreadable"); }
    const held = ledgerTotals(ledger), resultFile = existsSync(join(dir, "result.json")), mark = markOf(name), entry = resumeOf(name);
    if (!fresh && ledger.freeze === null) {
      // Decision (3): a start that sent nothing (the driver writes its freeze before its session, the only sender, starts).
      if (ledger.dispatches.length > 0 || resultFile) { holdCounts(name, held); throw stop("loop_stage_mismatch", { kind: "ledger", dispatches: ledger.dispatches }); }
      moveAside(name, { kind: "void" }, null, ledger); return null;
    }
    // A result that cannot be read is a run that did not finish (it died while the result was written).
    let end: RunEndEvidence | null = null;
    if (resultFile) { try { end = { ...deps.readRunEnd(dir), stopSignalled: mark }; } catch { end = null; } }
    const evidence: LoopStopRun = end ? { kind: "result", end } : { kind: "ledger", dispatches: ledger.dispatches };
    const runClass: RunClass = end ? classifyRunEnd(end) : { version: RUN_CLASSIFICATION_VERSION, infra: true, cause: RUN_UNFINISHED_CAUSE };
    if (entry && !spentNothing(ledger)) { holdCounts(name, held); throw stop("loop_resume_spent", evidence); }
    let plan: ResumeEntry["as"] | null = null;
    try { plan = runClass.infra && !entry ? resumePlan(name, rerun) : null; } catch (error) { holdCounts(name, held); throw error; }
    if (plan) {
      if (!fresh && ledger.freeze?.runtimeSha256 !== record.runtimeSha256) { holdCounts(name, held); throw stop("loop_stage_mismatch", evidence); }
      // Decision (4): the ledger's own rows decide first (a priced unresolved or failed row is never resumed), so a stopping row
      // stops the invocation that ran the stage; then the deferral, then the stage's sandbox claims and the write-ahead move.
      const stopped = ledgerStop(ledger.dispatches);
      if (stopped) { holdCounts(name, held); throw stop(stopped.failure, evidence); }
      if (fresh) { holdCounts(name, held); throw new Error("loop_stage_infra"); }
      let cleanup: ResumeEntry["cleanup"];
      try { cleanup = await deps.recoverClaims(dir, ledger); }
      catch (error) {
        holdCounts(name, held);
        if (failureCode(error, "") === "loop_stage_mismatch") throw stop("loop_stage_mismatch", evidence);
        throw new Error("loop_stage_cleanup_required");
      }
      moveAside(name, { kind: "infra", cause: runClass.cause, as: plan, counts: held, cleanup }, ledger.freeze?.jobId ?? null, ledger);
      return null;
    }
    if (!end) { holdCounts(name, held); throw stop(ledgerStop(ledger.dispatches)?.failure ?? "loop_stage_incomplete", evidence); }
    if (!fresh) reuse(name, ledger);
    const summary = summarise(name, expect(), evidence, ledger);
    // Backlog item 11: a stage the loop's own interrupt cut, whose end part 3a gives to the operator, is no candidate; part 3b resumes it
    // once, and stops here when it cannot. A marked stage that ended on the task, or submitted, is an ordinary candidate.
    if (runClass.infra && (runClass.cause === "operator_stop" || runClass.cause === "public_operator_stop")) throw stop("loop_stage_interrupted", evidence);
    return summary;
  };

  /** The critique's end recorded, with its call when it reached the model; it replaces whatever the record carried or held for the critique. */
  const addCritiqueRecord = (failure: CritiqueFailureRecord | null, code: string) => {
    record.critique = { failure: code, feeMicrousd: countOf(failure?.feeMicrousd), finishReason: typeof failure?.finishReason === "string" ? failure.finishReason : null,
      usage: failure && isObject(failure.usage) ? failure.usage : null, modelCalls: madeCall(failure) ? 1 : 0 };
    clearHeld("critique");
  };

  const aDir = directory("a"), bDir = directory("b");
  try {
    save();
    const aRerun = (): DriverInput => resumeOf("a")?.as === "seeded_writer" ? { ...input.base, outputDirectory: aDir, ...seeded(join(loop, movedName("a", "infra"))) } : { ...input.base, outputDirectory: aDir };
    const movedJob = () => resumeOf("a")?.identity.jobId ?? null;
    const a = await candidate("a", aRerun, () => {
      const entry = resumeOf("a");
      return entry?.as === "seeded_writer" ? { seededFrom: entry.identity.jobId, packet: deps.transferStatus(join(loop, movedName("a", "infra"))).snapshotSha256, sourceFreeze: entry.identity.sha256 } : { seededFrom: null };
    });
    // One reading stage per loop: without a's packet there is nothing b or the repair may write from, and no second stage is paid for.
    // After a seeded-writer resume, the packet is the moved run's, and b and the repair write from it (the seed loader refuses a seeded source).
    const seededA = resumeOf("a")?.as === "seeded_writer";
    const packetSource = seededA ? join(loop, movedName("a", "infra")) : aDir;
    const transfer = research ? deps.transferStatus(packetSource) : null, packet = transfer?.snapshotSha256 ?? null;
    const sourceJob = seededA ? movedJob() : a.jobId, sourceFreeze = seededA ? resumeOf("a")!.identity.sha256 : null;
    record.seeded.a = seededA;
    if (research && packet === null) {
      // The seed loader's code says why a cannot be seeded from (no transfer, a protocol mismatch, a tampered packet); it is a host constant, safe in the log and the record.
      const seedRefusal = transfer?.code ?? undefined;
      record.selected.final = { candidate: "a", step: "stage_failed", ...(seedRefusal ? { seedRefusal } : {}) }; log(`stage failed in a (${seedRefusal ?? "no_packet"}): loop ends`); return record;
    }
    record.seeded.b = research; record.seeded.snapshotSha256 = packet;
    const lineage = (): Expectation => research ? { seededFrom: sourceJob, packet, sourceFreeze } : { seededFrom: null };
    const b = await candidate("b", () => ({ ...input.base, outputDirectory: bDir, ...(research ? seeded(packetSource) : {}) }), lineage);
    record.writeIdentityEqual = a.writeIdentity !== null && b.writeIdentity !== null ? a.writeIdentity === b.writeIdentity : null;
    const first = compareCandidates(a, b);
    const chosen: "a" | "b" = first.winner === "first" ? "a" : "b";
    record.selected.stage1 = { candidate: chosen, step: first.step, entailmentRates: first.entailmentRates }; save();
    log(`stage1 ${chosen} (${first.step})`);
    const selected = record.candidates[chosen]!;
    if (!selected.artifactsPresent) { record.selected.final = { candidate: chosen, step: "no_draft" }; log("no draft to repair"); return record; }

    // The critique (decisions (1), (3) and (6)): reused when it answered, resumed once when it ended on infrastructure, and otherwise
    // the end of the loop at `critique_failed`, with the draft as the final selection.
    current = "critique";
    const critiqueDir = directory("critique");
    const endCritique = (cause: string, code: string, failure: CritiqueFailureRecord | null) => {
      addCritiqueRecord(failure, code);
      record.selected.final = { candidate: chosen, step: "critique_failed", cause }; log(`critique failed: ${code}`); return record;
    };
    const critiqueLedger = () => { try { return deps.readLedger(critiqueDir); } catch { throw new Error("loop_stage_ledger_unreadable"); } };
    /** Decision (2): a resumed critique, like any resumed stage, must have sent nothing priced, whether it answered or failed; its call's counts are held at the stop. */
    const checkCritiqueSpend = (counts: Totals, evidence: LoopStopRun) => {
      if (!resumeOf("critique") || !existsSync(critiqueDir) || critiqueLedger().dispatches.every(zeroFeeRow)) return;
      holdCounts("critique", counts); throw stop("loop_resume_spent", evidence);
    };
    let critiqued: CritiqueRecord | undefined;
    if (existsSync(critiqueDir)) {
      try { deps.recoverLedger(critiqueDir); } catch { throw new Error("loop_stage_ledger_unreadable"); }
      // A critique record that cannot be read is no answer: the critique is then read by its failure record, or as one that did not finish.
      let answered: CritiqueRecord | null = null;
      if (present(join(critiqueDir, "critique.json"))) { try { answered = deps.readCritique(critiqueDir); } catch { answered = null; } }
      if (answered) { reuse("critique", null); critiqued = answered; }
      else {
        const failure = deps.readCritiqueFailure(critiqueDir), code = failure ? failure.code : null, mark = markOf("critique");
        const critiqueClass = classifyCritiqueEnd(code, mark), evidence: LoopStopRun = { kind: "critique", code, stopSignalled: mark };
        const counts = critiqueTotals(failure, madeCall(failure));
        checkCritiqueSpend(counts, evidence);
        if (critiqueClass.infra && !resumeOf("critique")) {
          const ledger = critiqueLedger(), stopped = ledgerStop(ledger.dispatches);
          if (stopped) { addCritiqueRecord(failure, stopped.failure); throw stop(stopped.failure, evidence); }
          moveAside("critique", { kind: "infra", cause: critiqueClass.cause, as: "rerun", counts, cleanup: "not_needed" }, null, ledger);
        } else return endCritique(critiqueClass.cause, code ?? RUN_UNFINISHED_CAUSE, failure);
      }
    } else if (begunOf("critique")) { dropBegun("critique"); log("critique missing: started again"); }
    if (!critiqued) {
      try {
        await runStage("critique", () => deps.critique({ runDirectory: directory(chosen), taskDirectory: input.base.taskDirectory, expectedJobSha256: input.base.expectedJobSha256,
          expectedBriefSha256: input.base.expectedBriefSha256, imageId: input.base.imageId, outputDirectory: critiqueDir, critic: "local" }, { signal: control.signal }));
        // The critique tool's own record is the critique, so a resumed loop counts the call it already made.
        critiqued = deps.readCritique(critiqueDir);
      } catch (error) {
        // The loop's interrupt stopped the critique (E1's bug d): the loop can be resumed, never ended on a critique failure.
        if (interrupted()) { if (failureCode(error, "") !== "loop_interrupted") sideError("loop_interrupted", error); throw new Error("loop_interrupted"); }
        const code = failureCode(error, "repair_critique_failed");
        if (code === "loop_interrupted" || error instanceof LoopStop) throw error;
        sideError(code, error);
        // A refused critique that reached the model is still one call of the loop's own (the tool attaches its usage and fee to the error).
        const detail = error as { usage?: unknown; feeMicrousd?: unknown; finishReason?: unknown };
        const failure: CritiqueFailureRecord = { code, usage: isObject(detail.usage) ? detail.usage as CritiqueUsage : null, feeMicrousd: countOf(detail.feeMicrousd),
          finishReason: typeof detail.finishReason === "string" ? detail.finishReason : null };
        const critiqueClass = classifyCritiqueEnd(code, false), counts = critiqueTotals(failure, madeCall(failure));
        checkCritiqueSpend(counts, { kind: "critique", code, stopSignalled: false });
        // Decision (1): an infrastructure failure is resumed by the next invocation, once; its call's spend counts until then.
        if (critiqueClass.infra && !resumeOf("critique") && existsSync(critiqueDir)) { holdCounts("critique", counts); throw new Error("loop_stage_infra"); }
        return endCritique(critiqueClass.cause, code, failure);
      }
    }
    const answered: LoopStopRun = { kind: "critique", code: null, stopSignalled: false };
    checkCritiqueSpend(critiqueTotals(critiqued, true), answered);
    // A critique must be of the draft chosen now, on this loop's packet.
    if ((critiqued.source && (critiqued.source.resultSha256 !== selected.resultSha256 || critiqued.source.freezeSha256 !== selected.freezeSha256)) ||
        (critiqued.researchSnapshotSha256 ?? null) !== (research ? packet : null)) { holdCounts("critique", critiqueTotals(critiqued, true)); throw stop("loop_stage_mismatch", answered); }
    record.critique = { packetSha256: critiqued.packetSha256, critiqueSha256: critiqued.critiqueSha256, feeMicrousd: countOf(critiqued.feeMicrousd),
      finishReason: typeof critiqued.finishReason === "string" ? critiqued.finishReason : null, usage: isObject(critiqued.usage) ? critiqued.usage : null, modelCalls: 1 };
    clearHeld("critique");
    save();

    record.seeded.repair = research;
    const repair = await candidate("repair", () => ({ ...input.base, outputDirectory: directory("repair"), repairFrom: critiqueDir, ...(research ? seeded(packetSource) : {}) }),
      () => ({ ...lineage(), repairOf: selected }));
    // Protocol 2 (finding E9): the selected draft is the comparison's first, so a tie keeps it; the rates are [draft, repair].
    const second = compareCandidates(selected, repair);
    record.selected.final = { candidate: second.winner === "first" ? chosen : "repair", step: second.step, entailmentRates: second.entailmentRates };
    log(`final ${record.selected.final.candidate} (${second.step})`);
    return record;
  } catch (error) {
    if (error instanceof LoopStop) {
      // Decision (6): after stage 1, a stop at the critique or the repair ends the loop with the draft; other stops are for good.
      const stage1 = record.selected.stage1;
      if (stage1 && (error.stage === "critique" || error.stage === "repair") && !(LOOP_INTEGRITY_STOPS as readonly string[]).includes(error.failure)) {
        const cause = classifyLoopStop(error.failure, error.evidence).cause;
        if (error.stage === "critique" && !record.critique) record.critique = { failure: error.failure, feeMicrousd: 0, finishReason: null, usage: null, modelCalls: 0 };
        record.selected.final = { candidate: stage1.candidate, step: error.stage === "critique" ? "critique_failed" : "repair_failed", cause };
        record.failure = error.failure; record.failedStage = error.stage;
        log(`${error.stage} stopped (${error.failure}): final ${stage1.candidate}`);
        return record;
      }
      record.stopped = { stage: error.stage, failure: error.failure };
    }
    record.failure = failureCode(error, "loop_failed"); record.failedStage = current;
    log(`failure ${record.failure}${keyPathSuffix(error)}`); sideError(record.failure, error);
    throw error;
  } finally {
    // A stage whose run threw before its directory existed leaves `begun` (a serving-card refusal keeps the loop resumable).
    for (const entry of [...record.begun]) if (!existsSync(directory(entry.stage))) dropBegun(entry.stage);
    record.finishedAt = deps.now(); save();
  }
}

/**
 * Decision (6): `--close` ends a loop at a stop it will not be resumed from. Under the lock it reconciles, recovers each stage's
 * ledger, and records `stopped` with the totals of every run on disk; after stage 1 it ends the loop with its draft, as a stop
 * there does, unless the close itself found an integrity stop. Either way the record says it was closed. It runs nothing and needs
 * no runtime match, so a loop that a later merge strands can still be closed.
 */
export async function closeLoop(loopDirectory: string, deps: Pick<LoopDependencies, "lock" | "recoverLedger" | "readLedger" | "readRunEnd" | "readCritique" | "readCritiqueFailure" | "now">): Promise<LoopRecord> {
  const loop = resolve(loopDirectory);
  if (!existsSync(join(loop, "loop.json"))) throw new Error("loop_record_missing");
  const lock = deps.lock(loop);
  try {
    const record = JSON.parse(readFileSync(join(loop, "loop.json"), "utf8")) as LoopRecord;
    if (record.selected?.final || record.stopped) throw new Error("loop_terminal");
    const fields = record.version === LOOP_VERSION && Array.isArray(record.stages) ? priorFields(record) : null;
    if (!fields) throw new Error("loop_record_mismatch");
    const log = (line: string) => appendFileSync(join(loop, "log.txt"), `${deps.now()} ${line}\n`, { mode: 0o600 });
    let failure = typeof record.failure === "string" && CODE.test(record.failure) ? record.failure : "loop_closed";
    try { reconcile(loop, fields, log); } catch (error) { failure = failureCode(error, "loop_resume_mismatch"); }
    const isStage = (value: unknown): value is LoopStage => (STAGES as readonly unknown[]).includes(value);
    const markOf = (at: LoopStage) => record.stages.some(entry => isObject(entry) && entry.stage === at && entry.interrupted === true);
    // The stopped stage: the one recorded, else the last begun stage on disk that the loop had not accepted (no candidate, or no answered
    // critique in the record). A process killed mid-stage records none, and its stage may hold a torn result or one never examined.
    const accepted = (at: LoopStage) => at === "critique" ? fields.critique !== null && !("failure" in fields.critique) : fields.candidates[at] !== null;
    const stage = isStage(record.failedStage) ? record.failedStage : [...fields.begun].reverse().map(entry => entry.stage).find(at => existsSync(join(loop, at)) && !accepted(at)) ?? null;
    /** What a stage left, for its stop's class: a run's readable result (an unreadable one is a run that did not finish), else its ledger when its freeze is readable (a start that froze nothing left nothing), the critique's failure code, or nothing. */
    const evidenceOf = (at: LoopStage): LoopStopRun => {
      const dir = join(loop, at), mark = markOf(at);
      if (!existsSync(dir)) return { kind: "none" };
      if (at === "critique") { let code: string | null = null; try { code = deps.readCritiqueFailure(dir)?.code ?? null; } catch { code = null; } return { kind: "critique", code, stopSignalled: mark }; }
      if (existsSync(join(dir, "result.json"))) { try { return { kind: "result", end: { ...deps.readRunEnd(dir), stopSignalled: mark } }; } catch { /* read as a run that did not finish */ } }
      try { const ledger = deps.readLedger(dir); return ledger.freeze ? { kind: "ledger", dispatches: ledger.dispatches } : { kind: "none" }; } catch { return { kind: "none" }; }
    };
    const totals = zeroTotals(), add = (counts: Totals) => { for (const key of TOTAL_KEYS) totals[key] += counts[key]; };
    for (const name of ["a", "b", "repair"] as const) {
      const dir = join(loop, name), summary = fields.candidates[name];
      if (summary) add(summary);
      else if (existsSync(dir)) {
        try { deps.recoverLedger(dir); add(ledgerTotals(deps.readLedger(dir))); }
        catch { failure = "loop_stage_ledger_unreadable"; if (fields.held?.stage === name) add(fields.held.counts); }
      } else if (fields.held?.stage === name) add(fields.held.counts);
    }
    const critiqueDir = join(loop, "critique");
    let answered: CritiqueRecord | null = null;
    if (present(join(critiqueDir, "critique.json"))) { try { answered = deps.readCritique(critiqueDir); } catch { answered = null; } }
    if (fields.critique) add(critiqueTotals(fields.critique, fields.critique.modelCalls > 0));
    else if (existsSync(critiqueDir)) {
      try { deps.recoverLedger(critiqueDir); } catch { failure = "loop_stage_ledger_unreadable"; }
      add(critiqueCounts(critiqueDir, deps));
    } else if (fields.held?.stage === "critique") add(fields.held.counts);
    for (const entry of fields.resumes) add(entry.counts);
    record.totals = totals;
    const stage1 = fields.stage1;
    if (stage1 && (stage === "critique" || stage === "repair" || stage === null) && !(LOOP_INTEGRITY_STOPS as readonly string[]).includes(failure)) {
      let at: "critique" | "repair" = stage ?? (fields.critique && !("failure" in fields.critique) ? "repair" : "critique");
      // A critique that answered is complete, though the loop stopped before it recorded the answer: the loop stopped before its repair.
      if (at === "critique" && answered) at = "repair";
      record.selected.final = { candidate: stage1.candidate, step: at === "critique" ? "critique_failed" : "repair_failed", cause: classifyLoopStop(failure, evidenceOf(at)).cause };
      if (at === "repair" && answered && !(record.critique && !("failure" in record.critique))) {
        record.critique = { packetSha256: answered.packetSha256, critiqueSha256: answered.critiqueSha256, feeMicrousd: countOf(answered.feeMicrousd),
          finishReason: typeof answered.finishReason === "string" ? answered.finishReason : null, usage: isObject(answered.usage) ? answered.usage : null, modelCalls: 1 };
      }
      if (at === "critique" && !record.critique) {
        // As a stop at the critique records it: the critique's own code when it recorded one (as endCritique stores it), else the
        // close's, with the call the critique tool recorded when it reached the model.
        let saved: CritiqueFailureRecord | null = null;
        try { saved = existsSync(critiqueDir) ? deps.readCritiqueFailure(critiqueDir) : null; } catch { saved = null; }
        record.critique = { failure: saved?.code ?? failure, feeMicrousd: countOf(saved?.feeMicrousd), finishReason: typeof saved?.finishReason === "string" ? saved.finishReason : null,
          usage: saved && isObject(saved.usage) ? saved.usage : null, modelCalls: madeCall(saved) ? 1 : 0 };
      }
    } else record.stopped = { stage, failure, closed: true };
    record.closed = true;
    record.failure = failure; record.failedStage = stage; record.finishedAt = deps.now();
    writeFileAtomically(join(loop, "loop.json"), `${canonical(record)}\n`);
    log(`closed (${failure})`);
    return record;
  } finally { lock.release(); }
}

/** The loop takes the driver's own flags; the per-stage output, repair and seed are the loop's to set. */
export function parseLoopArguments(args: string[]): LoopInput {
  if (args[0] !== "--select-and-repair" || args.length % 2 !== 1 || args.indexOf("--loop-directory") < 1 || args.indexOf("--loop-directory") % 2 !== 1) throw new Error("loop_cli_invalid");
  for (const name of ["--output-directory", "--repair-from", "--research-from", "--pause-after-tools"]) if (args.includes(name)) throw new Error("loop_cli_invalid");
  const at = args.indexOf("--loop-directory"), loopDirectory = args[at + 1]!;
  if (!loopDirectory) throw new Error("loop_cli_invalid");
  const rest = [...args.slice(1, at), ...args.slice(at + 2)];
  const { outputDirectory: _ignored, ...base } = parseLocalArtifactScreenArguments(["--execute-synthetic-local", ...rest, "--output-directory", "loop-stage"]);
  checkLoopInput(base);
  return { base, loopDirectory };
}
/** `--close --loop-directory LOOP`: nothing else. */
export function parseCloseArguments(args: string[]): string {
  if (args.length !== 3 || args[0] !== "--close" || args[1] !== "--loop-directory" || !args[2]) throw new Error("loop_cli_invalid");
  return args[2];
}

/** The loop ends like the driver: exit 2 unless its deliverable is a submitted run. */
export function loopExitCode(record: LoopRecord): 0 | 2 {
  const final = record.selected.final;
  return final && !["stage_failed", "no_draft", "critique_failed", "repair_failed"].includes(final.step) && record.candidates[final.candidate]?.status === "submitted" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const args = process.argv.slice(2);
    const record = args[0] === "--close" ? await closeLoop(parseCloseArguments(args), { ...ledgerDependencies(), now: () => new Date().toISOString() })
      : await (async () => { const input = parseLoopArguments(args); return runSelectionLoop(input, productionDependencies(input), { signal: abort.signal }); })();
    const final = record.selected.final;
    process.exitCode = loopExitCode(record);
    process.stdout.write(`${canonical({ state: process.exitCode === 0 ? "selected" : record.stopped ? "stopped" : "ended", candidate: final?.candidate ?? null, step: final?.step ?? null, totals: record.totals })}\n`);
  } catch (error) { process.stderr.write(loopFailureLine(error)); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
