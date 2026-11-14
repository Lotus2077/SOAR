import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMS_LEDGER_CHECK_ID } from "../../src/main/private-agent/claims";
import { canonical } from "../../src/main/private-agent/contracts";
import { PROMPT_LAYOUT_VERSIONS, promptProtocol, type PromptProtocolOptions } from "../../src/main/private-agent/runner";
import { PrivateAgentStore } from "../../src/main/private-agent/store";

/**
 * Plan 11.4 (BL-20261114-1523-registry-columns-design): reserved and pinned USD, cloud calls, disclosure by packet, retained URLs and
 * hostnames, actions, 7(c)'s fallback markers and the launcher's stop signal, on run directories as the driver leaves them.
 */
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
function scratch() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-columns-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const time = (minute: number) => `2026-11-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
interface Run { status?: string; reason?: string; dispatches?: Record<string, unknown>[]; events?: Record<string, unknown>[]; start?: number; end?: number; jobId?: string }
/** A run directory as the driver leaves one: its freeze, its result and its ledger's events and dispatch rows. */
function runDirectory(root: string, name: string, input: Run = {}) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = input.jobId ?? `job-${name.replace(/[^A-Za-z0-9_-]/gu, "-")}`, dispatches = input.dispatches ?? [];
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: time(input.start ?? 0), sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") },
    profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" }, limits: { feeMicrousd: 0 }, arm: { arm: "local" } })}\n`);
  writeFileSync(join(dir, "result.json"), `${canonical({ status: input.status ?? "submitted", reason: input.reason ?? "independent_acceptance_pending", finishedAt: time(input.end ?? 5),
    snapshotSha256: h("7"), candidateFiles: [], dispatches: dispatches.map(row => ({ ...row, jobId })) })}\n`);
  const db = new Database(join(dir, "state.sqlite")), store = new PrivateAgentStore(db);
  store.createJob({ version: 1, id: jobId, mode: "private", revision: 0, cancelled: false, destinations: ["owned_local_model"], maxRequests: 50, maxFeeMicrousd: 0 });
  store.append(jobId, { type: "model_finished", contextId: "p", operationId: "m0", usage: { inputTokens: 100, outputTokens: 10 }, finishReason: "stop" });
  for (const event of input.events ?? []) store.append(jobId, event);
  dispatches.forEach((row, i) => db.prepare("INSERT INTO private_agent_dispatches VALUES (?, ?, ?)").run(`d${i}`, jobId, canonical({ committedAt: 1_000 + i, ...row, jobId })));
  db.close();
  return dir;
}
function row(args: string[], outcome: string): Record<string, unknown> {
  return JSON.parse(execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "x", "--batch", "b", "--task", "t", "--family", "research", "--exposure", "fresh", "--arm", "local",
    "--outcome", outcome, "--verdict-by", "none", "--lesson", "l"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
function refused(args: string[], outcome: string): string {
  try { row(args, outcome); } catch (error) { return String((error as { stderr?: unknown }).stderr ?? error); }
  throw new Error("the row was written");
}
const cloud = (over: Record<string, unknown>) => ({ destinationId: "cloud_coordinator", destinationKind: "cloud_model", purpose: "research plan", reservedFeeMicrousd: 160_000, ...over });
const local = (over: Record<string, unknown>) => ({ destinationId: "owned_local_model", destinationKind: "local_model", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 0, ...over });
const retained = (url: string, bytes: number) => ({ type: "public_source_retained", contextId: "q", dispatchId: "d", destinationId: "approved_public_snapshots", url, sha256: h("9"), bytes });
const tool = (operationId: string, name?: string) => [...(name ? [{ type: "tool_started", operationId, toolCallId: operationId, name, contextId: "p" }] : []),
  { type: "tool_finished", operationId, toolCallId: operationId, output: "x", contextId: "p" }];
const stage = (name: string, over: Record<string, unknown> = {}) => ({ type: "research_stage", contextId: "r", stage: name, calls: 1, invalidReplies: 0, usage: { inputTokens: 10, outputTokens: 1 }, ...over });

describe("registry columns (plan 11.4)", () => {
  it("keys actions.tools by the runner's closed set of tool names, which the registry script mirrors exactly", () => {
    // Every tool the runner can offer: its base tools, with public fetches, a consultation and the claims check all enabled.
    const options = { contract: { version: 1, goal: "Synthetic.", requiredArtifacts: [{ path: "output.txt", description: "Output" }], requiredChecks: [CLAIMS_LEDGER_CHECK_ID],
      maxModelCalls: 1, maxToolCalls: 1, maxElapsedMs: 1000 }, imageId: `sha256:${h("a")}`, checks: [{ id: CLAIMS_LEDGER_CHECK_ID, python: "# synthetic" }],
      webDestinations: ["public-docs"], maxPublicFetches: 1, consultation: { identity: "synthetic" },
      model: { config: { destinationId: "model", model: "synthetic", maxOutputTokens: 4096, inputUsdPerMillion: 0, outputUsdPerMillion: 0, thinking: "disabled" } } } as unknown as PromptProtocolOptions;
    const names = [...new Set(PROMPT_LAYOUT_VERSIONS.flatMap(version => promptProtocol(options, version).definitions.map(tool => tool.function.name)))].sort();
    expect(names).toEqual(["append_file", "check_claims", "execute", "fetch_public", "finish", "read_observation", "remember_plan", "request_consultation", "str_replace", "write_file"]);
    expect(readFileSync(SCRIPT, "utf8")).toContain(`RUNNER_TOOLS = (${names.map(name => `"${name}"`).join(", ")})`);
  });
  it("adds reserved and pinned USD, committed rows, cloud calls, disclosure by packet, retained URLs and hostnames, actions and the fallback markers to a run's row", () => {
    const root = scratch();
    const dir = runDirectory(root, "run", {
      dispatches: [
        cloud({ status: "superseded", packetSha256: "p1", bodyBytes: 2048, disclosedBytes: 2048 }),
        cloud({ status: "settled", feeMicrousd: 120_000, packetSha256: "p1", bodyBytes: 2048, disclosedBytes: 2048 }),   // the retried packet counts once
        cloud({ status: "unknown", purpose: "agent reasoning and tool selection", reservedFeeMicrousd: 100_000, packetSha256: "p2", bodyBytes: 500, disclosedBytes: 500 }),
        local({ status: "committed", packetSha256: "p3", bodyBytes: 900, disclosedBytes: 0 }),
        { destinationId: "approved_public_snapshots", destinationKind: "public_web", purpose: "public source retrieval", status: "settled", feeMicrousd: 0, reservedFeeMicrousd: 0, packetSha256: "p4", bodyBytes: 0, disclosedBytes: 0 },
      ],
      // t4: the runner records the name the model chose before it checks the tool, so a made-up name must never reach the row.
      events: [...tool("t1", "execute"), ...tool("t2", "fetch_public"), ...tool("t3"), ...tool("t4", "email jane doe re acme merger 4417"),
        retained("http://127.0.0.1:5555/a", 100), retained("https://www.Example.org/x", 200), retained("https://example.org/y", 300), retained("https://docs.example.net/z", 50),
        stage("index", { sourcesIndexed: 7 }), stage("plan", { fallback: "host_plan" }), stage("synthesise")],
    });
    const written = row(["--run-dir", dir], "accepted");
    // Every attempt's reservation (two of the retried packet, one of the unknown call); pinned: the unknown call and the committed local row.
    expect(written).toMatchObject({ usd: 0.12, reservedUsd: 0.42, pinnedUsd: 0.1, committedDispatches: 1, disclosedBytes: 2548, urls: 4, domains: 2, retainedBytes: 650, queries: null,
      actions: { tools: { execute: 1, fetch_public: 1, other: 2 }, fetchReceipts: 4, sourcesRead: 7 }, researchFallback: { plan: "host_plan", synthesis: "none" } });
    // A fee only where the store settled one: the superseded and the unknown call have none.
    expect(written.cloudCalls).toEqual([
      { purpose: "research plan", status: "superseded", feeUsd: null, reservedUsd: 0.16, bodyBytes: 2048 },
      { purpose: "research plan", status: "settled", feeUsd: 0.12, reservedUsd: 0.16, bodyBytes: 2048 },
      { purpose: "agent reasoning and tool selection", status: "unknown", feeUsd: null, reservedUsd: 0.1, bodyBytes: 500 }]);
    // Counts and host enums only: no URL, hostname, port or model-chosen tool name reaches the row.
    const text = JSON.stringify(written);
    for (const leaked of ["example", "127.0.0.1", "5555", "http", "jane", "acme", "merger", "4417"]) expect(text).not.toContain(leaked);
  });
  it("reads rows written before plan 11.4: a cloud call by its destination, no disclosure, no body bytes, and nothing for a run without a reading stage", () => {
    const root = scratch();
    const dir = runDirectory(root, "old", { dispatches: [{ destinationId: "cloud_coordinator", purpose: "research plan", status: "settled", reservedFeeMicrousd: 160_000, feeMicrousd: 120_000, packetSha256: "p1" },
      { destinationId: "owned_local_model", purpose: "agent reasoning and tool selection", status: "settled", reservedFeeMicrousd: 0, feeMicrousd: 0, packetSha256: "p2" }] });
    expect(row(["--run-dir", dir], "accepted")).toMatchObject({ disclosedBytes: null, cloudCalls: [{ purpose: "research plan", status: "settled", feeUsd: 0.12, reservedUsd: 0.16, bodyBytes: null }],
      urls: 0, domains: 0, retainedBytes: 0, actions: { tools: {}, fetchReceipts: 0, sourcesRead: null }, researchFallback: null, reservedUsd: 0.16, pinnedUsd: 0 });
    // A malformed field is never summed as a count: the disclosure becomes unknown.
    const odd = runDirectory(root, "odd", { dispatches: [local({ status: "settled", feeMicrousd: 0, packetSha256: "p1", bodyBytes: -1, disclosedBytes: "9" })] });
    expect(row(["--run-dir", odd], "accepted")).toMatchObject({ disclosedBytes: null });
    // A reading stage that recorded no count, as a denied index stage does, reads null, not 0.
    const denied = runDirectory(root, "denied", { events: [stage("index"), stage("plan"), stage("synthesise")] });
    expect(row(["--run-dir", denied], "accepted")).toMatchObject({ actions: { sourcesRead: null }, researchFallback: { plan: "none", synthesis: "none" } });
  });
  it("sums a loop's runs, a moved run and the critique included, counts URLs and hostnames over their union, and takes the fallback from the run whose reading stage made the packet", () => {
    const root = scratch(), loop = join(root, "loop");
    // Each run's snapshot receiver listens on its own loopback port: the same two sources, read by a and b, count once each.
    runDirectory(loop, "a", { start: 8, end: 12, dispatches: [cloud({ status: "settled", feeMicrousd: 90_000, packetSha256: "c1", bodyBytes: 1000, disclosedBytes: 1000, committedAt: 9_000 })],
      events: [retained("https://www.example.org/a", 100), retained("http://127.0.0.1:50001/sources/s1", 10), retained("http://[::1]:50001/sources/s2", 10),
        stage("index", { sourcesIndexed: 5 }), stage("plan", { fallback: "host_plan" }), stage("synthesise", { fallback: "skeleton" })] });
    runDirectory(loop, "b.infra-1", { start: 1, end: 3, dispatches: [local({ status: "committed", packetSha256: "l1", bodyBytes: 200, disclosedBytes: 0 })], events: [retained("https://example.org/a", 40)] });
    // b's call was committed before a's, so it comes first although b's directory sorts after a's.
    runDirectory(loop, "b", { start: 12, end: 16, dispatches: [cloud({ status: "settled", feeMicrousd: 30_000, packetSha256: "c2", bodyBytes: 400, disclosedBytes: 400, committedAt: 2_000 })],
      events: [retained("https://www.example.org/a", 100), retained("http://127.0.0.1:50002/sources/s1", 10), retained("http://[::1]:50002/sources/s2", 10), ...tool("t1", "execute")] });
    runDirectory(loop, "repair", { start: 20, end: 26 });
    mkdirSync(join(loop, "critique")); writeFileSync(join(loop, "critique", "critique.json"), `${canonical({ critiqueSha256: h("e"), usage: { inputTokens: 700, outputTokens: 60 }, feeMicrousd: 0, finishReason: "stop" })}\n`);
    const counts = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, lengthStops: 0, feeMicrousd: 0, unknownDispatches: 0, retriedDispatches: 0,
      failedDispatches: 0, zeroFeeFailedDispatches: 0, assistSkippedDispatches: 0, assistFailedDispatches: 0 };
    const span = (start: number, end: number) => ({ startedAt: time(start), finishedAt: time(end) });
    writeFileSync(join(loop, "loop.json"), `${canonical({ version: 2, selectionRule: 2, startedAt: time(0), finishedAt: time(40), task: { jobSha256: h("1"), briefSha256: h("2") }, runtimeSha256: h("4"),
      arm: "local", pipeline: "research", stages: [{ stage: "a", ...span(8, 12), reused: false }, { stage: "b", ...span(12, 16), reused: false }, { stage: "critique", ...span(16, 18), reused: false },
        { stage: "repair", ...span(20, 26), reused: false }], begun: ["a", "b", "critique", "repair"].map(name => ({ stage: name, at: time(0) })),
      resumes: [{ stage: "b", cause: "model_unavailable", as: "rerun", identity: { inode: "1", sha256: null, jobId: "job-b-infra-1" }, counts, span: { startedAt: time(1), endedAt: time(3) }, cleanup: "not_needed", at: time(4) }],
      voids: [], candidates: { a: { status: "submitted", reason: "independent_acceptance_pending" }, b: { status: "submitted", reason: "independent_acceptance_pending" }, repair: { status: "submitted", reason: "independent_acceptance_pending" } },
      seeded: { a: false, b: true, repair: true, snapshotSha256: h("f") }, writeIdentityEqual: null, critique: { critiqueSha256: h("e"), modelCalls: 1 },
      selected: { stage1: { candidate: "a", step: "tie" }, final: { candidate: "a", step: "tie" } }, totals: counts, failure: null, failedStage: null, stopped: null })}\n`);
    const loopRow = row(["--loop-dir", loop], "accepted");
    expect(loopRow).toMatchObject({ reservedUsd: 0.32, pinnedUsd: 0, committedDispatches: 1, disclosedBytes: 1400, urls: 4, domains: 1, retainedBytes: 280, queries: null,
      cloudCalls: [{ purpose: "research plan", status: "settled", feeUsd: 0.03, reservedUsd: 0.16, bodyBytes: 400 }, { purpose: "research plan", status: "settled", feeUsd: 0.09, reservedUsd: 0.16, bodyBytes: 1000 }],
      actions: { tools: { execute: 1 }, fetchReceipts: 7, sourcesRead: 5 }, researchFallback: { plan: "host_plan", synthesis: "skeleton" } });
    const text = JSON.stringify(loopRow);
    for (const leaked of ["example", "127.0.0.1", "::1", "50001", "50002", "http", "sources/s"]) expect(text).not.toContain(leaked);
  });
  it("classes a single run's cancelled end as the operator's stop only when the launcher's ledger says it forwarded a signal, and refuses a ledger without exactly one exit for the run", () => {
    const root = scratch();
    const dir = runDirectory(root, "cut", { status: "incomplete", reason: "cancelled_or_deadline", jobId: "job-cut" });
    const ledger = (name: string, lines: unknown[]) => { const path = join(root, name); writeFileSync(path, lines.map(line => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n"); return path; };
    const exit = (jobId: string | null, signalled: boolean) => ({ event: "run_exited", at: time(9), run: "r1", attempt: 1, exitCode: 2, signal: null, failure: null, signalled, jobId });
    expect(row(["--run-dir", dir], "incomplete").runClass).toEqual({ version: 1, infra: false, cause: "task" });
    const quiet = ledger("quiet.jsonl", [{ event: "launcher_started", at: time(0) }, exit("job-cut", false)]);
    expect(row(["--run-dir", dir, "--launcher-ledger", quiet], "incomplete").runClass).toEqual({ version: 1, infra: false, cause: "task" });
    const forwarded = ledger("forwarded.jsonl", [{ event: "signal_forwarded", at: time(8), run: "r1", attempt: 1, signal: "SIGINT" }, exit("job-cut", true), exit("job-other", false)]);
    expect(row(["--run-dir", dir, "--launcher-ledger", forwarded], "infra_invalid").runClass).toEqual({ version: 1, infra: true, cause: "operator_stop" });
    expect(refused(["--run-dir", dir, "--launcher-ledger", forwarded], "incomplete")).toContain("infra_invalid");
    expect(refused(["--run-dir", dir, "--launcher-ledger", ledger("none.jsonl", [exit("job-other", true)])], "incomplete")).toContain("no single exit for this run");
    expect(refused(["--run-dir", dir, "--launcher-ledger", ledger("two.jsonl", [exit("job-cut", true), exit("job-cut", false)])], "incomplete")).toContain("no single exit for this run");
    expect(refused(["--run-dir", dir, "--launcher-ledger", ledger("torn.jsonl", ["{\"event\":"])], "incomplete")).toContain("cannot be read");
    expect(refused(["--run-dir", dir, "--launcher-ledger", join(root, "absent.jsonl")], "incomplete")).toContain("cannot be read");
    expect(refused(["--loop-dir", root, "--launcher-ledger", quiet], "incomplete")).toContain("--launcher-ledger goes with --run-dir only");
  });
});
