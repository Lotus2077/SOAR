import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENTAILMENT_PROMPT_VERSION, ENTAILMENT_VERDICTS } from "../../src/main/private-agent/claims";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { inventoryResearchSources } from "../../src/main/private-agent/research-coverage";
import { assembleIndexEntry, buildLiteralSourceCard } from "../../src/main/private-agent/research-index";
import { researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import { assessProbeFile } from "../../scripts/assess-probe-replies";
import { JUDGE_CONDITIONS, runJudgeFixture } from "../../scripts/judge-fixture";
import { CALL_KINDS, CALL_STATES, CallRecordSchema, ENVELOPE_LINE, LABELLER_MODEL, LABELLING_FAILURES, LABELLING_OUTCOMES, LOCK_NAME, LabellingSummarySchema,
  PLANT_REJECTIONS, SECOND_REQUEST_VALUES, TOKEN_FIELDS, UNBILLED_STATUSES, runLabelling, type LabellingSummary } from "../../scripts/judge-labeller";
import { DEFAULT_CONDITIONS, FIXTURE_CONDITIONS, runPlannerFixture } from "../../scripts/planner-fixture";
import { syntheticProbe, syntheticStream } from "../helpers/serving-probe-fixture";

/**
 * E0's registry modes (BL-20261116-0839-e0-registry-modes-design): a serving-probe run from its probe.json, the real probe's included; a
 * planner or judge fixture run from the summary.json the real fixture writes against a loopback fake, or, when it died, from its replies
 * listing; and the labelling call from the summary lane S-e1's labelling tool writes. Nothing here reaches a real endpoint, a cloud model
 * or Docker.
 */
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "registry-row.py");
const h = (n: string) => n.repeat(64);
function scratch() { const dir = realpathSync(mkdtempSync(join(tmpdir(), "soar-e0-rows-"))); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }

const FLAGS = { "--id": "e0-x", "--batch": "e0-2026-11", "--task": "r3-grid-batteries", "--family": "research", "--exposure": "exposed", "--arm": "local", "--verdict-by": "agent_diagnostic",
  "--lesson": "l" } as Record<string, string>;
