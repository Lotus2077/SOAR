import { z } from "zod";

import {
  CHANGE_KINDS,
  CHANGE_REVIEW_CONTRACT_LIMITS,
  ChangeContractIdSchema,
  ChangeSnapshotV1Schema,
  ReviewCoverageV1Schema,
  ReviewEvidenceRefSchema,
  ReviewEvidenceSetV1Schema,
  Sha256Schema,
  assertReviewEvidenceRefShapeAdmitted,
  type ChangeSnapshotV1,
  type ReviewCoverageV1,
  type ReviewEvidenceRef,
  type ReviewEvidenceSetV1,
} from "./change-review-contracts";

export const REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT =
  "change-review-result-v1" as const;
export const REVIEW_RESULT_V1_JSON_SCHEMA_NAME =
  "change_review_result_v1" as const;

export const REVIEW_RESULT_V1_LIMITS = {
  maxRawOutputBytes: 256 * 1024,
  maxSerializedRecordBytes: 256 * 1024,
  maxSummaryCharacters: 8_192,
  maxOmissions: 32,
  maxOmissionCodeCharacters: 128,
  maxOmissionDescriptionCharacters: 2_048,
  maxFindings: 64,
  maxFindingIdCharacters: 128,
  maxTitleCharacters: 512,
  maxImpactCharacters: 4_096,
  maxSuggestedCorrectionCharacters: 4_096,
  maxSuggestedTestCharacters: 4_096,
  maxEvidencePerFinding: 32,
} as const;

const utf8Encoder = new TextEncoder();

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const boundedNonBlank = (maximum: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) => value.trim() === value && value.trim().length > 0,
      "Expected a bounded non-blank string without surrounding whitespace.",
    );

export const REVIEW_FINDING_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export const ReviewFindingSeverityV1Schema = z.enum(
  REVIEW_FINDING_SEVERITIES,
);
export type ReviewFindingSeverityV1 = z.infer<
  typeof ReviewFindingSeverityV1Schema
>;

export const REVIEW_CONCLUSIONS = [
  "blocking_findings",
  "no_blocking_findings",
  "incomplete",
] as const;
export const ReviewConclusionV1Schema = z.enum(REVIEW_CONCLUSIONS);
export type ReviewConclusionV1 = z.infer<typeof ReviewConclusionV1Schema>;

export const ReviewOmissionV1Schema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(REVIEW_RESULT_V1_LIMITS.maxOmissionCodeCharacters)
      .regex(/^[a-z0-9][a-z0-9._-]*$/u),
    description: boundedNonBlank(
      REVIEW_RESULT_V1_LIMITS.maxOmissionDescriptionCharacters,
    ),
  })
  .strict();

export type ReviewOmissionV1 = z.infer<typeof ReviewOmissionV1Schema>;

export const ReviewFindingV1Schema = z
  .object({
    findingId: ChangeContractIdSchema,
    severity: ReviewFindingSeverityV1Schema,
    title: boundedNonBlank(REVIEW_RESULT_V1_LIMITS.maxTitleCharacters),
    impact: boundedNonBlank(REVIEW_RESULT_V1_LIMITS.maxImpactCharacters),
    suggestedCorrection: boundedNonBlank(
      REVIEW_RESULT_V1_LIMITS.maxSuggestedCorrectionCharacters,
    ),
    suggestedTest: boundedNonBlank(
      REVIEW_RESULT_V1_LIMITS.maxSuggestedTestCharacters,
    ),
    evidence: z
      .array(ReviewEvidenceRefSchema)
      .min(1)
      .max(REVIEW_RESULT_V1_LIMITS.maxEvidencePerFinding),
  })
  .strict()
  .superRefine((finding, context) => {
    const referenceKeys = new Set<string>();
    finding.evidence.forEach((reference, index) => {
      const key = JSON.stringify(reference);
      if (referenceKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index],
          message: "Finding evidence references must be unique.",
        });
      }
      referenceKeys.add(key);
    });
  });

export type ReviewFindingV1 = z.infer<typeof ReviewFindingV1Schema>;

