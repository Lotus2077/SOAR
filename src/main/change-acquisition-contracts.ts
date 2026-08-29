import { createHash } from "node:crypto";

import {
  ChangeHunkPreimageV1Schema,
  ChangeHunkV1Schema,
  ChangePathSchema,
  ChangeSnapshotPreimageV1Schema,
  ChangeSnapshotV1Schema,
  GitFileModeSchema,
  GitObjectIdSchema,
  InspectGitChangesResultV1Schema,
  ReviewCoverageV1Schema,
  ReviewEvidenceSetPreimageV1Schema,
  ReviewEvidenceSetV1Schema,
  assertReviewEvidenceRefShapeAdmitted,
  changeManifestEntryPath,
  compareChangeBodyEvidence,
  compareChangeHunks,
  compareChangeManifestEntries,
  compareRepositoryObservations,
  isChangedTestPathV1,
  type ChangeBodyEvidenceV1,
  type ChangeHunkPreimageV1,
  type ChangeHunkV1,
  type ChangeManifestEntryV1,
  type ChangeManifestOmissionCode,
  type ChangeSnapshotPreimageV1,
  type ChangeSnapshotV1,
  type InspectGitChangesResultV1,
  type RepositoryObservationV1,
  type ReviewCoverageOmissionCode,
  type ReviewCoverageV1,
  type ReviewEvidenceSetPreimageV1,
  type ReviewEvidenceSetV1,
  type ReviewEvidenceRef,
  type ReviewFileCoverageV1,
} from "../shared/change-review-contracts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** RFC-8785-style key ordering for the JSON-only contract values used here. */
export function canonicalChangeJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Canonical change records contain safe integers only.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalChangeJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError("Canonical change records contain JSON values only.");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical change records require plain objects.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareText);
  if (keys.some((key) => record[key] === undefined)) {
    throw new TypeError("Canonical change records cannot contain undefined values.");
  }
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalChangeJson(record[key])}`)
    .join(",")}}`;
}

export function sha256CanonicalChangeRecord(value: unknown): string {
  return createHash("sha256")
    .update(canonicalChangeJson(value), "utf8")
    .digest("hex");
}

export interface GitIndexStageEntryV1 {
  mode: "100644" | "100755" | "120000" | "160000";
  objectId: string;
  stage: 0 | 1 | 2 | 3;
  path: string;
}

function compareGitIndexEntries(
  left: GitIndexStageEntryV1,
  right: GitIndexStageEntryV1,
): number {
  return compareText(left.path, right.path) || left.stage - right.stage;
}

/**
 * Canonicalize parsed `git ls-files --stage -z` records. Acquisition rejects
 * paths outside the shared path contract before calling this primitive.
 */
export function canonicalGitIndexStageOutput(
  input: readonly GitIndexStageEntryV1[],
): string {
  const entries = input
    .map((entry) => ({
      mode: GitFileModeSchema.parse(entry.mode),
      objectId: GitObjectIdSchema.parse(entry.objectId),
      stage: zIndexStage(entry.stage),
      path: ChangePathSchema.parse(entry.path),
    }))
    .sort(compareGitIndexEntries);

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous && current && previous.path === current.path && previous.stage === current.stage) {
      throw new Error(`Duplicate Git index stage record (${current.path}, stage ${current.stage}).`);
    }
  }
  return entries
    .map((entry) => `${entry.mode} ${entry.objectId} ${entry.stage}\t${entry.path}\0`)
    .join("");
}

function zIndexStage(value: number): 0 | 1 | 2 | 3 {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new TypeError("Git index stage must be 0, 1, 2, or 3.");
  }
  return value;
}

export function sha256GitIndexStageEntries(
  entries: readonly GitIndexStageEntryV1[],
): string {
  return createHash("sha256")
    .update(canonicalGitIndexStageOutput(entries), "utf8")
    .digest("hex");
}

export function changeHunkPreimage(hunk: ChangeHunkV1): ChangeHunkPreimageV1 {
  return {
    schemaVersion: hunk.schemaVersion,
    oldPath: hunk.oldPath,
    newPath: hunk.newPath,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  };
}

export function buildChangeHunkV1(input: unknown): ChangeHunkV1 {
  const preimage = ChangeHunkPreimageV1Schema.parse(input);
  return ChangeHunkV1Schema.parse({
    ...preimage,
    hunkSha256: sha256CanonicalChangeRecord(preimage),
  });
}

