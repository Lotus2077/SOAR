import Database from "better-sqlite3";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PrivateCheckpointStore, type WorkspaceSnapshot } from "./checkpoints";
import { canonical, digest, sha256Schema } from "./contracts";
import { RESEARCH_PIPELINE_BUDGET, RESEARCH_PIPELINE_VERSION, researchProtocolSha256 } from "./research-pipeline";
import { RESEARCH_FILES } from "./research-contract";
import { validateReadyResearchPacket } from "./research-coverage";
import { ResearchInputSchema, ResearchProducerSchema, validateResearchProducer } from "./research-producer";
import type { SessionFile } from "./session";

/**
 * H4: a second sample and a repair run write from the evidence packet a first sample's reading stage produced, instead
 * of reading the corpus again (the driver's --research-from). The seed is loaded from the source run's own ledger and
 * content-addressed checkpoints, verified against the transfer's manifest and fingerprint, and refused unless the source
 * ran the same task under the same frozen pipeline protocol as the current code (the H5 freeze rule applied to a seed).
 */
const manifestSchema = z.array(z.object({ path: z.string().min(1).max(240), sha256: sha256Schema }).strict()).length(7)
  .refine(files => canonical(files.map(file => file.path).sort()) === canonical(Object.values(RESEARCH_FILES).sort()), "exact v5 packet required");
export const ResearchSeedSchema = z.object({
  version: z.literal(2),
  sourceJobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
  sourceFreezeSha256: sha256Schema,
  snapshotSha256: sha256Schema,
  files: manifestSchema,
  producer: ResearchProducerSchema,
}).strict();
export type ResearchSeed = z.infer<typeof ResearchSeedSchema>;
/** The source run's pipeline block, carried into the seeded run's freeze so a registry row still names the pipeline and its planner. */
export const PipelineFreezeSchema = z.object({ name: z.literal("research"), version: z.number().int().positive(), protocolSha256: sha256Schema,
  budget: z.object({ indexCalls: z.number().int().positive(), extractionCalls: z.number().int().positive(), plannerCalls: z.number().int().positive(), synthesisCalls: z.number().int().positive() }).strict(),
  planner: z.enum(["cloud", "local"]), writer: z.literal("local") }).strict();
export type PipelineFreeze = z.infer<typeof PipelineFreezeSchema>;

