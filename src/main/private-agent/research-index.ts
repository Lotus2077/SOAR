/** Pure research-index assessment. Model metadata and source literals remain untrusted, never evidence of answer coverage. */
import { z } from "zod";
import { digest } from "./contracts";

/** These bounds and assessment semantics must be included in the research protocol identity. */
export const INDEX_LIMITS = Object.freeze({
  batchSources: 3, replyRows: 6, sourceIdChars: 2048,
  titleChars: 160, dateChars: 40, gistChars: 600, figures: 8, figureChars: 80,
  literalHeadingChars: 160, literalOpeningBytes: 512,
});
export type IndexIssue = "invalid_json" | "invalid_schema" | "missing_id" | "duplicate_id" | "unexpected_id" | "empty_gist" | "truncated";
export interface IndexModelSummary { readonly title: string; readonly date: string; readonly gist: string; readonly figures: readonly string[] }
export interface IndexSourceAssessment {
  readonly sourceId: string;
  readonly status: "model_complete" | "unresolved";
  readonly summary?: IndexModelSummary;
  readonly issues: readonly IndexIssue[];
  readonly responseContentSha256: string;
}
export interface IndexBatchDiagnostics {
  readonly jsonInvalid: boolean; readonly schemaInvalid: boolean; readonly invalidRows: number;
  readonly unexpectedRows: number; readonly duplicateExpectedIds: number; readonly missingSources: number;
  readonly emptyGists: number; readonly truncated: boolean;
}
export interface IndexBatchAssessment {
  readonly responseContentSha256: string;
  readonly exactCoverage: boolean;
  readonly sources: readonly IndexSourceAssessment[];
  readonly issues: readonly IndexIssue[];
  readonly diagnostics: IndexBatchDiagnostics;
}

const field = (max: number) => z.string().max(max);
// Optional descriptive fields are normalized below; a nonblank gist is mandatory for model_complete.
const RowSchema = z.object({
  sourceId: field(INDEX_LIMITS.sourceIdChars).min(1), title: field(INDEX_LIMITS.titleChars).optional(),
  date: field(INDEX_LIMITS.dateChars).optional(), gist: field(INDEX_LIMITS.gistChars).optional(),
  figures: z.array(field(INDEX_LIMITS.figureChars)).max(INDEX_LIMITS.figures).optional(),
});
const ReplySchema = z.object({ sources: z.array(z.unknown()).max(INDEX_LIMITS.replyRows) });
const uniqueIssues = (issues: readonly IndexIssue[]) => Object.freeze([...new Set(issues)]);
function requireSourceId(sourceId: string): void {
  if (typeof sourceId !== "string" || !sourceId.trim() || sourceId.length > INDEX_LIMITS.sourceIdChars) throw Error("research_index_source_id_invalid");
}

/** Retains the existing outer-object parsing behavior; surrounding prose is never persisted as metadata. */
export function parseJsonReply(content: string): unknown {
  const start = content.indexOf("{"), end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(content.slice(start, end + 1)); } catch { return undefined; }
}

