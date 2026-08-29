import { describe, expect, it } from "vitest";

import {
  REVIEW_RISK_ROUTING_SIGNAL_NAME_MAP,
  toCheckpointRouterRiskV0,
} from "../../src/main/routing/review-risk-router-input";
import {
  REVIEW_RISK_POLICY_ID,
  REVIEW_RISK_THRESHOLD,
  ReviewRiskResultV1Schema,
  scoreCompleteReviewRiskFactsV1,
  type ReviewRiskFactsV1,
  type ReviewRiskResultV1,
} from "../../src/shared/review-risk";

const SNAPSHOT_ID = "a".repeat(64);

function completeResult(facts: ReviewRiskFactsV1): ReviewRiskResultV1 {
  const scored = scoreCompleteReviewRiskFactsV1(facts);
  return ReviewRiskResultV1Schema.parse({
    schemaVersion: "review-risk-result-v1",
    policyId: REVIEW_RISK_POLICY_ID,
    snapshotId: SNAPSHOT_ID,
    complete: true,
    threshold: REVIEW_RISK_THRESHOLD,
    score: scored.score,
    classification: scored.classification,
    signals: scored.signals,
    facts,
    incompleteReasons: [],
  });
}

function incompleteResult(reasons: string[]): ReviewRiskResultV1 {
  return ReviewRiskResultV1Schema.parse({
    schemaVersion: "review-risk-result-v1",
    policyId: REVIEW_RISK_POLICY_ID,
    snapshotId: SNAPSHOT_ID,
    complete: false,
    threshold: REVIEW_RISK_THRESHOLD,
    score: null,
    classification: "incomplete",
    signals: [],
    facts: {
      changedPathCount: 1,
      changedLineCount: 0,
      surfaces: [],
      sensitivePaths: [],
      runtimePaths: [],
      relevantTestPaths: [],
    },
    incompleteReasons: reasons,
  });
}

describe("review-risk-v1 router adapter", () => {
  it("maps complete PR 3 facts and signals into canonical persisted router names", () => {
    const result = completeResult({
      changedPathCount: 8,
      changedLineCount: 300,
      surfaces: ["main", "renderer", "test"],
      sensitivePaths: ["src/main/providers/adapter.ts"],
      runtimePaths: ["src/main/providers/adapter.ts"],
      relevantTestPaths: [],
    });

    const adapted = toCheckpointRouterRiskV0(result);

    expect(REVIEW_RISK_ROUTING_SIGNAL_NAME_MAP).toEqual({
      changed_files_ge_8: "changed_file_count",
      changed_lines_ge_300: "changed_line_count",
      crosses_three_surfaces: "changed_surface_count",
      runtime_without_relevant_test: "runtime_without_relevant_test",
      touches_sensitive_path: "sensitive_subsystem",
    });
    expect(adapted).toEqual({
      policyId: "review-risk-v1",
      snapshotId: SNAPSHOT_ID,
      classification: "high_risk",
      score: 8,
      signals: [
        {
          name: "changed_file_count",
          value: 8,
          weight: 1,
          contribution: 1,
        },
        {
          name: "changed_line_count",
          value: 300,
          weight: 1,
          contribution: 1,
        },
        {
          name: "changed_surface_count",
          value: 3,
          weight: 2,
          contribution: 2,
        },
        {
          name: "runtime_without_relevant_test",
          value: true,
          weight: 2,
          contribution: 2,
        },
        {
          name: "sensitive_subsystem",
          value: true,
          weight: 2,
          contribution: 2,
        },
      ],
      triggerFacts: [
        { key: "risk_classification", value: "high_risk" },
        { key: "risk_snapshot_id", value: SNAPSHOT_ID },
      ],
    });
  });

  it("keeps low risk scored rather than conflating it with incomplete risk", () => {
    const adapted = toCheckpointRouterRiskV0(
      completeResult({
        changedPathCount: 1,
        changedLineCount: 5,
        surfaces: ["test"],
        sensitivePaths: [],
        runtimePaths: [],
        relevantTestPaths: ["tests/example.test.ts"],
      }),
    );

    expect(adapted).toMatchObject({
      classification: "low_risk",
      score: 0,
      signals: expect.arrayContaining([
        {
          name: "runtime_without_relevant_test",
          value: false,
          weight: 2,
          contribution: 0,
        },
      ]),
    });
    expect(adapted.incompleteReason).toBeUndefined();
  });

  it("hashes canonical incomplete reasons without persisting source paths", () => {
    const first = toCheckpointRouterRiskV0(
      incompleteResult([
        "manifest:truncated",
        "assets/image.png:binary",
      ]),
    );
    const second = toCheckpointRouterRiskV0(
      incompleteResult([
        "assets/image.png:binary",
        "manifest:truncated",
      ]),
    );
    const digest =
      "d53617853df56d1b0f44fc62f6c94fa0810ae2ede3ccdb60bd747566ba57bba4";

    expect(second).toEqual(first);
    expect(first).toEqual({
      policyId: "review-risk-v1",
      snapshotId: SNAPSHOT_ID,
      classification: "incomplete",
      signals: [],
      incompleteReason: `review-risk-v1-incomplete:2:${digest}`,
      triggerFacts: [
        { key: "risk_classification", value: "incomplete" },
        { key: "risk_incomplete_count", value: 2 },
        { key: "risk_incomplete_sha256", value: digest },
        { key: "risk_snapshot_id", value: SNAPSHOT_ID },
      ],
    });
    expect(JSON.stringify(first)).not.toContain("assets/image.png");
    expect(JSON.stringify(first)).not.toContain("manifest:truncated");
  });

  it("rejects malformed or forged PR 3 results at the adapter boundary", () => {
    const valid = completeResult({
      changedPathCount: 1,
      changedLineCount: 0,
      surfaces: [],
      sensitivePaths: [],
      runtimePaths: [],
      relevantTestPaths: [],
    });
    const forged = structuredClone(valid);
    forged.score = 7;
    forged.classification = "high_risk";

    expect(() => toCheckpointRouterRiskV0(forged)).toThrow();
  });
});
