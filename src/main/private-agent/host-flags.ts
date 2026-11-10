import { z } from "zod";
import type { PrivateCheckpointStore, WorkspaceSnapshot } from "./checkpoints";
import { CLAIMS_LEDGER_CHECK_ID } from "./claims";
import { digest, sha256Schema } from "./contracts";
import { DOCUMENT_REVIEW_FLAG_CODES, DOCUMENT_REVIEW_FLAGS_PATH, DocumentReviewFlagsSchema } from "./document-review-flags";
import { RESEARCH_FILES } from "./research-contract";
import { ResearchCoverageSchema, ResearchEvidenceSchema } from "./research-coverage";
import type { PrivateAgentStore } from "./store";

/**
 * Backlog item 7(d), part B (BL-20261110-1153-host-flags-event-design): host flags for the owner's attention, recorded once per private
 * context after submission. The pass scans the claims report and the research packet's argument for corpus-absence claims (absence rules
 * v1), sets beside them the misses the run itself recorded and the single-unit brief disclosure (D11), and summarizes a document review's
 * `output/review-flags.json`. It never decides anything: no check's `passed`, no status, selection or acceptance. It makes no model call,
 * writes no ledger row besides its own event, never throws, and the event carries no model, report or document text.
 */
export const HOST_FLAGS_VERSION = 1;
/** document-review.ts's DOCUMENT_REVIEW_CHECK_ID, kept here so this module never loads the pinned applier (a test keeps them equal). */
export const HOST_FLAGS_REVIEW_CHECK_ID = "document_review_fidelity";
export const HOST_FLAGS_SCAN_BYTES = 1024 * 1024;
export const HOST_FLAGS_SCAN_CHARS = 1024 * 1024;
export const HOST_FLAGS_REVIEW_BYTES = 512 * 1024;
export const HOST_FLAGS_HITS_MAX = 40;
const FETCH_PURPOSE = "public source retrieval";

