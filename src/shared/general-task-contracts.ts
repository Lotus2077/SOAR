import { z } from "zod";

export const GeneralTaskIdSchema = z.string().uuid();
export const GeneralTaskRoutingSchema = z.enum(["local_only", "ask_before_consulting"]);
export type GeneralTaskRouting = z.infer<typeof GeneralTaskRoutingSchema>;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const GeneralTaskConsultationRefSchema = z.object({
  id: GeneralTaskIdSchema, proposalId: z.string().uuid(), proposalSha256: Sha256Schema,
}).strict();
export type GeneralTaskConsultationRef = z.infer<typeof GeneralTaskConsultationRefSchema>;
export const GeneralTaskConsultationDecisionSchema = GeneralTaskConsultationRefSchema.extend({
  decision: z.enum(["approve", "decline", "revoke"]),
}).strict();
export type GeneralTaskConsultationDecision = z.infer<typeof GeneralTaskConsultationDecisionSchema>;
export interface GeneralTaskConsultationSummary {
  proposalId: string; proposalSha256: string;
  state: "pending" | "approved" | "declined" | "revoked" | "dispatching" | "settled" | "uncertain";
  model: string; maxFeeMicrousd: number; feeMicrousd?: number;
}
export interface GeneralTaskConsultationPreview extends GeneralTaskConsultationSummary {
  packet: string; packetSha256: string; contextSha256: string; checkpointSha256: string; profileSha256: string;
  destination: { id: string; endpoint: string; accountId: string; credentialVersion: number };
  prices: { inputMicrousdPerMillion: number; outputMicrousdPerMillion: number; cachedInputMicrousdPerMillion?: number };
  maxOutputTokens: number; selectedPaths: string[]; omittedPaths: string[]; expiresAt: number;
}
const PublicSourceUrlSchema = z.string().trim().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return !/[\\#\x00-\x20\x7f]/u.test(value) && url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch { return false; }
}, "Use an exact public HTTPS URL without credentials or a fragment.").transform(value => new URL(value).href);
export const GeneralTaskPublicSourcesSchema = z.object({
  urls: z.array(PublicSourceUrlSchema).min(1).max(3).refine(urls => new Set(urls).size === urls.length),
  allowPublicRetrieval: z.literal(true),
  dnsResolver: z.enum(["system", "cloudflare_v1"]),
}).strict();
export type GeneralTaskPublicSources = z.infer<typeof GeneralTaskPublicSourcesSchema>;
export const GeneralTaskCreateInputSchema = z.object({
  goal: z.string().trim().min(1).max(16_000).refine(value => new TextEncoder().encode(value).length <= 32_768),
  inputSelectionId: z.string().uuid().optional(),
  routing: GeneralTaskRoutingSchema.optional(),
  publicSources: GeneralTaskPublicSourcesSchema.optional(),
  outputName: z.string().trim().min(1).max(120)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u)
    .refine(value => !value.includes("..") && new TextEncoder().encode(value).length <= 200),
  /**
   * The owner's declaration that the goal and every input are public or synthetic. Every task carries it except a document review
   * (backlog item 13b), which the owner allowed on real private documents and which therefore never carries it.
   */
  publicOrSynthetic: z.literal(true).optional(),
  /** Coordinator profile for this task; absent means the configured default. Bound into the task identity. */
  profile: z.enum(["standard", "heavy"]).optional(),
  /** Backlog item 13a: run the local research pipeline before the writer (beta). Offered only while the flag is on and the serving card is accepted. */
  research: z.literal("local_beta").optional(),
  /** Backlog item 13b: review one .docx with the staged document review (beta). Offered only while its flag is on. */
  review: z.literal("local_beta").optional(),
}).strict().superRefine((value, context) => {
  if (value.review === undefined ? value.publicOrSynthetic !== true : value.publicOrSynthetic !== undefined)
    context.addIssue({ code: "custom", path: ["publicOrSynthetic"], message: "A document review carries no public-or-synthetic declaration; every other task does." });
  if (value.review !== undefined && value.research !== undefined) context.addIssue({ code: "custom", path: ["review"], message: "A task is a review or a research task, not both." });
});
export type GeneralTaskCreateInput = z.infer<typeof GeneralTaskCreateInputSchema>;

