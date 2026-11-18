import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

/** The archive: every entry up to the switch to one file per entry. It is frozen: no pull request changes it. */
export const BUILD_LOG_PATH = "docs/BUILD_LOG.md";
/**
 * The archive's sha256 at the switch. Any other bytes fail, with or without a base, so the archive cannot change even through a
 * pull request whose checks ran before the switch; a repair restores these bytes.
 */
export const ARCHIVE_SHA256 = "fcf19e4379c084bd21bb210cdb841080b33efbc590df1420d095d410f0d77e2f";
/** One file per entry since the switch, named by its ID; files on the base never change. */
export const BUILD_LOG_ENTRY_DIRECTORY = "docs/build-log";
/** An entry is about 25 lines, with the detail in the pull request's description; above this is a warning, never an error. */
export const ENTRY_FILE_SOFT_LINE_LIMIT = 40;

export const ALLOWED_BUILD_LOG_STATUSES = [
  "Proposed",
  "Approved",
  "In progress",
  "Implemented",
  "Verified",
  "Released",
  "Blocked",
  "Failed",
  "Superseded",
  "Reverted",
] as const;

export const REQUIRED_BUILD_LOG_FIELDS = [
  "Status",
  "Scope or hypothesis",
  "Decisions",
  "Changes",
  "Evidence",
  "Failures or blockers",
  "Limitations and non-claims",
  "Paid exposure",
  "Next gate",
  "References",
] as const;

export interface ParsedBuildLogEntry {
  id: string;
  date: string;
  title: string;
  fields: Readonly<Record<string, string>>;
  startLine: number;
  sourceSha256: string;
}

export interface MissingBuildLogField {
  entryId: string;
  entrySha256: string;
  field: string;
  correctedBy?: string;
}

export interface BuildLogValidationResult {
  entries: readonly ParsedBuildLogEntry[];
  errors: readonly string[];
  /** Original omissions remain visible; corrections never populate historical fields. */
  missingFields: readonly MissingBuildLogField[];
}

interface HeadingMatch {
  id: string;
  date: string;
  title: string;
  index: number;
  endIndex: number;
  startLine: number;
}

const HISTORY_MARKER = "## Backfilled project history";
const ENTRY_HEADING = /^### (BL-[a-zA-Z0-9-]+) -- (\d{4}-\d{2}-\d{2}) -- (.+)$/gmu;
const MODERN_ID = /^BL-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/u;
const HISTORICAL_ID = /^BL-(\d{4})$/u;
const TIMESTAMP_SEQUENCE_RESET_MARKER =
  /^Timestamp sequence reset after: `(BL-(?:\d{4}|\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*))`\.$/gmu;
