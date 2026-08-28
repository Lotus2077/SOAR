import type { CitationCorrection, JsonValue } from "./session-events";
import { parseSuccessfulRepositoryToolObservation } from "./tool-observation";

export type UnresolvedCitationReason =
  | "path_not_in_evidence"
  | "ambiguous_path_suffix"
  | "line_not_in_evidence";

export interface UnresolvedCitation {
  citation: string;
  reason: UnresolvedCitationReason;
  candidates?: string[];
}

export interface CitationEvidenceResult {
  content: string;
  corrections: CitationCorrection[];
  unresolved: UnresolvedCitation[];
  /** Unique canonical path:line citations proved by successful tool evidence. */
  verifiedCitations: string[];
}

interface EvidenceToolCall {
  name: string;
  arguments: JsonValue;
  status: string;
  content?: string;
}

interface EvidenceMessage {
  toolCalls?: readonly EvidenceToolCall[];
}

interface PathEvidence {
  allLinesThrough?: number;
  lines: Set<number>;
}

interface CitationMatch {
  citation: string;
  path: string;
  line: number;
  start: number;
  end: number;
}

// Repository citations can appear in prose, Markdown, tables, or code spans.
// The boundaries reject tails of absolute paths/URLs and prefixes such as
// `src/file.ts:1evil` while allowing normal punctuation after the line number.
const PLAIN_CITATION_PATTERN =
  /(^|[^\p{L}\p{N}_./@+\\-])((?:[\p{L}\p{N}_@+.-]+[\\/])*[\p{L}\p{N}_@+.-]+):([1-9][0-9]*)(?=$|\s|[—–]|[.,;:!?)}\]`'"*]+(?=$|\s|[—–]))/gmu;
const QUOTED_CITATION_PATTERN =
  /([`"])([^`"\r\n]+):([1-9][0-9]*)\1/gmu;
const URI_TOKEN_PATTERN =
  /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:[^\s)\]}>"'`]*)/gmu;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function normalizeEvidencePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    return undefined;
  }
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(value)
  ) {
    return undefined;
  }
  const segments = value.split(/[\\/]+/u);
  if (segments.includes("..")) return undefined;
  const normalized = segments
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  return normalized || undefined;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const breaks = text.match(/\r\n|\r|\n/gu)?.length ?? 0;
  return breaks + (/(?:\r\n|\r|\n)$/u.test(text) ? 0 : 1);
}

function evidenceFor(
  evidence: Map<string, PathEvidence>,
  rawPath: unknown,
): PathEvidence | undefined {
  const normalizedPath = normalizeEvidencePath(rawPath);
  if (!normalizedPath) return undefined;
  let entry = evidence.get(normalizedPath);
  if (!entry) {
    entry = { lines: new Set<number>() };
    evidence.set(normalizedPath, entry);
  }
  return entry;
}

function addToolEvidence(
  evidence: Map<string, PathEvidence>,
  toolCall: EvidenceToolCall,
): void {
  if (toolCall.status !== "completed") return;
  const output = parseSuccessfulRepositoryToolObservation(
    toolCall.name,
    toolCall.arguments,
    toolCall.content,
  );
  if (!output) return;

  if (toolCall.name === "list_files") {
    if (!Array.isArray(output.entries)) return;
    for (const rawEntry of output.entries) {
      const entry = asRecord(rawEntry);
      if (entry?.type === "file") evidenceFor(evidence, entry.path);
    }
    return;
  }

  if (toolCall.name === "search_text") {
    if (!Array.isArray(output.matches)) return;
    for (const rawMatch of output.matches) {
      const match = asRecord(rawMatch);
      const lineNumber = match?.lineNumber;
      if (!isPositiveSafeInteger(lineNumber)) continue;
      evidenceFor(evidence, match?.path)?.lines.add(lineNumber);
    }
    return;
  }

  if (toolCall.name === "read_text_file") {
    const arguments_ = asRecord(toolCall.arguments);
    if (typeof output.text !== "string" || output.truncated !== false) return;
    const entry = evidenceFor(evidence, arguments_?.relativePath);
    if (entry) entry.allLinesThrough = lineCount(output.text);
  }
}

function collectEvidence(
  messages: readonly EvidenceMessage[],
): Map<string, PathEvidence> {
  const evidence = new Map<string, PathEvidence>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      addToolEvidence(evidence, toolCall);
    }
  }
  return evidence;
}