export function assertChangeHunkIdentity(input: unknown): ChangeHunkV1 {
  const hunk = ChangeHunkV1Schema.parse(input);
  const expected = sha256CanonicalChangeRecord(changeHunkPreimage(hunk));
  if (hunk.hunkSha256 !== expected) {
    throw new Error(`Change hunk identity mismatch (${hunk.hunkSha256} != ${expected}).`);
  }
  return hunk;
}

function canonicalManifestEntry(entryInput: unknown): ChangeManifestEntryV1 {
  const candidate = entryInput as ChangeManifestEntryV1;
  const hunks = Array.isArray(candidate?.hunks)
    ? candidate.hunks.map(assertChangeHunkIdentity).sort(compareChangeHunks)
    : candidate?.hunks;
  return {
    ...candidate,
    omissionCodes: Array.isArray(candidate?.omissionCodes)
      ? [...candidate.omissionCodes].sort(compareText)
      : candidate?.omissionCodes,
    hunks,
  } as ChangeManifestEntryV1;
}

function canonicalSnapshotPreimage(input: unknown): ChangeSnapshotPreimageV1 {
  const candidate = input as ChangeSnapshotPreimageV1;
  const manifest = Array.isArray(candidate?.manifest)
    ? candidate.manifest.map(canonicalManifestEntry).sort(compareChangeManifestEntries)
    : candidate?.manifest;
  const canonical = {
    ...candidate,
    manifest,
    manifestOmissionCodes: Array.isArray(candidate?.manifestOmissionCodes)
      ? [...candidate.manifestOmissionCodes].sort(compareText)
      : candidate?.manifestOmissionCodes,
  };
  return ChangeSnapshotPreimageV1Schema.parse(canonical);
}

/** snapshotId is SHA-256(canonical JSON of this exact ID-free preimage). */
export function changeSnapshotPreimage(snapshot: ChangeSnapshotV1): ChangeSnapshotPreimageV1 {
  return {
    schemaVersion: snapshot.schemaVersion,
    baseCommitOid: snapshot.baseCommitOid,
    indexSha256: snapshot.indexSha256,
    discoverySha256: snapshot.discoverySha256,
    manifest: snapshot.manifest,
    omittedPathCount: snapshot.omittedPathCount,
    omittedHunkCount: snapshot.omittedHunkCount,
    manifestOmissionCodes: snapshot.manifestOmissionCodes,
  };
}

export function buildChangeSnapshotV1(input: unknown): ChangeSnapshotV1 {
  const preimage = canonicalSnapshotPreimage(input);
  return ChangeSnapshotV1Schema.parse({
    ...preimage,
    snapshotId: sha256CanonicalChangeRecord(preimage),
  });
}

export function assertChangeSnapshotIdentity(input: unknown): ChangeSnapshotV1 {
  const snapshot = ChangeSnapshotV1Schema.parse(input);
  snapshot.manifest.forEach((entry) => entry.hunks.forEach(assertChangeHunkIdentity));
  const expected = sha256CanonicalChangeRecord(changeSnapshotPreimage(snapshot));
  if (snapshot.snapshotId !== expected) {
    throw new Error(
      `Change snapshot identity mismatch (${snapshot.snapshotId} != ${expected}).`,
    );
  }
  return snapshot;
}

export function buildInspectGitChangesResultV1(
  snapshotInput: unknown,
): InspectGitChangesResultV1 {
  const snapshot = assertChangeSnapshotIdentity(snapshotInput);
  const evidenceMap = snapshot.manifest
    .flatMap((entry) =>
      entry.hunks.map((hunk) => ({
        hunkSha256: hunk.hunkSha256,
        oldPath: hunk.oldPath,
        newPath: hunk.newPath,
        baseLines: hunk.lines.flatMap((line) =>
          line.oldLine === null ? [] : [line.oldLine],
        ),
        workingLines: hunk.lines.flatMap((line) =>
          line.newLine === null ? [] : [line.newLine],
        ),
      })),
    )
    .sort((left, right) => compareText(left.hunkSha256, right.hunkSha256));
  return InspectGitChangesResultV1Schema.parse({
    schemaVersion: "inspect-git-changes-result-v1",
    snapshot,
    evidenceMap,
  });
}