const TIMESTAMP_SEQUENCE_RESET_PREFIX = "Timestamp sequence reset after:";
const FIELD_CORRECTION_PREFIX = "Missing-field correction:";
const FIELD_CORRECTION_MARKER =
  /^Missing-field correction: `(BL-[a-zA-Z0-9-]+)` SHA-256 `([a-f0-9]{64})`; field `([^`\r\n]+)`\.$/gmu;
export const KNOWN_TIMESTAMP_SEQUENCE_RESETS = Object.freeze({
  "BL-20260830-1454-build-log-utc-reset":
    "BL-20260830-2050-heldout-readiness-approved",
  "BL-20260902-0357-pr6ra-utc-reset": "BL-20260902-0445-pr6ra-approved",
  "BL-20260913-1555-desktop-research-utc-reset":
    "BL-20260913-2328-desktop-general-complete",
  "BL-20261105-1357-second-check-corrections-utc-reset":
    "BL-20261105-2016-correction-direction-and-review-entries",
} as const);
const ALLOWED_STATUS_SET = new Set<string>(ALLOWED_BUILD_LOG_STATUSES);
const HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "pre",
  "script",
  "search",
  "section",
  "style",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);
const HTML_RAW_BLOCK_TAGS = new Set(["pre", "script", "style", "textarea"]);

export function maskMarkdownBlocks(text: string): string {
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;
  let htmlComment = false;
  let htmlBlockTag: string | undefined;
  let masked = "";

  for (const match of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const rawLine = match[0];
    if (rawLine.length === 0) continue;
    const hasNewline = rawLine.endsWith("\n");
    const line = hasNewline ? rawLine.slice(0, -1) : rawLine;
    let mask = false;

    if (fenceCharacter !== undefined) {
      mask = true;
      const closing = new RegExp(
        `^[ \\t]{0,3}${fenceCharacter}{${fenceLength},}[ \\t]*\\r?$`,
        "u",
      );
      if (closing.test(line)) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
    } else if (htmlComment) {
      mask = true;
      if (line.includes("-->")) htmlComment = false;
    } else if (htmlBlockTag !== undefined) {
      mask = true;
      if (new RegExp(`</${htmlBlockTag}>`, "iu").test(line)) {
        htmlBlockTag = undefined;
      }
    } else {
      const fence = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(line);
      if (fence !== null) {
        mask = true;
        fenceCharacter = fence[1][0] as "`" | "~";
        fenceLength = fence[1].length;
      } else if (line.includes("<!--")) {
        mask = true;
        htmlComment = !line.includes("-->");
      } else {
        const htmlOpen = /^[ \t]{0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t/>]|$)/u.exec(
          line,
        );
        const tag = htmlOpen?.[1]?.toLowerCase();
        if (
          tag !== undefined &&
          (HTML_BLOCK_TAGS.has(tag) || HTML_RAW_BLOCK_TAGS.has(tag))
        ) {
          mask = true;
          if (
            !new RegExp(`</${tag}>`, "iu").test(line) &&
            !/\/>[ \t]*\r?$/u.test(line)
          ) {
            htmlBlockTag = tag;
          }
        }
      }
    }

    masked += mask ? line.replace(/[^\r]/gu, " ") : line;
    if (hasNewline) masked += "\n";
  }
  return masked;
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Raw UTF-8 entry bytes, excluding only trailing blank separators/final newline. */
export function buildLogEntrySha256(source: string): string {
  return createHash("sha256")
    .update(source.replace(/(?:\r?\n[ \t]*)+$/u, ""), "utf8")
    .digest("hex");
}

function isCanonicalDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function parseFields(
  body: string,
  maskedBody: string,
  entry: Pick<ParsedBuildLogEntry, "id" | "startLine">,
  errors: string[],
): Readonly<Record<string, string>> {
  const escapedFields = REQUIRED_BUILD_LOG_FIELDS.map((field) =>
    field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  ).join("|");
  const fieldPattern = new RegExp(
    `^(${escapedFields}):[ \\t]*(.*)$`,
    "gmu",
  );
  const matches = [...maskedBody.matchAll(fieldPattern)];
  const fields: Record<string, string> = {};

  if (body.slice(0, matches[0]?.index ?? body.length).trim().length > 0) {
    errors.push(
      `${entry.id} (line ${entry.startLine}): content appears before the Status field`,
    );
  }

  for (const [index, match] of matches.entries()) {
    const name = match[1];
    const inlineValue = match[2];
    if (fields[name] !== undefined) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): duplicate field ${name}`,
      );
      continue;
    }
    const followingStart = (match.index ?? 0) + match[0].length;
    const followingEnd = matches[index + 1]?.index ?? body.length;
    fields[name] = `${inlineValue}\n${body.slice(followingStart, followingEnd)}`.trim();
  }

  const actualOrder = matches.map((match) => match[1]);
  for (const field of REQUIRED_BUILD_LOG_FIELDS) {
    if (fields[field] !== undefined && fields[field].length === 0) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): field ${field} is empty`,
      );
    }
  }
  const expectedOrder = REQUIRED_BUILD_LOG_FIELDS.filter(field => fields[field] !== undefined);
  if (actualOrder.some((field, index) => field !== expectedOrder[index])) {
    errors.push(
      `${entry.id} (line ${entry.startLine}): required fields are out of order`,
    );
  }

  return fields;
}

