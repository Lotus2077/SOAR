/**
 * E0 synthesis fixture (lane S-pipe; the E0 card's Amendment 7). It replays the research pipeline's synthesis stage on ready packets the
 * r3 re-measurement left: the first attempt, then, when the stage would refuse it, the repair attempt with the context the stage gives it
 * (research-pipeline.ts, synthesisStage: the repair reason, attempt 2's length cap, and the coverage with its synthesis marked invalid). The
 * unit is a trial, and its outcome is what the owner would get: a model synthesis or the host skeleton. One invocation runs one cell of
 * synthesis caps and thinking, its trials alternating the manifest's packets.
 *
 * Every body is built by P10's builder (export-role-schemas.ts buildRoleRequest, the model layer's own requestBody) under the configured
 * request settings, salted with the packet's own run job, so the cell the adopted card sends is the stage's call byte for byte. Before any
 * request, every invocation (the dry run too) rebuilds the stage's two bodies per packet and checks them against the run's dispatch receipts
 * in result.json: bodyBytes, and packetSha256 over the configured endpoint. Replies are judged by the stage's own checks, copied below from
 * the synthesis stage's judge (research-pipeline.ts keeps them in a closure; a test pins the copy to the stage on the same replies), with
 * the stage's evidence-id tolerance called from the one function both share (research-coverage.ts, correctSynthesisEvidenceIds). POSTs
 * go directly to the owner's endpoint outside the broker (zero fee, no dispatch rows), streamed as the stage streams. Raw replies stay under
 * the ignored out directory (mode 0o600); summary.json, beside them, holds codes, hashes, counts, times and token usage, plus the model
 * alias and the packets' run directory names, written before the first request and after every call. The printed line names neither the
 * alias nor a run. The endpoint comes from loadConfig, and its address is never printed or written.
 *
 *   pnpm fixture:synthesis -- --batch <r3 batch directory> --brief <stage brief> --cell <cell> [--manifest <json>] [--out <dir>] [--dry-run]
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig, loadEnvironmentFiles } from "../src/main/config";
import { assembleSseChatCompletion } from "../src/main/private-agent/broker";
import { canonical, digest, exactText, sha256Schema } from "../src/main/private-agent/contracts";
import { COORDINATOR_PROFILES } from "../src/main/private-agent/profiles";
import { researchSynthesisLengthCap } from "../src/main/private-agent/research-admission";
import { RESEARCH_FILES, RESEARCH_PRESENTATION_POLICY, RESEARCH_TOLERANCE_POLICY } from "../src/main/private-agent/research-contract";
import { ResearchCoverageSchema, ResearchEvidenceSchema, ResearchSynthesisSchema, correctSynthesisEvidenceIds, renderResearchEvidence, synthesisCorrectionCounts, type ResearchEvidence,
  type ResearchSynthesisCorrections } from "../src/main/private-agent/research-coverage";
import { assertRunDirectoryIgnored } from "../src/main/private-agent/research-diagnostics";
import { parseJsonReply } from "../src/main/private-agent/research-index";
import { RESEARCH_ROLE_SCHEMAS, normalizeResearchHeadings, researchProtocolSha256, type ResearchDiagnosticReason } from "../src/main/private-agent/research-pipeline";
import { ResearchPlanSchema, type ResearchPlan } from "../src/main/private-agent/research-plan";
import { researchPresentationBytes } from "../src/main/private-agent/research-presentation";
import { servingCardRequestSettings, type ServingCardRequestSettings } from "../src/main/private-agent/serving-card";
import { readChatReply } from "./chat-reply";
import { buildRoleRequest, requestSettingsOf, type RequestSettings } from "./export-role-schemas";
import { numericUsage } from "./extractor-fixture";

export const SYNTHESIS_CELLS = ["synthesis-8192", "synthesis-16384", "synthesis-8192-repair-thinking-off", "synthesis-16384-structured"] as const;
export type SynthesisCell = (typeof SYNTHESIS_CELLS)[number];
/** One attempt's cap and thinking, and `structuredOutput` when the attempt sends the synthesis role's strict response_format. */
export interface SynthesisCall { maxOutputTokens: number; thinking: "model" | "disabled"; structuredOutput?: "strict" }
/**
 * Each cell's two attempts. `synthesis-8192` is the synthesis row of the card adopted on 2026-11-17, so it is the stage's own pair.
 * `synthesis-16384-structured` is the E0 card's Amendment 8, item 4: `synthesis-16384` as a revised card whose synthesis flag has
 * `thinkingOn` true sends it, with the strict format on both attempts (thinking is on in both). It runs only if the re-probe's card
 * writes that flag.
 */
