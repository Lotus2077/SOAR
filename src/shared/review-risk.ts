import { z } from "zod";

import {
  CHANGE_MANIFEST_OMISSION_CODES,
  CHANGE_REVIEW_CONTRACT_LIMITS,
  ChangePathSchema,
  ChangeSnapshotV1Schema,
  changeManifestEntryPath,
  isChangedTestPathV1,
  type ChangeManifestEntryV1,
  type ChangeSnapshotV1,
} from "./change-review-contracts";

export const REVIEW_RISK_POLICY_ID = "review-risk-v1" as const;
export const REVIEW_RISK_THRESHOLD = 3 as const;

const MAX_REVIEW_RISK_OMISSION_CODE_CHARACTERS = Math.max(
  ...CHANGE_MANIFEST_OMISSION_CODES.map((code) => code.length),
);

/**
 * Review-risk records are projections of one admitted change snapshot. Keep
 * their collection bounds mechanically derived from that snapshot contract:
 * a rename can contribute both its old and new path to every path-derived
 * fact. Incomplete reasons may contain every global omission code, the two
 * aggregate-count markers, and every entry-local omission code.
 */
export const REVIEW_RISK_CONTRACT_LIMITS = {
  maxSensitivePaths: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2,
  maxRuntimePaths: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2,
  maxRelevantTestPaths: CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2,
  maxIncompleteReasons:
    CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes +
    2 +
    CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries *
      CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes,
  maxIncompleteReasonCharacters:
    CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters +
    1 +
    MAX_REVIEW_RISK_OMISSION_CODE_CHARACTERS,
  // Complete facts can repeat both rename sides in three path projections.
  maxFactsSerializedRecordBytes:
    CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes * 4,
  // Incomplete results can additionally repeat one path for every frozen
  // omission code. This remains a hard bound while making extraction total for
  // every identity-valid bounded snapshot.
  maxSerializedRecordBytes:
    CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes *
    (CHANGE_MANIFEST_OMISSION_CODES.length + 3),
} as const;

const utf8Encoder = new TextEncoder();

export const REVIEW_RISK_SIGNAL_WEIGHTS = {
  changed_files_ge_8: 1,
  changed_lines_ge_300: 1,
  crosses_three_surfaces: 2,
  runtime_without_relevant_test: 2,
  touches_sensitive_path: 2,
} as const;

export const REVIEW_RISK_SIGNAL_IDS = [
  "changed_files_ge_8",
  "changed_lines_ge_300",
  "crosses_three_surfaces",
  "runtime_without_relevant_test",
  "touches_sensitive_path",
] as const;

export type ReviewRiskSignalId = (typeof REVIEW_RISK_SIGNAL_IDS)[number];

/**
 * Frozen, sorted table for review-risk-v1. The matcher supports only `*` and
 * `**`; adding or changing a pattern requires a new policy version.
 */
export const REVIEW_RISK_SENSITIVE_PATH_GLOBS = [
  "src/**/budget*.ts",
  "src/**/cancel*.ts",
  "src/**/concurrency*.ts",
  "src/**/credential*.ts",
  "src/**/egress*.ts",
  "src/**/migration*.ts",
  "src/**/permission*.ts",
  "src/**/security*.ts",
  "src/main/agent/run-session.ts",
  "src/main/database.ts",
  "src/main/event-store.ts",
  "src/main/ipc.ts",
  "src/main/providers/**",
  "src/main/recovery.ts",
  "src/main/routing/**",
  "src/main/tools/workspace-policy.ts",
  "src/preload/**",
  "src/shared/contracts.ts",
  "src/shared/session-events.ts",
  "src/shared/session-reducer.ts",
] as const;

export const REVIEW_RISK_SURFACES = [
  "main",
  "preload",
  "renderer",
  "shared",
  "test",
] as const;

export type ReviewRiskSurface = (typeof REVIEW_RISK_SURFACES)[number];