export function validateBuildLog(text: string): BuildLogValidationResult {
  const errors: string[] = [];
  const missingFields: MissingBuildLogField[] = [];
  const markerIndex = text.indexOf(HISTORY_MARKER);
  if (markerIndex < 0) {
    return {
      entries: [],
      errors: [`missing ${HISTORY_MARKER} marker`],
      missingFields,
    };
  }

  const maskedText = maskMarkdownBlocks(text);
  const history = maskedText.slice(markerIndex + HISTORY_MARKER.length);
  const historyOffset = markerIndex + HISTORY_MARKER.length;
  const headings: HeadingMatch[] = [];
  for (const match of history.matchAll(ENTRY_HEADING)) {
    const index = historyOffset + (match.index ?? 0);
    headings.push({
      id: match[1],
      date: match[2],
      title: match[3].trim(),
      index,
      endIndex: index + match[0].length,
      startLine: lineNumberAt(text, index),
    });
  }
  const validHeadingIndexes = new Set(headings.map((heading) => heading.index));
  for (const candidate of history.matchAll(/^[ \t]*#{1,6}[ \t]+BL-/gmu)) {
    const index = historyOffset + (candidate.index ?? 0);
    if (!validHeadingIndexes.has(index)) {
      errors.push(
        `line ${lineNumberAt(text, index)}: malformed build-log entry heading`,
      );
    }
  }
  if (headings.length === 0) {
    return {
      entries: [],
      errors: ["build log has no entries after its history marker"],
      missingFields,
    };
  }

  const invalidEntries = new Set<ParsedBuildLogEntry>();
  const entries: ParsedBuildLogEntry[] = headings.map((heading, index) => {
    const body = text.slice(
      heading.endIndex,
      headings[index + 1]?.index ?? text.length,
    );
    const maskedBody = maskedText.slice(
      heading.endIndex,
      headings[index + 1]?.index ?? text.length,
    );
    const errorStart = errors.length;
    const entry: ParsedBuildLogEntry = {
      id: heading.id,
      date: heading.date,
      title: heading.title,
      fields: parseFields(body, maskedBody, heading, errors),
      startLine: heading.startLine,
      sourceSha256: buildLogEntrySha256(text.slice(heading.index, headings[index + 1]?.index ?? text.length)),
    };
    if (errors.length > errorStart) invalidEntries.add(entry);
    for (const field of REQUIRED_BUILD_LOG_FIELDS) {
      if (entry.fields[field] === undefined) missingFields.push({ entryId: entry.id, entrySha256: entry.sourceSha256, field });
    }
    return entry;
  });

  const seenIds = new Set<string>();
  const priorIds = new Set<string>();
  let previousDate = "";
  let previousModernMinute = "";
  let previousEntryId: string | undefined;
  let expectedHistoricalNumber = 1;
  let modernHistoryStarted = false;
  for (const entry of entries) {
    const errorStart = errors.length;
    if (seenIds.has(entry.id)) {
      errors.push(`${entry.id} (line ${entry.startLine}): duplicate entry ID`);
    }
    seenIds.add(entry.id);

    if (!isCanonicalDate(entry.date)) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): invalid entry date ${entry.date}`,
      );
    }
    if (previousDate.length > 0 && entry.date < previousDate) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): entry date precedes the previous entry`,
      );
    }
    previousDate = entry.date;

    const status = entry.fields.Status?.replace(/^`|`$/gu, "") ?? "";
    const resetDecision = entry.fields.Decisions ?? "";
    const resetTargets = [
      ...resetDecision.matchAll(TIMESTAMP_SEQUENCE_RESET_MARKER),
    ].map((match) => match[1]);
    const resetMarkerMentions =
      resetDecision.split(TIMESTAMP_SEQUENCE_RESET_PREFIX).length - 1;
    const hasResetMarker = resetMarkerMentions > 0;
    let validTimestampSequenceReset = false;

    const historical = HISTORICAL_ID.exec(entry.id);
    const modern = MODERN_ID.exec(entry.id);
    if (historical !== null) {
      const historicalNumber = Number(historical[1]);
      if (modernHistoryStarted) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): historical IDs cannot follow timestamped IDs`,
        );
      }
      if (
        historicalNumber !== expectedHistoricalNumber ||
        historicalNumber > 8
      ) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): historical IDs must remain the ordered BL-0001 through BL-0008 backfill`,
        );
      }
      expectedHistoricalNumber = historicalNumber + 1;
      if (hasResetMarker) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): timestamp sequence reset marker is invalid`,
        );
      }
    } else if (modern !== null) {
      modernHistoryStarted = true;
      const [, year, month, day, hour, minute] = modern;
      const idDate = `${year}-${month}-${day}`;
      const idMinute = `${year}${month}${day}${hour}${minute}`;
      const timestamp = new Date(
        `${idDate}T${hour}:${minute}:00.000Z`,
      );
      if (
        Number.isNaN(timestamp.getTime()) ||
        timestamp.toISOString().slice(0, 16) !==
          `${idDate}T${hour}:${minute}`
      ) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): ID contains an invalid UTC timestamp`,
        );
      }
      if (idDate !== entry.date) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): ID date does not match entry date`,
        );
      }
      const timestampMovesBackward =
        previousModernMinute.length > 0 && idMinute < previousModernMinute;
      if (hasResetMarker) {
        const knownResetTarget = (
          KNOWN_TIMESTAMP_SEQUENCE_RESETS as Readonly<Record<string, string>>
        )[entry.id];
        validTimestampSequenceReset =
          resetMarkerMentions === 1 &&
          resetTargets.length === 1 &&
          resetTargets[0] === previousEntryId &&
          resetTargets[0] === knownResetTarget &&
          previousEntryId !== undefined &&
          timestampMovesBackward &&
          /^Correction\b/iu.test(entry.title) &&
          status === "Implemented";
        if (!validTimestampSequenceReset) {
          errors.push(
            `${entry.id} (line ${entry.startLine}): timestamp sequence reset marker is invalid`,
          );
        }
      }
      if (timestampMovesBackward && !validTimestampSequenceReset) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): timestamp precedes the previous timestamped entry`,
        );
      }
      previousModernMinute = idMinute;
    } else {
      errors.push(
        `${entry.id} (line ${entry.startLine}): ID must be historical BL-0001..BL-0008 or BL-YYYYMMDD-HHMM-short-slug`,
      );
    }

    if (!ALLOWED_STATUS_SET.has(status)) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): invalid Status ${JSON.stringify(status)}`,
      );
    }

    if (/^Correction\b/iu.test(entry.title)) {
      const correctionText = `${entry.title}\n${Object.values(entry.fields).join("\n")}`;
      const references = [
        ...correctionText.matchAll(/\bBL-(?:\d{4}|\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\b/gu),
      ]
        .map((match) => match[0])
        .filter((id) => id !== entry.id);
      if (references.length === 0) {
        errors.push(
          `${entry.id} (line ${entry.startLine}): Correction entry must cite an earlier entry ID`,
        );
      }
      for (const reference of new Set(references)) {
        if (!priorIds.has(reference)) {
          errors.push(
            `${entry.id} (line ${entry.startLine}): Correction reference ${reference} is not an earlier entry`,
          );
        }
      }
    }

    priorIds.add(entry.id);
    previousEntryId = entry.id;
    if (errors.length > errorStart) invalidEntries.add(entry);
  }

  // A complete later erratum may supply one actually absent field. All original
  // parse/semantic errors survive; this is not a historical-field rewrite.
  const candidates = new Map<MissingBuildLogField, ParsedBuildLogEntry[]>();
  for (const [index, entry] of entries.entries()) {
    const decisions = maskMarkdownBlocks(entry.fields.Decisions ?? "");
    const mentions = decisions.split(FIELD_CORRECTION_PREFIX).length - 1;
    if (!mentions) continue;
    const markers = [...decisions.matchAll(FIELD_CORRECTION_MARKER)];
    const fail = (reason: string) => errors.push(`${entry.id} (line ${entry.startLine}): missing-field correction ${reason}`);
    if (mentions !== 1 || markers.length !== 1) { fail("marker is malformed or duplicated"); continue; }
    if (!/^Correction\b/iu.test(entry.title) || entry.fields.Status?.replace(/^`|`$/gu, "") !== "Implemented" ||
      invalidEntries.has(entry) || REQUIRED_BUILD_LOG_FIELDS.some(field => !entry.fields[field])) {
      fail("must be a complete valid Implemented Correction entry"); continue;
    }
    const [, targetId, targetSha256, field] = markers[0];
    if (!(REQUIRED_BUILD_LOG_FIELDS as readonly string[]).includes(field)) { fail("field is unknown"); continue; }
    const targets = entries.filter(target => target.id === targetId);
    if (targets.length !== 1 || entries.indexOf(targets[0]) >= index) { fail("target must be a unique earlier entry"); continue; }
    const target = targets[0];
    if (maskMarkdownBlocks(target.fields.Decisions ?? "").includes(FIELD_CORRECTION_PREFIX)) { fail("cannot target another field correction"); continue; }
    if (target.sourceSha256 !== targetSha256) { fail("target digest does not match"); continue; }
    const missing = missingFields.find(item => item.entryId === targetId && item.entrySha256 === targetSha256 && item.field === field);
    if (!missing) { fail("target field is not missing"); continue; }
    candidates.set(missing, [...candidates.get(missing) ?? [], entry]);
  }
  for (const missing of missingFields) {
    const supplies = candidates.get(missing) ?? [];
    if (supplies.length === 1) missing.correctedBy = supplies[0].id;
    else if (supplies.length > 1) errors.push(`${missing.entryId}: missing-field correction has duplicate supplies for ${missing.field}`);
    if (!missing.correctedBy) {
      const entry = entries.find(item => item.id === missing.entryId && item.sourceSha256 === missing.entrySha256)!;
      errors.push(`${entry.id} (line ${entry.startLine}): missing required field ${missing.field}`);
    }
  }
  return { entries, errors, missingFields };
}

function firstDifferentLine(left: string, right: string): number {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const shared = Math.min(leftLines.length, rightLines.length);
  for (let index = 0; index < shared; index += 1) {
    if (leftLines[index] !== rightLines[index]) return index + 1;
  }
  return shared + 1;
}

/**
 * The archive is frozen: after the switch to one file per entry its bytes are the pinned ones. The checks that ordered one entry
 * after another stay with it; entry files are compared with nothing but the IDs they cite.
 */
export function validateFrozenArchive(currentText: string, pinnedSha256 = ARCHIVE_SHA256): readonly string[] {
  const found = createHash("sha256").update(currentText, "utf8").digest("hex");
  if (found === pinnedSha256) return [];
  return [
    `${BUILD_LOG_PATH} is the frozen archive and may not change (sha256 ${found}, pinned ${pinnedSha256}); add an entry file under ${BUILD_LOG_ENTRY_DIRECTORY}/ instead`,
  ];
}

const ENTRY_FILE_NAME = /^(BL-\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/u;

export interface EntryFileValidation {
  entry: ParsedBuildLogEntry | null;
  errors: readonly string[];
  warnings: readonly string[];
}

/**
 * One entry file. Its first line is the archive's heading form, `### <ID> -- <date> -- <title>`: the ID is the file's name, a valid UTC
 * timestamp, and its date is the heading's (UTC). Then come the ten fields in order, none empty, and an allowed Status. One entry a
 * file. A file longer than ENTRY_FILE_SOFT_LINE_LIMIT lines is a warning.
 */
