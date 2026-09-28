import { createHash } from "node:crypto";
import { lstat, readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { SoarDatabase } from "../database";
import { providerLimits, type PatchRuntimeConfig } from "./config";
import { canonicalRequest } from "./worker";
import { patchCampaignExposure } from "./comparison-schema";
import { inspectPatchWorkspace, materializePatchWorkspace } from "./workspace";
import type { PatchRunController } from "./controller";
import { PatchRunStore } from "./store";
import { isPatchRunTerminal, type PatchRunSnapshot } from "../../shared/patch-run-contracts";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u);
const integer = z.number().int().nonnegative().safe();
const absolute = z.string().max(4096).refine(path.isAbsolute, "Absolute path required.");
export const ARMS = ["C", "D", "H"] as const;
export type ComparisonArm = typeof ARMS[number];
const artifact = z.object({ path: absolute, sha256: sha }).strict();
export const EvaluationReceiptSchema = z.object({
  exitCode: z.number().int(), sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u), oracleSha256: sha,
  patchSha256: sha.nullable(), image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  cleanupConfirmed: z.literal(true), testCount: integer.optional(), durationMs: integer.optional(),
  passed: integer.optional(), failures: integer.optional(), errors: integer.optional(), skipped: integer.optional(),
  harnessVerified: z.boolean().optional(), failureKind: z.enum(["candidate", "infrastructure"]).optional(),
}).passthrough().superRefine((receipt, ctx) => {
  if (receipt.exitCode === 0 && (receipt.harnessVerified !== true || !receipt.testCount || receipt.passed !== receipt.testCount ||
      receipt.failures !== 0 || receipt.errors !== 0 || receipt.skipped !== 0 || receipt.failureKind !== undefined || receipt.error !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Successful evaluation requires completed, nonempty acceptance tests." });
  }
});

export function isSuccessfulEvaluation(receipt: unknown): boolean {
  const parsed = EvaluationReceiptSchema.safeParse(receipt);
  return parsed.success && parsed.data.exitCode === 0;
}
export const ComparisonTaskSchema = z.object({
    taskId: id, kind: z.string().min(1).max(100).optional(),
    source: z.object({ url: z.string().url().refine((value) => {
      const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash;
    }), revision: z.string().regex(/^[a-f0-9]{40}$/u), root: absolute, files: integer.max(2000), bytes: integer.max(32 * 1024 * 1024) }).strict(),
    objective: z.string().min(1).max(20000), visibleCommand: z.string().min(1).max(4096),
    oracle: artifact, referencePatch: artifact,
    baselineReceipt: EvaluationReceiptSchema, referenceReceipt: EvaluationReceiptSchema,
}).strict();

/** Shared receipt identity checks; versioned manifests keep their own cohort
 * cardinality and discriminants. This does not execute evaluator material. */
export function validateComparisonManifestReceipts(manifest: { tasks: z.infer<typeof ComparisonTaskSchema>[]; image: string }, ctx: z.RefinementCtx): void {
  for (const task of manifest.tasks) {
    for (const [name, receipt] of [["baseline", task.baselineReceipt], ["reference", task.referenceReceipt]] as const) {
      if (receipt.sourceRevision !== task.source.revision || receipt.oracleSha256 !== task.oracle.sha256 || receipt.image !== manifest.image ||
          receipt.patchSha256 !== (name === "baseline" ? null : task.referencePatch.sha256) ||
          receipt.failureKind === "infrastructure" || receipt.error !== undefined ||
          (name === "baseline" ? receipt.exitCode === 0 : receipt.exitCode !== 0)) {
        ctx.addIssue({ code: "custom", message: `Unvalidated ${name} receipt for ${task.taskId}.` });
      }
    }
  }
}
export const ComparisonManifestSchema = z.object({
  schemaVersion: z.literal(1), screenId: id, seed: z.union([z.string().max(100), integer]).transform(String),
  scope: z.string().max(1000).optional(), evaluatorSha256: sha.optional(),
  frozenAt: z.string().datetime({ offset: true }).optional(), totalReferenceMethods: integer.optional(), baselinePassingCompatibilityMethods: integer.optional(),
  setupLimitations: z.array(z.string().max(2000)).max(20).optional(),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  tasks: z.array(ComparisonTaskSchema).length(12),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.tasks.map((task) => task.taskId)).size !== 12) ctx.addIssue({ code: "custom", message: "Task IDs must be unique." });
  if (new Set(manifest.tasks.map((task) => task.source.url)).size < 3) ctx.addIssue({ code: "custom", message: "Screen requires at least three repositories." });
  validateComparisonManifestReceipts(manifest, ctx);
});
export type ComparisonManifest = z.infer<typeof ComparisonManifestSchema>;
export type ComparisonTask = ComparisonManifest["tasks"][number];
export const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export function balancedBlocks(manifest: Pick<ComparisonManifest, "tasks" | "seed">): Array<{ taskId: string; order: ComparisonArm[] }> {
  let counter = 0;
  const shuffle = <T>(values: T[]): T[] => {
    for (let index = values.length - 1; index > 0; index--) {
      const random = createHash("sha256").update(`${manifest.seed}:${counter++}`).digest().readUInt32BE(0);
      const target = random % (index + 1);
      [values[index], values[target]] = [values[target]!, values[index]!];
    }
    return values;
  };
  const orders: ComparisonArm[][] = [["C", "D", "H"], ["C", "H", "D"], ["D", "C", "H"], ["D", "H", "C"], ["H", "C", "D"], ["H", "D", "C"]];
  const randomized = shuffle([...orders, ...orders].map((order) => [...order]));
  return shuffle(manifest.tasks.map((task) => task.taskId).sort()).map((taskId, index) => ({ taskId, order: randomized[index]! }));
}

