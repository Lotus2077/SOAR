import type { SoarDatabase } from "../database";
import { PatchRunStore } from "./store";
import { patchCampaignExposure } from "./comparison-schema";
import { digest, EvaluationReceiptSchema, isSuccessfulEvaluation } from "./comparison";
import { routingArms, RoutingConfigurationSchema, RoutingComparisonStore, type RoutingComparisonEvaluation } from "./routing-comparison";
import { canonicalRequest } from "./worker";
export { joinRoutingIndependentReview, RoutingIndependentReviewSchema } from "./routing-comparison-review";
import { isPatchRunTerminal } from "../../shared/patch-run-contracts";

export interface RoutingReviewSummary {
  status: "pending" | "incomplete" | "complete";
  receiptSha256: string | null;
  completedReviews: number; requiredReviews: number;
  completedComparisons: number; requiredComparisons: number;
}
export interface RoutingAdvancementGate {
  status: "pending_review" | "blocked" | "eligible_for_confirmation";
  eligible: boolean; reasons: string[];
  additionalMaterialRegression: boolean | null;
  apiCostPerAcceptableSavingFraction: number | null;
  medianLatencyRatio: number | null;
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2 : null;
};
const phases = ["local", "planner", "cloud"] as const;
type Phase = typeof phases[number];
const emptyTimes = (): Record<Phase, number> => ({ local: 0, planner: 0, cloud: 0 });

/** Automatic evidence only. This report deliberately has no acceptance or advance
 * inference. A later blind-review join must bind the exact submitted patch. */
