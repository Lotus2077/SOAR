import type { SoarDatabase } from "../database";
import { PatchRunStore } from "./store";
import { ARMS, ComparisonStore, isSuccessfulEvaluation, type ComparisonArm, type ComparisonEvaluation, type ComparisonManifest } from "./comparison";

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
};

export function comparisonReport(database: SoarDatabase, screenId: string) {
  const screen = new ComparisonStore(database);
  const runs = new PatchRunStore(database);
  const frozen = database.prepare("SELECT manifest_sha256,configuration_sha256,frozen_json,ceiling_microusd FROM patch_comparison_screens WHERE id = ?").get(screenId) as
    { manifest_sha256: string; configuration_sha256: string; frozen_json: string; ceiling_microusd: number } | undefined;
  if (!frozen) throw new Error("Unknown comparison screen.");
  const frozenData = JSON.parse(frozen.frozen_json) as { manifest: ComparisonManifest; configuration: unknown };
  const rows = screen.assignments(screenId).map((assignment) => {
    const task = frozenData.manifest.tasks.find((item) => item.taskId === assignment.task_id)!;
    const run = assignment.run_id ? runs.get(assignment.run_id) : null;
    const evaluation = assignment.evaluation_json ? JSON.parse(assignment.evaluation_json) as ComparisonEvaluation : null;
    const events = run ? database.prepare("SELECT type,created_at,payload_json FROM patch_run_events WHERE run_id = ? ORDER BY sequence").all(run.id) as
      Array<{ type: string; created_at: string; payload_json: string }> : [];
    const started = new Map<string, { time: number; phase: string }>();
    const requestPhases = new Map<string, string>();
    let localRequestMs = 0, cloudRequestMs = 0, cloudPhaseMs = 0, cloudStart: number | null = null;
    for (const event of events) {
      const payload = JSON.parse(event.payload_json) as { changes?: { phase?: string }; detail?: { requestId?: string; phase?: string } };
      const time = Date.parse(event.created_at);
      if (event.type === "request.reserved" && payload.detail?.requestId) requestPhases.set(payload.detail.requestId, payload.detail.phase ?? "unattributed");
      if (event.type === "request.started" && payload.detail?.requestId) started.set(payload.detail.requestId, { time, phase: requestPhases.get(payload.detail.requestId) ?? "unattributed" });
      if (event.type === "request.finished" && payload.detail?.requestId) {
        const start = started.get(payload.detail.requestId);
        if (start?.phase === "scout") localRequestMs += Math.max(0, time - start.time);
        if (start?.phase === "cloud") cloudRequestMs += Math.max(0, time - start.time);
      }
      if (payload.changes?.phase === "cloud_solver" && cloudStart === null) cloudStart = time;
      if (cloudStart !== null && payload.changes?.phase && payload.changes.phase !== "cloud_solver") { cloudPhaseMs += Math.max(0, time - cloudStart); cloudStart = null; }
    }
    const requests = run ? database.prepare("SELECT state FROM patch_run_requests WHERE run_id = ?").all(run.id) as Array<{ state: string }> : [];
    const independentlySolved = evaluation?.status === "scored" && isSuccessfulEvaluation(evaluation.receipt) &&
      evaluation.receipt?.testCount === task.referenceReceipt.testCount;
    const visiblePassed = run?.checks.status === "passed";
    const submitted = Boolean(run?.patch?.text.trim() && !run.patch.truncated && run.patch.kind !== "recovered");
    const checkedCandidate = Boolean(independentlySolved && visiblePassed && submitted);
    const error = run?.error ?? "";
    const failureClass = !run ? "unrun" : evaluation?.status === "error" || evaluation?.receipt?.failureKind === "infrastructure" ? "evaluation_infrastructure" :
      run.status === "blocked" || /provider_http|provider_connection|provider_tls|Provider (?:returned HTTP|connection|TLS|transport)|runtime could not|cleanup/i.test(error) ? "infrastructure" :
      run.status === "cancelled" || run.status === "interrupted" ? "intervention_or_interruption" : checkedCandidate ? "checked_candidate" : "task_or_model_failure";
    return { taskId: assignment.task_id, arm: assignment.arm, runId: assignment.run_id, status: run?.status ?? "unrun", failureClass,
      evaluated: evaluation !== null, independentStatus: evaluation?.status ?? "pending", independentlySolved, visiblePassed: Boolean(visiblePassed), checkedCandidate,
      evaluationReason: evaluation?.reason ?? null,
      falseAccept: Boolean(visiblePassed && evaluation?.status === "scored" && !independentlySolved),
      decision: run?.decision ?? null, ownerKeptUsefulPatch: checkedCandidate && run?.decision === "keep",
      spentMicrousd: run?.spentMicrousd ?? 0, unresolvedMicrousd: run?.reservedMicrousd ?? 0,
      elapsedMs: run?.elapsedMs ?? null, localPhaseMs: run?.localInvestigation?.elapsedMs ?? (assignment.arm === "H" && run ? null : 0),
      localOutcome: run?.localInvestigation?.outcome ?? null, localRequestMs, cloudRequestMs, cloudPhaseMs,
      requestCount: requests.length, unknownRequests: requests.filter((request) => request.state === "unknown").length,
      userInterventions: events.filter((event) => event.type === "run.cancel_requested").length,
      phaseUsage: run?.phaseUsage ?? null, patchSha256: run?.patch?.sha256 ?? null,
      oracleSha256: evaluation?.oracleSha256 ?? null, configurationSha256: frozen.configuration_sha256 };
  });
  const arms = Object.fromEntries(ARMS.map((arm) => {
    const assigned = rows.filter((row) => row.arm === arm), executed = assigned.filter((row) => row.runId);
    const solved = assigned.filter((row) => row.independentlySolved).length;
    const spent = assigned.reduce((sum, row) => sum + row.spentMicrousd, 0), unresolved = assigned.reduce((sum, row) => sum + row.unresolvedMicrousd, 0);
    const latency = executed.flatMap((row) => row.elapsedMs === null ? [] : [row.elapsedMs]);
    return [arm, { assigned: assigned.length, executed: executed.length, evaluated: assigned.filter((row) => row.evaluated).length,
      independentlySolved: solved, checkedCandidates: assigned.filter((row) => row.checkedCandidate).length,
      keptUsefulPatches: assigned.filter((row) => row.ownerKeptUsefulPatch).length,
      ownerReviewed: assigned.filter((row) => row.decision !== null).length,
      allAssignedUsefulPatchYield: assigned.filter((row) => row.ownerKeptUsefulPatch).length / assigned.length,
      spentMicrousd: spent, unresolvedMicrousd: unresolved, maximumExposureMicrousd: spent + unresolved,
      costPerIndependentSolveMicrousd: solved ? (spent + unresolved) / solved : null,
      medianElapsedMs: median(latency), maxElapsedMs: latency.length ? Math.max(...latency) : null,
      localPhaseMs: executed.some((row) => row.localPhaseMs === null) ? null : executed.reduce((sum, row) => sum + (row.localPhaseMs ?? 0), 0),
      localRequestMs: executed.reduce((sum, row) => sum + row.localRequestMs, 0), cloudRequestMs: executed.reduce((sum, row) => sum + row.cloudRequestMs, 0),
      falseAccepts: assigned.filter((row) => row.falseAccept).length,
      localFallbacks: assigned.filter((row) => row.localOutcome === "fallback").length,
      infrastructureFailures: assigned.filter((row) => row.failureClass === "infrastructure" || row.failureClass === "evaluation_infrastructure").length,
      userInterventions: assigned.reduce((sum, row) => sum + row.userInterventions, 0) }];
  })) as Record<ComparisonArm, { assigned: number; executed: number; evaluated: number; independentlySolved: number; checkedCandidates: number;
    keptUsefulPatches: number; ownerReviewed: number; allAssignedUsefulPatchYield: number; spentMicrousd: number; unresolvedMicrousd: number; maximumExposureMicrousd: number;
    costPerIndependentSolveMicrousd: number | null; medianElapsedMs: number | null; maxElapsedMs: number | null; localPhaseMs: number | null; localRequestMs: number;
    cloudRequestMs: number; falseAccepts: number; localFallbacks: number; infrastructureFailures: number; userInterventions: number }>;
  const paired = [...new Set(rows.map((row) => row.taskId))].map((taskId) => {
    const task = Object.fromEntries(rows.filter((row) => row.taskId === taskId).map((row) => [row.arm, row])) as Record<ComparisonArm, typeof rows[number]>;
    const pair = (control: "C" | "D") => !task.H.evaluated || !task[control].evaluated ? "incomplete" :
      task.H.independentlySolved === task[control].independentlySolved ? "tie" : task.H.independentlySolved ? "H_win" : "H_loss";
    return { taskId, HvsC: pair("C"), HvsD: pair("D") };
  });
  const complete = screen.blocks(screenId).every((block) => block.state === "completed");
  const capitalSensitivity = [12, 24, 36].flatMap((lifeMonths) => [40, 80, 160].map((utilizedHoursPerMonth) => {
    const hourlyUsd = 3500 / (lifeMonths * utilizedHoursPerMonth);
    return { lifeMonths, utilizedHoursPerMonth, capitalOnlyHourlyUsd: hourlyUsd,
      observedHCapitalMicrousd: arms.H.localPhaseMs === null ? null : Math.ceil(arms.H.localPhaseMs / 3600000 * hourlyUsd * 1e6) };
  }));
  const breakEven = Object.fromEntries((["C", "D"] as const).map((control) => {
    const difference = arms[control].maximumExposureMicrousd - arms.H.maximumExposureMicrousd;
    return [control, complete && arms.H.independentlySolved >= arms[control].independentlySolved && difference > 0 && arms.H.localPhaseMs
      ? difference / 1e6 / (arms.H.localPhaseMs / 3600000) : null];
  }));
  return { schemaVersion: "patch-comparison-report-v1", screenId, complete, manifestSha256: frozen.manifest_sha256,
    configurationSha256: frozen.configuration_sha256, ceilingMicrousd: frozen.ceiling_microusd,
    configuration: frozenData.configuration, arms, paired, rows,
    economics: { devicePurchaseUsd: 3500, incrementalLocalApiFeesUsd: 0, measuredElectricityAndAllocationUsd: null,
      capitalSensitivity, breakEvenAllInLocalHourlyUsd: breakEven },
    limitations: ["Internal developer-selected screen; not a public held-out quality claim.", "Unresolved exposure remains charged at its admitted maximum.",
      "Zero solves gives unavailable cost per solve, never zero.", "Capital utilization scenarios exclude electricity and are assumptions, not measured cost.",
      "Independent solves, visible checks, owner keep/reject and product usefulness remain separate.", "Incomplete blocks cannot establish an arm comparison."] };
}

