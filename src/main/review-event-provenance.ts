import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ChangeContractIdSchema,
  ChangePathSchema,
  InspectGitChangesRequestV1Schema,
  InspectGitChangesResultV1Schema,
  type ChangeManifestEntryV1,
  type ChangeSnapshotV1,
  type RepositoryObservationV1,
  type ReviewEvidenceSetV1,
} from "../shared/change-review-contracts";
import {
  ReviewEventProvenanceV1Schema,
  VerifiedReviewEvidenceV1Schema,
  type ReviewEvidenceBodyV1,
  type ReviewEventProvenanceV1,
  type ReviewToolResultProvenanceV1,
  type VerifiedReviewEvidenceV1,
} from "../shared/review-synthesis-packet";
import {
  parseStoredSessionEvent,
  type JsonValue,
  type StoredSessionEvent,
} from "../shared/session-events";
import { replaySession } from "../shared/session-reducer";
import {
  parseSuccessfulRepositoryToolObservation,
  workspaceRelativePathForTool,
} from "../shared/tool-observation";
import {
  assertChangeSnapshotIdentity,
  assertReviewEvidenceSetIdentity,
  canonicalChangeJson,
  canonicalizeReviewEvidenceSetV1,
  sha256CanonicalChangeRecord,
} from "./change-acquisition-contracts";

const EVIDENCE_TOOL_NAMES = [
  "inspect_git_changes",
  "read_text_file",
  "search_text",
] as const;

type EvidenceToolName = (typeof EVIDENCE_TOOL_NAMES)[number];

const ReadTextFileRequestSchema = z
  .object({ relativePath: z.string().trim().min(1).max(4_096) })
  .strict();

const ReadTextFileSuccessSchema = z
  .object({
    ok: z.literal(true),
    text: z.string(),
    bytes: z.number().int().nonnegative().safe(),
    truncated: z.literal(false),
  })
  .strict();

const SearchTextRequestSchema = z
  .object({
    query: z.string().min(1).max(512),
    relativePath: z.string().trim().min(1).max(4_096).optional(),
    caseSensitive: z.boolean().optional(),
    maxDepth: z.number().int().min(1).max(20).optional(),
    maxMatches: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const SearchTextSuccessSchema = z
  .object({
    ok: z.literal(true),
    matches: z
      .array(
        z
          .object({
            path: ChangePathSchema,
            lineNumber: z.number().int().positive().safe(),
            text: z.string().max(1_024),
            textTruncated: z.literal(false),
          })
          .strict(),
      )
      .max(500),
    count: z.number().int().nonnegative().safe(),
    filesSearched: z.number().int().nonnegative().safe(),
    bytesScanned: z.number().int().nonnegative().safe(),
    skipped: z
      .object({
        binary: z.number().int().nonnegative().safe(),
        ignored: z.number().int().nonnegative().safe(),
        symlink: z.number().int().nonnegative().safe(),
        tooLarge: z.number().int().nonnegative().safe(),
        unreadable: z.number().int().nonnegative().safe(),
      })
      .strict(),
    truncated: z.literal(false),
    outputBytes: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.count !== result.matches.length) {
      context.addIssue({
        code: "custom",
        message: "Search count must equal the number of returned matches.",
        path: ["count"],
      });
    }
    if (
      result.matches.length > 0 &&
      (result.filesSearched === 0 || result.bytesScanned === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-empty search results require a non-empty scan.",
        path: ["matches"],
      });
    }
  });

interface SuccessfulToolPair {
  request: Extract<StoredSessionEvent, { type: "tool.call.requested" }>;
  completion: Extract<StoredSessionEvent, { type: "tool.call.completed" }>;
  attemptId: string;
  messageId: string;
  toolName: EvidenceToolName;
  provenance: ReviewToolResultProvenanceV1;
}

