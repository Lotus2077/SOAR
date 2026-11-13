import { z } from "zod";
import { canonical, digest, sha256Schema } from "./contracts";
import { ResearchPlanSchema, validatePlanCoverage, validateResearchPlanAttempts, type ResearchPlan } from "./research-plan";
export { ResearchPlanSchema, validatePlanCoverage, type ResearchPlan } from "./research-plan";
import { RESEARCH_COVERAGE_POLICY, RESEARCH_FILES, RESEARCH_PIPELINE_VERSION, RESEARCH_SLOT_POLICY, type ResearchBudget, type ResearchSourceIdentity } from "./research-contract";
import { hostFallbackPlan, hostSkeletonSynthesis } from "./research-fallback";

const id = z.string().min(1).max(2048), qid = z.string().regex(/^Q[0-9]{1,2}$/u), uid = z.string().regex(/^U[0-9]{1,4}$/u), eid = z.string().regex(/^E[0-9]{1,4}$/u);
const integer = z.number().int().nonnegative();
const sourceIdentity = z.object({ id, path: z.string().min(1).max(2048), sha256: sha256Schema, bytes: integer }).strict();
export const ResearchEvidenceSchema = z.object({ version: z.literal(2), quotes: z.array(z.object({ id: eid, questionIds: z.array(qid).min(1).max(12), sourceId: id,
  sourceSha256: sha256Schema, chunkIds: z.array(z.string().min(1).max(80)).min(1).max(4096), locator: z.string().min(1).max(100), quote: z.string().min(12).max(600), note: z.string().max(200) }).strict()).max(480),
  conflicts: z.array(z.object({ questionIds: z.array(qid).min(1).max(12), sourceId: id, note: z.string().max(300) }).strict()).max(16),
  counts: z.object({ verified: integer, inPacket: integer, leftByCap: integer, droppedUnverifiedOrDuplicate: integer, conflictsNoted: integer }).strict() }).strict();
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;
export const BriefUnitSchema = z.object({ id: uid, startByte: integer, endByte: integer, text: z.string(), sha256: sha256Schema }).strict();
export type BriefUnit = z.infer<typeof BriefUnitSchema>;
const questionOutcome = z.object({ questionId: qid, status: z.enum(["evidence_retained", "no_verified_evidence", "needs_followup"]), evidenceIds: z.array(eid).max(480) }).strict();
const synthesisQuestion = z.object({ questionId: qid, disposition: z.enum(["findings", "conflict", "unresolved"]), evidenceIds: z.array(eid).max(480) }).strict();
/** Version 2 since 7(c) (BL-20261113-0910-research-v5-design): `fallbacks` discloses a host plan or a host skeleton, and the synthesis status may be `skeleton`. */
export const ResearchCoverageSchema = z.object({ version: z.literal(2), protocolSha256: sha256Schema, briefSha256: sha256Schema, briefBytes: integer,
  sourceManifestSha256: sha256Schema, units: z.array(BriefUnitSchema).min(1).max(128),
  sources: z.array(sourceIdentity.extend({ readable: z.boolean() }).strict()).min(1).max(4096),
  chunks: z.array(z.object({ id: z.string().min(1).max(80), sourceId: id, sourceSha256: sha256Schema, startByte: integer, endByte: integer, sha256: sha256Schema,
    startLine: z.number().int().positive(), status: z.enum(["pending", "complete", "invalid", "truncated", "needs_followup"]),
    attempts: z.array(z.object({ responseSha256: sha256Schema, status: z.enum(["complete", "invalid", "truncated", "needs_followup"]) }).strict()).max(2),
    questions: z.array(questionOutcome).max(12) }).strict()).max(4096),
  omissions: z.array(z.object({ sourceId: id, questionIds: z.array(qid).min(1).max(12), quoteSha256: sha256Schema, reason: z.literal("packet_cap") }).strict()).max(480),
  conflictOmissions: z.array(z.object({ sourceId: id, questionIds: z.array(qid).min(1).max(12), noteSha256: sha256Schema, reason: z.literal("conflict_cap") }).strict()).max(160),
  unresolved: z.array(z.string().min(1).max(80)).max(4096),
  synthesis: z.object({ status: z.enum(["pending", "complete", "invalid", "skeleton"]), argumentSha256: sha256Schema.optional(), questions: z.array(synthesisQuestion).max(12) }).strict(),
  fallbacks: z.object({ plan: z.enum(["none", "host_plan"]), synthesis: z.enum(["none", "skeleton"]) }).strict(),
  status: z.enum(["ready", "incomplete"]), semanticAcceptance: z.literal("not_evaluated"), corpusAbsenceEstablished: z.literal(false) }).strict();
