import { z } from "zod";

const MAX_ADMITTED_CHANGE_PATHS = 200;
const MAX_ADMITTED_CHANGE_HUNKS = 200;
const MAX_CHANGE_LINES_PER_SNAPSHOT = 20_000;
const MAX_CHANGE_PATH_CHARACTERS = 4_096;
const MAX_SERIALIZED_CHANGE_RECORD_BYTES = 256 * 1024;
const MAX_SAFE_INTEGER_JSON_BYTES = String(Number.MAX_SAFE_INTEGER).length;
// ChangePath length is measured in UTF-16 code units. JSON.stringify may emit
// six ASCII bytes for one valid contract code unit (for example, an unpaired
// surrogate is serialized as `\ud800`), plus the surrounding quotes.
const MAX_SERIALIZED_CHANGE_PATH_BYTES =
  6 * MAX_CHANGE_PATH_CHARACTERS + 2;
const MAX_INSPECT_RESULT_FIXED_JSON_BYTES = 512;
const MAX_EVIDENCE_MAP_ENTRY_FIXED_JSON_BYTES = 256;
const MAX_INSPECT_RESULT_SERIALIZED_RECORD_BYTES =
  MAX_SERIALIZED_CHANGE_RECORD_BYTES +
  MAX_INSPECT_RESULT_FIXED_JSON_BYTES +
  MAX_ADMITTED_CHANGE_HUNKS *
    (2 * MAX_SERIALIZED_CHANGE_PATH_BYTES +
      MAX_EVIDENCE_MAP_ENTRY_FIXED_JSON_BYTES) +
  2 *
    MAX_CHANGE_LINES_PER_SNAPSHOT *
    (MAX_SAFE_INTEGER_JSON_BYTES + 1);

export const CHANGE_REVIEW_CONTRACT_LIMITS = {
  maxPathCharacters: MAX_CHANGE_PATH_CHARACTERS,
  maxManifestEntries: MAX_ADMITTED_CHANGE_PATHS,
  maxHunksPerEntry: 200,
  maxHunksPerSnapshot: MAX_ADMITTED_CHANGE_HUNKS,
  maxLinesPerHunk: 160,
  maxLinesPerSnapshot: MAX_CHANGE_LINES_PER_SNAPSHOT,
  maxLineCharacters: 65_536,
  maxEvidenceBodies: 400,
  maxEvidenceHunks: 200,
  maxRepositoryObservations: 1_000,
  maxOmissionCodes: 32,
  // Derived counts add the admitted maximum to these omitted counts. Reserve
  // that headroom so every identity-valid snapshot remains a safe-integer
  // input to risk and coverage derivation.
  maxOmittedPaths: Number.MAX_SAFE_INTEGER - MAX_ADMITTED_CHANGE_PATHS,
  maxOmittedHunks: Number.MAX_SAFE_INTEGER - MAX_ADMITTED_CHANGE_HUNKS,
  maxSerializedRecordBytes: MAX_SERIALIZED_CHANGE_RECORD_BYTES,
  // The public inspect-result builder projects every admitted hunk into an
  // evidence-map record, repeating both paths and up to two line-number arrays.
  // Reserve the snapshot cap plus the field-wise bounded worst-case projection
  // so every identity-valid snapshot has a representable inspect result.
  maxInspectResultSerializedRecordBytes:
    MAX_INSPECT_RESULT_SERIALIZED_RECORD_BYTES,
  // Coverage repeats canonical/old/new paths and changed-test projections from
  // a bounded snapshot. Keep that derived record total without weakening the
  // tighter acquisition/evidence-set bounds.
  maxCoverageSerializedRecordBytes: 4 * 256 * 1024,
} as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BOUNDED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const utf8Encoder = new TextEncoder();
const SERIALIZED_SHA256_ID_VALUE = "0".repeat(64);

function serializedIdentityFieldOverhead(field: string): number {
  return utf8Encoder.encode(
    `,${JSON.stringify(field)}:${JSON.stringify(SERIALIZED_SHA256_ID_VALUE)}`,
  ).byteLength;
}

const SNAPSHOT_ID_SERIALIZED_OVERHEAD_BYTES =
  serializedIdentityFieldOverhead("snapshotId");
const EVIDENCE_SET_ID_SERIALIZED_OVERHEAD_BYTES =
  serializedIdentityFieldOverhead("evidenceSetId");

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isCanonicalChangePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters ||
    value.trim() !== value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value)
  ) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !/[\u0000-\u001f\u007f]/u.test(segment),
  );
}

export const ChangePathSchema = z
  .string()
  .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxPathCharacters)
  .refine(isCanonicalChangePath, "Expected a canonical workspace-relative POSIX path.");

export const Sha256Schema = z.string().regex(SHA256_PATTERN);
export const GitObjectIdSchema = z.string().regex(GIT_OID_PATTERN);
export const ChangeContractIdSchema = z.string().regex(BOUNDED_ID_PATTERN);
export const GitFileModeSchema = z.enum(["100644", "100755", "120000", "160000"]);

export const CHANGE_KINDS = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "type_changed",
  "untracked",
] as const;

export const ChangeKindSchema = z.enum(CHANGE_KINDS);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const CHANGE_MANIFEST_OMISSION_CODES = [
  "binary",
  "submodule",
  "symlink",
  "unreadable",
  "oversized",
  "truncated",
  "file_count_limit",
  "hunk_count_limit",
  "total_byte_limit",
  "unsafe_path",
  "staged_unstaged_overlap",
] as const;

export const ChangeManifestOmissionCodeSchema = z.enum(
  CHANGE_MANIFEST_OMISSION_CODES,
);
export type ChangeManifestOmissionCode = z.infer<
  typeof ChangeManifestOmissionCodeSchema
>;

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function assertCanonicalUniqueStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && compareText(values[index - 1] ?? "", values[index] ?? "") >= 0) {
      addIssue(context, [...path, index], `${label} must be strictly sorted and unique.`);
      return;
    }
  }
}

