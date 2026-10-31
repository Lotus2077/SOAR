/**
 * H4 select-and-repair loop (design entry BL-20261026 H4): two local samples of the same task, a host-checked selection,
 * one local critique of the selected draft and one local repair from the identical draft, then a final host-checked
 * selection. Every stage is a complete headless run (or the Phase 2 critique tool) in its own directory under the loop
 * directory, so every existing tool (registry rows, the gold scorer, blind bundles) works on a stage unchanged.
 *
 *   node --import tsx scripts/phase4-loop.ts --select-and-repair --loop-directory LOOP <the driver's flags, without --output-directory, --repair-from or --research-from>
 *
 * Research tasks (--pipeline research): sample a runs the one reading stage; sample b and the repair write from a's packet
 * (--research-from), so the loop makes at most one stage's planner and synthesiser calls under sample a's own fee cap. When
 * a's stage leaves no packet the loop ends there: no second stage is ever paid for. A loop resumes at stage granularity:
 * a stage whose directory holds its result is reused after its freeze is checked against the loop's task, runtime and
 * lineage; a stage directory without one is refused and the operator moves it aside; a loop whose record already holds a
 * final choice is terminal and refused (a retry is a new loop directory); an interrupt ends the loop after the running stage.
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "../src/main/private-agent/contracts";
import { repairDraftPaths } from "../src/main/private-agent/repair";
import { researchTransferSnapshot } from "../src/main/private-agent/research-seed";
import { SELECTION_PROTOCOL_VERSION, compareCandidates, summarizeRun, type CandidateSummary, type SelectionStep } from "../src/main/private-agent/selection";
import { critique, type CritiqueArguments } from "./phase2-repair";
import { loadPreparedOperatorTask } from "./private-agent-run";
import { parseLocalArtifactScreenArguments, runLocalArtifactScreen } from "./private-agent-local-screen";

export const LOOP_VERSION = 1;
export type DriverInput = Parameters<typeof runLocalArtifactScreen>[0];
export type LoopCandidate = "a" | "b" | "repair";
export interface LoopInput {
  /** The driver's input for one sample; its output directory, repair and seed are set per stage by the loop. */
  base: Omit<DriverInput, "outputDirectory" | "repairFrom" | "researchFrom">;
  loopDirectory: string;
}
export interface CritiqueUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
export interface CritiqueRecord { packetSha256: string; critiqueSha256: string; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null;
  source?: { resultSha256: string; freezeSha256: string }; researchSnapshotSha256?: string }