function insidePath(path: string, base: string): string {
  if (lstatSync(path).isSymbolicLink() || !realpathSync(path).startsWith(base + "/")) throw new Error("research_seed_directory_invalid");
  return path;
}
function insideFile(path: string, base: string): Buffer { return readFileSync(insidePath(path, base)); }
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function need(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
type Binding = { snapshot: WorkspaceSnapshot; snapshotSha256: string; files: { path: string; sha256: string }[]; summary: unknown; producer?: unknown };

function readFreeze(root: string) {
  const bytes = insideFile(join(root, "freeze.json"), root);
  const value = JSON.parse(bytes.toString("utf8")) as { jobId?: unknown; taskBinding?: { jobSha256?: unknown; briefSha256?: unknown };
    pipeline?: unknown; researchFrom?: unknown; deployment?: unknown; researchProducerKind?: unknown; researchInput?: unknown; startedAt?: unknown };
  return { bytes, value };
}

/** Loads the transfer a source run's stage produced; refuses another task, another protocol, a run without a transfer, or bytes that no longer match. */
export function loadResearchSeed(runDirectory: string, expected: { jobSha256: string; briefSha256: string }): { seed: ResearchSeed; pipeline: PipelineFreeze; files: SessionFile[] } {
  const root = realpathSync(runDirectory);
  const { bytes: freezeBytes, value: freeze } = readFreeze(root);
  sha256Schema.parse(expected.jobSha256); sha256Schema.parse(expected.briefSha256);
  if (freeze.taskBinding?.jobSha256 !== expected.jobSha256 || freeze.taskBinding?.briefSha256 !== expected.briefSha256) throw new Error("research_seed_task_mismatch");
  if (freeze.deployment !== "synthetic_only_unverified_for_private_data") throw new Error("research_seed_not_synthetic");
  // A seed comes from a run that ran the stage itself, never from another seeded run: the lineage stays one hop deep and names the stage's own job.
  if (freeze.researchFrom !== undefined) throw new Error("research_seed_source_seeded");
  const parsedPipeline = PipelineFreezeSchema.safeParse(freeze.pipeline);
  if (!parsedPipeline.success) throw new Error("research_seed_no_pipeline");
  const pipeline = parsedPipeline.data;
  if (pipeline.version !== RESEARCH_PIPELINE_VERSION || pipeline.protocolSha256 !== researchProtocolSha256(pipeline.budget) || canonical(pipeline.budget) !== canonical(RESEARCH_PIPELINE_BUDGET)) throw new Error("research_seed_protocol_mismatch");
  const jobId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u).parse(freeze.jobId);
  const database = new Database(insidePath(join(root, "state.sqlite"), root), { readonly: true, fileMustExist: true });
  let events: Record<string, unknown>[], receipts: unknown[];
  try {
    database.exec("BEGIN");
    events = (database.prepare("SELECT value FROM private_agent_events WHERE job_id = ? ORDER BY sequence").all(jobId) as { value: string }[]).map(row => JSON.parse(row.value));
    receipts = (database.prepare("SELECT value FROM private_agent_dispatches WHERE job_id = ? ORDER BY rowid").all(jobId) as { value: string }[]).map(row => JSON.parse(row.value));
  } finally { if (database.inTransaction) database.exec("ROLLBACK"); database.close(); }
  let binding: Binding, rawProducer: unknown, input: z.infer<typeof ResearchInputSchema>, inputRecordedAt: number;
  if (freeze.researchProducerKind === "controlled_pipeline") {
    need(!events.some(event => event.type === "session_started" || event.type === "research_transfer"), "research_seed_controlled_session_forgery");
    input = ResearchInputSchema.parse(freeze.researchInput);
    need(typeof freeze.startedAt === "string", "research_seed_input_time_invalid");
    inputRecordedAt = Date.parse(freeze.startedAt);
    const record = JSON.parse(insideFile(join(root, "research-producer.json"), root).toString("utf8")) as { version?: unknown; kind?: unknown; producer?: unknown; binding?: Binding };
    need(record.version === 2 && record.kind === "controlled_pipeline" && record.binding, "research_seed_controlled_producer_invalid");
    binding = record.binding; rawProducer = record.producer;
  } else {
    need(freeze.researchProducerKind === undefined || freeze.researchProducerKind === "session", "research_seed_producer_kind_invalid");
    const transfers = events.filter(event => event.type === "research_transfer");
    need(transfers.length === 1, transfers.length ? "research_seed_duplicate_transfer" : "research_seed_no_transfer");
    const transfer = transfers[0]!;
    binding = transfer.binding as Binding; rawProducer = binding?.producer;
    const producer = ResearchProducerSchema.parse(rawProducer);
    const starts = events.filter(event => event.type === "session_started"), inputs = events.filter(event => event.type === "research_input");
    need(starts.length === 1 && starts[0]!.readerContextId === producer.contextId && transfer.contextId === producer.contextId,
      "research_seed_session_identity");
    need(inputs.length === 1 && inputs[0]!.contextId === producer.contextId, "research_seed_input_missing");
    const inputEvent = inputs[0]!, firstStage = events.findIndex(event => event.type === "research_stage");
    inputRecordedAt = z.number().int().nonnegative().safe().parse(inputEvent.recordedAt);
    need(events.indexOf(starts[0]!) < events.indexOf(inputEvent) && firstStage > events.indexOf(inputEvent) &&
      events.indexOf(transfer) > firstStage, "research_seed_input_order");
    input = ResearchInputSchema.parse(inputEvent.input);
    if (freeze.researchInput !== undefined) need(same(input, ResearchInputSchema.parse(freeze.researchInput)), "research_seed_frozen_input_drift");
    const stages = events.filter(event => event.type === "research_stage");
    need(stages.every(event => event.contextId === producer.contextId && events.indexOf(event) < events.indexOf(transfer)), "research_seed_stage_order");
    need(same(stages.map(event => ({ stage: event.stage, calls: event.calls })),
      (binding.summary as { stages?: { stage: string; calls: number }[] })?.stages?.map(stage => ({ stage: stage.stage, calls: stage.calls }))), "research_seed_stage_summary_drift");
  }
  need(binding && Array.isArray(binding.snapshot), "research_seed_transfer_invalid");
  // The store would create its directory; a source run without its checkpoints is refused instead of being written to.
  const checkpointDirectory = join(root, "checkpoints", jobId);
  if (!existsSync(checkpointDirectory) || !lstatSync(insidePath(checkpointDirectory, root)).isDirectory()) throw new Error("research_seed_checkpoints_missing");
  const checkpoints = new PrivateCheckpointStore(join(root, "checkpoints"), jobId);
  const files = checkpoints.load(binding.snapshot);
  const manifest = manifestSchema.parse(files.map(file => ({ path: file.path, sha256: digest(file.bytes) })));
  if (checkpoints.fingerprint(binding.snapshot) !== binding.snapshotSha256 || canonical(manifest) !== canonical(binding.files)) throw new Error("research_seed_transfer_drift");
  const packet = validateReadyResearchPacket(files, { sourceManifest: input.sourceManifest,
    protocolSha256: pipeline.protocolSha256, budget: pipeline.budget });
  need(same(packet.summary, binding.summary), "research_seed_summary_drift");
  const producer = validateResearchProducer(rawProducer, { jobId, files, receipts, input });
  need(Number.isSafeInteger(inputRecordedAt) && inputRecordedAt >= 0 && receipts.filter(row =>
    typeof row === "object" && row !== null && (row as { contextId?: unknown }).contextId === producer.contextId)
    .every(row => Number.isSafeInteger((row as { committedAt?: unknown }).committedAt) &&
      ((row as { committedAt: number }).committedAt >= inputRecordedAt)), "research_seed_input_after_dispatch");
  need(producer.kind === (freeze.researchProducerKind === "controlled_pipeline" ? "controlled_pipeline" : "session") &&
    producer.protocolSha256 === pipeline.protocolSha256 && same(producer.budget, pipeline.budget), "research_seed_producer_binding");
  const seed = ResearchSeedSchema.parse({ version: 2, sourceJobId: jobId, sourceFreezeSha256: digest(freezeBytes), snapshotSha256: binding.snapshotSha256, files: manifest, producer });
  return { seed, pipeline, files };
}