export class ReviewEventProvenanceError extends Error {
  readonly code = "INVALID_REVIEW_EVENT_PROVENANCE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewEventProvenanceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEvidenceToolName(value: string): value is EvidenceToolName {
  return EVIDENCE_TOOL_NAMES.some((candidate) => candidate === value);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJsonRecord(content: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content) as unknown;
    if (!isRecord(value)) throw new TypeError("Expected a JSON object.");
    return value;
  } catch (error) {
    throw new ReviewEventProvenanceError(
      `${label} did not contain one complete JSON object.`,
      { cause: error },
    );
  }
}

function canonicalEventStream(
  events: readonly StoredSessionEvent[],
): StoredSessionEvent[] {
  try {
    const canonical = events.map((event) => parseStoredSessionEvent(event));
    const state = replaySession(canonical);
    if (state.taskTrack !== "change-review-v1") {
      throw new ReviewEventProvenanceError(
        "Review evidence requires a change-review-v1 session.",
      );
    }
    if (state.executionPolicy?.schemaVersion !== "agentic-execution-v2") {
      throw new ReviewEventProvenanceError(
        "Review evidence requires an agentic-execution-v2 session.",
      );
    }
    return canonical;
  } catch (error) {
    if (error instanceof ReviewEventProvenanceError) throw error;
    throw new ReviewEventProvenanceError(
      "The review event stream is not canonical replay-valid history.",
      { cause: error },
    );
  }
}

function admittedSuccessfulPairs(
  events: readonly StoredSessionEvent[],
): SuccessfulToolPair[] {
  const state = replaySession(events);
  const requests = new Map<
    string,
    Extract<StoredSessionEvent, { type: "tool.call.requested" }>
  >();
  const pairs: SuccessfulToolPair[] = [];

  for (const event of events) {
    if (event.type === "tool.call.requested") {
      requests.set(event.payload.toolCallId, event);
      continue;
    }
    if (
      event.type !== "tool.call.completed" ||
      event.payload.isError ||
      !isEvidenceToolName(event.payload.name)
    ) {
      continue;
    }

    const request = requests.get(event.payload.toolCallId);
    if (!request) {
      throw new ReviewEventProvenanceError(
        `Successful tool result ${event.id} has no canonical request.`,
      );
    }
    const messageId = request.payload.messageId;
    if (messageId === undefined) {
      throw new ReviewEventProvenanceError(
        `Review tool request ${request.id} is missing its v2 message link.`,
      );
    }
    const attempts = state.inferenceAttempts.filter(
      (attempt) => attempt.messageId === messageId,
    );
    if (attempts.length !== 1) {
      throw new ReviewEventProvenanceError(
        `Review tool request ${request.id} does not identify exactly one inference attempt.`,
      );
    }
    const attempt = attempts[0];
    if (
      !attempt ||
      attempt.finished?.outcome !== "succeeded" ||
      attempt.finished.sequence >= request.sequence ||
      !attempt.allowTools ||
      !attempt.allowedToolNames?.includes(event.payload.name)
    ) {
      throw new ReviewEventProvenanceError(
        `Review tool ${event.payload.name} was not admitted by its successful inference attempt.`,
      );
    }
    if (
      request.payload.name !== event.payload.name ||
      request.sequence >= event.sequence
    ) {
      throw new ReviewEventProvenanceError(
        `Review tool result ${event.id} does not match its request.`,
      );
    }

    const toolName = event.payload.name;
    const provenance = ReviewEventProvenanceV1Schema.shape.toolResults.element.parse({
      requestEventId: request.id,
      completionEventId: event.id,
      toolCallId: event.payload.toolCallId,
      attemptId: attempt.attemptId,
      messageId,
      toolName,
      requestSequence: request.sequence,
      completionSequence: event.sequence,
      argumentsSha256: sha256CanonicalChangeRecord(request.payload.arguments),
      resultSha256: sha256Text(event.payload.content),
    });
    pairs.push({
      request,
      completion: event,
      attemptId: attempt.attemptId,
      messageId,
      toolName,
      provenance,
    });
  }
  return pairs;
}