export interface LoopDependencies {
  runSample(input: DriverInput): Promise<unknown>;
  critique(input: CritiqueArguments): Promise<{ binding: { packetSha256: string; critiqueSha256: string; source: { resultSha256: string; freezeSha256: string } }; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null }>;
  /** The critique tool's own record of a finished critique (critique.json), read back when the stage is reused. */
  readCritique(directory: string): CritiqueRecord;
  summarize(runDirectory: string, deliverables: string[]): CandidateSummary;
  /** The packet fingerprint a run's stage produced (its research_transfer), or null. */
  transferSnapshot(runDirectory: string): string | null;
  deliverables(): string[];
  now(): string;
}
export interface LoopStageRecord { stage: LoopCandidate | "critique"; startedAt: string; finishedAt: string; reused: boolean }
export interface LoopRecord {
  version: typeof LOOP_VERSION; selectionRule: typeof SELECTION_PROTOCOL_VERSION; startedAt: string; finishedAt: string | null;
  task: { jobSha256: string; briefSha256: string }; runtimeSha256: string; arm: "local" | "cloud"; pipeline: "research" | null;
  stages: LoopStageRecord[];
  candidates: { a: CandidateSummary | null; b: CandidateSummary | null; repair: CandidateSummary | null };
  /** Whether b and the repair wrote from a's packet, and that packet's fingerprint; the write phases of a and b are byte-identical when their private contexts' started identities agree. */
  seeded: { b: boolean; repair: boolean; snapshotSha256: string | null };
  writeIdentityEqual: boolean | null;
  critique: { packetSha256: string; critiqueSha256: string; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null; modelCalls: number }
    | { failure: string; feeMicrousd: number; finishReason: string | null; usage: CritiqueUsage | null; modelCalls: number } | null;
  selected: { stage1: { candidate: "a" | "b"; step: SelectionStep; entailmentRates: [number | null, number | null] } | null;
    final: { candidate: LoopCandidate; step: SelectionStep | "stage_failed" | "no_draft" | "critique_failed"; entailmentRates?: [number | null, number | null] } | null };
  totals: Record<"modelCalls" | "toolCalls" | "inputTokens" | "outputTokens" | "cachedTokens" | "cacheWriteTokens" | "lengthStops" | "feeMicrousd" | "unknownDispatches" | "retriedDispatches" | "failedDispatches", number>;
  failure: string | null;
}
const TOTAL_KEYS = ["modelCalls", "toolCalls", "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "lengthStops", "feeMicrousd", "unknownDispatches", "retriedDispatches", "failedDispatches"] as const;
const USAGE_KEYS = [["inputTokens", "inputTokens"], ["outputTokens", "outputTokens"], ["cachedTokens", "cacheReadTokens"], ["cacheWriteTokens", "cacheWriteTokens"]] as const;
/** A recorded failure is a code, never a message: a thrown message may carry a host path or a file excerpt. */
const CODE = /^[a-z0-9_]{1,80}$/u;
export function failureCode(error: unknown, fallback: string): string {
  return error instanceof Error && CODE.test(error.message) ? error.message : fallback;
}

/** The production dependencies: the headless driver, the Phase 2 critique tool and the run summariser. */
export function productionDependencies(input: LoopInput): LoopDependencies {
  return { runSample: runLocalArtifactScreen, critique, summarize: summarizeRun, transferSnapshot: researchTransferSnapshot, now: () => new Date().toISOString(),
    readCritique: directory => {
      const saved = JSON.parse(readFileSync(join(directory, "critique.json"), "utf8")) as CritiqueRecord;
      return { packetSha256: saved.packetSha256, critiqueSha256: saved.critiqueSha256, feeMicrousd: saved.feeMicrousd ?? 0, finishReason: saved.finishReason ?? null, usage: saved.usage ?? null,
        ...(saved.source ? { source: { resultSha256: saved.source.resultSha256, freezeSha256: saved.source.freezeSha256 } } : {}), ...(saved.researchSnapshotSha256 ? { researchSnapshotSha256: saved.researchSnapshotSha256 } : {}) };
    },
    deliverables: () => {
      const task = loadPreparedOperatorTask(input.base.taskDirectory, { jobSha256: input.base.expectedJobSha256, briefSha256: input.base.expectedBriefSha256 });
      return repairDraftPaths({ requiredArtifacts: task.phase.contract.requiredArtifacts.map(artifact => artifact.path), claimsLedger: input.base.claimsLedger === true, documentReview: input.base.documentReview === true });
    } };
}

/** Every sample runs under the heavy profile with a local writer: a cloud writer is the all-cloud arm, which is a single run and never a loop. */
export function checkLoopInput(base: LoopInput["base"]): void {
  if (base.profile !== "heavy" || (base.cloudArm !== undefined && base.pipeline !== "research")) throw new Error("loop_cli_invalid");
}

export async function runSelectionLoop(input: LoopInput, deps: LoopDependencies, control: { signal?: AbortSignal } = {}): Promise<LoopRecord> {
  checkLoopInput(input.base);
  const loop = resolve(input.loopDirectory);
  mkdirSync(loop, { recursive: true, mode: 0o700 });
  // A loop that already chose is terminal; a loop that stopped earlier keeps its start and the times of the stages it reuses.
  let prior: LoopRecord | undefined;
  if (existsSync(join(loop, "loop.json"))) {
    prior = JSON.parse(readFileSync(join(loop, "loop.json"), "utf8")) as LoopRecord;
    if (prior.selected?.final) throw new Error("loop_terminal");
  }
  const record: LoopRecord = { version: LOOP_VERSION, selectionRule: SELECTION_PROTOCOL_VERSION, startedAt: prior?.startedAt ?? deps.now(), finishedAt: null,
    task: { jobSha256: input.base.expectedJobSha256, briefSha256: input.base.expectedBriefSha256 }, runtimeSha256: input.base.expectedRuntimeSha256, arm: input.base.cloudArm ? "cloud" : "local", pipeline: input.base.pipeline ?? null,
    stages: [], candidates: { a: null, b: null, repair: null }, seeded: { b: false, repair: false, snapshotSha256: null }, writeIdentityEqual: null, critique: null, selected: { stage1: null, final: null },
    totals: Object.fromEntries(TOTAL_KEYS.map(key => [key, 0])) as LoopRecord["totals"], failure: null };
  const save = () => writeFileSync(join(loop, "loop.json"), `${canonical(record)}\n`, { mode: 0o600 });
  const log = (line: string) => appendFileSync(join(loop, "log.txt"), `${deps.now()} ${line}\n`, { mode: 0o600 });
  const deliverables = deps.deliverables();
  const research = input.base.pipeline === "research";
  const interrupted = () => control.signal?.aborted === true;
  /** A stage runs once: a finished stage is reused (with the times it was first recorded with), an unfinished one is refused, and nothing starts after an interrupt. */
  const stage = async <T>(name: LoopCandidate | "critique", marker: string, run: () => Promise<T>): Promise<{ reused: boolean }> => {
    const directory = join(loop, name);
    if (existsSync(join(directory, marker))) {
      const earlier = prior?.stages.find(entry => entry.stage === name && !entry.reused) ?? prior?.stages.find(entry => entry.stage === name);
      record.stages.push({ stage: name, startedAt: earlier?.startedAt ?? deps.now(), finishedAt: earlier?.finishedAt ?? deps.now(), reused: true }); log(`${name} reused`); return { reused: true };
    }
    if (existsSync(directory)) throw new Error("loop_stage_incomplete");
    if (interrupted()) throw new Error("loop_interrupted");
    const startedAt = deps.now(); log(`${name} start`);
    await run();
    record.stages.push({ stage: name, startedAt, finishedAt: deps.now(), reused: false }); log(`${name} end`);
    if (interrupted()) throw new Error("loop_interrupted");
    return { reused: false };
  };
  /** Every candidate, fresh or reused, must be this loop's: the task, the runtime the samples ran under, and the lineage the stage order implies. */
  const summarise = (name: LoopCandidate, expect: { seededFrom?: string | null; packet?: string | null; repairOf?: CandidateSummary }) => {
    const summary = deps.summarize(join(loop, name), deliverables);
    const lineageOk = expect.seededFrom === undefined ? true
      : expect.seededFrom === null ? summary.researchFrom === null
      : summary.researchFrom?.sourceJobId === expect.seededFrom && summary.researchFrom.snapshotSha256 === expect.packet;
    const repairOk = expect.repairOf === undefined ? summary.repairSource === null
      : summary.repairSource?.resultSha256 === expect.repairOf.resultSha256 && summary.repairSource.freezeSha256 === expect.repairOf.freezeSha256;
    if (summary.taskJobSha256 !== record.task.jobSha256 || summary.taskBriefSha256 !== record.task.briefSha256 || summary.runtimeSha256 !== record.runtimeSha256 || !lineageOk || !repairOk) throw new Error("loop_stage_mismatch");
    record.candidates[name] = summary; for (const key of TOTAL_KEYS) record.totals[key] += summary[key]; return summary;
  };
  const addCritique = (usage: CritiqueUsage | null, feeMicrousd: number, finishReason: string | null) => {
    record.totals.modelCalls += 1; record.totals.feeMicrousd += feeMicrousd;
    if (finishReason === "length") record.totals.lengthStops += 1;
    for (const [key, field] of USAGE_KEYS) record.totals[key] += usage?.[field] ?? 0;
  };
  /** A seeded stage writes from the packet of a sample whose stage completed, never with a stage or a cloud writer of its own. */
  const seeded = (from: string): Partial<DriverInput> => ({ researchFrom: from, pipeline: undefined, cloudArm: undefined });
  try {
    save();
    const aDir = join(loop, "a"), bDir = join(loop, "b");
    await stage("a", "result.json", () => deps.runSample({ ...input.base, outputDirectory: aDir }));
    const a = summarise("a", { seededFrom: null });
    // One reading stage per loop: without a's packet there is nothing b or the repair may write from, and no second stage is paid for.
    const packet = research ? deps.transferSnapshot(aDir) : null;
    if (research && packet === null) { record.selected.final = { candidate: "a", step: "stage_failed" }; log("stage failed in a: loop ends"); return record; }
    record.seeded.b = research; record.seeded.snapshotSha256 = packet;
    await stage("b", "result.json", () => deps.runSample({ ...input.base, outputDirectory: bDir, ...(research ? seeded(aDir) : {}) }));
    const b = summarise("b", research ? { seededFrom: a.jobId, packet } : { seededFrom: null });
    record.writeIdentityEqual = a.writeIdentity !== null && b.writeIdentity !== null ? a.writeIdentity === b.writeIdentity : null;
    const first = compareCandidates(a, b);
    const chosen: "a" | "b" = first.winner === "first" ? "a" : "b";
    record.selected.stage1 = { candidate: chosen, step: first.step, entailmentRates: first.entailmentRates }; save();
    log(`stage1 ${chosen} (${first.step})`);
    const selected = record.candidates[chosen]!;
    if (!selected.artifactsPresent) { record.selected.final = { candidate: chosen, step: "no_draft" }; log("no draft to repair"); return record; }
    const critiqueDir = join(loop, "critique");
    let critiqued: CritiqueRecord;
    try {
      await stage("critique", "critique.json", () => deps.critique({ runDirectory: join(loop, chosen), taskDirectory: input.base.taskDirectory, expectedJobSha256: input.base.expectedJobSha256,
        expectedBriefSha256: input.base.expectedBriefSha256, imageId: input.base.imageId, outputDirectory: critiqueDir, critic: "local" }));
      // The critique tool's own record is the critique, fresh or reused, so a resumed loop counts the call it already made; it must be a critique of the draft chosen now, on this loop's packet.
      critiqued = deps.readCritique(critiqueDir);
      if (critiqued.source && (critiqued.source.resultSha256 !== selected.resultSha256 || critiqued.source.freezeSha256 !== selected.freezeSha256)) throw new Error("loop_stage_mismatch");
      if ((critiqued.researchSnapshotSha256 ?? null) !== (research ? packet : null)) throw new Error("loop_stage_mismatch");
    } catch (error) {
      const code = failureCode(error, "repair_critique_failed");
      if (code === "loop_stage_incomplete" || code === "loop_stage_mismatch" || code === "loop_interrupted") throw error;
      // A refused critique that reached the model is still one call of the loop's own (the tool attaches its usage and fee to the error).
      const detail = error as { usage?: CritiqueUsage | null; feeMicrousd?: number | null; finishReason?: string | null };
      const made = detail.usage !== undefined && detail.usage !== null;
      record.critique = { failure: code, feeMicrousd: detail.feeMicrousd ?? 0, finishReason: detail.finishReason ?? null, usage: detail.usage ?? null, modelCalls: made ? 1 : 0 };
      if (made) addCritique(detail.usage!, detail.feeMicrousd ?? 0, detail.finishReason ?? null);
      record.selected.final = { candidate: chosen, step: "critique_failed" }; log(`critique failed: ${code}`); return record;
    }
    record.critique = { packetSha256: critiqued.packetSha256, critiqueSha256: critiqued.critiqueSha256, feeMicrousd: critiqued.feeMicrousd, finishReason: critiqued.finishReason, usage: critiqued.usage, modelCalls: 1 };
    addCritique(critiqued.usage, critiqued.feeMicrousd, critiqued.finishReason);
    save();
    record.seeded.repair = research;
    await stage("repair", "result.json", () => deps.runSample({ ...input.base, outputDirectory: join(loop, "repair"), repairFrom: critiqueDir, ...(research ? seeded(aDir) : {}) }));
    const repair = summarise("repair", { ...(research ? { seededFrom: a.jobId, packet } : { seededFrom: null }), repairOf: selected });
    const second = compareCandidates(repair, selected);
    record.selected.final = { candidate: second.winner === "first" ? "repair" : chosen, step: second.step, entailmentRates: second.entailmentRates };
    log(`final ${record.selected.final.candidate} (${second.step})`);
    return record;
  } catch (error) {
    record.failure = failureCode(error, "loop_failed"); log(`failure ${record.failure}`);
    throw error;
  } finally { record.finishedAt = deps.now(); save(); }
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

/** The loop ends like the driver: exit 2 unless its deliverable is a submitted run. */
export function loopExitCode(record: LoopRecord): 0 | 2 {
  const final = record.selected.final;
  return final && !["stage_failed", "no_draft", "critique_failed"].includes(final.step) && record.candidates[final.candidate]?.status === "submitted" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const input = parseLoopArguments(process.argv.slice(2));
    const record = await runSelectionLoop(input, productionDependencies(input), { signal: abort.signal });
    const final = record.selected.final;
    process.exitCode = loopExitCode(record);
    process.stdout.write(`${canonical({ state: process.exitCode === 0 ? "selected" : "ended", candidate: final?.candidate ?? null, step: final?.step ?? null, totals: record.totals })}\n`);
  } catch (error) { process.stderr.write(`${canonical({ state: "incomplete", error: failureCode(error, "loop_failed") })}\n`); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