export function comparisonMarkdown(report: ReturnType<typeof comparisonReport>): string {
  const usd = (amount: number | null) => amount === null ? "unavailable" : `$${(amount / 1e6).toFixed(4)}`;
  const seconds = (amount: number | null) => amount === null ? "unavailable" : (amount / 1000).toFixed(1);
  const lines = [`# SOAR internal C/D/H screen: ${report.screenId}`, "", report.complete ? "All 12 task blocks are complete." : "Screen incomplete; retain all assigned tasks and incomplete blocks.", "",
    "| Arm | Assigned / run | Independent solves | Checked candidates | Owner kept | API spend | Unresolved | Max cost / solve | Median / max seconds | Local phase seconds |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const arm of ARMS) { const value = report.arms[arm]; lines.push(`| ${arm} | ${value.assigned} / ${value.executed} | ${value.independentlySolved} | ${value.checkedCandidates} | ${value.keptUsefulPatches} | ${usd(value.spentMicrousd)} | ${usd(value.unresolvedMicrousd)} | ${usd(value.costPerIndependentSolveMicrousd)} | ${seconds(value.medianElapsedMs)} / ${seconds(value.maxElapsedMs)} | ${seconds(value.localPhaseMs)} |`); }
  lines.push("", "C is cloud; D adds deterministic preparation; H adds local investigation to D. The machine purchase was approximately $3,500. Local API fees are zero; electricity, utilization and fully allocated cost remain unmeasured. JSON includes capital sensitivity and break-even hourly costs.", "",
    "| Task | H versus C | H versus D |", "| --- | --- | --- |");
  for (const pair of report.paired) lines.push(`| ${pair.taskId} | ${pair.HvsC} | ${pair.HvsD} |`);
  lines.push("", `Manifest SHA-256: ${report.manifestSha256}`, `Configuration SHA-256: ${report.configurationSha256}`, "", ...report.limitations.map((value) => `- ${value}`), "");
  return lines.join("\n");
}