export function validateEntryFile(fileName: string, text: string): EntryFileValidation {
  const label = `${BUILD_LOG_ENTRY_DIRECTORY}/${fileName}`;
  const errors: string[] = [];
  const warnings: string[] = [];
  const named = ENTRY_FILE_NAME.exec(fileName);
  if (named === null) {
    return { entry: null, errors: [`${label}: an entry file is named BL-YYYYMMDD-HHMM-short-slug.md`], warnings };
  }
  const masked = maskMarkdownBlocks(text);
  const headings = [...masked.matchAll(ENTRY_HEADING)];
  const heading = headings[0];
  if (heading === undefined || heading.index !== 0) {
    return { entry: null, errors: [`${label}: an entry file starts with its heading line, ### <ID> -- <UTC date> -- <title>`], warnings };
  }
  if (headings.length > 1 || [...masked.matchAll(/^[ \t]*#{1,6}[ \t]+BL-/gmu)].length > 1) {
    return { entry: null, errors: [`${label}: an entry file holds one entry`], warnings };
  }
  const id = heading[1];
  const date = heading[2];
  const title = heading[3].trim();
  if (id !== named[1]) errors.push(`${label}: the heading's ID ${id} is not the file's name`);
  const modern = MODERN_ID.exec(id);
  if (modern === null) {
    errors.push(`${label}: the ID must be BL-YYYYMMDD-HHMM-short-slug`);
  } else {
    const [, year, month, day, hour, minute] = modern;
    const idDate = `${year}-${month}-${day}`;
    const timestamp = new Date(`${idDate}T${hour}:${minute}:00.000Z`);
    if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString().slice(0, 16) !== `${idDate}T${hour}:${minute}`) {
      errors.push(`${label}: the ID's UTC timestamp is invalid`);
    }
    if (idDate !== date) errors.push(`${label}: the heading's date ${date} is not the ID's UTC date ${idDate}`);
  }
  if (!isCanonicalDate(date)) errors.push(`${label}: invalid entry date ${date}`);
  const bodyStart = heading[0].length;
  const fields = parseFields(text.slice(bodyStart), masked.slice(bodyStart), { id: label, startLine: 1 }, errors);
  for (const field of REQUIRED_BUILD_LOG_FIELDS) {
    if (fields[field] === undefined) errors.push(`${label}: missing required field ${field}`);
  }
  const status = fields.Status?.replace(/^`|`$/gu, "");
  if (status !== undefined && !ALLOWED_STATUS_SET.has(status)) errors.push(`${label}: invalid Status ${JSON.stringify(status)}`);
  const lines = text.replace(/\n+$/u, "").split("\n").length;
  if (lines > ENTRY_FILE_SOFT_LINE_LIMIT) {
    warnings.push(`${label}: ${lines} lines; an entry is about 25, with the detail in the pull request's description`);
  }
  return { entry: { id, date, title, fields, startLine: 1, sourceSha256: buildLogEntrySha256(text) }, errors, warnings };
}

const CITED_ENTRY_ID = /\bBL-(?:\d{4}|\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\b/gu;

/** A Correction cites the entry it corrects; every full ID it cites names an entry in the archive or the directory, in either order. */
export function validateEntryCitations(
  entries: readonly ParsedBuildLogEntry[],
  knownIds: ReadonlySet<string>,
): readonly string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (!/^Correction\b/iu.test(entry.title)) continue;
    const text = `${entry.title}\n${Object.values(entry.fields).join("\n")}`;
    const references = new Set([...text.matchAll(CITED_ENTRY_ID)].map((match) => match[0]).filter((id) => id !== entry.id));
    if (references.size === 0) errors.push(`${entry.id}: a Correction must cite the entry it corrects`);
    for (const reference of references) {
      if (!knownIds.has(reference)) {
        errors.push(`${entry.id}: Correction reference ${reference} is not an entry in the archive or ${BUILD_LOG_ENTRY_DIRECTORY}/`);
      }
    }
  }
  return errors;
}