async function verifiedFile(file: { path: string; sha256: string }): Promise<void> {
  const stat = await lstat(file.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024 || digest(await readFile(file.path)) !== file.sha256) {
    throw new Error("Frozen evaluation artifact changed.");
  }
}

export async function validateComparisonSources(manifest: Pick<ComparisonManifest, "tasks">): Promise<void> {
  const inspected = new Map<string, { files: number; bytes: number }>();
  for (const task of manifest.tasks) {
    const source = await inspectPatchWorkspace(task.source.root);
    const identity = `${source.root}:${source.revision}`;
    if (!inspected.has(identity)) {
      const temporary = await mkdtemp(path.join(tmpdir(), "soar-screen-source-"));
      try { inspected.set(identity, await materializePatchWorkspace(source.root, source.revision, path.join(temporary, "repository"))); }
      finally { await rm(temporary, { recursive: true, force: true }); }
    }
    const inventory = inspected.get(identity)!;
    if (source.revision !== task.source.revision || inventory.files !== task.source.files || inventory.bytes !== task.source.bytes) {
      throw new Error(`Pinned source changed for ${task.taskId}.`);
    }
    for (const artifact of [task.oracle, task.referencePatch]) {
      const relative = path.relative(source.root, artifact.path);
      if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("Evaluator material must be outside solver source.");
      await verifiedFile(artifact);
    }
  }
}