export const ReviewResultV1Schema = z
  .object({
    schemaVersion: z.literal(REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT),
    snapshotId: Sha256Schema,
    summary: boundedNonBlank(REVIEW_RESULT_V1_LIMITS.maxSummaryCharacters),
    conclusion: ReviewConclusionV1Schema,
    evidenceSetId: Sha256Schema,
    omissions: z
      .array(ReviewOmissionV1Schema)
      .max(REVIEW_RESULT_V1_LIMITS.maxOmissions),
    findings: z
      .array(ReviewFindingV1Schema)
      .max(REVIEW_RESULT_V1_LIMITS.maxFindings),
  })
  .strict()
  .superRefine((result, context) => {
    const omissionCodes = new Set<string>();
    result.omissions.forEach((omission, index) => {
      if (omissionCodes.has(omission.code)) {
        context.addIssue({
          code: "custom",
          path: ["omissions", index, "code"],
          message: "Omission codes must be unique.",
        });
      }
      omissionCodes.add(omission.code);
    });

    const findingIds = new Set<string>();
    result.findings.forEach((finding, index) => {
      if (findingIds.has(finding.findingId)) {
        context.addIssue({
          code: "custom",
          path: ["findings", index, "findingId"],
          message: "Finding IDs must be unique.",
        });
      }
      findingIds.add(finding.findingId);
    });

    if (
      utf8Encoder.encode(JSON.stringify(result)).byteLength >
      REVIEW_RESULT_V1_LIMITS.maxSerializedRecordBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "Review result exceeds the serialized contract byte limit.",
      });
    }
  });

export type ReviewResultV1 = z.infer<typeof ReviewResultV1Schema>;

const JSON_SCHEMA_DRAFT_2020_12 =
  "https://json-schema.org/draft/2020-12/schema" as const;
const JSON_SAFE_INTEGER_MAXIMUM = Number.MAX_SAFE_INTEGER;
const SHA256_JSON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 64,
  maxLength: 64,
} as const);
const CHANGE_PATH_JSON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters,
} as const);

const CHANGE_EVIDENCE_REF_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["kind", "snapshotId", "path", "side", "line", "hunkSha256"],
  properties: {
    kind: { const: "change" },
    snapshotId: SHA256_JSON_SCHEMA,
    path: CHANGE_PATH_JSON_SCHEMA,
    side: { type: "string", enum: ["working", "base"] },
    line: { type: "integer", minimum: 1, maximum: JSON_SAFE_INTEGER_MAXIMUM },
    hunkSha256: SHA256_JSON_SCHEMA,
  },
} as const);

const CHANGE_METADATA_EVIDENCE_REF_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["kind", "snapshotId", "path", "changeKind"],
  properties: {
    kind: { const: "change_metadata" },
    snapshotId: SHA256_JSON_SCHEMA,
    path: CHANGE_PATH_JSON_SCHEMA,
    changeKind: {
      type: "string",
      enum: [...CHANGE_KINDS],
    },
  },
} as const);

const REPOSITORY_EVIDENCE_REF_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "snapshotId",
    "evidenceSetId",
    "observationId",
    "path",
    "line",
    "contentSha256",
  ],
  properties: {
    kind: { const: "repository" },
    snapshotId: SHA256_JSON_SCHEMA,
    evidenceSetId: SHA256_JSON_SCHEMA,
    observationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    path: CHANGE_PATH_JSON_SCHEMA,
    line: { type: "integer", minimum: 1, maximum: JSON_SAFE_INTEGER_MAXIMUM },
    contentSha256: SHA256_JSON_SCHEMA,
  },
} as const);

/**
 * The sole schema that may be sent for the change-review-result-v1 contract.
 * Host validation below deliberately owns cross-record semantics which JSON
 * Schema cannot prove (content identities, admitted lines, and coverage).
 */
