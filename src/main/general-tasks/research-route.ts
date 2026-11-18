import type { SoarConfig } from "../config";
import type { GeneralTaskAvailability, GeneralTaskResearch } from "../../shared/general-task-contracts";
import { loadServingCard, servingCardExpectation, servingCardRefusal, type LoadedServingCard } from "../private-agent/serving-card";
import { inventoryResearchSources, ResearchCoverageSchema } from "../private-agent/research-coverage";
import type { WorkspaceSnapshot } from "../private-agent/checkpoints";
import { planResearchIndexBatches, researchMandatoryWorkFits, researchRepairReserve } from "../private-agent/research-admission";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET } from "../private-agent/research-contract";
import { researchSynthesisBelowFloor, type ResearchModels } from "../private-agent/research-pipeline";
import { nonDefaultRoleParameters } from "../private-agent/research-roles";
import { researchStageUnfinished, type GeneralSessionOptions } from "../private-agent/session";
import { LOCAL_TOKEN_ADMISSION_CODES } from "../private-agent/flash-next-admission";

/**
 * Backlog item 13a, requirement B: the write phase of a research task, one named setting. "profile" keeps the heavy profile's own
 * write phase (its model calls, tool calls and elapsed time); "twelve-call" is E2's 12-call writer bound, as the headless driver's
 * `--write-bound twelve-call` sets it. E2's result changes this one line. The session keeps the profile's request pool and elapsed
 * limit either way, as in the driver.
 */
export const DESKTOP_RESEARCH_WRITE_BOUND: DesktopResearchWriteBound = "profile";
export const DESKTOP_RESEARCH_WRITE_BOUNDS = Object.freeze({
  profile: undefined,
  "twelve-call": Object.freeze({ maxModelCalls: 12, maxToolCalls: 12, maxElapsedMs: 1_200_000 }),
});
export type DesktopResearchWriteBound = keyof typeof DESKTOP_RESEARCH_WRITE_BOUNDS;
/** The write phase's three limits under `bound`, or the profile's own. */
export function researchWriteLimits(bound: DesktopResearchWriteBound, profile: { modelCalls: number; toolCalls: number; elapsedMs: number }): { modelCalls: number; toolCalls: number; elapsedMs: number } {
  const named = DESKTOP_RESEARCH_WRITE_BOUNDS[bound];
  return named ? { modelCalls: named.maxModelCalls, toolCalls: named.maxToolCalls, elapsedMs: named.maxElapsedMs } : { modelCalls: profile.modelCalls, toolCalls: profile.toolCalls, elapsedMs: profile.elapsedMs };
}

/**
 * The session options a research task adds, as the headless driver builds them from a card (localScreenResearchOption,
 * localScreenCardResearch, localScreenStreams): the three local models, the card's role policy, its admission rates under a
 * `serving_card` basis, and its K. Never a diagnostics sink, a budget override or an assist.
 */
export function desktopResearchSession(card: LoadedServingCard, models: (contextId: string) => ResearchModels): Pick<GeneralSessionOptions, "research" | "localStreams"> {
  const { roles, admission, localStreams } = card.policy;
  return { research: { models, roles, ...(admission.basis === "serving_card" ? { admission: admission.rates } : {}) }, localStreams };
}

const STAGES = ["index", "plan", "extract", "synthesise"] as const;
/** The stage counts the view shows when a stage recorded them: chunks, repairs and the packet's trim (research-pipeline.ts, ResearchStageCounts). */
const STAGE_COUNTS = ["chunksPlanned", "chunksComplete", "repairCalls", "secondRepairCalls", "secondRepairsComplete", "quotesVerified", "quotesInPacket",
  "quotesLeftByCap", "quotesLeftByPresentation", "questionsTrimmed", "conflictsNoted", "conflictsInPacket", "heldChunks", "heldKeptUnrepaired", "declaredGaps"] as const;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
/** The reader context the stage runs in, from its `research_input`, and that context's stage rows, oldest first. */
function stageRows(events: readonly Record<string, unknown>[]): { reader?: string; rows: Record<string, unknown>[] } {
  const input = events.find(event => event.type === "research_input"), reader = typeof input?.contextId === "string" ? input.contextId : undefined;
  return { ...(reader === undefined ? {} : { reader }), rows: reader === undefined ? [] : events.filter(event => event.type === "research_stage" && event.contextId === reader) };
}
/**
 * What the snapshot shows of a research task's stage, read from the stage's own events only: whether it started, transferred its
 * packet to the writer or stopped before; each stage's calls, cut replies, host fallback and whether it stopped there; the
 * extraction's chunks; and the stage's model requests, which the writer's model-call count leaves out. A count the row does not hold
 * is left out, never shown as zero. A running task that has recorded its research input is in the stage from that moment: the session
 * records the input just before the pipeline starts, and a pause or quit from then on ends the task, even before the first request
 * has a row.
 */