const ChangeHunkLineSchema = z
  .object({
    kind: z.enum(["context", "addition", "deletion"]),
    content: z
      .string()
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxLineCharacters)
      .refine(
        (value) => !/[\r\n\0]/u.test(value),
        "Hunk line content excludes line terminators and null bytes.",
      ),
    terminator: z.enum(["lf", "crlf", "cr", "none"]),
    oldLine: z.number().int().positive().safe().nullable(),
    newLine: z.number().int().positive().safe().nullable(),
  })
  .strict()
  .superRefine((line, context) => {
    if (line.kind === "context" && (line.oldLine === null || line.newLine === null)) {
      addIssue(context, [], "Context lines require both oldLine and newLine.");
    }
    if (line.kind === "addition" && (line.oldLine !== null || line.newLine === null)) {
      addIssue(context, [], "Addition lines require only newLine.");
    }
    if (line.kind === "deletion" && (line.oldLine === null || line.newLine !== null)) {
      addIssue(context, [], "Deletion lines require only oldLine.");
    }
  });

export type ChangeHunkLineV1 = z.infer<typeof ChangeHunkLineSchema>;

const changeHunkPreimageShape = {
  schemaVersion: z.literal("change-hunk-v1"),
  oldPath: ChangePathSchema.nullable(),
  newPath: ChangePathSchema.nullable(),
  oldStart: z.number().int().nonnegative().safe(),
  oldLines: z.number().int().nonnegative().safe(),
  newStart: z.number().int().nonnegative().safe(),
  newLines: z.number().int().nonnegative().safe(),
  lines: z
    .array(ChangeHunkLineSchema)
    .min(1)
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxLinesPerHunk),
} as const;

function refineChangeHunk(
  hunk: {
    oldPath: string | null;
    newPath: string | null;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: ChangeHunkLineV1[];
  },
  context: z.RefinementCtx,
): void {
  if (hunk.oldPath === null && hunk.newPath === null) {
    addIssue(context, ["oldPath"], "A hunk requires an old or new path.");
  }
  if (hunk.oldLines > 0 && hunk.oldStart === 0) {
    addIssue(context, ["oldStart"], "A non-empty old range starts at a positive line.");
  }
  if (hunk.newLines > 0 && hunk.newStart === 0) {
    addIssue(context, ["newStart"], "A non-empty new range starts at a positive line.");
  }

  let nextOldLine = hunk.oldStart;
  let nextNewLine = hunk.newStart;
  let actualOldLines = 0;
  let actualNewLines = 0;

  hunk.lines.forEach((line, index) => {
    if (line.oldLine !== null) {
      if (line.oldLine !== nextOldLine) {
        addIssue(
          context,
          ["lines", index, "oldLine"],
          `Expected consecutive old line ${nextOldLine}.`,
        );
      }
      nextOldLine += 1;
      actualOldLines += 1;
    }
    if (line.newLine !== null) {
      if (line.newLine !== nextNewLine) {
        addIssue(
          context,
          ["lines", index, "newLine"],
          `Expected consecutive new line ${nextNewLine}.`,
        );
      }
      nextNewLine += 1;
      actualNewLines += 1;
    }
    if (hunk.oldPath === null && line.oldLine !== null) {
      addIssue(context, ["lines", index, "oldLine"], "A new-only hunk cannot cite an old line.");
    }
    if (hunk.newPath === null && line.newLine !== null) {
      addIssue(context, ["lines", index, "newLine"], "A deleted hunk cannot cite a new line.");
    }
  });

  if (actualOldLines !== hunk.oldLines) {
    addIssue(
      context,
      ["oldLines"],
      `oldLines declares ${hunk.oldLines}, but the hunk contains ${actualOldLines}.`,
    );
  }
  if (actualNewLines !== hunk.newLines) {
    addIssue(
      context,
      ["newLines"],
      `newLines declares ${hunk.newLines}, but the hunk contains ${actualNewLines}.`,
    );
  }
}

export const ChangeHunkPreimageV1Schema = z
  .object(changeHunkPreimageShape)
  .strict()
  .superRefine(refineChangeHunk);

export const ChangeHunkV1Schema = z
  .object({
    ...changeHunkPreimageShape,
    hunkSha256: Sha256Schema,
  })
  .strict()
  .superRefine(refineChangeHunk);

export type ChangeHunkPreimageV1 = z.infer<typeof ChangeHunkPreimageV1Schema>;
export type ChangeHunkV1 = z.infer<typeof ChangeHunkV1Schema>;

export function compareChangeHunks(left: ChangeHunkV1, right: ChangeHunkV1): number {
  return (
    left.oldStart - right.oldStart ||
    left.newStart - right.newStart ||
    compareText(left.hunkSha256, right.hunkSha256)
  );
}

export const ChangeSideIdentityV1Schema = z
  .object({
    mode: GitFileModeSchema,
    sizeBytes: z.number().int().nonnegative().safe(),
    admittedContentSha256: Sha256Schema.nullable(),
  })
  .strict();

export type ChangeSideIdentityV1 = z.infer<typeof ChangeSideIdentityV1Schema>;

