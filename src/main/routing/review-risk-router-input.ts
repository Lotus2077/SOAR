import { createHash } from "node:crypto";

import {
  REVIEW_RISK_SIGNAL_IDS,
  ReviewRiskResultV1Schema,
  type ReviewRiskResultV1,
  type ReviewRiskSignalId,
} from "../../shared/review-risk";
import {
  RouterRiskV0Schema,
  type RouterRiskV0,
} from "../../shared/checkpoint-router";

export const REVIEW_RISK_ROUTING_SIGNAL_NAME_MAP = {
  changed_files_ge_8: "changed_file_count",
  changed_lines_ge_300: "changed_line_count",
  crosses_three_surfaces: "changed_surface_count",
  runtime_without_relevant_test: "runtime_without_relevant_test",
  touches_sensitive_path: "sensitive_subsystem",
} as const satisfies Record<ReviewRiskSignalId, RouterRiskV0["signals"][number]["name"]>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalIncompleteReasons(result: ReviewRiskResultV1): string[] {
  return [...new Set(result.incompleteReasons)].sort(compareText);
}

function incompleteReasonDigest(reasons: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(reasons)).digest("hex");
}

/**
 * Convert the verified PR 3 review-risk record into the bounded, source-free
 * input consumed by checkpoint-router-v0. This adapter performs no discovery
 * and intentionally hashes incomplete reasons instead of copying paths or
 * acquisition details into a routing event.
 */
export function toCheckpointRouterRiskV0(
  input: ReviewRiskResultV1,
): RouterRiskV0 {
  const risk = ReviewRiskResultV1Schema.parse(input);

  if (!risk.complete) {
    const reasons = canonicalIncompleteReasons(risk);
    const digest = incompleteReasonDigest(reasons);
    return RouterRiskV0Schema.parse({
      policyId: risk.policyId,
      snapshotId: risk.snapshotId,
      classification: "incomplete",
      signals: [],
      incompleteReason: `review-risk-v1-incomplete:${reasons.length}:${digest}`,
      triggerFacts: [
        { key: "risk_classification", value: "incomplete" },
        { key: "risk_incomplete_count", value: reasons.length },
        { key: "risk_incomplete_sha256", value: digest },
        { key: "risk_snapshot_id", value: risk.snapshotId },
      ],
    });
  }

  const signalsById = new Map(
    risk.signals.map((signal) => [signal.id, signal] as const),
  );
  const facts = risk.facts;
  const routerValues = {
    changed_files_ge_8: facts.changedPathCount,
    changed_lines_ge_300: facts.changedLineCount,
    crosses_three_surfaces: facts.surfaces.length,
    runtime_without_relevant_test:
      signalsById.get("runtime_without_relevant_test")?.triggered ?? false,
    touches_sensitive_path:
      signalsById.get("touches_sensitive_path")?.triggered ?? false,
  } as const;

  const signals = REVIEW_RISK_SIGNAL_IDS.map((id) => {
    const signal = signalsById.get(id);
    if (signal === undefined) {
      throw new Error(`verified review risk is missing canonical signal ${id}`);
    }
    return {
      name: REVIEW_RISK_ROUTING_SIGNAL_NAME_MAP[id],
      value: routerValues[id],
      weight: signal.weight,
      contribution: signal.contribution,
    };
  }).sort((left, right) => compareText(left.name, right.name));

  return RouterRiskV0Schema.parse({
    policyId: risk.policyId,
    snapshotId: risk.snapshotId,
    classification: risk.classification,
    score: risk.score,
    signals,
    triggerFacts: [
      { key: "risk_classification", value: risk.classification },
      { key: "risk_snapshot_id", value: risk.snapshotId },
    ],
  });
}
