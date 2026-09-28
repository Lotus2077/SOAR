import { z } from "zod";
import { digest } from "./comparison";
import { canonicalRequest } from "./worker";
import type { routingComparisonReport, RoutingAdvancementGate, RoutingReviewSummary } from "./routing-comparison-report";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.object({ runId: z.string().uuid().nullable(), patchSha256: sha.nullable() }).strict();
const review = identity.extend({ taskId: z.string().min(1).max(200), arm: z.enum(["C", "P"]),
  status: z.enum(["accepted", "rejected", "incomplete"]), evidenceSha256: sha.nullable() }).strict();
const comparison = z.object({ taskId: z.string().min(1).max(200), C: identity, P: identity,
  additionalMaterialRegression: z.boolean().nullable(), evidenceSha256: sha.nullable() }).strict();
export const RoutingIndependentReviewSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("routing-independent-review-v2"),
  screenId: z.string().min(1).max(200), configurationSha256: sha, manifestSha256: sha,
  reviews: z.array(review).max(12), comparisons: z.array(comparison).max(6),
}).strict().superRefine((value, context) => {
  for (const row of value.reviews) if (row.status !== "incomplete" && (!row.evidenceSha256 || !row.runId || !row.patchSha256)) {
    context.addIssue({ code: "custom", message: "Resolved review requires an exact run, patch and independent evidence hash." });
  }
  for (const row of value.comparisons) if (row.additionalMaterialRegression !== null &&
    (!row.evidenceSha256 || !row.C.runId || !row.C.patchSha256 || !row.P.runId || !row.P.patchSha256)) {
    context.addIssue({ code: "custom", message: "Resolved paired judgment requires both exact artifacts and reviewer comparison evidence." });
  }
});
export type RoutingIndependentReview = z.infer<typeof RoutingIndependentReviewSchema>;
type Report = ReturnType<typeof routingComparisonReport>;

/** Pure attribution and arithmetic. The caller must supply independently produced
 * review evidence: a digest binds its identity, not the reviewer's correctness or
 * blindness. Automatic/generated checks and owner decisions cannot create it. */