export const ChangeManifestEntryV1Schema = z
  .object({
    changeKind: ChangeKindSchema,
    oldPath: ChangePathSchema.nullable(),
    newPath: ChangePathSchema.nullable(),
    staged: z.boolean(),
    unstaged: z.boolean(),
    base: ChangeSideIdentityV1Schema.nullable(),
    working: ChangeSideIdentityV1Schema.nullable(),
    omissionCodes: z
      .array(ChangeManifestOmissionCodeSchema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes),
    hunks: z
      .array(ChangeHunkV1Schema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxHunksPerEntry),
  })
  .strict()
  .superRefine((entry, context) => {
    if (!entry.staged && !entry.unstaged) {
      addIssue(context, ["staged"], "A changed entry must be staged, unstaged, or both.");
    }
    const hasStagedUnstagedOmission = entry.omissionCodes.includes(
      "staged_unstaged_overlap",
    );
    if (entry.staged && entry.unstaged && !hasStagedUnstagedOmission) {
      addIssue(
        context,
        ["omissionCodes"],
        "Simultaneous staged and unstaged state requires staged_unstaged_overlap.",
      );
    }
    if ((!entry.staged || !entry.unstaged) && hasStagedUnstagedOmission) {
      addIssue(
        context,
        ["omissionCodes"],
        "staged_unstaged_overlap requires both staged and unstaged state.",
      );
    }
    if (entry.changeKind === "untracked" && (entry.staged || !entry.unstaged)) {
      addIssue(context, ["changeKind"], "Untracked entries are unstaged only.");
    }

    const requiresOld = ["modified", "deleted", "renamed", "type_changed"].includes(
      entry.changeKind,
    );
    const requiresNew = [
      "added",
      "modified",
      "renamed",
      "type_changed",
      "untracked",
    ].includes(entry.changeKind);
    const permitsMissingFinalAddedSide =
      entry.changeKind === "added" &&
      entry.staged &&
      entry.unstaged &&
      entry.omissionCodes.includes("staged_unstaged_overlap") &&
      entry.oldPath === null &&
      entry.base === null &&
      entry.newPath !== null &&
      entry.working === null;

    if ((entry.oldPath !== null) !== requiresOld || (entry.base !== null) !== requiresOld) {
      addIssue(
        context,
        ["oldPath"],
        `${entry.changeKind} requires matching oldPath/base presence.`,
      );
    }
    if (
      (entry.newPath !== null) !== requiresNew ||
      ((entry.working !== null) !== requiresNew && !permitsMissingFinalAddedSide)
    ) {
      addIssue(
        context,
        ["newPath"],
        `${entry.changeKind} requires matching newPath/working presence.`,
      );
    }
    if (
      (entry.changeKind === "modified" || entry.changeKind === "type_changed") &&
      entry.oldPath !== entry.newPath
    ) {
      addIssue(context, ["newPath"], `${entry.changeKind} must keep the same path.`);
    }
    if (entry.changeKind === "renamed" && entry.oldPath === entry.newPath) {
      addIssue(context, ["newPath"], "A renamed entry requires distinct old and new paths.");
    }

    assertCanonicalUniqueStrings(
      entry.omissionCodes,
      context,
      ["omissionCodes"],
      "omissionCodes",
    );

    for (let index = 0; index < entry.hunks.length; index += 1) {
      const hunk = entry.hunks[index];
      if (!hunk) continue;
      if (hunk.oldPath !== entry.oldPath || hunk.newPath !== entry.newPath) {
        addIssue(
          context,
          ["hunks", index],
          "Hunk oldPath/newPath must exactly match its manifest entry.",
        );
      }
      if (index > 0) {
        const previous = entry.hunks[index - 1];
        if (previous && compareChangeHunks(previous, hunk) >= 0) {
          addIssue(
            context,
            ["hunks", index],
            "Hunks must be strictly sorted and unique.",
          );
        }
        if (
          previous &&
          previous.oldLines > 0 &&
          hunk.oldLines > 0 &&
          previous.oldStart + previous.oldLines > hunk.oldStart
        ) {
          addIssue(context, ["hunks", index], "Old hunk ranges cannot overlap.");
        }
        if (
          previous &&
          previous.newLines > 0 &&
          hunk.newLines > 0 &&
          previous.newStart + previous.newLines > hunk.newStart
        ) {
          addIssue(context, ["hunks", index], "New hunk ranges cannot overlap.");
        }
      }
    }

    const cannotContainText = entry.omissionCodes.some((code) =>
      ["binary", "submodule", "symlink", "unreadable", "unsafe_path"].includes(code),
    );
    if (cannotContainText && entry.hunks.length > 0) {
      addIssue(context, ["hunks"], "Non-text or unsafe entries cannot contain admitted hunks.");
    }
    if (entry.omissionCodes.length === 0) {
      if (entry.base && entry.base.admittedContentSha256 === null) {
        addIssue(context, ["base", "admittedContentSha256"], "Complete base text requires a hash.");
      }
      if (entry.working && entry.working.admittedContentSha256 === null) {
        addIssue(
          context,
          ["working", "admittedContentSha256"],
          "Complete working text requires a hash.",
        );
      }
    }

    const modes = [entry.base?.mode, entry.working?.mode].filter(
      (mode): mode is NonNullable<typeof mode> => mode !== undefined,
    );
    if (modes.includes("120000") && !entry.omissionCodes.includes("symlink")) {
      addIssue(context, ["omissionCodes"], "Symbolic-link sides require the symlink omission code.");
    }
    if (modes.includes("160000") && !entry.omissionCodes.includes("submodule")) {
      addIssue(context, ["omissionCodes"], "Submodule sides require the submodule omission code.");
    }

    const baseHash = entry.base?.admittedContentSha256;
    const workingHash = entry.working?.admittedContentSha256;
    const changedAdmittedText =
      baseHash !== null &&
      baseHash !== undefined &&
      workingHash !== null &&
      workingHash !== undefined &&
      baseHash !== workingHash;
    const nonemptyOneSidedText =
      (entry.base === null &&
        entry.working?.admittedContentSha256 != null &&
        entry.working.sizeBytes > 0) ||
      (entry.working === null &&
        entry.base?.admittedContentSha256 != null &&
        entry.base.sizeBytes > 0);
    const hunkEvidenceExplicitlyOmitted = entry.omissionCodes.some((code) =>
      ["truncated", "hunk_count_limit"].includes(code),
    );
    if (
      (changedAdmittedText || nonemptyOneSidedText) &&
      entry.hunks.length === 0 &&
      !hunkEvidenceExplicitlyOmitted
    ) {
      addIssue(
        context,
        ["hunks"],
        "Changed admitted text requires at least one content-addressed hunk.",
      );
    }
  });