/** Whitelist only. Raw runtime configuration contains credentials and paths. */
export async function comparisonConfiguration(config: PatchRuntimeConfig, projectRoot: string, manifest: ComparisonManifest) {
  if (config.mode !== "live" || config.cloud?.id !== "openai" || config.cloud.model !== "gpt-5.6-sol" || !config.local ||
      config.episodeCapMicrousd !== 3_000_000 || config.wallTimeSeconds !== 600 || config.stepLimit !== 40 ||
      config.maxOutputTokens !== 8192 || config.maxInputBytes !== 256000 || config.cloud.inputUsdPerMillion !== 4 || config.cloud.outputUsdPerMillion !== 20 ||
      config.local.inputUsdPerMillion !== 0 || config.local.outputUsdPerMillion !== 0 || config.campaignCapMicrousd > 180_000_000) {
    throw new Error("Comparison requires the frozen Sol/local profile and identical $3/600-second/40-step episode limits.");
  }
  const provider = (value: NonNullable<PatchRuntimeConfig["cloud"]>) => ({ id: value.id, protocol: value.protocol, model: value.model,
    destinationSha256: digest(value.endpoint), inputUsdPerMillion: value.inputUsdPerMillion, outputUsdPerMillion: value.outputUsdPerMillion,
    allowInsecureHttp: value.allowInsecureHttp, ...providerLimits(config, value) });
  const files = ["runtime/patch-worker/worker.py", "runtime/patch-worker/runtime-lock.json", "src/main/patch-runs/worker.ts",
    "src/main/patch-runs/controller.ts", "src/main/patch-runs/store.ts", "src/main/patch-runs/config.ts",
    "src/main/patch-runs/comparison.ts", "src/main/patch-runs/comparison-schema.ts", "src/main/patch-runs/comparison-report.ts",
    "src/main/patch-runs/workspace.ts", "src/shared/patch-run-contracts.ts", "src/main/database.ts",
    "scripts/patch-comparison.ts", "scripts/evaluate-patch-screen.py"];
  const codeHashes: Record<string, string> = {};
  for (const file of files) codeHashes[file] = digest(await readFile(path.join(projectRoot, file)));
  if (manifest.evaluatorSha256 && manifest.evaluatorSha256 !== codeHashes["scripts/evaluate-patch-screen.py"]) throw new Error("Manifest evaluator identity changed.");
  return { schemaVersion: 1, mode: config.mode, cloud: provider(config.cloud), local: provider(config.local),
    image: manifest.image, episodeMicrousd: config.episodeCapMicrousd, campaignMicrousd: config.campaignCapMicrousd,
    wallTimeSeconds: config.wallTimeSeconds, stepLimit: config.stepLimit, maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes,
    reasoningEffort: "medium", serviceTier: "default", promptCacheMode: "explicit_no_breakpoints", concurrency: 1,
    localEconomics: { devicePurchaseUsd: 3500, perTokenApiFeeUsd: 0, ownership: "user_owned", electricityAndUtilization: "unavailable" },
    codeHashes };
}

