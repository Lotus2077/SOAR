import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical } from "../../src/main/private-agent/contracts";
import { RUN_CLASSIFICATION_VERSION, classifyRunEnd } from "../../src/main/private-agent/run-classification";
import { readRunEndEvidence } from "../../src/main/private-agent/selection";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

/**
 * Backlog item 11, part 3a (BL-20261109-0515-infra-classification-design): registry rows carry `runClass`, and the writer checks
 * `--outcome` against it: an unsubmitted infrastructure end is `infra_invalid` (or `accepted`), any other run never `infra_invalid`.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
function scratch() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-infra-row-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }

/** A run directory as the driver leaves one: its result, and the ledger's events and dispatch rows. */
function runDirectory(root: string, name: string, input: { status?: string; reason: string; events?: Record<string, unknown>[]; dispatches?: Record<string, unknown>[] }) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = `job-${name}`;
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: "2026-11-09T10:00:00.000Z", sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") },
    profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" } })}\n`);
  writeFileSync(join(dir, "result.json"), `${canonical({ status: input.status ?? "incomplete", reason: input.reason, finishedAt: "2026-11-09T10:05:00.000Z", snapshotSha256: h("7"), candidateFiles: [],
    dispatches: input.dispatches ?? [] })}\n`);
  const db = new Database(join(dir, "state.sqlite")); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["m"], maxRequests: 10, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  for (const event of input.events ?? []) store.append(jobId, event as never);
  db.close();
  return dir;
}
function row(args: string[], outcome: string, extra: string[] = []): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local-heavy", "--outcome", outcome,
    "--verdict-by", "none", "--lesson", "l", ...extra], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
/** Python's own reading of a run directory's evidence, for parity with the TypeScript reader. */
function pythonEvidence(dir: string): Record<string, unknown> {
  const probe = ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
    "print(json.dumps(module.run_end_evidence(sys.argv[2], False)))"].join("\n");
  return JSON.parse(execFileSync("python3", ["-I", "-c", probe, SCRIPT, dir], { encoding: "utf8" })) as Record<string, unknown>;
}
const infra = (cause: string) => ({ version: RUN_CLASSIFICATION_VERSION, infra: true, cause });
const task = (cause = "task") => ({ version: RUN_CLASSIFICATION_VERSION, infra: false, cause });
const zeroFee = { status: "failed", destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0, failure: { phase: "transport", code: "request_timeout" } };
const cloud402 = { status: "failed", destinationId: "cloud_coordinator", purpose: "research plan", reservedFeeMicrousd: 160_000, failure: { phase: "transport", code: "http_rejected", status: 402 } };