export type ChangeManifestEntryV1 = z.infer<typeof ChangeManifestEntryV1Schema>;

export function changeManifestEntryPath(entry: ChangeManifestEntryV1): string {
  return entry.newPath ?? entry.oldPath ?? "";
}

export function compareChangeManifestEntries(
  left: ChangeManifestEntryV1,
  right: ChangeManifestEntryV1,
): number {
  return (
    compareText(changeManifestEntryPath(left), changeManifestEntryPath(right)) ||
    compareText(left.oldPath ?? "", right.oldPath ?? "") ||
    compareText(left.newPath ?? "", right.newPath ?? "") ||
    compareText(left.changeKind, right.changeKind)
  );
}

const changeSnapshotPreimageShape = {
  schemaVersion: z.literal("change-snapshot-v1"),
  baseCommitOid: GitObjectIdSchema,
  indexSha256: Sha256Schema,
  discoverySha256: Sha256Schema,
  manifest: z
    .array(ChangeManifestEntryV1Schema)
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries),
  omittedPathCount: z
    .number()
    .int()
    .nonnegative()
    .safe()
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedPaths),
  omittedHunkCount: z
    .number()
    .int()
    .nonnegative()
    .safe()
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmittedHunks),
  manifestOmissionCodes: z
    .array(ChangeManifestOmissionCodeSchema)
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes),
} as const;

function refineChangeSnapshot(
  snapshot: {
    manifest: ChangeManifestEntryV1[];
    omittedPathCount: number;
    omittedHunkCount: number;
    manifestOmissionCodes: ChangeManifestOmissionCode[];
    snapshotId?: string;
  },
  context: z.RefinementCtx,
): void {
  assertCanonicalUniqueStrings(
    snapshot.manifestOmissionCodes,
    context,
    ["manifestOmissionCodes"],
    "manifestOmissionCodes",
  );
  if (
    (snapshot.omittedPathCount > 0 || snapshot.omittedHunkCount > 0) &&
    snapshot.manifestOmissionCodes.length === 0
  ) {
    addIssue(
      context,
      ["manifestOmissionCodes"],
      "Omitted path or hunk counts require an explicit omission code.",
    );
  }

  const oldPaths = new Set<string>();
  const newPaths = new Set<string>();
  const coveragePaths = new Set<string>();
  let totalHunks = 0;
  let totalHunkLines = 0;
  for (let index = 0; index < snapshot.manifest.length; index += 1) {
    const entry = snapshot.manifest[index];
    if (!entry) continue;
    if (index > 0) {
      const previous = snapshot.manifest[index - 1];
      if (previous && compareChangeManifestEntries(previous, entry) >= 0) {
        addIssue(
          context,
          ["manifest", index],
          "Manifest entries must be strictly sorted and unique.",
        );
      }
    }
    if (entry.oldPath !== null) {
      if (oldPaths.has(entry.oldPath)) {
        addIssue(context, ["manifest", index, "oldPath"], "Old paths must be unique.");
      }
      oldPaths.add(entry.oldPath);
    }
    if (entry.newPath !== null) {
      if (newPaths.has(entry.newPath)) {
        addIssue(context, ["manifest", index, "newPath"], "New paths must be unique.");
      }
      newPaths.add(entry.newPath);
    }
    const coveragePath = changeManifestEntryPath(entry);
    if (coveragePaths.has(coveragePath)) {
      addIssue(
        context,
        ["manifest", index],
        "Manifest entries must have unique review/coverage paths.",
      );
    }
    coveragePaths.add(coveragePath);
    totalHunks += entry.hunks.length;
    totalHunkLines += entry.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  }
  if (totalHunks > CHANGE_REVIEW_CONTRACT_LIMITS.maxHunksPerSnapshot) {
    addIssue(context, ["manifest"], "Snapshot exceeds the aggregate hunk limit.");
  }
  if (totalHunkLines > CHANGE_REVIEW_CONTRACT_LIMITS.maxLinesPerSnapshot) {
    addIssue(context, ["manifest"], "Snapshot exceeds the aggregate hunk-line limit.");
  }
  const reservedSnapshotBytes =
    utf8Encoder.encode(JSON.stringify(snapshot)).byteLength +
    (snapshot.snapshotId === undefined
      ? SNAPSHOT_ID_SERIALIZED_OVERHEAD_BYTES
      : 0);
  if (reservedSnapshotBytes > CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes) {
    addIssue(context, [], "Snapshot exceeds the serialized contract byte limit.");
  }
}

export const ChangeSnapshotPreimageV1Schema = z
  .object(changeSnapshotPreimageShape)
  .strict()
  .superRefine(refineChangeSnapshot);

export const ChangeSnapshotV1Schema = z
  .object({
    ...changeSnapshotPreimageShape,
    snapshotId: Sha256Schema,
  })
  .strict()
  .superRefine(refineChangeSnapshot);

export type ChangeSnapshotPreimageV1 = z.infer<
  typeof ChangeSnapshotPreimageV1Schema
>;
export type ChangeSnapshotV1 = z.infer<typeof ChangeSnapshotV1Schema>;

export const InspectGitChangesRequestV1Schema = z
  .object({ schemaVersion: z.literal("inspect-git-changes-v1") })
  .strict();

export type InspectGitChangesRequestV1 = z.infer<
  typeof InspectGitChangesRequestV1Schema
>;

export const ChangeHunkEvidenceMapEntryV1Schema = z
  .object({
    hunkSha256: Sha256Schema,
    oldPath: ChangePathSchema.nullable(),
    newPath: ChangePathSchema.nullable(),
    baseLines: z.array(z.number().int().positive().safe()).max(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxLinesPerHunk,
    ),
    workingLines: z.array(z.number().int().positive().safe()).max(
      CHANGE_REVIEW_CONTRACT_LIMITS.maxLinesPerHunk,
    ),
  })
  .strict();

export type ChangeHunkEvidenceMapEntryV1 = z.infer<
  typeof ChangeHunkEvidenceMapEntryV1Schema
