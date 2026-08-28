import {
  normalizeCitationsFromEvidence,
  type UnresolvedCitation,
  type UnresolvedCitationReason,
} from "../../shared/citation-evidence";
import type { CanonicalMessage } from "../../shared/session-reducer";
import type { CitationCorrection as SessionCitationCorrection } from "../../shared/session-events";

export type CitationCorrection = SessionCitationCorrection;

export type { UnresolvedCitation, UnresolvedCitationReason };

export interface CitationIntegrityResult {
  content: string;
  corrections: CitationCorrection[];
  unresolved: UnresolvedCitation[];
  /** Unique canonical path:line citations proved by successful tool evidence. */
  verifiedCitations: string[];
}

/**
 * Canonicalize final-answer citations strictly from successful repository-tool
 * evidence. This function never reads the workspace or changes tool evidence.
 */
export function normalizeAnswerCitations(
  content: string,
  messages: readonly CanonicalMessage[],
): CitationIntegrityResult {
  return normalizeCitationsFromEvidence(content, messages);
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
