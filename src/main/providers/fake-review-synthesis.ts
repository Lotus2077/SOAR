import { deriveReviewCoverageV1 } from "../change-acquisition-contracts";
import {
  REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
  ReviewResultV1Schema,
} from "../../shared/review-result-contract";
import {
  ReviewSynthesisPacketV1Schema,
  type ReviewSynthesisPacketV1,
} from "../../shared/review-synthesis-packet";
import type { ProviderMessage } from "./types";

const REVIEW_SYNTHESIS_PACKET_PREFIX =
  "SOAR_REVIEW_SYNTHESIS_PACKET_V1\n";

export function extractFakeReviewSynthesisPacketV1(
  messages: readonly ProviderMessage[],
): ReviewSynthesisPacketV1 {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role !== "user" ||
      !message.content.startsWith(REVIEW_SYNTHESIS_PACKET_PREFIX)
    ) {
      continue;
    }
    return ReviewSynthesisPacketV1Schema.parse(
      JSON.parse(message.content.slice(REVIEW_SYNTHESIS_PACKET_PREFIX.length)),
    );
  }
  throw new TypeError(
    "The fake change-review provider requires one review synthesis packet.",
  );
}

/**
 * Pure deterministic fixture synthesis shared by the fake Local and fake Cloud
 * providers. The production host still owns schema validation, semantic
 * acceptance, and post-response workspace revalidation.
 */
export function deterministicFakeReviewResultV1(
  packet: ReviewSynthesisPacketV1,
): string {
  const coverage = deriveReviewCoverageV1({
    snapshot: packet.snapshot,
    evidenceSet: packet.evidenceSet,
    packetRetainedEvidenceSet: true,
    snapshotRevalidated: true,
  });
  const complete = coverage.status === "complete";
  return JSON.stringify(
    ReviewResultV1Schema.parse({
      schemaVersion: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
      snapshotId: packet.snapshot.snapshotId,
      summary: complete
        ? "No blocking findings were produced from the admitted deterministic test evidence."
        : "The deterministic test review is incomplete because the admitted evidence does not satisfy every coverage gate.",
      conclusion: complete ? "no_blocking_findings" : "incomplete",
      evidenceSetId: packet.evidenceSet.evidenceSetId,
      omissions: complete
        ? []
        : [
            {
              code: "fake_incomplete_evidence",
              description:
                "One or more host-derived evidence coverage gates are incomplete.",
            },
          ],
      findings: [],
    }),
  );
}
