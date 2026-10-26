import Database from "better-sqlite3";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PrivateCheckpointStore, type WorkspaceSnapshot } from "./checkpoints";
import { canonical, digest, sha256Schema } from "./contracts";
import { RESEARCH_PIPELINE_BUDGET, RESEARCH_PIPELINE_VERSION, researchProtocolSha256 } from "./research-pipeline";
import { sessionFileManifest, type SessionFile } from "./session";

/**
 * H4: a second sample and a repair run write from the evidence packet a first sample's reading stage produced, instead
 * of reading the corpus again (the driver's --research-from). The seed is loaded from the source run's own ledger and
 * content-addressed checkpoints, verified against the transfer's manifest and fingerprint, and refused unless the source
 * ran the same task under the same frozen pipeline protocol as the current code (the H5 freeze rule applied to a seed).
 */
const manifestSchema = z.array(z.object({ path: z.string().min(1).max(240), sha256: sha256Schema }).strict()).min(1).max(64);
export const ResearchSeedSchema = z.object({
  version: z.literal(1),
  sourceJobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
  sourceFreezeSha256: sha256Schema,
  snapshotSha256: sha256Schema,
  files: manifestSchema,
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

/** Loads the transfer a source run's stage produced; refuses another task, another protocol, a run without a transfer, or bytes that no longer match. */
export function loadResearchSeed(runDirectory: string, expected: { jobSha256: string; briefSha256: string }): { seed: ResearchSeed; pipeline: PipelineFreeze; files: SessionFile[] } {
  const root = realpathSync(runDirectory);
  const freezeBytes = insideFile(join(root, "freeze.json"), root);
  const freeze = JSON.parse(freezeBytes.toString("utf8")) as { jobId?: unknown; taskBinding?: { jobSha256?: unknown; briefSha256?: unknown }; pipeline?: unknown; researchFrom?: unknown; deployment?: unknown };
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
  let events: Record<string, unknown>[];
  try { events = (database.prepare("SELECT value FROM private_agent_events WHERE job_id = ? ORDER BY sequence").all(jobId) as { value: string }[]).map(row => JSON.parse(row.value)); }
  finally { database.close(); }
  const transfer = events.find(event => event.type === "research_transfer");
  if (!transfer) throw new Error("research_seed_no_transfer");
  const binding = transfer.binding as { snapshot: WorkspaceSnapshot; snapshotSha256: string; files: { path: string; sha256: string }[] };
  // The store would create its directory; a source run without its checkpoints is refused instead of being written to.
  const checkpointDirectory = join(root, "checkpoints", jobId);
  if (!existsSync(checkpointDirectory) || !lstatSync(insidePath(checkpointDirectory, root)).isDirectory()) throw new Error("research_seed_checkpoints_missing");
  const checkpoints = new PrivateCheckpointStore(join(root, "checkpoints"), jobId);
  const files = checkpoints.load(binding.snapshot);
  const manifest = manifestSchema.parse(sessionFileManifest(files));
  if (checkpoints.fingerprint(binding.snapshot) !== binding.snapshotSha256 || canonical(manifest) !== canonical(binding.files)) throw new Error("research_seed_transfer_drift");
  const seed = ResearchSeedSchema.parse({ version: 1, sourceJobId: jobId, sourceFreezeSha256: digest(freezeBytes), snapshotSha256: binding.snapshotSha256, files: manifest });
  return { seed, pipeline, files };
}

/** The snapshot fingerprint of the research transfer a run's own stage produced (the packet the loop seeds from), or null when the run has none; nothing is loaded. */
export function researchTransferSnapshot(runDirectory: string): string | null {
  const root = realpathSync(runDirectory);
  const freeze = JSON.parse(insideFile(join(root, "freeze.json"), root).toString("utf8")) as { jobId?: unknown; researchFrom?: unknown; pipeline?: unknown };
  if (typeof freeze.jobId !== "string" || freeze.researchFrom !== undefined || !PipelineFreezeSchema.safeParse(freeze.pipeline).success) return null;
  const database = new Database(insidePath(join(root, "state.sqlite"), root), { readonly: true, fileMustExist: true });
  try {
    const transfer = (database.prepare("SELECT value FROM private_agent_events WHERE job_id = ? ORDER BY sequence").all(freeze.jobId) as { value: string }[])
      .map(row => JSON.parse(row.value) as { type?: unknown; binding?: { snapshotSha256?: unknown } }).find(event => event.type === "research_transfer");
    return typeof transfer?.binding?.snapshotSha256 === "string" && sha256Schema.safeParse(transfer.binding.snapshotSha256).success ? transfer.binding.snapshotSha256 : null;
  } finally { database.close(); }
}
/** Whether a run's ledger holds a research transfer the loop can seed from (the stage completed). */
export function researchTransferPresent(runDirectory: string): boolean { return researchTransferSnapshot(runDirectory) !== null; }

/** A seeded run's freeze carries the source's pipeline block and names the seed, so rows keep the pipeline columns and the lineage is one hop. */
export function seededPipelineFreeze(pipeline: PipelineFreeze, seed: ResearchSeed): PipelineFreeze & { seededFrom: string } {
  return { ...pipeline, seededFrom: seed.sourceJobId };
}
