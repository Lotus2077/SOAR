import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { PrivateCheckpointStore } from "../../src/main/private-agent/checkpoints";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel } from "../../src/main/private-agent/model";
import { RESEARCH_FILES, RESEARCH_PIPELINE_BUDGET, RESEARCH_PIPELINE_VERSION, researchProtocolSha256, runResearchPipeline } from "../../src/main/private-agent/research-pipeline";
import { createResearchInput, createResearchProducer, validateResearchProducer, type ResearchProducer } from "../../src/main/private-agent/research-producer";
import { loadResearchSeed, researchTransferPresent, researchTransferSnapshot, seededPipelineFreeze } from "../../src/main/private-agent/research-seed";
import { RESEARCH_TRANSFER_CHECK_ID, researchTransferPhase, sessionFileManifest, sessionPhaseIdentity, type SessionFile, type SessionPhase } from "../../src/main/private-agent/session";
import { PrivateAgentStore } from "../../src/main/private-agent/store";
import { PLAN_ASSIST_PURPOSE, SYNTHESIS_ASSIST_PURPOSE } from "../../src/main/private-agent/dispatch-purposes";
import { RESEARCH_V4_TEST_BRIEF, researchV4Reply, researchV4Sources } from "../helpers/research-v4-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const h = (n: string) => n.repeat(64), task = { jobSha256: h("1"), briefSha256: h("2") }, jobId = "job-a", contextId = "reader";
const researchInput = () => createResearchInput(RESEARCH_V4_TEST_BRIEF, researchV4Sources());
const pipeline = () => ({ name: "research", version: RESEARCH_PIPELINE_VERSION, protocolSha256: researchProtocolSha256(), budget: { ...RESEARCH_PIPELINE_BUDGET }, planner: "local", writer: "local" });
let produced: SessionFile[], receipts: Record<string, unknown>[];

beforeAll(async () => {
  receipts = [];
  const request = async (input: { body: string; purpose: string }, settle: (bytes: Buffer) => number) => {
    const body = JSON.parse(input.body) as { messages: { content: string }[] };
    const content = researchV4Reply(body.messages[0]!.content, body.messages[1]!.content);
    const bytes = Buffer.from(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    const receipt = { id: `receipt-${receipts.length}`, jobId, contextId, contextSha256: h("3"), packetSha256: digest(input.body), destinationId: "fixture",
      destinationSha256: h("4"), purpose: input.purpose, policyRevision: 0, committedAt: receipts.length + 1,
      reservedFeeMicrousd: 0, status: "settled", feeMicrousd: settle(bytes), responseSha256: digest(bytes), scan: { status: "not_required_for_synthetic_local_test" } };
    receipts.push(receipt); return { bytes, receipt };
  };
  const config = { destinationId: "fixture", model: "cpu-fixture", maxOutputTokens: 16384, thinking: "medium" as const, inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
  const model = new PrivateAgentModel({ request } as unknown as PrivateAgentBroker, config, jobId, contextId);
  const outcome = await runResearchPipeline({ brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(),
    models: { reader: model, planner: model, synthesiser: model }, signal: new AbortController().signal, record() {} });
  expect(outcome.status).toBe("completed"); produced = outcome.files;
});

type Options = { kind?: ResearchProducer["kind"]; freeze?: Record<string, unknown>; transfer?: boolean; inputEvent?: boolean; inputAfterStage?: boolean; inputTime?: number;
  corrupt?: boolean; duplicateTransfer?: boolean; controlledSessionEvent?: boolean; files?: (files: SessionFile[]) => SessionFile[];
  producer?: (producer: ResearchProducer) => unknown; receipts?: (rows: Record<string, unknown>[]) => Record<string, unknown>[] };
function sourceRun(input: Options = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "soar-seed-v4-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const kind = input.kind ?? "session";
  const freeze = Object.fromEntries(Object.entries({ version: 1, jobId, taskBinding: task, deployment: "synthetic_only_unverified_for_private_data",
    pipeline: pipeline(), researchInput: researchInput(), researchProducerKind: kind, startedAt: new Date(1).toISOString(), ...input.freeze }).filter(([, value]) => value !== undefined));
  writeFileSync(join(dir, "freeze.json"), `${canonical(freeze)}\n`);
  const copies = produced.map(file => ({ ...file, bytes: Buffer.from(file.bytes) })), files = input.files?.(copies) ?? copies;
  const originalProducer = createResearchProducer({ kind, jobId, contextId, brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), files: produced, receipts });
  const producer = input.producer?.(originalProducer) ?? originalProducer;
  const db = new Database(join(dir, "state.sqlite")), store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["fixture"], maxRequests: 80, maxFeeMicrousd: 0 });
  for (const row of input.receipts?.(structuredClone(receipts)) ?? receipts)
    db.prepare("INSERT INTO private_agent_dispatches (id, job_id, value) VALUES (?, ?, ?)").run(row.id, jobId, canonical(row));
  const checkpoints = new PrivateCheckpointStore(join(dir, "checkpoints"), jobId), snapshot = checkpoints.save(files);
  const summary = JSON.parse(produced.find(file => file.path === RESEARCH_FILES.summary)!.bytes.toString());
  const binding = { snapshot, snapshotSha256: checkpoints.fingerprint(snapshot), files: sessionFileManifest(files), summary };
  if (kind === "session" || input.controlledSessionEvent) {
    store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q", readerContextId: contextId });
    const appendInput = () => store.append(jobId, { type: "research_input", contextId, recordedAt: input.inputTime ?? 1, input: researchInput() });
    if (input.inputEvent !== false && !input.inputAfterStage) appendInput();
    for (const counts of summary.stages) store.append(jobId, { type: "research_stage", contextId, ...counts });
    if (input.inputAfterStage) appendInput();
    if (input.transfer !== false) store.append(jobId, { type: "research_transfer", contextId, binding: { ...binding, producer } });
    if (input.duplicateTransfer) store.append(jobId, { type: "research_transfer", contextId, binding: { ...binding, producer } });
  }
  if (kind === "controlled_pipeline" && input.transfer !== false) writeFileSync(join(dir, "research-producer.json"), canonical({ version: 2, kind, producer, binding }));
  db.close();
  if (input.corrupt) writeFileSync(join(dir, "checkpoints", jobId, snapshot[0]!.sha256), "tampered");
  return dir;
}
function changePacket(path: string, change: (value: any) => void) {
  return (files: SessionFile[]) => files.map(file => { if (file.path !== path) return file;
    const value = JSON.parse(file.bytes.toString()); change(value); return { path, bytes: Buffer.from(canonical(value) + "\n") }; });
}