>;

export const InspectGitChangesResultV1Schema = z
  .object({
    schemaVersion: z.literal("inspect-git-changes-result-v1"),
    snapshot: ChangeSnapshotV1Schema,
    evidenceMap: z
      .array(ChangeHunkEvidenceMapEntryV1Schema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxHunksPerSnapshot),
  })
  .strict()
  .superRefine((result, context) => {
    const expected = result.snapshot.manifest
      .flatMap((entry) =>
        entry.hunks.map((hunk) => ({
          hunkSha256: hunk.hunkSha256,
          oldPath: hunk.oldPath,
          newPath: hunk.newPath,
          baseLines: hunk.lines
            .flatMap((line) => (line.oldLine === null ? [] : [line.oldLine])),
          workingLines: hunk.lines
            .flatMap((line) => (line.newLine === null ? [] : [line.newLine])),
        })),
      )
      .sort((left, right) => compareText(left.hunkSha256, right.hunkSha256));
    if (JSON.stringify(result.evidenceMap) !== JSON.stringify(expected)) {
      addIssue(context, ["evidenceMap"], "Evidence map must be exactly derived from snapshot hunks.");
    }
    if (
      utf8Encoder.encode(JSON.stringify(result)).byteLength >
      CHANGE_REVIEW_CONTRACT_LIMITS.maxInspectResultSerializedRecordBytes
    ) {
      addIssue(context, [], "Inspection result exceeds the serialized contract byte limit.");
    }
  });

export type InspectGitChangesResultV1 = z.infer<
  typeof InspectGitChangesResultV1Schema
>;

export const ChangeEvidenceRefSchema = z
  .object({
    kind: z.literal("change"),
    snapshotId: Sha256Schema,
    path: ChangePathSchema,
    side: z.enum(["working", "base"]),
    line: z.number().int().positive().safe(),
    hunkSha256: Sha256Schema,
  })
  .strict();

/**
 * Snapshot-bound identity evidence for a manifest entry with no content hunk,
 * such as a content-identical rename or a pure executable-bit change. This
 * proves only the admitted change metadata; whether it semantically supports a
 * review claim remains evaluator/host policy.
 */
export const ChangeMetadataEvidenceRefV1Schema = z
  .object({
    kind: z.literal("change_metadata"),
    snapshotId: Sha256Schema,
    path: ChangePathSchema,
    changeKind: ChangeKindSchema,
  })
  .strict();

export const RepositoryEvidenceRefSchema = z
  .object({
    kind: z.literal("repository"),
    snapshotId: Sha256Schema,
    evidenceSetId: Sha256Schema,
    observationId: ChangeContractIdSchema,
    path: ChangePathSchema,
    line: z.number().int().positive().safe(),
    contentSha256: Sha256Schema,
  })
  .strict();

export const ReviewEvidenceRefSchema = z.discriminatedUnion("kind", [
  ChangeEvidenceRefSchema,
  ChangeMetadataEvidenceRefV1Schema,
  RepositoryEvidenceRefSchema,
]);

export type ChangeEvidenceRef = z.infer<typeof ChangeEvidenceRefSchema>;
export type ChangeMetadataEvidenceRefV1 = z.infer<
  typeof ChangeMetadataEvidenceRefV1Schema
>;
export type RepositoryEvidenceRef = z.infer<typeof RepositoryEvidenceRefSchema>;
export type ReviewEvidenceRef = z.infer<typeof ReviewEvidenceRefSchema>;

export const ChangeBodyEvidenceV1Schema = z
  .object({
    path: ChangePathSchema,
    side: z.enum(["base", "working"]),
    contentSha256: Sha256Schema,
  })
  .strict();

export type ChangeBodyEvidenceV1 = z.infer<typeof ChangeBodyEvidenceV1Schema>;

export const RepositoryObservationV1Schema = z
  .object({
    observationId: ChangeContractIdSchema,
    toolName: z.enum(["read_text_file", "search_text"]),
    scope: z.enum(["full_file", "matched_line"]),
    path: ChangePathSchema,
    line: z.number().int().positive().safe().nullable(),
    lineCount: z.number().int().nonnegative().safe().nullable(),
    contentSha256: Sha256Schema,
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      observation.scope === "full_file" &&
      (observation.toolName !== "read_text_file" ||
        observation.line !== null ||
        observation.lineCount === null)
    ) {
      addIssue(
        context,
        ["scope"],
        "A full_file observation is an entire read_text_file result with lineCount.",
      );
    }
    if (
      observation.scope === "matched_line" &&
      (observation.toolName !== "search_text" ||
        observation.line === null ||
        observation.lineCount !== null)
    ) {
      addIssue(
        context,
        ["scope"],
        "A matched_line observation is one exact search_text line.",
      );
    }
  });

export type RepositoryObservationV1 = z.infer<
  typeof RepositoryObservationV1Schema
>;

export function compareChangeBodyEvidence(
  left: ChangeBodyEvidenceV1,
  right: ChangeBodyEvidenceV1,
): number {
  return compareText(left.path, right.path) || compareText(left.side, right.side);
}

export function compareRepositoryObservations(
  left: RepositoryObservationV1,
  right: RepositoryObservationV1,
): number {
  return (
    compareText(left.observationId, right.observationId) ||
    compareText(left.path, right.path) ||
    compareText(left.scope, right.scope) ||
    (left.line ?? -1) - (right.line ?? -1) ||
    compareText(left.contentSha256, right.contentSha256)
  );
}

const reviewEvidenceSetPreimageShape = {
  schemaVersion: z.literal("review-evidence-set-v1"),
  snapshotId: Sha256Schema,
  changeHunkSha256s: z
    .array(Sha256Schema)
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxEvidenceHunks),
  completeBodies: z
    .array(ChangeBodyEvidenceV1Schema)
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxEvidenceBodies),
  repositoryObservations: z
    .array(RepositoryObservationV1Schema)
    .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxRepositoryObservations),
} as const;

