import type { SoarConfig } from "../config";
import type { GeneralTaskAvailability } from "../../shared/general-task-contracts";
import { loadServingCard, servingCardExpectation, servingCardRefusal, type LoadedServingCard } from "../private-agent/serving-card";
import { inventoryResearchSources } from "../private-agent/research-coverage";
import { planResearchIndexBatches, researchMandatoryWorkFits } from "../private-agent/research-admission";
import { RESEARCH_PIPELINE_BUDGET } from "../private-agent/research-contract";

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
 * refusal by its code only, never the path or the card's text.
 */
export function readDesktopResearchCard(config: Pick<SoarConfig, "vllm" | "streamingEnabled">): DesktopResearchCard {
  const descriptor = config.vllm.servingCard;
  if (!descriptor) return { accepted: false, code: "serving_card_unconfigured" };
  try { return { accepted: true, card: loadServingCard(descriptor, servingCardExpectation(config, true)) }; }
  catch (error) { return { accepted: false, code: servingCardRefusal(error)?.code ?? "serving_card_unreadable" }; }
}

export type ResearchInputsCheck = "fit" | "research_inputs_required" | "research_input_invalid" | "research_source_unreadable" | "research_mandatory_budget_exceeded";
/**
 * The stage's refusals that are knowable before start, decided with the pipeline's own functions on the task's input files. Every
 * source must be readable text, because the stage requires full coverage, and all mandatory work must fit the pipeline's budget. The
 * card's clock admission stays the stage's own decision at start.
 */
export function researchInputsCheck(files: readonly { path: string; bytes: Buffer }[]): ResearchInputsCheck {
  const sources = files.filter(file => file.path.startsWith("input/")).map(file => ({ id: file.path, path: file.path, bytes: file.bytes }));
  if (!sources.length) return "research_inputs_required";
  let inventory: ReturnType<typeof inventoryResearchSources>;
  try { inventory = inventoryResearchSources(sources); } catch { return "research_input_invalid"; }
  if (inventory.sources.some(source => !source.readable)) return "research_source_unreadable";
  const ordered = inventory.sources.map(source => sources.find(item => item.id === source.id)!);
  return researchMandatoryWorkFits({ batches: planResearchIndexBatches(ordered).length, chunks: inventory.chunks.length }, RESEARCH_PIPELINE_BUDGET)
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
