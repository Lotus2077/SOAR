import type { CanonicalMessage, CanonicalToolCall } from "../../shared/session-reducer";
import type { CitationCorrection as SessionCitationCorrection } from "../../shared/session-events";
import { normalizeWorkspaceRelativePath } from "../tools/workspace-policy";

export type CitationCorrection = SessionCitationCorrection;

export type UnresolvedCitationReason =
  | "path_not_in_evidence"
  | "ambiguous_path_suffix"
  | "line_not_in_evidence";

export interface UnresolvedCitation {
  citation: string;
  reason: UnresolvedCitationReason;
  candidates?: string[];
}

export interface CitationIntegrityResult {
  content: string;
  corrections: CitationCorrection[];
  unresolved: UnresolvedCitation[];
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

// Deliberately token-oriented rather than Markdown-oriented: repository
// citations occur in prose, tables, headings, and code spans. The surrounding
// boundary prevents matching the tail of an absolute path or URL.
const CITATION_PATTERN =
  /(^|[^A-Za-z0-9_./@+\\-])((?:[A-Za-z0-9_@+.-]+[\\/])*[A-Za-z0-9_@+.-]+):([1-9][0-9]*)(?![0-9])/gmu;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseSuccessfulOutput(toolCall: CanonicalToolCall): Record<string, unknown> | undefined {
  if (toolCall.status !== "completed" || !toolCall.content) return undefined;
  try {
    const output = asRecord(JSON.parse(toolCall.content) as unknown);
    return output?.ok === true ? output : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEvidencePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return normalizeWorkspaceRelativePath(value, false);
  } catch {
    return undefined;
  }
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

function addToolEvidence(evidence: Map<string, PathEvidence>, toolCall: CanonicalToolCall): void {
  const output = parseSuccessfulOutput(toolCall);
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

function collectEvidence(messages: readonly CanonicalMessage[]): Map<string, PathEvidence> {
  const evidence = new Map<string, PathEvidence>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) addToolEvidence(evidence, toolCall);
  }
  return evidence;
}

function extractCitations(content: string, evidencePaths: readonly string[]): CitationMatch[] {
  const matches: CitationMatch[] = [];
  for (const match of content.matchAll(CITATION_PATTERN)) {
    const boundary = match[1] ?? "";
    const rawPath = match[2];
    const rawLine = match[3];
    if (!rawPath || !rawLine || match.index === undefined) continue;

    const normalized = normalizeEvidencePath(rawPath);
    const resemblesRepositoryPath =
      rawPath.includes("/") ||
      rawPath.includes("\\") ||
      /\.[A-Za-z_][A-Za-z0-9_-]*$/u.test(rawPath) ||
      (normalized !== undefined &&
        evidencePaths.some(
          (path) => path === normalized || path.endsWith(`/${normalized}`),
        ));
    if (!resemblesRepositoryPath) continue;

    const citation = `${rawPath}:${rawLine}`;
    const start = match.index + boundary.length;
    matches.push({
      citation,
      path: rawPath,
      line: Number(rawLine),
      start,
      end: start + citation.length,
    });
  }
  return matches;
}

function supportsLine(evidence: PathEvidence, line: number): boolean {
  return (
    evidence.lines.has(line) ||
    (evidence.allLinesThrough !== undefined && line <= evidence.allLinesThrough)
  );
}

/**
 * Canonicalize final-answer citations strictly from successful repository-tool
 * evidence. This function never reads the workspace or changes tool evidence.
 */
export function normalizeAnswerCitations(
  content: string,
  messages: readonly CanonicalMessage[],
): CitationIntegrityResult {
  const evidence = collectEvidence(messages);
  const evidencePaths = [...evidence.keys()].sort();
  const citations = extractCitations(content, evidencePaths);
  const corrections: CitationCorrection[] = [];
  const unresolved: UnresolvedCitation[] = [];
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
          (path) => path === normalizedPath || path.endsWith(`/${normalizedPath}`),
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

    if (citation.path !== canonicalPath) {
      const to = `${canonicalPath}:${citation.line}`;
      replacements.push({ start: citation.start, end: citation.end, value: to });
      if (!corrections.some((correction) => correction.from === citation.citation && correction.to === to)) {
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

  // Treat the answer as one integrity unit. If any citation cannot be proved,
  // do not publish a partially rewritten variant or correction audit.
  return unresolved.length > 0
    ? { content, corrections: [], unresolved }
    : { content: canonicalContent, corrections, unresolved };
}

export function formatCitationIntegrityError(unresolved: readonly UnresolvedCitation[]): string {
  const details = unresolved.slice(0, 5).map((entry) => {
    if (entry.reason === "ambiguous_path_suffix") {
      return `\"${entry.citation}\" is ambiguous (${entry.candidates?.join(", ")})`;
    }
    if (entry.reason === "line_not_in_evidence") {
      return `\"${entry.citation}\" has no matching line in tool evidence`;
    }
    return `\"${entry.citation}\" has no matching path in tool evidence`;
  });
  const omitted = unresolved.length - details.length;
  return (
    `Final answer citation integrity check failed: ${details.join("; ")}` +
    (omitted > 0 ? `; and ${omitted} more unresolved citation(s).` : ".")
  );
}