export const REVIEW_RESULT_V1_JSON_SCHEMA = deepFreeze({
  $schema: JSON_SCHEMA_DRAFT_2020_12,
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "snapshotId",
    "summary",
    "conclusion",
    "evidenceSetId",
    "omissions",
    "findings",
  ],
  properties: {
    schemaVersion: { const: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT },
    snapshotId: SHA256_JSON_SCHEMA,
    summary: {
      type: "string",
      minLength: 1,
      maxLength: REVIEW_RESULT_V1_LIMITS.maxSummaryCharacters,
    },
    conclusion: { type: "string", enum: [...REVIEW_CONCLUSIONS] },
    evidenceSetId: SHA256_JSON_SCHEMA,
    omissions: {
      type: "array",
      maxItems: REVIEW_RESULT_V1_LIMITS.maxOmissions,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "description"],
        properties: {
          code: {
            type: "string",
            minLength: 1,
            maxLength: REVIEW_RESULT_V1_LIMITS.maxOmissionCodeCharacters,
          },
          description: {
            type: "string",
            minLength: 1,
            maxLength:
              REVIEW_RESULT_V1_LIMITS.maxOmissionDescriptionCharacters,
          },
        },
      },
    },
    findings: {
      type: "array",
      maxItems: REVIEW_RESULT_V1_LIMITS.maxFindings,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "findingId",
          "severity",
          "title",
          "impact",
          "suggestedCorrection",
          "suggestedTest",
          "evidence",
        ],
        properties: {
          findingId: {
            type: "string",
            minLength: 1,
            maxLength: REVIEW_RESULT_V1_LIMITS.maxFindingIdCharacters,
          },
          severity: {
            type: "string",
            enum: [...REVIEW_FINDING_SEVERITIES],
          },
          title: {
            type: "string",
            minLength: 1,
            maxLength: REVIEW_RESULT_V1_LIMITS.maxTitleCharacters,
          },
          impact: {
            type: "string",
            minLength: 1,
            maxLength: REVIEW_RESULT_V1_LIMITS.maxImpactCharacters,
          },
          suggestedCorrection: {
            type: "string",
            minLength: 1,
            maxLength:
              REVIEW_RESULT_V1_LIMITS.maxSuggestedCorrectionCharacters,
          },
          suggestedTest: {
            type: "string",
            minLength: 1,
            maxLength: REVIEW_RESULT_V1_LIMITS.maxSuggestedTestCharacters,
          },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: REVIEW_RESULT_V1_LIMITS.maxEvidencePerFinding,
            items: {
              oneOf: [
                CHANGE_EVIDENCE_REF_JSON_SCHEMA,
                CHANGE_METADATA_EVIDENCE_REF_JSON_SCHEMA,
                REPOSITORY_EVIDENCE_REF_JSON_SCHEMA,
              ],
            },
          },
        },
      },
    },
  },
} as const);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Canonical key ordering for the fixed JSON-only schema value. */
export function canonicalReviewResultSchemaJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Review-result schemas contain safe integers only.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => canonicalReviewResultSchemaJson(entry))
      .join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError("Review-result schemas contain JSON values only.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Review-result schemas require plain objects.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareText);
  if (keys.some((key) => record[key] === undefined)) {
    throw new TypeError("Review-result schemas cannot contain undefined values.");
  }
  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalReviewResultSchemaJson(record[key])}`,
    )
    .join(",")}}`;
}

export const REVIEW_RESULT_V1_JSON_SCHEMA_CANONICAL =
  canonicalReviewResultSchemaJson(REVIEW_RESULT_V1_JSON_SCHEMA);

// Guarded by a deterministic hash test. The literal makes schema identity
// usable from both Electron main and renderer without a Node crypto import.
export const REVIEW_RESULT_V1_JSON_SCHEMA_SHA256 =
  "c9f6d3fc10fd3ab6d63c047fe0c58e87094ff232c5be46df014bc2e1cb079ed8" as const;

export interface ReviewResultV1StructuredOutputIdentity {
  contract: typeof REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT;
  schemaName: typeof REVIEW_RESULT_V1_JSON_SCHEMA_NAME;
  schemaSha256: typeof REVIEW_RESULT_V1_JSON_SCHEMA_SHA256;
}