function extractCitations(
  content: string,
  evidencePaths: readonly string[],
): CitationMatch[] {
  const matches: CitationMatch[] = [];
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  const uriRanges = [...content.matchAll(URI_TOKEN_PATTERN)].flatMap((match) => {
    if (match.index === undefined || !match[1]) return [];
    // A basename citation such as `index.ts:12` is syntactically ambiguous
    // with a URI scheme. Preserve it only when the post-colon component is a
    // line number; every other scheme-prefixed token is treated as a URI.
    if (/^[\p{L}\p{N}_@+.-]+:[1-9][0-9]*[.,;:!?]*$/u.test(match[1])) {
      return [];
    }
    return [{ start: match.index, end: match.index + match[1].length }];
  });
  const append = (
    rawPath: string,
    rawLine: string,
    start: number,
    end: number,
  ): void => {
    if (
      uriRanges.some((range) => start >= range.start && end <= range.end)
    ) {
      return;
    }
    // A URL can otherwise resemble a repository path, especially inside a
    // Markdown code span or quotation. Citations are workspace-relative paths,
    // never URI references.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(rawPath)) return;
    const normalized = normalizeEvidencePath(rawPath);
    const resemblesRepositoryPath =
      rawPath.includes("/") ||
      rawPath.includes("\\") ||
      /\.[\p{L}_][\p{L}\p{N}_-]*$/u.test(rawPath) ||
      (normalized !== undefined &&
        evidencePaths.some(
          (path) => path === normalized || path.endsWith(`/${normalized}`),
        ));
    if (!resemblesRepositoryPath) return;
    matches.push({
      citation: `${rawPath}:${rawLine}`,
      path: rawPath,
      line: Number(rawLine),
      start,
      end,
    });
    occupiedRanges.push({ start, end });
  };

  for (const match of content.matchAll(QUOTED_CITATION_PATTERN)) {
    const rawPath = match[2];
    const rawLine = match[3];
    if (!rawPath || !rawLine || match.index === undefined) continue;
    const start = match.index + 1;
    append(rawPath, rawLine, start, start + rawPath.length + rawLine.length + 1);
  }

  for (const match of content.matchAll(PLAIN_CITATION_PATTERN)) {
    const boundary = match[1] ?? "";
    const rawPath = match[2];
    const rawLine = match[3];
    if (!rawPath || !rawLine || match.index === undefined) continue;
    const start = match.index + boundary.length;
    const end = start + rawPath.length + rawLine.length + 1;
    if (
      occupiedRanges.some(
        (range) => start >= range.start && end <= range.end,
      )
    ) {
      continue;
    }
    append(rawPath, rawLine, start, end);
  }
  return matches.sort((left, right) => left.start - right.start);
}

function supportsLine(evidence: PathEvidence, line: number): boolean {
  return (
    evidence.lines.has(line) ||
    (evidence.allLinesThrough !== undefined && line <= evidence.allLinesThrough)
  );
}

/**
 * Canonicalize answer citations strictly from successful repository-tool
 * evidence. This pure function is shared by the runner and event replay so a
 * persisted completion check cannot claim evidence that replay cannot prove.
 */
export function normalizeCitationsFromEvidence(
  content: string,
  messages: readonly EvidenceMessage[],
): CitationEvidenceResult {
  const evidence = collectEvidence(messages);
  const evidencePaths = [...evidence.keys()].sort();
  const citations = extractCitations(content, evidencePaths);
  const corrections: CitationCorrection[] = [];
  const unresolved: UnresolvedCitation[] = [];
  const verifiedCitations = new Set<string>();
  const replacements: Array<{ start: number; end: number; value: string }> = [];

  for (const citation of citations) {
    const normalizedPath = normalizeEvidencePath(citation.path);
    if (!normalizedPath) {
      unresolved.push({
        citation: citation.citation,
        reason: "path_not_in_evidence",
      });
      continue;
    }

    const exact = evidence.has(citation.path) ? citation.path : undefined;
    const candidates = exact
      ? [exact]
      : evidencePaths.filter(
          (path) =>
            path === normalizedPath || path.endsWith(`/${normalizedPath}`),
        );
    if (candidates.length === 0) {
      unresolved.push({
        citation: citation.citation,
        reason: "path_not_in_evidence",
      });
      continue;
    }
    if (candidates.length > 1) {
      unresolved.push({
        citation: citation.citation,
        reason: "ambiguous_path_suffix",
        candidates,
      });
      continue;
    }

    const canonicalPath = candidates[0];
    const pathEvidence = canonicalPath ? evidence.get(canonicalPath) : undefined;
    if (!canonicalPath || !pathEvidence) {
      throw new Error("Citation evidence lookup became inconsistent");
    }
    if (!supportsLine(pathEvidence, citation.line)) {
      unresolved.push({
        citation: citation.citation,
        reason: "line_not_in_evidence",
        candidates: [canonicalPath],
      });
      continue;
    }

    verifiedCitations.add(`${canonicalPath}:${citation.line}`);
    if (citation.path !== canonicalPath) {
      const to = `${canonicalPath}:${citation.line}`;
      replacements.push({ start: citation.start, end: citation.end, value: to });
      if (
        !corrections.some(
          (correction) =>
            correction.from === citation.citation && correction.to === to,
        )
      ) {
        corrections.push({ from: citation.citation, to });
      }
    }
  }

  let canonicalContent = content;
  for (const replacement of replacements.reverse()) {
    canonicalContent =
      canonicalContent.slice(0, replacement.start) +
      replacement.value +
      canonicalContent.slice(replacement.end);
  }

  return unresolved.length > 0
    ? {
        content,
        corrections: [],
        unresolved,
        verifiedCitations: [...verifiedCitations].sort(),
      }
    : {
        content: canonicalContent,
        corrections,
        unresolved,
        verifiedCitations: [...verifiedCitations].sort(),
      };
}
