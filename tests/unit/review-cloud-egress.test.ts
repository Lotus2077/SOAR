import { describe, expect, it } from "vitest";

import {
  evaluateCloudEgressPolicyV1,
} from "../../src/main/cloud-egress-policy";
import { compileReviewContextV1 } from "../../src/main/review-context-compiler-v1";
import { buildReviewCloudEgressProvenanceV1 } from "../../src/main/review-cloud-egress";
import { deriveVerifiedReviewEvidenceV1 } from "../../src/main/review-event-provenance";
import { HYBRID_SIMULATION_CONSENT_ID } from "../../src/shared/hybrid-simulation-contracts";
import { reviewFixtureEvents } from "../helpers/review-event-fixture";

function compiled(objective = "Review these changes 🧪 for concrete defects.") {
  return compileReviewContextV1({
    objective,
    verifiedEvidence: deriveVerifiedReviewEvidenceV1(reviewFixtureEvents()),
    systemPrompt: "Follow the deterministic test review policy.",
    maxInputTokens: 1_000_000,
  });
}

function boundary(knownSecretValues: readonly string[] = []) {
  return {
    canonicalWorkspaceRoot: "/tmp/soar-review-workspace",
    canonicalHomeRoot: "/Users/soar-review-user",
    knownSecretValues,
  };
}

describe("ReviewResultV1 cloud egress provenance", () => {
  it("partitions exact UTF-16 messages into host, user, and admitted workspace sources", () => {
    const context = compiled();
    const provenance = buildReviewCloudEgressProvenanceV1({
      compiled: context,
      simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    });

    expect(provenance.overflowed).toBe(false);
    for (const [messageIndex, message] of context.messages.entries()) {
      if (message.role !== "system" && message.role !== "user") {
        throw new Error("review compiler emitted an unexpected message role");
      }
      const entries = provenance.manifest.entries
        .filter((entry) => entry.messageIndex === messageIndex)
        .sort((left, right) => left.contentStartUtf16 - right.contentStartUtf16);
      expect(entries[0]?.contentStartUtf16).toBe(0);
      expect(entries.at(-1)?.contentEndUtf16).toBe(message.content.length);
      entries.slice(1).forEach((entry, index) => {
        expect(entry.contentStartUtf16).toBe(entries[index]?.contentEndUtf16);
      });
    }
    expect(
      provenance.manifest.entries.some(
        (entry) => entry.sourceKind === "user",
      ),
    ).toBe(true);
    expect(
      provenance.manifest.entries.some(
        (entry) =>
          entry.sourceKind === "workspace" &&
          entry.pathAdmission === "admitted",
      ),
    ).toBe(true);

    const result = evaluateCloudEgressPolicyV1({
      messages: context.messages,
      provenance: provenance.manifest,
      hostBoundary: boundary(),
      requestPolicy: { toolDefinitions: "none" },
    });
    expect(result).toMatchObject({ decision: "pass", reasonCodes: [] });
    expect(result.messagesSemanticSha256).toBe(
      context.telemetry.messagesSha256,
    );
  });

  it("does not grant egress without the exact simulation consent identity", () => {
    const context = compiled();
    const provenance = buildReviewCloudEgressProvenanceV1({ compiled: context });
    expect(
      evaluateCloudEgressPolicyV1({
        messages: context.messages,
        provenance: provenance.manifest,
        hostBoundary: boundary(),
        requestPolicy: { toolDefinitions: "none" },
      }),
    ).toMatchObject({
      decision: "deny",
      reasonCodes: ["egress_consent_missing"],
    });
  });

  it("detects message drift and main-owned sensitive values without persisting them", () => {
    const secret = "main-only-sensitive-test-value";
    const context = compiled(`Review changes without exposing ${secret}.`);
    const provenance = buildReviewCloudEgressProvenanceV1({
      compiled: context,
      simulationConsent: HYBRID_SIMULATION_CONSENT_ID,
    });
    const sensitive = evaluateCloudEgressPolicyV1({
      messages: context.messages,
      provenance: provenance.manifest,
      hostBoundary: boundary([secret]),
      requestPolicy: { toolDefinitions: "none" },
    });
    expect(sensitive.decision).toBe("deny");
    expect(sensitive.reasonCodes).toContain("known_secret_value");

    const drifted = context.messages.map((message, index) =>
      index === 1 ? { ...message, content: `${message.content} ` } : message,
    );
    const drift = evaluateCloudEgressPolicyV1({
      messages: drifted,
      provenance: provenance.manifest,
      hostBoundary: boundary(),
      requestPolicy: { toolDefinitions: "none" },
    });
    expect(drift.decision).toBe("deny");
    expect(drift.reasonCodes).toContain("provenance_incomplete");
  });
});