describe("registry rows classified by how the run ended (backlog item 11, part 3a)", () => {
  it("classifies a run row from its own records, codes and rows only", () => {
    const root = scratch();
    const cases: [string, Parameters<typeof runDirectory>[2], ReturnType<typeof infra>][] = [
      ["host", { reason: "runtime_failure_progress_preserved" }, infra("runtime_failure_progress_preserved")],
      ["local-failure", { reason: "model_unavailable", dispatches: [{ status: "settled", feeMicrousd: 0 }, zeroFee] }, infra("model_unavailable")],
      ["cloud-402", { reason: "model_unavailable", dispatches: [cloud402] }, task()],
      ["stage-failed", { reason: "research_request_denied", events: [{ type: "research_stage", contextId: "r", stage: "index", calls: 1 }, { type: "research_stage", contextId: "r", stage: "plan", calls: 1, denied: "request_failed" }],
        dispatches: [zeroFee] }, infra("research_request_failed")],
      ["stage-deadline", { reason: "research_request_denied", events: [{ type: "research_stage", contextId: "r", stage: "plan", calls: 0, denied: "deadline_before_request" }] }, task()],
      ["token", { reason: "local_token_admission_denied", events: [{ type: "model_request_not_dispatched", contextId: "p", operationId: "o", reason: "local_token_admission_denied", dispatched: false, code: "local_token_admission_timeout" }] },
        infra("local_token_admission_timeout")],
      ["broker", { reason: "model_request_denied", events: [{ type: "model_request_not_dispatched", contextId: "p", operationId: "o", reason: "broker_denied", dispatched: false, code: "destination_missing" }] },
        infra("destination_missing")],
      ["capture", { reason: "bounded_allowance_exhausted", events: [{ type: "host_validation_finished", contextId: "p", operationId: "o", passed: false, checks: [], captureFailure: { code: "capture_failed" } }] },
        infra("verification_unavailable")],
      ["allowance", { reason: "bounded_allowance_exhausted" }, task()],
      ["cancelled", { reason: "cancelled_or_deadline" }, task()],
      ["submitted", { status: "submitted", reason: "independent_acceptance_pending" }, task("submitted")],
      // The evidence a classification depends on is the last of its kind, codes are unwrapped from their records, and assists never count.
      ["sandbox", { reason: "bounded_allowance_exhausted", events: [{ type: "host_validation_finished", contextId: "p", operationId: "o", passed: false, checks: [], verificationFailure: { code: "sandbox_unavailable" } }] },
        infra("verification_unavailable")],
      ["unverified", { reason: "bounded_allowance_exhausted", events: [{ type: "host_validation_finished", contextId: "p", operationId: "o", passed: false, checks: [], verificationFailure: { code: "verification_failed" } }] }, task()],
      ["last-validation", { reason: "bounded_allowance_exhausted", events: [{ type: "host_validation_finished", contextId: "p", operationId: "o1", passed: false, checks: [], captureFailure: { code: "capture_failed" } },
        { type: "host_validation_finished", contextId: "p", operationId: "o2", passed: false, checks: [] }] }, task()],
      ["assist-after", { reason: "model_unavailable", dispatches: [zeroFee, { ...cloud402, purpose: "research plan assist" }] }, infra("model_unavailable")],
      ["cloud-last", { reason: "model_unavailable", dispatches: [zeroFee, cloud402] }, task()],
      ["local-last", { reason: "model_unavailable", dispatches: [cloud402, zeroFee] }, infra("model_unavailable")],
      ["token-last", { reason: "local_token_admission_denied", events: [
        { type: "model_request_not_dispatched", contextId: "p", operationId: "o1", reason: "local_token_admission_denied", dispatched: false, code: "local_token_admission_timeout" },
        { type: "model_request_not_dispatched", contextId: "p", operationId: "o2", reason: "local_token_admission_denied", dispatched: false, code: "local_token_context_exceeded" }] }, task()],
      ["denied-elsewhere", { reason: "research_request_denied", events: [{ type: "research_input", contextId: "r", denied: "request_failed" }] }, task()],
      ["uncertain-reply", { reason: "runtime_failure_progress_preserved", events: [{ type: "runtime_failure", contextId: "p", code: "BrokerError", brokerCode: "transport_or_settlement_unknown" }],
        dispatches: [{ ...cloud402, status: "unknown", failure: { phase: "settlement", code: "response_or_usage_invalid", subcode: "model_served_mismatch" } }] }, task()],
      ["uncertain-transport", { reason: "runtime_failure_progress_preserved", events: [{ type: "runtime_failure", contextId: "p", code: "BrokerError", brokerCode: "transport_or_settlement_unknown" }],
        dispatches: [{ ...cloud402, status: "unknown", failure: { phase: "transport", code: "request_timeout" } }] }, infra("runtime_failure_progress_preserved")],
      ["public-phase", { reason: "public_model_unavailable", dispatches: [{ ...zeroFee, destinationId: "approved_public_snapshots", purpose: "public source retrieval" }] }, infra("public_model_unavailable")],
    ];
    for (const [name, input, expected] of cases) {
      const outcome = expected.infra ? "infra_invalid" : input.status === "submitted" ? "accepted" : "rejected";
      const dir = runDirectory(root, name, input);
      expect(row(["--run-dir", dir], outcome), name).toMatchObject({ runClass: expected, outcome });
      // The TypeScript reader sees the same evidence as the registry's, and the TypeScript classification reaches the same class.
      const evidence = readRunEndEvidence(dir);
      expect(pythonEvidence(dir), name).toEqual({ ...evidence, stopSignalled: false });
      expect(classifyRunEnd({ ...evidence, stopSignalled: false }), name).toEqual(expected);
    }
  });
  it("refuses an outcome that contradicts the class, and keeps accepted open", () => {
    const root = scratch();
    const infraRun = runDirectory(root, "infra", { reason: "model_unavailable", dispatches: [zeroFee] });
    for (const outcome of ["rejected", "incomplete"]) expect(() => row(["--run-dir", infraRun], outcome), outcome).toThrow(/ended on infrastructure \(model_unavailable\): record --outcome infra_invalid/u);
    // A refused row prints nothing.
    try { row(["--run-dir", infraRun], "rejected"); } catch (error) { expect((error as { stdout?: string }).stdout).toBe(""); }
    expect(row(["--run-dir", infraRun], "infra_invalid")).toMatchObject({ outcome: "infra_invalid" });
    // A grader may still accept the deliverable of a run that ended on infrastructure.
    expect(row(["--run-dir", infraRun], "accepted")).toMatchObject({ outcome: "accepted", runClass: infra("model_unavailable") });
    for (const run of [runDirectory(root, "task", { reason: "bounded_allowance_exhausted" }), runDirectory(root, "cloud", { reason: "model_unavailable", dispatches: [cloud402] }),
      runDirectory(root, "submitted", { status: "submitted", reason: "independent_acceptance_pending" })]) {
      expect(() => row(["--run-dir", run], "infra_invalid")).toThrow(/did not end on infrastructure .*--outcome infra_invalid is refused/u);
    }
  });
  it("classifies a loop row by its selected run, with the loop's own interrupt mark", () => {
    // Part 3a's loop refuses a marked stage that did not submit before any final, so it never writes this record itself; the rule is
    // the registry's half of the classification, ready for part 3b.
    const loop = scratch();
    runDirectory(loop, "a", { reason: "cancelled_or_deadline" });
    const write = (stages: unknown) => writeFileSync(join(loop, "loop.json"), `${canonical({ version: 1, selectionRule: 2, arm: "local", startedAt: "2026-11-09T09:59:00.000Z", finishedAt: "2026-11-09T10:06:00.000Z",
      candidates: { a: { status: "incomplete", reason: "cancelled_or_deadline" } }, seeded: { b: false, repair: false, snapshotSha256: null }, writeIdentityEqual: null, critique: null,
      selected: { stage1: null, final: { candidate: "a", step: "stage_failed" } }, ...(stages === undefined ? {} : { stages }) })}\n`);
    // The loop's interrupt cut sample a: an operator's stop.
    write([{ stage: "a", startedAt: "t0", finishedAt: "t1", reused: false, interrupted: true }]);
    expect(row(["--loop-dir", loop], "infra_invalid")).toMatchObject({ runClass: infra("operator_stop"), loop: { selected: "a" } });
    expect(() => row(["--loop-dir", loop], "rejected")).toThrow(/operator_stop/u);
    // Without the mark (or without any stages record, as loops before part 1 wrote), a cancelled end is the session's clock.
    write([{ stage: "a", startedAt: "t0", finishedAt: "t1", reused: false }]);
    expect(row(["--loop-dir", loop], "rejected")).toMatchObject({ runClass: task() });
    write(undefined);
    expect(row(["--loop-dir", loop], "rejected")).toMatchObject({ runClass: task() });
  });
  it("re-checks a superseding row's outcome against the copied run's class, and leaves an unclassified copy alone", () => {
    const root = scratch();
    const original = { id: "p9-infra", batch: "b", task: "t", family: "research", exposure: "fresh", arm: "local-heavy", date: "2026-11-09", git: "abcdefabcdef", runStatus: "incomplete",
      terminalCause: "model_unavailable", outcome: "infra_invalid", runClass: infra("model_unavailable"), verdictBy: "none", ownerMinutes: null, interventions: 0, lesson: "l" };
    const legacy = { ...original, id: "p9-legacy", runClass: undefined };
    const registry = join(root, "registry.jsonl");
    writeFileSync(registry, [original, legacy].map(value => `${JSON.stringify(value)}\n`).join(""));
    const supersede = (id: string, outcome: string) => JSON.parse(execFileSync("python3", ["-I", SCRIPT, "--supersedes", id, "--registry", registry, "--id", `${id}-fix-${outcome}`, "--outcome", outcome,
      "--verdict-by", "agent_diagnostic", "--lesson", "l"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as Record<string, unknown>;
    expect(() => supersede(original.id, "rejected")).toThrow(/ended on infrastructure/u);
    expect(supersede(original.id, "accepted")).toMatchObject({ outcome: "accepted", runClass: infra("model_unavailable"), supersedes: original.id });
    expect(supersede(legacy.id, "rejected")).toMatchObject({ outcome: "rejected", supersedes: legacy.id });
    expect(supersede(legacy.id, "rejected")).not.toHaveProperty("runClass");
    // The reverse holds too: a correction cannot turn a task failure into an infrastructure end.
    const failure = { ...original, id: "p9-task", terminalCause: "bounded_allowance_exhausted", outcome: "rejected", runClass: task() };
    writeFileSync(registry, [original, legacy, failure].map(value => `${JSON.stringify(value)}\n`).join(""));
    expect(() => supersede(failure.id, "infra_invalid")).toThrow(/did not end on infrastructure \(task\)/u);
  });
  it("classifies a loop whose critique failed on infrastructure, leaving an unsubmitted draft, as an infrastructure end", () => {
    const loopRow = (critique: unknown, draft: { status?: string; reason: string }) => {
      const loop = scratch();
      runDirectory(loop, "a", draft);
      writeFileSync(join(loop, "loop.json"), `${canonical({ version: 1, selectionRule: 2, arm: "local", startedAt: "2026-11-09T09:59:00.000Z", finishedAt: "2026-11-09T10:06:00.000Z",
        candidates: { a: { status: draft.status ?? "incomplete", reason: draft.reason } }, seeded: { b: false, repair: false, snapshotSha256: null }, writeIdentityEqual: null, critique,
        selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "critique_failed" } } })}\n`);
      return loop;
    };
    const failed = (code: string) => ({ failure: code, feeMicrousd: 0, finishReason: null, usage: null, modelCalls: 0 });
    expect(row(["--loop-dir", loopRow(failed("request_failed"), { reason: "bounded_allowance_exhausted" })], "infra_invalid")).toMatchObject({ runClass: infra("critique_request_failed") });
    expect(() => row(["--loop-dir", loopRow(failed("request_failed"), { reason: "bounded_allowance_exhausted" })], "rejected")).toThrow(/critique_request_failed/u);
    expect(row(["--loop-dir", loopRow(failed("repair_source_changed_during_critique"), { reason: "bounded_allowance_exhausted" })], "infra_invalid"))
      .toMatchObject({ runClass: infra("critique_repair_source_changed_during_critique") });
    // A critique that failed on the model's output, or a draft that submitted anyway, is not an infrastructure end.
    expect(row(["--loop-dir", loopRow(failed("repair_critique_empty"), { reason: "bounded_allowance_exhausted" })], "rejected")).toMatchObject({ runClass: task() });
    expect(row(["--loop-dir", loopRow(failed("request_failed"), { status: "submitted", reason: "independent_acceptance_pending" })], "accepted")).toMatchObject({ runClass: task("submitted") });
  });
});
