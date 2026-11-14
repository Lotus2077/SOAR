import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical } from "../../src/main/private-agent/contracts";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

/**
 * Backlog item 7(d), part C (BL-20261114-1246-host-flags-surfaces-design): every row registry-row.py writes carries `hostFlags`, the run's
 * `host_flags` event without its positions, or null when the run recorded none ("not recorded", never "no flags").
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
function scratch() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-host-flags-row-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const time = (minute: number) => `2026-11-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
/** A run directory as the driver leaves one: its freeze, its result unless it died first, and its ledger's events. */
function runDirectory(root: string, name: string, input: { status?: string; reason?: string; result?: boolean; events?: Record<string, unknown>[] } = {}) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = `job-${name}`;
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: time(0), sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") },
    profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" }, limits: { feeMicrousd: 0 }, arm: { arm: "local" } })}\n`);
  if (input.result !== false) writeFileSync(join(dir, "result.json"), `${canonical({ status: input.status ?? "submitted", reason: input.reason ?? "independent_acceptance_pending",
    finishedAt: time(5), snapshotSha256: h("7"), candidateFiles: [], dispatches: [] })}\n`);
  const db = new Database(join(dir, "state.sqlite")), store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["owned_local_model"], maxRequests: 50, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  store.append(jobId, { type: "model_finished", contextId: "p", operationId: "o", usage: { inputTokens: 100, outputTokens: 10 }, finishReason: "stop" });
  for (const event of input.events ?? []) store.append(jobId, event);
  db.close();
  return dir;
}
const zero = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0,
  failedDispatches: 0, zeroFeeFailedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0 };
/** A version-2 loop record, as scripts/phase4-loop.ts saves one. */
function loopRecord(root: string, over: Record<string, unknown>) {
  writeFileSync(join(root, "loop.json"), `${canonical({ version: 2, selectionRule: 2, startedAt: time(0), finishedAt: time(40), task: { jobSha256: h("1"), briefSha256: h("2") }, runtimeSha256: h("4"),
    arm: "local", pipeline: null, stages: [], begun: [], resumes: [], voids: [], candidates: { a: null, b: null, repair: null }, seeded: { a: false, b: false, repair: false, snapshotSha256: null },
    writeIdentityEqual: null, critique: null, selected: { stage1: null, final: null }, totals: zero, failure: null, failedStage: null, stopped: null, ...over })}\n`);
}
function row(args: string[], outcome = "accepted"): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local-heavy", "--outcome", outcome,
    "--verdict-by", "none", "--lesson", "l"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
function refused(args: string[]): string {
  try { row(args); } catch (error) { return String((error as { stderr?: unknown }).stderr ?? error); }
  throw new Error("the row was written");
}

/** A research run's event: one uncited absence claim on line 3, a bounded one on line 9, and the ledger's fetch misses. */
const research = { type: "host_flags", contextId: "p", version: 1, rules: { absence: 1 },
  report: { format: "markdown", scanned: true, textCut: false, hits: [{ line: 3, rule: "A1", class: "absence", cited: false }, { line: 9, rule: "A7", class: "bounded", cited: false }], truncated: false },
  misses: { fetchFailures: 1, fetchLimitRefusals: 0 }, counts: { reportAbsence: 1, reportAbsenceUncited: 1, reportBounded: 1 } };
/** A document review whose rules all ran, with a numeric flag, a flagged edit and a clause pair. */
const reviewed = { type: "host_flags", contextId: "p", version: 1, rules: { review: 1 },
  review: { valid: true, read: { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 2, rowsCapped: false, sentencesCapped: false, termsCapped: false },
    numeric: [{ table: 1, row: 2, paragraph: 5, inSource: true, inClean: true, addressed: false }], edits: [{ id: "E2", codes: ["negation_flipped"] }],
    clauses: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressed: true }] },
  counts: { inversionEdits: 1, inversionIntroduced: 0, inversionSource: 1, inversionUnaddressed: 0, numericIntroduced: 0, numericResolved: 0, numericSource: 1, numericUnaddressed: 1 } };