export function routingComparisonReport(database: SoarDatabase, screenId: string) {
  const stored = database.prepare("SELECT * FROM patch_routing_screens WHERE id = ?").get(screenId) as
    { manifest_sha256: string; configuration_sha256: string; frozen_json: string; ceiling_microusd: number } | undefined;
  if (!stored) throw new Error("Unknown routing screen.");
  const frozen = JSON.parse(stored.frozen_json) as { configuration: unknown; tasks: Array<{ taskId: string; kind?: string; visibleCommand: string; solverObjectiveSha256: string; oracleSha256: string; source: { revision: string } }> };
  const configuration = RoutingConfigurationSchema.parse(frozen.configuration);
  const development = configuration.schemaVersion === 2, configuredArms = routingArms(configuration);
  if (development && (digest(canonicalRequest(configuration)) !== stored.configuration_sha256 ||
      configuration.manifestSha256 !== stored.manifest_sha256 || frozen.tasks.length !== 6 ||
      new Set(frozen.tasks.map((task) => task.taskId)).size !== 6 ||
      configuration.taskContracts.some((task) => !frozen.tasks.some((item) => item.taskId === task.taskId)))) {
    throw new Error("Frozen development report identity is inconsistent.");
  }
  const screen = new RoutingComparisonStore(database), runs = new PatchRunStore(database);
  const assignments = screen.assignments(screenId);
  if (development && (assignments.length !== frozen.tasks.length * configuredArms.length ||
      frozen.tasks.some((task) => configuredArms.some((arm) => assignments.filter((row) => row.task_id === task.taskId && row.arm === arm).length !== 1)))) {
    throw new Error("Frozen development assignment denominator is incomplete or foreign.");
  }
  const rows = assignments.map((assignment) => {
    const task = frozen.tasks.find((item) => item.taskId === assignment.task_id);
    const contract = configuration.taskContracts.find((item) => item.taskId === assignment.task_id);
    if (!task || !contract) throw new Error("Assignment is missing its frozen task contract.");
    const run = assignment.run_id ? runs.get(assignment.run_id) : null;
    const evaluation = assignment.evaluation_json ? JSON.parse(assignment.evaluation_json) as RoutingComparisonEvaluation : null;
    const requests = run ? database.prepare("SELECT state,actual_microusd,reservation_microusd FROM patch_run_requests WHERE run_id = ?").all(run.id) as { state: string; actual_microusd: number | null; reservation_microusd: number }[] : [];
    const unresolvedRequests = requests.filter((row) => ["reserved", "started", "unknown"].includes(row.state)).length;
    const ledgerSpent = requests.reduce((sum, request) => sum + (request.actual_microusd ?? 0), 0);
    const ledgerUnresolved = requests.filter((request) => ["reserved", "started", "unknown"].includes(request.state)).reduce((sum, request) => sum + request.reservation_microusd, 0);
    const accountingBound = !run || (ledgerSpent === run.spentMicrousd && ledgerUnresolved === run.reservedMicrousd);
    const events = run ? database.prepare("SELECT type,created_at,payload_json FROM patch_run_events WHERE run_id = ? ORDER BY sequence").all(run.id) as
      { type: string; created_at: string; payload_json: string }[] : [];
    const lastEvent = (type: string) => { for (let index = events.length - 1; index >= 0; index--) if (events[index]!.type === type) return index; return -1; };
    const patchIndex = lastEvent("patch.ready"), checksIndex = lastEvent("checks.finished"), plannerIndex = lastEvent("planner.checks.checked");
    const finalPatchBound = patchIndex >= 0 && checksIndex > patchIndex &&
      JSON.parse(events[patchIndex]!.payload_json).changes?.patch?.sha256 === run?.patch?.sha256 &&
      canonicalRequest(JSON.parse(events[checksIndex]!.payload_json).changes?.checks) === canonicalRequest(run?.checks);
    const submitted = Boolean(run?.patch?.text.trim() && run.patch.kind !== "recovered" && !run.patch.truncated && digest(run.patch.text) === run.patch.sha256);
    const receipt = evaluation?.receipt;
    const parsed = EvaluationReceiptSchema.safeParse(receipt);
    const scopePassed = evaluation?.scope?.valid === true && evaluation.scope.reason === "within_scope" &&
      evaluation.scope.changedPaths.length > 0 && evaluation.scope.changedPaths.every((file) => contract.allowedFiles.includes(file));
    const receiptBound = Boolean(evaluation?.status === "scored" && scopePassed && submitted && run?.cleanupConfirmed === true && parsed.success &&
      evaluation.patchSha256 === run?.patch?.sha256 && evaluation.oracleSha256 === task.oracleSha256 &&
      receipt?.patchSha256 === run?.patch?.sha256 && receipt?.oracleSha256 === task.oracleSha256 &&
      receipt?.sourceRevision === task.source.revision && receipt?.sourceTreeSha256 === contract.sourceTreeSha256 &&
      receipt?.image === configuration.image && receipt?.failureKind !== "infrastructure" && receipt?.error === undefined &&
      (receipt?.exitCode !== 0 || receipt.testCount === contract.expectedTests));
    const diagnostic = development && (evaluation?.kind === "diagnostic" || (run?.status === "failed" && submitted));
    const independentlySolved = (!development || run?.status === "completed") && !diagnostic && receiptBound && isSuccessfulEvaluation(receipt) && receipt?.testCount === contract.expectedTests;
    const runIdentityBound = Boolean(run && run.baseRevision === task.source.revision &&
      run.policy === configuration.policyByArm[assignment.arm as keyof typeof configuration.policyByArm] &&
      digest(run.objective) === task.solverObjectiveSha256 && run.checks.command === task.visibleCommand);
    const visibleSourceBound = Boolean(finalPatchBound && run?.checks.sourceSha256 && run.checks.sourceAfterSha256);
    const visibleReceiptBound = finalPatchBound && (assignment.arm === "C" || visibleSourceBound);
    const visiblePassed = run?.checks.status === "passed" && (!development ||
      (runIdentityBound && visibleReceiptBound && run.checks.exitCode === 0 && (assignment.arm === "C" || run.checks.sourceSha256 === run.checks.sourceAfterSha256)));
    const planner = run?.plannerCheck, artifact = run?.cloudPlan?.checks;
    const generatedBound = Boolean(development && submitted && runIdentityBound && artifact && digest(artifact.source) === artifact.sha256 &&
      visibleSourceBound && plannerIndex > checksIndex && canonicalRequest(JSON.parse(events[plannerIndex]!.payload_json).changes?.plannerCheck) === canonicalRequest(planner) &&
      planner?.stage === "final" && planner.artifactSha256 === artifact.sha256 && planner.sourceSha256 === run?.checks.sourceSha256 &&
      (!planner.result || planner.result.expectedTests === artifact.expectedTests));
    const generated = generatedBound && planner ? { artifactSha256: planner.artifactSha256, patchSha256: run!.patch!.sha256,
      sourceSha256: planner.sourceSha256, sourceAfterSha256: planner.sourceAfterSha256,
      status: planner.passed && planner.fresh ? "passed" as const : planner.result?.completed && !planner.timedOut && !planner.outputTruncated ? "failed" as const : "incomplete" as const,
      completed: planner.result?.completed ?? false, timedOut: planner.timedOut } : null;
    const checkedCandidate = Boolean(run?.status === "completed" && submitted && independentlySolved && visiblePassed && unresolvedRequests === 0 &&
      (!development || (runIdentityBound && (assignment.arm !== "P" || generated?.status === "passed"))));
    const terminal = Boolean(run && isPatchRunTerminal(run.status));
    const cleanupFailure = Boolean(terminal && run?.cleanupConfirmed !== true);
    const requestMs = emptyTimes(), phaseMs = emptyTimes(), timedRequests = emptyTimes();
    const admitted = new Map<string, Phase>(), starts = new Map<string, number>();
    let active: { phase: Phase; at: number } | undefined;
    let checkpoints = 0;
    const routingReasons: Record<string, number> = {};
    for (const event of events) {
      const payload = JSON.parse(event.payload_json), time = Date.parse(event.created_at);
      if (!Number.isFinite(time)) throw new Error("Persisted event timestamp is invalid.");
      const detail = payload.detail;
      if (event.type === "request.reserved" && phases.includes(detail?.phase)) admitted.set(detail.requestId, detail.phase);
      if (event.type === "request.started") starts.set(detail.requestId, time);
      if (event.type === "request.finished") {
        const at = starts.get(detail.requestId), phase = admitted.get(detail.requestId);
        if (at !== undefined && phase) { requestMs[phase] += Math.max(0, time - at); timedRequests[phase]++; starts.delete(detail.requestId); }
      }
      const appPhase = payload.changes?.phase;
      if (appPhase) {
        if (active) { phaseMs[active.phase] += Math.max(0, time - active.at); active = undefined; }
        const phase = appPhase === "local_solver" ? "local" : appPhase === "cloud_planner" ? "planner" : appPhase === "cloud_solver" ? "cloud" : undefined;
        if (phase) active = { phase, at: time };
      }
      const checkpoint = payload.changes?.checkpoint;
      if (checkpoint?.decision === "checkpoint") checkpoints++;
      if (checkpoint?.reason) routingReasons[checkpoint.reason] = (routingReasons[checkpoint.reason] ?? 0) + 1;
    }
    const evaluationError = evaluation?.status === "error" || (evaluation?.status === "scored" && !receiptBound);
    return { taskId: assignment.task_id, kind: task.kind ?? null, arm: assignment.arm, runId: assignment.run_id,
      dispatchClaimed: Boolean(assignment.dispatch_claimed), status: run?.status ?? "unrun", terminal, submitted,
      cleanupConfirmed: run?.cleanupConfirmed ?? null, cleanupFailure,
      recoveredArtifact: run?.patch?.kind === "recovered", evaluationRecorded: evaluation !== null,
      evaluated: receiptBound, evaluationStatus: evaluation?.status ?? "pending", evaluationError,
      evaluationReason: evaluation?.reason ?? null,
      scopePassed,
      ...(development ? { diagnosticEvaluation: diagnostic, generatedCheck: generated,
        runtimeInfrastructureFailure: Boolean(run && (!accountingBound || !runIdentityBound || (terminal && run.status !== "completed" &&
          !(run.status === "failed" && submitted && diagnostic && receiptBound && generated?.status === "failed" &&
            run.error === "Worker stopped: routing_planner_final_checks_failed")) ||
          (submitted && (!visibleReceiptBound || (assignment.arm === "P" && (!generated || generated.status === "incomplete")))))) } : {}),
      independentlySolved, visiblePassed: Boolean(visiblePassed), checkedCandidate,
      unfinished: !terminal || !submitted,
      failure: Boolean(terminal && (cleanupFailure || run?.status !== "completed" || (evaluation !== null && !checkedCandidate))),
      blindReview: "pending" as "pending" | "accepted" | "rejected" | "incomplete", acceptable: null as boolean | null, ownerDecision: run?.decision ?? null,
      ownerKeptCheckedCandidate: Boolean(checkedCandidate && run?.decision === "keep"),
      spentMicrousd: development ? ledgerSpent : run?.spentMicrousd ?? 0, unresolvedMicrousd: development ? ledgerUnresolved : run?.reservedMicrousd ?? 0,
      requestCount: requests.length, unknownRequests: requests.filter((row) => row.state === "unknown").length, unresolvedRequests,
      elapsedMs: run?.elapsedMs ?? null, requestMs, timedRequests, phaseMs, phaseTimingComplete: !active,
      checkpoints, routingReasons, cloudRecoveries: run?.cloudRecoveryCount ?? 0, cloudPlanPresent: Boolean(run?.cloudPlan),
      localCalls: run?.checkpoint?.localCalls ?? 0, phaseUsage: run?.phaseUsage ?? null, patchSha256: run?.patch?.sha256 ?? null };
  });
  const arms = Object.fromEntries(configuredArms.map((arm) => {
    const assigned = rows.filter((row) => row.arm === arm), sum = (key: "spentMicrousd" | "unresolvedMicrousd" | "unknownRequests" | "unresolvedRequests" | "requestCount" | "checkpoints" | "cloudRecoveries" | "localCalls") => assigned.reduce((n, row) => n + row[key], 0);
    const count = (key: "terminal" | "submitted" | "evaluated" | "evaluationRecorded" | "evaluationError" | "independentlySolved" | "checkedCandidate" | "unfinished" | "failure" | "recoveredArtifact" | "ownerKeptCheckedCandidate" | "cloudPlanPresent") => assigned.filter((row) => row[key]).length;
    const spent = sum("spentMicrousd"), unresolved = sum("unresolvedMicrousd"), solved = count("independentlySolved");
    const latency = assigned.flatMap((row) => row.elapsedMs === null || (development && (!row.terminal || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0)) ? [] : [row.elapsedMs]);
    const latencyComplete = latency.length === frozen.tasks.length && assigned.every((row) => row.terminal);
    return [arm, { assigned: assigned.length, dispatched: assigned.filter((row) => row.dispatchClaimed).length,
      linkedRuns: assigned.filter((row) => row.runId).length, terminal: count("terminal"), unrun: assigned.filter((row) => !row.runId).length,
      submitted: count("submitted"), evaluated: count("evaluated"), evaluationRecorded: count("evaluationRecorded"), evaluationErrors: count("evaluationError"),
      notScorable: assigned.filter((row) => row.evaluationStatus === "not_scorable").length,
      cleanupFailures: assigned.filter((row) => row.cleanupFailure).length,
      awaitingEvaluation: assigned.filter((row) => row.terminal && row.submitted && !row.evaluationRecorded).length,
      unfinished: count("unfinished"), failures: count("failure"), recoveredArtifacts: count("recoveredArtifact"),
      independentlySolved: solved, checkedCandidates: count("checkedCandidate"), allAssignedIndependentSolveRate: solved / (development ? frozen.tasks.length : assigned.length),
      blindReviewed: 0, acceptable: null as number | null, costPerAcceptableMicrousd: null as number | null,
      ownerReviewed: assigned.filter((row) => row.ownerDecision !== null).length, ownerKeptCheckedCandidates: count("ownerKeptCheckedCandidate"),
      spentMicrousd: spent, unresolvedMicrousd: unresolved, maximumExposureMicrousd: spent + unresolved,
      costPerIndependentSolveMicrousd: solved ? (spent + unresolved) / solved : null,
      unknownRequests: sum("unknownRequests"), unresolvedRequests: sum("unresolvedRequests"), requestCount: sum("requestCount"),
      ...(development ? { latencyComplete } : {}),
      elapsedSamples: latency.length, medianElapsedMs: development && !latencyComplete ? null : median(latency), maxElapsedMs: latency.length ? Math.max(...latency) : null,
      phaseMs: Object.fromEntries(phases.map((phase) => [phase, assigned.reduce((n, row) => n + row.phaseMs[phase], 0)])),
      requestMs: Object.fromEntries(phases.map((phase) => [phase, assigned.reduce((n, row) => n + row.requestMs[phase], 0)])),
      timedRequests: Object.fromEntries(phases.map((phase) => [phase, assigned.reduce((n, row) => n + row.timedRequests[phase], 0)])),
      checkpoints: sum("checkpoints"), cloudRecoveries: sum("cloudRecoveries"), cloudPlans: count("cloudPlanPresent"), localCalls: sum("localCalls") }];
  }));
  const blocks = screen.blocks(screenId), complete = blocks.length === frozen.tasks.length && blocks.every((block) => block.state === "completed") &&
    (!development || (new Set(blocks.map((block) => block.task_id)).size === frozen.tasks.length &&
      blocks.every((block) => frozen.tasks.some((task) => task.taskId === block.task_id)) && rows.every((row) => row.terminal && row.evaluationRecorded)));
  return { schemaVersion: development ? "routing-comparison-report-v2" as const : "routing-comparison-report-v1" as const, screenId, complete, assigned: rows.length,
    completedBlocks: blocks.filter((block) => block.state === "completed").length, totalBlocks: blocks.length,
    manifestSha256: stored.manifest_sha256, configurationSha256: stored.configuration_sha256,
    expectedAcceptanceMethodsPerArm: configuration.taskContracts.reduce((n, task) => n + task.expectedTests, 0),
    stageCeilingMicrousd: stored.ceiling_microusd, stageMaximumExposureMicrousd: patchCampaignExposure(database).microusd,
    configuration, arms, rows,
    ...(development ? { kind: "routing-public-checks-development-v2" as const, studyKind: "development" as const,
      assignedTasksPerArm: frozen.tasks.length, configuredArms,
      campaignMaximumExposureMicrousd: patchCampaignExposure(database).microusd,
      review: { status: "pending", receiptSha256: null, completedReviews: 0, requiredReviews: rows.length,
        completedComparisons: 0, requiredComparisons: frozen.tasks.length } as RoutingReviewSummary,
      advancement: { status: "pending_review", eligible: false, reasons: ["independent_review_pending"],
        additionalMaterialRegression: null, apiCostPerAcceptableSavingFraction: null, medianLatencyRatio: null } as RoutingAdvancementGate } : {}),
    economics: { devicePurchaseUsd: 3500, localPerTokenApiFeeUsd: 0, electricityAndUtilizationUsd: null, measuredAllInSavingsUsd: null, measuredPayback: null },
    limitations: [development ? "Six previously exposed tasks are development evidence only; untouched confirmation tasks and general coding quality remain unverified." : "Twelve internally authored fresh tasks are a fail-fast screen, not statistical quality equivalence.",
      "Every assigned task remains in the denominator, including unrun and unfinished tasks. Categories can overlap.",
      "Independent solve means frozen automated oracle success; checked candidate also requires submission and visible checks.",
      "A missing or failed immutable worker cleanup receipt blocks success eligibility and is reported separately.",
      "Blind review is pending; acceptable-patch counts and cost per acceptable patch are unavailable. Owner decisions remain separate.",
      "Unknown requests retain maximum admitted exposure, including zero-fee local requests; they never authorize retry.",
      "API cost per independent solve includes spent plus unresolved maximum exposure; zero solves yields unavailable, never zero.",
      "Request and phase times use host event timestamps; unfinished phases are incomplete and missing receipts are not zero latency.",
      "The owned device cost $3,500. Zero local token fees exclude electricity, utilization and capital allocation; no payback or savings inference is made.",
      "Automated results do not authorize advancement or demonstrate owner usefulness, general coding quality or release.",
      ...(development ? ["Generated-check verdicts bind the final submitted patch and visible-check source; they are fallible diagnostics, never independent acceptance.",
        "Failed-run diagnostic evaluations cannot produce independent solves, checked candidates or acceptable patches.",
        "Comparable median latency requires all six terminal assignments per arm, including failed runs.",
        "Stage maximum exposure includes the existing shared campaign and held blocks; arm cost includes all assigned run fees and unresolved maximum exposure."] : [])] };
}