function refineReviewEvidenceSet(
  evidenceSet: {
    changeHunkSha256s: string[];
    completeBodies: ChangeBodyEvidenceV1[];
    repositoryObservations: RepositoryObservationV1[];
    evidenceSetId?: string;
  },
  context: z.RefinementCtx,
): void {
  assertCanonicalUniqueStrings(
    evidenceSet.changeHunkSha256s,
    context,
    ["changeHunkSha256s"],
    "changeHunkSha256s",
  );
  for (let index = 1; index < evidenceSet.completeBodies.length; index += 1) {
    const previous = evidenceSet.completeBodies[index - 1];
    const current = evidenceSet.completeBodies[index];
    if (previous && current && compareChangeBodyEvidence(previous, current) >= 0) {
      addIssue(
        context,
        ["completeBodies", index],
        "completeBodies must be strictly sorted and unique by path and side.",
      );
      break;
    }
  }
  for (let index = 1; index < evidenceSet.repositoryObservations.length; index += 1) {
    const previous = evidenceSet.repositoryObservations[index - 1];
    const current = evidenceSet.repositoryObservations[index];
    if (previous && current && compareRepositoryObservations(previous, current) >= 0) {
      addIssue(
        context,
        ["repositoryObservations", index],
        "repositoryObservations must be strictly sorted and unique.",
      );
      break;
    }
  }

  const toolsByObservation = new Map<string, string>();
  const recordKeys = new Set<string>();
  evidenceSet.repositoryObservations.forEach((observation, index) => {
    const existingTool = toolsByObservation.get(observation.observationId);
    if (existingTool !== undefined && existingTool !== observation.toolName) {
      addIssue(
        context,
        ["repositoryObservations", index, "observationId"],
        "One observationId cannot identify results from different tools.",
      );
    }
    toolsByObservation.set(observation.observationId, observation.toolName);
    const recordKey = [
      observation.observationId,
      observation.path,
      observation.scope,
      observation.line ?? "full",
    ].join("\0");
    if (recordKeys.has(recordKey)) {
      addIssue(
        context,
        ["repositoryObservations", index],
        "One observation cannot bind the same path/line to multiple contents.",
      );
    }
    recordKeys.add(recordKey);
  });
  const reservedEvidenceSetBytes =
    utf8Encoder.encode(JSON.stringify(evidenceSet)).byteLength +
    (evidenceSet.evidenceSetId === undefined
      ? EVIDENCE_SET_ID_SERIALIZED_OVERHEAD_BYTES
      : 0);
  if (
    reservedEvidenceSetBytes >
    CHANGE_REVIEW_CONTRACT_LIMITS.maxSerializedRecordBytes
  ) {
    addIssue(context, [], "Evidence set exceeds the serialized contract byte limit.");
  }
}

export const ReviewEvidenceSetPreimageV1Schema = z
  .object(reviewEvidenceSetPreimageShape)
  .strict()
  .superRefine(refineReviewEvidenceSet);

export const ReviewEvidenceSetV1Schema = z
  .object({
    ...reviewEvidenceSetPreimageShape,
    evidenceSetId: Sha256Schema,
  })
  .strict()
  .superRefine(refineReviewEvidenceSet);

export type ReviewEvidenceSetPreimageV1 = z.infer<
  typeof ReviewEvidenceSetPreimageV1Schema
>;
export type ReviewEvidenceSetV1 = z.infer<typeof ReviewEvidenceSetV1Schema>;

export const REVIEW_COVERAGE_OMISSION_CODES = [
  "manifest_incomplete",
  "manifest_path_omitted",
  "change_hunk_not_retained",
  "complete_body_not_retained",
  "changed_file_not_fully_read",
  "packet_evidence_not_retained",
  "snapshot_not_revalidated",
] as const;

export const ReviewCoverageOmissionCodeSchema = z.enum(
  REVIEW_COVERAGE_OMISSION_CODES,
);
export type ReviewCoverageOmissionCode = z.infer<
  typeof ReviewCoverageOmissionCodeSchema
>;

export const ReviewFileCoverageV1Schema = z
  .object({
    path: ChangePathSchema,
    oldPath: ChangePathSchema.nullable(),
    newPath: ChangePathSchema.nullable(),
    changeKind: ChangeKindSchema,
    requiredReadSide: z.enum(["base", "working"]),
    fullRead: z.boolean(),
    completeBodyRequired: z.boolean(),
    completeBodyRetained: z.boolean(),
    hunkCount: z.number().int().nonnegative().safe(),
    retainedHunkCount: z.number().int().nonnegative().safe(),
    changedTest: z.boolean(),
    manifestOmissionCodes: z
      .array(ChangeManifestOmissionCodeSchema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes),
    coverageOmissionCodes: z
      .array(ReviewCoverageOmissionCodeSchema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes),
  })
  .strict()
  .superRefine((file, context) => {
    const requiresOld = ["modified", "deleted", "renamed", "type_changed"].includes(
      file.changeKind,
    );
    const requiresNew = [
      "added",
      "modified",
      "renamed",
      "type_changed",
      "untracked",
    ].includes(file.changeKind);
    if ((file.oldPath !== null) !== requiresOld) {
      addIssue(context, ["oldPath"], `${file.changeKind} coverage has invalid oldPath presence.`);
    }
    if ((file.newPath !== null) !== requiresNew) {
      addIssue(context, ["newPath"], `${file.changeKind} coverage has invalid newPath presence.`);
    }
    if (
      (file.changeKind === "modified" || file.changeKind === "type_changed") &&
      file.oldPath !== file.newPath
    ) {
      addIssue(context, ["newPath"], `${file.changeKind} coverage must keep the same path.`);
    }
    if (file.changeKind === "renamed" && file.oldPath === file.newPath) {
      addIssue(context, ["newPath"], "Renamed coverage requires distinct old and new paths.");
    }
    if (file.path !== (file.newPath ?? file.oldPath)) {
      addIssue(
        context,
        ["path"],
        "Coverage path must use the working path when present and otherwise the base path.",
      );
    }
    if (file.retainedHunkCount > file.hunkCount) {
      addIssue(context, ["retainedHunkCount"], "Retained hunks cannot exceed changed hunks.");
    }
    if (!file.completeBodyRequired && file.completeBodyRetained) {
      addIssue(
        context,
        ["completeBodyRetained"],
        "A non-required complete body cannot be marked retained.",
      );
    }
    assertCanonicalUniqueStrings(
      file.manifestOmissionCodes,
      context,
      ["manifestOmissionCodes"],
      "manifestOmissionCodes",
    );
    assertCanonicalUniqueStrings(
      file.coverageOmissionCodes,
      context,
      ["coverageOmissionCodes"],
      "coverageOmissionCodes",
    );
  });