/** No I/O or retry decisions. Each expected ID has one outcome, in the host's input order. */
export function assessIndexBatch(input: { content: string; truncated: boolean; expectedSourceIds: readonly string[] }): IndexBatchAssessment {
  const ids = input.expectedSourceIds;
  if (!ids.length || ids.length > INDEX_LIMITS.batchSources || new Set(ids).size !== ids.length) throw Error("research_index_expected_ids_invalid");
  ids.forEach(requireSourceId);
  const responseContentSha256 = digest(input.content), expected = new Set(ids), parsed = parseJsonReply(input.content);
  const reply = ReplySchema.safeParse(parsed);
  const diagnostics = { jsonInvalid: parsed === undefined, schemaInvalid: parsed !== undefined && !reply.success,
    invalidRows: 0, unexpectedRows: 0, duplicateExpectedIds: 0, missingSources: 0, emptyGists: 0, truncated: input.truncated };
  const rows = new Map<string, unknown[]>();
  if (reply.success) for (const raw of reply.data.sources) {
    const row = RowSchema.safeParse(raw);
    if (!row.success) diagnostics.invalidRows++;
    const id = raw && typeof raw === "object" && "sourceId" in raw ? raw.sourceId : undefined;
    if (typeof id !== "string" || !expected.has(id)) { diagnostics.unexpectedRows++; continue; }
    rows.set(id, [...(rows.get(id) ?? []), raw]);
  }
  const sources = ids.map((sourceId): IndexSourceAssessment => {
    const issues: IndexIssue[] = [], candidates = rows.get(sourceId) ?? [];
    let summary: IndexModelSummary | undefined;
    if (diagnostics.jsonInvalid) issues.push("invalid_json");
    else if (!reply.success) issues.push("invalid_schema");
    else if (!candidates.length) { diagnostics.missingSources++; issues.push("missing_id"); }
    else if (candidates.length !== 1) { diagnostics.duplicateExpectedIds++; issues.push("duplicate_id"); }
    else {
      const row = RowSchema.safeParse(candidates[0]);
      if (!row.success) issues.push("invalid_schema");
      else if (!row.data.gist?.trim()) { diagnostics.emptyGists++; issues.push("empty_gist"); }
      else summary = Object.freeze({ title: row.data.title ?? "", date: row.data.date ?? "", gist: row.data.gist,
        figures: Object.freeze([...(row.data.figures ?? [])]) });
    }
    if (input.truncated) issues.push("truncated");
    // Even a parseable truncated reply is not a completed summary. Never select the first of duplicate IDs.
    return Object.freeze({ sourceId, status: issues.length ? "unresolved" : "model_complete", ...(issues.length ? {} : { summary }),
      issues: uniqueIssues(issues), responseContentSha256 });
  });
  const issues = uniqueIssues([...sources.flatMap(source => source.issues), ...(diagnostics.unexpectedRows ? ["unexpected_id" as const] : []),
    ...(diagnostics.invalidRows ? ["invalid_schema" as const] : [])]);
  return Object.freeze({ responseContentSha256, exactCoverage: issues.length === 0, sources: Object.freeze(sources), issues,
    diagnostics: Object.freeze(diagnostics) });
}

export interface LiteralSpan {
  readonly text: string; readonly startByte: number; readonly endByte: number;
  readonly startLine: number; readonly endLine: number; readonly sha256: string;
}
export interface SourceLiteralCard {
  readonly sourceId: string; readonly sourceSha256: string; readonly bytes: number; readonly lines: number;
  readonly classification: "host_literal"; readonly untrusted: true; readonly needsCoverageRead: true;
  readonly heading: LiteralSpan | null; readonly opening: LiteralSpan;
}
const decode = (bytes: Buffer): string => {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw Error("research_index_source_not_utf8"); }
};
function span(bytes: Buffer, startByte: number, endByte: number): LiteralSpan {
  const piece = bytes.subarray(startByte, endByte);
  const lineAt = (offset: number) => 1 + bytes.subarray(0, offset).reduce((count, byte) => count + Number(byte === 10), 0);
  return Object.freeze({ text: decode(piece), startByte, endByte, startLine: lineAt(startByte),
    endLine: lineAt(endByte > startByte ? endByte - 1 : startByte), sha256: digest(piece) });
}
/** Literal extraction only: no inferred date, selected answer, or generated summary. Byte ranges are half-open. */
export function buildLiteralSourceCard(source: { sourceId: string; bytes: Buffer }): SourceLiteralCard {
  requireSourceId(source.sourceId);
  const text = decode(source.bytes);
  if (text.includes("\0") || text.includes("\uFFFD")) throw Error("research_index_source_not_text");
  let openingEnd = Math.min(source.bytes.length, INDEX_LIMITS.literalOpeningBytes);
  while (openingEnd < source.bytes.length && openingEnd > 0 && (source.bytes[openingEnd]! & 0xc0) === 0x80) openingEnd--;
  let heading: LiteralSpan | null = null, byteOffset = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    if (/^\uFEFF? {0,3}#{1,6}(?:[ \t]+|$)/u.test(line)) {
      const literal = [...line.replace(/\r$/u, "")].slice(0, INDEX_LIMITS.literalHeadingChars).join("");
      heading = span(source.bytes, byteOffset, byteOffset + Buffer.byteLength(literal)); break;
    }
    byteOffset += Buffer.byteLength(line) + 1;
  }
  return Object.freeze({ sourceId: source.sourceId, sourceSha256: digest(source.bytes), bytes: source.bytes.length, lines: lines.length,
    classification: "host_literal", untrusted: true, needsCoverageRead: true, heading, opening: span(source.bytes, 0, openingEnd) });
}

