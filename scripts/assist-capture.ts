/**
 * Backlog item 10's capture mode (10.c; BL-20261117-1130-lane-decisions-second-repair-before-reprobe, decision 5): the T1 and T2 assist
 * packets, and T2's retry, built from a finished zero-fee local run as item 10's wrapper would build them, written as request bodies
 * into a new directory of that run, which git must ignore. Nothing is dispatched: no cloud destination, key, broker request or fee is
 * involved, and the model the builders read is bound to a broker that refuses every request. The coordinating session scans the
 * bodies before the first paid assisted run (decision 6 of that entry: credential and query shapes, the owner's account name and
 * home-path shapes).
 *
 *   pnpm assist:capture -- --run-directory RUN --task-directory TASK --job-sha256 H --brief-sha256 H --firing forced_split|local_first
 *     --cloud-model M --cloud-endpoint URL --cloud-prices IN,OUT,CACHED[,WRITE] [--cloud-long-context ...]
 *
 * (or `node --import tsx scripts/assist-capture.ts` with the same flags). The run is the reading stage of a local run of the same task
 * (`--pipeline research --arm local`), read through the seed loader, so a run another run seeded, one with an assist, one on another
 * task, or one whose packet no longer matches its ledger is refused. The endpoint is one the assist arm admits (assistArmEndpoint), and
 * the model is the assist arm's: the cloud arm's configuration under the heavy profile, which `--pipeline research` requires, in the
 * assist cache mode. The wrapper's own configuration checks run first (createResearchAssists), at the assist arm's largest fee cap.
 *
 * What the bodies show: each is the body the wrapper hands its broker for the request the pipeline would make from this run's own
 * index, plan, evidence and coverage. T1 carries the brief's units and the index's gists; T2 and its retry carry the plan, the
 * evidence and counts-only coverage. An assisted run of the task sends these bodies only where its own index, plan, evidence and
 * coverage are this run's, and only for the touchpoints it fires: each touchpoint's `trigger` says whether this run would fire it
 * (always under forced_split, though T2 not after a T1 outcome that ended the stage; under local_first only where every local attempt
 * of that stage failed, else null). The retry is sent only after a truncated first T2 reply. The capture binds the assist protocol it
 * built under (researchAssistProtocolSha256) in its manifest.
 *
 * A T2 built after item (ii)'s second repair (BL-20261117-1143-research-second-repair-design), the packet the scan most needs to see,
 * comes from a source run read under a serving card whose admission basis is `serving_card` (SOAR_SERVING_CARD_FILE and
 * SOAR_SERVING_CARD_SHA256 on the local run): only then does a chunk its one repair left unfinished get a second. The manifest's
 * `sourceRun` records that basis and the run's second-repair counts, so a capture shows whether its T2 followed a second repair.
 */
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrivateAgentBroker } from "../src/main/private-agent/broker";
import { canonical, digest, exactText } from "../src/main/private-agent/contracts";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../src/main/private-agent/dispatch-purposes";
import { ASSIST_CACHE_MODE, PrivateAgentModel, type PrivateModelConfig } from "../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { ASSIST_BOUNDS, ASSIST_OUTPUT_TOKENS, PLAN_ASSIST_SYSTEM, SYNTHESIS_ASSIST_SYSTEM, buildPlanAssistPacket, buildSynthesisAssistPacket, createResearchAssists,
  researchAssistProtocolSha256 } from "../src/main/private-agent/research-assist";
import type { ResearchAssistFiring, ResearchAssistPacketRecord, ResearchAssistPlanRequest, ResearchAssistSynthesisRequest } from "../src/main/private-agent/research-assist-contract";
import { RESEARCH_FILES } from "../src/main/private-agent/research-contract";
import { researchSourceText } from "../src/main/private-agent/research-coverage";
import { assertRunDirectoryIgnored } from "../src/main/private-agent/research-diagnostics";
import { RESEARCH_SPLIT_MAX_FEE_USD } from "../src/main/private-agent/research-pipeline";
import type { ResearchPlanAttempt } from "../src/main/private-agent/research-plan";
import { loadResearchSeed } from "../src/main/private-agent/research-seed";
import { loadPreparedOperatorTask } from "./private-agent-run";
import { assistArmEndpoint, cloudArmModelConfig, parseCloudLongContext, parseCloudPrices, type CloudArmInput } from "./private-agent-local-screen";

