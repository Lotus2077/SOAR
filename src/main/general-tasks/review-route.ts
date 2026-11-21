import type { SoarConfig } from "../config";
import type { GeneralTaskAvailability } from "../../shared/general-task-contracts";

/**
 * Backlog item 13b: the desktop's staged document review. It is review-1, the single sample the headless driver applies
 * (`withDocumentReview` in private-agent/document-review.ts), opted into per task while its beta flag is on, on the heavy profile and
 * the owner's own local model only: no cloud, no consultation, no URLs and no research.
 *
 * The owner allowed this route on real private documents and waived PLAN.md's Tier O safeguards for it alone. So a review task carries
 * no public-or-synthetic declaration, and its one destination admits private data. Nothing here promises privacy: the endpoint may be
 * plain HTTP to a machine whose logging and egress SOAR does not verify, and the app's text never claims otherwise.
 */
export const DESKTOP_REVIEW_ROUTE = "local_beta" as const;
export type DesktopReviewRoute = typeof DESKTOP_REVIEW_ROUTE;
/** What a review task records that it ran under: the owner's waiver of the Tier O transport, which its receipt and registry row carry too. */
export const DESKTOP_REVIEW_TRANSPORT = "owner_waived" as const;
/** What a review task records at creation (record version 5): the route and the transport waiver, nothing else. */
export interface DesktopReviewRecord { route: DesktopReviewRoute; transport: typeof DESKTOP_REVIEW_TRANSPORT }
/** The review's own deliverable, the summary E6 graded: a review task's output name is fixed to it. */
export const DESKTOP_REVIEW_OUTPUT_NAME = "review-summary.md";
/** The receipt's arm, the name E6's rows give this route. */
export const DESKTOP_REVIEW_ARM = "local-heavy-review1";

export function isDesktopReviewRecord(value: unknown): value is DesktopReviewRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "route,transport" && record.route === DESKTOP_REVIEW_ROUTE && record.transport === DESKTOP_REVIEW_TRANSPORT;
}

/** The review's input rule, checked before anything is saved: exactly one .docx among the task's input files (as `withDocumentReview` requires). */
export function reviewInputsCheck(files: readonly { path: string }[]): "fit" | "review_input_invalid" {
  return files.filter(file => /\.docx$/iu.test(file.path)).length === 1 ? "fit" : "review_input_invalid";
}

/**
 * The review beta as the form offers it: present only while the flag is on. It needs no serving card. Its words say where the document
 * goes and over what, and that it runs by the owner's waiver; they promise no privacy protection.
 */
export function desktopReviewAvailability(config: Pick<SoarConfig, "documentReviewBeta"> & { vllm: Pick<SoarConfig["vllm"], "baseUrl"> }): GeneralTaskAvailability["review"] {
  if (config.documentReviewBeta !== true) return undefined;
  const transport = new URL(config.vllm.baseUrl).protocol === "https:" ? "HTTPS" : "plain HTTP";
  return { available: true, reason: `Document review (beta) sends one .docx, in full, to your own model endpoint over ${transport}, and to nothing else: no cloud and no consultation. It runs by your waiver of PLAN.md's Tier O safeguards for this review, so SOAR gives it no privacy protection and does not check the endpoint's logging or the machine it runs on.` };
}
