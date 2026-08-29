import {
  assertChangeSnapshotIdentity,
  assertReviewCoverageV1,
  assertReviewEvidenceSetIdentity,
} from "./change-acquisition-contracts";
import {
  assertReviewResultV1Accepted,
  parseRawReviewResultV1,
  type ReviewResultV1,
} from "../shared/review-result-contract";

export interface HostReviewResultAcceptanceInput {
  snapshot: unknown;
  evidenceSet: unknown;
  coverage: unknown;
  packetRetainedEvidenceSet: boolean;
  snapshotRevalidated: boolean;
}

/**
 * Main-process acceptance binds the result to cryptographically verified
 * immutable records and recomputes host coverage before semantic admission.
 */
export function assertHostAcceptedReviewResultV1(
  resultInput: unknown,
  input: HostReviewResultAcceptanceInput,
): ReviewResultV1 {
  const snapshot = assertChangeSnapshotIdentity(input.snapshot);
  const evidenceSet = assertReviewEvidenceSetIdentity(
    input.evidenceSet,
    snapshot,
  );
  const coverage = assertReviewCoverageV1({
    coverage: input.coverage,
    snapshot,
    evidenceSet,
    packetRetainedEvidenceSet: input.packetRetainedEvidenceSet,
    snapshotRevalidated: input.snapshotRevalidated,
  });
  return assertReviewResultV1Accepted(resultInput, {
    snapshot,
    evidenceSet,
    coverage,
  });
}

export function parseAndHostAcceptRawReviewResultV1(
  rawContent: string,
  input: HostReviewResultAcceptanceInput,
): ReviewResultV1 {
  return assertHostAcceptedReviewResultV1(
    parseRawReviewResultV1(rawContent),
    input,
  );
}
