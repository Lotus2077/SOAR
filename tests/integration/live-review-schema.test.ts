import { describe, expect, it } from "vitest";

import {
  buildChangeSnapshotV1,
  canonicalizeReviewEvidenceSetV1,
  deriveReviewCoverageV1,
} from "../../src/main/change-acquisition-contracts";
import { loadConfig } from "../../src/main/config";
import { createLocalVllmProvider } from "../../src/main/providers/runtime-catalog";
import { assertHostAcceptedReviewResultV1 } from "../../src/main/review-result-acceptance";
import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  parseRawReviewResultV1,
} from "../../src/shared/review-result-contract";

const runLive = process.env.SOAR_RUN_LIVE_REVIEW_SCHEMA === "true";

describe.skipIf(!runLive)("live local review JSON Schema canary", () => {
  it("returns one host-acceptable ReviewResultV1 from the configured local model", async () => {
    const config = loadConfig();
    const provider = createLocalVllmProvider(config);
    const controller = new AbortController();
    const availability = await provider.checkConfiguredModelAvailability(
      controller.signal,
    );
    expect(availability).toMatchObject({
      providerId: provider.id,
      model: provider.model,
      locality: "local",
      status: "healthy",
      code: "configured_model_available",
    });

    const snapshot = buildChangeSnapshotV1({
      schemaVersion: "change-snapshot-v1",
      baseCommitOid: "a".repeat(40),
      indexSha256: "b".repeat(64),
      discoverySha256: "c".repeat(64),
      manifest: [],
      omittedPathCount: 0,
      omittedHunkCount: 0,
      manifestOmissionCodes: [],
    });
    const evidenceSet = canonicalizeReviewEvidenceSetV1({
      schemaVersion: "review-evidence-set-v1",
      snapshotId: snapshot.snapshotId,
      changeHunkSha256s: [],
      completeBodies: [],
      repositoryObservations: [],
    });
    const coverage = deriveReviewCoverageV1({
      snapshot,
      evidenceSet,
      packetRetainedEvidenceSet: true,
      snapshotRevalidated: true,
    });
    const expected = {
      schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      snapshotId: snapshot.snapshotId,
      summary:
        "The supplied host snapshot is empty, complete, and contains no blocking findings.",
      conclusion: "no_blocking_findings",
      evidenceSetId: evidenceSet.evidenceSetId,
      omissions: [],
      findings: [],
    } as const;
    const rawDeltas: string[] = [];
    const result = await provider.complete({
      messages: [
        {
          role: "system",
          content:
            "Return only the configured structured response. Copy every field from the supplied expected object exactly.",
        },
        {
          role: "user",
          content: JSON.stringify({ expected }),
        },
      ],
      signal: controller.signal,
      requestedMaxOutputTokens: Math.min(1_024, config.vllm.maxOutputTokens),
      allowTools: false,
      structuredOutputContract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      onDelta: (delta) => rawDeltas.push(delta),
    });

    expect(result.servedModel).toBe(provider.model);
    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
    expect(rawDeltas.join("")).toBe(result.content);
    const accepted = assertHostAcceptedReviewResultV1(
      parseRawReviewResultV1(result.content),
      {
        snapshot,
        evidenceSet,
        coverage,
        packetRetainedEvidenceSet: true,
        snapshotRevalidated: true,
      },
    );
    expect(accepted).toMatchObject({
      schemaVersion: expected.schemaVersion,
      snapshotId: expected.snapshotId,
      conclusion: expected.conclusion,
      evidenceSetId: expected.evidenceSetId,
      omissions: expected.omissions,
      findings: expected.findings,
    });
    expect(accepted.summary.trim().length).toBeGreaterThan(0);
    console.info(
      "SOAR_LIVE_REVIEW_SCHEMA_ATTESTATION",
      JSON.stringify({
        providerId: provider.id,
        model: result.servedModel,
        availabilityCode: availability.code,
        finishReason: result.finishReason,
        usage: result.usage,
        durationMs: result.durationMs,
        contentBytes: Buffer.byteLength(result.content, "utf8"),
        costPolicy: provider.costPolicy,
        costUsd: result.costUsd ?? 0,
      }),
    );
  });
});