describe("v4 research seeds require the ready packet and actual producer receipts", () => {
  it.each(["session", "controlled_pipeline"] as const)("loads %s provenance read-only with one-hop lineage", kind => {
    const dir = sourceRun({ kind }), before = digest(readFileSync(join(dir, "state.sqlite"))), names = readdirSync(dir);
    const loaded = loadResearchSeed(dir, task);
    expect(loaded.files).toEqual(produced);
    expect(loaded.seed).toMatchObject({ version: 2, sourceJobId: jobId, sourceFreezeSha256: digest(readFileSync(join(dir, "freeze.json"))), files: sessionFileManifest(produced),
      producer: { kind, originalGoalSha256: digest(RESEARCH_V4_TEST_BRIEF), sourceManifest: researchInput().sourceManifest } });
    expect(loaded.seed.producer.originalGoalSha256).not.toBe(task.briefSha256);
    expect(loaded.seed.producer.receipts).toHaveLength(receipts.length);
    expect(seededPipelineFreeze(loaded.pipeline, loaded.seed)).toEqual({ ...pipeline(), seededFrom: jobId });
    expect(researchTransferSnapshot(dir)).toBe(loaded.seed.snapshotSha256); expect(researchTransferPresent(dir)).toBe(true);
    expect(digest(readFileSync(join(dir, "state.sqlite")))).toBe(before); expect(readdirSync(dir)).toEqual(names);
    if (kind === "controlled_pipeline") { const db = new Database(join(dir, "state.sqlite"), { readonly: true });
      try { expect(db.prepare("SELECT COUNT(*) AS n FROM private_agent_events").get()).toEqual({ n: 0 }); } finally { db.close(); } }
  });
  it("binds dynamic session inputs before the first stage and rejects invented session evidence for controlled producers", () => {
    expect(loadResearchSeed(sourceRun({ freeze: { researchInput: undefined } }), task).seed.producer.kind).toBe("session");
    for (const options of [{ inputEvent: false }, { inputAfterStage: true }, { inputTime: 2 }, { inputTime: -1 }, { inputTime: Number.MAX_SAFE_INTEGER + 1 },
      { kind: "controlled_pipeline", freeze: { researchInput: undefined } }, { kind: "controlled_pipeline", freeze: { startedAt: new Date(2).toISOString() } },
      { kind: "controlled_pipeline", freeze: { startedAt: "invalid" } },
      { kind: "controlled_pipeline", controlledSessionEvent: true }] as Options[]) {
      const dir = sourceRun(options); expect(() => loadResearchSeed(dir, task)).toThrow(); expect(researchTransferPresent(dir)).toBe(false);
    }
  });
  it.each([
    ["task", { freeze: { taskBinding: { ...task, briefSha256: h("9") } } }, "research_seed_task_mismatch"],
    ["private origin", { freeze: { deployment: "private" } }, "research_seed_not_synthetic"],
    ["seeded origin", { freeze: { researchFrom: { version: 1 } } }, "research_seed_source_seeded"],
    ["missing pipeline", { freeze: { pipeline: undefined } }, "research_seed_no_pipeline"],
    ["missing transfer", { transfer: false }, "research_seed_no_transfer"],
    ["duplicate transfer", { duplicateTransfer: true }, "research_seed_duplicate_transfer"],
  ] as [string, Options, string][])("refuses %s", (_name, options, code) => {
    const dir = sourceRun(options); expect(() => loadResearchSeed(dir, task)).toThrow(code);
    // Discovery has no caller-supplied task; the subsequent loader must enforce that separate binding.
    if (_name !== "task") expect(researchTransferPresent(dir)).toBe(false);
  });
  it("refuses legacy protocols and non-default budgets even with a self-consistent alternate digest", () => {
    for (const changed of [{ ...pipeline(), version: 3 }, { ...pipeline(), protocolSha256: h("4") },
      { ...pipeline(), budget: { ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 3 }, protocolSha256: researchProtocolSha256({ ...RESEARCH_PIPELINE_BUDGET, extractionCalls: 3 }) }]) {
      const dir = sourceRun({ freeze: { pipeline: changed } }); expect(() => loadResearchSeed(dir, task)).toThrow("research_seed_protocol_mismatch"); expect(researchTransferSnapshot(dir)).toBeNull();
    }
  });
  it("rejects goal/source/context substitutions, missing or changed receipts, UNKNOWN and extra stage dispatches", () => {
    const changes: Options[] = [
      { freeze: { researchInput: { ...researchInput(), originalGoalSha256: task.briefSha256 } } },
      { producer: p => ({ ...p, originalGoalSha256: task.briefSha256 }) },
      { producer: p => ({ ...p, sourceManifest: p.sourceManifest.map((s, i) => i ? s : { ...s, sha256: h("8") }) }) },
      { producer: p => ({ ...p, contextId: "another-context" }) }, { producer: p => ({ ...p, receipts: p.receipts.slice(1) }) },
      { receipts: rows => rows.slice(1) }, { receipts: rows => rows.map((r, i) => i ? r : { ...r, responseSha256: h("8") }) },
      { receipts: rows => rows.map((r, i) => i ? r : { ...r, status: "unknown" }) }, { receipts: rows => [...rows, { ...rows[0]!, id: "extra-receipt" }] },
    ];
    for (const options of changes) { const dir = sourceRun(options); expect(() => loadResearchSeed(dir, task)).toThrow(); expect(researchTransferPresent(dir)).toBe(false); }
  });
  it("rejects freshly hashed packets with missing files, structural gaps, cap exclusions and false source identities", () => {
    const changes = [(files: SessionFile[]) => files.filter(file => file.path !== RESEARCH_FILES.coverage),
      (files: SessionFile[]) => [...files, { path: "context/research/extra.json", bytes: Buffer.from("{}") }],
      changePacket(RESEARCH_FILES.coverage, c => { c.status = "incomplete"; }), changePacket(RESEARCH_FILES.coverage, c => { c.sources[0].readable = false; }),
      changePacket(RESEARCH_FILES.coverage, c => { c.chunks[0].endByte--; }), changePacket(RESEARCH_FILES.evidence, e => { e.counts.leftByCap = 1; }),
      changePacket(RESEARCH_FILES.evidence, e => { e.quotes[0].sourceSha256 = h("9"); }), changePacket(RESEARCH_FILES.summary, s => { s.stages[0].calls++; })];
    for (const files of changes) { const dir = sourceRun({ files }); expect(() => loadResearchSeed(dir, task)).toThrow(); expect(researchTransferPresent(dir)).toBe(false); }
  });
  it.each(["session", "controlled_pipeline"] as const)("rejects tampered planner diagnostics through the %s producer and seed route", kind => {
    for (const change of [
      (s: any) => { delete s.planAttempts; },
      (s: any) => { s.planAttempts[0].acceptedPlanSha256 = h("9"); },
      (s: any) => { s.planAttempts[0].truncated = true; },
      (s: any) => { s.planAttempts[0].bindingInspection = "not_run"; },
    ]) {
      const files = changePacket(RESEARCH_FILES.summary, summary => change(summary.stages.find((s: any) => s.stage === "plan")));
      expect(() => createResearchProducer({ kind, jobId, contextId, brief: RESEARCH_V4_TEST_BRIEF,
        sources: researchV4Sources(), files: files(produced), receipts })).toThrow("research_packet_plan_attempts");
      const dir = sourceRun({ kind, files });
      expect(() => loadResearchSeed(dir, task)).toThrow("research_packet_plan_attempts");
      expect(researchTransferPresent(dir)).toBe(false);
    }
  });
  it("refuses corrupt/missing checkpoints and symlinked ledgers without creating missing state", () => {
    expect(() => loadResearchSeed(sourceRun({ corrupt: true }), task)).toThrow(/checkpoint_(file_invalid|digest_mismatch)/u);
    const pruned = sourceRun(); rmSync(join(pruned, "checkpoints"), { recursive: true, force: true });
    expect(() => loadResearchSeed(pruned, task)).toThrow("research_seed_checkpoints_missing"); expect(existsSync(join(pruned, "checkpoints"))).toBe(false);
    const linked = sourceRun(), elsewhere = mkdtempSync(join(tmpdir(), "soar-seed-elsewhere-")); cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    renameSync(join(linked, "state.sqlite"), join(elsewhere, "state.sqlite")); symlinkSync(join(elsewhere, "state.sqlite"), join(linked, "state.sqlite"));
    expect(() => loadResearchSeed(linked, task)).toThrow("research_seed_directory_invalid"); expect(() => researchTransferSnapshot(linked)).toThrow("research_seed_directory_invalid");
  });
  it("binds the complete persisted receipt bytes and rejects unresolved, malformed or unrelated-purpose rows", () => {
    const input = { kind: "controlled_pipeline" as const, jobId, contextId, brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), files: produced, receipts };
    const producer = createResearchProducer(input);
    expect(producer.receipts.map(row => row.sha256)).toEqual(receipts.map(row => digest(canonical(row))));
    expect(producer.receipts.every(row => !("status" in row))).toBe(true);
    expect(validateResearchProducer(producer, { jobId, files: produced, receipts, input: researchInput() })).toEqual(producer);
    expect(() => createResearchProducer({ ...input, receipts: [] })).toThrow("research_producer_receipt_count");
    for (const status of ["committed", "unknown"]) expect(() => createResearchProducer({ ...input, receipts: receipts.map((r, i) => i ? r : { ...r, status }) })).toThrow("research_producer_unsettled_receipt");
    // A row resolved without a response never carries one: a "failed" row that still has a response hash or a fee is malformed.
    expect(() => createResearchProducer({ ...input, receipts: receipts.map((r, i) => i ? r : { ...r, status: "failed" }) })).toThrow("research_producer_unsettled_receipt");
    expect(() => createResearchProducer({ ...input, receipts: receipts.map((r, i) => i ? r : { ...r, purpose: "judge" }) })).toThrow("research_producer_unknown_purpose");
  });
  it("admits a row a retry superseded without counting it, and a failed row counted toward its stage (finding D14)", () => {
    const input = { kind: "controlled_pipeline" as const, jobId, contextId, brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), files: produced, receipts };
    const extract = receipts.findIndex(row => row.purpose === "research evidence extraction");
    const resolvedRow = (row: Record<string, unknown>, status: "superseded" | "failed", id: string, failure: Record<string, unknown> = { phase: "transport", code: "upstream_closed", attempt: 1, elapsedMs: 12, timeoutMs: 900000 }, extra: Record<string, unknown> = {}): Record<string, unknown> => {
      const { responseSha256: _response, feeMicrousd: _fee, ...rest } = row;
      return { ...rest, ...extra, id, status, failure };
    };
    // The D4 retry: the superseded attempt sits before the settled one in the ledger; the stage still made one call.
    const retried = [...receipts.slice(0, extract), resolvedRow(receipts[extract]!, "superseded", "receipt-retried"), ...receipts.slice(extract)];
    const producer = createResearchProducer({ ...input, receipts: retried });
    expect(producer.receipts.map(row => [row.stage, row.status])).toEqual(retried.map(row => [row.purpose === "research evidence extraction" ? "extract" : row.purpose === "research source index" ? "index" : row.purpose === "research plan" ? "plan" : "synthesise", row.status === "superseded" ? "superseded" : undefined]));
    expect(producer.receipts.find(row => row.status === "superseded")!.sha256).toBe(digest(canonical(retried[extract])));
    expect(validateResearchProducer(producer, { jobId, files: produced, receipts: retried, input: researchInput() })).toEqual(producer);
    // The ledger and the producer must still agree row for row: a superseded row the producer never saw is drift.
    expect(() => validateResearchProducer(createResearchProducer(input), { jobId, files: produced, receipts: retried, input: researchInput() })).toThrow("research_producer_receipts_drift");
    // A superseded row with a response is malformed; a settled row that goes missing breaks the count.
    expect(() => createResearchProducer({ ...input, receipts: [...receipts, { ...receipts[extract]!, id: "receipt-dup", status: "superseded" }] })).toThrow("research_producer_unsettled_receipt");
    expect(() => createResearchProducer({ ...input, receipts: [...receipts.slice(0, extract), resolvedRow(receipts[extract]!, "superseded", "receipt-only"), ...receipts.slice(extract + 1)] })).toThrow("research_producer_receipt_count");
    // A failed row counts as the stage's call (no retry superseded it), so it stands in for the settled row's count.
    const failed = receipts.map((row, i) => i === extract ? resolvedRow(row, "failed", row.id as string) : row);
    expect(createResearchProducer({ ...input, receipts: failed }).receipts[extract]).toMatchObject({ stage: "extract", status: "failed" });
    // The cloud half of D14: the Anthropic destination's 429/529 retry leaves a priced superseded planner row with its rejection fields.
    const plan = receipts.findIndex(row => row.purpose === "research plan");
    const cloudRetried = [...receipts.slice(0, plan), resolvedRow(receipts[plan]!, "superseded", "receipt-cloud-retried",
      { phase: "transport", code: "http_rejected", status: 529, errorType: "overloaded_error", requestId: "req_011fixtureretry", attempt: 1, elapsedMs: 40, timeoutMs: 900000 },
      { reservedFeeMicrousd: 330000, destinationId: "cloud-planner" }), ...receipts.slice(plan)];
    const cloudProducer = createResearchProducer({ ...input, receipts: cloudRetried });
    expect(cloudProducer.receipts.filter(row => row.status === "superseded")).toEqual([{ id: "receipt-cloud-retried", stage: "plan", status: "superseded", sha256: digest(canonical(cloudRetried[plan])) }]);
    expect(validateResearchProducer(cloudProducer, { jobId, files: produced, receipts: cloudRetried, input: researchInput() })).toEqual(cloudProducer);
    // The seed loader takes the retried ledger through the same producer path.
    const dir = sourceRun({ receipts: () => retried, producer: () => createResearchProducer({ ...input, kind: "session", receipts: retried }) });
    expect(loadResearchSeed(dir, task).seed.producer.receipts.filter(row => row.status === "superseded")).toHaveLength(1);
    expect(researchTransferPresent(dir)).toBe(true);
  });
  it("binds assist rows to the stage their purpose names: a settled assist is the stage's call, a skipped, failed or superseded one binds uncounted (backlog item 10)", () => {
    const input = { kind: "controlled_pipeline" as const, jobId, contextId, brief: RESEARCH_V4_TEST_BRIEF, sources: researchV4Sources(), files: produced, receipts };
    const plan = receipts.findIndex(row => row.purpose === "research plan"), synthesis = receipts.findIndex(row => row.purpose === "research synthesis");
    const cloudFailure = { phase: "transport", code: "request_timeout", attempt: 1, elapsedMs: 900000, timeoutMs: 900000 };
    /** The row of a cloud one-shot: a priced reservation on the cloud destination; a response only when settled. */
    const assist = (row: Record<string, unknown>, purpose: string, status: string, id = row.id as string): Record<string, unknown> => {
      const { responseSha256, feeMicrousd, ...rest } = row;
      return { ...rest, id, purpose, status, destinationId: "cloud-assist", reservedFeeMicrousd: 160000,
        ...(status === "settled" ? { responseSha256, feeMicrousd: 34000 } : { failure: cloudFailure }) };
    };
    const bound = (rows: Record<string, unknown>[]) => { const producer = createResearchProducer({ ...input, receipts: rows });
      expect(validateResearchProducer(producer, { jobId, files: produced, receipts: rows, input: researchInput() })).toEqual(producer); return producer; };
    // The forced split: the plan stage's only call is its settled assist, which stands in for the local call the summary counts.
    const forced = receipts.map((row, i) => i === plan ? assist(row, PLAN_ASSIST_PURPOSE, "settled") : row);
    expect(bound(forced).receipts[plan]).toEqual({ id: receipts[plan]!.id, stage: "plan", role: "assist", sha256: digest(canonical(forced[plan])) });
    // Local-first: the assist was skipped (unknown) or failed into the local fallback beside the local call that answered; it binds uncounted.
    for (const status of ["unknown", "failed", "superseded"]) {
      const rows = [...receipts.slice(0, synthesis), assist(receipts[synthesis]!, SYNTHESIS_ASSIST_PURPOSE, status, `receipt-assist-${status}`), ...receipts.slice(synthesis)];
      expect(bound(rows).receipts.filter(row => row.role === "assist")).toEqual([{ id: `receipt-assist-${status}`, stage: "synthesise", role: "assist", status, sha256: digest(canonical(rows[synthesis])) }]);
    }
    // A settled assist beside the stage's settled local call is one reply too many; an unknown row of a local stage still refuses the binding;
    // a skipped assist that still carries a response hash is forged; a skipped assist as a stage's only row leaves the stage's call unaccounted.
    expect(() => createResearchProducer({ ...input, receipts: [...receipts, assist(receipts[plan]!, PLAN_ASSIST_PURPOSE, "settled", "receipt-second-reply")] })).toThrow("research_producer_receipt_count");
    expect(() => createResearchProducer({ ...input, receipts: receipts.map((row, i) => i === plan ? { ...assist(row, "research plan", "unknown"), destinationId: row.destinationId } : row) })).toThrow("research_producer_unsettled_receipt");
    expect(() => createResearchProducer({ ...input, receipts: receipts.map((row, i) => i === plan ? { ...assist(row, PLAN_ASSIST_PURPOSE, "unknown"), responseSha256: row.responseSha256 } : row) })).toThrow("research_producer_unsettled_receipt");
    expect(() => createResearchProducer({ ...input, receipts: receipts.map((row, i) => i === plan ? assist(row, PLAN_ASSIST_PURPOSE, "unknown") : row) })).toThrow("research_producer_receipt_count");
    // The producer schema admits status "unknown" only with the assist role, and a changed binding is drift.
    const producer = bound(forced);
    expect(() => validateResearchProducer({ ...producer, receipts: producer.receipts.map((row, i) => i === plan ? { ...row, status: "unknown" } : row) }, { jobId, files: produced, receipts: forced, input: researchInput() })).toThrow("research_producer_receipts_drift");
    expect(() => validateResearchProducer({ ...producer, receipts: producer.receipts.map((row, i) => i === plan ? { id: row.id, stage: row.stage, sha256: row.sha256, status: "unknown" } : row) }, { jobId, files: produced, receipts: forced, input: researchInput() })).toThrow();
    // The seed loader takes a forced-split ledger through the same producer path.
    const dir = sourceRun({ receipts: () => forced, producer: () => createResearchProducer({ ...input, kind: "session", receipts: forced }) });
    expect(loadResearchSeed(dir, task).seed.producer.receipts[plan]).toMatchObject({ stage: "plan", role: "assist" });
  });
  it("uses the same production transfer path for a loaded seed and a freshly generated packet", () => {
    const base: SessionPhase = { files: researchV4Sources().map(({ path, bytes }) => ({ path, bytes })), checks: [{ id: "c", python: "pass" }],
      contract: { version: 1, goal: RESEARCH_V4_TEST_BRIEF, requiredArtifacts: [{ path: "output/report.md", description: "r" }], requiredChecks: ["c"], maxModelCalls: 5, maxToolCalls: 5, maxElapsedMs: 60000 } };
    const seeded = researchTransferPhase(base, loadResearchSeed(sourceRun(), task).files);
    expect(seeded.files.map(file => file.path)).toEqual([...base.files.map(file => file.path), ...produced.map(file => file.path)]);
    expect(seeded.contract.requiredChecks).toContain(RESEARCH_TRANSFER_CHECK_ID);
    expect(sessionPhaseIdentity(researchTransferPhase(base, produced))).toBe(sessionPhaseIdentity(seeded));
    expect(() => researchTransferPhase({ ...base, files: [...base.files, { path: RESEARCH_FILES.summary, bytes: Buffer.from("x") }] }, produced)).toThrow("research_transfer_collision");
  });
});
