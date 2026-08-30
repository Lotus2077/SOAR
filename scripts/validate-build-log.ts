import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

export const BUILD_LOG_PATH = "docs/BUILD_LOG.md";

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
}

export interface BuildLogValidationResult {
  entries: readonly ParsedBuildLogEntry[];
  errors: readonly string[];
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

function maskMarkdownBlocks(text: string): string {
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
    if (fields[field] === undefined) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): missing required field ${field}`,
      );
    } else if (fields[field].length === 0) {
      errors.push(
        `${entry.id} (line ${entry.startLine}): field ${field} is empty`,
      );
    }
  }
  if (
    actualOrder.length === REQUIRED_BUILD_LOG_FIELDS.length &&
    actualOrder.some(
      (field, index) => field !== REQUIRED_BUILD_LOG_FIELDS[index],
    )
  ) {
    errors.push(
      `${entry.id} (line ${entry.startLine}): required fields are out of order`,
    );
  }

  return fields;
}

export function validateBuildLog(text: string): BuildLogValidationResult {
  const errors: string[] = [];
  const markerIndex = text.indexOf(HISTORY_MARKER);
  if (markerIndex < 0) {
    return {
      entries: [],
      errors: [`missing ${HISTORY_MARKER} marker`],
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
    };
  }

  const entries: ParsedBuildLogEntry[] = headings.map((heading, index) => {
    const body = text.slice(
      heading.endIndex,
      headings[index + 1]?.index ?? text.length,
    );
    const maskedBody = maskedText.slice(
      heading.endIndex,
      headings[index + 1]?.index ?? text.length,
    );
    return {
      id: heading.id,
      date: heading.date,
      title: heading.title,
      fields: parseFields(body, maskedBody, heading, errors),
      startLine: heading.startLine,
    };
  });

  const seenIds = new Set<string>();
  const priorIds = new Set<string>();
  let previousDate = "";
  let previousModernMinute = "";
  let previousEntryId: string | undefined;
  let expectedHistoricalNumber = 1;
  let modernHistoryStarted = false;
  let timestampSequenceResetSeen = false;

  for (const entry of entries) {
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
        validTimestampSequenceReset =
          resetMarkerMentions === 1 &&
          resetTargets.length === 1 &&
          resetTargets[0] === previousEntryId &&
          previousEntryId !== undefined &&
          timestampMovesBackward &&
          !timestampSequenceResetSeen &&
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
      if (validTimestampSequenceReset) timestampSequenceResetSeen = true;
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
  }

  return { entries, errors };
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

export function validateAppendOnlyBuildLog(
  baseText: string,
  currentText: string,
): readonly string[] {
  if (currentText === baseText) return [];
  if (currentText.startsWith(baseText)) {
    const appended = currentText.slice(baseText.length).trimStart();
    if (
      /^### BL-[a-zA-Z0-9-]+ -- \d{4}-\d{2}-\d{2} -- [^\r\n]+(?:\r?\n|$)/u.test(
        appended,
      )
    ) {
      return [];
    }
    return [
      "build log append-only changes must begin with a complete new entry heading, not extend the previous entry",
    ];
  }
  const line = firstDifferentLine(baseText, currentText);
  return [
    `build log is not append-only relative to the base; first changed or deleted base line is ${line}`,
  ];
}

function readBaseBuildLog(
  repositoryRoot: string,
  baseRef: string,
  relativePath: string,
): string {
  if (
    baseRef.startsWith("-") ||
    !/^[A-Za-z0-9_./^~-]+$/u.test(baseRef)
  ) {
    throw new Error(`unsafe or invalid Git base ref ${JSON.stringify(baseRef)}`);
  }
  return execFileSync("git", ["show", `${baseRef}:${relativePath}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
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

function changedPathsAtBase(
  repositoryRoot: string,
  baseRef: string,
): readonly string[] {
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

export function validateMaterialChangeBuildLogEntry(
  baseText: string,
  currentText: string,
  changedPaths: readonly string[],
): readonly string[] {
  const materialPaths = changedPaths.filter(isMaterialChangePath);
  if (materialPaths.length === 0) return [];

  const baseEntries = validateBuildLog(baseText).entries.length;
  const currentEntries = validateBuildLog(currentText).entries.length;
  if (currentEntries > baseEntries) return [];

  const preview = materialPaths.slice(0, 5).join(", ");
  const remainder = materialPaths.length > 5 ? ` and ${materialPaths.length - 5} more` : "";
  return [
    `material changes require a new build-log entry; changed paths: ${preview}${remainder}`,
  ];
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
): number {
  try {
    const options = parseCliOptions(args);
    const currentText = readFileSync(
      path.join(repositoryRoot, BUILD_LOG_PATH),
      "utf8",
    );
    const validation = validateBuildLog(currentText);
    const errors = [...validation.errors];
    if (options.baseRef !== undefined) {
      const baseText = readBaseBuildLog(
        repositoryRoot,
        options.baseRef,
        BUILD_LOG_PATH,
      );
      errors.push(...validateAppendOnlyBuildLog(baseText, currentText));
      const changedPaths = changedPathsAtBase(repositoryRoot, options.baseRef);
      errors.push(
        ...validateMaterialChangeBuildLogEntry(
          baseText,
          currentText,
          changedPaths,
        ),
      );
    }

    if (errors.length > 0) {
      for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
      return 1;
    }
    process.stdout.write(
      `SOAR build log valid: ${validation.entries.length} entries${
        options.baseRef === undefined
          ? ""
          : `; append-only against ${options.baseRef}`
      }.\n`,
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