export function reviewResultV1StructuredOutputIdentity(): ReviewResultV1StructuredOutputIdentity {
  return Object.freeze({
    contract: REVIEW_RESULT_V1_STRUCTURED_OUTPUT_CONTRACT,
    schemaName: REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
    schemaSha256: REVIEW_RESULT_V1_JSON_SCHEMA_SHA256,
  });
}

export function reviewResultV1ResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: REVIEW_RESULT_V1_JSON_SCHEMA_NAME,
      strict: true,
      schema: REVIEW_RESULT_V1_JSON_SCHEMA,
    },
  };
}

export class ReviewResultContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewResultContractError";
  }
}

function assertUniqueJsonObjectMembers(rawContent: string): void {
  let index = 0;

  const skipWhitespace = (): void => {
    while (
      rawContent[index] === " " ||
      rawContent[index] === "\t" ||
      rawContent[index] === "\n" ||
      rawContent[index] === "\r"
    ) {
      index += 1;
    }
  };

  const parseString = (): string => {
    if (rawContent[index] !== '"') throw new SyntaxError("Expected JSON string.");
    const start = index;
    index += 1;
    while (index < rawContent.length) {
      const character = rawContent[index];
      if (character === '"') {
        index += 1;
        return JSON.parse(rawContent.slice(start, index)) as string;
      }
      if (character === "\\") {
        index += 2;
        continue;
      }
      index += 1;
    }
    throw new SyntaxError("Unterminated JSON string.");
  };

  const parseValue = (depth: number): void => {
    if (depth > 256) throw new SyntaxError("JSON nesting exceeds 256 levels.");
    skipWhitespace();
    const character = rawContent[index];
    if (character === '"') {
      parseString();
      return;
    }
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const members = new Set<string>();
      if (rawContent[index] === "}") {
        index += 1;
        return;
      }
      while (index < rawContent.length) {
        skipWhitespace();
        const member = parseString();
        if (members.has(member)) {
          throw new ReviewResultContractError(
            "Review output contains a duplicate JSON object member.",
          );
        }
        members.add(member);
        skipWhitespace();
        if (rawContent[index] !== ":") {
          throw new SyntaxError("Expected JSON object member separator.");
        }
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (rawContent[index] === "}") {
          index += 1;
          return;
        }
        if (rawContent[index] !== ",") {
          throw new SyntaxError("Expected JSON object delimiter.");
        }
        index += 1;
      }
      throw new SyntaxError("Unterminated JSON object.");
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (rawContent[index] === "]") {
        index += 1;
        return;
      }
      while (index < rawContent.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (rawContent[index] === "]") {
          index += 1;
          return;
        }
        if (rawContent[index] !== ",") {
          throw new SyntaxError("Expected JSON array delimiter.");
        }
        index += 1;
      }
      throw new SyntaxError("Unterminated JSON array.");
    }

    const start = index;
    while (
      index < rawContent.length &&
      rawContent[index] !== "," &&
      rawContent[index] !== "]" &&
      rawContent[index] !== "}" &&
      rawContent[index] !== " " &&
      rawContent[index] !== "\t" &&
      rawContent[index] !== "\n" &&
      rawContent[index] !== "\r"
    ) {
      index += 1;
    }
    if (index === start) throw new SyntaxError("Expected JSON value.");
    JSON.parse(rawContent.slice(start, index));
  };

  parseValue(0);
  skipWhitespace();
  if (index !== rawContent.length) {
    throw new SyntaxError("Unexpected content after JSON value.");
  }
}