function canonicalEvidenceSetPreimage(input: unknown): ReviewEvidenceSetPreimageV1 {
  const candidate = input as ReviewEvidenceSetPreimageV1;
  const canonical = {
    ...candidate,
    changeHunkSha256s: Array.isArray(candidate?.changeHunkSha256s)
      ? [...candidate.changeHunkSha256s].sort(compareText)
      : candidate?.changeHunkSha256s,
    completeBodies: Array.isArray(candidate?.completeBodies)
      ? [...candidate.completeBodies].sort(compareChangeBodyEvidence)
      : candidate?.completeBodies,
    repositoryObservations: Array.isArray(candidate?.repositoryObservations)
      ? [...candidate.repositoryObservations].sort(compareRepositoryObservations)
      : candidate?.repositoryObservations,
  };
  return ReviewEvidenceSetPreimageV1Schema.parse(canonical);
}

/** evidenceSetId is SHA-256(canonical JSON of this exact ID-free preimage). */
export function reviewEvidenceSetPreimage(
  evidenceSet: ReviewEvidenceSetV1,
): ReviewEvidenceSetPreimageV1 {
  return {
    schemaVersion: evidenceSet.schemaVersion,
    snapshotId: evidenceSet.snapshotId,
    changeHunkSha256s: evidenceSet.changeHunkSha256s,
    completeBodies: evidenceSet.completeBodies,
    repositoryObservations: evidenceSet.repositoryObservations,
  };
}

/**
 * Canonicalize observation-shaped records and bind their identity. This does
 * not prove that repository observations came from successful gateway events;
 * PR5's host workflow must do that before calling this primitive.
 */
export function canonicalizeReviewEvidenceSetV1(input: unknown): ReviewEvidenceSetV1 {
  const preimage = canonicalEvidenceSetPreimage(input);
  return ReviewEvidenceSetV1Schema.parse({
    ...preimage,
    evidenceSetId: sha256CanonicalChangeRecord(preimage),
  });
}

function snapshotHunkIds(snapshot: ChangeSnapshotV1): Set<string> {
  return new Set(
    snapshot.manifest.flatMap((entry) => entry.hunks.map((hunk) => hunk.hunkSha256)),
  );
}

function snapshotSideHash(
  snapshot: ChangeSnapshotV1,
  body: ChangeBodyEvidenceV1,
): string | null | undefined {
  const entry = snapshot.manifest.find((candidate) =>
    body.side === "base"
      ? candidate.oldPath === body.path
      : candidate.newPath === body.path,
  );
  return body.side === "base"
    ? entry?.base?.admittedContentSha256
    : entry?.working?.admittedContentSha256;
}

function snapshotSideRequiresCompleteBody(
  snapshot: ChangeSnapshotV1,
  body: ChangeBodyEvidenceV1,
): boolean {
  const entry = snapshot.manifest.find((candidate) =>
    body.side === "base"
      ? candidate.oldPath === body.path
      : candidate.newPath === body.path,
  );
  return (
    (body.side === "base" && entry?.changeKind === "deleted") ||
    (body.side === "working" &&
      (entry?.changeKind === "added" || entry?.changeKind === "untracked"))
  );
}

export function assertReviewEvidenceSetIdentity(
  evidenceSetInput: unknown,
  snapshotInput?: unknown,
): ReviewEvidenceSetV1 {
  const evidenceSet = ReviewEvidenceSetV1Schema.parse(evidenceSetInput);
  const expected = sha256CanonicalChangeRecord(reviewEvidenceSetPreimage(evidenceSet));
  if (evidenceSet.evidenceSetId !== expected) {
    throw new Error(
      `Review evidence-set identity mismatch (${evidenceSet.evidenceSetId} != ${expected}).`,
    );
  }
  if (snapshotInput === undefined) return evidenceSet;

  const snapshot = assertChangeSnapshotIdentity(snapshotInput);
  if (evidenceSet.snapshotId !== snapshot.snapshotId) {
    throw new Error("Review evidence set belongs to a different change snapshot.");
  }
  const allowedHunks = snapshotHunkIds(snapshot);
  const unknownHunk = evidenceSet.changeHunkSha256s.find((hash) => !allowedHunks.has(hash));
  if (unknownHunk) {
    throw new Error(`Review evidence set contains an unknown change hunk (${unknownHunk}).`);
  }
  const invalidBody = evidenceSet.completeBodies.find(
    (body) =>
      !snapshotSideRequiresCompleteBody(snapshot, body) ||
      snapshotSideHash(snapshot, body) !== body.contentSha256,
  );
  if (invalidBody) {
    throw new Error(
      `Review evidence body is not a required complete side or does not match snapshot content (${invalidBody.side}:${invalidBody.path}).`,
    );
  }
  return evidenceSet;
}