function inspectResult(pair: SuccessfulToolPair): {
  snapshot: ChangeSnapshotV1;
  canonicalResult: string;
} {
  try {
    InspectGitChangesRequestV1Schema.parse(pair.request.payload.arguments);
    const envelope = parseJsonRecord(
      pair.completion.payload.content,
      `Inspection result ${pair.completion.id}`,
    );
    if (envelope.ok !== true) {
      throw new TypeError("Inspection success envelope must set ok=true.");
    }
    const keys = Object.keys(envelope).sort();
    if (
      JSON.stringify(keys) !==
      JSON.stringify(["evidenceMap", "ok", "schemaVersion", "snapshot"])
    ) {
      throw new TypeError("Inspection success envelope contains unknown fields.");
    }
    const { ok: _ok, ...candidate } = envelope;
    const result = InspectGitChangesResultV1Schema.parse(candidate);
    const snapshot = assertChangeSnapshotIdentity(result.snapshot);
    return { snapshot, canonicalResult: canonicalChangeJson(result) };
  } catch (error) {
    if (error instanceof ReviewEventProvenanceError) throw error;
    throw new ReviewEventProvenanceError(
      `Inspection result ${pair.completion.id} failed identity or result validation.`,
      { cause: error },
    );
  }
}

function lineTerminator(value: "lf" | "crlf" | "cr" | "none"): string {
  switch (value) {
    case "lf":
      return "\n";
    case "crlf":
      return "\r\n";
    case "cr":
      return "\r";
    case "none":
      return "";
  }
}

function reconstructOneSidedBody(
  entry: ChangeManifestEntryV1,
  side: "base" | "working",
): string | undefined {
  const identity = side === "base" ? entry.base : entry.working;
  if (!identity?.admittedContentSha256) return undefined;
  const numbered = entry.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line) => {
      const lineNumber = side === "base" ? line.oldLine : line.newLine;
      return lineNumber === null ? [] : [{ lineNumber, line }];
    }),
  );
  numbered.sort((left, right) => left.lineNumber - right.lineNumber);
  if (identity.sizeBytes > 0 && numbered.length === 0) return undefined;
  for (let index = 0; index < numbered.length; index += 1) {
    if (numbered[index]?.lineNumber !== index + 1) return undefined;
  }
  const text = numbered
    .map(({ line }) => `${line.content}${lineTerminator(line.terminator)}`)
    .join("");
  if (
    Buffer.byteLength(text, "utf8") !== identity.sizeBytes ||
    sha256Text(text) !== identity.admittedContentSha256
  ) {
    return undefined;
  }
  return text;
}

function requiredCompleteBodySide(
  entry: ChangeManifestEntryV1,
): "base" | "working" | undefined {
  if (entry.changeKind === "deleted") return "base";
  if (entry.changeKind === "added" || entry.changeKind === "untracked") {
    return "working";
  }
  return undefined;
}

function splitCompleteTextLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r\n|\n|\r/u);
  if (/(?:\r\n|\n|\r)$/u.test(text)) lines.pop();
  return lines;
}

function evidenceBodyKey(body: ReviewEvidenceBodyV1): string {
  const position =
    body.kind === "change_body"
      ? body.side
      : body.kind === "repository_file"
        ? "full"
        : String(body.line).padStart(16, "0");
  return [body.kind, body.observationId, body.path, position].join("\0");
}

function compareEvidenceBodies(
  left: ReviewEvidenceBodyV1,
  right: ReviewEvidenceBodyV1,
): number {
  const leftKey = evidenceBodyKey(left);
  const rightKey = evidenceBodyKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function evidencePreimage(input: {
  sessionId: string;
  snapshotId: string;
  evidenceSetId: string;
  toolResults: readonly ReviewToolResultProvenanceV1[];
  evidenceBodies: readonly ReviewEvidenceBodyV1[];
}): object {
  return {
    schemaVersion: "review-event-provenance-v1",
    sessionId: input.sessionId,
    snapshotId: input.snapshotId,
    evidenceSetId: input.evidenceSetId,
    toolResults: input.toolResults,
    evidenceBodies: input.evidenceBodies,
  };
}

function assertStrictOrder<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous && current && compare(previous, current) >= 0) {
      throw new ReviewEventProvenanceError(
        `${label} must be strictly sorted and unique.`,
      );
    }
  }
}

