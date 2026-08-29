import { z } from "zod";

import {
  ChangeContractIdSchema,
  ChangePathSchema,
  ChangeSnapshotV1Schema,
  ReviewEvidenceSetV1Schema,
  Sha256Schema,
} from "./change-review-contracts";

export const REVIEW_SYNTHESIS_PACKET_LIMITS = {
  maxObjectiveCharacters: 16_384,
  maxEvidenceBodyCharacters: 256 * 1024,
  maxEvidenceBodies: 1_400,
  maxToolResults: 1_404,
} as const;

export const ReviewToolResultProvenanceV1Schema = z
  .object({
    requestEventId: ChangeContractIdSchema,
    completionEventId: ChangeContractIdSchema,
    toolCallId: ChangeContractIdSchema,
    attemptId: ChangeContractIdSchema,
    messageId: ChangeContractIdSchema,
    toolName: z.enum([
      "inspect_git_changes",
      "read_text_file",
      "search_text",
    ]),
    requestSequence: z.number().int().positive().safe(),
    completionSequence: z.number().int().positive().safe(),
    argumentsSha256: Sha256Schema,
    resultSha256: Sha256Schema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.completionSequence <= record.requestSequence) {
      context.addIssue({
        code: "custom",
        message: "Tool completion must follow its request.",
        path: ["completionSequence"],
      });
    }
  });

export type ReviewToolResultProvenanceV1 = z.infer<
  typeof ReviewToolResultProvenanceV1Schema
>;

const evidenceBodyBase = {
  observationId: ChangeContractIdSchema,
  path: ChangePathSchema,
  contentSha256: Sha256Schema,
  text: z
    .string()
    .max(REVIEW_SYNTHESIS_PACKET_LIMITS.maxEvidenceBodyCharacters),
} as const;

export const ReviewChangeBodyV1Schema = z
  .object({
    kind: z.literal("change_body"),
    ...evidenceBodyBase,
    side: z.enum(["base", "working"]),
  })
  .strict();

export const ReviewRepositoryFileBodyV1Schema = z
  .object({
    kind: z.literal("repository_file"),
    ...evidenceBodyBase,
    lineCount: z.number().int().nonnegative().safe(),
  })
  .strict();

export const ReviewRepositoryLineBodyV1Schema = z
  .object({
    kind: z.literal("repository_line"),
    ...evidenceBodyBase,
    line: z.number().int().positive().safe(),
  })
  .strict();

export const ReviewEvidenceBodyV1Schema = z.discriminatedUnion("kind", [
  ReviewChangeBodyV1Schema,
  ReviewRepositoryFileBodyV1Schema,
  ReviewRepositoryLineBodyV1Schema,
]);

export type ReviewEvidenceBodyV1 = z.infer<
  typeof ReviewEvidenceBodyV1Schema
>;

export const ReviewEventProvenanceV1Schema = z
  .object({
    schemaVersion: z.literal("review-event-provenance-v1"),
    sessionId: ChangeContractIdSchema,
    snapshotId: Sha256Schema,
    evidenceSetId: Sha256Schema,
    toolResults: z
      .array(ReviewToolResultProvenanceV1Schema)
      .max(REVIEW_SYNTHESIS_PACKET_LIMITS.maxToolResults),
    provenanceSha256: Sha256Schema,
  })
  .strict();

export type ReviewEventProvenanceV1 = z.infer<
  typeof ReviewEventProvenanceV1Schema
>;

export const VerifiedReviewEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal("verified-review-evidence-v1"),
    sessionId: ChangeContractIdSchema,
    snapshot: ChangeSnapshotV1Schema,
    evidenceSet: ReviewEvidenceSetV1Schema,
    provenance: ReviewEventProvenanceV1Schema,
    evidenceBodies: z
      .array(ReviewEvidenceBodyV1Schema)
      .max(REVIEW_SYNTHESIS_PACKET_LIMITS.maxEvidenceBodies),
  })
  .strict();

export type VerifiedReviewEvidenceV1 = z.infer<
  typeof VerifiedReviewEvidenceV1Schema
>;

/**
 * Exact tool-free synthesis payload. It intentionally contains no mutable
 * session prose, raw provider output, endpoint, credential, or workspace root.
 */
export const ReviewSynthesisPacketV1Schema = z
  .object({
    schemaVersion: z.literal("review-synthesis-packet-v1"),
    objective: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_SYNTHESIS_PACKET_LIMITS.maxObjectiveCharacters),
    snapshot: ChangeSnapshotV1Schema,
    evidenceSet: ReviewEvidenceSetV1Schema,
    provenanceSha256: Sha256Schema,
    evidenceBodies: z
      .array(ReviewEvidenceBodyV1Schema)
      .max(REVIEW_SYNTHESIS_PACKET_LIMITS.maxEvidenceBodies),
  })
  .strict();

export type ReviewSynthesisPacketV1 = z.infer<
  typeof ReviewSynthesisPacketV1Schema
>;