export type ReviewFileCoverageV1 = z.infer<
  typeof ReviewFileCoverageV1Schema
>;

export const ReviewCoverageCountsV1Schema = z
  .object({
    changedPaths: z.number().int().nonnegative().safe(),
    admittedPaths: z.number().int().nonnegative().safe(),
    omittedPaths: z.number().int().nonnegative().safe(),
    changedHunks: z.number().int().nonnegative().safe(),
    admittedHunks: z.number().int().nonnegative().safe(),
    omittedHunks: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((counts, context) => {
    if (counts.admittedPaths + counts.omittedPaths !== counts.changedPaths) {
      addIssue(context, ["changedPaths"], "Path coverage counts must reconcile.");
    }
    if (counts.admittedHunks + counts.omittedHunks !== counts.changedHunks) {
      addIssue(context, ["changedHunks"], "Hunk coverage counts must reconcile.");
    }
  });

export type ReviewCoverageCountsV1 = z.infer<
  typeof ReviewCoverageCountsV1Schema
>;

export function isChangedTestPathV1(path: string): boolean {
  return /\.(?:test|spec)\.[^/]+$/u.test(path);
}

export const ReviewCoverageV1Schema = z
  .object({
    schemaVersion: z.literal("review-coverage-v1"),
    snapshotId: Sha256Schema,
    evidenceSetId: Sha256Schema,
    status: z.enum(["complete", "incomplete"]),
    manifestStatus: z.enum(["complete", "incomplete"]),
    counts: ReviewCoverageCountsV1Schema,
    files: z
      .array(ReviewFileCoverageV1Schema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries),
    changedTestPaths: z
      .array(ChangePathSchema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxManifestEntries * 2),
    runtimeCodeChangedWithoutChangedTest: z.boolean(),
    packetRetainedEvidenceSet: z.boolean(),
    snapshotRevalidated: z.boolean(),
    omissionCodes: z
      .array(ReviewCoverageOmissionCodeSchema)
      .max(CHANGE_REVIEW_CONTRACT_LIMITS.maxOmissionCodes),
  })
  .strict()
  .superRefine((coverage, context) => {
    for (let index = 1; index < coverage.files.length; index += 1) {
      const previous = coverage.files[index - 1];
      const current = coverage.files[index];
      if (previous && current && compareText(previous.path, current.path) >= 0) {
        addIssue(context, ["files", index], "File coverage must be sorted and unique by path.");
        break;
      }
    }
    assertCanonicalUniqueStrings(
      coverage.changedTestPaths,
      context,
      ["changedTestPaths"],
      "changedTestPaths",
    );
    assertCanonicalUniqueStrings(
      coverage.omissionCodes,
      context,
      ["omissionCodes"],
      "omissionCodes",
    );

    const derivedTestPaths = [
      ...new Set(
        coverage.files.flatMap((file) =>
          [file.oldPath, file.newPath].filter(
            (candidate): candidate is string =>
              candidate !== null && isChangedTestPathV1(candidate),
          ),
        ),
      ),
    ].sort(compareText);
    if (JSON.stringify(derivedTestPaths) !== JSON.stringify(coverage.changedTestPaths)) {
      addIssue(
        context,
        ["changedTestPaths"],
        "changedTestPaths must exactly match the changedTest file records.",
      );
    }

    coverage.files.forEach((file, index) => {
      const expectedReadSide = file.changeKind === "deleted" ? "base" : "working";
      if (file.requiredReadSide !== expectedReadSide) {
        addIssue(
          context,
          ["files", index, "requiredReadSide"],
          "requiredReadSide must be derived from the change kind.",
        );
      }
      const expectedBodyRequired = ["added", "deleted", "untracked"].includes(
        file.changeKind,
      );
      if (file.completeBodyRequired !== expectedBodyRequired) {
        addIssue(
          context,
          ["files", index, "completeBodyRequired"],
          "completeBodyRequired must be derived from the change kind.",
        );
      }
      if (
        file.changedTest !==
        [file.oldPath, file.newPath].some(
          (candidate) => candidate !== null && isChangedTestPathV1(candidate),
        )
      ) {
        addIssue(
          context,
          ["files", index, "changedTest"],
          "changedTest must use the frozen review test-path matcher.",
        );
      }
    });

    const expectedRuntimeWithoutTest =
      coverage.files.some((file) =>
        [file.oldPath, file.newPath].some(
          (candidate) => candidate !== null && candidate.startsWith("src/"),
        ),
      ) && derivedTestPaths.length === 0;
    if (
      coverage.runtimeCodeChangedWithoutChangedTest !== expectedRuntimeWithoutTest
    ) {
      addIssue(
        context,
        ["runtimeCodeChangedWithoutChangedTest"],
        "Runtime-without-test must be derived from the covered file paths.",
      );
    }

    const knownChangedHunks = coverage.files.reduce((sum, file) => sum + file.hunkCount, 0);
    const knownRetainedHunks = coverage.files.reduce(
      (sum, file) => sum + file.retainedHunkCount,
      0,
    );
    if (knownChangedHunks > coverage.counts.changedHunks) {
      addIssue(context, ["counts", "changedHunks"], "Changed hunk count is below known hunks.");
    }
    if (knownRetainedHunks !== coverage.counts.admittedHunks) {
      addIssue(
        context,
        ["counts", "admittedHunks"],
        "Admitted hunk count must equal retained known hunks.",
      );
    }
    if (coverage.counts.changedPaths < coverage.files.length) {
      addIssue(context, ["counts", "changedPaths"], "Changed paths cannot be below known files.");
    }
    const admittedKnownPaths = coverage.files.filter(
      (file) =>
        file.manifestOmissionCodes.length === 0 &&
        file.coverageOmissionCodes.length === 0,
    ).length;
    if (coverage.counts.admittedPaths !== admittedKnownPaths) {
      addIssue(
        context,
        ["counts", "admittedPaths"],
        "Admitted paths must equal fully admitted known file records.",
      );
    }
    const manifestCanBeComplete =
      coverage.counts.changedPaths === coverage.files.length &&
      coverage.files.every((file) => file.manifestOmissionCodes.length === 0);
    if (coverage.manifestStatus === "complete" && !manifestCanBeComplete) {
      addIssue(
        context,
        ["manifestStatus"],
        "A complete manifest cannot omit paths or mark known files omitted.",
      );
    }

    const internallyComplete =
      coverage.manifestStatus === "complete" &&
      coverage.counts.omittedPaths === 0 &&
      coverage.counts.omittedHunks === 0 &&
      coverage.files.every(
        (file) =>
          file.fullRead &&
          (!file.completeBodyRequired || file.completeBodyRetained) &&
          file.coverageOmissionCodes.length === 0 &&
          file.manifestOmissionCodes.length === 0,
      ) &&
      coverage.packetRetainedEvidenceSet &&
      coverage.snapshotRevalidated &&
      coverage.omissionCodes.length === 0;

    if ((coverage.status === "complete") !== internallyComplete) {
      addIssue(
        context,
        ["status"],
        "Coverage is complete only when every manifest, evidence, packet, and snapshot gate is complete.",
      );
    }
    if (
      utf8Encoder.encode(JSON.stringify(coverage)).byteLength >
      CHANGE_REVIEW_CONTRACT_LIMITS.maxCoverageSerializedRecordBytes
    ) {
      addIssue(context, [], "Coverage exceeds the serialized contract byte limit.");
    }
  });

export type ReviewCoverageV1 = z.infer<typeof ReviewCoverageV1Schema>;

export class ChangeReviewContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeReviewContractError";
  }
}