export const ReviewRiskSignalV1Schema = z
  .object({
    id: z.enum(REVIEW_RISK_SIGNAL_IDS),
    observedValue: z.number().int().nonnegative().safe(),
    triggerAt: z.number().int().positive().safe(),
    triggered: z.boolean(),
    weight: z.union([z.literal(1), z.literal(2)]),
    contribution: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  })
  .strict()
  .superRefine((signal, context) => {
    const shouldTrigger = signal.observedValue >= signal.triggerAt;
    if (signal.triggered !== shouldTrigger) {
      context.addIssue({
        code: "custom",
        message: "triggered must match observedValue and triggerAt",
        path: ["triggered"],
      });
    }
    const expectedWeight = REVIEW_RISK_SIGNAL_WEIGHTS[signal.id];
    if (signal.weight !== expectedWeight) {
      context.addIssue({
        code: "custom",
        message: "signal weight must match review-risk-v1",
        path: ["weight"],
      });
    }
    const expectedContribution = shouldTrigger ? expectedWeight : 0;
    if (signal.contribution !== expectedContribution) {
      context.addIssue({
        code: "custom",
        message: "signal contribution must equal triggered weight",
        path: ["contribution"],
      });
    }
  });

export type ReviewRiskSignalV1 = z.infer<typeof ReviewRiskSignalV1Schema>;

export const ReviewRiskFactsV1Schema = z
  .object({
    changedPathCount: z.number().int().nonnegative().safe(),
    changedLineCount: z.number().int().nonnegative().safe(),
    surfaces: z.array(z.enum(REVIEW_RISK_SURFACES)).max(5),
    sensitivePaths: z
      .array(ChangePathSchema)
      .max(REVIEW_RISK_CONTRACT_LIMITS.maxSensitivePaths),
    runtimePaths: z
      .array(ChangePathSchema)
      .max(REVIEW_RISK_CONTRACT_LIMITS.maxRuntimePaths),
    relevantTestPaths: z
      .array(ChangePathSchema)
      .max(REVIEW_RISK_CONTRACT_LIMITS.maxRelevantTestPaths),
  })
  .strict()
  .superRefine((facts, context) => {
    const fields = [
      "surfaces",
      "sensitivePaths",
      "runtimePaths",
      "relevantTestPaths",
    ] as const;
    for (const field of fields) {
      const values = facts[field];
      if (JSON.stringify(values) !== JSON.stringify(sortUnique(values))) {
        context.addIssue({
          code: "custom",
          message: `${field} must be strictly sorted and unique`,
          path: [field],
        });
      }
    }
    if (
      utf8Encoder.encode(JSON.stringify(facts)).byteLength >
      REVIEW_RISK_CONTRACT_LIMITS.maxFactsSerializedRecordBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "Review-risk facts exceed the serialized contract byte limit",
      });
    }
  });

export type ReviewRiskFactsV1 = z.infer<typeof ReviewRiskFactsV1Schema>;

export const ReviewRiskResultV1Schema = z
  .object({
    schemaVersion: z.literal("review-risk-result-v1"),
    policyId: z.literal(REVIEW_RISK_POLICY_ID),
    snapshotId: z.string().regex(/^[0-9a-f]{64}$/u),
    complete: z.boolean(),
    threshold: z.literal(REVIEW_RISK_THRESHOLD),
    score: z.number().int().nonnegative().safe().nullable(),
    classification: z.enum(["low_risk", "high_risk", "incomplete"]),
    signals: z.array(ReviewRiskSignalV1Schema).max(
      REVIEW_RISK_SIGNAL_IDS.length,
    ),
    facts: ReviewRiskFactsV1Schema,
    incompleteReasons: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(REVIEW_RISK_CONTRACT_LIMITS.maxIncompleteReasonCharacters),
      )
      .max(REVIEW_RISK_CONTRACT_LIMITS.maxIncompleteReasons),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.complete) {
      if (
        result.score === null ||
        result.classification === "incomplete" ||
        result.incompleteReasons.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "complete risk result requires a score and no incomplete state",
          path: ["complete"],
        });
      }
      if (
        result.signals.length !== REVIEW_RISK_SIGNAL_IDS.length ||
        result.signals.some(
          (signal, index) => signal.id !== REVIEW_RISK_SIGNAL_IDS[index],
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "complete risk signals must use the canonical v1 order",
          path: ["signals"],
        });
      }
      const canonical = scoreCompleteReviewRiskFactsV1(result.facts);
      if (JSON.stringify(result.signals) !== JSON.stringify(canonical.signals)) {
        context.addIssue({
          code: "custom",
          message: "signals must exactly match the canonical values derived from facts",
          path: ["signals"],
        });
      }
      const contribution = result.signals.reduce(
        (total, signal) => total + signal.contribution,
        0,
      );
      if (result.score !== contribution) {
        context.addIssue({
          code: "custom",
          message: "score must equal the signal contribution sum",
          path: ["score"],
        });
      }
      if (
        result.score !== null &&
        result.classification !==
          (result.score < REVIEW_RISK_THRESHOLD ? "low_risk" : "high_risk")
      ) {
        context.addIssue({
          code: "custom",
          message: "classification must match the review-risk-v1 threshold",
          path: ["classification"],
        });
      }
    } else if (
      result.score !== null ||
      result.classification !== "incomplete" ||
      result.signals.length > 0 ||
      result.incompleteReasons.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "incomplete risk result must have reasons and no score or signals",
        path: ["complete"],
      });
    }
    if (
      utf8Encoder.encode(JSON.stringify(result)).byteLength >
      REVIEW_RISK_CONTRACT_LIMITS.maxSerializedRecordBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "Review-risk result exceeds the serialized contract byte limit",
      });
    }
  });