function run(args: string[], outcome: string, flags: Record<string, string> = {}): string {
  const all = { ...FLAGS, ...flags, "--outcome": outcome };
  return execFileSync("python3", ["-I", SCRIPT, ...args, ...Object.entries(all).flatMap(([flag, value]) => [flag, value])], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const row = (args: string[], outcome: string, flags: Record<string, string> = {}) => JSON.parse(run(args, outcome, flags)) as Record<string, any>;
function refused(args: string[], outcome: string, flags: Record<string, string> = {}): string {
  try { run(args, outcome, flags); } catch (error) { return String((error as { stderr?: unknown }).stderr ?? error); }
  throw new Error("the row was written");
}
/** A row's text never carries any of these producer strings. */
function expectAbsent(line: string, ...needles: string[]) { for (const needle of needles) expect(line).not.toContain(needle); }

describe("E0 registry modes: the producers' closed sets", () => {
  it("mirrors the probe's names and version, and the fixtures' conditions, classes, verdicts and failures exactly", () => {
    const python = [
      "import importlib.util, json, sys",
      "def load(name, path):",
      "    spec = importlib.util.spec_from_file_location(name, path); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module",
      "row, probe = load('registry_row', sys.argv[1]), load('serving_probe', sys.argv[2])",
      "print(json.dumps({'probes': list(row.PROBE_NAMES), 'probeVersion': row.PROBE_VERSION, 'probeProbes': list(probe.PROBES), 'probeProbeVersion': probe.PROBE_VERSION,",
      "  'p10Roles': list(row.P10_ROLES), 'probeRoles': list(probe.P10_ROLES), 'p10Modes': list(row.P10_MODES), 'probeModes': list(probe.P10_MODES),",
      "  'plannerConditions': list(row.PLANNER_CONDITIONS), 'plannerClasses': list(row.PLANNER_CLASSES), 'judgeConditions': list(row.JUDGE_CONDITIONS),",
      "  'judgeVerdicts': list(row.JUDGE_VERDICTS), 'judgeFailures': list(row.JUDGE_FAILURES)}))"].join("\n");
    const mirrored = JSON.parse(execFileSync("python3", ["-I", "-c", python, SCRIPT, join(ROOT, "scripts", "serving-probe.py")], { encoding: "utf8" }));
    expect(mirrored.probes).toEqual(mirrored.probeProbes);
    expect(mirrored.probeVersion).toBe(mirrored.probeProbeVersion);
    expect([mirrored.p10Roles, mirrored.p10Modes]).toEqual([mirrored.probeRoles, mirrored.probeModes]);
    expect(mirrored.plannerConditions).toEqual([...FIXTURE_CONDITIONS]);
    expect(mirrored.judgeConditions).toEqual([...JUDGE_CONDITIONS]);
    expect(mirrored.judgeVerdicts).toEqual([...ENTAILMENT_VERDICTS]);
    // The planner's classes and the judge's failures are TypeScript unions with no runtime value: read them from the scripts' text.
    const union = (text: string) => text.split("|").map(part => JSON.parse(part.trim()) as string);
    const planner = readFileSync(join(ROOT, "scripts", "planner-fixture.ts"), "utf8"), judge = readFileSync(join(ROOT, "scripts", "judge-fixture.ts"), "utf8");
    expect(mirrored.plannerClasses.slice().sort()).toEqual(union(/export type CallClassification = ([^;]+);/u.exec(planner)![1]!).sort());
    expect(mirrored.judgeFailures.slice().sort()).toEqual(union(/failure\?: ([^;]+);/u.exec(judge)![1]!).sort());
  });
});

describe("E0 registry modes: serving-probe runs", () => {
  /** The card tests' synthetic probe result, with the export's request body digest on every P10 cell as P10-align records it. */
  function probeDir(change: (probe: Record<string, any>) => void = () => {}, text: (json: string) => string = json => json) {
    const probe = syntheticProbe();
    for (const [name, cell] of Object.entries(probe.P10.cells as Record<string, Record<string, unknown>>)) cell.request_body_sha256 = digest(`body ${name}`);
    change(probe);
    const dir = join(scratch(), probe.run_id as string); mkdirSync(dir);
    writeFileSync(join(dir, "probe.json"), text(`${JSON.stringify(probe, null, 1)}\n`));
    return { dir, probe, bytes: readFileSync(join(dir, "probe.json")) };
  }
  /** Every probe the synthetic run selected ran or failed; this one makes P6 run too. */
  const complete = (probe: Record<string, any>) => { probe.probes_failed = {}; probe.probes_run.push("P6"); probe.P6 = { running_before: 0, abort: { aborted_after_s: 4.01 },
    running_after_abort_1s_steps: [1, 0], next_request: { status: 200, prompt_tokens: 20, completion_tokens: 2 } }; };

  it("counts each completed probe's model calls, keeps the usage it recorded, binds what P10 sent, spends nothing, and copies no alias, version or source id", () => {
    const { dir, probe, bytes } = probeDir();
    const line = run(["--probe-dir", dir], "rejected"), result = JSON.parse(line);
    // P1 and the adapter's /tokenize are not model calls; P11's K bursts are 1 + 2 + 4 + 8 streams; P6 failed and P8 was skipped.
    expect(result.probe.calls).toEqual({ P1: 0, P2: 5, P3: 3, P4: 1, P5: 1, P7: 3, P9: 1, P10: 6 + 120, P11: 3 + 4 + 15, adapter: 6 });
    expect(result.modelCalls).toBe(168);
    // Usage the probe kept: P2, P3, P4, P7, P10's 120 cell calls, P11's three sizes and the adapter's four thinking replies.
    expect(result.probe.usage).toEqual({ calls: 139, inputTokens: 200 + 47369 + 47299 + 90 + 144000 + 199910 + 160, outputTokens: 2980 + 3900 + 300 + 2700 + 48000 + 900 + 1380 });
    expect([result.inputTokens, result.outputTokens, result.cachedTokens]).toEqual([null, null, null]);
    expect(result).toMatchObject({ date: "2026-11-08", wallSeconds: 6430, usd: 0, reservedUsd: 0, pinnedUsd: 0, unknownDispatches: 0, cloudCalls: [], disclosedBytes: 0,
      cloudModel: null, cloudApi: null, profile: null, thinking: null, maxOutputTokens: null, terminalCause: "probe_finished", gitSource: "row_written", gitDirty: null, outcome: "rejected" });
    expect(result.probe).toMatchObject({ version: 2, sha256: digest(bytes), protocolSha256: h("c"), selected: probe.probes_selected, run: probe.probes_run, skipped: ["P8"],
      failed: { P6: "URLError" }, finished: true, assessed: true, schemasProtocolMatch: true });
    // Each cell sent its exported body plus a response_format from its role's schema and its strict variant.
    const cells = probe.P10.cells as Record<string, { request_body_sha256: string; strict: boolean }>;
    expect(result.inputSha256).toBe(digest(canonical({ bodies: Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, cell.request_body_sha256])),
      schemas: probe.P10.schema_sha256, strict: Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, cell.strict])) })));
    expectAbsent(line, "RM-01", "Qwen3.8", "0.33.0rc1", "input/corpus", "alpha.md", probe.run_id, "local_zero_cost", "loopback");
  });

  it("refuses accepted for a run that did not finish, lost a probe, left P10 unassessed or assessed it under another protocol, and accepts a complete one", () => {
    expect(row(["--probe-dir", probeDir(complete).dir], "accepted")).toMatchObject({ outcome: "accepted", modelCalls: 170, probe: { failed: {}, calls: { P6: 2 } } });
    expect(refused(["--probe-dir", probeDir().dir], "accepted")).toContain("probes failed (P6)");
    const unfinished = probeDir(probe => { complete(probe); delete probe.finished_utc; });
    expect(refused(["--probe-dir", unfinished.dir], "accepted")).toContain("did not finish");
    expect(row(["--probe-dir", unfinished.dir], "incomplete")).toMatchObject({ terminalCause: "probe_unfinished", wallSeconds: null, probe: { finished: false } });
    expect(refused(["--probe-dir", probeDir(probe => { complete(probe); delete probe.P10.assessed; }).dir], "accepted")).toContain("pnpm probe:assess");
    expect(refused(["--probe-dir", probeDir(probe => { complete(probe); probe.P10.assessed.schemasProtocolMatch = false; }).dir], "accepted")).toContain("another research protocol");
    // A P1-only run: no P10, so no input hash and no assessment to wait for.
    const p1 = probeDir(probe => { probe.probes_selected = ["P1"]; probe.probes_run = ["P1"]; probe.probes_failed = {}; probe.probes_skipped = probe.probes_skipped.concat(
      ["P2", "P3", "P4", "P5", "P6", "P7", "P9", "P10", "P11", "adapter"]).sort(); });
    expect(row(["--probe-dir", p1.dir], "accepted")).toMatchObject({ modelCalls: 0, inputSha256: null, probe: { assessed: null, schemasProtocolMatch: null, calls: { P1: 0 } } });
    // An export without body digests binds no input hash.
    expect(row(["--probe-dir", probeDir(probe => { delete probe.P10.cells["plan/on"].request_body_sha256; }).dir], "rejected").inputSha256).toBeNull();
    // Only answered calls' usage counts: a request that was not answered 200 counts as a call, never its token fields.
    const errored = row(["--probe-dir", probeDir(probe => { probe.P2.kwargs_low = { status: 503, prompt_tokens: 40, completion_tokens: 600, elapsed_s: 0.2 }; }).dir], "rejected");
    expect([errored.modelCalls, errored.probe.usage.calls, errored.probe.usage.outputTokens]).toEqual([168, 138, 60160 - 600]);
  }, 60_000);

  it("keeps a failure's class only when it is a known exception class, and reads past a NaN reading it never copies", () => {
    for (const text of ["alice_Developer_example_secret", "connection refused by 10.0.0.5"]) {
      const line = run(["--probe-dir", probeDir(probe => { probe.probes_failed = { P6: text }; }).dir], "rejected");
      expect(JSON.parse(line).probe.failed).toEqual({ P6: "other" });
      expectAbsent(line, "alice", "10.0.0.5");
    }
    expect(row(["--probe-dir", probeDir(probe => { probe.probes_failed = { P6: "TimeoutError" }; }).dir], "rejected").probe.failed).toEqual({ P6: "TimeoutError" });
    expect(row(["--probe-dir", probeDir(undefined, json => json.replace("\"waiting\": 0", "\"waiting\": NaN")).dir], "rejected").modelCalls).toBe(168);
  }, 60_000);

  it("refuses another probe version, a record without the zero-fee guard, unknown or unaccounted probes, and a P10 digest that is not one", () => {
    expect(refused(["--probe-dir", probeDir(probe => { probe.probe_version = 1; }).dir], "rejected")).toContain("probe version 2");
    expect(refused(["--probe-dir", probeDir(undefined, json => json.replace("\"probe_version\": 2,", "\"probe_version\": 2.0,")).dir], "rejected")).toContain("probe version 2");
    expect(refused(["--probe-dir", probeDir(probe => { probe.transport_class = "https"; probe.cost_policy = null; }).dir], "rejected")).toContain("zero-fee guard");
    expect(refused(["--probe-dir", probeDir(probe => { probe.probes_run.push("P12"); }).dir], "rejected")).toContain("probes_run");
    expect(refused(["--probe-dir", probeDir(probe => { probe.probes_failed = {}; }).dir], "rejected")).toContain("neither ran nor failed every probe it selected");
    expect(refused(["--probe-dir", probeDir(probe => { probe.P10.cells["plan/on"].request_body_sha256 = "/Users/someone/body"; }).dir], "rejected")).toContain("P10's cells");
    expect(refused(["--probe-dir", probeDir(probe => { probe.roles.protocol_sha256 = "/Users/someone/protocol"; }).dir], "rejected")).toContain("roles.protocol_sha256");
    expect(refused(["--probe-dir", probeDir(probe => { probe.P11.k_streams["2"].streams = 2 ** 60; }).dir], "rejected")).toContain("K burst");
    expect(refused(["--probe-dir", scratch()], "rejected")).toContain("probe.json is missing");
  }, 60_000);

  it("refuses accepted when a probe's records show a transport failure, except P8's measured cut and P6's deliberate abort (BL-20261116-1217-serving-probe-direct-transport-design)", () => {
    const ranToo = (probe: Record<string, any>, name: string, record: unknown) => {
      probe.probes_selected = [...new Set([...probe.probes_selected, name])]; probe.probes_skipped = probe.probes_skipped.filter((other: string) => other !== name);
      delete probe.probes_failed[name]; probe.probes_run = [...new Set([...probe.probes_run, name])]; probe[name] = record;
    };
    const p6 = (next: unknown) => ({ running_before: 0, abort: { aborted_after_s: 4.01 }, running_after_abort_1s_steps: [1, 0], next_request: next });
    const cases: [string, (probe: Record<string, any>) => void, string[]][] = [
      ["a POST's transport_error", probe => { probe.P5 = { ...probe.P5, status: -1, transport_error: "URLError" }; }, ["P5"]],
      ["a transport_error whatever the status beside it", probe => { probe.P9 = { ...probe.P9, transport_error: "RemoteDisconnected" }; }, ["P9"]],
      ["a stream's exception", probe => { probe.P2.kwargs_low = { error: "URLError", elapsed_s: 0 }; }, ["P2"]],
      ["a GET's -1", probe => { probe.P1.models_status = -1; }, ["P1"]],
      ["the adapter's chat_status -1", probe => { probe.adapter.tokenize.chat_status = -1; }, ["adapter"]],
      ["a cache-layout row's exception", probe => { probe.P11.cache_layouts.layouts.sorted_keys.requests[0].status = "URLError"; }, ["P11"]],
      ["a K burst's transport error", probe => { probe.P11.k_streams["2"].transport_errors = 1; }, ["P11"]],
      ["a P10 stream that ended early", probe => { probe.P10.cells["plan/on"].calls[0].classification = "stream_ended_early"; }, ["P10"]],
      ["a P10 streamed call from before stream_end that ended with no finish reason", probe => {
        Object.assign(probe.P10.cells["plan/on"].calls[0], { finish_reason: null, stream_chunks: 3, classification: "invalid_json" }); }, ["P10"]],
      ["a stream from before stream_end that ended with no finish reason", probe => { probe.P3.prose_no_think.finish_reason = null; }, ["P3"]],
      ["a stream whose connection closed first", probe => { Object.assign(probe.P3.prose_no_think, { finish_reason: null, stream_end: "eof" }); }, ["P3"]],
      ["a K burst from before transport_errors that counts errors", probe => { probe.P11.k_streams["4"].errors = 2; }, ["P11"]],
      ["a P8 that never reached the server", probe => ranToo(probe, "P8", { status: -1, elapsed_s: 0, transport_error: "URLError", completion_tokens: null }), ["P8"]],
      ["P6's next request", probe => ranToo(probe, "P6", p6({ error: "RemoteDisconnected", elapsed_s: 1 })), ["P6"]],
      ["two probes, in the probe order", probe => { probe.adapter.openapi.status = -1; probe.P2.thinking_disabled = { error: "timeout", elapsed_s: 600 }; }, ["P2", "adapter"]],
    ];
    for (const [name, plant, expected] of cases) {
      const { dir } = probeDir(probe => { complete(probe); plant(probe); });
      expect(row(["--probe-dir", dir], "infra_invalid").probe.transportFailures, name).toEqual(expected);
      expect(refused(["--probe-dir", dir], "accepted"), name).toContain(`probe records show a transport failure (${expected.join(", ")})`);
    }
    // P8 measures whether a long request survives, so a cut after it was sent is its finding; P6's abort is recorded as aborted_after_s; a
    // stream's HTTP error, a server's error event, and a burst's errors count beside its transport_errors are not transport failures.
    const measured = probeDir(probe => {
      complete(probe);
      ranToo(probe, "P8", { status: -1, elapsed_s: 120.9, transport_error: "RemoteDisconnected", completion_tokens: null });
      ranToo(probe, "P6", p6(syntheticStream(20, 2, 0.1, 30)));
      probe.P2.kwargs_low = { error: 500, error_bytes: 10, error_sha256: h("a"), elapsed_s: 1 }; Object.assign(probe.P11.k_streams["4"], { errors: 2, transport_errors: 0 });
      Object.assign(probe.P3.prose_no_think, { finish_reason: null, stream_end: "error" });
    });
    expect(row(["--probe-dir", measured.dir], "accepted").probe).toMatchObject({ transportFailures: [], run: expect.arrayContaining(["P6", "P8"]) });
  }, 60_000);

  it("rows the probe's real output against a loopback fake: one model call per chat request the fake received, after the real assessor", () => {
    const result = JSON.parse(execFileSync("python3", ["-I", join(ROOT, "tests", "helpers", "serving-probe-fake.py"), ROOT, join(scratch(), "probe"), researchProtocolSha256()],
      { encoding: "utf8", timeout: 240_000 }));
    expect(result.exit, result.stderr).toBe(0);
    expect(refused(["--probe-dir", result.runDir], "accepted")).toContain("pnpm probe:assess");
    assessProbeFile(join(result.runDir, "probe.json"));
    const line = run(["--probe-dir", result.runDir], "accepted"), probeRow = JSON.parse(line);
    expect(probeRow.modelCalls).toBe(result.received.chat);
    expect(probeRow.probe.calls).toEqual({ P1: 0, P2: 5, P3: 3, P4: 1, P5: 1, P7: 3, P8: 1, P9: 1, P10: 6 + 12, P11: 1 + 4 + 3, adapter: 6 });
    expect(probeRow.probe).toMatchObject({ assessed: true, schemasProtocolMatch: true, failed: {}, finished: true, skipped: ["P6"], transportFailures: [] });
    expect(probeRow.inputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expectAbsent(line, ...(result.leaks as string[]), basename(result.runDir));
  }, 240_000);
});