/** Parse the entire bounded raw provider output. No fence/suffix repair exists. */
export function parseRawReviewResultV1(rawContent: string): ReviewResultV1 {
  if (typeof rawContent !== "string") {
    throw new ReviewResultContractError("Review output must be a JSON string.");
  }
  if (
    utf8Encoder.encode(rawContent).byteLength >
    REVIEW_RESULT_V1_LIMITS.maxRawOutputBytes
  ) {
    throw new ReviewResultContractError(
      "Raw review output exceeds the contract byte limit.",
    );
  }
  let parsed: unknown;
  try {
    assertUniqueJsonObjectMembers(rawContent);
    parsed = JSON.parse(rawContent);
  } catch (error) {
    if (error instanceof ReviewResultContractError) throw error;
    throw new ReviewResultContractError(
      "Review output must be exactly one valid JSON value.",
    );
  }
  const result = ReviewResultV1Schema.safeParse(parsed);
  if (!result.success) {
    throw new ReviewResultContractError(
      "Review output does not match change-review-result-v1.",
    );
  }
  return result.data;
}

export interface ReviewResultV1AcceptanceContext {
  snapshot: ChangeSnapshotV1;
  evidenceSet: ReviewEvidenceSetV1;
  coverage: ReviewCoverageV1;
}

function expectedConclusion(
  result: ReviewResultV1,
  coverage: ReviewCoverageV1,
): ReviewConclusionV1 {
  if (
    result.findings.some(
      (finding) => finding.severity === "P0" || finding.severity === "P1",
    )
  ) {
    return "blocking_findings";
  }
  if (result.omissions.length > 0 || coverage.status === "incomplete") {
    return "incomplete";
  }
  return "no_blocking_findings";
}

/**
 * Host semantic acceptance against already identity-verified immutable inputs.
 * Main-process callers must verify snapshot/evidence identities before this
 * shape-level cross-record check.
 */
export function assertReviewResultV1Accepted(
  resultInput: unknown,
  contextInput: ReviewResultV1AcceptanceContext,
): ReviewResultV1 {
  const result = ReviewResultV1Schema.parse(resultInput);
  const snapshot = ChangeSnapshotV1Schema.parse(contextInput.snapshot);
  const evidenceSet = ReviewEvidenceSetV1Schema.parse(contextInput.evidenceSet);
  const coverage = ReviewCoverageV1Schema.parse(contextInput.coverage);

  if (result.snapshotId !== snapshot.snapshotId) {
    throw new ReviewResultContractError(
      "Review result uses a stale change snapshot ID.",
    );
  }
  if (
    evidenceSet.snapshotId !== snapshot.snapshotId ||
    result.evidenceSetId !== evidenceSet.evidenceSetId
  ) {
    throw new ReviewResultContractError(
      "Review result uses a stale evidence-set identity.",
    );
  }
  if (
    coverage.snapshotId !== snapshot.snapshotId ||
    coverage.evidenceSetId !== evidenceSet.evidenceSetId
  ) {
    throw new ReviewResultContractError(
      "Review coverage does not belong to the accepted evidence records.",
    );
  }

  result.findings.forEach((finding) => {
    let hasChangeOriginEvidence = false;
    finding.evidence.forEach((reference: ReviewEvidenceRef) => {
      try {
        assertReviewEvidenceRefShapeAdmitted(reference, snapshot, evidenceSet);
      } catch (error) {
        throw new ReviewResultContractError(
          `Finding ${finding.findingId} contains inadmissible evidence: ${
            error instanceof Error ? error.message : "unknown evidence error"
          }`,
        );
      }
      hasChangeOriginEvidence ||=
        reference.kind === "change" || reference.kind === "change_metadata";
    });
    if (!hasChangeOriginEvidence) {
      throw new ReviewResultContractError(
        `Finding ${finding.findingId} lacks admitted change-origin evidence.`,
      );
    }
  });

  if (coverage.status === "incomplete" && result.omissions.length === 0) {
    throw new ReviewResultContractError(
      "An incomplete host coverage record requires at least one bounded review omission.",
    );
  }

  const expected = expectedConclusion(result, coverage);
  if (result.conclusion !== expected) {
    throw new ReviewResultContractError(
      `Review conclusion must be ${expected} for the accepted findings, omissions, and coverage.`,
    );
  }
  return result;
}

export function parseAndAcceptRawReviewResultV1(
  rawContent: string,
  context: ReviewResultV1AcceptanceContext,
): ReviewResultV1 {
  return assertReviewResultV1Accepted(parseRawReviewResultV1(rawContent), context);
}
