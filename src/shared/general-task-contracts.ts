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
  publicOrSynthetic: z.literal(true),
  /** Coordinator profile for this task; absent means the configured default. Bound into the task identity. */
  profile: z.enum(["standard", "heavy"]).optional(),
}).strict();
export type GeneralTaskCreateInput = z.infer<typeof GeneralTaskCreateInputSchema>;

export const GeneralTaskArtifactRefSchema = z.object({
  id: GeneralTaskIdSchema,
  path: z.string().min(1).max(240).refine(value => value.startsWith("output/") &&
    !/[\\\x00-\x1f\x7f]/u.test(value) && value.split("/").every(part => part && part !== "." && part !== "..")),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type GeneralTaskArtifactRef = z.infer<typeof GeneralTaskArtifactRefSchema>;
export const GeneralTaskBundleRefSchema = z.object({
  id: GeneralTaskIdSchema, manifestSha256: Sha256Schema,
}).strict();
export type GeneralTaskBundleRef = z.infer<typeof GeneralTaskBundleRefSchema>;
export interface GeneralTaskBundle { manifestSha256: string; fileCount: number; totalBytes: number }

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
  independentAcceptance: "not_evaluated";
  /** `detail` is a one-line, untrusted description of the agent's action derived from its own tool call. */
  events: { sequence: number; type: string; summary: string; detail?: string }[];
  canResume: boolean;
  routing?: GeneralTaskRouting;
  consultation?: GeneralTaskConsultationSummary;
  fees?: { reservedMicrousd: number; settledMicrousd: number };
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
  update: "soar:general-task-update",
} as const;
