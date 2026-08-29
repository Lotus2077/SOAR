import { describe, expect, it } from "vitest";

import {
  ReviewContextBudgetError,
  compileReviewContextV1,
} from "../../src/main/review-context-compiler-v1";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import {
  providerMessagesSha256,
  sha256Hex,
} from "../../src/shared/context-compiler";
import { canonicalChangeJson } from "../../src/main/change-acquisition-contracts";
import { reviewFixtureEvents } from "../helpers/review-event-fixture";

function compile(maxInputTokens = 1_000_000, maxPacketBytes = 1_000_000) {
  return compileReviewContextV1({
    objective: "Review the current changes for concrete defects.",
    verifiedEvidence: deriveVerifiedReviewEvidenceV1(reviewFixtureEvents()),
    systemPrompt: "Follow the SOAR change-review policy.",
    maxInputTokens,
    maxPacketBytes,
    reservedInputTokens: 500,
    safetyMargin: 0.1,
  });
}

describe("review-context-compiler-v1", () => {
  it("builds one deterministic tool-free packet with exact evidence identities", () => {
    const first = compile();
    const second = compile();

    expect(second).toEqual(first);
    expect(first.packet.schemaVersion).toBe("review-synthesis-packet-v1");
    expect(first.packet.snapshot.snapshotId).toBe(
      first.telemetry.snapshotId,
    );
    expect(first.packet.evidenceSet.evidenceSetId).toBe(
      first.telemetry.evidenceSetId,
    );
    expect(first.packet.provenanceSha256).toBe(
      first.telemetry.provenanceSha256,
    );
    expect(first.packet.evidenceBodies).toHaveLength(
      first.telemetry.evidenceBodyCount,
    );
    expect(first.telemetry.omittedEvidenceBodyCount).toBe(0);
    expect(first.telemetry.truncatedEvidenceBodyCount).toBe(0);
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0]).toMatchObject({ role: "system" });
    expect(first.messages[1]).toMatchObject({ role: "user" });
    expect(first.messages[1]?.content).toContain(
      "SOAR_REVIEW_SYNTHESIS_PACKET_V1\n",
    );
    expect(first.messages[1]?.content).toContain(
      canonicalChangeJson(first.packet),
    );
    expect(first.telemetry.messagesSha256).toBe(
      providerMessagesSha256(first.messages),
    );
    expect(first.telemetry.packetSha256).toBe(
      sha256Hex(canonicalChangeJson(first.packet)),
    );
    expect(Object.isFrozen(first.packet)).toBe(true);
    expect(Object.isFrozen(first.packet.evidenceBodies)).toBe(true);
  });

  it("fails closed on the byte budget without omitting or shortening evidence", () => {
    let error: unknown;
    try {
      compile(1_000_000, 64);
    } catch (candidate) {
      error = candidate;
    }
    expect(error).toBeInstanceOf(ReviewContextBudgetError);
    expect(error).toMatchObject({
      code: "REVIEW_CONTEXT_BUDGET_EXCEEDED",
      details: {
        byteBudgetExceeded: true,
        tokenBudgetExceeded: false,
        maxPacketBytes: 64,
      },
    });
  });

  it("fails closed on the effective token budget including reserve and margin", () => {
    let error: unknown;
    try {
      compileReviewContextV1({
        objective: "Review the current changes for concrete defects.",
        verifiedEvidence: deriveVerifiedReviewEvidenceV1(reviewFixtureEvents()),
        systemPrompt: "Follow the SOAR change-review policy.",
        maxInputTokens: 2_000,
        maxPacketBytes: 1_000_000,
        reservedInputTokens: 1_000,
        safetyMargin: 0.25,
      });
    } catch (candidate) {
      error = candidate;
    }
    expect(error).toBeInstanceOf(ReviewContextBudgetError);
    expect(error).toMatchObject({
      details: {
        effectiveInputTokenBudget: 500,
        tokenBudgetExceeded: true,
      },
    });
  });

  it("revalidates provenance before compilation", () => {
    const evidence = deriveVerifiedReviewEvidenceV1(reviewFixtureEvents());
    evidence.provenance.provenanceSha256 = "0".repeat(64);

    expect(() =>
      compileReviewContextV1({
        objective: "Review the current changes.",
        verifiedEvidence: evidence,
        systemPrompt: "Follow the SOAR change-review policy.",
        maxInputTokens: 1_000_000,
      }),
    ).toThrow(/provenance hash/u);
  });
});