/** Entry files on the base never change: a pull request may add files, and may neither change nor delete one the base holds. */
export function validateImmutableEntryFiles(
  base: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): readonly string[] {
  const errors: string[] = [];
  for (const [name, text] of base) {
    const now = current.get(name);
    if (now === undefined) {
      errors.push(`${BUILD_LOG_ENTRY_DIRECTORY}/${name} is on the base and may not be deleted; add a Correction entry file instead`);
    } else if (now !== text) {
      errors.push(`${BUILD_LOG_ENTRY_DIRECTORY}/${name} is on the base and may not change (first changed line ${firstDifferentLine(text, now)}); add a Correction entry file instead`);
    }
  }
  return errors;
}

const MATERIAL_CHANGE_PREFIXES = [
  ".github/",
  "benchmarks/",
  "config/",
  "docs/adr/",
  "docs/architecture/",
  "docs/contracts/",
  "docs/evaluation/",
  "docs/plans/",
  "docs/providers/",
  "docs/security/",
  "scripts/",
  "src/",
  "tests/",
] as const;
const MATERIAL_CHANGE_FILES = new Set([
  "electron.vite.config.ts",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "tsconfig.node.json",
  "tsconfig.web.json",
  "vitest.config.ts",
]);

function isMaterialChangePath(relativePath: string): boolean {
  return (
    MATERIAL_CHANGE_FILES.has(relativePath) ||
    MATERIAL_CHANGE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  );
}