export type ResearchCoverage = z.infer<typeof ResearchCoverageSchema>;
export const ResearchSynthesisSchema = z.object({ version: z.literal(1), argument: z.string().min(1).max(128 * 1024), questions: z.array(synthesisQuestion).min(1).max(12) }).strict();
/**
 * 7(c): one synthesis attempt as the synthesis stage row records it, hash-only. `slot` marks the assist and its one retry after a
 * truncated assist reply (absent: the stage model). Ordinals run over every attempt.
 */
export const ResearchSynthesisAttemptSchema = z.object({ ordinal: z.number().int().min(1).max(4), slot: z.enum(["assist", "assist_retry"]).optional(),
  replyContentSha256: sha256Schema, replyBytes: integer, truncated: z.boolean(), accepted: z.boolean() }).strict();
export type ResearchSynthesisAttempt = z.infer<typeof ResearchSynthesisAttemptSchema>;
/** 7(c): the synthesis attempts' order, counts and acceptance; a marked skeleton has no accepted attempt. */
function validateSynthesisAttempts(stage: { calls: number; invalidReplies: number; truncatedReplies?: number; synthesisAttempts?: unknown; fallback?: unknown }, synthesisCalls: number): void {
  const reject = (): never => fail("synthesis_attempts");
  const parsed = z.array(ResearchSynthesisAttemptSchema).min(1).max(synthesisCalls + RESEARCH_SLOT_POLICY.synthesis.assist + RESEARCH_SLOT_POLICY.synthesis.assistRetryOnTruncation).safeParse(stage.synthesisAttempts);
  if (!parsed.success) return reject();
  const attempts = parsed.data, skeleton = stage.fallback === "skeleton";
  if (stage.fallback !== undefined && !skeleton) reject();
  if (attempts.length !== stage.calls || stage.invalidReplies !== attempts.filter(a => !a.accepted).length || (stage.truncatedReplies ?? 0) !== attempts.filter(a => a.truncated).length) reject();
  const slots = attempts.map(a => a.slot ?? "stage"), first = slots.indexOf("assist"), stageAttempts = slots.filter(slot => slot === "stage").length;
  if (stageAttempts > synthesisCalls || slots.filter(slot => slot === "assist").length > 1 || slots.filter(slot => slot === "assist_retry").length > 1) reject();
  // The retry follows a truncated assist reply directly; the assist block (the assist and its retry) sits first or after every stage attempt.
  if (slots.includes("assist_retry") && (first < 0 || slots[first + 1] !== "assist_retry" || !attempts[first]!.truncated)) reject();
  // A skeleton follows only after every stage attempt was spent: a fallback taken earlier is no schedule the pipeline runs.
  if (skeleton && stageAttempts !== synthesisCalls) reject();
  const blockEnd = first < 0 ? -1 : first + (slots[first + 1] === "assist_retry" ? 1 : 0);
  if (first > 0 && (stageAttempts !== synthesisCalls || blockEnd !== attempts.length - 1 || slots.slice(0, first).some(slot => slot !== "stage"))) reject();
  for (const [i, attempt] of attempts.entries()) if (attempt.ordinal !== i + 1 || attempt.accepted !== (!skeleton && i === attempts.length - 1) || (attempt.accepted && attempt.truncated)) reject();
}
export type ResearchPacketFile = { path: string; bytes: Buffer };
export interface ResearchPacketExpectation { brief?: string; sources?: readonly { id: string; path: string; bytes: Buffer }[]; sourceManifest?: readonly ResearchSourceIdentity[]; protocolSha256?: string; budget?: ResearchBudget }