/** The capture's directory inside the run, created once; a run that holds one already is refused rather than written to again. */
export const ASSIST_CAPTURE_DIRECTORY = "assist-capture";
export const ASSIST_CAPTURE_VERSION = 1;
export interface AssistCaptureInput {
  runDirectory: string; taskDirectory: string; expectedJobSha256: string; expectedBriefSha256: string; firing: ResearchAssistFiring;
  cloud: Pick<CloudArmInput, "model" | "endpoint" | "prices" | "longContext">;
}
/** Whether this run's assisted twin would fire the touchpoint, in the stage record's words; null where it would not. */
export type AssistCaptureTrigger = "forced_split" | "local_plans_rejected" | "local_syntheses_refused" | null;
/** One touchpoint's capture: the body written, or the fixed code that refused or stopped it before any request; counts only. */
export interface AssistCaptureTouchpoint {
  touchpoint: "T1" | "T2"; retryAfterTruncation: boolean; trigger: AssistCaptureTrigger; built: boolean; code?: string; file?: string; bodySha256?: string;
  bodyBytes?: number; packet?: ResearchAssistPacketRecord;
}
export interface AssistCaptureManifest {
  version: typeof ASSIST_CAPTURE_VERSION; firing: ResearchAssistFiring; assistProtocolSha256: string; api: string; model: string;
  sourceRun: { jobId: string; freezeSha256: string; protocolSha256: string; admission: "serving_card" | null; secondRepairCalls: number; secondRepairsComplete: number };
  authoredBriefSha256: string; touchpoints: AssistCaptureTouchpoint[];
}
/** A broker that refuses every request: the builders read the model's configuration and request shape only, and nothing may be sent. */
const NO_DISPATCH = { request: () => { throw new Error("assist_capture_never_dispatches"); }, requestTimeoutMs: () => 600_000, zeroRiskDispatch: () => false } as unknown as PrivateAgentBroker;
type StageRow = { stage: string; fallback?: string; planAttempts?: ResearchPlanAttempt[]; secondRepairCalls?: number; secondRepairsComplete?: number };