/** Verify both immutable records before admitting a side-aware reference. */
export function assertReviewEvidenceRefAdmitted(
  referenceInput: unknown,
  snapshotInput: unknown,
  evidenceSetInput: unknown,
): ReviewEvidenceRef {
  const snapshot = assertChangeSnapshotIdentity(snapshotInput);
  const evidenceSet = assertReviewEvidenceSetIdentity(evidenceSetInput, snapshot);
  return assertReviewEvidenceRefShapeAdmitted(referenceInput, snapshot, evidenceSet);
}

function isRuntimePath(path: string): boolean {
  return path.startsWith("src/");
}

function requiredReadSide(entry: ChangeManifestEntryV1): "base" | "working" {
  return entry.changeKind === "deleted" ? "base" : "working";
}

function completeBodyRequired(entry: ChangeManifestEntryV1): boolean {
  return ["added", "deleted", "untracked"].includes(entry.changeKind);
}

function hasMatchingBody(
  bodies: readonly ChangeBodyEvidenceV1[],
  path: string,
  side: "base" | "working",
  contentSha256: string | null | undefined,
): boolean {
  return (
    contentSha256 !== null &&
    contentSha256 !== undefined &&
    bodies.some(
      (body) =>
        body.path === path &&
        body.side === side &&
        body.contentSha256 === contentSha256,
    )
  );
}

function hasMatchingFullRead(
  observations: readonly RepositoryObservationV1[],
  path: string,
  contentSha256: string | null | undefined,
): boolean {
  return (
    contentSha256 !== null &&
    contentSha256 !== undefined &&
    observations.some(
      (observation) =>
        observation.scope === "full_file" &&
        observation.path === path &&
        observation.contentSha256 === contentSha256,
    )
  );
}

function canonicalCodes<T extends string>(codes: readonly T[]): T[] {
  return [...new Set(codes)].sort(compareText);
}

export interface DeriveReviewCoverageV1Input {
  snapshot: unknown;
  evidenceSet: unknown;
  packetRetainedEvidenceSet: boolean;
  snapshotRevalidated: boolean;
}

/**
 * Host-only coverage derivation. Callers provide observations and two explicit
 * acceptance-time gates; no model-authored field can promote coverage.
 */