function findChangeHunk(
  snapshot: ChangeSnapshotV1,
  hunkSha256: string,
): ChangeHunkV1 | undefined {
  for (const entry of snapshot.manifest) {
    const hunk = entry.hunks.find((candidate) => candidate.hunkSha256 === hunkSha256);
    if (hunk) return hunk;
  }
  return undefined;
}

/**
 * Cross-check a structured reference against already-verified records. This
 * helper is intentionally named shape-only: host callers must use the main
 * process API that verifies both content-addressed identities first.
 */
export function assertReviewEvidenceRefShapeAdmitted(
  referenceInput: unknown,
  snapshotInput: unknown,
  evidenceSetInput: unknown,
): ReviewEvidenceRef {
  const reference = ReviewEvidenceRefSchema.parse(referenceInput);
  const snapshot = ChangeSnapshotV1Schema.parse(snapshotInput);
  const evidenceSet = ReviewEvidenceSetV1Schema.parse(evidenceSetInput);

  if (evidenceSet.snapshotId !== snapshot.snapshotId) {
    throw new ChangeReviewContractError("Evidence set does not belong to the change snapshot.");
  }
  if (reference.snapshotId !== snapshot.snapshotId) {
    throw new ChangeReviewContractError("Evidence reference uses a stale snapshot ID.");
  }

  if (reference.kind === "change") {
    const hunk = findChangeHunk(snapshot, reference.hunkSha256);
    if (!hunk || !evidenceSet.changeHunkSha256s.includes(reference.hunkSha256)) {
      throw new ChangeReviewContractError("Change reference names a hunk outside the admitted evidence set.");
    }
    const expectedPath = reference.side === "base" ? hunk.oldPath : hunk.newPath;
    if (expectedPath === null || expectedPath !== reference.path) {
      throw new ChangeReviewContractError("Change reference path does not match the selected hunk side.");
    }
    const supportsLine = hunk.lines.some((line) =>
      reference.side === "base"
        ? line.oldLine === reference.line
        : line.newLine === reference.line,
    );
    if (!supportsLine) {
      throw new ChangeReviewContractError("Change reference line is not present on the selected hunk side.");
    }
    return reference;
  }

  if (reference.kind === "change_metadata") {
    const entry = snapshot.manifest.find(
      (candidate) =>
        changeManifestEntryPath(candidate) === reference.path &&
        candidate.changeKind === reference.changeKind,
    );
    if (!entry) {
      throw new ChangeReviewContractError(
        "Change-metadata reference does not match an admitted manifest entry.",
      );
    }
    if (entry.hunks.length > 0) {
      throw new ChangeReviewContractError(
        "Change-metadata evidence is limited to manifest entries with no content hunks.",
      );
    }
    return reference;
  }

  if (reference.evidenceSetId !== evidenceSet.evidenceSetId) {
    throw new ChangeReviewContractError("Repository reference uses a stale evidence-set ID.");
  }
  const observation = evidenceSet.repositoryObservations.find(
    (candidate) =>
      candidate.observationId === reference.observationId &&
      candidate.path === reference.path &&
      candidate.contentSha256 === reference.contentSha256 &&
      (candidate.scope === "full_file"
        ? reference.line <= (candidate.lineCount ?? 0)
        : candidate.line === reference.line),
  );
  if (!observation) {
    throw new ChangeReviewContractError("Repository reference is not proved by an admitted observation.");
  }
  return reference;
}