export const CELL_CALLS: Readonly<Record<SynthesisCell, readonly [SynthesisCall, SynthesisCall]>> = Object.freeze({
  "synthesis-8192": [{ maxOutputTokens: 8192, thinking: "model" }, { maxOutputTokens: 8192, thinking: "model" }],
  "synthesis-16384": [{ maxOutputTokens: 16384, thinking: "model" }, { maxOutputTokens: 16384, thinking: "model" }],
  "synthesis-8192-repair-thinking-off": [{ maxOutputTokens: 8192, thinking: "model" }, { maxOutputTokens: 8192, thinking: "disabled" }],
  "synthesis-16384-structured": [{ maxOutputTokens: 16384, thinking: "model", structuredOutput: "strict" }, { maxOutputTokens: 16384, thinking: "model", structuredOutput: "strict" }],
});
export const STAGE_CELL: SynthesisCell = "synthesis-8192";
/** The reason the synthesis stage sends with its second attempt (research-pipeline.ts, synthesisStage). */
export const SYNTHESIS_REPAIR_REASON = "previous_synthesis_incomplete_or_invalid; return complete concise structure with both sections";
/** The dispatch purpose of a stage synthesis call (research-pipeline.ts PURPOSES.synthesis), which the run's receipts carry. */
export const SYNTHESIS_PURPOSE = "research synthesis";
export const SYNTHESIS_CALL_CLASSES = ["accepted", "invalid", "truncated", "request_rejected", "malformed_reply", "transport_failed"] as const;
export type SynthesisCallClass = (typeof SYNTHESIS_CALL_CLASSES)[number];
export const SYNTHESIS_OUTCOMES = ["model_synthesis", "skeleton", "no_outcome"] as const;
export type SynthesisOutcome = (typeof SYNTHESIS_OUTCOMES)[number];
export const DEFAULT_MANIFEST = "docs/experiments/e0-synthesis-fixture-v1.json";
/**
 * The judge a run's replies were judged under, written in its summary and its printed line: the research tolerance policy's version. Since
 * version 2 the judge drops an evidence id a question lists that is not citable or not tagged for that question instead of refusing the
 * reply (research-coverage.ts, correctSynthesisEvidenceIds). A summary without the field was judged under version 1, which refused it.
 */
export const SYNTHESIS_JUDGE = `research_tolerance_v${RESEARCH_TOLERANCE_POLICY.version}`;
/** Where a run directory keeps each file the fixture reads: the ready packet under the candidate, and the run's receipts. */
export const RUN_FILES = Object.freeze({ coverage: join("candidate", RESEARCH_FILES.coverage), evidence: join("candidate", RESEARCH_FILES.evidence),
  plan: join("candidate", RESEARCH_FILES.plan), result: "result.json" });
export type RunFile = keyof typeof RUN_FILES;

const receipt = z.object({ bodyBytes: z.number().int().positive(), packetSha256: sha256Schema }).strict();
export const SynthesisFixtureManifestSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().min(1), status: z.literal("pinned"), note: z.string().optional(), task: z.string().min(1),
  exposure: z.enum(["exposed", "fresh"]), briefSha256: sha256Schema,
  packets: z.array(z.object({ run: z.string().regex(/^run-[0-9]{1,2}$/u), jobIdSha256: sha256Schema, coverageSha256: sha256Schema, evidenceSha256: sha256Schema,
    planSha256: sha256Schema, stage: z.tuple([receipt, receipt]) }).strict()).min(1).max(4),
  cells: z.array(z.enum(SYNTHESIS_CELLS)).min(1), trialsPerPacket: z.number().int().min(1).max(20),
}).strict();
export type SynthesisFixtureManifest = z.infer<typeof SynthesisFixtureManifestSchema>;

export interface SynthesisFixtureInputs { manifest: unknown; brief: Buffer; read: (run: string, file: RunFile) => Buffer }
export interface SynthesisPacket {
  run: string; jobId: string; brief: string;
  /** The packet files as parsed JSON, unchanged, so canonical() gives back what the stage serialised. */
  coverage: Record<string, unknown>; evidence: ResearchEvidence; plan: ResearchPlan; planRaw: unknown; evidenceRaw: unknown;
  units: unknown; questions: ReadonlySet<string>; packetIds: ReadonlySet<string>; evidenceText: Buffer; planBytes: Buffer;
  stage: readonly [{ bodyBytes: number; packetSha256: string }, { bodyBytes: number; packetSha256: string }];
}
export interface VerifiedSynthesisFixture { manifest: SynthesisFixtureManifest; manifestSha256: string; brief: string; packets: SynthesisPacket[] }

const fail = (code: string): never => { throw new Error(`synthesis_fixture_${code}`); };
const json = (bytes: Buffer, code: string): unknown => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail(code); } };

