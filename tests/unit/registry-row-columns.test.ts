import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMS_LEDGER_CHECK_ID } from "../../src/main/private-agent/claims";
import { canonical } from "../../src/main/private-agent/contracts";
import { PROMPT_LAYOUT_VERSIONS, promptProtocol, type PromptProtocolOptions } from "../../src/main/private-agent/runner";
import { MAX_LOCAL_STREAMS, ServingCardV1Schema } from "../../src/main/private-agent/serving-card";
import { LOCAL_SCREEN_WRITE_BOUNDS } from "../../scripts/private-agent-local-screen";
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
interface Run { status?: string; reason?: string; dispatches?: Record<string, unknown>[]; events?: Record<string, unknown>[]; start?: number; end?: number; jobId?: string;
  freeze?: Record<string, unknown> }
/** A run directory as the driver leaves one: its freeze, its result and its ledger's events and dispatch rows. */
function runDirectory(root: string, name: string, input: Run = {}) {
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  const jobId = input.jobId ?? `job-${name.replace(/[^A-Za-z0-9_-]/gu, "-")}`, dispatches = input.dispatches ?? [];
  writeFileSync(join(dir, "freeze.json"), `${canonical({ version: 1, jobId, startedAt: time(input.start ?? 0), sourceFreezeSha256: h("4"), taskBinding: { jobSha256: h("1"), briefSha256: h("2") },
    profile: "heavy", modelConfig: { maxOutputTokens: 16384, thinking: "medium" }, limits: { feeMicrousd: 0 }, arm: { arm: "local" }, ...input.freeze })}\n`);
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
  it("records the run's research protocol hash, the serving card the driver loaded and its K, and refuses a card record of another shape (BL-20261116-1358-run-row-card-and-doctor-sources-design)", () => {
    const card = { sha256: h("c"), version: 1, date: "2026-11-16", entry: "BL-20261116-1203-research-role-policy-design", localStreams: 4 };
    const pipeline = { name: "research", version: 3, protocolSha256: h("d"), planner: "local", writer: "local" }, root = scratch();
    // The card's sha256 and adopting entry only: never its version, date or path.
    const carded = row(["--run-dir", runDirectory(root, "carded", { freeze: { servingCard: card, pipeline } })], "accepted");
    expect([carded.researchProtocolSha256, carded.servingCard, carded.localStreams]).toEqual([h("d"), { sha256: h("c"), entry: card.entry }, 4]);
    // Without a card or a research pipeline, and with a card recorded before 8.2b gave it a K: the session ran one call at a time.
    const plain = row(["--run-dir", runDirectory(root, "plain")], "accepted");
    expect([plain.researchProtocolSha256, plain.servingCard, plain.localStreams]).toEqual([null, null, 1]);
    const { localStreams: _k, ...older } = card;
    expect(row(["--run-dir", runDirectory(root, "older", { freeze: { servingCard: older } })], "accepted")).toMatchObject({ servingCard: { sha256: h("c") }, localStreams: 1 });
    // A present value of another shape refuses the row; the refusal names the field and never prints the value.
    const cases: [Record<string, unknown>, string][] = [
      [{ servingCard: { ...card, sha256: "/Users/someone/card.json" } }, "servingCard does not record"], [{ servingCard: "/Users/someone/card.json" }, "servingCard does not record"],
      [{ servingCard: { ...card, entry: "/Users/someone/entry" } }, "servingCard does not record"], [{ servingCard: { ...card, entry: `${card.entry}\n` } }, "servingCard does not record"],
      [{ servingCard: { ...card, entry: null } }, "servingCard does not record"],
      ...[0, 9, 4.5, true, "4"].map(value => [{ servingCard: { ...card, localStreams: value } }, "localStreams is not a whole number from 1 to 8"] as [Record<string, unknown>, string]),
      [{ pipeline: { ...pipeline, protocolSha256: "/Users/someone/protocol" } }, "pipeline.protocolSha256 is not a sha256"],
    ];
    // The writer's copies of the card reader's K bound and entry pattern equal the reader's: K at the bound is copied, one above refused,
    // and the two patterns agree on edge strings.
    expect(row(["--run-dir", runDirectory(root, "bound", { freeze: { servingCard: { ...card, localStreams: MAX_LOCAL_STREAMS } } })], "accepted").localStreams).toBe(MAX_LOCAL_STREAMS);
    cases.push([{ servingCard: { ...card, localStreams: MAX_LOCAL_STREAMS + 1 } }, `localStreams is not a whole number from 1 to ${MAX_LOCAL_STREAMS}`]);
    const entries = [card.entry, `${card.entry}\n`, card.entry.toUpperCase(), "BL-20261116-1203-a--b", "BL-20261116-1203-a-", "BL-2026111-1203-a", "BL-20261116-120-a",
      `BL-${String.fromCharCode(0xff12)}0261116-1203-a`, "BL-20261116-1203-", "BL-20261116-1203-a1-b2-c3"];
    const python = ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('row', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "print(json.dumps({'max': m.MAX_LOCAL_STREAMS, 'entries': [m.CARD_ENTRY.fullmatch(e) is not None for e in json.loads(sys.argv[2])]}))"].join("\n");
    const mirrored = JSON.parse(execFileSync("python3", ["-I", "-c", python, SCRIPT, JSON.stringify(entries)], { encoding: "utf8" }));
    expect(mirrored).toEqual({ max: MAX_LOCAL_STREAMS, entries: entries.map(entry => ServingCardV1Schema.shape.decision.shape.entry.safeParse(entry).success) });
    cases.forEach(([freeze, message], index) => {
      const stderr = refused(["--run-dir", runDirectory(root, `bad-${index}`, { freeze })], "accepted");
      expect(stderr, message).toContain(message); expect(stderr).not.toContain("/Users/someone");
    });
  }, 60_000);

  it("records the write phase's bound from the freeze's limits, so E2's two writer arms differ in the row, and refuses a limits record of another shape (BL-20261117-1049-e2-write-bound-and-dry-run-design)", () => {
    const root = scratch(), heavy = { requests: 200, modelCalls: 80, toolCalls: 120, outputTokens: 16384, inputBytes: 655360, requestTimeoutMs: 900_000, elapsedMs: 5_400_000, feeMicrousd: 0 };
    const bounded = { ...heavy, modelCalls: 12, toolCalls: 12, elapsedMs: 1_200_000, writeBound: "twelve-call", sessionElapsedMs: 5_400_000 };
    const writer1 = row(["--run-dir", runDirectory(root, "writer-1", { freeze: { limits: heavy } })], "accepted");
    const writer2 = row(["--run-dir", runDirectory(root, "writer-2", { freeze: { limits: bounded } })], "accepted");
    expect(writer1.writeLimits).toEqual({ bound: null, modelCalls: 80, toolCalls: 120, elapsedMs: 5_400_000 });
    expect(writer2.writeLimits).toEqual({ bound: "twelve-call", modelCalls: 12, toolCalls: 12, elapsedMs: 1_200_000 });
    // The profile's three columns are the same in both arms: only writeLimits tells them apart.
    expect([writer2.profile, writer2.thinking, writer2.maxOutputTokens]).toEqual([writer1.profile, writer1.thinking, writer1.maxOutputTokens]);
    // Older freezes: none of the three (this file's default limits hold only the fee cap), no limits at all, and a number missing.
    expect(row(["--run-dir", runDirectory(root, "fee-only")], "accepted").writeLimits).toBeNull();
    expect(row(["--run-dir", runDirectory(root, "no-limits", { freeze: { limits: null } })], "accepted").writeLimits).toBeNull();
    expect(row(["--run-dir", runDirectory(root, "partial", { freeze: { limits: { feeMicrousd: 0, modelCalls: 40, toolCalls: 80 } } })], "accepted").writeLimits)
      .toEqual({ bound: null, modelCalls: 40, toolCalls: 80, elapsedMs: null });
    // A present value of another shape, or a bound without its three numbers, refuses the row; the refusal names the field and never prints the value.
    const { elapsedMs: _e, ...withoutElapsed } = bounded;
    const cases: [Record<string, unknown>, string][] = [
      [{ limits: "/Users/someone/limits" }, "limits is not an object"], [{ limits: ["/Users/someone/limits"] }, "limits is not an object"],
      ...[0, -12, 1.5, true, "12", "/Users/someone/12"].flatMap(value => (["modelCalls", "toolCalls", "elapsedMs"] as const).map(key =>
        [{ limits: { ...bounded, [key]: value } }, `limits.${key} is not a positive whole number`] as [Record<string, unknown>, string])),
      ...["Twelve-Call", "twelve-call\n", "twelve--call", "-twelve", "", "/Users/someone/bound", 12, true, ["twelve-call"]].map(value =>
        [{ limits: { ...bounded, writeBound: value } }, "limits.writeBound is not a bound's name"] as [Record<string, unknown>, string]),
      [{ limits: withoutElapsed }, "limits.writeBound is recorded without the write phase's three limits"],
    ];
    cases.forEach(([freeze, message], index) => {
      const stderr = refused(["--run-dir", runDirectory(root, `bad-${index}`, { freeze })], "accepted");
      expect(stderr, message).toContain(message); expect(stderr).not.toContain("/Users/someone");
    });
    // The writer's bound-name pattern admits every name in the driver's table.
    const python = ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('row', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "print(json.dumps([m.WRITE_BOUND.fullmatch(name) is not None for name in json.loads(sys.argv[2])]))"].join("\n");
    const names = Object.keys(LOCAL_SCREEN_WRITE_BOUNDS);
    expect(names.length).toBeGreaterThan(0);
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", python, SCRIPT, JSON.stringify(names)], { encoding: "utf8" }))).toEqual(names.map(() => true));
  }, 120_000);

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
      actions: { tools: { execute: 1, fetch_public: 1, other: 2 }, fetchReceipts: 4, sourcesRead: 7 }, researchFallback: { plan: "host_plan", synthesis: "none" },
      researchCorrections: null });
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
    expect(row(["--run-dir", denied], "accepted")).toMatchObject({ actions: { sourcesRead: null }, researchFallback: { plan: "none", synthesis: "none" }, researchCorrections: null });
    // The synthesis evidence-id tolerance's counts, which every synthesise row records since coverage version 6: zero is a count, and a
    // malformed one makes the whole column unknown.
    const counted = { evidenceIdsDroppedNotCitable: 0, evidenceIdsDroppedNotTagged: 3, questionsDowngraded: 1 };
    const tolerant = runDirectory(root, "tolerant", { events: [stage("index"), stage("plan"), stage("synthesise", counted)] });
    expect(row(["--run-dir", tolerant], "accepted").researchCorrections).toEqual(counted);
    const malformed = runDirectory(root, "malformed", { events: [stage("index"), stage("plan"), stage("synthesise", { ...counted, questionsDowngraded: -1 })] });
    expect(row(["--run-dir", malformed], "accepted").researchCorrections).toBeNull();
  });
  it("sums a loop's runs, a moved run and the critique included, counts URLs and hostnames over their union, and takes the fallback from the run whose reading stage made the packet", () => {
    const root = scratch(), loop = join(root, "loop");
    // Each run's snapshot receiver listens on its own loopback port: the same two sources, read by a and b, count once each.
    runDirectory(loop, "a", { start: 8, end: 12, dispatches: [cloud({ status: "settled", feeMicrousd: 90_000, packetSha256: "c1", bodyBytes: 1000, disclosedBytes: 1000, committedAt: 9_000 })],
      events: [retained("https://www.example.org/a", 100), retained("http://127.0.0.1:50001/sources/s1", 10), retained("http://[::1]:50001/sources/s2", 10),
        stage("index", { sourcesIndexed: 5 }), stage("plan", { fallback: "host_plan" }), stage("synthesise", { fallback: "skeleton", evidenceIdsDroppedNotCitable: 0,
          evidenceIdsDroppedNotTagged: 0, questionsDowngraded: 0 })] });
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
      actions: { tools: { execute: 1 }, fetchReceipts: 7, sourcesRead: 5 }, researchFallback: { plan: "host_plan", synthesis: "skeleton" },
      researchCorrections: { evidenceIdsDroppedNotCitable: 0, evidenceIdsDroppedNotTagged: 0, questionsDowngraded: 0 } });
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