/**
 * The transfer's fingerprint, or null beside the loader's snake_case refusal code (backlog item 4, finding B6): a complete
 * v5 seed, input, packet and actual receipts must validate read-only. An exception that is not a code (a Zod or SQLite
 * message, a missing directory) maps to `research_seed_load_failed`; a symlinked or escaping run directory still throws.
 */
export function researchTransferStatus(runDirectory: string): { snapshotSha256: string | null; code: string | null } {
  try {
    const { value: freeze } = readFreeze(realpathSync(runDirectory));
    const expected = z.object({ jobSha256: sha256Schema, briefSha256: sha256Schema }).parse(freeze.taskBinding);
    return { snapshotSha256: loadResearchSeed(runDirectory, expected).seed.snapshotSha256, code: null };
  } catch (error) {
    if (error instanceof Error && error.message === "research_seed_directory_invalid") throw error;
    return { snapshotSha256: null, code: error instanceof Error && /^[a-z0-9_]{1,80}$/u.test(error.message) ? error.message : "research_seed_load_failed" };
  }
}
/** A fingerprint is offered only when the complete v5 seed, input, packet and actual receipts validate read-only. */
export function researchTransferSnapshot(runDirectory: string): string | null { return researchTransferStatus(runDirectory).snapshotSha256; }
/** Whether a run's ledger holds a research transfer the loop can seed from (the stage completed). */
export function researchTransferPresent(runDirectory: string): boolean { return researchTransferSnapshot(runDirectory) !== null; }

/** A seeded run's freeze carries the source's pipeline block and names the seed, so rows keep the pipeline columns and the lineage is one hop. */
export function seededPipelineFreeze(pipeline: PipelineFreeze, seed: ResearchSeed): PipelineFreeze & { seededFrom: string } {
  return { ...pipeline, seededFrom: seed.sourceJobId };
}