/** Every refusal here happens before any request is built or sent, and none prints a path or a value. */
export function verifySynthesisInputs(inputs: SynthesisFixtureInputs): VerifiedSynthesisFixture {
  const parsed = SynthesisFixtureManifestSchema.safeParse(inputs.manifest);
  if (!parsed.success) fail("manifest_invalid");
  const manifest = parsed.data!;
  if (new Set(manifest.packets.map(p => p.run)).size !== manifest.packets.length || new Set(manifest.cells).size !== manifest.cells.length) fail("manifest_invalid");
  if (digest(inputs.brief) !== manifest.briefSha256) fail("brief_mismatch");
  let brief = "";
  try { brief = new TextDecoder("utf-8", { fatal: true }).decode(inputs.brief); } catch { fail("brief_mismatch"); }
  const packets = manifest.packets.map((pinned): SynthesisPacket => {
    const bytes = (file: RunFile, sha256: string) => { const value = inputs.read(pinned.run, file); if (digest(value) !== sha256) fail(`${file}_mismatch`); return value; };
    const coverage = json(bytes("coverage", pinned.coverageSha256), "coverage_invalid") as Record<string, unknown>;
    const evidenceRaw = json(bytes("evidence", pinned.evidenceSha256), "evidence_invalid"), planBytes = bytes("plan", pinned.planSha256), planRaw = json(planBytes, "plan_invalid");
    const coverageParsed = ResearchCoverageSchema.safeParse(coverage), evidence = ResearchEvidenceSchema.safeParse(evidenceRaw), plan = ResearchPlanSchema.safeParse(planRaw);
    if (!coverageParsed.success) fail("coverage_invalid");
    if (!evidence.success) fail("evidence_invalid");
    if (!plan.success) fail("plan_invalid");
    // The stage's synthesis runs only on a packet that passed extraction; a packet of another brief, or one that never reached synthesis, is not one to replay.
    if (coverageParsed.data!.briefSha256 !== manifest.briefSha256) fail("brief_mismatch");
    if (coverageParsed.data!.status !== "ready" || coverageParsed.data!.synthesis.status === "pending") fail("packet_not_ready");
    // The stage serialises plan.json as canonical(plan) and a newline: the plan it sent is the file's.
    if (`${canonical(planRaw)}\n` !== planBytes.toString("utf8")) fail("plan_invalid");
    const result = json(inputs.read(pinned.run, "result"), "result_invalid") as { dispatches?: unknown };
    const dispatches = z.array(z.object({ jobId: z.string().min(1), purpose: z.string(), committedAt: z.number(), bodyBytes: z.number().int().nonnegative(), packetSha256: sha256Schema }).loose())
      .safeParse(result.dispatches);
    if (!dispatches.success) fail("result_invalid");
    const jobIds = new Set(dispatches.data!.map(d => d.jobId));
    if (jobIds.size !== 1 || digest([...jobIds][0]!) !== pinned.jobIdSha256) fail("job_mismatch");
    const rows = dispatches.data!.filter(d => d.purpose === SYNTHESIS_PURPOSE).sort((a, b) => a.committedAt - b.committedAt);
    if (rows.length !== 2 || rows.some((row, i) => row.bodyBytes !== pinned.stage[i]!.bodyBytes || row.packetSha256 !== pinned.stage[i]!.packetSha256)) fail("receipt_mismatch");
    return { run: pinned.run, jobId: [...jobIds][0]!, brief, coverage, evidence: evidence.data!, evidenceRaw, plan: plan.data!, planRaw, units: coverage.units,
      questions: new Set(plan.data!.questions.map(q => q.id)), packetIds: new Set(evidence.data!.quotes.map(q => q.id)),
      evidenceText: Buffer.from(renderResearchEvidence(evidence.data!, plan.data!)), planBytes, stage: pinned.stage };
  });
  return { manifest, manifestSha256: digest(canonical(inputs.manifest)), brief, packets };
}

/** The coverage as the stage holds it when it sends an attempt: not yet ready, no synthesis fallback, and after a refused first attempt its synthesis invalid. */
export function attemptCoverage(coverage: Record<string, unknown>, attempt: 0 | 1): Record<string, unknown> {
  return { ...coverage, status: "incomplete", synthesis: { status: attempt === 0 ? "pending" : "invalid", questions: [] },
    fallbacks: { ...(coverage.fallbacks as Record<string, unknown>), synthesis: "none" } };
}
/** The synthesis stage's word cap for this attempt's cap and thinking (research-admission.ts), as the stage computes it from the brief. */
export function attemptLengthCapWords(brief: string, call: SynthesisCall): number { return researchSynthesisLengthCap(brief, call).words; }
/** The stage's user message for one attempt (research-pipeline.ts, synthesisStage). */
export function synthesisUserContent(packet: SynthesisPacket, attempt: 0 | 1, lengthCapWords: number): string {
  return canonical({ brief: packet.brief, units: packet.units, plan: packet.planRaw, evidence: packet.evidenceRaw, coverage: attemptCoverage(packet.coverage, attempt),
    lengthCap: { words: lengthCapWords }, repairReason: attempt ? SYNTHESIS_REPAIR_REASON : null });
}
export interface SynthesisRequest { packet: string; attempt: 1 | 2; body: string; requestSha256: string; requestBytes: number; maxTokens: number; thinking: "model" | "disabled";
  lengthCapWords: number; streamed: boolean; structuredOutput: "strict" | null }