export interface ComparisonEvaluation {
  status: "scored" | "not_scorable" | "error";
  patchSha256: string | null;
  oracleSha256: string;
  receipt?: z.infer<typeof EvaluationReceiptSchema>;
  reason?: string;
}
interface AssignmentRow { screen_id: string; task_id: string; arm: ComparisonArm; run_id: string | null; dispatch_claimed: number; evaluation_json: string | null }
interface BlockRow { screen_id: string; task_id: string; ordinal: number; arm_order: string; reservation_microusd: number; state: "pending" | "reserved" | "completed" }
export class ComparisonStore {
  constructor(readonly database: SoarDatabase) {}
  freeze(manifest: ComparisonManifest, configuration: unknown, ceilingMicrousd = 108_000_000): void {
    ComparisonManifestSchema.parse(manifest);
    if (ceilingMicrousd < 108_000_000 || ceilingMicrousd > 180_000_000) throw new Error("Screen capacity cannot cover all assigned episodes.");
    const manifestSha = digest(canonicalRequest(manifest));
    const configSha = digest(canonicalRequest(configuration));
    this.database.transaction(() => {
      const existing = this.database.prepare("SELECT manifest_sha256,configuration_sha256,ceiling_microusd FROM patch_comparison_screens WHERE id = ?").get(manifest.screenId) as
        { manifest_sha256: string; configuration_sha256: string; ceiling_microusd: number } | undefined;
      if (existing) {
        if (existing.manifest_sha256 !== manifestSha || existing.configuration_sha256 !== configSha || existing.ceiling_microusd !== ceilingMicrousd) throw new Error("Frozen screen manifest/configuration cannot change on resume.");
        return;
      }
      const blocks = balancedBlocks(manifest);
      this.database.prepare("INSERT INTO patch_comparison_screens VALUES(?,?,?,?,?,?,?)")
        .run(manifest.screenId, manifestSha, configSha, JSON.stringify({ manifest, configuration, blocks }), ceilingMicrousd, 3_000_000, new Date().toISOString());
      for (const [ordinal, block] of blocks.entries()) {
        this.database.prepare("INSERT INTO patch_comparison_blocks(screen_id,task_id,ordinal,arm_order,reservation_microusd) VALUES(?,?,?,?,?)")
          .run(manifest.screenId, block.taskId, ordinal, JSON.stringify(block.order), 9_000_000);
        for (const arm of ARMS) this.database.prepare("INSERT INTO patch_comparison_assignments(screen_id,task_id,arm) VALUES(?,?,?)").run(manifest.screenId, block.taskId, arm);
      }
    }).immediate();
  }
  blocks(screenId: string): BlockRow[] {
    return this.database.prepare("SELECT * FROM patch_comparison_blocks WHERE screen_id = ? ORDER BY ordinal").all(screenId) as BlockRow[];
  }
  assignments(screenId: string): AssignmentRow[] {
    return this.database.prepare("SELECT * FROM patch_comparison_assignments WHERE screen_id = ? ORDER BY task_id,arm").all(screenId) as AssignmentRow[];
  }
  runIds(screenId: string): string[] { return this.assignments(screenId).flatMap((row) => row.run_id ? [row.run_id] : []); }
  reserveBlock(screenId: string, taskId: string, globalCeiling: number): void {
    this.database.transaction(() => {
      const block = this.blocks(screenId).find((row) => row.task_id === taskId);
      if (!block) throw new Error("Unknown comparison block.");
      if (block.state !== "pending") return;
      const screen = this.database.prepare("SELECT ceiling_microusd FROM patch_comparison_screens WHERE id = ?").get(screenId) as { ceiling_microusd: number };
      let screenExposure = 0;
      for (const item of this.blocks(screenId)) {
        let actual = 0;
        for (const assignment of this.assignments(screenId).filter((row) => row.task_id === item.task_id)) {
          if (assignment.run_id) { const run = new PatchRunStore(this.database).get(assignment.run_id); actual += run.spentMicrousd + run.reservedMicrousd; }
        }
        screenExposure += item.state === "reserved" ? Math.max(actual, item.reservation_microusd) : actual;
      }
      if (screenExposure + block.reservation_microusd > screen.ceiling_microusd ||
          patchCampaignExposure(this.database).microusd + block.reservation_microusd > globalCeiling) throw new Error("Insufficient campaign capacity for the complete three-arm block.");
      this.database.prepare("UPDATE patch_comparison_blocks SET state = 'reserved' WHERE screen_id = ? AND task_id = ?").run(screenId, taskId);
    }).immediate();
  }
  link(screenId: string, taskId: string, arm: ComparisonArm, runId: string): void {
    const result = this.database.prepare(`UPDATE patch_comparison_assignments SET run_id = ?
      WHERE screen_id = ? AND task_id = ? AND arm = ? AND run_id IS NULL`).run(runId, screenId, taskId, arm);
    if (result.changes !== 1) throw new Error("Comparison assignment already claimed.");
  }
  claimDispatch(screenId: string, taskId: string, arm: ComparisonArm): void {
    const result = this.database.prepare(`UPDATE patch_comparison_assignments SET dispatch_claimed = 1
      WHERE screen_id = ? AND task_id = ? AND arm = ? AND run_id IS NOT NULL AND dispatch_claimed = 0`).run(screenId, taskId, arm);
    if (result.changes !== 1) throw new Error("Comparison dispatch already claimed; no retry is allowed.");
  }
  hasEvaluationClaim(screenId: string, taskId: string, arm: ComparisonArm): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM patch_comparison_evaluation_claims WHERE screen_id = ? AND task_id = ? AND arm = ?").get(screenId, taskId, arm));
  }
  claimEvaluation(screenId: string, taskId: string, arm: ComparisonArm): void {
    const assignment = this.assignments(screenId).find((row) => row.task_id === taskId && row.arm === arm);
    if (!assignment?.run_id || !isPatchRunTerminal(new PatchRunStore(this.database).get(assignment.run_id).status) || assignment.evaluation_json !== null) {
      throw new Error("Evaluation admission requires an unscored terminal assignment.");
    }
    this.database.prepare("INSERT INTO patch_comparison_evaluation_claims(screen_id,task_id,arm,claimed_at) VALUES(?,?,?,?)")
      .run(screenId, taskId, arm, new Date().toISOString());
  }
  evaluated(screenId: string, taskId: string, arm: ComparisonArm, result: ComparisonEvaluation): void {
    const assignment = this.assignments(screenId).find((row) => row.task_id === taskId && row.arm === arm);
    if (!assignment?.run_id || !isPatchRunTerminal(new PatchRunStore(this.database).get(assignment.run_id).status)) throw new Error("Independent scoring requires a terminal run.");
    if (this.database.prepare(`UPDATE patch_comparison_assignments SET evaluation_json = ?
      WHERE screen_id = ? AND task_id = ? AND arm = ? AND evaluation_json IS NULL`).run(JSON.stringify(result), screenId, taskId, arm).changes !== 1) throw new Error("Evaluation is immutable.");
  }
  completeBlock(screenId: string, taskId: string): void {
    this.database.transaction(() => {
      const rows = this.assignments(screenId).filter((row) => row.task_id === taskId);
      if (rows.length !== 3 || rows.some((row) => row.evaluation_json === null)) throw new Error("Block is incomplete.");
      this.database.prepare("UPDATE patch_comparison_blocks SET state = 'completed' WHERE screen_id = ? AND task_id = ? AND state = 'reserved'").run(screenId, taskId);
    }).immediate();
  }
}