const PYTHON_SPACE = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
/** The claims check's `norm`: NFKC, then whitespace runs collapsed to one space with no leading or trailing space. */
export function normalizeQuoteText(value: string): string { return value.normalize("NFKC").split(PYTHON_SPACE).filter(Boolean).join(" "); }
/**
 * The line branch of the claims check's `locate` for text sources: lines are normalised and joined with single spaces, the
 * normalised quote must occur verbatim, and the locator names the line or line range. The check's HTML-text, PDF and
 * DOCX units are not ported: a quote this finds also passes the check (lines are searched first there); a quote only the
 * check's wider units would find is dropped here.
 */
export function locateQuote(sourceText: string, normalizedQuote: string): { locator: string } | undefined {
  if (!normalizedQuote) return undefined;
  const lines = sourceText.split("\n").map(normalizeQuoteText);
  const offsets: number[] = []; let joined = "";
  for (const line of lines) { offsets.push(joined.length); joined += `${line} `; }
  const position = joined.indexOf(normalizedQuote);
  if (position < 0) return undefined;
  const lineAt = (at: number) => { let index = 0; for (let i = 0; i < offsets.length; i++) if (offsets[i]! <= at) index = i; return index; };
  const start = lineAt(position), end = lineAt(position + normalizedQuote.length - 1);
  return { locator: end > start ? `lines ${start + 1}-${end + 1}` : `line ${start + 1}` };
}


/** Turn a verified chunk-relative occurrence into the source's line locator. */
export function locateChunkQuote(text: string, normalizedQuote: string, startLine: number): { locator: string } | undefined {
  const located = locateQuote(text, normalizedQuote); if (!located) return undefined;
  const numbers = located.locator.match(/\d+/gu)!.map(n => Number(n) + startLine - 1);
  return { locator: numbers.length === 1 ? `line ${numbers[0]}` : `lines ${numbers[0]}-${numbers[1]}` };
}

