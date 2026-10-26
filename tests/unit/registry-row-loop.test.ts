import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical } from "../../src/main/private-agent/contracts";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const SCRIPT = resolve(__dirname, "..", "..", "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
/** A run directory the way the driver leaves one, with the counts the row script reads. */
function run(root: string, name: string, input: { calls: number; tokens: number; fee: number; status: string; startedAt: string; finishedAt: string; pipeline?: Record<string, unknown>; entailment?: Record<string, number> }) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = `job-${name}`;
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: input.startedAt, taskBinding: { jobSha256: h("1"), briefSha256: h("2") }, profile: "heavy",
    modelConfig: { maxOutputTokens: 16384, thinking: "medium" }, ...(input.pipeline ? { pipeline: input.pipeline } : {}) })}\n`);
  writeFileSync(join(dir, "result.json"), `${canonical({ status: input.status, reason: input.status === "submitted" ? "independent_acceptance_pending" : "bounded_allowance_exhausted", finishedAt: input.finishedAt,
    candidateFiles: [{ path: "output/report.md", sha256: h("9") }], dispatches: [{ status: "settled", feeMicrousd: input.fee }, { status: "superseded", feeMicrousd: 0 }] })}\n`);
  const db = new Database(join(dir, "state.sqlite")); const store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["m"], maxRequests: 10, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "session_started", identity: h("3"), startedAt: 1, privateContextId: "p", publicContextId: "q" });
  for (let i = 0; i < input.calls; i++) store.append(jobId, { type: "model_finished", contextId: "p", operationId: `m${i}`, finishReason: i === 0 ? "length" : "stop", usage: { inputTokens: input.tokens, outputTokens: 10, cacheReadTokens: 5 } });
  store.append(jobId, { type: "tool_finished", contextId: "p", operationId: "t", toolCallId: "c", output: "x" });
  if (input.entailment) store.append(jobId, { type: "claims_entailment", contextId: "p", version: 1, counts: input.entailment, entailmentCalls: 3, truncated: false });
  db.close();
  return dir;
}
function row(args: string[]): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local-loop", "--outcome", "accepted", "--verdict-by", "none", "--lesson", "l", "--critical-checks", "7/7"],
    { cwd: resolve(__dirname, "..", ".."), encoding: "utf8" }));
}

describe("registry row of an H4 loop", () => {
  it("sums the loop's runs, takes status, binding, pipeline and entailment from the selected run, times the loop on its own clock, and records the choice", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-loop-row-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const pipeline = { name: "research", version: 3, protocolSha256: h("7"), budget: { indexCalls: 24, extractionCalls: 40, plannerCalls: 2, synthesisCalls: 2 }, planner: "cloud", writer: "local" };
    run(root, "a", { calls: 3, tokens: 100, fee: 120_000, status: "submitted", startedAt: "2026-10-26T10:00:00.000Z", finishedAt: "2026-10-26T10:10:00.000Z", pipeline, entailment: { supported: 20, partial: 1, unsupported: 0, contradicted: 0, not_judged: 0 } });
    run(root, "b", { calls: 2, tokens: 200, fee: 0, status: "incomplete", startedAt: "2026-10-26T10:10:00.000Z", finishedAt: "2026-10-26T10:17:00.000Z", pipeline: { ...pipeline, seededFrom: "job-a" } });
    run(root, "repair", { calls: 4, tokens: 50, fee: 0, status: "submitted", startedAt: "2026-10-26T10:20:00.000Z", finishedAt: "2026-10-26T10:26:00.000Z", pipeline: { ...pipeline, seededFrom: "job-a" }, entailment: { supported: 25, partial: 2, unsupported: 1, contradicted: 0, not_judged: 0 } });
    const candidate = (status: string, reason: string) => ({ status, reason });
    mkdirSync(join(root, "critique"));
    writeFileSync(join(root, "critique", "critique.json"), `${canonical({ critic: "local", critiqueSha256: h("e"), finishReason: "stop", usage: { inputTokens: 700, outputTokens: 60, cacheReadTokens: 10 }, feeMicrousd: 0 })}\n`);
    writeFileSync(join(root, "loop.json"), `${canonical({ version: 1, selectionRule: 1, startedAt: "2026-10-26T09:59:30.000Z", finishedAt: "2026-10-26T10:27:00.000Z",
      candidates: { a: candidate("submitted", "independent_acceptance_pending"), b: candidate("incomplete", "cancelled_or_deadline"), repair: candidate("submitted", "independent_acceptance_pending") },
      seeded: { b: true, repair: true, snapshotSha256: h("f") }, writeIdentityEqual: true, critique: { critiqueSha256: h("e"), modelCalls: 1 },
      selected: { stage1: { candidate: "a", step: "submitted" }, final: { candidate: "repair", step: "entailment" } } })}\n`);
    const loop = row(["--loop-dir", root]);
    // The three runs' counts plus the critique's one call; every sample's own ending stays in the row.
    expect(loop).toMatchObject({ modelCalls: 10, toolCalls: 3, inputTokens: 3 * 100 + 2 * 200 + 4 * 50 + 700, outputTokens: 150, cachedTokens: 55, lengthStops: 3, usd: 0.12, retriedDispatches: 3, failedDispatches: 0, unknownDispatches: 0,
      wallSeconds: 1650, runStatus: "submitted", terminalCause: "independent_acceptance_pending", date: "2026-10-26", taskJobSha256: h("1"), pipeline: "research", pipelinePlanner: "cloud", profile: "heavy",
      loop: { version: 1, rule: 1, samples: 2, repaired: true, seeded: { b: true, repair: true, snapshotSha256: h("f") }, stage1: "a", selected: "repair", step: "entailment", critiqued: true, critiqueFailure: null, writeIdentityEqual: true,
        candidates: { a: { status: "submitted", terminalCause: "independent_acceptance_pending" }, b: { status: "incomplete", terminalCause: "cancelled_or_deadline" }, repair: { status: "submitted", terminalCause: "independent_acceptance_pending" } } },
      entailment: { counts: { supported: 25, partial: 2, unsupported: 1, contradicted: 0, not_judged: 0 }, supportRate: 0.893 }, criticalChecks: "7/7", arm: "local-loop" });
    // A resumed loop's clock restarts in loop.json, but the row's span covers every run of the loop; a failed critique's call still counts from its failure record.
    writeFileSync(join(root, "loop.json"), `${canonical({ version: 1, selectionRule: 1, startedAt: "2026-10-26T11:19:00.000Z", finishedAt: "2026-10-26T11:26:00.000Z",
      candidates: { a: candidate("submitted", "independent_acceptance_pending"), b: candidate("incomplete", "cancelled_or_deadline") }, seeded: { b: true, repair: false, snapshotSha256: h("f") }, writeIdentityEqual: true,
      critique: { failure: "repair_critique_empty", feeMicrousd: 0, finishReason: "length", usage: { inputTokens: 900, outputTokens: 16384 }, modelCalls: 1 },
      selected: { stage1: { candidate: "a", step: "submitted" }, final: { candidate: "a", step: "critique_failed" } } })}\n`);
    rmSync(join(root, "critique", "critique.json")); writeFileSync(join(root, "critique", "critique-failure.json"), `${canonical({ critic: "local", code: "repair_critique_empty", finishReason: "length", usage: { inputTokens: 900, outputTokens: 16384 }, feeMicrousd: 0 })}\n`);
    const failed = row(["--loop-dir", root]);
    expect(failed).toMatchObject({ modelCalls: 6, inputTokens: 300 + 400 + 900, outputTokens: 50 + 16384, lengthStops: 3, wallSeconds: (26 - 0) * 60 + 60 * 60 + 0, runStatus: "submitted",
      loop: { critiqued: false, critiqueFailure: "repair_critique_empty", selected: "a", step: "critique_failed", candidates: { a: { status: "submitted" }, b: { status: "incomplete" } } } });
    // A single run rows as before, and the two modes are exclusive.
    const single = row(["--run-dir", join(root, "a")]);
    expect(single).toMatchObject({ modelCalls: 3, inputTokens: 300, usd: 0.12, wallSeconds: 600, runStatus: "submitted" }); expect(single).not.toHaveProperty("loop");
    expect(() => row(["--run-dir", join(root, "a"), "--loop-dir", root])).toThrow();
    expect(() => row([])).toThrow();
  });
});