const SRC = "(sources?|documents?|corpus|corpora|files?|pages?|materials?|records?|reports|studies|study|literature|datasets?|texts?|articles?|filings?|references?)";
/** Absence rules v1, in order; a sentence takes the first that matches. ASCII patterns, so the `i` flag alone. */
export const ABSENCE_RULES: readonly (readonly [string, RegExp])[] = Object.freeze(([
  ["A1", String.raw`\b(none|neither|not one) of the ${SRC}\b`],
  ["A2", String.raw`\b(the|these|this|those|any|all) (\w+ ){0,2}${SRC} (do|does|did|can|could)( not|n't) (mention|address|discuss|report|provide|specify|state|cover|quantify|describe|contain|include|document|give|list|identify)\b`],
  ["A3", String.raw`\b(the|these|this|those) (\w+ ){0,2}${SRC} (contains?|provides?|offers?|includes?|gives?|has|have|mentions?|reports?) no\b`],
  ["A4", String.raw`\b(the|these|this|those) (\w+ ){0,2}${SRC} (lacks?|omits?|(is|are) silent|fails? to (mention|address|report|provide|specify|discuss|state|cover|quantify))\b`],
  ["A5", String.raw`\bno (\w+ ){0,2}${SRC} (\w+ ){0,3}(mentions?|addresses?|discusses?|reports?|states?|specif(y|ies)|documents?|covers?|provides?|quantif(y|ies)|describes?|contains?|includes?)\b`],
  ["A6", String.raw`\bthere (is|are|was|were) no (\w+ ){0,2}(evidence|information|data|figures?|statistics|mention|records?|documentation|discussion|indication|estimates?)\b`],
  ["A7", String.raw`\bno (\w+ ){0,2}(evidence|information|data|figures?|statistics|mention|details?|records?|estimates?)\b( \w+){0,6} (is|are|was|were) (available|provided|given|found|reported|cited|included|present)\b`],
  ["A8", String.raw`\b(is|are|was|were) not (mentioned|addressed|discussed|reported|documented|specified|covered|stated|quantified|described|provided|included|available) (anywhere|(in|by|within|across) (any|the|these|those) (\w+ ){0,2}${SRC})\b`],
  ["A9", String.raw`\b(nowhere|not anywhere) (in|within|across) (the|any|these) (\w+ ){0,2}${SRC}\b`],
  ["A10", String.raw`\b(absent|missing) (from|in) (the|all|any|these) (\w+ ){0,2}${SRC}\b`],
] as const).map(([id, source]) => Object.freeze([id, new RegExp(source, "i")] as const)));
const BOUNDED = /\b(extract(ed|ion)|evidence packet|packet|retained evidence|verified (evidence|quotes?)|(this|the) (review|run|extraction|search|retrieval) did not)\b/i;
/** A claim citation in a report (the claims check's form), an evidence id in the packet's argument; both case-sensitive. */
const CITED = Object.freeze({ report: /\[C[0-9]{1,3}\]/, argument: /\bE[0-9]{1,4}\b/ });
const BLOCK_START = /^\s*(#|-|\*|\+|\d+[.)]|\||>)/;
/** A heading is one line and a table row one row, so neither joins the line after it either. */
const ONE_LINE_BLOCK = /^\s*(#|\|)/;
/** A sentence ends at [.!?] before a capital, digit, quote or bracket, and at a block-level HTML tag (PARAGRAPH). */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"'([])|\u2029/g;
const FENCE = /^\s{0,3}(```|~~~)/;
/** A run of more than 30 combining marks (UAX #15's stream-safe bound) is cut to 30 before NFKC, whose canonical reordering is quadratic in the
 * length of a run of non-starters. Every non-starter is a mark, and only U+FF9E and U+FF9F decompose to one from outside the marks (Unicode 14.0.0). */
const MARK_RUN = /([\p{M}\uFF9E\uFF9F]{30})[\p{M}\uFF9E\uFF9F]+/gu;
/** An HTML tag (a name, a closing name, a declaration or a processing instruction), possibly across lines, within 4,096 characters. */
const TAG = /<(?:\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])|[!?])[^<>]{0,4096}>/g;
/** A block-level tag ends its sentence, as a blank line or a structural line does in Markdown; any other tag, `<br>` included, is a space. */
const BLOCK_TAG = /^<\/?(?:address|article|aside|blockquote|caption|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)(?=[\s/>])/i;
const PARAGRAPH = "\u2029";

const FORMATS = ["markdown", "html", "text", "docx", "pdf"] as const;
const SECTION_ERRORS = ["report_failed", "argument_failed", "misses_failed", "review_failed"] as const;
const count = z.number().int().min(0);
const scanSchema = z.object({ format: z.enum(FORMATS), scanned: z.boolean(), reason: z.enum(["missing", "format_not_scanned"]).optional(), textCut: z.boolean(),
  hits: z.array(z.object({ line: z.number().int().positive(), rule: z.enum(ABSENCE_RULES.map(([id]) => id) as [string, ...string[]]), class: z.enum(["absence", "bounded"]),
    cited: z.boolean() }).strict()).max(HOST_FLAGS_HITS_MAX), truncated: z.boolean() }).strict();
const errorName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u);
const REVIEW_RULES = ["numeric", "edits", "clauses"] as const;
/** The counts each review rule computes (REVIEW_FLAGS_PY's review_flags): a failed rule's are left out of `counts`, and a failed step's all are. */
const REVIEW_RULE_COUNTS = Object.freeze({ numeric: ["numericIntroduced", "numericResolved", "numericSource", "numericUnaddressed"], edits: ["inversionEdits"],
  clauses: ["inversionIntroduced", "inversionSource", "inversionUnaddressed"] } as const);
const reviewSchema = z.union([
  // `errors` names the step or each rule that failed; a failed part has no list here (and a failed step no `read`), so absent never reads as zero.
  z.object({ valid: z.literal(true),
    errors: z.object({ step: errorName.optional(), numeric: errorName.optional(), edits: errorName.optional(), clauses: errorName.optional() }).strict().optional(),
    read: z.object({ comparisonsCapped: z.boolean(), figuresCapped: z.boolean(), labelsCapped: z.boolean(), paragraphsClipped: count, rowsCapped: z.boolean(),
      sentencesCapped: z.boolean(), termsCapped: z.boolean() }).strict().optional(),
    numeric: z.array(z.object({ table: count, row: count, paragraph: count, inSource: z.boolean(), inClean: z.boolean(), addressed: z.boolean() }).strict()).max(40).optional(),
    edits: z.array(z.object({ id: z.string().regex(/^E[0-9]{1,3}$/u), codes: z.array(z.enum(DOCUMENT_REVIEW_FLAG_CODES)).min(1).max(4) }).strict()).max(40).optional(),
    clauses: z.array(z.object({ paragraphs: z.tuple([count, count]), inSource: z.boolean(), inClean: z.boolean(), addressed: z.boolean() }).strict()).max(40).optional() }).strict(),
  z.object({ valid: z.literal(false), reason: z.enum(["missing", "too_large", "invalid"]) }).strict(),
]);
const optionalCounts = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, count.optional()]));
/** The event as recorded; 7d.C and the registry read it through this schema. Only the parts that ran are present. */
export const HostFlagsEventSchema = z.object({
  type: z.literal("host_flags"), contextId: z.string().min(1).max(100), version: z.literal(HOST_FLAGS_VERSION),
  rules: z.object({ absence: z.literal(1).optional(), review: z.literal(1).optional() }).strict(),
  packet: z.object({ coverageSha256: sha256Schema }).strict().optional(),
  report: scanSchema.optional(), argument: scanSchema.optional(),
  misses: z.object(optionalCounts(["briefUnits", "questionsWithoutEvidence", "unresolvedQuestions", "noEvidenceOutcomes", "extractionRetries", "droppedQuotes",
    "fetchFailures", "fetchLimitRefusals"])).strict().optional(),
  review: reviewSchema.optional(),
  counts: z.object(optionalCounts(["reportAbsence", "reportAbsenceUncited", "reportBounded", "argumentAbsence", "argumentAbsenceUncited", "argumentBounded",
    "briefSingleUnit", "inversionEdits", "inversionIntroduced", "inversionSource", "inversionUnaddressed", "numericIntroduced", "numericResolved", "numericSource",
    "numericUnaddressed"])).strict(),
  errors: z.array(z.enum(SECTION_ERRORS)).min(1).max(4).optional(),
}).strict();
export type HostFlagsEvent = z.infer<typeof HostFlagsEventSchema>;

/** The claims report: the first required artifact ending `.md`, else the first required artifact (withClaimsLedger's rule, verbatim). */
export function claimsReportPath(contract: { requiredArtifacts: readonly { path: string }[] }): string {
  return contract.requiredArtifacts.find(artifact => artifact.path.endsWith(".md"))?.path ?? contract.requiredArtifacts[0]!.path;
}

type Format = typeof FORMATS[number];
type Scan = z.infer<typeof scanSchema>;
type Tally = { absence: number; uncited: number; bounded: number };
function formatOf(path: string, bytes: Buffer): Format {
  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "docx";
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown") ? "markdown" : lower.endsWith(".html") || lower.endsWith(".htm") ? "html" : "text";
}

/** At most HOST_FLAGS_SCAN_BYTES, cut at a UTF-8 boundary before decoding; long mark runs cut; fences and comments blanked line for line; tags
 * stripped across lines, keeping each line; each line normalized and trimmed; at most HOST_FLAGS_SCAN_CHARS after normalizing. Every step is linear
 * in its input. */
function preparedLines(bytes: Buffer): { lines: string[]; cut: boolean } {
  let end = Math.min(bytes.length, HOST_FLAGS_SCAN_BYTES);
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  let cut = end < bytes.length, fence = false, comment = false, total = 0;
  const kept: string[] = [];
  for (const raw of bytes.subarray(0, end).toString("utf8").replace(MARK_RUN, "$1").split(/\r\n|\r|\n/)) {
    // A fence opens or closes only outside a comment.
    if (!comment && FENCE.test(raw)) { fence = !fence; kept.push(""); continue; }
    if (fence) { kept.push(""); continue; }
    let line = "", at = 0;
    while (at < raw.length) {
      if (comment) { const close = raw.indexOf("-->", at); if (close < 0) break; comment = false; at = close + 3; continue; }
      const open = raw.indexOf("<!--", at);
      if (open < 0) { line += raw.slice(at); break; }
      line += raw.slice(at, open); comment = true; at = open + 4;
    }
    kept.push(line);
  }
  const lines: string[] = [];
  for (const stripped of kept.join("\n").replace(TAG, tag => (BLOCK_TAG.test(tag) ? PARAGRAPH : " ") + tag.replace(/[^\n]/g, "")).split("\n")) {
    // Trimmed, so a wrapped line's indent or a hard break's trailing spaces leave one space at the fold.
    let line = stripped.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, "\"").replace(/[ \t]+/g, " ").replace(/^ | $/g, "");
    if (total + line.length > HOST_FLAGS_SCAN_CHARS) { line = line.slice(0, Math.max(0, HOST_FLAGS_SCAN_CHARS - total)); cut = true; lines.push(line); break; }
    total += line.length + 1; lines.push(line);
  }
  return { lines, cut };
}

/** Blocks end at a blank line, before a structural line (a heading, a list item, a table row, a quote), and after a heading or a table row;
 * sentences end at [.!?] before a capital, digit, quote or bracket. Newlines inside a block are folded into spaces one for one, so a match's
 * offset gives its own line. */
function scanText(path: string, bytes: Buffer | undefined, cited: RegExp): { scan: Scan; tally: Tally } {
  const tally: Tally = { absence: 0, uncited: 0, bounded: 0 };
  if (!bytes) return { scan: { format: formatOf(path, Buffer.alloc(0)), scanned: false, reason: "missing", textCut: false, hits: [], truncated: false }, tally };
  const format = formatOf(path, bytes);
  if (format === "docx" || format === "pdf") return { scan: { format, scanned: false, reason: "format_not_scanned", textCut: false, hits: [], truncated: false }, tally };
  const { lines, cut } = preparedLines(bytes), hits: Scan["hits"] = [];
  let found = 0;
  const flush = (start: number, block: string[]) => {
    if (!block.length) return;
    const text = block.join(" ");
    let begin = 0, line = 0, lineEnd = block[0]!.length;
    const sentences: [number, number][] = [];
    for (const breakAt of text.matchAll(SENTENCE_BREAK)) { sentences.push([begin, breakAt.index]); begin = breakAt.index + breakAt[0].length; }
    sentences.push([begin, text.length]);
    for (const [from, to] of sentences) {
      const sentence = text.slice(from, to);
      for (const [rule, pattern] of ABSENCE_RULES) {
        const match = pattern.exec(sentence);
        if (!match) continue;
        const bounded = BOUNDED.test(sentence), isCited = cited.test(sentence);
        if (bounded) tally.bounded++; else { tally.absence++; if (!isCited) tally.uncited++; }
        if (++found <= HOST_FLAGS_HITS_MAX) {
          // The line of the match itself, by a forward cursor: a block's hits come in offset order, one per sentence at most.
          const offset = from + match.index;
          while (offset > lineEnd) lineEnd += block[++line]!.length + 1;
          hits.push({ line: start + line + 1, rule, class: bounded ? "bounded" : "absence", cited: isCited });
        }
        break;
      }
    }
  };
  let start = 0, block: string[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) { flush(start, block); block = []; return; }
    if (!block.length || BLOCK_START.test(line)) { flush(start, block); block = [line]; start = index; } else block.push(line);
    if (ONE_LINE_BLOCK.test(line)) { flush(start, block); block = []; }
  });
  flush(start, block);
  return { scan: { format, scanned: true, textCut: cut, hits, truncated: found > HOST_FLAGS_HITS_MAX }, tally };
}

function fetchLimitRefused(output: unknown): boolean {
  if (typeof output !== "string") return false;
  try { return (JSON.parse(output) as { error?: unknown } | null)?.error === "public_fetch_limit_reached"; } catch { return false; }
}

type Input = { store: PrivateAgentStore; jobId: string; contextId: string; checkpoints: PrivateCheckpointStore; finalSnapshot: WorkspaceSnapshot;
  phase: { contract: { requiredChecks: readonly string[]; requiredArtifacts: readonly { path: string }[] }; files: readonly { path: string; bytes: Buffer }[] } };

/** Builds the event; each section runs on its own and a failed one records its code, never its message. */
export function hostFlagsEvent(input: Input): HostFlagsEvent | undefined {
  const research = input.phase.contract.requiredChecks.includes(CLAIMS_LEDGER_CHECK_ID), review = input.phase.contract.requiredChecks.includes(HOST_FLAGS_REVIEW_CHECK_ID);
  if (!research && !review) return undefined;
  const errors: (typeof SECTION_ERRORS[number])[] = [], counts: HostFlagsEvent["counts"] = {}, event: HostFlagsEvent = { type: "host_flags", contextId: input.contextId,
    version: HOST_FLAGS_VERSION, rules: {}, counts };
  const section = (code: typeof SECTION_ERRORS[number], run: () => void) => { try { run(); } catch { errors.push(code); } };
  const load = (path: string) => { const entry = input.finalSnapshot.find(item => item.path === path); return entry ? input.checkpoints.load([entry])[0]!.bytes : undefined; };
  if (research) {
    section("report_failed", () => {
      const path = claimsReportPath(input.phase.contract), { scan, tally } = scanText(path, load(path), CITED.report);
      event.report = scan;
      if (scan.scanned) { event.rules.absence = 1; Object.assign(counts, { reportAbsence: tally.absence, reportAbsenceUncited: tally.uncited, reportBounded: tally.bounded }); }
    });
    const argument = input.phase.files.find(file => file.path === RESEARCH_FILES.argument);
    if (argument) section("argument_failed", () => {
      const { scan, tally } = scanText(argument.path, argument.bytes, CITED.argument);
      event.argument = scan;
      if (scan.scanned) { event.rules.absence = 1; Object.assign(counts, { argumentAbsence: tally.absence, argumentAbsenceUncited: tally.uncited, argumentBounded: tally.bounded }); }
    });
    section("misses_failed", () => {
      const misses: NonNullable<HostFlagsEvent["misses"]> = {}, coverageFile = input.phase.files.find(file => file.path === RESEARCH_FILES.coverage);
      let packet: { coverageSha256: string; singleUnit: number } | undefined;
      if (coverageFile) {
        const coverage = ResearchCoverageSchema.parse(JSON.parse(coverageFile.bytes.toString("utf8")));
        const retained = new Set(coverage.chunks.flatMap(chunk => chunk.questions.filter(question => question.status === "evidence_retained").map(question => question.questionId)));
        misses.briefUnits = coverage.units.length;
        misses.questionsWithoutEvidence = coverage.synthesis.questions.filter(question => !retained.has(question.questionId)).length;
        misses.unresolvedQuestions = coverage.synthesis.questions.filter(question => question.disposition === "unresolved").length;
        misses.noEvidenceOutcomes = coverage.chunks.reduce((sum, chunk) => sum + chunk.questions.filter(question => question.status === "no_verified_evidence").length, 0);
        misses.extractionRetries = coverage.chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.attempts.length - 1), 0);
        const evidenceFile = input.phase.files.find(file => file.path === RESEARCH_FILES.evidence);
        if (evidenceFile) misses.droppedQuotes = ResearchEvidenceSchema.parse(JSON.parse(evidenceFile.bytes.toString("utf8"))).counts.droppedUnverifiedOrDuplicate;
        packet = { coverageSha256: digest(coverageFile.bytes), singleUnit: coverage.units.length === 1 ? 1 : 0 };
      }
      misses.fetchFailures = input.store.dispatches(input.jobId).filter(row => row.purpose === FETCH_PURPOSE && row.status === "failed").length;
      misses.fetchLimitRefusals = input.store.events(input.jobId).filter(item => item.type === "tool_finished" && fetchLimitRefused(item.output)).length;
      // All or nothing: a section that fails part way records none of its parts.
      event.misses = misses;
      if (packet) { event.packet = { coverageSha256: packet.coverageSha256 }; counts.briefSingleUnit = packet.singleUnit; }
    });
  }
  if (review) section("review_failed", () => {
    event.rules.review = 1;
    const entry = input.finalSnapshot.find(item => item.path === DOCUMENT_REVIEW_FLAGS_PATH);
    if (!entry) { event.review = { valid: false, reason: "missing" }; return; }
    if (entry.bytes > HOST_FLAGS_REVIEW_BYTES) { event.review = { valid: false, reason: "too_large" }; return; }
    // A storage failure fails the section (`review_failed`); only a file that does not parse or validate is `invalid`.
    const bytes = input.checkpoints.load([entry])[0]!.bytes;
    let parsed: ReturnType<typeof DocumentReviewFlagsSchema.safeParse>;
    try { parsed = DocumentReviewFlagsSchema.safeParse(JSON.parse(bytes.toString("utf8"))); }
    catch { event.review = { valid: false, reason: "invalid" }; return; }
    if (!parsed.success) { event.review = { valid: false, reason: "invalid" }; return; }
    const flags = parsed.data, failed: { step?: string; numeric?: string; edits?: string; clauses?: string } = {};
    if (flags.error !== undefined) failed.step = flags.error;
    for (const rule of REVIEW_RULES) if (flags[rule].error !== undefined) failed[rule] = flags[rule].error;
    // The applier leaves a failed rule's list empty and its counts at zero, and a failed step's all of them: here they are absent instead.
    const ran = (rule: typeof REVIEW_RULES[number]) => failed.step === undefined && failed[rule] === undefined;
    event.review = { valid: true, ...(Object.keys(failed).length ? { errors: failed } : {}), ...(failed.step === undefined ? { read: flags.read } : {}),
      ...(ran("numeric") ? { numeric: flags.numeric.flags.map(flag => ({ table: flag.table, row: flag.row, paragraph: flag.paragraph, inSource: flag.inSource,
        inClean: flag.inClean, addressed: flag.addressedBy.length > 0 })) } : {}),
      ...(ran("edits") ? { edits: flags.edits.flags.map(flag => ({ id: flag.id, codes: [...flag.codes] })) } : {}),
      ...(ran("clauses") ? { clauses: flags.clauses.flags.map(flag => ({ paragraphs: [flag.paragraphs[0], flag.paragraphs[1]] as [number, number], inSource: flag.inSource,
        inClean: flag.inClean, addressed: flag.addressedBy.length > 0 })) } : {}) };
    for (const rule of REVIEW_RULES) if (ran(rule)) for (const name of REVIEW_RULE_COUNTS[rule]) counts[name] = flags.counts[name];
  });
  if (errors.length) event.errors = errors;
  return HostFlagsEventSchema.parse(event);
}

/** Records the event once per context, after `session_submitted`. Never throws. A failed append records nothing: a later run of the same session
 * records it (after a crash, a pause in the entailment pass or a resumable failure), but a session that still ends submitted is never rerun, so
 * its event is lost. A reader takes a missing event as "not recorded", never as "no flags". */
export function recordHostFlags(input: Input): void {
  try {
    const recorded = () => input.store.events(input.jobId).some(item => item.type === "host_flags" && item.contextId === input.contextId);
    if (recorded()) return;
    const event = hostFlagsEvent(input);
    if (!event) return;
    input.store.atomic(() => { if (!recorded()) input.store.append(input.jobId, event); });
  } catch { /* never throws: the pass is evidence beside the result, and a later run records it */ }
}