/** One attempt's body as the model layer builds it, under `settings`, salted for `jobId`. */
export function buildSynthesisRequest(settings: RequestSettings, packet: SynthesisPacket, attempt: 0 | 1, call: SynthesisCall, jobId = packet.jobId): SynthesisRequest {
  const lengthCapWords = attemptLengthCapWords(packet.brief, call);
  const built = buildRoleRequest(settings, jobId, "synthesis", synthesisUserContent(packet, attempt, lengthCapWords),
    { maxOutputTokens: call.maxOutputTokens, ...(call.thinking === "disabled" ? { thinking: "disabled" as const } : {}),
      // The stage's own format for a flagged synthesis attempt (research-pipeline.ts, responseFormatFor): the role's schema, strict.
      ...(call.structuredOutput ? { responseFormat: { ...RESEARCH_ROLE_SCHEMAS.synthesis, strict: true } } : {}) });
  // canonical() is requestBody's own serialisation, so re-encoding the parsed body gives back its bytes; refuse anything else.
  const body = canonical(built.body);
  if (digest(body) !== built.bodySha256) fail("body_mismatch");
  return { packet: packet.run, attempt: attempt === 0 ? 1 : 2, body, requestSha256: built.bodySha256, requestBytes: Buffer.byteLength(body), maxTokens: call.maxOutputTokens,
    thinking: call.thinking, lengthCapWords, streamed: built.body.stream === true, structuredOutput: call.structuredOutput ?? null };
}
/** The broker's packet digest (broker.ts: method, URL, headers and body) for a POST to the owned endpoint. */
export function synthesisPacketSha256(baseUrl: string, body: string): string {
  return digest(canonical({ method: "POST", url: new URL(`${baseUrl}/chat/completions`).href, headers: { "content-type": "application/json" }, body }));
}
export interface StageCheck { run: string; bodyBytes: [boolean, boolean]; packetSha256: [boolean, boolean] }
/** The stage's own two bodies per packet, rebuilt and compared with the run's receipts: the fixture's builder is the stage's, or nothing runs. */
export function checkStageReceipts(fixture: VerifiedSynthesisFixture, settings: RequestSettings, baseUrl: string): StageCheck[] {
  return fixture.packets.map(packet => {
    const bodies = ([0, 1] as const).map(attempt => buildSynthesisRequest(settings, packet, attempt, CELL_CALLS[STAGE_CELL][attempt]));
    return { run: packet.run, bodyBytes: [bodies[0]!.requestBytes === packet.stage[0].bodyBytes, bodies[1]!.requestBytes === packet.stage[1].bodyBytes],
      packetSha256: [synthesisPacketSha256(baseUrl, bodies[0]!.body) === packet.stage[0].packetSha256, synthesisPacketSha256(baseUrl, bodies[1]!.body) === packet.stage[1].packetSha256] };
  });
}
export const stageCheckPassed = (checks: readonly StageCheck[]) => checks.every(check => [...check.bodyBytes, ...check.packetSha256].every(Boolean));
/** Amendment 7's void rule: a cell with any trial that settled no reply is void, and is run again once in a new out directory. */
export const synthesisCellVoid = (summary: Pick<SynthesisFixtureSummary, "outcomes">) => summary.outcomes.no_outcome > 0;

// The synthesis stage's judge (research-pipeline.ts, runResearchPipeline's `judge`), copied: its helpers are not exported, and the fixture
// adds no export to the pipeline. tests/unit/synthesis-fixture.test.ts runs the stage on the same replies and compares every verdict.
const SYNTHESIS_KEYS: ReadonlySet<string> = new Set(["version", "argument", "questions", "questionId", "disposition", "evidenceIds"]);
function schemaReasons(issues: readonly z.core.$ZodIssue[], known: ReadonlySet<string>): ResearchDiagnosticReason[] {
  return issues.map(issue => ({ code: `schema_${issue.code}`, path: issue.path.map(part => typeof part === "number" ? part : typeof part === "string" && known.has(part) ? part : "?") }));
}
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const encodable = (text: string): boolean => { try { exactText(text); return true; } catch { return false; } };
type SynthesisQuestions = z.infer<typeof ResearchSynthesisSchema>["questions"];
/** A model synthesis's coverage section as the stage writes it: its questions and, when the evidence-id tolerance dropped any id, its corrections. */
const synthesisSection = (text: string, questions: SynthesisQuestions, corrections?: ResearchSynthesisCorrections) =>
  ({ status: "complete", argumentSha256: digest(Buffer.from(text)), questions, ...(corrections ? { corrections } : {}) });