/** Builds and writes the capture; returns its manifest. Refusals throw a fixed `assist_capture_*` code, or the loaders' and the wrapper's own. */
export function captureAssistPackets(input: AssistCaptureInput): AssistCaptureManifest {
  if (input.firing !== "forced_split" && input.firing !== "local_first") throw new Error("assist_capture_firing_invalid");
  // The assist arm's endpoints only, as the driver admits them: a body in any other shape would never be sent.
  if (!assistArmEndpoint(input.cloud.endpoint)) throw new Error("assist_capture_endpoint_invalid");
  const runDirectory = realpathSync(resolve(input.runDirectory)), directory = join(runDirectory, ASSIST_CAPTURE_DIRECTORY);
  // Written once: a capture already there, or anything else at its path, is refused before the run is read.
  if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined) throw new Error("assist_capture_exists");
  // Git asks the repository that holds the run, never the one the command runs in, so an outer repository that ignores a whole
  // worktree cannot vouch for a run inside it; a run outside any repository is refused.
  assertRunDirectoryIgnored(runDirectory, runDirectory);
  const binding = { jobSha256: input.expectedJobSha256, briefSha256: input.expectedBriefSha256 };
  const task = loadPreparedOperatorTask(input.taskDirectory, binding);
  const { pipeline, files } = loadResearchSeed(runDirectory, binding);
  const freezeBytes = readFileSync(join(runDirectory, "freeze.json")), freeze = JSON.parse(freezeBytes.toString("utf8")) as { jobId?: unknown; arm?: { arm?: unknown } };
  // A zero-fee local run only: its reading stage had no assist, its planner was local, and its freeze names the local arm.
  if (pipeline.assist !== undefined || pipeline.planner !== "local" || freeze.arm?.arm !== "local") throw new Error("assist_capture_source_not_local");
  const read = (path: string) => JSON.parse(files.find(file => file.path === path)!.bytes.toString("utf8"));
  const coverage = read(RESEARCH_FILES.coverage), index = read(RESEARCH_FILES.index), plan = read(RESEARCH_FILES.plan), evidence = read(RESEARCH_FILES.evidence), summary = read(RESEARCH_FILES.summary);
  // The composed brief the stage read is its units' text; the authored brief is the task's own brief.md, which the composed one begins with.
  const composed = (coverage.units as { text: string }[]).map(unit => unit.text).join("");
  const authored = exactText(new TextDecoder("utf-8", { fatal: true }).decode(task.phase.files.find(file => file.path === "brief.md")!.bytes));
  if (digest(Buffer.from(composed)) !== coverage.briefSha256 || !composed.startsWith(authored)) throw new Error("assist_capture_brief_mismatch");
  // The sources, in the inventory's order, with the bytes the task holds; each must be the one the run read.
  const inventory = (coverage.sources as { id: string; path: string; sha256: string; bytes: number; readable: boolean }[]).map(({ readable: _readable, ...source }) => source);
  const sources = inventory.map(identity => {
    const file = task.phase.files.find(candidate => candidate.path === identity.path);
    if (!file || digest(file.bytes) !== identity.sha256 || file.bytes.length !== identity.bytes) throw new Error("assist_capture_source_mismatch");
    return { id: identity.id, path: identity.path, bytes: Buffer.from(file.bytes) };
  });
  const sourceTexts = sources.map((source, i) => (coverage.sources[i] as { readable: boolean }).readable ? researchSourceText(source) : undefined);
  const stage = (name: "plan" | "extract" | "synthesise") => (summary.stages as StageRow[]).find(row => row.stage === name);
  // The pipeline's order (research-pipeline.ts): under forced_split each assist comes before the stage's own attempts; under local_first
  // it comes only after every local attempt failed, which this run shows as the host plan or the host skeleton.
  const forced = input.firing === "forced_split";
  const triggers = { T1: forced ? "forced_split" : stage("plan")?.fallback === "host_plan" ? "local_plans_rejected" : null,
    T2: forced ? "forced_split" : stage("synthesise")?.fallback === "skeleton" ? "local_syntheses_refused" : null } as const;
  const base = { brief: composed, units: coverage.units, sources: inventory, sourceTexts, sourceIndex: index, deadlineMs: Number.POSITIVE_INFINITY };
  // T1's prior attempts are the stage's attempts so far: none under forced_split; under local_first the rejected ones, every attempt
  // when T1 fires (a run whose plan was accepted would not fire T1, so its body is the request T1 would get had that attempt failed too).
  const planRequest: ResearchAssistPlanRequest = { ...base, mandatorySourceChunks: coverage.chunks.length, extractionCallBudget: summary.budget.extractionCalls,
    priorAttempts: forced ? [] : (stage("plan")?.planAttempts ?? []).filter(attempt => !attempt.accepted) };
  // T2 gets the plan stage's attempts for its scrubber's known digests, as the pipeline passes them (10.b's second review).
  const synthesisRequest = (retryAfterTruncation: boolean): ResearchAssistSynthesisRequest => ({ ...base, plan, evidence, coverage, retryAfterTruncation,
    planAttempts: stage("plan")?.planAttempts ?? [] });
  // The assist model the driver's assist arm would use: the cloud arm's configuration under the heavy profile, in the assist cache mode.
  const { modelConfig } = cloudArmModelConfig(input.cloud, COORDINATOR_PROFILES.heavy);
  const config: PrivateModelConfig = { ...modelConfig, promptCaching: ASSIST_CACHE_MODE };
  const model = new PrivateAgentModel(NO_DISPATCH, config, "assist-capture", "reader");
  // The wrapper's own checks (the authored brief, the cache mode, thinking, the output and body caps), at the assist arm's largest fee cap:
  // a configuration the wrapper refuses yields no capture, only its code (research_assist_config_invalid).
  createResearchAssists({ firing: input.firing, model, authoredBrief: authored, maxFeeMicrousd: Math.round(RESEARCH_SPLIT_MAX_FEE_USD * 1_000_000) });
  const t1 = buildPlanAssistPacket(planRequest, { firing: input.firing, authoredBrief: authored, model });
  const t2 = buildSynthesisAssistPacket(synthesisRequest(false), { authoredBrief: authored, model });
  // The retry's evidence is trimmed as the wrapper trims it: at most half the first packet's, and never over 32 KiB.
  const retryBound = t2.ok ? Math.min(ASSIST_BOUNDS.retryEvidenceBytes, Math.floor((t2.packet.evidenceBytes ?? 0) / 2)) : 0;
  const t2Retry = t2.ok ? buildSynthesisAssistPacket(synthesisRequest(true), { authoredBrief: authored, model, evidenceBound: retryBound }) : undefined;
  // Non-recursive, after every refusal: the guard against a capture that appeared since the check above.
  mkdirSync(directory, { mode: 0o700 });
  const touchpoints: AssistCaptureTouchpoint[] = [];
  const write = (touchpoint: "T1" | "T2", retry: boolean, built: ReturnType<typeof buildPlanAssistPacket> | undefined, file: string, system: string, purpose: string, cap: number) => {
    if (built === undefined) return;
    const trigger = triggers[touchpoint];
    if (!built.ok) { touchpoints.push({ touchpoint, retryAfterTruncation: retry, trigger, built: false, code: built.code, ...(built.packet ? { packet: built.packet } : {}) }); return; }
    // The body item 10's wrapper would hand the broker, byte for byte (research-assist.ts builds its size from the same call).
    const body = model.requestBody([{ role: "system", content: system }, { role: "user", content: built.user }], [], { maxOutputTokens: cap, purpose }).body;
    writeFileSync(join(directory, file), body, { flag: "wx", mode: 0o600 });
    touchpoints.push({ touchpoint, retryAfterTruncation: retry, trigger, built: true, file, bodySha256: digest(Buffer.from(body)), bodyBytes: Buffer.byteLength(body), packet: built.packet });
  };
  write("T1", false, t1, "T1.body.json", PLAN_ASSIST_SYSTEM, PLAN_ASSIST_PURPOSE, ASSIST_OUTPUT_TOKENS.plan);
  write("T2", false, t2, "T2.body.json", SYNTHESIS_ASSIST_SYSTEM, SYNTHESIS_ASSIST_PURPOSE, ASSIST_OUTPUT_TOKENS.synthesis);
  write("T2", true, t2Retry, "T2-retry.body.json", SYNTHESIS_ASSIST_SYSTEM, SYNTHESIS_ASSIST_PURPOSE, ASSIST_OUTPUT_TOKENS.synthesis);
  const manifest: AssistCaptureManifest = { version: ASSIST_CAPTURE_VERSION, firing: input.firing, assistProtocolSha256: researchAssistProtocolSha256(input.firing),
    api: String(config.api ?? "chat_completions"), model: config.model,
    sourceRun: { jobId: String(freeze.jobId), freezeSha256: digest(freezeBytes), protocolSha256: pipeline.protocolSha256, admission: pipeline.admission?.basis ?? null,
      secondRepairCalls: stage("extract")?.secondRepairCalls ?? 0, secondRepairsComplete: stage("extract")?.secondRepairsComplete ?? 0 },
    authoredBriefSha256: digest(Buffer.from(authored)), touchpoints };
  writeFileSync(join(directory, "capture.json"), `${canonical(manifest)}\n`, { flag: "wx", mode: 0o600 });
  return manifest;
}