describe("E0 registry modes: role-fixture runs", () => {
  const ALIAS = "Synthetic-Served-Alias";
  const USAGE = { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 256 } };
  /** A loopback chat-completions fake: each call gets the scripted reply of its ordinal, or a dropped connection. */
  async function fakeServer(script: (ordinal: number) => { status?: number; content?: unknown; finish?: string; drop?: boolean }, usage: Record<string, unknown> = USAGE) {
    let ordinal = 0;
    const server: Server = createServer((request, response) => {
      let data = ""; request.on("data", chunk => { data += chunk; });
      request.on("end", () => {
        const reply = script(++ordinal);
        if (reply.drop) { request.socket.destroy(); return; }
        response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "x", model: ALIAS, choices: [{ index: 0, message: { role: "assistant", ...(reply.content === undefined ? {} : { content: reply.content }), reasoning_content: "hidden thoughts" },
          finish_reason: reply.finish ?? "stop" }], usage }));
      });
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  }

  /** A pinned planner input the way the planner fixture's own test builds one. */
  function plannerInputs() {
    const sources = [{ id: "input/corpus/alpha.md", path: "input/corpus/alpha.md", bytes: Buffer.from("# Synthetic alpha\nThe orchard recorded twelve healthy trees during the autumn survey.\n") },
      { id: "input/corpus/beta.md", path: "input/corpus/beta.md", bytes: Buffer.from("# Synthetic beta\nThe meadow recorded seven healthy trees during the spring survey.\n") }];
    const inventory = inventoryResearchSources(sources);
    const index = Buffer.from(`${canonical({ version: 2, sources: inventory.sources.map(s => assembleIndexEntry(buildLiteralSourceCard({ sourceId: s.id, bytes: sources.find(x => x.id === s.id)!.bytes }), undefined, 0)) })}\n`);
    const brief = Buffer.from("1. Describe the supplied synthetic observations.\n2. Name every conflict between the two surveys.\n");
    const manifest = { schemaVersion: 1, name: "e0-planner-fixture-test-name", status: "pinned", task: "r3-grid-batteries", exposure: "exposed", indexVersion: 2, indexSha256: digest(index),
      briefSha256: digest(brief), sourceIdsSha256: digest(canonical(inventory.sources.map(s => s.id).sort())), sourceCount: 2, mandatorySourceChunks: inventory.chunks.length,
      extractionCallBudget: 40, conditions: [...DEFAULT_CONDITIONS], repeats: 2 };
    return { index, brief, manifest };
  }
  const plan = JSON.stringify({ version: 2, questions: [{ id: "Q1", text: "What do the surveys establish?", requirementIds: ["U1", "U2"], sourceIds: ["input/corpus/alpha.md", "input/corpus/beta.md"],
    lookFor: [] }], conflictsToCheck: [], deliverableNotes: "" });

  /** A judge run of eight synthetic claims, two per label, judged as labelled except C3 (no verdict) and C6 (an error status). */
  async function judgeRun() {
    const passage = "The orchard recorded twelve healthy trees during the autumn survey, and the meadow recorded seven.";
    const claims = ["supported", "supported", "partial", "partial", "unsupported", "unsupported", "contradicted", "contradicted"].map((label, i) => ({ id: `C${i + 1}`, label,
      claim: { id: `C${i + 1}`, sentence: `Synthetic claim sentence number ${i + 1} about the orchard.`, quote: "twelve healthy trees", context: passage } }));
    const claimsBytes = Buffer.from(`${JSON.stringify({ version: 1, task: "r3-grid-batteries", claims: claims.map(item => item.claim) }, null, 1)}\n`);
    const labelsBytes = Buffer.from(`${JSON.stringify({ version: 1, protocol: "e0-judge-labelling-v1", labeller: "openai gpt-6-sol labeller", labels: claims.map(item => ({ id: item.id, label: item.label,
      planted: item.id === "C5", ...(item.id === "C5" ? { note: "PLANTED-NOTE-TEXT" } : {}) })) }, null, 1)}\n`);
    const manifest = { schemaVersion: 1, name: "e0-judge-fixture-test-name", status: "pinned", task: "r3-grid-batteries", exposure: "exposed", promptVersion: ENTAILMENT_PROMPT_VERSION,
      claimsSha256: digest(claimsBytes), labelsSha256: digest(labelsBytes), claimCount: 8, labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, plantedCount: 1,
      minimumPerClass: 2, agreement: { measure: "exact", level: 0.95 }, conditions: ["j1-legacy"], repeats: 1 };
    const baseUrl = await fakeServer(ordinal => ordinal === 3 ? { content: "no verdict here" } : ordinal === 6 ? { status: 500, content: "" }
      : { content: `{"verdict":"${claims[ordinal - 1]!.label}","reason":"synthetic"}` });
    const out = join(scratch(), "judge-run");
    await runJudgeFixture({ endpoint: { baseUrl, model: ALIAS }, inputs: { claims: claimsBytes, labels: labelsBytes, manifest }, out });
    const bytes = readFileSync(join(out, "summary.json"));
    return { out, bytes, summary: JSON.parse(bytes.toString("utf8")), claimsBytes, labelsBytes };
  }

  it("rows a planner run from the summary the fixture wrote: its calls, usage, classes, manifest hashes and request digests, and no alias or path", async () => {
    // Per condition, two repeats: valid and truncated, rejected and valid, a dropped connection and a reply whose content is a parts array,
    // which the model layer rejects (a reply without content reads as empty text, as the model layer reads it). The fixture runs each
    // repeat's conditions in turn, so the script lists repeat 1's three replies, then repeat 2's.
    const baseUrl = await fakeServer(ordinal => [{ content: plan }, { status: 500, content: "" }, { drop: true }, { content: plan.slice(0, 40), finish: "length" }, { content: plan },
      { content: [{ type: "text", text: "parts" }] }][ordinal - 1]!);
    const out = join(scratch(), "e0-planner-fixture-20261115T200000000Z"), inputs = plannerInputs();
    await runPlannerFixture({ endpoint: { baseUrl, model: ALIAS }, inputs, out, repeats: 2, conditions: DEFAULT_CONDITIONS });
    const bytes = readFileSync(join(out, "summary.json")), summary = JSON.parse(bytes.toString("utf8"));
    const line = run(["--fixture-dir", out, "--fixture", "planner"], "accepted"), result = JSON.parse(line);
    // The malformed reply's usage is never read, so the run's tokens and its cache reuse are unknown, not that call's zero.
    expect(result).toMatchObject({ modelCalls: 6, inputTokens: null, outputTokens: null, cachedTokens: null, usd: 0, reservedUsd: 0, pinnedUsd: 0, unknownDispatches: 0,
      cloudCalls: [], disclosedBytes: 0, terminalCause: "fixture_finished", date: summary.startedUtc.slice(0, 10), outcome: "accepted", cloudModel: null, profile: null });
    expect(result.fixture).toEqual({ kind: "planner", finished: true, version: 1, sha256: digest(bytes), conditions: [...DEFAULT_CONDITIONS], repeats: 2, usageMissing: 1, cachedMissing: 1,
      usage: { calls: 3, inputTokens: 3 * 1200, outputTokens: 3 * 80 },
      protocolSha256: researchProtocolSha256(),
      manifest: { indexSha256: inputs.manifest.indexSha256, briefSha256: inputs.manifest.briefSha256, sourceIdsSha256: inputs.manifest.sourceIdsSha256, sourceCount: 2,
        mandatorySourceChunks: inputs.manifest.mandatorySourceChunks, extractionCallBudget: 40 },
      classes: summary.counts });
    expect(result.fixture.classes["flash-thinking"].request_rejected).toBe(1);
    expect(result.fixture.classes["thinking-off"]).toEqual({ malformed_reply: 1, transport_failed: 1 });
    expect(result.inputSha256).toBe(digest(canonical(Object.fromEntries(DEFAULT_CONDITIONS.map(condition => [condition, summary.requests[condition].requestSha256])))));
    expectAbsent(line, ALIAS, "input/corpus", "e0-planner-fixture-test-name", "Describe the supplied", "hidden thoughts", "e0-planner-fixture-2026");
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "accepted", { "--task": "another-task" })).toContain("--task must equal the fixture manifest's task");
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "accepted", { "--exposure": "fresh" })).toContain("--exposure must equal");
    expect(refused(["--fixture-dir", out, "--fixture", "judge"], "accepted")).toContain("judge fixture conditions");
  }, 60_000);

  it("reads a reply without its cached-token detail as unknown reuse, not zero", async () => {
    const baseUrl = await fakeServer(() => ({ content: plan }), { prompt_tokens: 1200, completion_tokens: 80 });
    const out = join(scratch(), "planner-no-details");
    await runPlannerFixture({ endpoint: { baseUrl, model: ALIAS }, inputs: plannerInputs(), out, repeats: 2, conditions: ["thinking-off"] });
    expect(row(["--fixture-dir", out, "--fixture", "planner"], "rejected")).toMatchObject({ inputTokens: 2400, outputTokens: 160, cachedTokens: null,
      fixture: { usageMissing: 0, cachedMissing: 2 } });
  });

  it("refuses a planner summary whose counts disagree with its calls, a class it never writes, and a dry run", async () => {
    const baseUrl = await fakeServer(() => ({ content: plan }));
    const out = join(scratch(), "planner"), inputs = plannerInputs();
    await runPlannerFixture({ endpoint: { baseUrl, model: ALIAS }, inputs, out, repeats: 1, conditions: ["thinking-off"] });
    const path = join(out, "summary.json"), summary = JSON.parse(readFileSync(path, "utf8"));
    const write = (change: (copy: any) => void) => { const copy = structuredClone(summary); change(copy); writeFileSync(path, `${JSON.stringify(copy)}\n`); };
    write(copy => { copy.counts["thinking-off"].valid = 2; });
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "rejected")).toContain("counts do not match");
    write(copy => { copy.calls[0].classification = "email jane doe"; copy.counts = { "thinking-off": { "email jane doe": 1 } }; });
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "rejected")).toContain("classification");
    write(copy => { copy.dryRun = true; });
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "rejected")).toContain("sent its requests");
    write(copy => { copy.manifest.indexSha256 = "/Users/someone/index.json"; });
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "rejected")).toContain("manifest does not record its hashes and counts");
    expect(refused(["--fixture-dir", out], "rejected")).toContain("--fixture-dir and --fixture go together");
  }, 60_000);

  it("rows a judge run with its classes, its own scores and its activation cell, and copies no claim, label, note or alias", async () => {
    const { out, bytes, summary, claimsBytes, labelsBytes } = await judgeRun();
    const line = run(["--fixture-dir", out, "--fixture", "judge"], "rejected"), result = JSON.parse(line);
    expect(result).toMatchObject({ modelCalls: 8, inputTokens: 7 * 1200, outputTokens: 7 * 80, cachedTokens: 7 * 256, usd: 0, disclosedBytes: 0, terminalCause: "fixture_finished" });
    expect(result.fixture).toMatchObject({ kind: "judge", sha256: digest(bytes), conditions: ["j1-legacy"], repeats: 1, usageMissing: 0, cachedMissing: 0, promptVersion: ENTAILMENT_PROMPT_VERSION,
      promptSha256: summary.promptSha256, replyContract: "legacy", activationCondition: "j1-legacy",
      manifest: { sha256: summary.manifest.sha256, claimsSha256: digest(claimsBytes), labelsSha256: digest(labelsBytes), claimCount: 8, plantedCount: 1, minimumPerClass: 2,
        labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, agreement: { measure: "exact", level: 0.95 } },
      classes: { "j1-legacy": { supported: 2, partial: 1, unsupported: 1, contradicted: 2, judge_reply_invalid: 1, request_rejected: 1 } } });
    const metrics = summary.metrics["j1-legacy"].r1;
    expect(result.fixture.scores).toEqual({ "j1-legacy": { r1: { claims: 8, judged: 6, exactCount: metrics.exactCount, establishedCount: metrics.establishedCount, meetsLevel: false } } });
    expect(result.inputSha256).toBe(digest(canonical({ "j1-legacy": summary.requests["j1-legacy"].requestSetSha256 })));
    expectAbsent(line, ALIAS, "Synthetic claim sentence", "orchard", "PLANTED-NOTE", "gpt-6-sol labeller", "e0-judge-fixture-test-name", "no verdict here");
  }, 60_000);

  it("refuses a judge summary whose digests, agreement, counts, scores, activation cell or calls are not the fixture's, and a summary file in another form", async () => {
    const { out, summary } = await judgeRun();
    const path = join(out, "summary.json");
    const write = (text: string) => { rmSync(path, { force: true }); writeFileSync(path, text); };
    const judge = () => refused(["--fixture-dir", out, "--fixture", "judge"], "rejected");
    const cases: [(copy: any) => void, string][] = [
      [copy => { copy.version = true; }, "version 1 summary"],
      [copy => { copy.manifest.claimsSha256 = "/Users/someone/claims.json"; }, "manifest does not record its hashes and counts"],
      [copy => { copy.requests["j1-legacy"].requestSetSha256 = "x"; }, "request digest per condition"],
      [copy => { copy.manifest.agreement = { measure: "exact", level: 1.5 }; }, "agreement measure and level"],
      [copy => { copy.manifest.labelCounts = { supported: 8 }; }, "label counts"],
      [copy => { copy.metrics["j1-legacy"].r1.meetsLevel = "yes"; }, "level check"],
      [copy => { copy.metrics["j1-legacy"] = {}; }, "every condition and repeat"],
      [copy => { copy.replyContract = "flash_next_v1"; copy.activationCondition = "j1-flash"; }, "activation cell"],
      [copy => { copy.calls[0].verdict = "supported"; copy.calls[0].failure = "transport_failed"; }, "verdict and failure"],
      [copy => { copy.calls.pop(); }, "does not record its 8 calls"],
      [copy => { copy.metrics["j1-legacy"].r1.meetsLevel = true; }, "scores are not its calls' and its manifest's"],
      [copy => { copy.metrics["j1-legacy"].r1.claims = 7; }, "scores are not its calls' and its manifest's"],
      [copy => { copy.metrics["j1-legacy"].r1.judged = 8; }, "scores are not its calls' and its manifest's"],
      [copy => { copy.calls[1].claimId = copy.calls[0].claimId; }, "one per condition, repeat and claim"],
    ];
    for (const [change, message] of cases) {
      const copy = structuredClone(summary); change(copy); write(`${JSON.stringify(copy)}\n`);
      expect(judge()).toContain(message);
    }
    write(`﻿${JSON.stringify(summary)}`);
    expect(judge()).toContain("not strict UTF-8 JSON");
    write(JSON.stringify(summary).replace("\"repeats\":1", "\"repeats\":NaN"));
    expect(judge()).toContain("not strict UTF-8 JSON");
    const elsewhere = join(scratch(), "summary.json"); writeFileSync(elsewhere, JSON.stringify(summary)); rmSync(path); symlinkSync(elsewhere, path);
    expect(judge()).toContain("missing or not a regular file");
  }, 60_000);

  it("rows a fixture run that died from its replies listing, dated by the earliest reply, as incomplete or infra_invalid only", () => {
    const out = join(scratch(), "e0-planner-fixture-dead"), replies = join(out, "replies"); mkdirSync(replies, { recursive: true });
    ["legacy-thinking-01.json", "legacy-thinking-02.json", "flash-thinking-01.json"].forEach((name, i) => {
      writeFileSync(join(replies, name), "{\"secret reply\": true}\n");
      const at = Date.UTC(2026, 10, 15, 21, i) / 1000; utimesSync(join(replies, name), at, at);
    });
    const line = run(["--fixture-dir", out, "--fixture", "planner"], "incomplete"), result = JSON.parse(line);
    expect(result).toMatchObject({ modelCalls: 3, date: "2026-11-15", wallSeconds: null, inputSha256: null, inputTokens: null, usd: 0, terminalCause: "fixture_unfinished",
      fixture: { kind: "planner", finished: false, replies: 3 } });
    expectAbsent(line, "legacy-thinking-01", "secret reply");
    expect(row(["--fixture-dir", out, "--fixture", "planner"], "infra_invalid").outcome).toBe("infra_invalid");
    for (const outcome of ["accepted", "rejected"]) expect(refused(["--fixture-dir", out, "--fixture", "planner"], outcome)).toContain("did not finish");
    // The listing must be the fixture's own: the other fixture's names, a stray file or a symbolic link is refused.
    expect(refused(["--fixture-dir", out, "--fixture", "judge"], "incomplete")).toContain("replies/ holds an entry the judge fixture does not write");
    writeFileSync(join(replies, "operator-notes.json"), "{}");
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "incomplete")).toContain("replies/ holds an entry the planner fixture does not write");
    rmSync(join(replies, "operator-notes.json")); symlinkSync(join(replies, "legacy-thinking-01.json"), join(replies, "legacy-thinking-03.json"));
    expect(refused(["--fixture-dir", out, "--fixture", "planner"], "incomplete")).toContain("does not write");
    const judged = join(scratch(), "judge-dead"); mkdirSync(join(judged, "replies"), { recursive: true });
    for (const name of ["j1-legacy-r1-C1.json", "j1-legacy-r1-C2.json"]) writeFileSync(join(judged, "replies", name), "{}");
    expect(row(["--fixture-dir", judged, "--fixture", "judge"], "incomplete")).toMatchObject({ modelCalls: 2, fixture: { kind: "judge", replies: 2 } });
    const empty = join(scratch(), "empty"); mkdirSync(join(empty, "replies"), { recursive: true });
    expect(refused(["--fixture-dir", empty, "--fixture", "judge"], "incomplete")).toContain("nothing dates it");
    expect(refused(["--fixture-dir", scratch(), "--fixture", "judge"], "incomplete")).toContain("neither summary.json nor a replies directory");
  }, 60_000);
});