export function researchStageView(record: DesktopResearchRecord, events: readonly Record<string, unknown>[], dispatches: readonly { contextId: string }[], active: boolean,
  transferGaps?: ResearchTransferGaps): GeneralTaskResearch {
  const { reader, rows } = stageRows(events);
  const transferred = events.some(event => event.type === "research_transfer");
  const started = transferred || researchStageUnfinished(events, dispatches) || rows.length > 0 || events.some(event => event.type === "research_admission" && event.contextId === reader);
  const stages: GeneralTaskResearch["stages"] = [];
  for (const stage of STAGES) {
    const row = [...rows].reverse().find(event => event.stage === stage), calls = count(row?.calls);
    if (!row || calls === undefined) continue;
    const truncated = count(row.truncatedReplies), counts: Partial<Record<(typeof STAGE_COUNTS)[number], number>> = {};
    for (const key of STAGE_COUNTS) { const value = count(row[key]); if (value !== undefined) counts[key] = value; }
    stages.push({ stage, calls, ...(truncated ? { truncatedReplies: truncated } : {}), ...(typeof row.denied === "string" ? { denied: true as const } : {}),
      ...(row.fallback === "host_plan" || row.fallback === "skeleton" ? { fallback: row.fallback } : {}), ...counts });
  }
  // A transferred packet's gap is its own coverage.json's disclosure; when that file cannot be read, the extraction row's count keeps a
  // declared gap from reading as a plain ready packet.
  const declared = stages.find(row => row.stage === "extract")?.declaredGaps, first = transferGaps?.[0];
  const gap = !transferred ? undefined : first ? { chunks: transferGaps!.length, source: first.sourceId, questions: first.questionIds.length }
    : transferGaps === undefined && declared ? { chunks: declared } : undefined;
  return { route: record.route, card: { date: record.cardDate, sha256: record.cardSha256 },
    stage: transferred ? "transferred" : active && reader !== undefined ? "running" : started ? "stopped" : "not_started", stages,
    requests: reader === undefined ? 0 : dispatches.filter(row => row.contextId === reader).length, ...(gap ? { gap } : {}) };
}

/** The gaps a transferred packet discloses: every entry, none ([]), or undefined when nothing was transferred or its coverage.json cannot be read. */
export type ResearchTransferGaps = readonly { sourceId: string; questionIds: readonly string[] }[];
/**
 * Reads the transferred packet's coverage.json from the task's checkpoint store (`load` checks its size and digest) and returns its `gaps`,
 * the disclosure the writer is told to state. It never throws: a missing, damaged or unparsable file is undefined.
 */
export function researchTransferGaps(events: readonly Record<string, unknown>[], load: (snapshot: WorkspaceSnapshot) => { bytes: Buffer }[]): ResearchTransferGaps | undefined {
  const snapshot = (events.find(event => event.type === "research_transfer")?.binding as { snapshot?: unknown } | undefined)?.snapshot;
  const entry = Array.isArray(snapshot) ? snapshot.find(item => (item as { path?: unknown } | null)?.path === RESEARCH_FILES.coverage) : undefined;
  if (entry === undefined) return undefined;
  try {
    const gaps = ResearchCoverageSchema.shape.gaps.safeParse((JSON.parse(load([entry] as WorkspaceSnapshot)[0]!.bytes.toString("utf8")) as { gaps?: unknown }).gaps);
    return gaps.success ? gaps.data ?? [] : undefined;
  } catch { return undefined; }
}

/**
 * Why a stage that ended `research_request_denied` stopped, from the `denied` code of its last row: the pipeline gives that reason to
 * every stopped call but a cancel, so it covers a request that was sent and failed as well as one refused before it was sent.
 * Shown only when no request is uncertain, since an uncertain row's own text comes first.
 */
export function researchDenialReason(events: readonly Record<string, unknown>[]): string {
  const code = [...stageRows(events).rows].reverse().map(row => row.denied).find(value => typeof value === "string") as string | undefined;
  const cause = code === undefined ? undefined : Object.hasOwn(RESEARCH_DENIALS, code) ? RESEARCH_DENIALS[code]
    : (LOCAL_TOKEN_ADMISSION_CODES as readonly string[]).includes(code) ? "The research stage's next request could not pass its context and deployment checks and was not sent." : undefined;
  return `${cause ?? `The research stage stopped at a request that was refused or failed${code !== undefined && /^[a-z0-9_]{1,80}$/u.test(code) ? ` (${code})` : ""}.`} Nothing was handed to the writer. Nothing is uncertain, and this task cannot resume.`;
}
const RESEARCH_DENIALS: Record<string, string> = {
  request_failed: "A research stage request to the local model failed after the permitted attempts and returned no usable reply.",
  budget_denied: "The research stage's next request was not sent: the task's request allowance or its fee cap was reached.",
  deadline_before_request: "The time left was shorter than one research request's limit, so the research stage sent nothing more.",
  request_body_size_exceeded: "The research stage's next request exceeded the request size limit and was not sent.",
  packet_size_exceeded: "The research stage's next request exceeded the request size limit and was not sent.",
  packet_scan_failed: "The scanner that checks an outbound request was unavailable, so the research stage's next request was not sent.",
};