/**
 * Backlog item 13b: a document review's edit plan, one of its six deliverables, lives outside output/ (private-agent/document-review.ts,
 * DOCUMENT_REVIEW_EDITS_PATH). It is the one path outside output/ an artifact may have, and only a review task lists it.
 */
export const GENERAL_TASK_REVIEW_EDITS_PATH = "review/edits.json";
export const GeneralTaskArtifactRefSchema = z.object({
  id: GeneralTaskIdSchema,
  path: z.string().min(1).max(240).refine(value => (value.startsWith("output/") || value === GENERAL_TASK_REVIEW_EDITS_PATH) &&
    !/[\\\x00-\x1f\x7f]/u.test(value) && value.split("/").every(part => part && part !== "." && part !== "..")),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GeneralTaskArtifactRef = z.infer<typeof GeneralTaskArtifactRefSchema>;
export const GeneralTaskBundleRefSchema = z.object({
  id: GeneralTaskIdSchema, manifestSha256: Sha256Schema,
}).strict();
export type GeneralTaskBundleRef = z.infer<typeof GeneralTaskBundleRefSchema>;
export interface GeneralTaskBundle { manifestSha256: string; fileCount: number; totalBytes: number }
/** The owner's verdict on a submitted task (review item 2, S12): a decision and the owner's effort, never free text. */
export const GeneralTaskVerdictInputSchema = z.object({
  id: GeneralTaskIdSchema,
  decision: z.enum(["accept", "reject"]),
  /** Minutes the owner spent reviewing and editing the deliverable. */
  ownerMinutes: z.number().finite().min(0).max(600),
  /** Manual interventions the job needed (PLAN.md section 1 counts an edit pass as one). */
  interventions: z.number().int().min(0).max(99),
  /** The owner's declaration that the deliverable left through the app's export (an OAJ condition). */
  exportedThroughApp: z.boolean(),
}).strict();
export type GeneralTaskVerdictInput = z.infer<typeof GeneralTaskVerdictInputSchema>;
/** The persisted and projected verdict: the input without the task id, plus the host's record time. */
export const GeneralTaskVerdictSchema = GeneralTaskVerdictInputSchema.omit({ id: true }).extend({ recordedAt: z.number().int().positive() }).strict();
export type GeneralTaskVerdict = z.infer<typeof GeneralTaskVerdictSchema>;

export interface GeneralTaskInputFile { name: string; path: string; bytes: number; sha256: string }
export interface GeneralTaskInputSelection { id: string; files: GeneralTaskInputFile[] }
export interface GeneralTaskArtifact { path: string; bytes: number; sha256: string }
export interface GeneralTaskPublicSource { dispatchId: string; url: string; sha256: string; bytes: number; retrievedAt: number }
export type GeneralTaskStatus = "queued" | "running" | "paused" | "submitted" | "incomplete" | "cancelled";
export interface GeneralTaskAvailability {
  available: boolean;
  reason: string;
  limits: { modelCalls: number; toolCalls: number; elapsedMs: number };
  /** Coordinator profile in effect for new tasks. */
  profile?: "standard" | "heavy";
  /** Profiles a task may select at creation. */
  profiles?: ("standard" | "heavy")[];
  /** Legacy tracks (investigator, change review, coding pilot, hybrid simulation) are shown only when the Labs flag is on. */
  labs?: boolean;
  publicOrSyntheticOnly: true;
  executionMode: "local" | "scripted" | "unavailable";
  consultation?: { available: boolean; reason: string; model?: string };
  /** Backlog item 13a: absent while the beta flag is off; otherwise whether the local research route is offered, with the reader's code or the card's date and sha256. */
  research?: { available: boolean; reason: string; code?: string; card?: { date: string; sha256: string } };
  /** Backlog item 13b: present only while the document review beta's flag is on. */
  review?: { available: boolean; reason: string };
}
export type GeneralTaskEntailmentVerdict = "supported" | "partial" | "unsupported" | "contradicted" | "not_judged";
export interface GeneralTaskEntailment {
  counts: Record<GeneralTaskEntailmentVerdict, number>;
  entailmentCalls: number;
  truncated: boolean;
  claims: { id: string; verdict: GeneralTaskEntailmentVerdict; reason?: string }[];
}
export interface GeneralTaskSnapshot {
  id: string;
  goal: string;
  outputName: string;
  status: GeneralTaskStatus;
  reason: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  inputs: GeneralTaskInputFile[];
  network?: { urls: string[]; dnsResolver: "system" | "cloudflare_v1"; maxFetches: number; maxResponseBytes: number };
  sources?: GeneralTaskPublicSource[];
  publicFetches?: number;
  artifacts: GeneralTaskArtifact[];
  bundle?: GeneralTaskBundle;
  bundleUnavailableReason?: string;
  modelCalls: number;
  toolCalls: number;
  elapsedMs: number;
  checks: { id: string; passed: boolean }[];
  /** Research tasks: the host's per-claim entailment verdicts (local model, thinking off). Evidence, not acceptance. */
  entailment?: GeneralTaskEntailment;
  /** Profile the task was created under. */
  profile?: "standard" | "heavy";
  /** Model-authored text, projected by the host, bounded and untrusted: the latest plan and the finish summary. */
  plan?: string;
  finishSummary?: string;
  /** Host-derived facts that qualify a submission: a failed finish before the final one, or judged claims that were not supported. */
  reportedIssues?: string[];
  cleanupConfirmed: boolean;
  /** A cancelled task can retry cleanup of its original context without resuming work. */
  canRetryCleanup?: boolean;
  /** Includes cancellation still waiting for its active session to stop. */
  cleanupInProgress?: boolean;
  independentAcceptance: "not_evaluated";
  /** The owner's recorded verdict on a submitted task; absent until recorded. It is the OAJ mark, not independent acceptance. */
  verdict?: GeneralTaskVerdict;
  /** `detail` is a one-line, untrusted description of the agent's action derived from its own tool call. */
  events: { sequence: number; type: string; summary: string; detail?: string }[];
  canResume: boolean;
  routing?: GeneralTaskRouting;
  consultation?: GeneralTaskConsultationSummary;
  fees?: { reservedMicrousd: number; settledMicrousd: number };
  /** Backlog item 13a: a local research task's route, the card it runs on and what its stage did. Absent on every other task. */
  research?: GeneralTaskResearch;
  /** Backlog item 13b: present on a document review task (record version 5), with the owner's transport waiver it ran under. */
  review?: { route: "local_beta"; transport: "owner_waived" };
}
/**
 * Backlog item 13a: a local research task's stage, from the stage's own events. `stage` is not_started (no stage work yet), running,
 * transferred (its packet reached the writer) or stopped (it ended before the transfer, and it cannot resume). Each row is one stage's
 * latest counts: its calls, the replies cut at the output limit, a host fallback when no attempt was accepted (the host's plan, or the
 * synthesis skeleton), and the extraction's chunks. `requests` are the stage's model requests, outside the writer's model calls.
 */
export interface GeneralTaskResearch {
  route: "local_beta";
  card: { date: string; sha256: string };
  stage: "not_started" | "running" | "transferred" | "stopped";
  stages: GeneralTaskResearchStage[];
  requests: number;
  /**
   * A packet the stage handed over ready with a disclosed gap (the owner's answer of 2026-11-18, #166): the passages whose last reply still
   * declared questions unresolved after every repair. It is read from the transferred coverage.json's `gaps`, the disclosure the writer is
   * told to state as an unresolved limitation: the source of the first and the number of questions it names. When that file cannot be read,
   * the extraction row's `declaredGaps` count stands in, without a source.
   */
  gap?: { chunks: number; source?: string; questions?: number };
}
/**
 * One stage's latest recorded counts, only those the stage recorded. The extraction row also carries its repairs (and, under a card's
 * admission rates, its second repairs) and how its evidence packet was trimmed: verified quotes, those kept, those left out at the
 * packet's size cap or by the presentation guard, the plan questions left without a quote in the packet, and conflict notes.
 */
export interface GeneralTaskResearchStage {
  stage: "index" | "plan" | "extract" | "synthesise"; calls: number; truncatedReplies?: number; fallback?: "host_plan" | "skeleton";
  /**
   * The stage stopped in this row at a refused, failed or cancelled call (its `denied` code). Such a row's calls and repairs are what
   * settled; its passage count is the value the row was created with, so the view shows calls, never passages, for it.
   */
  denied?: true;
  chunksPlanned?: number; chunksComplete?: number; repairCalls?: number; secondRepairCalls?: number; secondRepairsComplete?: number;
  quotesVerified?: number; quotesInPacket?: number; quotesLeftByCap?: number; quotesLeftByPresentation?: number; questionsTrimmed?: number;
  conflictsNoted?: number; conflictsInPacket?: number;
  /**
   * Under a card's admission rates only: the passages whose complete first reply was held for an optional repair, and those of them left
   * without it, which keep that first reply.
   */
  heldChunks?: number; heldKeptUnrepaired?: number;
  /** The passages left unresolved after every repair and disclosed as the packet's gap (at most 1). */
  declaredGaps?: number;
}
export interface GeneralTaskArtifactPreview extends GeneralTaskArtifactRef {
  bytes: number;
  kind: "text" | "binary";
  text: string | null;
  truncated: boolean;
}
export interface SoarGeneralTaskApi {
  getGeneralTaskAvailability(): Promise<GeneralTaskAvailability>;
  chooseGeneralTaskInputs(): Promise<GeneralTaskInputSelection | null>;
  createGeneralTask(input: GeneralTaskCreateInput): Promise<GeneralTaskSnapshot>;
  listGeneralTasks(): Promise<GeneralTaskSnapshot[]>;
  getGeneralTask(id: string): Promise<GeneralTaskSnapshot>;
  startGeneralTask(id: string): Promise<GeneralTaskSnapshot>;
  pauseGeneralTask(id: string): Promise<GeneralTaskSnapshot>;
  resumeGeneralTask(id: string): Promise<GeneralTaskSnapshot>;
  cancelGeneralTask(id: string): Promise<GeneralTaskSnapshot>;
  previewGeneralTaskConsultation(input: GeneralTaskConsultationRef): Promise<GeneralTaskConsultationPreview>;
  decideGeneralTaskConsultation(input: GeneralTaskConsultationDecision): Promise<GeneralTaskSnapshot>;
  readGeneralTaskArtifact(input: GeneralTaskArtifactRef): Promise<GeneralTaskArtifactPreview>;
  exportGeneralTaskArtifact(input: GeneralTaskArtifactRef): Promise<{ exported: boolean; filePath?: string }>;
  exportGeneralTaskBundle(input: GeneralTaskBundleRef): Promise<{ exported: boolean; filePath?: string }>;
  recordGeneralTaskVerdict(input: GeneralTaskVerdictInput): Promise<GeneralTaskSnapshot>;
  /** Saves the hashes-and-counts verdict receipt that scripts/registry-row.py --verdict-file rows. */
  exportGeneralTaskVerdictReceipt(id: string): Promise<{ exported: boolean; filePath?: string }>;
  subscribeGeneralTasks(listener: (snapshot: GeneralTaskSnapshot) => void): () => void;
}
export const GENERAL_TASK_IPC_CHANNELS = {
  availability: "soar:general-task-availability",
  chooseInputs: "soar:general-task-choose-inputs",
  create: "soar:general-task-create",
  list: "soar:general-task-list",
  get: "soar:general-task-get",
  start: "soar:general-task-start",
  pause: "soar:general-task-pause",
  resume: "soar:general-task-resume",
  cancel: "soar:general-task-cancel",
  previewConsultation: "soar:general-task-preview-consultation",
  decideConsultation: "soar:general-task-decide-consultation",
  readArtifact: "soar:general-task-read-artifact",
  exportArtifact: "soar:general-task-export-artifact",
  exportBundle: "soar:general-task-export-bundle",
  recordVerdict: "soar:general-task-record-verdict",
  exportVerdictReceipt: "soar:general-task-export-verdict-receipt",
  update: "soar:general-task-update",
} as const;