export function deriveReviewCoverageV1(
  input: DeriveReviewCoverageV1Input,
): ReviewCoverageV1 {
  const snapshot = assertChangeSnapshotIdentity(input.snapshot);
  const evidenceSet = assertReviewEvidenceSetIdentity(input.evidenceSet, snapshot);
  const retainedHunks = new Set(evidenceSet.changeHunkSha256s);

  const files: ReviewFileCoverageV1[] = snapshot.manifest
    .map((entry): ReviewFileCoverageV1 => {
      const path = changeManifestEntryPath(entry);
      const side = requiredReadSide(entry);
      const contentSha256 =
        side === "base"
          ? entry.base?.admittedContentSha256
          : entry.working?.admittedContentSha256;
      const retainedHunkCount = entry.hunks.filter((hunk) =>
        retainedHunks.has(hunk.hunkSha256),
      ).length;
      const bodyRequired = completeBodyRequired(entry);
      const bodyRetained =
        bodyRequired &&
        hasMatchingBody(evidenceSet.completeBodies, path, side, contentSha256);
      const fullRead =
        bodyRetained ||
        hasMatchingFullRead(
          evidenceSet.repositoryObservations,
          path,
          contentSha256,
        );
      const coverageOmissionCodes: ReviewCoverageOmissionCode[] = [];
      if (entry.hunks.length !== retainedHunkCount) {
        coverageOmissionCodes.push("change_hunk_not_retained");
      }
      if (bodyRequired && !bodyRetained) {
        coverageOmissionCodes.push("complete_body_not_retained");
      }
      if (!fullRead) {
        coverageOmissionCodes.push("changed_file_not_fully_read");
      }
      if (entry.omissionCodes.length > 0) {
        coverageOmissionCodes.push("manifest_path_omitted");
      }
      return {
        path,
        oldPath: entry.oldPath,
        newPath: entry.newPath,
        changeKind: entry.changeKind,
        requiredReadSide: side,
        fullRead,
        completeBodyRequired: bodyRequired,
        completeBodyRetained: bodyRetained,
        hunkCount: entry.hunks.length,
        retainedHunkCount,
        changedTest: [entry.oldPath, entry.newPath].some(
          (candidate) =>
            candidate !== null && isChangedTestPathV1(candidate),
        ),
        manifestOmissionCodes: canonicalCodes<ChangeManifestOmissionCode>(
          entry.omissionCodes,
        ),
        coverageOmissionCodes: canonicalCodes(coverageOmissionCodes),
      };
    })
    .sort((left, right) => compareText(left.path, right.path));

  const knownHunkCount = files.reduce((sum, file) => sum + file.hunkCount, 0);
  const admittedHunkCount = files.reduce(
    (sum, file) => sum + file.retainedHunkCount,
    0,
  );
  const changedPathCount = files.length + snapshot.omittedPathCount;
  const fullyAdmittedPathCount = files.filter(
    (file) =>
      file.manifestOmissionCodes.length === 0 &&
      file.coverageOmissionCodes.length === 0,
  ).length;
  const omittedPathCount = changedPathCount - fullyAdmittedPathCount;
  const changedHunkCount = knownHunkCount + snapshot.omittedHunkCount;
  const omittedHunkCount = changedHunkCount - admittedHunkCount;
  const manifestComplete =
    snapshot.omittedPathCount === 0 &&
    snapshot.omittedHunkCount === 0 &&
    snapshot.manifestOmissionCodes.length === 0 &&
    files.every((file) => file.manifestOmissionCodes.length === 0);

  const omissionCodes: ReviewCoverageOmissionCode[] = [];
  if (!manifestComplete) omissionCodes.push("manifest_incomplete");
  if (
    snapshot.omittedPathCount > 0 ||
    files.some((file) => file.manifestOmissionCodes.length > 0)
  ) {
    omissionCodes.push("manifest_path_omitted");
  }
  if (omittedHunkCount > 0) omissionCodes.push("change_hunk_not_retained");
  if (files.some((file) => !file.completeBodyRetained && file.completeBodyRequired)) {
    omissionCodes.push("complete_body_not_retained");
  }
  if (files.some((file) => !file.fullRead)) {
    omissionCodes.push("changed_file_not_fully_read");
  }
  if (!input.packetRetainedEvidenceSet) {
    omissionCodes.push("packet_evidence_not_retained");
  }
  if (!input.snapshotRevalidated) {
    omissionCodes.push("snapshot_not_revalidated");
  }

  const changedTestPaths = [
    ...new Set(
      snapshot.manifest.flatMap((entry) =>
        [entry.oldPath, entry.newPath].filter(
          (candidate): candidate is string =>
            candidate !== null && isChangedTestPathV1(candidate),
        ),
      ),
    ),
  ].sort(compareText);
  const runtimeCodeChangedWithoutChangedTest =
    snapshot.manifest.some((entry) =>
      [entry.oldPath, entry.newPath].some(
        (candidate) => candidate !== null && isRuntimePath(candidate),
      ),
    ) && changedTestPaths.length === 0;
  const canonicalOmissions = canonicalCodes(omissionCodes);

  return ReviewCoverageV1Schema.parse({
    schemaVersion: "review-coverage-v1",
    snapshotId: snapshot.snapshotId,
    evidenceSetId: evidenceSet.evidenceSetId,
    status: canonicalOmissions.length === 0 ? "complete" : "incomplete",
    manifestStatus: manifestComplete ? "complete" : "incomplete",
    counts: {
      changedPaths: changedPathCount,
      admittedPaths: fullyAdmittedPathCount,
      omittedPaths: omittedPathCount,
      changedHunks: changedHunkCount,
      admittedHunks: admittedHunkCount,
      omittedHunks: omittedHunkCount,
    },
    files,
    changedTestPaths,
    runtimeCodeChangedWithoutChangedTest,
    packetRetainedEvidenceSet: input.packetRetainedEvidenceSet,
    snapshotRevalidated: input.snapshotRevalidated,
    omissionCodes: canonicalOmissions,
  });
}

export interface AssertReviewCoverageV1Input extends DeriveReviewCoverageV1Input {
  coverage: unknown;
}

/**
 * Replay-safe coverage verification. Shape validation alone is not an
 * acceptance decision: every derived field is recomputed from the verified
 * snapshot/evidence set and fresh host gate facts.
 */
export function assertReviewCoverageV1(
  input: AssertReviewCoverageV1Input,
): ReviewCoverageV1 {
  const candidate = ReviewCoverageV1Schema.parse(input.coverage);
  const expected = deriveReviewCoverageV1({
    snapshot: input.snapshot,
    evidenceSet: input.evidenceSet,
    packetRetainedEvidenceSet: input.packetRetainedEvidenceSet,
    snapshotRevalidated: input.snapshotRevalidated,
  });
  if (canonicalChangeJson(candidate) !== canonicalChangeJson(expected)) {
    throw new Error("Review coverage does not match host-derived coverage.");
  }
  return candidate;
}