/** The flags, by name; one leading `--`, which `pnpm assist:capture -- ...` passes on (as for scripts/experiment-launcher.ts), is dropped. */
export function parseAssistCaptureArguments(input: readonly string[]): AssistCaptureInput {
  const args = input[0] === "--" ? input.slice(1) : input;
  const names = ["--run-directory", "--task-directory", "--job-sha256", "--brief-sha256", "--firing", "--cloud-model", "--cloud-endpoint", "--cloud-prices", "--cloud-long-context"];
  if (args.length % 2 !== 0 || args.some((arg, i) => i % 2 === 0 && !names.includes(arg)) || new Set(args.filter((_, i) => i % 2 === 0)).size !== args.length / 2) throw new Error("assist_capture_cli_invalid");
  const values = new Map(args.filter((_, i) => i % 2 === 0).map(name => [name, args[args.indexOf(name) + 1]!]));
  if (names.slice(0, 8).some(name => !values.get(name)) || !["forced_split", "local_first"].includes(values.get("--firing")!) ||
      ![values.get("--job-sha256")!, values.get("--brief-sha256")!].every(hash => /^[a-f0-9]{64}$/u.test(hash))) throw new Error("assist_capture_cli_invalid");
  return { runDirectory: values.get("--run-directory")!, taskDirectory: values.get("--task-directory")!, expectedJobSha256: values.get("--job-sha256")!,
    expectedBriefSha256: values.get("--brief-sha256")!, firing: values.get("--firing") as ResearchAssistFiring,
    cloud: { model: values.get("--cloud-model")!, endpoint: values.get("--cloud-endpoint")!, prices: parseCloudPrices(values.get("--cloud-prices")!),
      ...(values.has("--cloud-long-context") ? { longContext: parseCloudLongContext(values.get("--cloud-long-context")!) } : {}) } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const manifest = captureAssistPackets(parseAssistCaptureArguments(process.argv.slice(2)));
    // Counts, digests and fixed codes only: the bodies stay in the run's ignored directory.
    process.stdout.write(`${canonical({ state: "captured", directory: ASSIST_CAPTURE_DIRECTORY, touchpoints: manifest.touchpoints.map(t => ({ touchpoint: t.touchpoint,
      retryAfterTruncation: t.retryAfterTruncation, trigger: t.trigger, built: t.built, ...(t.code ? { code: t.code } : {}), ...(t.bodySha256 ? { bodySha256: t.bodySha256 } : {}) })) })}\n`);
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : "assist_capture_failed";
    process.stderr.write(`${canonical({ state: "refused", error: code })}\n`); process.exitCode = 1;
  }
}