const fail = (reason: string): never => { throw new Error(`research_packet_${reason}`); };
const unique = (values: readonly string[]) => new Set(values).size === values.length;
export function sourceManifestIdentity(sources: readonly ResearchSourceIdentity[]): string { return digest(canonical([...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))); }
export function deriveBriefUnits(brief: string): BriefUnit[] {
  const bytes = Buffer.from(brief); if (!bytes.length || new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== brief) throw new Error("research_brief_invalid");
  const boundaries = [0]; let charOffset = 0;
  for (const line of brief.split(/(?<=\n)/u)) {
    if (/^\s*\d+[.)]\s+\S/u.test(line) && charOffset > 0) boundaries.push(Buffer.byteLength(brief.slice(0, charOffset)));
    charOffset += line.length;
  }
  if (boundaries.length > 128) boundaries.splice(1);
  boundaries.push(bytes.length);
  return boundaries.slice(0, -1).map((startByte, i) => { const endByte = boundaries[i + 1]!, text = bytes.subarray(startByte, endByte).toString("utf8");
    return { id: `U${i + 1}`, startByte, endByte, text, sha256: digest(Buffer.from(text)) }; });
}
export function researchSourceText(source: { path: string; bytes: Buffer }): string | undefined {
  const lower = source.path.toLowerCase();
  if (lower.endsWith(".pdf") || lower.endsWith(".docx") || source.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || source.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || source.bytes.includes(0)) return undefined;
  try { const text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes); return text.includes("�") ? undefined : text; } catch { return undefined; }
}
export function inventoryResearchSources(sources: readonly { id: string; path: string; bytes: Buffer }[]) {
  if (!sources.length || !unique(sources.map(s => s.id))) throw new Error("research_source_inventory_invalid");
  const ordered = [...sources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const identities = ordered.map(source => sourceIdentity.parse({ id: source.id, path: source.path, bytes: source.bytes.length, sha256: digest(source.bytes) }));
  const inventory: ResearchCoverage["sources"] = [], chunks: ResearchCoverage["chunks"] = [];
  for (const [i, source] of ordered.entries()) {
    const text = researchSourceText(source), identity = identities[i]!; inventory.push({ ...identity, readable: text !== undefined });
    if (text === undefined) continue;
    let start = 0, ordinal = 0;
    do {
      let end = Math.min(start + RESEARCH_COVERAGE_POLICY.chunkBytes, source.bytes.length);
      if (end < source.bytes.length) {
        while (end > start && (source.bytes[end]! & 0xc0) === 0x80) end--;
        const newline = source.bytes.lastIndexOf(10, end - 1);
        if (newline >= start + RESEARCH_COVERAGE_POLICY.chunkBytes / 2) end = newline + 1;
      }
      chunks.push({ id: `S${i + 1}C${++ordinal}`, sourceId: source.id, sourceSha256: identity.sha256, startByte: start, endByte: end,
        sha256: digest(source.bytes.subarray(start, end)), startLine: source.bytes.subarray(0, start).toString("utf8").split("\n").length, status: "pending", attempts: [], questions: [] });
      if (end === source.bytes.length) break;
      let next = Math.max(start + 1, end - RESEARCH_COVERAGE_POLICY.overlapBytes);
      while (next < end && (source.bytes[next]! & 0xc0) === 0x80) next++;
      start = next;
    } while (true);
  }
  return { sources: inventory, chunks, sourceManifest: identities, sourceManifestSha256: sourceManifestIdentity(identities) };
}

export function renderResearchEvidence(evidence: ResearchEvidence, plan: ResearchPlan): string {
  const questions = plan.questions.map(q => `- ${q.id} (${q.requirementIds.join(", ")}): ${q.text}`).join("\n");
  const quotes = evidence.quotes.map(q => `- [${q.id}] ${q.sourceId} (${q.locator}; questions ${q.questionIds.join(", ")}): ${JSON.stringify(q.quote)}${q.note ? ` — extractor note (unverified): ${q.note}` : ""}`).join("\n");
  const conflicts = evidence.conflicts.length ? `\n\n## Conflicts noted by the extractor (unverified)\n${evidence.conflicts.map(c => `- ${c.questionIds.join(", ")} ${c.sourceId}: ${c.note}`).join("\n")}` : "";
  return `# Verified quote occurrences; relevance and truth remain unverified\n\n${questions}\n\n## Evidence\n${quotes}${conflicts}\n`;
}
const budgetSchema = z.object({ indexCalls: z.number().int().positive(), extractionCalls: z.number().int().positive(), plannerCalls: z.number().int().positive(), synthesisCalls: z.number().int().positive() }).strict();
const summarySchema = z.object({ version: z.literal(RESEARCH_PIPELINE_VERSION), protocolSha256: sha256Schema, budget: budgetSchema,
  stages: z.array(z.object({ stage: z.enum(["index", "plan", "extract", "synthesise"]), calls: integer, invalidReplies: integer, truncatedReplies: integer.optional(), denied: z.string().optional() }).passthrough()).length(4) }).strict();
export function validateReadyResearchPacket(files: readonly ResearchPacketFile[], expected: ResearchPacketExpectation = {}) {
  const names = Object.values(RESEARCH_FILES).sort();
  if (canonical(files.map(f => f.path).sort()) !== canonical(names)) fail("files");
  const byPath = new Map(files.map(f => [f.path, f.bytes]));
  const read = (path: string) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(byPath.get(path)!); } catch { return fail("utf8"); } };
  const parse = (path: string): unknown => { try { return JSON.parse(read(path)); } catch { return fail("json"); } };
  const coverage = ResearchCoverageSchema.parse(parse(RESEARCH_FILES.coverage)), plan = ResearchPlanSchema.parse(parse(RESEARCH_FILES.plan)), evidence = ResearchEvidenceSchema.parse(parse(RESEARCH_FILES.evidence));
  const summary = summarySchema.parse(parse(RESEARCH_FILES.summary));
  // 7(c): every JSON file holds exactly the canonical form of its value, as the pipeline writes it. The gate checks parsed values
  // while the writer's presentation shows the files' text, so a duplicate key or any other spelling could otherwise show the
  // writer text the gate never saw (and the host plan's check below would not be byte for byte).
  for (const path of [RESEARCH_FILES.index, RESEARCH_FILES.plan, RESEARCH_FILES.evidence, RESEARCH_FILES.summary, RESEARCH_FILES.coverage])
    if (read(path) !== `${canonical(parse(path))}\n`) fail("json_form");
  if (coverage.status !== "ready" || coverage.unresolved.length || coverage.omissions.length || coverage.conflictOmissions.length || coverage.sources.some(s => !s.readable) || coverage.chunks.some(c => c.status !== "complete" || !c.attempts.length || c.attempts.at(-1)?.status !== "complete") ||
    coverage.synthesis.status !== (coverage.fallbacks.synthesis === "skeleton" ? "skeleton" : "complete")) fail("not_ready");
  if (coverage.protocolSha256 !== summary.protocolSha256 || (expected.protocolSha256 && expected.protocolSha256 !== summary.protocolSha256) || (expected.budget && canonical(expected.budget) !== canonical(summary.budget))) fail("protocol");
  // 7(c): the plan and synthesis ceilings are the budget plus the assist slots; a settled assist reply is one of its stage's calls.
  const stageLimits = { index: summary.budget.indexCalls, plan: summary.budget.plannerCalls + RESEARCH_SLOT_POLICY.plan.assist, extract: summary.budget.extractionCalls,
    synthesise: summary.budget.synthesisCalls + RESEARCH_SLOT_POLICY.synthesis.assist + RESEARCH_SLOT_POLICY.synthesis.assistRetryOnTruncation };
  // A marked fallback is the one stage outcome with no accepted reply: its rejected replies then equal its calls.
  const fallbackOf = (stage: { stage: string; fallback?: unknown }) => stage.stage === "plan" ? stage.fallback === "host_plan" : stage.stage === "synthesise" ? stage.fallback === "skeleton" : false;
  if (summary.stages.some(s => s.invalidReplies > s.calls || (s.truncatedReplies ?? 0) > s.calls) || summary.stages.filter(s => s.stage === "plan" || s.stage === "synthesise")
    .some(s => (fallbackOf(s) ? s.invalidReplies !== s.calls : s.invalidReplies >= s.calls) || (s.truncatedReplies ?? 0) > s.invalidReplies)) fail("stage_success_contradiction");
  if (canonical(summary.stages.map(s => s.stage)) !== canonical(["index", "plan", "extract", "synthesise"]) || summary.stages.some(s => s.calls < 1 || s.calls > stageLimits[s.stage] || s.denied)) fail("stage_counts");
  // 7(c): attempt records and fallback markers belong to their own stage's row only.
  const stageKeys: Record<string, readonly string[]> = { index: [], plan: ["planAttempts", "fallback"], extract: [], synthesise: ["synthesisAttempts", "fallback"] };
  if (summary.stages.some(s => ["planAttempts", "synthesisAttempts", "fallback"].some(key => key in s && !stageKeys[s.stage]!.includes(key)))) fail("stage_keys");
  const brief = coverage.units.map(u => u.text).join("");
  if (digest(Buffer.from(brief)) !== coverage.briefSha256 || Buffer.byteLength(brief) !== coverage.briefBytes || canonical(deriveBriefUnits(brief)) !== canonical(coverage.units) || (expected.brief !== undefined && expected.brief !== brief)) fail("brief");
  validatePlanCoverage(plan, coverage.units, coverage.sources);
  validateResearchPlanAttempts(summary.stages[1]!, plan, coverage.units, { plannerCalls: summary.budget.plannerCalls });
  validateSynthesisAttempts(summary.stages[3]!, summary.budget.synthesisCalls);
  // 7(c): a marked fallback must be the host's own recomputation, byte for byte, and only a marked stage may carry one.
  if ((coverage.fallbacks.plan === "host_plan") !== fallbackOf(summary.stages[1]!) || (coverage.fallbacks.synthesis === "skeleton") !== fallbackOf(summary.stages[3]!)) fail("fallback_marker");
  if (coverage.fallbacks.plan === "host_plan" && canonical(plan) !== canonical(hostFallbackPlan(coverage.units))) fail("fallback_plan");
  const sourceManifest = coverage.sources.map(({ readable: _readable, ...s }) => s);
  if (!unique(sourceManifest.map(s => s.id)) || sourceManifestIdentity(sourceManifest) !== coverage.sourceManifestSha256 || (expected.sourceManifest && sourceManifestIdentity(expected.sourceManifest) !== coverage.sourceManifestSha256)) fail("sources");
  if (expected.sources) {
    const actual = inventoryResearchSources(expected.sources);
    if (actual.sourceManifestSha256 !== coverage.sourceManifestSha256 || canonical(actual.chunks.map(({ status: _s, attempts: _a, questions: _q, ...c }) => c)) !== canonical(coverage.chunks.map(({ status: _s, attempts: _a, questions: _q, ...c }) => c))) fail("source_bytes");
  }
  if (!unique(coverage.chunks.map(c => c.id))) fail("chunk_ids");
  for (const source of sourceManifest) {
    const chunks = coverage.chunks.filter(c => c.sourceId === source.id).sort((a, b) => a.startByte - b.startByte);
    let reached = 0;
    if (!chunks.length) fail("source_unread");
    for (const chunk of chunks) { if (chunk.sourceSha256 !== source.sha256 || chunk.startByte > reached || chunk.endByte < chunk.startByte || chunk.endByte > source.bytes || chunk.endByte - chunk.startByte > RESEARCH_COVERAGE_POLICY.chunkBytes) fail("chunk_gap"); reached = Math.max(reached, chunk.endByte); }
    if (reached !== source.bytes) fail("source_tail");
  }
  if (coverage.chunks.some(c => !sourceManifest.some(s => s.id === c.sourceId))) fail("chunk_source");
  if (summary.stages[2]!.invalidReplies !== coverage.chunks.reduce((n, c) => n + c.attempts.filter(a => a.status !== "complete").length, 0) || (summary.stages[2]!.truncatedReplies ?? 0) !== coverage.chunks.reduce((n, c) => n + c.attempts.filter(a => a.status === "truncated").length, 0)) fail("extraction_attempt_counts");
  if (summary.stages[2]!.calls !== coverage.chunks.reduce((n, c) => n + c.attempts.length, 0)) fail("extraction_receipts");
  const questions = new Set(plan.questions.map(q => q.id)), evidenceIds = new Set(evidence.quotes.map(q => q.id));
  if (!evidence.quotes.length || !unique(evidence.quotes.map(q => q.id)) || evidence.counts.leftByCap || evidence.counts.inPacket !== evidence.quotes.length || evidence.counts.verified !== evidence.quotes.length) fail("evidence_counts");
  for (const quote of evidence.quotes) {
    const source = sourceManifest.find(s => s.id === quote.sourceId);
    if (normalizeQuoteText(quote.quote) !== quote.quote || [...quote.quote].length < 12 || [...quote.quote].length > 300) fail("quote_length");
    if (!source || source.sha256 !== quote.sourceSha256 || !unique(quote.questionIds) || quote.questionIds.some(q => !questions.has(q)) || !unique(quote.chunkIds) || quote.chunkIds.some(c => !coverage.chunks.some(chunk => chunk.id === c && chunk.sourceId === quote.sourceId))) fail("quote_binding");
  }
  for (const chunk of coverage.chunks) {
    if (!unique(chunk.questions.map(q => q.questionId)) || canonical(chunk.questions.map(q => q.questionId).sort()) !== canonical([...questions].sort())) fail("chunk_questions");
    for (const q of chunk.questions) {
      if (!unique(q.evidenceIds) || q.status === "needs_followup" || (q.status === "no_verified_evidence" && q.evidenceIds.length) || (q.status === "evidence_retained" && !q.evidenceIds.length)) fail("question_outcome");
      for (const e of q.evidenceIds) { const quote = evidence.quotes.find(item => item.id === e); if (!quote || !quote.questionIds.includes(q.questionId) || !quote.chunkIds.includes(chunk.id)) fail("question_quote"); }
    }
  }
  for (const quote of evidence.quotes) for (const chunkId of quote.chunkIds) for (const questionId of quote.questionIds) {
    if (!coverage.chunks.find(c => c.id === chunkId)!.questions.some(q => q.questionId === questionId && q.evidenceIds.includes(quote.id))) fail("quote_question");
  }
  if (expected.sources) for (const quote of evidence.quotes) {
    const source = expected.sources.find(s => s.id === quote.sourceId)!;
    for (const chunkId of quote.chunkIds) { const chunk = coverage.chunks.find(c => c.id === chunkId)!;
      const occurrence = locateChunkQuote(source.bytes.subarray(chunk.startByte, chunk.endByte).toString("utf8"), normalizeQuoteText(quote.quote), chunk.startLine);
      if (!occurrence) fail("quote_occurrence");
      if (occurrence!.locator !== quote.locator) fail("quote_locator");
    }
  }
  if (evidence.conflicts.some(c => !sourceManifest.some(s => s.id === c.sourceId) || c.questionIds.some(q => !questions.has(q)))) fail("conflict_binding");
  if (read(RESEARCH_FILES.evidenceText) !== renderResearchEvidence(evidence, plan) || byPath.get(RESEARCH_FILES.evidenceText)!.length > RESEARCH_COVERAGE_POLICY.packetBytes) fail("evidence_render");
  const synth = coverage.synthesis.questions;
  if (!unique(synth.map(q => q.questionId)) || canonical(synth.map(q => q.questionId).sort()) !== canonical([...questions].sort()) || synth.some(q => !unique(q.evidenceIds) || q.evidenceIds.some(e => !evidence.quotes.some(quote => quote.id === e && quote.questionIds.includes(q.questionId))) || (q.disposition !== "unresolved" && !q.evidenceIds.length))) fail("synthesis_coverage");
  if (!/^## Conflicting evidence\s*$/mu.test(read(RESEARCH_FILES.argument)) || !/^## Unanswered questions\s*$/mu.test(read(RESEARCH_FILES.argument))) fail("argument_sections");
  if (coverage.fallbacks.synthesis === "skeleton") {
    const skeleton = hostSkeletonSynthesis(plan, evidence);
    if (read(RESEARCH_FILES.argument) !== skeleton.argument || canonical(synth) !== canonical(skeleton.questions)) fail("fallback_skeleton");
  }
  if (coverage.synthesis.argumentSha256 !== digest(byPath.get(RESEARCH_FILES.argument)!) || !read(RESEARCH_FILES.argument).trim()) fail("argument");
  for (const citation of read(RESEARCH_FILES.argument).matchAll(/\bE[0-9]{1,4}\b/gu)) if (!evidenceIds.has(citation[0])) fail("citation");
  const index = parse(RESEARCH_FILES.index) as { sources?: { sourceId?: string; sourceSha256?: string }[] };
  if (!Array.isArray(index.sources) || canonical(index.sources.map(s => s.sourceId).sort()) !== canonical(sourceManifest.map(s => s.id).sort())) fail("index_inventory");
  if (index.sources!.some(entry => entry.sourceSha256 !== sourceManifest.find(s => s.id === entry.sourceId)?.sha256)) fail("index_source_hash");
  return { coverage, plan, evidence, summary, filesManifest: files.map(f => ({ path: f.path, sha256: digest(f.bytes) })).sort((a, b) => a.path.localeCompare(b.path)), sourceManifest };
}