function validateBodyBindings(
  snapshot: ChangeSnapshotV1,
  evidenceSet: ReviewEvidenceSetV1,
  provenance: ReviewEventProvenanceV1,
  bodies: readonly ReviewEvidenceBodyV1[],
): void {
  const resultByCompletion = new Map(
    provenance.toolResults.map((record) => [record.completionEventId, record]),
  );
  const completeBodyKeys = new Set(
    evidenceSet.completeBodies.map((body) =>
      [body.path, body.side, body.contentSha256].join("\0"),
    ),
  );
  const observationKeys = new Set(
    evidenceSet.repositoryObservations.map((observation) =>
      [
        observation.observationId,
        observation.path,
        observation.scope,
        observation.line ?? "full",
        observation.lineCount ?? "line",
        observation.contentSha256,
      ].join("\0"),
    ),
  );

  for (const body of bodies) {
    if (sha256Text(body.text) !== body.contentSha256) {
      throw new ReviewEventProvenanceError(
        `Evidence body ${evidenceBodyKey(body)} does not match its content hash.`,
      );
    }
    const source = resultByCompletion.get(body.observationId);
    if (!source) {
      throw new ReviewEventProvenanceError(
        `Evidence body ${evidenceBodyKey(body)} has no successful source event.`,
      );
    }
    if (body.kind === "change_body") {
      if (source.toolName !== "inspect_git_changes") {
        throw new ReviewEventProvenanceError(
          "Change bodies must come from the admitted inspection result.",
        );
      }
      if (
        !completeBodyKeys.has(
          [body.path, body.side, body.contentSha256].join("\0"),
        )
      ) {
        throw new ReviewEventProvenanceError(
          `Change body ${body.side}:${body.path} is outside the evidence set.`,
        );
      }
      continue;
    }
    if (body.kind === "repository_file") {
      if (source.toolName !== "read_text_file") {
        throw new ReviewEventProvenanceError(
          "Repository file bodies must come from read_text_file.",
        );
      }
      if (splitCompleteTextLines(body.text).length !== body.lineCount) {
        throw new ReviewEventProvenanceError(
          `Repository file body ${body.path} has an invalid line count.`,
        );
      }
      if (
        !observationKeys.has(
          [
            body.observationId,
            body.path,
            "full_file",
            "full",
            body.lineCount,
            body.contentSha256,
          ].join("\0"),
        )
      ) {
        throw new ReviewEventProvenanceError(
          `Repository file body ${body.path} is outside the evidence set.`,
        );
      }
      continue;
    }
    if (source.toolName !== "search_text") {
      throw new ReviewEventProvenanceError(
        "Repository line bodies must come from search_text.",
      );
    }
    if (
      !observationKeys.has(
        [
          body.observationId,
          body.path,
          "matched_line",
          body.line,
          "line",
          body.contentSha256,
        ].join("\0"),
      )
    ) {
      throw new ReviewEventProvenanceError(
        `Repository line body ${body.path}:${body.line} is outside the evidence set.`,
      );
    }
  }

  const representedCompleteBodies = new Set(
    bodies
      .filter((body) => body.kind === "change_body")
      .map((body) => [body.path, body.side, body.contentSha256].join("\0")),
  );
  if (
    [...completeBodyKeys].some((key) => !representedCompleteBodies.has(key))
  ) {
    throw new ReviewEventProvenanceError(
      "The complete evidence set is missing a frozen change body.",
    );
  }
  const representedObservations = new Set(
    bodies
      .filter((body) => body.kind !== "change_body")
      .map((body) =>
        body.kind === "repository_file"
          ? [
              body.observationId,
              body.path,
              "full_file",
              "full",
              body.lineCount,
              body.contentSha256,
            ].join("\0")
          : [
              body.observationId,
              body.path,
              "matched_line",
              body.line,
              "line",
              body.contentSha256,
            ].join("\0"),
      ),
  );
  if ([...observationKeys].some((key) => !representedObservations.has(key))) {
    throw new ReviewEventProvenanceError(
      "The repository evidence set is missing a frozen observation body.",
    );
  }

  assertChangeSnapshotIdentity(snapshot);
}