/** A document review whose numeric rule failed, with a flagged edit and a clause pair, and a misses section that failed. */
const review = { type: "host_flags", contextId: "p", version: 1, rules: { review: 1 },
  review: { valid: true, errors: { numeric: "IndexError" }, read: { comparisonsCapped: false, figuresCapped: false, labelsCapped: false, paragraphsClipped: 0, rowsCapped: false, sentencesCapped: false,
    termsCapped: true }, edits: [{ id: "E2", codes: ["negation_flipped"] }], clauses: [{ paragraphs: [7, 8], inSource: true, inClean: false, addressed: true }] },
  counts: { inversionEdits: 1, inversionIntroduced: 0, inversionSource: 1, inversionUnaddressed: 0 } };

describe("the hostFlags registry column (backlog item 7(d), part C)", { timeout: 60_000 }, () => {
  it("rows a run's event without its positions, and null for a run that recorded none", () => {
    const root = scratch();
    expect(row(["--run-dir", runDirectory(root, "research", { events: [research] })]).hostFlags).toEqual({ version: 1, rules: { absence: 1 },
      counts: { reportAbsence: 1, reportAbsenceUncited: 1, reportBounded: 1 }, misses: { fetchFailures: 1, fetchLimitRefusals: 0 },
      report: { format: "markdown", scanned: true, textCut: false, truncated: false } });
    expect(row(["--run-dir", runDirectory(root, "review", { events: [{ ...review, errors: ["misses_failed"] }] })]).hostFlags).toEqual({ version: 1, rules: { review: 1 },
      counts: review.counts, errors: ["misses_failed"], review: { valid: true, errors: { numeric: "IndexError" }, read: review.review.read } });
    expect(row(["--run-dir", runDirectory(root, "invalid-review", { events: [{ ...review, review: { valid: false, reason: "too_large" }, counts: {} }] })]).hostFlags)
      .toEqual({ version: 1, rules: { review: 1 }, counts: {}, review: { valid: false, reason: "too_large" } });
    // Not recorded: no event, so null, never a row of zeros.
    expect(row(["--run-dir", runDirectory(root, "plain")]).hostFlags).toBeNull();
    // A run never carries a hit line, a flag position or an edit id into the registry: the numeric, edit and clause lists are dropped.
    const positions = /"line"|"hits"|"table"|"row"|"paragraph"|"paragraphs"|"E2"/u;
    const full = row(["--run-dir", runDirectory(root, "reviewed", { events: [reviewed] })]);
    expect(full.hostFlags).toEqual({ version: 1, rules: { review: 1 }, counts: reviewed.counts, review: { valid: true, read: reviewed.review.read } });
    expect(JSON.stringify(full)).not.toMatch(positions);
    expect(JSON.stringify(row(["--run-dir", runDirectory(root, "private", { events: [review] })]))).not.toMatch(positions);
    expect(JSON.stringify(row(["--run-dir", runDirectory(root, "research-row", { events: [research] })]))).not.toMatch(positions);
  });
  it("refuses a row whose event the registry cannot read", () => {
    const root = scratch();
    for (const [name, event] of Object.entries({
      version: { ...research, version: 2 }, booleanVersion: { ...research, version: true }, rule: { ...research, rules: { absence: true } }, unknownRule: { ...research, rules: { other: 1 } },
      negative: { ...research, counts: { reportAbsence: -1 } }, boolean: { ...research, counts: { reportAbsence: true } }, fraction: { ...research, misses: { fetchFailures: 0.5 } },
      section: { ...research, errors: ["other_failed"] }, emptyErrors: { ...research, errors: [] }, scan: { ...research, report: "scanned" }, reviewState: { ...review, review: { valid: "yes" } },
      // The light review of #99: every kept value lies in the schema's closed sets, so no free text or path reaches the column.
      countName: { ...research, counts: { reportAbsence: 1, "Acme pays Beta": 1 } }, missName: { ...research, misses: { fetchFailures: 0, "/Users/someone": 1 } },
      format: { ...research, report: { ...research.report, format: "a sentence from /Users/someone/report.md" } }, scanReason: { ...research, report: { ...research.report, scanned: false, reason: "lost" } },
      textCut: { ...research, report: { ...research.report, textCut: "no" } }, truncated: { ...research, report: { ...research.report, truncated: 1 } },
      reviewReason: { ...review, review: { valid: false, reason: "The fee is 50 USD per day" } },
      errorName: { ...review, review: { ...review.review, errors: { step: "The fee is 50 USD per day" } } }, errorPart: { ...review, review: { ...review.review, errors: { other: "IndexError" } } },
      readKey: { ...review, review: { ...review.review, read: { ...review.review.read, paragraph: 7 } } },
      readCount: { ...review, review: { ...review.review, read: { ...review.review.read, paragraphsClipped: -1 } } },
      readCap: { ...review, review: { ...review.review, read: { ...review.review.read, termsCapped: "no" } } } })) {
      expect(refused(["--run-dir", runDirectory(root, name, { events: [event] })]), name).toContain("holds a host_flags event the registry cannot read");
    }
  });
  it("copies the column with a superseded row, and leaves it out of the copy of a row written before it", () => {
    const root = scratch(), path = join(root, "registry.jsonl"), flags = { version: 1, rules: { absence: 1 }, counts: { reportAbsence: 0, reportAbsenceUncited: 0, reportBounded: 0 } };
    const base = { batch: "b", task: "t", family: "research", exposure: "fresh", arm: "local-heavy", date: "2026-11-14", git: "0123456789ab", gitSource: "run", gitDirty: false,
      runStatus: "submitted", outcome: "incomplete", criticalChecks: null, verdictBy: "none", ownerMinutes: null, interventions: 0, lesson: "l" };
    writeFileSync(path, [{ ...base, id: "with-flags", hostFlags: flags }, { ...base, id: "older" }].map(item => `${JSON.stringify(item)}\n`).join(""));
    const copy = (id: string) => JSON.parse(execFileSync("python3", ["-I", SCRIPT, "--supersedes", id, "--registry", path, "--id", `${id}-fix`, "--outcome", "accepted", "--verdict-by", "none",
      "--lesson", "fix"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as Record<string, unknown>;
    expect(copy("with-flags").hostFlags).toEqual(flags);
    // A row written before this change has no hostFlags key at all, and neither does its copy: absent, not null.
    expect(copy("older")).not.toHaveProperty("hostFlags");
  });
  it("rows a loop's event from the run its other fields come from: the selected run, or a stopped stage with a result, and null without one", () => {
    const selected = scratch();
    runDirectory(selected, "a", { events: [research] }); runDirectory(selected, "b", { status: "incomplete", reason: "cancelled_or_deadline", events: [review] });
    mkdirSync(join(selected, "critique")); writeFileSync(join(selected, "critique", "critique-failure.json"), `${canonical({ code: "repair_critique_empty", usage: null })}\n`);
    loopRecord(selected, { begun: ["a", "b", "critique"].map(stage => ({ stage, at: time(0) })), candidates: { a: { status: "submitted", reason: "independent_acceptance_pending" },
      b: { status: "incomplete", reason: "cancelled_or_deadline" }, repair: null }, critique: { failure: "repair_critique_empty", modelCalls: 0 },
      selected: { stage1: { candidate: "a", step: "submitted" }, final: { candidate: "a", step: "critique_failed", cause: "task" } } });
    expect(row(["--loop-dir", selected]).hostFlags).toMatchObject({ rules: { absence: 1 }, counts: research.counts });
    // A loop stopped at a stage: that stage's event when it left a result, as for entailment, and null when it died before one.
    const stopped = scratch(), record = { begun: [{ stage: "a", at: time(0) }], failure: "loop_stage_infra", failedStage: "a", stopped: { stage: "a", failure: "loop_stage_infra", closed: true } };
    runDirectory(stopped, "a", { status: "incomplete", reason: "model_unavailable", events: [research] }); loopRecord(stopped, record);
    expect(row(["--loop-dir", stopped], "infra_invalid").hostFlags).toMatchObject({ rules: { absence: 1 } });
    const died = scratch();
    runDirectory(died, "a", { result: false, events: [research] }); loopRecord(died, record);
    expect(row(["--loop-dir", died], "infra_invalid").hostFlags).toBeNull();
    // A loop stopped before any stage left a run carries null.
    const none = scratch();
    loopRecord(none, { failure: "loop_stage_missing", stopped: { stage: null, failure: "loop_stage_missing", closed: true } });
    expect(row(["--loop-dir", none], "infra_invalid").hostFlags).toBeNull();
  });
});
