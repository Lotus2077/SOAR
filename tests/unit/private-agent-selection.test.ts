import Database from "better-sqlite3";
import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { ENTAILMENT_MIN_JUDGED, ENTAILMENT_MIN_MARGIN, SELECTION_PROTOCOL_VERSION, compareCandidates, entailmentRate, summarizeRun, type CandidateSummary } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const base: CandidateSummary = { jobId: "j", taskJobSha256: "1".repeat(64), taskBriefSha256: "2".repeat(64), runtimeSha256: "4".repeat(64), researchFrom: null, repairSource: null, status: "submitted", reason: "independent_acceptance_pending", checksPassed: 3, checksTotal: 3, checksCurrent: true, artifactsPresent: 2, artifactsTotal: 2,
  entailment: null, writeIdentity: null, modelCalls: 10, toolCalls: 9, inputTokens: 100, outputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0, failedDispatches: 0,
  candidateSha256: "a".repeat(64), freezeSha256: "b".repeat(64), resultSha256: "c".repeat(64), startedAt: "2026-10-26T00:00:00.000Z", finishedAt: "2026-10-26T00:10:00.000Z" };
const entailed = (supported: number, contradicted = 0, unsupported = 0, truncated = false) => ({ supported, partial: 1, unsupported, contradicted, not_judged: 0, truncated });