/**
 * Backlog item 13a: the desktop's one research route. It is the local research pipeline, opted into per task while the beta flag is
 * on, and it runs only on an adopted serving card that the reader accepts. There is no cloud dispatch, no assist and no research on
 * the pipeline's default limits.
 */
export const DESKTOP_RESEARCH_ROUTE = "local_beta" as const;
export type DesktopResearchRoute = typeof DESKTOP_RESEARCH_ROUTE;
/** What a research task records at creation: the route and the card it was created on. A later card ends any resume of the task. */
export interface DesktopResearchRecord { route: DesktopResearchRoute; cardSha256: string; cardDate: string }

export function isDesktopResearchRecord(value: unknown): value is DesktopResearchRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "cardDate,cardSha256,route" && record.route === DESKTOP_RESEARCH_ROUTE &&
    typeof record.cardSha256 === "string" && /^[a-f0-9]{64}$/u.test(record.cardSha256) &&
    typeof record.cardDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(record.cardDate);
}

export type DesktopResearchCard = { accepted: true; card: LoadedServingCard } | { accepted: false; code: string };

/**
 * The desktop's only read of the configured card pair: the driver's pinned reader and expectation, always with cache salt on. Research
 * tasks run salted, as the card's P10 request settings require; plain tasks keep their own setting. This never throws, and it reports a
 * refusal by its code only, never the path or the card's text. A card whose synthesis ceiling is under the floor is refused here too.
 */
export function readDesktopResearchCard(config: Pick<SoarConfig, "vllm" | "streamingEnabled">): DesktopResearchCard {
  const descriptor = config.vllm.servingCard;
  if (!descriptor) return { accepted: false, code: "serving_card_unconfigured" };
  let card: LoadedServingCard;
  try { card = loadServingCard(descriptor, servingCardExpectation(config, true)); }
  catch (error) { return { accepted: false, code: servingCardRefusal(error)?.code ?? "serving_card_unreadable" }; }
  // As the headless driver refuses before a run: a card whose synthesis attempts cannot hold the 100-word floor would end every task at start.
  const roles = card.policy.roles;
  if (nonDefaultRoleParameters(roles).length && researchSynthesisBelowFloor(roles.synthesis)) return { accepted: false, code: "research_role_policy_invalid" };
  return { accepted: true, card };
}

export type ResearchInputsCheck = "fit" | "research_inputs_required" | "research_input_invalid" | "research_source_unreadable" | "research_mandatory_budget_exceeded";
/**
 * The stage's refusals that are knowable before start, decided with the pipeline's own functions on the task's input files. Every
 * source must be readable text, because the stage requires full coverage, and all mandatory work must fit the pipeline's budget: under a
 * card whose admission basis is `serving_card`, with the repair reserve the stage keeps (researchCardAdmission). The card's clock
 * admission stays the stage's own decision at start.
 */
export function researchInputsCheck(files: readonly { path: string; bytes: Buffer }[], cardAdmission: boolean): ResearchInputsCheck {
  const sources = files.filter(file => file.path.startsWith("input/")).map(file => ({ id: file.path, path: file.path, bytes: file.bytes }));
  if (!sources.length) return "research_inputs_required";
  let inventory: ReturnType<typeof inventoryResearchSources>;
  try { inventory = inventoryResearchSources(sources); } catch { return "research_input_invalid"; }
  if (inventory.sources.some(source => !source.readable)) return "research_source_unreadable";
  const ordered = inventory.sources.map(source => sources.find(item => item.id === source.id)!);
  const chunks = inventory.chunks.length, reserve = cardAdmission ? researchRepairReserve(chunks) : 0;
  return researchMandatoryWorkFits({ batches: planResearchIndexBatches(ordered).length, chunks: chunks + reserve }, RESEARCH_PIPELINE_BUDGET)
    ? "fit" : "research_mandatory_budget_exceeded";
}

/** The beta for the new-task form. It is undefined while the flag is off, so the form shows nothing new; otherwise it says why the beta is or is not offered. */
export function desktopResearchAvailability(config: Pick<SoarConfig, "localResearchBeta" | "vllm" | "streamingEnabled">): GeneralTaskAvailability["research"] {
  if (config.localResearchBeta !== true) return undefined;
  const read = readDesktopResearchCard(config);
  if (read.accepted) return { available: true, reason: "Local research (beta) reads your text files with the adopted serving card, on the local model only.",
    card: { date: read.card.date, sha256: read.card.sha256 } };
  return { available: false, code: read.code, reason: read.code === "serving_card_unconfigured"
    ? "Local research (beta) is off: no serving card is configured." : `Local research (beta) is off: the serving card was refused (${read.code}).` };
}
