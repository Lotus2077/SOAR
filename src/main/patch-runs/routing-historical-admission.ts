import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { SoarDatabase } from "../database";
import { PatchRunIdSchema } from "../../shared/patch-run-contracts";
import { digest } from "./comparison";
import { patchCampaignExposure } from "./comparison-schema";
import { canonicalRequest } from "./native-contract";
import { PatchRunStore } from "./store";
import { RoutingHistoricalAdmissionSchema, RoutingConfigurationSchema, type RoutingHistoricalAdmission } from "./routing-comparison";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rowDigest = z.object({ keySha256: sha, sha256: sha }).strict();
const rows = z.array(rowDigest).max(100_000);
const tableKeys = {
  patch_runs: ["id"], patch_run_requests: ["request_id"], patch_run_events: ["run_id", "sequence"],
  patch_comparison_screens: ["id"], patch_comparison_blocks: ["screen_id", "task_id"],
  patch_comparison_assignments: ["screen_id", "task_id", "arm"], patch_comparison_evaluation_claims: ["screen_id", "task_id", "arm"],
  patch_routing_screens: ["id"], patch_routing_blocks: ["screen_id", "task_id"],
  patch_routing_assignments: ["screen_id", "task_id", "arm"], patch_routing_evaluation_claims: ["screen_id", "task_id", "arm"],
} as const;
type Table = keyof typeof tableKeys;
type Row = Record<string, string | number | null>;
const tables = Object.keys(tableKeys) as Table[];
export const RoutingHistoricalReceiptSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("routing-historical-admission-v1"),
  screenId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
  priorCampaignExposureMicrousd: count, priorRunCount: count,
  cleanupObservation: z.object({ observedAt: z.string().datetime(), ownedContainerCount: z.literal(0) }).strict(),
  runs: z.array(z.object({ runId: PatchRunIdSchema, snapshotSha256: sha,
    spentMicrousd: count, reservedMicrousd: count, unknownRequestCount: count,
    cleanup: z.enum(["confirmed", "accounting_only_critic"]) }).strict()).max(10_000),
  tables: z.object({ patch_runs: rows, patch_run_requests: rows, patch_run_events: rows,
    patch_comparison_screens: rows, patch_comparison_blocks: rows, patch_comparison_assignments: rows, patch_comparison_evaluation_claims: rows,
    patch_routing_screens: rows, patch_routing_blocks: rows, patch_routing_assignments: rows, patch_routing_evaluation_claims: rows }).strict(),
}).strict();
export type RoutingHistoricalReceipt = z.infer<typeof RoutingHistoricalReceiptSchema>;