describe("E0 registry modes: the extractor fixture", () => {
  /** A summary in the shape lane S-pipe's extractor fixture (scripts/extractor-fixture.ts, pull request #116 at 18b062e) writes: three
   * chunks per condition and repeat, rewritten after every call, its usage cut to numeric fields (here without the cached-token detail). */
  const CHUNKS = ["S1C1", "S2C1", "S3C1"].map((chunkId, i) => ({ chunkId, sourceId: `input/corpus/secret-source-${i}.md`, sourceSha256: h(String(i + 1)), bytes: 900,
    userContentBytes: 1400 }));
  const CLASSES: Record<string, string[]> = { "thinking-off": ["complete", "held", "transport_failed"], "thinking-on": ["complete", "needs_followup", "truncated"] };
  function summary(over: Record<string, unknown> = {}): Record<string, any> {
    const conditions = Object.keys(CLASSES);
    let ordinal = 0;
    const calls = conditions.flatMap(condition => CHUNKS.map((chunk, i) => {
      const classification = CLASSES[condition]![i]!, answered = classification !== "transport_failed";
      return { ordinal: ++ordinal, repeat: 1, condition, chunkId: chunk.chunkId, requestSha256: h("d"), requestBytes: 1400, status: answered ? 200 : null, elapsedMs: 900,
        replyFile: answered ? `${condition}-r1-${chunk.chunkId}.json` : null, bodySha256: answered ? h("9") : null, bodyBytes: answered ? 3000 : 0, classification,
        ...(answered ? { finishReason: "stop", contentBytes: 900, usage: { prompt_tokens: 2000, completion_tokens: 300, total_tokens: 2300 } } : { transportError: "TypeError" }),
        reasons: [{ code: "quote_not_found", path: "input/corpus/secret-source-0.md" }] };
    }));
    const counts = Object.fromEntries(conditions.map(condition => [condition, CLASSES[condition]!.reduce<Record<string, number>>((n, c) => ({ ...n, [c]: (n[c] ?? 0) + 1 }), {})]));
    return { version: 1, startedUtc: "2026-11-16T09:00:00.000Z", finishedUtc: "2026-11-16T09:20:00.000Z", model: "Extractor-Served-Alias", dryRun: false, protocolSha256: h("7"),
      requestSettings: { model: "Extractor-Served-Alias", streaming: true, localReplyContract: null, localContextTokens: null, profile: "heavy", cacheSalt: true },
      manifest: { sha256: h("a"), name: "e0-extractor-fixture-secret-name", task: "e0-synthetic-extraction", exposure: "fresh", briefSha256: h("b"), planSha256: h("c"), unitCount: 5, sourceCount: 3 },
      chunks: CHUNKS, conditions, deployedCondition: "thinking-off", repeats: 1, order: "repeat_condition_chunk",
      requests: Object.fromEntries(conditions.map((condition, i) => [condition, { requestSetSha256: h(String(i + 4)), requests: 3, requestBytes: 4200, maxTokens: 4096,
        thinking: condition === "thinking-off" ? "disabled" : "model", streamed: true }])),
      calls, counts, cells: {}, ...over };
  }
  function extractorDir(content: Record<string, unknown>) {
    const dir = join(scratch(), "e0-extractor-fixture-20261116T090000000Z"); mkdirSync(dir);
    writeFileSync(join(dir, "summary.json"), `${JSON.stringify(content, null, 1)}\n`);
    return dir;
  }
  const flags = { "--task": "e0-synthetic-extraction", "--exposure": "fresh" };

  it("rows a finished extractor run: its classes, usage, manifest hashes, protocol and request digests, and no alias, source id or reason", () => {
    const dir = extractorDir(summary());
    const line = run(["--fixture-dir", dir, "--fixture", "extractor"], "accepted", flags), result = JSON.parse(line);
    // The endpoint here reported no cached-token detail, so the cache reuse is unknown.
    expect(result).toMatchObject({ modelCalls: 6, inputTokens: 5 * 2000, outputTokens: 5 * 300, cachedTokens: null, usd: 0, disclosedBytes: 0, terminalCause: "fixture_finished",
      wallSeconds: 1200, date: "2026-11-16" });
    expect(result.fixture).toEqual({ kind: "extractor", finished: true, version: 1, sha256: digest(readFileSync(join(dir, "summary.json"))), conditions: ["thinking-off", "thinking-on"],
      repeats: 1, manifest: { sha256: h("a"), briefSha256: h("b"), planSha256: h("c"), unitCount: 5, sourceCount: 3 }, protocolSha256: h("7"), deployedCondition: "thinking-off",
      usageMissing: 0, cachedMissing: 5, usage: { calls: 5, inputTokens: 5 * 2000, outputTokens: 5 * 300 },
      classes: { "thinking-off": { complete: 1, held: 1, transport_failed: 1 }, "thinking-on": { complete: 1, needs_followup: 1, truncated: 1 } } });
    expect(result.inputSha256).toBe(digest(canonical({ "thinking-off": h("4"), "thinking-on": h("5") })));
    expectAbsent(line, "Extractor-Served-Alias", "secret-source", "S1C1", "e0-extractor-fixture-secret-name", "quote_not_found", "repeat_condition_chunk", "e0-extractor-fixture-2026");
  }, 60_000);

  it("rows an interrupted extractor run from the calls it made, as incomplete or infra_invalid only, and refuses what the extractor never writes", () => {
    const interrupted = summary({ finishedUtc: undefined });
    interrupted.calls = interrupted.calls.slice(0, 4);
    interrupted.counts = { "thinking-off": { complete: 1, held: 1, transport_failed: 1 }, "thinking-on": { complete: 1 } };
    const dir = extractorDir(interrupted);
    expect(row(["--fixture-dir", dir, "--fixture", "extractor"], "incomplete", flags)).toMatchObject({ modelCalls: 4, inputTokens: 3 * 2000, wallSeconds: null,
      terminalCause: "fixture_unfinished", fixture: { finished: false } });
    expect(refused(["--fixture-dir", dir, "--fixture", "extractor"], "accepted", flags)).toContain("did not finish");
    const odd = summary(); odd.calls[0].classification = "email jane doe"; odd.counts["thinking-off"] = { "email jane doe": 1, held: 1, transport_failed: 1 };
    const cases: [Record<string, any>, string][] = [
      [summary({ calls: summary().calls.slice(0, 5) }), "does not record its 6 calls"],
      [summary({ finishedUtc: undefined, calls: [...summary().calls, summary().calls[0]] }), "does not record its 6 calls"],
      [summary({ protocolSha256: "/Users/someone/protocol" }), "research protocol hash"],
      [summary({ chunks: [] }), "does not record its chunks"],
      [summary({ conditions: ["thinking-off", "thinking-max"] }), "extractor fixture conditions"],
      [summary({ deployedCondition: "thinking-max" }), "deployed condition"],
      [summary({ counts: { "thinking-off": { complete: 3 }, "thinking-on": { complete: 3 } } }), "counts do not match"],
      // Every call moved into one condition keeps the total but not the cells.
      [summary({ calls: summary().calls.map((call: Record<string, unknown>) => ({ ...call, condition: "thinking-off" })) }), "one per condition, repeat and chunk"],
      [summary({ manifest: { ...summary().manifest, sourceCount: 4 } }), "one named chunk per manifest source"],
      // Each count is in range, but their sum is not.
      [summary({ calls: summary().calls.map((call: Record<string, any>) => call.usage ? { ...call, usage: { ...call.usage, prompt_tokens: 2 ** 53 - 1 } } : call) }),
        "leaves the range a row records exactly"],
      [odd, "classification is not one the extractor fixture writes"],
    ];
    for (const [content, message] of cases) expect(refused(["--fixture-dir", extractorDir(content), "--fixture", "extractor"], "rejected", flags)).toContain(message);
    expect(refused(["--fixture-dir", scratch(), "--fixture", "extractor"], "incomplete", flags)).toContain("writes summary.json before its first request");
  }, 60_000);
});