/** A material change needs at least one entry file the base does not hold. */
export function validateMaterialChangeEntryFiles(
  changedPaths: readonly string[],
  baseNames: ReadonlySet<string>,
  currentNames: ReadonlySet<string>,
): readonly string[] {
  const materialPaths = changedPaths.filter(isMaterialChangePath);
  if (materialPaths.length === 0 || [...currentNames].some((name) => !baseNames.has(name))) return [];
  const preview = materialPaths.slice(0, 5).join(", ");
  const remainder = materialPaths.length > 5 ? ` and ${materialPaths.length - 5} more` : "";
  return [`material changes require a new entry file under ${BUILD_LOG_ENTRY_DIRECTORY}/; changed paths: ${preview}${remainder}`];
}

/** Code that may not gain a build-log ID: entries cite code, code does not cite entries. */
export const CODE_CITATION_PREFIXES = ["src/", "scripts/"] as const;
const CODE_CITED_ID = /\bBL-(?:\d{8}-\d{4}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?|\d{4})\b/gu;

export interface CodeChange {
  path: string;
  base: string | null;
  current: string | null;
}

function citationCounts(texts: readonly (string | null)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) for (const match of (text ?? "").matchAll(CODE_CITED_ID)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  return counts;
}

/**
 * A pull request adds no build-log ID under src/ or scripts/. Each ID is counted over every changed file there, at the base and at
 * the head, so a moved line or a moved file keeps its citations, and a citation removed is fine. An ID cited more often at the head
 * is refused, a new copy of an existing citation included, and each file whose own count of it grew is named. Citations already
 * there stay until a pull request removes them.
 */