export interface ResearchIndexEntry extends IndexModelSummary {
  readonly sourceId: string; readonly sourceSha256: string; readonly bytes: number; readonly lines: number;
  readonly modelStatus: "model_complete" | "unresolved"; readonly metadataOrigin: "model_summary" | "host_literal";
  readonly modelAttempts: number; readonly modelContentSha256: string | null; readonly issues: readonly IndexIssue[];
  readonly literal: SourceLiteralCard; readonly needsCoverageRead: true;
}
/** An unattempted source keeps its literal card; attempt counts must come from the dispatch owner. */
export function assembleIndexEntry(card: SourceLiteralCard, assessment: IndexSourceAssessment | undefined, attemptCount: number): ResearchIndexEntry {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 0 || (assessment ? attemptCount < 1 || assessment.sourceId !== card.sourceId : attemptCount !== 0)) throw Error("research_index_assessment_binding");
  const complete = assessment?.status === "model_complete";
  if (complete && (!assessment.summary?.gist.trim() || assessment.issues.length)) throw Error("research_index_complete_summary_invalid");
  return Object.freeze({ sourceId: card.sourceId, sourceSha256: card.sourceSha256, bytes: card.bytes, lines: card.lines,
    title: complete ? assessment.summary!.title : "", date: complete ? assessment.summary!.date : "",
    gist: complete ? assessment.summary!.gist : "", figures: Object.freeze(complete ? [...assessment.summary!.figures] : []),
    modelStatus: complete ? "model_complete" : "unresolved", metadataOrigin: complete ? "model_summary" : "host_literal",
    modelAttempts: attemptCount, modelContentSha256: assessment?.responseContentSha256 ?? null, issues: uniqueIssues(assessment?.issues ?? []),
    literal: card, needsCoverageRead: true });
}

/** Structural metadata counters only. Calls, repairs dispatched, and extraction coverage are owned by the pipeline. */
export function summarizeIndexEntries(entries: readonly ResearchIndexEntry[], batches: readonly IndexBatchAssessment[] = []) {
  if (new Set(entries.map(entry => entry.sourceId)).size !== entries.length) throw Error("research_index_duplicate_inventory");
  const sourcesModelComplete = entries.filter(entry => entry.modelStatus === "model_complete").length;
  return Object.freeze({ sourcesListed: entries.length, sourcesModelComplete,
    sourcesModelRepaired: entries.filter(entry => entry.modelStatus === "model_complete" && entry.modelAttempts > 1).length,
    sourcesLiteralFallback: entries.length - sourcesModelComplete, unresolvedModelSummaries: entries.length - sourcesModelComplete,
    sourcesModelUnattempted: entries.filter(entry => entry.modelAttempts === 0).length,
    invalidJsonReplies: batches.filter(batch => batch.diagnostics.jsonInvalid).length,
    invalidSchemaReplies: batches.filter(batch => batch.diagnostics.schemaInvalid || batch.diagnostics.invalidRows > 0).length,
    unexpectedRows: batches.reduce((n, batch) => n + batch.diagnostics.unexpectedRows, 0),
    duplicateExpectedIds: batches.reduce((n, batch) => n + batch.diagnostics.duplicateExpectedIds, 0),
    missingSources: batches.reduce((n, batch) => n + batch.diagnostics.missingSources, 0),
    emptyGists: batches.reduce((n, batch) => n + batch.diagnostics.emptyGists, 0),
    truncatedReplies: batches.filter(batch => batch.diagnostics.truncated).length });
}