describe("E0 registry modes: the labelling call", () => {
  const noTokens = { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheWriteReported: false };
  const call = (over: Record<string, unknown>) => ({ call: 1, kind: "label_and_plant", httpStatus: 200, state: "settled", failure: null, projectedUsd: 0.62, usd: 0.31, countedUsd: 0.31,
    maxOutputTokens: 32000, bodyBytes: 48210, bodySha256: h("a"), inputTokens: 12000, cachedTokens: 1024, cacheWriteTokens: 0, outputTokens: 9000, reasoningTokens: 4000,
    cacheWriteReported: true, elapsedMs: 95000, servedModel: "gpt-6-sol-2026-10-01", requestId: "req_abc123", errorType: null, errorCode: null, ...over });
  const claims = { harvested: 40, planted: 8, minimumPerClass: 10, labelCounts: { supported: 20, partial: 10, unsupported: 10, contradicted: 8 }, belowMinimum: null,
    plantedRejected: { duplicate: 1 }, notesShortened: 2, inputSha256: h("b"), claimsSha256: h("c"), labelsSha256: h("d") };
  const unlabelled = { ...claims, planted: 0, labelCounts: null, claimsSha256: null, labelsSha256: null };
  const prices = { input: 1.25, cached: 0.125, write: 1.25, output: 10, longContext: { aboveTokens: 272000, input: 2.5, cached: 0.25, write: 2.5, output: 15 } };
  /** A summary in the exact shape lane S-e1's labelling tool (`pnpm label:judge`) writes; its totals are its calls' sums unless `over` changes them. */
  function summaryFile(calls: Record<string, any>[] = [call({})], over: Record<string, unknown> = {}) {
    const sum = (key: string) => calls.reduce((n, item) => n + item[key], 0);
    const usd = (items: Record<string, any>[], key: string) => Math.round(items.reduce((n, item) => n + (item[key] ?? 0), 0) * 1e6) / 1e6;
    const state = (...names: string[]) => calls.filter(item => names.includes(item.state));
    const summary = { version: 1, kind: "e0_judge_labelling", protocol: "e0-judge-labelling-v1", labeller: "openai/gpt-6-sol", cloudModel: "gpt-6-sol", cloudApi: "openai_responses",
      servedModel: "gpt-6-sol-2026-10-01", envelopeLine: "synthetic_data", run: "labelling-20261116T100000Z", startedUtc: "2026-11-16T10:00:00.000Z", finishedUtc: "2026-11-16T10:02:30.000Z",
      outcome: "labelled", failure: null, secondRequest: null, modelCalls: calls.length, rejectedDispatches: state("rejected", "not_sent").length,
      unknownDispatches: state("unknown", "outside_projection").length, inputTokens: sum("inputTokens"), cachedTokens: sum("cachedTokens"), cacheWriteTokens: sum("cacheWriteTokens"),
      outputTokens: sum("outputTokens"), reasoningTokens: sum("reasoningTokens"), usd: usd(calls, "usd"), reservedUnknownUsd: usd(state("unknown", "outside_projection"), "countedUsd"),
      priorCountedUsd: 0, capUsd: 1, instructionsSha256: h("e"), prices, calls, claims, ...over };
    const path = join(scratch(), "summary.json"); writeFileSync(path, `${JSON.stringify(summary, null, 1)}\n`);
    return { path, bytes: readFileSync(path) };
  }
  const failed = (failure: string, over: Record<string, unknown> = {}) => ({ outcome: "failed", failure, claims: unlabelled, ...over });

  /** Two summaries that lane S-e1's labelling tool wrote against its loopback fake (its commit 7a757ba), checked there by LabellingSummarySchema. */
  const TOOL_LABELLED = {"version":1,"kind":"e0_judge_labelling","protocol":"e0-judge-labelling-v1","labeller":"openai/gpt-6-sol","cloudModel":"gpt-6-sol","cloudApi":"openai_responses","servedModel":"gpt-6-sol-2026-09-22","envelopeLine":"synthetic_data","run":"labelling-2026-11-15T202351214Z","startedUtc":"2026-11-15T20:23:51.214Z","finishedUtc":"2026-11-15T20:23:51.304Z","outcome":"labelled","failure":null,"secondRequest":"sent","modelCalls":2,"rejectedDispatches":0,"unknownDispatches":0,"inputTokens":2286,"cachedTokens":0,"cacheWriteTokens":2280,"outputTokens":2400,"reasoningTokens":1600,"usd":0.029713,"reservedUnknownUsd":0,"priorCountedUsd":0,"capUsd":1,"instructionsSha256":"0184b561b5cee866c56fcda7321095a719a522d529b5a46158856d6fa2d3f9d2","prices":{"input":2,"cached":0.2,"write":2.5,"output":10,"longContext":{"aboveTokens":272000,"input":4,"cached":0.4,"write":5,"output":15}},"calls":[{"call":1,"kind":"label_and_plant","httpStatus":200,"state":"settled","failure":null,"projectedUsd":0.202648,"usd":0.014979,"countedUsd":0.014979,"maxOutputTokens":19072,"bodyBytes":4771,"bodySha256":"a2e1c9d2901eeddfb57396c32ab9b8d62308146395116739f264eb834f6d557b","inputTokens":1192,"cachedTokens":0,"cacheWriteTokens":1189,"outputTokens":1200,"reasoningTokens":800,"cacheWriteReported":true,"elapsedMs":6,"servedModel":"gpt-6-sol-2026-09-22","requestId":"req_example_1","errorType":null,"errorCode":null},{"call":2,"kind":"plant_only","httpStatus":200,"state":"settled","failure":null,"projectedUsd":0.182463,"usd":0.014734,"countedUsd":0.014734,"maxOutputTokens":17152,"bodyBytes":4377,"bodySha256":"6e2833d5284a4f328438928ae93c8f8119e94cbc6888e2c5208417766b9188d5","inputTokens":1094,"cachedTokens":0,"cacheWriteTokens":1091,"outputTokens":1200,"reasoningTokens":800,"cacheWriteReported":true,"elapsedMs":4,"servedModel":"gpt-6-sol-2026-09-22","requestId":"req_example_2","errorType":null,"errorCode":null}],"claims":{"harvested":4,"planted":4,"minimumPerClass":2,"labelCounts":{"supported":2,"partial":2,"unsupported":2,"contradicted":2},"belowMinimum":null,"plantedRejected":{},"notesShortened":0,"inputSha256":"f65149d26f509fda3e3a7cef5041864c98aeaffd5fe407bc381d793bb4834308","claimsSha256":"a05fee0a742216cc8dd0eea8cd23149829fe647c7ae74c2a9cdd236f853d2378","labelsSha256":"f3f83b8e09091d9d6119d3ccc52cfab0ad60a39ff36dfd5fe37872978ef0f679"}} as const;
  const TOOL_REJECTED = {"version":1,"kind":"e0_judge_labelling","protocol":"e0-judge-labelling-v1","labeller":"openai/gpt-6-sol","cloudModel":"gpt-6-sol","cloudApi":"openai_responses","servedModel":null,"envelopeLine":"synthetic_data","run":"labelling-2026-11-15T202351317Z","startedUtc":"2026-11-15T20:23:51.317Z","finishedUtc":"2026-11-15T20:23:51.350Z","outcome":"failed","failure":"labeller_rejected","secondRequest":null,"modelCalls":1,"rejectedDispatches":1,"unknownDispatches":0,"inputTokens":0,"cachedTokens":0,"cacheWriteTokens":0,"outputTokens":0,"reasoningTokens":0,"usd":0,"reservedUnknownUsd":0,"priorCountedUsd":0,"capUsd":1,"instructionsSha256":"0184b561b5cee866c56fcda7321095a719a522d529b5a46158856d6fa2d3f9d2","prices":{"input":2,"cached":0.2,"write":2.5,"output":10,"longContext":{"aboveTokens":272000,"input":4,"cached":0.4,"write":5,"output":15}},"calls":[{"call":1,"kind":"label_and_plant","httpStatus":401,"state":"rejected","failure":"labeller_rejected","projectedUsd":0.202648,"usd":0,"countedUsd":0,"maxOutputTokens":19072,"bodyBytes":4771,"bodySha256":"a2e1c9d2901eeddfb57396c32ab9b8d62308146395116739f264eb834f6d557b","inputTokens":0,"cachedTokens":0,"cacheWriteTokens":0,"outputTokens":0,"reasoningTokens":0,"cacheWriteReported":false,"elapsedMs":2,"servedModel":null,"requestId":"req_example_1","errorType":"invalid_request_error","errorCode":"invalid_api_key"}],"claims":{"harvested":4,"planted":0,"minimumPerClass":2,"labelCounts":null,"belowMinimum":null,"plantedRejected":{},"notesShortened":0,"inputSha256":"f65149d26f509fda3e3a7cef5041864c98aeaffd5fe407bc381d793bb4834308","claimsSha256":null,"labelsSha256":null}} as const;
  function toolFile(summary: unknown) { const path = join(scratch(), "summary.json"); writeFileSync(path, `${JSON.stringify(summary, null, 1)}\n`); return path; }

  it("rows the summaries the labelling tool itself wrote: a labelled run and a rejected one", () => {
    const line = run(["--labelling-file", toolFile(TOOL_LABELLED)], "accepted", { "--arm": "cloud-gpt-6-sol" }), labelled = JSON.parse(line);
    expect(labelled).toMatchObject({ date: "2026-11-15", inputSha256: TOOL_LABELLED.claims.inputSha256, cloudModel: "gpt-6-sol", cloudApi: "openai_responses", modelCalls: 2,
      failedDispatches: 0, unknownDispatches: 0, inputTokens: 2286, outputTokens: 2400, cachedTokens: 0, cacheWriteTokens: 2280, usd: 0.029713, reservedUsd: 0.202648 + 0.182463,
      pinnedUsd: 0, disclosedBytes: 4771 + 4377, terminalCause: "labelled", labelling: { outcome: "labelled", secondRequest: "sent", reasoningTokens: 1600, cacheWriteAssumed: 0,
        claims: { labelsSha256: TOOL_LABELLED.claims.labelsSha256, planted: 4 } },
      cloudCalls: [{ purpose: "label_and_plant", status: "settled", feeUsd: 0.014979, reservedUsd: 0.202648, bodyBytes: 4771 },
        { purpose: "plant_only", status: "settled", feeUsd: 0.014734, reservedUsd: 0.182463, bodyBytes: 4377 }] });
    expectAbsent(line, "openai/gpt-6-sol", "gpt-6-sol-2026-09-22", "req_example", TOOL_LABELLED.run);
    const rejectedLine = run(["--labelling-file", toolFile(TOOL_REJECTED)], "infra_invalid");
    expect(JSON.parse(rejectedLine)).toMatchObject({ modelCalls: 1, failedDispatches: 1, usd: 0, pinnedUsd: 0, disclosedBytes: 4771, terminalCause: "labeller_rejected",
      cloudCalls: [{ status: "failed", feeUsd: null }] });
    expectAbsent(rejectedLine, "invalid_api_key", "invalid_request_error");
    expect(refused(["--labelling-file", toolFile(TOOL_REJECTED)], "accepted")).toContain("the labelling ended failed, not labelled");
  });

  it("rows a labelled call with its fee, reservation, tokens, cloud call, disclosed bytes, envelope line and prices, and none of the provider's strings", () => {
    const { path, bytes } = summaryFile([call({ cacheWriteReported: false, cacheWriteTokens: 10976 })]);
    const line = run(["--labelling-file", path], "accepted", { "--arm": "cloud-gpt-6-sol" }), result = JSON.parse(line);
    expect(result).toMatchObject({ date: "2026-11-16", wallSeconds: 150, inputSha256: h("b"), cloudModel: "gpt-6-sol", cloudApi: "openai_responses", modelCalls: 1, failedDispatches: 0,
      unknownDispatches: 0, inputTokens: 12000, outputTokens: 9000, cachedTokens: 1024, cacheWriteTokens: null, usd: 0.31, reservedUsd: 0.62, pinnedUsd: 0,
      cloudCalls: [{ purpose: "label_and_plant", status: "settled", feeUsd: 0.31, reservedUsd: 0.62, bodyBytes: 48210 }], disclosedBytes: 48210, terminalCause: "labelled", profile: null,
      outcome: "accepted", gitSource: "row_written" });
    expect(result.labelling).toEqual({ version: 1, sha256: digest(bytes), outcome: "labelled", failure: null, secondRequest: null, envelopeLine: "synthetic_data", capUsd: 1,
      priorCountedUsd: 0, instructionsSha256: h("e"), prices, reasoningTokens: 4000, cacheWriteAssumed: 1,
      claims: { harvested: 40, planted: 8, minimumPerClass: 10, labelCounts: claims.labelCounts, belowMinimum: null, plantedRejected: { duplicate: 1 }, notesShortened: 2,
        claimsSha256: h("c"), labelsSha256: h("d") } });
    expectAbsent(line, "openai/gpt-6-sol", "gpt-6-sol-2026-10-01", "req_abc123", "labelling-20261116T100000Z");
  });

  it("counts each call state as the tool defines it, pins what the cap counts, discloses nothing unsent, and refuses accepted unless labelled", () => {
    // The second request timed out after the first settled.
    const timedOut = summaryFile([call({}), call({ call: 2, kind: "plant_only", httpStatus: null, state: "unknown", failure: "labeller_timeout", projectedUsd: 0.2, usd: null,
      countedUsd: 0.2, bodyBytes: 900, bodySha256: h("f"), ...noTokens, servedModel: null, requestId: null })], failed("labeller_timeout", { secondRequest: "sent", finishedUtc: null }));
    expect(row(["--labelling-file", timedOut.path], "incomplete")).toMatchObject({ modelCalls: 2, failedDispatches: 0, unknownDispatches: 1, usd: 0.31, reservedUsd: 0.82, pinnedUsd: 0.2,
      disclosedBytes: 48210 + 900, wallSeconds: null, terminalCause: "labeller_timeout", labelling: { outcome: "failed", secondRequest: "sent", claims: { labelsSha256: null } },
      cloudCalls: [{ status: "settled" }, { purpose: "plant_only", status: "unknown", feeUsd: null, reservedUsd: 0.2 }] });
    expect(refused(["--labelling-file", timedOut.path], "accepted")).toContain("the labelling ended failed, not labelled");
    // A rejected request was received, so its body counts; a request whose connection never completed disclosed nothing.
    const rejected = call({ httpStatus: 400, state: "rejected", failure: "labeller_rejected", usd: 0, countedUsd: 0, ...noTokens, errorType: "invalid_request_error",
      errorCode: "context_length_exceeded" });
    const rejectedLine = run(["--labelling-file", summaryFile([rejected], failed("labeller_rejected")).path], "rejected");
    expect(JSON.parse(rejectedLine)).toMatchObject({ failedDispatches: 1, usd: 0, pinnedUsd: 0, disclosedBytes: 48210, cloudCalls: [{ status: "failed", feeUsd: null }] });
    expectAbsent(rejectedLine, "invalid_request_error", "context_length_exceeded");
    const unsent = call({ httpStatus: null, state: "not_sent", failure: "labeller_transport_failed", usd: 0, countedUsd: 0, ...noTokens });
    expect(row(["--labelling-file", summaryFile([unsent], failed("labeller_transport_failed")).path], "infra_invalid")).toMatchObject({ failedDispatches: 1, disclosedBytes: 0 });
    // A reply outside the projection is counted at no less than its reservation, and its tokens are kept.
    const outside = call({ state: "outside_projection", failure: "labeller_usage_outside_projection", usd: null, countedUsd: 0.8 });
    expect(row(["--labelling-file", summaryFile([outside], failed("labeller_usage_outside_projection")).path], "rejected")).toMatchObject({ unknownDispatches: 1, usd: 0, pinnedUsd: 0.8,
      inputTokens: 12000, cloudCalls: [{ status: "unknown", feeUsd: null }] });
    // HARN-27 counts a body once, even if the same body were resent.
    const resent = summaryFile([rejected, call({ call: 2, kind: "plant_only" })], failed("labeller_rejected", { outcome: "labelled", failure: null, claims }));
    expect(row(["--labelling-file", resent.path], "accepted").disclosedBytes).toBe(48210);
    expect(refused(["--labelling-file", summaryFile(undefined, { outcome: "labelled_below_minimum", claims: { ...claims, belowMinimum: { contradicted: 2 } } }).path], "accepted"))
      .toContain("ended labelled_below_minimum");
  }, 60_000);

  it("refuses a summary while its labelling run holds the lock, and records no wall time for an interim summary", () => {
    // The tool's layout: .soar/experiments/e0-judge/labelling-<time>/summary.json, with labelling.lock beside the run directories while a run is alive.
    const root = scratch(), runDir = join(root, "labelling-2026-11-16T100000000Z"); mkdirSync(runDir);
    const interim = summaryFile([call({ httpStatus: null, state: "unknown", failure: "labeller_interrupted", usd: null, countedUsd: 0.62, ...noTokens })],
      failed("labeller_interrupted", { finishedUtc: "2026-11-16T10:00:05.000Z" }));
    const path = join(runDir, "summary.json"); writeFileSync(path, readFileSync(interim.path));
    writeFileSync(join(root, "labelling.lock"), "");
    expect(refused(["--labelling-file", path], "incomplete")).toContain("holds labelling.lock");
    rmSync(join(root, "labelling.lock"));
    expect(row(["--labelling-file", path], "incomplete")).toMatchObject({ wallSeconds: null, terminalCause: "labeller_interrupted", unknownDispatches: 1, pinnedUsd: 0.62,
      cloudCalls: [{ status: "unknown", feeUsd: null }] });
  }, 60_000);

  it("refuses any other key, free text where a code or model id belongs, totals that are not its calls' sums, and calls that break the tool's rules", () => {
    const cases: [Record<string, any>[] | undefined, Record<string, unknown>, string][] = [
      [undefined, { note: "the labeller's free text" }, "exactly the labelling summary's keys"],
      [undefined, { protocol: "e0-judge-labelling-v2" }, "version 1 e0_judge_labelling summary"],
      [undefined, { cloudModel: "gpt 6 sol on https://api.example" }, "approved labelling model"],
      [undefined, { cloudModel: "192.168.1.20" }, "approved labelling model"],
      [undefined, { cloudModel: "example-private-labeller" }, "approved labelling model"],
      [undefined, { cloudApi: "responses" }, "cloudApi is not a request shape"],
      [undefined, { version: true }, "version 1 e0_judge_labelling summary"],
      [undefined, { finishedUtc: null }, "a labelled outcome records when the tool finished"],
      [undefined, { labeller: "x".repeat(201) }, "labeller, run or servedModel"],
      [undefined, { run: null }, "labeller, run or servedModel"],
      [undefined, { outcome: "refused" }, "outcome, failure or second request"],
      [undefined, { failure: "labeller_email_jane_doe" }, "outcome, failure or second request"],
      [undefined, { secondRequest: "maybe" }, "outcome, failure or second request"],
      [undefined, { envelopeLine: "phase4_harness" }, "envelope line, instructions digest"],
      [undefined, { instructionsSha256: "steps 2 and 3" }, "envelope line, instructions digest"],
      [undefined, { prices: { ...prices, longContext: undefined } }, "prices are not its rates"],
      [undefined, { modelCalls: 2 }, "totals are not the sums of its calls"],
      [undefined, { usd: 0.5 }, "totals are not the sums of its calls"],
      [undefined, { reservedUnknownUsd: 0.2 }, "totals are not the sums of its calls"],
      [[call({ usd: null })], {}, "the settled call's usd, countedUsd, status or tokens break"],
      [[call({ countedUsd: 0.62 })], {}, "the settled call's usd, countedUsd, status or tokens break"],
      [[call({ state: "unknown", usd: null, countedUsd: 0.1 })], {}, "the unknown call's usd, countedUsd, status or tokens break"],
      [[call({ state: "rejected", usd: 0, countedUsd: 0 })], {}, "the rejected call's usd, countedUsd, status or tokens break"],
      // Zero is claimed only for a status the provider does not bill (the tool's UNBILLED_STATUSES) and for a request that never left.
      [[call({ httpStatus: 500, state: "rejected", usd: 0, countedUsd: 0, ...noTokens })], {}, "the rejected call's usd, countedUsd, status or tokens break"],
      [[call({ httpStatus: 503, state: "not_sent", usd: 0, countedUsd: 0, ...noTokens })], {}, "the not_sent call's usd, countedUsd, status or tokens break"],
      [[{ ...call({}), url: "https://api.openai.com/v1/responses" }], {}, "exactly the summary's call keys"],
      [[call({ call: 2 })], {}, "a call's number"],
      [[call({ call: true })], {}, "a call's number"],
      // No count or amount can carry a long value: counts stay within 2^53 - 1 and amounts within USD 1,000,000.
      [[call({ bodyBytes: 2 ** 60 })], {}, "a call's number, kind, state, codes"],
      [[call({ usd: 1e308, countedUsd: 1e308 })], {}, "amounts or counts"],
      [[call({ errorCode: "Context Length Exceeded for jane@example.com" })], {}, "a call's number, kind, state, codes"],
      [[call({ failure: "labeller_reply_was: the passage says" })], {}, "a call's number, kind, state, codes"],
      [[call({}), call({ call: 2, kind: "plant_only", bodyBytes: 7 })], {}, "one body digest with different sizes"],
      // The tool's own schema rules (LabellingSummarySchema): call order and count, a reply answered 200, a fee within its projection, no boolean for a
      // number, nothing reported for a call without a reply, and an outcome that agrees with its failure and with what was written.
      [[call({}), call({ call: 2 })], {}, "a call's number, kind"],
      [[call({}), call({ call: 2, kind: "plant_only" }), call({ call: 3, kind: "plant_only" })], {}, "at most two"],
      [[call({ state: ["settled"] })], {}, "a call's number, kind, state"],
      [[call({ httpStatus: 201 })], {}, "the settled call's usd, countedUsd, status or tokens break"],
      [[call({ usd: 0.7, countedUsd: 0.7 })], {}, "the settled call's usd, countedUsd, status or tokens break"],
      [[call({ httpStatus: 400, state: "rejected", usd: false, countedUsd: 0, ...noTokens })], { usd: 0 }, "the rejected call's usd, countedUsd, status or tokens break"],
      [[call({ httpStatus: 504, state: "outside_projection", usd: null, countedUsd: 0.8 })], {}, "the outside_projection call's usd, countedUsd, status or tokens break"],
      [[call({ httpStatus: null, state: "unknown", usd: null, countedUsd: 0.62, ...noTokens, cacheWriteReported: true })], {}, "the unknown call's usd, countedUsd, status or tokens break"],
      [undefined, { claims: { ...claims, labelsSha256: null } }, "outcome, failure and written files do not agree"],
      [undefined, { claims: { ...claims, belowMinimum: { contradicted: 2 } } }, "outcome, failure and written files do not agree"],
      [undefined, { failure: "labeller_reply_invalid" }, "outcome, failure and written files do not agree"],
      [undefined, { outcome: "failed", claims: unlabelled }, "outcome, failure and written files do not agree"],
      [undefined, { outcome: "failed", failure: "labeller_reply_invalid" }, "outcome, failure and written files do not agree"],
      [undefined, { cloudApi: "openai" }, "cloudApi is not a request shape"],
      [undefined, { claims: { ...claims, plantedRejected: { made_up_reason: 1 } } }, "claims do not hold exactly"],
      [undefined, { claims: { ...claims, inputSha256: "input/claims.json" } }, "claims do not hold exactly"],
    ];
    for (const [calls, over, message] of cases) expect(refused(["--labelling-file", summaryFile(calls, over).path], "rejected")).toContain(message);
  }, 60_000);
});

