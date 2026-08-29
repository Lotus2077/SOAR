import { assertChangeSnapshotIdentity } from "./change-acquisition-contracts";
import {
  extractReviewRiskV1,
  type ReviewRiskResultV1,
} from "../shared/review-risk";
import {
  deriveCalibrationSourceDiffFromSnapshotShapeV1,
  type CalibrationSourceDiffFileV1,
} from "../shared/review-risk-evaluation";

/**
 * Host boundary for risk extraction. Shared scoring is intentionally pure, so
 * callers that make routing decisions must verify the immutable snapshot first.
 */
export function extractVerifiedReviewRiskV1(input: unknown): ReviewRiskResultV1 {
  return extractReviewRiskV1(assertChangeSnapshotIdentity(input));
}

/** Host identity boundary for frozen per-file hunk facts. */
export function deriveVerifiedCalibrationSourceDiffV1(
  input: unknown,
): CalibrationSourceDiffFileV1[] {
  return deriveCalibrationSourceDiffFromSnapshotShapeV1(
    assertChangeSnapshotIdentity(input),
  );
}