export function assertVerifiedReviewEvidenceV1(
  input: unknown,
): VerifiedReviewEvidenceV1 {
  const candidate = VerifiedReviewEvidenceV1Schema.parse(input);
  const snapshot = assertChangeSnapshotIdentity(candidate.snapshot);
  const evidenceSet = assertReviewEvidenceSetIdentity(
    candidate.evidenceSet,
    snapshot,
  );
  if (
    candidate.sessionId !== candidate.provenance.sessionId ||
    snapshot.snapshotId !== candidate.provenance.snapshotId ||
    evidenceSet.evidenceSetId !== candidate.provenance.evidenceSetId
  ) {
    throw new ReviewEventProvenanceError(
      "Review provenance identifiers do not match the verified evidence.",
    );
  }
  assertStrictOrder(
    candidate.provenance.toolResults,
    (left, right) => left.completionSequence - right.completionSequence,
    "Tool-result provenance",
  );
  assertStrictOrder(
    candidate.evidenceBodies,
    compareEvidenceBodies,
    "Review evidence bodies",
  );
  validateBodyBindings(
    snapshot,
    evidenceSet,
    candidate.provenance,
    candidate.evidenceBodies,
  );
  const expected = sha256CanonicalChangeRecord(
    evidencePreimage({
      sessionId: candidate.sessionId,
      snapshotId: snapshot.snapshotId,
      evidenceSetId: evidenceSet.evidenceSetId,
      toolResults: candidate.provenance.toolResults,
      evidenceBodies: candidate.evidenceBodies,
    }),
  );
  if (candidate.provenance.provenanceSha256 !== expected) {
    throw new ReviewEventProvenanceError(
      "Review event provenance hash does not match its canonical preimage.",
    );
  }
  return candidate;
}