export async function runComparisonScreen(options: {
  manifest: ComparisonManifest; configuration: unknown; controller: Pick<PatchRunController, "create" | "start" | "waitForRun" | "cancel">;
  runs: PatchRunStore; screen: ComparisonStore; campaignCeilingMicrousd: number; outputDirectory: string;
  evaluate(task: ComparisonTask, patchPath: string): Promise<unknown>;
  beforeEpisode?(): Promise<void>;
  signal?: AbortSignal; progress?(value: { taskId: string; arm: ComparisonArm; runId: string; status: string }): void;
}): Promise<void> {
  const { manifest, controller, runs, screen } = options;
  screen.freeze(manifest, options.configuration);
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  const policies = { C: "cloud", D: "prepared_cloud", H: "hybrid" } as const;
  for (const block of screen.blocks(manifest.screenId)) {
    if (options.signal?.aborted) return;
    if (block.state === "completed") continue;
    screen.reserveBlock(manifest.screenId, block.task_id, options.campaignCeilingMicrousd);
    const task = manifest.tasks.find((item) => item.taskId === block.task_id)!;
    for (const arm of JSON.parse(block.arm_order) as ComparisonArm[]) {
      if (options.signal?.aborted) return;
      await options.beforeEpisode?.();
      let assignment = screen.assignments(manifest.screenId).find((row) => row.task_id === task.taskId && row.arm === arm)!;
      if (assignment.evaluation_json) {
        if ((JSON.parse(assignment.evaluation_json) as ComparisonEvaluation).status === "error") throw new Error("Frozen evaluator failure requires review; no episode is retried.");
        continue;
      }
      if (screen.hasEvaluationClaim(manifest.screenId, task.taskId, arm)) {
        const previous = assignment.run_id ? runs.get(assignment.run_id) : undefined;
        screen.evaluated(manifest.screenId, task.taskId, arm, { status: "error", patchSha256: previous?.patch?.sha256 ?? null,
          oracleSha256: task.oracle.sha256, reason: "evaluation_interrupted_outcome_unknown" });
        throw new Error("A previous evaluator outcome is unknown; no automatic evaluation retry is allowed.");
      }
      if (!assignment.run_id) {
        const created = await controller.create({ workspaceRoot: task.source.root, objective: task.objective, policy: policies[arm],
          visibleTestCommand: task.visibleCommand, publicSourceAcknowledged: true, episodeBudgetUsd: 3 });
        if (created.baseRevision !== task.source.revision) { controller.cancel(created.id); throw new Error("Source changed before assignment admission."); }
        screen.link(manifest.screenId, task.taskId, arm, created.id);
        runs.recordEvent(created.id, { type: "comparison.assigned", summary: `Screen ${manifest.screenId}; task ${task.taskId}; arm ${arm}; configuration SHA-256 ${digest(canonicalRequest(options.configuration))}.` });
        assignment = { ...assignment, run_id: created.id };
      }
      const runId = assignment.run_id!;
      let snapshot = runs.get(runId);
      if (snapshot.status === "created" && assignment.dispatch_claimed) {
        controller.cancel(runId); // Crash after claim is a retained interruption, never a new paid attempt.
      } else if (snapshot.status === "created") {
        screen.claimDispatch(manifest.screenId, task.taskId, arm);
        controller.start(runId);
      }
      const cancel = () => { controller.cancel(runId); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      try { snapshot = await controller.waitForRun(runId); }
      finally { options.signal?.removeEventListener("abort", cancel); }
      if (!isPatchRunTerminal(snapshot.status)) throw new Error("Comparison waits for terminal cleanup before scoring.");
      options.progress?.({ taskId: task.taskId, arm, runId, status: snapshot.status });
      const patch = snapshot.patch;
      let evaluation: ComparisonEvaluation = { status: "not_scorable", patchSha256: patch?.sha256 ?? null, oracleSha256: task.oracle.sha256,
        reason: patch?.kind === "recovered" ? "unfinished_recovered_artifact" : "no_complete_submission" };
      if (patch && patch.kind !== "recovered" && !patch.truncated && patch.text.trim()) {
        if (digest(patch.text) !== patch.sha256) throw new Error("Terminal patch identity changed.");
        await verifiedFile(task.oracle);
        const patchPath = path.join(options.outputDirectory, `${task.taskId}-${arm}-${runId}.patch`);
        try { await writeFile(patchPath, patch.text, { mode: 0o600, flag: "wx" }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || digest(await readFile(patchPath)) !== patch.sha256) throw new Error("Frozen patch export changed."); }
        screen.claimEvaluation(manifest.screenId, task.taskId, arm);
        try {
          const receipt = EvaluationReceiptSchema.parse(await options.evaluate(task, patchPath));
          if (receipt.sourceRevision !== task.source.revision || receipt.oracleSha256 !== task.oracle.sha256 || receipt.patchSha256 !== patch.sha256 || receipt.image !== manifest.image) throw new Error("Evaluation receipt identity mismatch.");
          if (receipt.failureKind === "infrastructure" || receipt.error !== undefined) throw new Error("Evaluator infrastructure failed.");
          if (receipt.exitCode === 0 && receipt.testCount !== task.referenceReceipt.testCount) throw new Error("Evaluation did not execute the frozen acceptance count.");
          evaluation = { status: "scored", patchSha256: patch.sha256, oracleSha256: task.oracle.sha256, receipt };
        } catch {
          screen.evaluated(manifest.screenId, task.taskId, arm, { status: "error", patchSha256: patch.sha256, oracleSha256: task.oracle.sha256, reason: "evaluator_or_receipt_failure" });
          throw new Error("Independent evaluation failed; retain the episode and inspect cleanup before continuing.");
        }
      }
      screen.evaluated(manifest.screenId, task.taskId, arm, evaluation);
    }
    screen.completeBlock(manifest.screenId, block.task_id);
  }
}