describe("H4 selection rule", () => {
  it("orders by submission, then checks passed, then artifacts present, then the entailment balance rate, and gives every tie to the first candidate", () => {
    expect(SELECTION_PROTOCOL_VERSION).toBe(1);
    const pick = (first: CandidateSummary, second: CandidateSummary) => { const { winner, step } = compareCandidates(first, second); return { winner, step }; };
    expect(pick({ ...base, status: "incomplete", reason: "bounded_allowance_exhausted" }, base)).toEqual({ winner: "second", step: "submitted" });
    expect(pick(base, { ...base, status: "incomplete", reason: "bounded_allowance_exhausted" })).toEqual({ winner: "first", step: "submitted" });
    // An unsubmitted draft that passes more checks still loses to a submitted one; among unsubmitted drafts, checks decide, then artifacts.
    expect(pick({ ...base, status: "incomplete", checksPassed: 3 }, { ...base, status: "submitted", checksPassed: 2 })).toEqual({ winner: "second", step: "submitted" });
    expect(pick({ ...base, status: "incomplete", checksPassed: 1 }, { ...base, status: "incomplete", checksPassed: 2 })).toEqual({ winner: "second", step: "checks" });
    expect(pick({ ...base, status: "incomplete", checksPassed: 0, artifactsPresent: 2 }, { ...base, status: "incomplete", checksPassed: 0, artifactsPresent: 1 })).toEqual({ winner: "first", step: "artifacts" });
    // Research: the entailment balance rate over judged claims separates two submitted drafts that pass every check, by at least the margin.
    expect(entailmentRate(entailed(30, 2, 1))).toBeCloseTo(27 / 34); expect(entailmentRate(entailed(29))).toBeCloseTo(29 / 30);
    expect(pick({ ...base, entailment: entailed(30, 2, 1) }, { ...base, entailment: entailed(29) })).toEqual({ winner: "second", step: "entailment" });
    expect(pick({ ...base, entailment: entailed(33) }, { ...base, entailment: entailed(24, 3) })).toEqual({ winner: "first", step: "entailment" });
    expect(compareCandidates({ ...base, entailment: entailed(33) }, { ...base, entailment: entailed(24, 3) }).entailmentRates).toEqual([33 / 34, 21 / 28]);
    // Within the margin, a truncated pass, too few judged claims, or no pass at all: the first candidate (sample a, or the repair) wins.
    expect(ENTAILMENT_MIN_MARGIN).toBe(0.1); expect(ENTAILMENT_MIN_JUDGED).toBe(10);
    expect(pick(base, { ...base, modelCalls: 2 })).toEqual({ winner: "first", step: "tie" });
    expect(pick({ ...base, entailment: entailed(20) }, { ...base, entailment: entailed(19) })).toEqual({ winner: "first", step: "tie" });
    expect(pick({ ...base, entailment: entailed(10) }, { ...base, entailment: entailed(12, 2) })).toEqual({ winner: "first", step: "entailment" });
    expect(pick({ ...base, entailment: entailed(10, 0, 0, true) }, { ...base, entailment: entailed(30) })).toEqual({ winner: "first", step: "tie" });
    expect(pick({ ...base, entailment: entailed(2) }, { ...base, entailment: entailed(30) })).toEqual({ winner: "first", step: "tie" });
    expect(entailmentRate(entailed(2))).toBeNull(); expect(entailmentRate(entailed(30, 0, 0, true))).toBeNull(); expect(entailmentRate(null)).toBeNull();
    expect(pick({ ...base, entailment: null }, { ...base, entailment: entailed(0) })).toEqual({ winner: "first", step: "tie" });
  });
  it("summarises a run from its result, freeze and ledger into counts only: checks from the last verification, deliverables present, entailment, usage and fees", () => {
    const dir = mkdtempSync(join(tmpdir(), "soar-selection-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const jobId = "job-b";
    const freeze = { version: 1, jobId, startedAt: "2026-10-26T10:00:00.000Z", taskBinding: { jobSha256: "1".repeat(64), briefSha256: "2".repeat(64) }, sourceFreezeSha256: "4".repeat(64),
      researchFrom: { version: 1, sourceJobId: "job-a", sourceFreezeSha256: "3".repeat(64), snapshotSha256: "f".repeat(64), files: [] }, repair: { version: 1, source: { resultSha256: "c".repeat(64), freezeSha256: "b".repeat(64) } } };
    writeFileSync(join(dir, "freeze.json"), `${canonical(freeze)}\n`);
    const db = new Database(join(dir, "state.sqlite")); const store = new PrivateAgentStore(db);
    store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["m"], maxRequests: 10, maxFeeMicrousd: 0 });
    store.append(jobId, { type: "session_started", identity: "3".repeat(64), startedAt: 1, privateContextId: "p", publicContextId: "q", readerContextId: "r" });
    store.append(jobId, { type: "started", contextId: "p", identity: "5".repeat(64) });
    store.append(jobId, { type: "research_stage", contextId: "r", stage: "index", calls: 4, usage: { inputTokens: 400, outputTokens: 40, cacheReadTokens: 100 } });
    store.append(jobId, { type: "model_finished", contextId: "p", operationId: "m1", finishReason: "stop", usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 0 } });
    store.append(jobId, { type: "model_finished", contextId: "p", operationId: "m2", finishReason: "length", usage: { inputTokens: 1200, outputTokens: 60, cacheReadTokens: 900 } });
    const verified = "6".repeat(64), later = "7".repeat(64);
    store.append(jobId, { type: "tool_started", contextId: "p", operationId: "t1", toolCallId: "c1", name: "finish" });
    store.append(jobId, { type: "checkpoint", contextId: "p", snapshot: [], sha256: verified });
    store.append(jobId, { type: "tool_finished", contextId: "p", operationId: "t1", toolCallId: "c1", output: canonical({ complete: false, missingArtifacts: [], checks: [{ id: "a", passed: true }, { id: "b", passed: false }] }) });
    const empty = digest(Buffer.alloc(0)), files = [{ path: "output/report.md", sha256: "9".repeat(64) }, { path: "output/claims.json", sha256: empty }, { path: "input/a.md", sha256: "8".repeat(64) }];
    const result = { status: "incomplete", reason: "bounded_allowance_exhausted", finishedAt: "2026-10-26T10:12:00.000Z", candidateFiles: files, snapshotSha256: verified,
      dispatches: [{ status: "settled", feeMicrousd: 12_000 }, { status: "superseded", feeMicrousd: 0 }, { status: "failed" }, { status: "unknown", feeMicrousd: 500 }] };
    writeFileSync(join(dir, "result.json"), `${canonical(result)}\n`);
    const deliverables = ["output/report.md", "output/claims.json"];
    const summary = summarizeRun(dir, deliverables);
    expect(summary).toMatchObject({ jobId, taskJobSha256: "1".repeat(64), taskBriefSha256: "2".repeat(64), runtimeSha256: "4".repeat(64), researchFrom: { sourceJobId: "job-a", snapshotSha256: "f".repeat(64) }, repairSource: { resultSha256: "c".repeat(64), freezeSha256: "b".repeat(64) },
      status: "incomplete", reason: "bounded_allowance_exhausted", checksPassed: 1, checksTotal: 2, checksCurrent: true, artifactsPresent: 1, artifactsTotal: 2, entailment: null,
      writeIdentity: "5".repeat(64), modelCalls: 6, toolCalls: 1, inputTokens: 2600, outputTokens: 150, cachedTokens: 1800, cacheWriteTokens: 0, lengthStops: 1, feeMicrousd: 12_500, unknownDispatches: 1, retriedDispatches: 1, failedDispatches: 1,
      candidateSha256: digest(canonical(files)), startedAt: freeze.startedAt, finishedAt: result.finishedAt });
    expect(summary.freezeSha256).toBe(digest(`${canonical(freeze)}\n`)); expect(summary.resultSha256).toBe(digest(`${canonical(result)}\n`));
    // Pipeline replies have stage counts rather than model_finished events; a legacy stage without truncation counts adds zero.
    store.append(jobId, { type: "research_stage", contextId: "r", stage: "extract", calls: 2, truncatedReplies: 2, usage: { inputTokens: 20, outputTokens: 10 } });
    expect(summarizeRun(dir, deliverables)).toMatchObject({ modelCalls: 8, inputTokens: 2620, outputTokens: 160, cachedTokens: 1800, lengthStops: 3 });
    // The agent edits again after the failed finish: the finish's checks no longer describe the final snapshot and count as 0 of 0.
    store.append(jobId, { type: "tool_started", contextId: "p", operationId: "t2", toolCallId: "c2", name: "execute" });
    store.append(jobId, { type: "checkpoint", contextId: "p", snapshot: [], sha256: later });
    store.append(jobId, { type: "tool_finished", contextId: "p", operationId: "t2", toolCallId: "c2", output: "x" });
    writeFileSync(join(dir, "result.json"), `${canonical({ ...result, snapshotSha256: later })}\n`);
    expect(summarizeRun(dir, deliverables)).toMatchObject({ checksPassed: 0, checksTotal: 0, checksCurrent: false, toolCalls: 2 });
    // A completed run reports the completion's checks (on the final snapshot) and the entailment pass with its truncation flag, not the earlier failed finish.
    store.append(jobId, { type: "completed", contextId: "p", snapshot: [], checks: [{ id: "a", passed: true }, { id: "b", passed: true }], verifiedSnapshotSha256: later });
    store.append(jobId, { type: "claims_entailment", contextId: "p", version: 1, counts: { supported: 30, partial: 5, unsupported: 1, contradicted: 2, not_judged: 0 }, entailmentCalls: 38, truncated: false });
    db.close();
    writeFileSync(join(dir, "result.json"), `${canonical({ ...result, snapshotSha256: later, status: "submitted", reason: "independent_acceptance_pending" })}\n`);
    expect(summarizeRun(dir, deliverables)).toMatchObject({ status: "submitted", checksPassed: 2, checksTotal: 2, checksCurrent: true, entailment: { supported: 30, partial: 5, unsupported: 1, contradicted: 2, not_judged: 0, truncated: false } });
    expect(JSON.stringify(summarizeRun(dir, deliverables))).not.toContain("output/report.md");
    // The ledger is read inside the run directory only: a symlinked state.sqlite is refused.
    const other = mkdtempSync(join(tmpdir(), "soar-selection-other-")); cleanups.push(() => rmSync(other, { recursive: true, force: true }));
    renameSync(join(dir, "state.sqlite"), join(other, "state.sqlite")); symlinkSync(join(other, "state.sqlite"), join(dir, "state.sqlite"));
    expect(() => summarizeRun(dir, deliverables)).toThrow("selection_run_directory_invalid");
  });
});