export function validateNoAddedCodeCitations(changes: readonly CodeChange[]): readonly string[] {
  const code = changes.filter((change) => CODE_CITATION_PREFIXES.some((prefix) => change.path.startsWith(prefix)));
  const before = citationCounts(code.map((change) => change.base));
  const after = citationCounts(code.map((change) => change.current));
  const added = new Set([...after].filter(([id, count]) => count > (before.get(id) ?? 0)).map(([id]) => id));
  const errors: string[] = [];
  for (const change of code) {
    const own = citationCounts([change.current]), was = citationCounts([change.base]);
    const grew = [...own].filter(([id, count]) => added.has(id) && count > (was.get(id) ?? 0)).map(([id]) => id);
    if (grew.length > 0) {
      errors.push(`${change.path} adds the build-log ID${grew.length === 1 ? "" : "s"} ${grew.join(", ")}; cite entries in the entry file or the pull request's description, not under src/ or scripts/`);
    }
  }
  return errors;
}

function assertSafeBaseRef(baseRef: string): void {
  if (baseRef.startsWith("-") || !/^[A-Za-z0-9_./^~-]+$/u.test(baseRef)) {
    throw new Error(`unsafe or invalid Git base ref ${JSON.stringify(baseRef)}`);
  }
}

function gitOutput(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** A file's text at the base, or null when the base has no such file. */
export function readBaseFile(repositoryRoot: string, baseRef: string, relativePath: string): string | null {
  assertSafeBaseRef(baseRef);
  const listed = gitOutput(repositoryRoot, ["ls-tree", "--name-only", "-z", baseRef, "--", relativePath]).split("\0");
  return listed.includes(relativePath) ? gitOutput(repositoryRoot, ["show", `${baseRef}:${relativePath}`]) : null;
}

/** The entry files on the base, by file name. */
function readBaseEntryFiles(repositoryRoot: string, baseRef: string): Map<string, string> {
  assertSafeBaseRef(baseRef);
  const files = new Map<string, string>();
  const listed = gitOutput(repositoryRoot, ["ls-tree", "-r", "--name-only", "-z", baseRef, "--", `${BUILD_LOG_ENTRY_DIRECTORY}/`]);
  for (const name of listed.split("\0").filter(Boolean)) {
    files.set(path.posix.relative(BUILD_LOG_ENTRY_DIRECTORY, name), gitOutput(repositoryRoot, ["show", `${baseRef}:${name}`]));
  }
  return files;
}

/**
 * The work tree's entry files, by file name: the directory's tracked and untracked files as git lists them, ignored ones (a Finder
 * .DS_Store) left out; outside a repository, everything in it. A file deleted from the work tree is absent. Anything but a regular
 * entry file, a symbolic link or a subdirectory included, is an error.
 */
function readEntryFiles(repositoryRoot: string): { files: Map<string, string>; errors: string[] } {
  const directory = path.join(repositoryRoot, BUILD_LOG_ENTRY_DIRECTORY);
  const files = new Map<string, string>();
  const errors: string[] = [];
  if (!existsSync(directory)) return { files, errors };
  let names: string[];
  try {
    names = gitOutput(repositoryRoot, ["ls-files", "-co", "--exclude-standard", "-z", "--", `${BUILD_LOG_ENTRY_DIRECTORY}/`])
      .split("\0").filter(Boolean).map((listed) => path.posix.relative(BUILD_LOG_ENTRY_DIRECTORY, listed));
  } catch {
    names = readdirSync(directory);
  }
  for (const name of [...new Set(names)].sort()) {
    const file = path.join(directory, name);
    if (!existsSync(file) && !isSymbolicLink(file)) continue;
    if (name.includes("/") || !ENTRY_FILE_NAME.test(name) || !lstatSync(file).isFile()) {
      errors.push(`${BUILD_LOG_ENTRY_DIRECTORY}/${name}: the directory holds only entry files, named BL-YYYYMMDD-HHMM-short-slug.md`);
      continue;
    }
    files.set(name, readFileSync(file, "utf8"));
  }
  return { files, errors };
}

function isSymbolicLink(file: string): boolean {
  try { return lstatSync(file).isSymbolicLink(); } catch { return false; }
}

function changedPathsAtBase(
  repositoryRoot: string,
  baseRef: string,
): readonly string[] {
  assertSafeBaseRef(baseRef);
  const output = execFileSync(
    "git",
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      "-z",
      baseRef,
      "--",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return output.split("\0").filter(Boolean);
}

interface CliOptions {
  baseRef?: string;
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--base-ref") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--base-ref requires a Git revision");
      }
      options.baseRef = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${argument}`);
  }
  return options;
}

export function runBuildLogValidationCli(
  args: readonly string[],
  repositoryRoot = process.cwd(),
  /** For tests only, whose fixture archives are not the repository's. */
  archiveSha256 = ARCHIVE_SHA256,
): number {
  try {
    const options = parseCliOptions(args);
    const archiveText = readFileSync(path.join(repositoryRoot, BUILD_LOG_PATH), "utf8");
    const archive = validateBuildLog(archiveText);
    const errors: string[] = [...archive.errors, ...validateFrozenArchive(archiveText, archiveSha256)];
    const directory = readEntryFiles(repositoryRoot);
    errors.push(...directory.errors);
    const checked = [...directory.files].map(([name, text]) => ({ name, ...validateEntryFile(name, text) }));
    const entries = checked.flatMap((item) => (item.entry === null ? [] : [item.entry]));
    for (const item of checked) errors.push(...item.errors);
    const archiveIds = new Set(archive.entries.map((entry) => entry.id));
    for (const entry of entries) {
      if (archiveIds.has(entry.id)) errors.push(`${BUILD_LOG_ENTRY_DIRECTORY}/${entry.id}.md: the ID is already an archive entry's`);
    }
    errors.push(...validateEntryCitations(entries, new Set([...archiveIds, ...entries.map((entry) => entry.id)])));
    // A length warning is for a file new against a base: without one, nothing warns.
    let added: ReadonlySet<string> = new Set();
    if (options.baseRef !== undefined) {
      const baseRef = options.baseRef;
      const baseFiles = readBaseEntryFiles(repositoryRoot, baseRef);
      errors.push(...validateImmutableEntryFiles(baseFiles, directory.files));
      added = new Set([...directory.files.keys()].filter((name) => !baseFiles.has(name)));
      const changedPaths = changedPathsAtBase(repositoryRoot, baseRef);
      errors.push(...validateMaterialChangeEntryFiles(changedPaths, new Set(baseFiles.keys()), new Set(directory.files.keys())));
      const codeChanges = changedPaths
        .filter((changed) => CODE_CITATION_PREFIXES.some((prefix) => changed.startsWith(prefix)))
        .map((changed) => {
          const file = path.join(repositoryRoot, changed);
          return { path: changed, base: readBaseFile(repositoryRoot, baseRef, changed), current: existsSync(file) ? readFileSync(file, "utf8") : null };
        });
      errors.push(...validateNoAddedCodeCitations(codeChanges));
    }
    for (const item of checked) {
      if (added.has(item.name)) for (const warning of item.warnings) process.stderr.write(`WARN ${warning}\n`);
    }

    if (errors.length > 0) {
      for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
      return 1;
    }
    const correctionCount = archive.missingFields.filter(field => field.correctedBy !== undefined).length;
    process.stdout.write(
      `SOAR build log valid: the frozen archive's ${archive.entries.length} entries and ${entries.length} entry file${entries.length === 1 ? "" : "s"}${
        options.baseRef === undefined
          ? ""
          : `; ${added.size} new entry file${added.size === 1 ? "" : "s"} against ${options.baseRef}`
      }${correctionCount ? `; ${correctionCount} digest-bound field correction${correctionCount === 1 ? "" : "s"}; original missing-field evidence retained` : ""}.\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `ERROR ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runBuildLogValidationCli(process.argv.slice(2));
}