export type ReviewRiskResultV1 = z.infer<typeof ReviewRiskResultV1Schema>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function globMatchesPath(pattern: string, path: string): boolean {
  let expression = "";
  for (let index = 0; index < pattern.length; ) {
    if (pattern.startsWith("**/", index)) {
      expression += "(?:[^/]+/)*";
      index += 3;
    } else if (pattern.startsWith("**", index)) {
      expression += ".*";
      index += 2;
    } else if (pattern[index] === "*") {
      expression += "[^/]*";
      index += 1;
    } else {
      expression += escapeRegularExpression(pattern[index] ?? "");
      index += 1;
    }
  }
  return new RegExp(`^${expression}$`, "u").test(path);
}

export function isReviewRiskSensitivePath(path: string): boolean {
  return REVIEW_RISK_SENSITIVE_PATH_GLOBS.some((pattern) =>
    globMatchesPath(pattern, path),
  );
}

export function reviewRiskSurfaceForPath(
  path: string,
): ReviewRiskSurface | undefined {
  if (path.startsWith("src/main/")) return "main";
  if (path.startsWith("src/preload/")) return "preload";
  if (path.startsWith("src/renderer/")) return "renderer";
  if (path.startsWith("src/shared/")) return "shared";
  if (path.startsWith("tests/")) return "test";
  return undefined;
}

export function isReviewRiskRuntimePath(path: string): boolean {
  return path.startsWith("src/");
}

export function isReviewRiskRelevantTestPath(path: string): boolean {
  return isChangedTestPathV1(path);
}

function pathCandidates(entry: ChangeManifestEntryV1): string[] {
  return [entry.newPath, entry.oldPath].filter(
    (path): path is string => path !== null,
  );
}

function signal(
  id: ReviewRiskSignalId,
  observedValue: number,
  triggerAt: number,
): ReviewRiskSignalV1 {
  const triggered = observedValue >= triggerAt;
  const weight = REVIEW_RISK_SIGNAL_WEIGHTS[id];
  return {
    id,
    observedValue,
    triggerAt,
    triggered,
    weight,
    contribution: triggered ? weight : 0,
  };
}

export interface CompleteReviewRiskScoreV1 {
  signals: ReviewRiskSignalV1[];
  score: number;
  classification: "low_risk" | "high_risk";
}

export function scoreCompleteReviewRiskFactsV1(
  factsInput: ReviewRiskFactsV1,
): CompleteReviewRiskScoreV1 {
  const facts = ReviewRiskFactsV1Schema.parse(factsInput);
  const signals: ReviewRiskSignalV1[] = [
    signal("changed_files_ge_8", facts.changedPathCount, 8),
    signal("changed_lines_ge_300", facts.changedLineCount, 300),
    signal("crosses_three_surfaces", facts.surfaces.length, 3),
    signal(
      "runtime_without_relevant_test",
      facts.runtimePaths.length > 0 && facts.relevantTestPaths.length === 0 ? 1 : 0,
      1,
    ),
    signal("touches_sensitive_path", facts.sensitivePaths.length, 1),
  ];
  const score = signals.reduce((total, item) => total + item.contribution, 0);
  return {
    signals,
    score,
    classification: score < REVIEW_RISK_THRESHOLD ? "low_risk" : "high_risk",
  };
}