export function joinRoutingIndependentReview(report: Report, rawReceipt: unknown): Report {
  if (report.schemaVersion !== "routing-comparison-report-v2" || report.configuration.schemaVersion !== 2) {
    throw new Error("Independent review join requires the distinct V2 development report.");
  }
  const receipt = RoutingIndependentReviewSchema.parse(rawReceipt);
  if (receipt.screenId !== report.screenId || receipt.configurationSha256 !== report.configurationSha256 ||
      receipt.manifestSha256 !== report.manifestSha256 || digest(canonicalRequest(report.configuration)) !== report.configurationSha256) {
    throw new Error("Independent review does not match the frozen screen and configuration.");
  }
  const tasks = report.configuration.taskContracts.map((task) => task.taskId), arms = ["C", "P"] as const;
  if (tasks.length !== 6 || new Set(tasks).size !== 6 || report.rows.length !== 12 ||
      tasks.some((taskId) => arms.some((arm) => report.rows.filter((row) => row.taskId === taskId && row.arm === arm).length !== 1))) {
    throw new Error("Independent review requires the complete frozen assignment denominator.");
  }
  const key = (row: { taskId: string; arm: string }) => `${row.taskId}\0${row.arm}`;
  const expected = new Map(report.rows.map((row) => [key(row), row]));
  const reviews = new Map<string, RoutingIndependentReview["reviews"][number]>();
  for (const row of receipt.reviews) {
    const target = expected.get(key(row));
    if (!target || reviews.has(key(row)) || row.runId !== target.runId || row.patchSha256 !== target.patchSha256 ||
        (row.status !== "incomplete" && !target.submitted)) {
      throw new Error("Independent review contains duplicate, foreign or mismatched patch attribution.");
    }
    reviews.set(key(row), row);
  }
  const comparisons = new Map<string, RoutingIndependentReview["comparisons"][number]>();
  for (const pair of receipt.comparisons) {
    if (!tasks.includes(pair.taskId) || comparisons.has(pair.taskId)) throw new Error("Paired review contains a duplicate or foreign task.");
    for (const arm of arms) {
      const target = expected.get(key({ taskId: pair.taskId, arm }))!;
      if (pair[arm].runId !== target.runId || pair[arm].patchSha256 !== target.patchSha256 ||
          (pair.additionalMaterialRegression !== null && (!target.submitted || !reviews.has(key(target)) || reviews.get(key(target))!.status === "incomplete"))) {
        throw new Error("Paired review must bind both exact submitted patches and their completed independent reviews.");
      }
    }
    comparisons.set(pair.taskId, pair);
  }
  const rows = report.rows.map((row) => {
    const assessment = reviews.get(key(row)), status = assessment?.status ?? "incomplete";
    return { ...row, blindReview: status,
      acceptable: status === "incomplete" ? null : Boolean(status === "accepted" && row.checkedCandidate && !row.diagnosticEvaluation) };
  });
  const joinedArms = { ...report.arms };
  for (const arm of arms) {
    const assigned = rows.filter((row) => row.arm === arm), base = report.arms[arm]!;
    const accepted = assigned.filter((row) => row.acceptable === true).length;
    const spent = assigned.reduce((total, row) => total + row.spentMicrousd, 0), unresolved = assigned.reduce((total, row) => total + row.unresolvedMicrousd, 0);
    const maximumExposure = spent + unresolved;
    const latency = assigned.flatMap((row) => row.terminal && row.elapsedMs !== null && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 ? [row.elapsedMs] : []).sort((a, b) => a - b);
    const latencyComplete = latency.length === 6;
    joinedArms[arm] = { ...base, blindReviewed: assigned.filter((row) => row.blindReview !== "incomplete").length,
      acceptable: accepted, spentMicrousd: spent, unresolvedMicrousd: unresolved, maximumExposureMicrousd: maximumExposure,
      terminal: assigned.filter((row) => row.terminal).length, elapsedSamples: latency.length, latencyComplete,
      medianElapsedMs: latencyComplete ? (latency[2]! + latency[3]!) / 2 : null,
      costPerAcceptableMicrousd: accepted ? maximumExposure / accepted : null };
  }
  const resolvedPairs = [...comparisons.values()].filter((pair) => pair.additionalMaterialRegression !== null);
  const completedReviews = rows.filter((row) => row.blindReview !== "incomplete").length;
  const completeReview = completedReviews === 12 && resolvedPairs.length === 6;
  const additionalMaterialRegression = resolvedPairs.some((pair) => pair.additionalMaterialRegression === true) ? true : resolvedPairs.length === 6 ? false : null;
  const summary: RoutingReviewSummary = { status: completeReview ? "complete" : "incomplete", receiptSha256: digest(canonicalRequest(receipt)),
    completedReviews, requiredReviews: 12, completedComparisons: resolvedPairs.length, requiredComparisons: 6 };
  const C = joinedArms.C!, P = joinedArms.P!, reasons: string[] = [];
  if (!report.complete || rows.some((row) => !row.terminal || !row.evaluationRecorded)) reasons.push("incomplete_assignments_or_early_stop");
  if (rows.some((row) => row.unknownRequests > 0 || row.unresolvedRequests > 0 || row.unresolvedMicrousd > 0)) reasons.push("unresolved_provider_outcomes");
  if (rows.some((row) => row.cleanupConfirmed !== true)) reasons.push("cleanup_unconfirmed");
  if (rows.some((row) => row.evaluationError || row.runtimeInfrastructureFailure || !row.evaluated)) reasons.push("infrastructure_or_missing_evaluation");
  if (!completeReview) reasons.push("independent_or_paired_review_incomplete");
  if (additionalMaterialRegression === true) reasons.push("additional_p_material_regression");
  if (P.acceptable! < C.acceptable!) reasons.push("fewer_p_acceptable_patches");
  const cCost = C.costPerAcceptableMicrousd, pCost = P.costPerAcceptableMicrousd;
  const saving = cCost !== null && cCost > 0 && pCost !== null ? 1 - pCost / cCost : null;
  if (saving === null) reasons.push("acceptable_cost_denominator_unavailable");
  else if (P.maximumExposureMicrousd * C.acceptable! * 5 > C.maximumExposureMicrousd * P.acceptable! * 4) reasons.push("api_saving_below_twenty_percent");
  const latencyComplete = arms.every((arm) => joinedArms[arm]!.latencyComplete === true && joinedArms[arm]!.elapsedSamples === 6 && joinedArms[arm]!.terminal === 6);
  const latencyRatio = latencyComplete && C.medianElapsedMs !== null && C.medianElapsedMs > 0 && P.medianElapsedMs !== null ? P.medianElapsedMs / C.medianElapsedMs : null;
  if (latencyRatio === null) reasons.push("complete_terminal_latency_unavailable");
  else if (P.medianElapsedMs! * 4 > C.medianElapsedMs! * 5) reasons.push("median_latency_above_twenty_five_percent");
  const advancement: RoutingAdvancementGate = { status: reasons.length ? "blocked" : "eligible_for_confirmation", eligible: reasons.length === 0,
    reasons, additionalMaterialRegression, apiCostPerAcceptableSavingFraction: saving, medianLatencyRatio: latencyRatio };
  return { ...report, rows, arms: joinedArms, review: summary, advancement,
    limitations: report.limitations.filter((text) => !text.startsWith("Blind review is pending;")).concat([
      "Independent review evidence hashes identify caller-supplied source reviews and paired judgments; this pure join does not authenticate reviewers or establish review blindness.",
      "Passing this development gate may open untouched confirmation only; it does not authorize dispatch, establish generalization or prove device payback."]) };
}