/** The writer's presentation bytes with this argument and this synthesis section: the coverage as the stage's finish() would write it. */
function presentationWith(packet: SynthesisPacket, attempt: 0 | 1, text: string, section: ReturnType<typeof synthesisSection>): number {
  return researchPresentationBytes([{ path: RESEARCH_FILES.argument, bytes: Buffer.from(text) }, { path: RESEARCH_FILES.evidenceText, bytes: packet.evidenceText },
    { path: RESEARCH_FILES.plan, bytes: packet.planBytes }, { path: RESEARCH_FILES.coverage,
      bytes: Buffer.from(`${canonical({ ...attemptCoverage(packet.coverage, attempt), status: "ready", synthesis: section })}\n`) }]);
}
/** The stage's verdict; an accepted reply also carries the questions the stage keeps, corrected by the evidence-id tolerance, and its corrections. */
export interface SynthesisVerdict { accepted: boolean; reasons: ResearchDiagnosticReason[]; questions?: SynthesisQuestions; corrections?: ResearchSynthesisCorrections }
/** One settled synthesis reply, judged exactly as the stage judges its own: every reason, by code and position only. */
export function judgeSynthesisReply(reply: { content: string; truncated: boolean }, packet: SynthesisPacket, attempt: 0 | 1): SynthesisVerdict {
  const reasons: ResearchDiagnosticReason[] = reply.truncated ? [{ code: "truncated", path: [] }] : [];
  const decoded = reply.truncated ? undefined : parseJsonReply(reply.content), parsed = decoded === undefined ? undefined : ResearchSynthesisSchema.safeParse(decoded);
  if (!reply.truncated && parsed === undefined) reasons.push({ code: "invalid_json", path: [] });
  else if (parsed && !parsed.success) reasons.push(...schemaReasons(parsed.error.issues, SYNTHESIS_KEYS));
  else if (parsed?.success) {
    const value = parsed.data, text = normalizeResearchHeadings(value.argument).text;
    const unknownCitations = [...text.matchAll(/\bE[0-9]{1,4}\b/gu)].filter(m => !packet.packetIds.has(m[0])).length;
    if (!unique(value.questions.map(q => q.questionId)) || canonical(value.questions.map(q => q.questionId).sort()) !== canonical([...packet.questions].sort())) reasons.push({ code: "question_set_mismatch", path: ["questions"] });
    for (const [i, q] of value.questions.entries()) {
      if (!unique(q.evidenceIds)) reasons.push({ code: "duplicate_evidence_id", path: ["questions", i, "evidenceIds"] });
      if (q.disposition !== "unresolved" && !q.evidenceIds.length) reasons.push({ code: "disposition_without_evidence", path: ["questions", i, "evidenceIds"] });
    }
    // The stage's evidence-id tolerance, by the same function (research-coverage.ts): an offending id is dropped, never a refusal.
    const corrected = correctSynthesisEvidenceIds(value.questions, packet.packetIds, packet.evidence.quotes);
    if (unknownCitations) reasons.push({ code: "unknown_citation", path: ["argument"], count: unknownCitations });
    if (!/^## Conflicting evidence\s*$/mu.test(text)) reasons.push({ code: "conflicting_evidence_heading_missing", path: ["argument"] });
    if (!/^## Unanswered questions\s*$/mu.test(text)) reasons.push({ code: "unanswered_questions_heading_missing", path: ["argument"] });
    if (!encodable(text)) reasons.push({ code: "argument_unencodable", path: ["argument"] });
    const accepted = `${text.trim()}\n`;
    const section = synthesisSection(accepted, corrected.questions, corrected.corrections);
    if (!reasons.length && presentationWith(packet, attempt, accepted, section) > RESEARCH_PRESENTATION_POLICY.maxBytes) reasons.push({ code: "presentation_too_large", path: ["argument"], maximum: RESEARCH_PRESENTATION_POLICY.maxBytes });
    if (!reasons.length) return { accepted: true, reasons, questions: section.questions, ...(section.corrections ? { corrections: section.corrections } : {}) };
  }
  return { accepted: false, reasons };
}

export interface SynthesisCallRecord {
  condition: SynthesisCell; trial: number; packet: string; attempt: 1 | 2; requestSha256: string; requestBytes: number; status: number | null; elapsedMs: number;
  replyFile: string | null; bodySha256: string | null; bodyBytes: number; classification: SynthesisCallClass; finishReason?: string | null; contentBytes?: number;
  usage?: unknown; codes?: string[]; transportError?: string; streamError?: string;
  /**
   * On an accepted reply the evidence-id tolerance corrected: the ids it dropped, by kind, and the questions it left unresolved, as the
   * synthesise row counts them; and `allUnresolvedByDrops` when the drops left every question unresolved, which the E0 card's addendum
   * to Amendment 7 counts as no model synthesis.
   */
  evidenceIdsDroppedNotCitable?: number; evidenceIdsDroppedNotTagged?: number; questionsDowngraded?: number; allUnresolvedByDrops?: true;
}
/** The accepted calls' corrections, summed: those with any drop, the ids dropped by kind, the questions downgraded, and the replies the drops left all unresolved. */
export interface SynthesisCorrectionTotals { acceptedWithDrops: number; evidenceIdsDroppedNotCitable: number; evidenceIdsDroppedNotTagged: number; questionsDowngraded: number;
  allUnresolvedByDrops: number }
export interface SynthesisTrialRecord { trial: number; packet: string; outcome: SynthesisOutcome; acceptedAttempt: 1 | 2 | null; calls: number }
export interface SynthesisFixtureSummary {
  version: 1; kind: "synthesis"; startedUtc: string; finishedUtc?: string; model: string; dryRun: boolean; judge: string; protocolSha256: string; requestSettings: ServingCardRequestSettings;
  conditions: [SynthesisCell]; repeats: number; attempts: readonly [SynthesisCall, SynthesisCall]; order: "trial_alternating_packets";
  manifest: { sha256: string; name: string; task: string; exposure: string; briefSha256: string; trialsPerPacket: number; packetCount: number;
    packets: { run: string; coverageSha256: string; evidenceSha256: string; planSha256: string }[] };
  stageCheck: StageCheck[];
  requests: Record<string, { requestSetSha256: string; requests: number; packets: Record<string, Omit<SynthesisRequest, "body" | "packet">[]> }>;
  trials: SynthesisTrialRecord[]; calls: SynthesisCallRecord[]; counts: Record<string, Partial<Record<SynthesisCallClass, number>>>;
  outcomes: Record<SynthesisOutcome, number>; byPacket: Record<string, Record<SynthesisOutcome, number>>; codes: { "1": Record<string, number>; "2": Record<string, number> };
  corrections: SynthesisCorrectionTotals;
}
export interface SynthesisEndpoint { baseUrl: string; apiKey?: string; timeoutMs?: number }
export interface SynthesisRunOptions { endpoint: SynthesisEndpoint; settings: RequestSettings; inputs: SynthesisFixtureInputs; cell: SynthesisCell; out: string; dryRun?: boolean }

function writePrivate(path: string, data: Buffer | string): void {
  const handle = openSync(path, "w", 0o600);
  try { writeSync(handle, typeof data === "string" ? Buffer.from(data) : data); } finally { closeSync(handle); }
}
/** Written beside, then renamed over, so an interrupted run leaves the last whole summary. */
function writeSummary(out: string, summary: SynthesisFixtureSummary): void {
  writePrivate(join(out, "summary.json.tmp"), `${JSON.stringify(summary, null, 1)}\n`);
  renameSync(join(out, "summary.json.tmp"), join(out, "summary.json"));
}
const zeroOutcomes = (): Record<SynthesisOutcome, number> => ({ model_synthesis: 0, skeleton: 0, no_outcome: 0 });
function tally(summary: SynthesisFixtureSummary): void {
  const counts: Partial<Record<SynthesisCallClass, number>> = {}, codes: SynthesisFixtureSummary["codes"] = { 1: {}, 2: {} };
  for (const call of summary.calls) {
    counts[call.classification] = (counts[call.classification] ?? 0) + 1;
    for (const code of call.codes ?? []) codes[call.attempt][code] = (codes[call.attempt][code] ?? 0) + 1;
  }
  summary.counts = { [summary.conditions[0]]: counts }; summary.codes = codes;
  const corrected = summary.calls.filter(call => call.questionsDowngraded !== undefined), sum = (key: "evidenceIdsDroppedNotCitable" | "evidenceIdsDroppedNotTagged" | "questionsDowngraded") =>
    corrected.reduce((n, call) => n + (call[key] ?? 0), 0);
  summary.corrections = { acceptedWithDrops: corrected.length, evidenceIdsDroppedNotCitable: sum("evidenceIdsDroppedNotCitable"), evidenceIdsDroppedNotTagged: sum("evidenceIdsDroppedNotTagged"),
    questionsDowngraded: sum("questionsDowngraded"), allUnresolvedByDrops: corrected.filter(call => call.allUnresolvedByDrops).length };
  summary.outcomes = zeroOutcomes(); summary.byPacket = Object.fromEntries(summary.manifest.packets.map(p => [p.run, zeroOutcomes()]));
  for (const trial of summary.trials) { summary.outcomes[trial.outcome]++; summary.byPacket[trial.packet]![trial.outcome]++; }
}

export async function runSynthesisFixture(options: SynthesisRunOptions): Promise<SynthesisFixtureSummary> {
  const fixture = verifySynthesisInputs(options.inputs), { manifest } = fixture, cell = options.cell, calls = CELL_CALLS[cell];
  if (!manifest.cells.includes(cell)) fail("cell_not_registered");
  if (!options.dryRun && existsSync(options.out)) fail("out_exists");
  const stageCheck = checkStageReceipts(fixture, options.settings, options.endpoint.baseUrl);
  const requests = new Map(fixture.packets.map(packet => [packet.run, ([0, 1] as const).map(attempt => buildSynthesisRequest(options.settings, packet, attempt, calls[attempt])) as [SynthesisRequest, SynthesisRequest]]));
  const all = [...requests.values()].flat();
  const summary: SynthesisFixtureSummary = { version: 1, kind: "synthesis", startedUtc: new Date().toISOString(), model: options.settings.vllm.model, dryRun: options.dryRun === true, judge: SYNTHESIS_JUDGE,
    protocolSha256: researchProtocolSha256(), requestSettings: servingCardRequestSettings(options.settings, true), conditions: [cell],
    repeats: manifest.trialsPerPacket * fixture.packets.length, attempts: calls, order: "trial_alternating_packets",
    manifest: { sha256: fixture.manifestSha256, name: manifest.name, task: manifest.task, exposure: manifest.exposure, briefSha256: manifest.briefSha256,
      trialsPerPacket: manifest.trialsPerPacket, packetCount: fixture.packets.length,
      packets: manifest.packets.map(p => ({ run: p.run, coverageSha256: p.coverageSha256, evidenceSha256: p.evidenceSha256, planSha256: p.planSha256 })) },
    stageCheck, requests: { [cell]: { requestSetSha256: digest(canonical(all.map(r => r.requestSha256))), requests: all.length,
      packets: Object.fromEntries([...requests].map(([run, pair]) => [run, pair.map(({ body: _b, packet: _p, ...kept }) => kept)])) } },
    trials: [], calls: [], counts: {}, outcomes: zeroOutcomes(), byPacket: {}, codes: { 1: {}, 2: {} },
    corrections: { acceptedWithDrops: 0, evidenceIdsDroppedNotCitable: 0, evidenceIdsDroppedNotTagged: 0, questionsDowngraded: 0, allUnresolvedByDrops: 0 } };
  tally(summary);
  if (options.dryRun) return summary;
  if (!stageCheckPassed(stageCheck)) fail("stage_mismatch");
  const replies = join(options.out, "replies");
  mkdirSync(replies, { recursive: true, mode: 0o700 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.endpoint.apiKey ? { authorization: `Bearer ${options.endpoint.apiKey}` } : {}) };
  const timeoutMs = options.endpoint.timeoutMs ?? COORDINATOR_PROFILES.heavy.requestTimeoutMs;
  // Written before the first request, so no reply file ever exists without a summary beside it.
  writeSummary(options.out, summary);
  const send = async (trial: number, packet: SynthesisPacket, request: SynthesisRequest, attempt: 0 | 1): Promise<SynthesisCallRecord> => {
    const started = performance.now();
    const record: SynthesisCallRecord = { condition: cell, trial, packet: packet.run, attempt: request.attempt, requestSha256: request.requestSha256, requestBytes: request.requestBytes,
      status: null, elapsedMs: 0, replyFile: null, bodySha256: null, bodyBytes: 0, classification: "transport_failed" };
    try {
      const response = await fetch(`${options.endpoint.baseUrl}/chat/completions`, { method: "POST", headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      const bytes = Buffer.from(await response.arrayBuffer());
      record.elapsedMs = Math.round(performance.now() - started); record.status = response.status;
      record.replyFile = `t${String(trial).padStart(2, "0")}-${packet.run}-a${request.attempt}.${request.streamed ? "sse" : "json"}`;
      record.bodySha256 = digest(bytes); record.bodyBytes = bytes.length;
      writePrivate(join(replies, record.replyFile), bytes);
      if (response.status !== 200) record.classification = "request_rejected";
      else {
        let body: Uint8Array | undefined;
        try { body = request.streamed ? assembleSseChatCompletion(bytes.toString("utf8")) : bytes; } catch (error) {
          if (error instanceof Error && /^[a-z_]+$/u.test(error.message)) record.streamError = error.message;
        }
        // The reply as the model layer reads it (scripts/chat-reply.ts); a reply it would reject is malformed, and a missing content is empty text.
        const reply = body === undefined ? undefined : readChatReply(body);
        if (reply === undefined) record.classification = "malformed_reply";
        else {
          const finish = reply.finishReason, truncated = finish === "length";
          record.finishReason = typeof finish === "string" ? (/^[a-z_]{1,32}$/u.test(finish) ? finish : "other") : null;
          record.contentBytes = Buffer.byteLength(reply.content); record.usage = numericUsage(reply.usage) ?? null;
          const verdict = judgeSynthesisReply({ content: reply.content, truncated }, packet, attempt);
          record.codes = [...new Set(verdict.reasons.map(reason => reason.code))].sort();
          record.classification = verdict.accepted ? "accepted" : truncated ? "truncated" : "invalid";
          if (verdict.corrections) {
            Object.assign(record, synthesisCorrectionCounts(verdict.corrections));
            if (verdict.corrections.downgraded.length && verdict.questions!.every(q => q.disposition === "unresolved")) record.allUnresolvedByDrops = true;
          }
        }
      }
    } catch (error) {
      // Only the error's class name: a transport error's message and cause can carry the address.
      record.elapsedMs = Math.round(performance.now() - started); record.transportError = error instanceof Error ? error.name : "unknown";
    }
    summary.calls.push(record); tally(summary); writeSummary(options.out, summary);
    return record;
  };
  for (let trial = 1; trial <= summary.repeats; trial++) {
    const packet = fixture.packets[(trial - 1) % fixture.packets.length]!, pair = requests.get(packet.run)!;
    let outcome: SynthesisOutcome = "no_outcome", acceptedAttempt: 1 | 2 | null = null, sent = 0;
    for (const attempt of [0, 1] as const) {
      const record = await send(trial, packet, pair[attempt], attempt); sent++;
      if (record.classification === "accepted") { outcome = "model_synthesis"; acceptedAttempt = record.attempt; break; }
      // A call that settled no reply ends the trial: the stage itself would have ended on a denied call.
      if (record.classification !== "invalid" && record.classification !== "truncated") { outcome = "no_outcome"; break; }
      if (attempt === 1) outcome = "skeleton";
    }
    summary.trials.push({ trial, packet: packet.run, outcome, acceptedAttempt, calls: sent }); tally(summary); writeSummary(options.out, summary);
  }
  summary.finishedUtc = new Date().toISOString(); writeSummary(options.out, summary);
  return summary;
}

const USAGE = "usage: pnpm fixture:synthesis -- --batch <r3 batch directory> --brief <stage brief> --cell <cell> [--manifest <json>] [--out <dir>] [--dry-run]\n";
export interface SynthesisArguments { batch: string; brief: string; cell: SynthesisCell; manifest?: string; out?: string; dryRun: boolean }
/** The command line's arguments, strictly: an unknown or repeated flag, a flag without its value, or an unknown cell is refused before anything runs. */
export function parseSynthesisArguments(argv: readonly string[]): SynthesisArguments | undefined {
  const values: Record<string, string> = {}, seen = new Set<string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (seen.has(flag)) return undefined;
    seen.add(flag);
    if (flag === "--dry-run") { dryRun = true; continue; }
    if (!["--batch", "--brief", "--cell", "--manifest", "--out"].includes(flag)) return undefined;
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) return undefined;
    values[flag.slice(2)] = value;
  }
  if (!values.batch || !values.brief || !(SYNTHESIS_CELLS as readonly string[]).includes(values.cell ?? "")) return undefined;
  return { batch: values.batch, brief: values.brief, cell: values.cell as SynthesisCell, ...(values.manifest ? { manifest: values.manifest } : {}), ...(values.out ? { out: values.out } : {}), dryRun };
}

async function main(): Promise<number> {
  const args = parseSynthesisArguments(process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--")));
  if (!args) { process.stderr.write(USAGE); return 2; }
  const environment = loadEnvironmentFiles({});
  if (!environment.SOAR_VLLM_BASE_URL) { process.stderr.write("SOAR_VLLM_BASE_URL is not set (environment or .env.local).\n"); return 2; }
  // loadConfig applies the app's endpoint policy; any refusal message that could carry an address is replaced by a fixed code.
  let config: ReturnType<typeof loadConfig>;
  try { config = loadConfig(); } catch (error) {
    const message = error instanceof Error && !error.message.includes("://") && !error.message.includes("\n") ? error.message : "synthesis_fixture_config_invalid";
    process.stderr.write(`${message}\n`); return 2;
  }
  const out = args.out ?? join(".soar", "experiments", `e0-synthesis-fixture-${args.cell}-${new Date().toISOString().replace(/[:.]/gu, "")}`);
  if (!args.dryRun) {
    try { assertRunDirectoryIgnored(out); } catch { process.stderr.write("synthesis_fixture_out_not_ignored\n"); return 2; }
  }
  const summary = await runSynthesisFixture({ endpoint: { baseUrl: config.vllm.baseUrl, apiKey: config.vllm.apiKey, timeoutMs: COORDINATOR_PROFILES.heavy.requestTimeoutMs },
    settings: requestSettingsOf(config), cell: args.cell, out, dryRun: args.dryRun,
    inputs: { manifest: JSON.parse(readFileSync(args.manifest ?? DEFAULT_MANIFEST, "utf8")), brief: readFileSync(args.brief),
      read: (run, file) => readFileSync(join(args.batch, run, RUN_FILES[file])) } });
  // No model alias and no run name: packets are listed in the manifest's order.
  const cellRequests = summary.requests[args.cell]!;
  process.stdout.write(`${JSON.stringify({ dryRun: summary.dryRun, judge: summary.judge, cell: args.cell, attempts: summary.attempts, trials: summary.repeats, packetCount: summary.manifest.packetCount,
    stageCheckPassed: stageCheckPassed(summary.stageCheck), stageCheck: summary.stageCheck.map(({ run: _run, ...check }) => check),
    requests: { requestSetSha256: cellRequests.requestSetSha256, requests: cellRequests.requests, packets: Object.values(cellRequests.packets) },
    void: synthesisCellVoid(summary), outcomes: summary.outcomes, byPacket: Object.values(summary.byPacket), counts: summary.counts, codes: summary.codes, corrections: summary.corrections,
    retained: summary.dryRun ? null : `${basename(out)}/replies` })}\n`);
  return stageCheckPassed(summary.stageCheck) ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : "synthesis_fixture_failed"}\n`); process.exitCode = 2; });
}