function changedLineCount(snapshot: ChangeSnapshotV1): number {
  return snapshot.manifest.reduce(
    (snapshotTotal, entry) =>
      snapshotTotal +
      entry.hunks.reduce(
        (entryTotal, hunk) =>
          entryTotal +
          hunk.lines.filter(
            (line) => line.kind === "addition" || line.kind === "deletion",
          ).length,
        0,
      ),
    0,
  );
}

function incompleteReasons(snapshot: ChangeSnapshotV1): string[] {
  return sortUnique([
    ...snapshot.manifestOmissionCodes.map((code) => `manifest:${code}`),
    ...(snapshot.omittedPathCount > 0
      ? [`manifest:omitted_paths:${snapshot.omittedPathCount}`]
      : []),
    ...(snapshot.omittedHunkCount > 0
      ? [`manifest:omitted_hunks:${snapshot.omittedHunkCount}`]
      : []),
    ...snapshot.manifest.flatMap((entry) =>
      entry.omissionCodes.map(
        (code) => `${changeManifestEntryPath(entry)}:${code}`,
      ),
    ),
    ...snapshot.manifest.flatMap((entry) => {
      const modes = [entry.base?.mode, entry.working?.mode];
      if (modes.includes("160000")) {
        return [`${changeManifestEntryPath(entry)}:submodule`];
      }
      if (modes.includes("120000")) {
        return [`${changeManifestEntryPath(entry)}:symlink`];
      }
      return [];
    }),
  ]);
}

/**
 * Pure review-risk-v1 extraction over the canonical acquisition snapshot.
 * Any omission suppresses the score: partial facts never become escalation
 * evidence. This shared primitive validates shape but cannot verify a snapshot
 * hash without importing the host layer; routing callers must use
 * `extractVerifiedReviewRiskV1` from `src/main/review-risk.ts`.
 */
export function extractReviewRiskV1(snapshotInput: unknown): ReviewRiskResultV1 {
  const snapshot = ChangeSnapshotV1Schema.parse(snapshotInput);
  const surfaces = sortUnique(
    snapshot.manifest.flatMap((entry) =>
      pathCandidates(entry).flatMap((candidate) => {
        const surface = reviewRiskSurfaceForPath(candidate);
        return surface === undefined ? [] : [surface];
      }),
    ),
  ) as ReviewRiskSurface[];
  const sensitivePaths = sortUnique(
    snapshot.manifest.flatMap((entry) =>
      pathCandidates(entry).filter(isReviewRiskSensitivePath),
    ),
  );
  const runtimePaths = sortUnique(
    snapshot.manifest.flatMap(pathCandidates).filter(isReviewRiskRuntimePath),
  );
  const relevantTestPaths = sortUnique(
    snapshot.manifest
      .flatMap(pathCandidates)
      .filter(isReviewRiskRelevantTestPath),
  );
  const facts: ReviewRiskFactsV1 = {
    changedPathCount: snapshot.manifest.length + snapshot.omittedPathCount,
    changedLineCount: changedLineCount(snapshot),
    surfaces,
    sensitivePaths,
    runtimePaths,
    relevantTestPaths,
  };
  const reasons = incompleteReasons(snapshot);

  if (reasons.length > 0) {
    return ReviewRiskResultV1Schema.parse({
      schemaVersion: "review-risk-result-v1",
      policyId: REVIEW_RISK_POLICY_ID,
      snapshotId: snapshot.snapshotId,
      complete: false,
      threshold: REVIEW_RISK_THRESHOLD,
      score: null,
      classification: "incomplete",
      signals: [],
      facts,
      incompleteReasons: reasons,
    });
  }

  const { signals, score, classification } = scoreCompleteReviewRiskFactsV1(facts);

  return ReviewRiskResultV1Schema.parse({
    schemaVersion: "review-risk-result-v1",
    policyId: REVIEW_RISK_POLICY_ID,
    snapshotId: snapshot.snapshotId,
    complete: true,
    threshold: REVIEW_RISK_THRESHOLD,
    score,
    classification,
    signals,
    facts,
    incompleteReasons: [],
  });
}