describe("E0 registry modes: corrections and source rules", () => {
  it("supersedes an E0 row like any other and repeats its outcome refusals against the copy", () => {
    const registry = join(scratch(), "registry.jsonl");
    const probe = syntheticProbe(); delete probe.finished_utc; probe.probes_failed = {}; probe.probes_run.push("P6"); probe.P6 = { abort: { aborted_after_s: 4 }, next_request: { status: 200 } };
    const dir = join(scratch(), "probe"); mkdirSync(dir); writeFileSync(join(dir, "probe.json"), JSON.stringify(probe));
    appendFileSync(registry, run(["--probe-dir", dir], "incomplete", { "--id": "e0-probe-1" }));
    const args = ["--supersedes", "e0-probe-1", "--registry", registry];
    const supersede = (outcome: string) => execFileSync("python3", ["-I", SCRIPT, ...args, "--id", "e0-probe-1b", "--outcome", outcome, "--verdict-by", "agent_diagnostic", "--lesson", "l2"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(() => supersede("accepted")).toThrow(/did not finish/u);
    expect(JSON.parse(supersede("infra_invalid"))).toMatchObject({ id: "e0-probe-1b", supersedes: "e0-probe-1", outcome: "infra_invalid", terminalCause: "probe_unfinished", probe: { finished: false } });
    expect(refused(["--probe-dir", dir, "--labelling-file", registry], "incomplete")).toContain("give exactly one of");
  }, 60_000);
});

/**
 * Pinned to the labelling tool (scripts/judge-labeller.ts, pull request #115), which merged before this mode: its exported closed sets
 * and the keys of its summary schema equal the writer's mirrors, and the summaries the real tool writes against a loopback fake of the
 * Responses endpoint are rowed with every field the summary determines.
 */
describe("E0 registry modes: pinned to the labelling tool", () => {
  it("mirrors the tool's closed sets, its summary schema's keys, its model, its interface and its lock name exactly", () => {
    const python = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('registry_row', sys.argv[1]); row = importlib.util.module_from_spec(spec); spec.loader.exec_module(row)",
      "print(json.dumps({'outcomes': list(row.LABELLING_OUTCOMES), 'kinds': list(row.LABELLING_CALL_KINDS), 'states': list(row.LABELLING_STATES),",
      "  'second': list(row.LABELLING_SECOND_REQUESTS), 'plant': list(row.LABELLING_PLANT_REJECTIONS), 'failures': list(row.LABELLING_FAILURES),",
      "  'lines': list(row.ENVELOPE_LINES), 'models': list(row.LABELLING_MODELS), 'apis': list(row.LABELLING_APIS), 'unbilled': list(row.LABELLING_UNBILLED_STATUSES),",
      "  'tokens': list(row.LABELLING_TOKENS), 'verdicts': list(row.JUDGE_VERDICTS), 'lock': row.LABELLING_LOCK, 'keys': sorted(row.LABELLING_KEYS),",
      "  'callKeys': sorted(row.LABELLING_CALL_KEYS), 'claimsKeys': sorted(row.LABELLING_CLAIMS_KEYS), 'priceKeys': list(row.LABELLING_PRICE_KEYS)}))"].join("\n");
    const mirrored = JSON.parse(execFileSync("python3", ["-I", "-c", python, SCRIPT], { encoding: "utf8" }));
    const summary = LabellingSummarySchema.shape, claims = summary.claims.shape, prices = summary.prices.shape, sorted = (shape: object) => Object.keys(shape).sort();
    expect(mirrored).toEqual({ outcomes: [...LABELLING_OUTCOMES], kinds: [...CALL_KINDS], states: [...CALL_STATES], second: [...SECOND_REQUEST_VALUES], plant: [...PLANT_REJECTIONS],
      failures: [...LABELLING_FAILURES], lines: [ENVELOPE_LINE], models: [LABELLER_MODEL], apis: [...summary.cloudApi.values], unbilled: [...UNBILLED_STATUSES],
      tokens: [...TOKEN_FIELDS], verdicts: Object.keys(claims.labelCounts.unwrap().shape), lock: LOCK_NAME, keys: sorted(summary), callKeys: sorted(CallRecordSchema.shape),
      claimsKeys: sorted(claims), priceKeys: Object.keys(prices).filter(key => key !== "longContext") });
    expect(sorted(prices)).toEqual([...mirrored.priceKeys, "longContext"].sort());
    expect(sorted(prices.longContext.shape)).toEqual([...mirrored.priceKeys, "aboveTokens"].sort());
    expect([Object.keys(claims.belowMinimum.unwrap().shape), Object.keys(claims.plantedRejected.shape)]).toEqual([mirrored.verdicts, mirrored.plant]);
  });

  const PROTOCOL_TEXT = readFileSync(join(ROOT, "docs", "experiments", "E0_JUDGE_LABELLING_PROTOCOL.md"), "utf8");
  const PASSAGE = "The orchard recorded twelve healthy trees during the autumn survey, and the meadow recorded seven.";
  /** Six synthetic claims, harvested into a fresh e0-judge directory (or a folder below it) the way the harvest writes them. */
  function harvestedSet(below = false) {
    const root = join(scratch(), ".soar", "experiments", "e0-judge"), directory = below ? join(root, "set-a") : root;
    mkdirSync(directory, { recursive: true });
    const claims = ["C1", "C2", "C3", "C4", "C5", "C6"].map((id, index) => ({ id, sentence: `Synthetic sentence ${index + 1} about the orchard and the meadow.`,
      quote: "twelve healthy trees", context: PASSAGE }));
    writeFileSync(join(directory, "claims.json"), `${JSON.stringify({ version: 1, task: "r3-grid-batteries", claims }, null, 1)}\n`, { mode: 0o600 });
    writeFileSync(join(directory, "claims.origin.json"), `${JSON.stringify({ version: 1, task: "r3-grid-batteries",
      origins: claims.map(claim => ({ id: claim.id, run: "SIDECAR-RUN", claimId: claim.id })) }, null, 1)}\n`, { mode: 0o600 });
    return { root, directory, claimsPath: join(directory, "claims.json") };
  }
  type Step = (body: string) => { status: number; body: unknown } | "never";
  /** A loopback fake of the Responses endpoint that answers each request from a script, in order. */
  async function responsesFake(script: Step[]) {
    let count = 0;
    const server: Server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(chunk as Buffer));
      request.on("end", () => {
        const step = script[count++]?.(Buffer.concat(chunks).toString("utf8"));
        if (step === undefined || step === "never") return;
        response.on("error", () => undefined);
        response.writeHead(step.status, { "content-type": "application/json", "x-request-id": `req_fake_${count}` });
        response.end(JSON.stringify(step.body));
      });
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/responses`;
  }
  // Two labels per class, and two planted contradictions, so one request meets the minimum of two.
  const LABELS = [{ id: "C1", label: "supported", note: null }, { id: "C2", label: "supported", note: null }, { id: "C3", label: "partial", note: "REPLY-NOTE-TEXT" },
    { id: "C4", label: "partial", note: null }, { id: "C5", label: "unsupported", note: null }, { id: "C6", label: "unsupported", note: null }];
  const PLANTED = [{ sourceId: "C1", label: "contradicted", sentence: "The orchard recorded no healthy trees.", note: "PLANTED-NOTE-1 negates it." },
    { sourceId: "C2", label: "contradicted", sentence: "The meadow recorded twelve healthy trees and the orchard seven.", note: "PLANTED-NOTE-2 swaps the numbers." }];
  const answered: Step = body => ({ status: 200, body: { id: "resp_fake", object: "response", model: "gpt-6-sol-2026-09-22", status: "completed", service_tier: "default",
    output: [{ type: "message", id: "msg_fake", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ labels: LABELS, planted: PLANTED }),
      annotations: [] }] }],
    usage: { input_tokens: Math.floor(Buffer.byteLength(body) / 4), input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 1500,
      output_tokens_details: { reasoning_tokens: 900 } } } });
  const rejectedStep: Step = () => ({ status: 400, body: { error: { type: "invalid_request_error", code: "context_length_exceeded", message: "REJECTED-MESSAGE-TEXT" } } });
  /** The real tool's run, and the summary it wrote. */
  async function label(set: ReturnType<typeof harvestedSet>, endpoint: string, timeoutMs = 60_000) {
    let tick = 0;
    await runLabelling({ claimsPath: set.claimsPath, root: set.root, minimumPerClass: 2, protocolText: PROTOCOL_TEXT, apiKey: "test-labeller-key", endpoint, timeoutMs,
      now: () => new Date(Date.UTC(2026, 10, 15, 20, 0, 0, tick++)) });
    const run = readdirSync(set.directory).find(name => name.startsWith("labelling-"))!, path = join(set.directory, run, "summary.json");
    return { run, path, summary: JSON.parse(readFileSync(path, "utf8")) as LabellingSummary };
  }
  /** Every row field a summary determines, computed here from that summary. */
  function determined(summary: LabellingSummary) {
    const states = { settled: "settled", rejected: "failed", not_sent: "failed", unknown: "unknown", outside_projection: "unknown" } as const;
    const sent = new Map(summary.calls.filter(call => call.state !== "not_sent").map(call => [call.bodySha256, call.bodyBytes]));
    return { inputSha256: summary.claims.inputSha256, cloudModel: summary.cloudModel, cloudApi: summary.cloudApi, modelCalls: summary.modelCalls,
      failedDispatches: summary.rejectedDispatches, unknownDispatches: summary.unknownDispatches, inputTokens: summary.inputTokens, outputTokens: summary.outputTokens,
      cachedTokens: summary.cachedTokens, usd: summary.usd, reservedUsd: summary.calls.reduce((sum, call) => sum + call.projectedUsd, 0), pinnedUsd: summary.reservedUnknownUsd,
      disclosedBytes: [...sent.values()].reduce((sum, bytes) => sum + bytes, 0), terminalCause: summary.failure ?? summary.outcome,
      cloudCalls: summary.calls.map(call => ({ purpose: call.kind, status: states[call.state], feeUsd: call.state === "settled" ? call.usd : null, reservedUsd: call.projectedUsd,
        bodyBytes: call.bodyBytes })) };
  }

  it("rows the summary the real tool writes for a labelled run with every field it determines, and none of its text", async () => {
    const set = harvestedSet(), { run: runName, path, summary } = await label(set, await responsesFake([answered]));
    expect([summary.outcome, summary.modelCalls, summary.calls[0]!.state]).toEqual(["labelled", 1, "settled"]);
    const line = run(["--labelling-file", path], "accepted", { "--arm": "cloud-gpt-6-sol" }), result = JSON.parse(line);
    const { inputSha256: _input, ...claims } = summary.claims;
    expect(result).toMatchObject({ ...determined(summary), cacheWriteTokens: summary.cacheWriteTokens, outcome: "accepted" });
    expect(result.labelling).toEqual({ version: 1, sha256: digest(readFileSync(path)), outcome: "labelled", failure: null, secondRequest: summary.secondRequest,
      envelopeLine: "synthetic_data", capUsd: summary.capUsd, priorCountedUsd: summary.priorCountedUsd, instructionsSha256: summary.instructionsSha256, prices: summary.prices,
      reasoningTokens: summary.reasoningTokens, cacheWriteAssumed: 0, claims });
    expectAbsent(line, "test-labeller-key", "REPLY-NOTE-TEXT", "PLANTED-NOTE", "Synthetic sentence", "orchard", "SIDECAR-RUN", "req_fake", "resp_fake", runName, "127.0.0.1",
      "openai/gpt-6-sol", "gpt-6-sol-2026-09-22", set.root);
  }, 60_000);

  it("rows the summaries the real tool writes for a rejected request and a timed-out one, and refuses accepted for both", async () => {
    const rejected = await label(harvestedSet(), await responsesFake([rejectedStep]));
    expect([rejected.summary.outcome, rejected.summary.calls[0]!.state]).toEqual(["failed", "rejected"]);
    const line = run(["--labelling-file", rejected.path], "infra_invalid");
    expect(JSON.parse(line)).toMatchObject({ ...determined(rejected.summary), failedDispatches: 1, usd: 0, pinnedUsd: 0, terminalCause: "labeller_rejected" });
    expectAbsent(line, "REJECTED-MESSAGE-TEXT", "invalid_request_error", "context_length_exceeded", "req_fake", rejected.run);
    const timedOut = await label(harvestedSet(), await responsesFake([() => "never"]), 300);
    expect([timedOut.summary.outcome, timedOut.summary.calls[0]!.state]).toEqual(["failed", "unknown"]);
    expect(row(["--labelling-file", timedOut.path], "incomplete")).toMatchObject({ ...determined(timedOut.summary), unknownDispatches: 1, usd: 0,
      pinnedUsd: timedOut.summary.calls[0]!.projectedUsd, terminalCause: "labeller_timeout" });
    for (const { path } of [rejected, timedOut]) expect(refused(["--labelling-file", path], "accepted")).toContain("the labelling ended failed, not labelled");
  }, 60_000);

  it("refuses the summary the real tool writes ahead of its request while the tool runs, its claims in e0-judge or a folder below it", async () => {
    for (const below of [false, true]) {
      const set = harvestedSet(below), labelling = label(set, await responsesFake([() => "never"]), 1_500);
      // The run ends before its scratch directory is removed, even if an expectation below fails.
      cleanups.push(() => labelling.then(() => undefined, () => undefined));
      let interim: string | undefined;
      for (let wait = 0; interim === undefined && wait < 100; wait++) {
        const name = readdirSync(set.directory).find(entry => entry.startsWith("labelling-"));
        if (name !== undefined && existsSync(join(set.directory, name, "summary.json"))) interim = join(set.directory, name, "summary.json");
        else await new Promise(done => setTimeout(done, 10));
      }
      expect(existsSync(join(set.root, LOCK_NAME))).toBe(true);
      expect(refused(["--labelling-file", interim!], "incomplete")).toContain(`holds ${LOCK_NAME}`);
      const { summary } = await labelling;
      expect(existsSync(join(set.root, LOCK_NAME))).toBe(false);
      expect(row(["--labelling-file", interim!], "incomplete")).toMatchObject({ ...determined(summary), terminalCause: "labeller_timeout" });
    }
  }, 60_000);
});