export function deriveVerifiedReviewEvidenceV1(
  inputEvents: readonly StoredSessionEvent[],
): VerifiedReviewEvidenceV1 {
  const events = canonicalEventStream(inputEvents);
  const sessionId = ChangeContractIdSchema.parse(events[0]?.sessionId);
  const pairs = admittedSuccessfulPairs(events);
  const inspectionPairs = pairs.filter(
    (pair) => pair.toolName === "inspect_git_changes",
  );
  if (inspectionPairs.length === 0) {
    throw new ReviewEventProvenanceError(
      "Review evidence requires one successful admitted change inspection.",
    );
  }

  let selectedInspection:
    | { pair: SuccessfulToolPair; snapshot: ChangeSnapshotV1; canonicalResult: string }
    | undefined;
  for (const pair of inspectionPairs) {
    const inspected = inspectResult(pair);
    if (
      selectedInspection !== undefined &&
      selectedInspection.canonicalResult !== inspected.canonicalResult
    ) {
      throw new ReviewEventProvenanceError(
        "Successful change inspections conflict within one review session.",
      );
    }
    selectedInspection ??= { pair, ...inspected };
  }
  if (!selectedInspection) {
    throw new ReviewEventProvenanceError("No verified inspection was selected.");
  }

  const snapshot = selectedInspection.snapshot;
  const repositoryObservations: RepositoryObservationV1[] = [];
  const evidenceBodies: ReviewEvidenceBodyV1[] = [];
  const completeBodies: ReviewEvidenceSetV1["completeBodies"] = [];
  const readsByPath = new Map<
    string,
    { contentSha256: string; lines: string[] }
  >();
  const searchesByLocation = new Map<string, string>();

  for (const entry of snapshot.manifest) {
    const side = requiredCompleteBodySide(entry);
    if (side === undefined) continue;
    const path = side === "base" ? entry.oldPath : entry.newPath;
    const identity = side === "base" ? entry.base : entry.working;
    if (!path || !identity?.admittedContentSha256) continue;
    const text = reconstructOneSidedBody(entry, side);
    if (text === undefined) {
      if (entry.omissionCodes.length === 0) {
        throw new ReviewEventProvenanceError(
          `Complete ${side} body ${path} cannot be reconstructed from its verified snapshot hunks.`,
        );
      }
      continue;
    }
    completeBodies.push({
      path,
      side,
      contentSha256: identity.admittedContentSha256,
    });
    evidenceBodies.push({
      kind: "change_body",
      observationId: selectedInspection.pair.completion.id,
      path,
      side,
      contentSha256: identity.admittedContentSha256,
      text,
    });
  }

  const expectedWorkingHashes = new Map(
    snapshot.manifest.flatMap((entry) =>
      entry.newPath && entry.working?.admittedContentSha256
        ? [[entry.newPath, entry.working.admittedContentSha256] as const]
        : [],
    ),
  );
  const expectedWorkingHunkLines = new Map<string, string>();
  for (const entry of snapshot.manifest) {
    for (const hunk of entry.hunks) {
      if (!hunk.newPath) continue;
      for (const line of hunk.lines) {
        if (line.newLine === null) continue;
        expectedWorkingHunkLines.set(
          `${hunk.newPath}\0${line.newLine}`,
          sha256Text(line.content),
        );
      }
    }
  }

  for (const pair of pairs) {
    if (pair.toolName === "read_text_file") {
      try {
        ReadTextFileRequestSchema.parse(pair.request.payload.arguments);
        if (
          parseSuccessfulRepositoryToolObservation(
            pair.toolName,
            pair.request.payload.arguments,
            pair.completion.payload.content,
          ) === undefined
        ) {
          throw new TypeError("Read request/result pair failed gateway validation.");
        }
        const result = ReadTextFileSuccessSchema.parse(
          parseJsonRecord(
            pair.completion.payload.content,
            `Read result ${pair.completion.id}`,
          ),
        );
        if (Buffer.byteLength(result.text, "utf8") !== result.bytes) {
          throw new TypeError("Read byte count does not match the complete text.");
        }
        const normalizedPath = workspaceRelativePathForTool(
          pair.toolName,
          pair.request.payload.arguments,
        );
        const path = ChangePathSchema.parse(normalizedPath);
        const contentSha256 = sha256Text(result.text);
        const expectedWorkingHash = expectedWorkingHashes.get(path);
        if (
          expectedWorkingHash !== undefined &&
          expectedWorkingHash !== contentSha256
        ) {
          throw new ReviewEventProvenanceError(
            `Full read ${path} conflicts with the inspected working content.`,
          );
        }
        const existing = readsByPath.get(path);
        if (
          existing !== undefined &&
          existing.contentSha256 !== contentSha256
        ) {
          throw new ReviewEventProvenanceError(
            `Full reads for ${path} conflict within one evidence set.`,
          );
        }
        const lines = splitCompleteTextLines(result.text);
        readsByPath.set(path, { contentSha256, lines });
        repositoryObservations.push({
          observationId: pair.completion.id,
          toolName: "read_text_file",
          scope: "full_file",
          path,
          line: null,
          lineCount: lines.length,
          contentSha256,
        });
        evidenceBodies.push({
          kind: "repository_file",
          observationId: pair.completion.id,
          path,
          lineCount: lines.length,
          contentSha256,
          text: result.text,
        });
      } catch (error) {
        if (error instanceof ReviewEventProvenanceError) throw error;
        throw new ReviewEventProvenanceError(
          `Read result ${pair.completion.id} is not complete verified evidence.`,
          { cause: error },
        );
      }
      continue;
    }
    if (pair.toolName === "search_text") {
      try {
        SearchTextRequestSchema.parse(pair.request.payload.arguments);
        if (
          parseSuccessfulRepositoryToolObservation(
            pair.toolName,
            pair.request.payload.arguments,
            pair.completion.payload.content,
          ) === undefined
        ) {
          throw new TypeError("Search request/result pair failed gateway validation.");
        }
        const result = SearchTextSuccessSchema.parse(
          parseJsonRecord(
            pair.completion.payload.content,
            `Search result ${pair.completion.id}`,
          ),
        );
        const localLocations = new Set<string>();
        for (const match of result.matches) {
          const location = `${match.path}\0${match.lineNumber}`;
          if (localLocations.has(location)) {
            throw new ReviewEventProvenanceError(
              `Search result ${pair.completion.id} repeats ${match.path}:${match.lineNumber}.`,
            );
          }
          localLocations.add(location);
          const contentSha256 = sha256Text(match.text);
          const existing = searchesByLocation.get(location);
          if (existing !== undefined && existing !== contentSha256) {
            throw new ReviewEventProvenanceError(
              `Search observations for ${match.path}:${match.lineNumber} conflict.`,
            );
          }
          const expectedHunkLine = expectedWorkingHunkLines.get(location);
          if (
            expectedHunkLine !== undefined &&
            expectedHunkLine !== contentSha256
          ) {
            throw new ReviewEventProvenanceError(
              `Search observation ${match.path}:${match.lineNumber} conflicts with the inspected hunk.`,
            );
          }
          searchesByLocation.set(location, contentSha256);
          repositoryObservations.push({
            observationId: pair.completion.id,
            toolName: "search_text",
            scope: "matched_line",
            path: match.path,
            line: match.lineNumber,
            lineCount: null,
            contentSha256,
          });
          evidenceBodies.push({
            kind: "repository_line",
            observationId: pair.completion.id,
            path: match.path,
            line: match.lineNumber,
            contentSha256,
            text: match.text,
          });
        }
      } catch (error) {
        if (error instanceof ReviewEventProvenanceError) throw error;
        throw new ReviewEventProvenanceError(
          `Search result ${pair.completion.id} is not complete verified evidence.`,
          { cause: error },
        );
      }
    }
  }

  for (const [location, searchHash] of searchesByLocation) {
    const separator = location.lastIndexOf("\0");
    const path = location.slice(0, separator);
    const line = Number(location.slice(separator + 1));
    const read = readsByPath.get(path);
    if (!read) continue;
    const readLine = read.lines[line - 1];
    if (readLine === undefined || sha256Text(readLine) !== searchHash) {
      throw new ReviewEventProvenanceError(
        `Search observation ${path}:${line} conflicts with the complete file read.`,
      );
    }
  }

  evidenceBodies.sort(compareEvidenceBodies);
  const evidenceSet = canonicalizeReviewEvidenceSetV1({
    schemaVersion: "review-evidence-set-v1",
    snapshotId: snapshot.snapshotId,
    changeHunkSha256s: snapshot.manifest
      .flatMap((entry) => entry.hunks.map((hunk) => hunk.hunkSha256))
      .sort(),
    completeBodies,
    repositoryObservations,
  });
  assertReviewEvidenceSetIdentity(evidenceSet, snapshot);
  const toolResults = pairs
    .map((pair) => pair.provenance)
    .sort((left, right) => left.completionSequence - right.completionSequence);
  const provenanceSha256 = sha256CanonicalChangeRecord(
    evidencePreimage({
      sessionId,
      snapshotId: snapshot.snapshotId,
      evidenceSetId: evidenceSet.evidenceSetId,
      toolResults,
      evidenceBodies,
    }),
  );
  const provenance = ReviewEventProvenanceV1Schema.parse({
    schemaVersion: "review-event-provenance-v1",
    sessionId,
    snapshotId: snapshot.snapshotId,
    evidenceSetId: evidenceSet.evidenceSetId,
    toolResults,
    provenanceSha256,
  });
  return assertVerifiedReviewEvidenceV1({
    schemaVersion: "verified-review-evidence-v1",
    sessionId,
    snapshot,
    evidenceSet,
    provenance,
    evidenceBodies,
  });
}

export function reviewEventResultHash(content: string): string {
  return sha256Text(content);
}

export function reviewEventArgumentsHash(arguments_: JsonValue): string {
  return sha256CanonicalChangeRecord(arguments_);
}