function inventory(database: SoarDatabase): Record<Table, Row[]> {
  return Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table}`).all()])) as Record<Table, Row[]>;
}
function fingerprints(table: Table, values: Row[]) {
  return values.map(row => ({ keySha256: digest(canonicalRequest(tableKeys[table].map(key => row[key]))),
    sha256: digest(canonicalRequest(row)) })).sort((a, b) => a.keySha256.localeCompare(b.keySha256));
}
/** Bind a final closure to the complete ledger state without exporting rows. */
export function routingAdmissionLedgerSha256(database: SoarDatabase): string {
  return database.transaction(() => {
    const data = inventory(database);
    return digest(canonicalRequest(Object.fromEntries(tables.map(table => [table, fingerprints(table, data[table])]))));
  })();
}
function safeTotal(values: number[]) { return count.parse(values.reduce((sum, value) => sum + count.parse(value), 0)); }

/** The only cleanup-null exception is the existing text-only critic carrier.
 * Exact event identity rules out any runtime/container action in that carrier;
 * the separate Docker observation does not rewrite its historical snapshot. */
function historicalRuns(database: SoarDatabase, data: Record<Table, Row[]>) {
  const store = new PatchRunStore(database);
  return data.patch_runs.map(row => {
    const id = PatchRunIdSchema.parse(row.id), snapshot = store.get(id);
    if (row.status !== snapshot.status || ["created", "running"].includes(snapshot.status) ||
        canonicalRequest(snapshot) !== canonicalRequest(store.replay(id))) throw new Error("Historical run is nonterminal or its replay differs.");
    const requests = data.patch_run_requests.filter(request => request.run_id === id);
    for (const request of requests) {
      if (["reserved", "started"].includes(String(request.state)) || request.finish_json === null) throw new Error("Historical request is not closed.");
      const admission = JSON.parse(String(request.admission_json)), finish = JSON.parse(String(request.finish_json));
      if (admission.requestId !== request.request_id || admission.amountMicrousd !== request.reservation_microusd ||
          finish.requestId !== request.request_id || finish.outcome !== request.state ||
          (finish.actualCostMicrousd ?? null) !== request.actual_microusd ||
          (request.state === "unknown" && request.actual_microusd !== null)) throw new Error("Historical request accounting differs from its receipts.");
    }
    const unknown = requests.filter(request => request.state === "unknown");
    if (safeTotal(unknown.map(request => Number(request.reservation_microusd))) !== snapshot.reservedMicrousd ||
        safeTotal(requests.map(request => Number(request.actual_microusd ?? 0))) !== snapshot.spentMicrousd) throw new Error("Historical request exposure differs from its snapshot.");
    let cleanup: "confirmed" | "accounting_only_critic" = "confirmed";
    if (snapshot.cleanupConfirmed !== true) {
      const events = data.patch_run_events.filter(event => event.run_id === id).sort((a, b) => Number(a.sequence) - Number(b.sequence));
      const expected = ["run.created", "run.started", "phase.changed", "diagnostic.accounting_only", "request.reserved", "request.started", "request.finished", "run.failed"];
      const marker = /^Standalone critic; never a completed patch run\. Source run ([a-f0-9-]{36}); bundle SHA-256 [a-f0-9]{64}; plan SHA-256 [a-f0-9]{64}\.$/u.exec(String(events[3]?.summary));
      if (snapshot.cleanupConfirmed !== undefined || snapshot.policy !== "cloud" || snapshot.executionMode !== "live" ||
          snapshot.status !== "failed" || snapshot.error !== "diagnostic_only_no_patch_run_completion" || snapshot.patch ||
          snapshot.checks.status !== "not_run" || snapshot.checks.command !== "" || snapshot.checkpoint || snapshot.cloudPlan || snapshot.plannerCheck ||
          canonicalRequest(events.map(event => event.type)) !== canonicalRequest(expected) ||
          events.some((event, index) => event.sequence !== index + 1) ||
          JSON.parse(String(events[2]?.payload_json)).changes?.phase !== "cloud_solver" || !marker || marker[1] === id ||
          !data.patch_runs.some(run => run.id === marker[1]) || requests.length !== 1 ||
          !["succeeded", "failed"].includes(String(requests[0]!.state)) || requests[0]!.actual_microusd === null ||
          JSON.parse(String(requests[0]!.admission_json)).phase !== "cloud") throw new Error("Historical cleanup is unconfirmed outside the exact accounting-only critic exception.");
      cleanup = "accounting_only_critic";
    }
    return { runId: id, snapshotSha256: digest(String(row.snapshot_json)), spentMicrousd: snapshot.spentMicrousd,
      reservedMicrousd: snapshot.reservedMicrousd, unknownRequestCount: unknown.length, cleanup };
  }).sort((a, b) => a.runId.localeCompare(b.runId));
}

/** Read-only receipt construction. The operator must obtain the independent
 * zero-container observation and freeze these bytes before creating the screen. */
export function createRoutingHistoricalAdmission(database: SoarDatabase, options: {
  screenId: string; cleanupObservation: RoutingHistoricalReceipt["cleanupObservation"];
}): RoutingHistoricalReceipt {
  return database.transaction(() => {
    const data = inventory(database);
    if (data.patch_routing_screens.some(row => row.id === options.screenId) || data.patch_comparison_screens.some(row => row.id === options.screenId)) {
      throw new Error("Historical admission must precede the target screen.");
    }
    const runs = historicalRuns(database, data);
    return RoutingHistoricalReceiptSchema.parse({ schemaVersion: 1, kind: "routing-historical-admission-v1", ...options,
      priorCampaignExposureMicrousd: patchCampaignExposure(database).microusd, priorRunCount: runs.length, runs,
      tables: Object.fromEntries(tables.map(table => [table, fingerprints(table, data[table])])) });
  })();
}

/** Old rows, including pending/reserved block holds, cannot drift. Only rows
 * owned by the exact new screen may grow; their unknown outcomes still block.
 * receiptSha256 must be computed by the caller from the exact parsed file bytes;
 * this synchronous database verifier never substitutes a canonical JSON hash. */
export function verifyRoutingHistoricalAdmission(database: SoarDatabase, raw: unknown, options: {
  screenId: string; receiptSha256: string;
}): RoutingHistoricalAdmission {
  const receipt = RoutingHistoricalReceiptSchema.parse(raw);
  const projection = RoutingHistoricalAdmissionSchema.parse({ receiptSha256: options.receiptSha256,
    priorCampaignExposureMicrousd: receipt.priorCampaignExposureMicrousd, priorRunCount: receipt.priorRunCount });
  if (receipt.screenId !== options.screenId) throw new Error("Historical admission belongs to another screen.");
  return database.transaction(() => {
    const data = inventory(database), priorIds = new Set(receipt.runs.map(run => run.runId));
    if (priorIds.size !== receipt.runs.length || priorIds.size !== receipt.priorRunCount) throw new Error("Historical run inventory is not unique and complete.");
    const currentAssignments = data.patch_routing_assignments.filter(row => row.screen_id === options.screenId);
    const currentIds = new Set(currentAssignments.flatMap(row => row.run_id === null ? [] : [String(row.run_id)]));
    if ([...currentIds].some(id => priorIds.has(id))) throw new Error("A historical run cannot be assigned to the new screen.");
    const frozenRow = data.patch_routing_screens.find(row => row.id === options.screenId);
    if (frozenRow) {
      const frozen = JSON.parse(String(frozenRow.frozen_json)), configuration = RoutingConfigurationSchema.parse(frozen.configuration);
      if (configuration.schemaVersion !== 2 || canonicalRequest(configuration.historicalAdmission) !== canonicalRequest(projection) ||
          digest(canonicalRequest(configuration)) !== frozenRow.configuration_sha256 || frozen.screenId !== options.screenId ||
          frozen.configurationSha256 !== frozenRow.configuration_sha256 || frozen.manifestSha256 !== frozenRow.manifest_sha256 ||
          digest(canonicalRequest(frozen.blocks)) !== frozen.blocksSha256) {
        throw new Error("Frozen screen historical admission changed.");
      }
      const blocks = data.patch_routing_blocks.filter(row => row.screen_id === options.screenId).sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
      const taskIds = configuration.taskContracts.map(task => task.taskId).sort();
      if (canonicalRequest(blocks.map(row => row.task_id).sort()) !== canonicalRequest(taskIds) ||
          canonicalRequest(blocks.map(row => ({ taskId: row.task_id, order: JSON.parse(String(row.arm_order)) }))) !== canonicalRequest(frozen.blocks) ||
          blocks.some((row, index) => row.ordinal !== index || row.reservation_microusd !== 9_000_000) ||
          canonicalRequest(currentAssignments.map(row => `${row.task_id}/${row.arm}`).sort()) !== canonicalRequest(taskIds.flatMap(id => [`${id}/C`, `${id}/P`]).sort()) ||
          currentAssignments.some(row => row.run_id !== null && row.dispatch_claimed !== 1)) throw new Error("Current screen ownership differs from its frozen assignments.");
    } else if (currentAssignments.length) throw new Error("Current assignments lack their frozen screen.");
    const prior = Object.fromEntries(tables.map(table => [table, data[table].filter(row => {
      if (table === "patch_runs") return priorIds.has(String(row.id));
      if (table === "patch_run_events" || table === "patch_run_requests") return priorIds.has(String(row.run_id));
      if (table.startsWith("patch_routing_")) return (table === "patch_routing_screens" ? row.id : row.screen_id) !== options.screenId;
      return true;
    })])) as Record<Table, Row[]>;
    for (const table of tables) if (canonicalRequest(fingerprints(table, prior[table])) !== canonicalRequest(receipt.tables[table])) {
      throw new Error(`Historical ${table} row identity changed.`);
    }
    if (canonicalRequest(historicalRuns(database, prior)) !== canonicalRequest(receipt.runs)) throw new Error("Historical run evidence changed.");
    const store = new PatchRunStore(database);
    for (const row of data.patch_runs.filter(row => !priorIds.has(String(row.id)))) {
      const id = String(row.id), run = store.get(id);
      if (!currentIds.has(id) || ["created", "running"].includes(run.status) || run.cleanupConfirmed !== true || store.hasUnresolvedRequests(id)) {
        throw new Error("New unrelated, active, unresolved or cleanup-unconfirmed run blocks historical admission.");
      }
    }
    if (data.patch_run_requests.some(row => !priorIds.has(String(row.run_id)) && !currentIds.has(String(row.run_id))) ||
        data.patch_run_events.some(row => !priorIds.has(String(row.run_id)) && !currentIds.has(String(row.run_id)))) throw new Error("New ledger rows lack a current-screen owner.");
    const currentExposure = safeTotal(data.patch_routing_blocks.filter(row => row.screen_id === options.screenId).map(block => {
      const actual = safeTotal(currentAssignments.filter(row => row.task_id === block.task_id && row.run_id !== null).map(row => {
        const run = store.get(String(row.run_id)); return safeTotal([run.spentMicrousd, run.reservedMicrousd]);
      }));
      return block.state === "reserved" ? Math.max(Number(block.reservation_microusd), actual) : actual;
    }));
    if (patchCampaignExposure(database).microusd !== safeTotal([receipt.priorCampaignExposureMicrousd, currentExposure])) throw new Error("Historical campaign exposure changed.");
    return projection;
  })();
}

/** A frozen observation is evidence, not a replacement for this fresh gate.
 * This read-only probe runs with no shell, a deadline and bounded output. */
export async function assertNoOwnedRoutingContainers(signal?: AbortSignal): Promise<void> {
  const result = await promisify(execFile)("docker", ["ps", "-aq", "--filter", "label=soar.patch-worker=1"],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 65_536, signal,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG } });
  if (result.stdout.trim() || result.stderr.trim()) throw new Error("Owned runtime containers remain or cleanup observation is ambiguous.");
}