export function routingComparisonMarkdown(report: ReturnType<typeof routingComparisonReport>): string {
  const usd = (value: number | null) => value === null ? "unavailable" : `$${(value / 1e6).toFixed(4)}`;
  const seconds = (value: number | null) => value === null ? "unavailable" : (value / 1000).toFixed(1);
  const development = report.schemaVersion === "routing-comparison-report-v2", configuredArms = routingArms(report.configuration);
  const lines = [`# SOAR ${development ? "C/P development comparison" : "C/L/E/P routing screen"}: ${report.screenId}`, "",
    `${report.completedBlocks}/${report.totalBlocks} blocks complete; ${report.assigned} assignments retained. ${development ? `Independent review: ${report.review?.status ?? "pending"}.` : "Blind review is pending."}`, "",
    development ? "C: prepared cloud. P: cloud-generated public-contract checks, host checkpoints, local work and at most one cloud recovery." : "C: prepared cloud. L: local only. E: local first with at most one cloud recovery. P: one cloud plan, then local work and at most one recovery.", "",
    "| Arm | Assigned / evaluated | Unrun / unfinished | Failures / evaluation errors | Independent solves | Checked candidates | API spend / unresolved | Max API cost per independent solve | Median / max seconds |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const arm of configuredArms) {
    const row = report.arms[arm]!;
    lines.push(`| ${arm} | ${row.assigned} / ${row.evaluated} | ${row.unrun} / ${row.unfinished} | ${row.failures} / ${row.evaluationErrors} | ${row.independentlySolved} | ${row.checkedCandidates} | ${usd(row.spentMicrousd)} / ${usd(row.unresolvedMicrousd)} | ${usd(row.costPerIndependentSolveMicrousd)} | ${seconds(row.medianElapsedMs)} / ${seconds(row.maxElapsedMs)} |`);
  }
  lines.push("", "| Arm | Unknown / unresolved requests | Local calls | Checkpoints | Cloud plans / recoveries | Owner reviewed / kept checked |", "| --- | --- | --- | --- | --- | --- |");
  for (const arm of configuredArms) { const row = report.arms[arm]!; lines.push(`| ${arm} | ${row.unknownRequests} / ${row.unresolvedRequests} | ${row.localCalls} | ${row.checkpoints} | ${row.cloudPlans} / ${row.cloudRecoveries} | ${row.ownerReviewed} / ${row.ownerKeptCheckedCandidates} |`); }
  if (development) {
    lines.push("", "| Arm | Independently acceptable / assigned | Max API cost per acceptable patch | Terminal latency samples |", "| --- | --- | --- | --- |");
    for (const arm of configuredArms) { const row = report.arms[arm]!; lines.push(`| ${arm} | ${row.acceptable ?? "pending"} / ${row.assigned} | ${usd(row.costPerAcceptableMicrousd)} | ${row.elapsedSamples} / ${row.assigned} |`); }
    lines.push("", `Advancement: ${report.advancement?.status ?? "pending_review"}. ${report.advancement?.reasons.join(", ") ?? "independent_review_pending"}`);
  }
  lines.push("", development ? "Independent acceptance requires a patch-bound review and paired material-regression evidence. Generated checks and owner decisions cannot supply it." : "Cost per acceptable patch: unavailable until patch-bound blind review. Owner acceptance is not inferred from automated checks.", "",
    `Manifest SHA-256: ${report.manifestSha256}`, `Configuration SHA-256: ${report.configurationSha256}`, "", ...report.limitations.map((value) => `- ${value}`), "");
  return lines.join("\n");
}
