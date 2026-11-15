import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENTAILMENT_PROMPT_VERSION, ENTAILMENT_VERDICTS } from "../../src/main/private-agent/claims";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { inventoryResearchSources } from "../../src/main/private-agent/research-coverage";
import { assembleIndexEntry, buildLiteralSourceCard } from "../../src/main/private-agent/research-index";
import { JUDGE_CONDITIONS, runJudgeFixture } from "../../scripts/judge-fixture";
import { DEFAULT_CONDITIONS, FIXTURE_CONDITIONS, runPlannerFixture } from "../../scripts/planner-fixture";
import { syntheticProbe } from "../helpers/serving-probe-fixture";

/**
 * E0's registry modes (BL-20261115-1954-e0-registry-modes-design): a serving-probe run from its probe.json, a planner or judge fixture
 * run from the summary.json the real fixture writes against a loopback fake, a fixture run that died from its replies/ listing, and
 * the labelling call from its summary. Nothing here reaches a real endpoint, a cloud model or Docker.
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
  function probeDir(change: (probe: Record<string, any>) => void = () => {}) {
    const probe = syntheticProbe();
    for (const [name, cell] of Object.entries(probe.P10.cells as Record<string, Record<string, unknown>>)) cell.request_body_sha256 = digest(`body ${name}`);
    change(probe);
    const dir = join(scratch(), probe.run_id as string); mkdirSync(dir);
    writeFileSync(join(dir, "probe.json"), `${JSON.stringify(probe, null, 1)}\n`);
    return { dir, probe, bytes: readFileSync(join(dir, "probe.json")) };
  }

  it("counts each completed probe's model calls, keeps the usage it recorded, spends nothing, and copies no alias, version or source id", () => {
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
      failed: { P6: "URLError" }, finished: true, assessed: true });
    expect(result.inputSha256).toBe(digest(canonical(Object.fromEntries(Object.entries(probe.P10.cells as Record<string, { request_body_sha256: string }>).map(([name, cell]) => [name, cell.request_body_sha256])))));
    expectAbsent(line, "RM-01", "Qwen3.8", "0.33.0rc1", "input/corpus", "alpha.md", probe.run_id, "local_zero_cost", "loopback");
  });

  it("refuses accepted for a run that did not finish, lost a probe or left P10 unassessed, and accepts a complete one", () => {
    const complete = (probe: Record<string, any>) => { probe.probes_failed = {}; probe.probes_run.push("P6"); probe.P6 = { running_before: 0, abort: { aborted_after_s: 4.01 }, running_after_abort_1s_steps: [1, 0],
      next_request: { status: 200, prompt_tokens: 20, completion_tokens: 2 } }; };
    expect(row(["--probe-dir", probeDir(complete).dir], "accepted")).toMatchObject({ outcome: "accepted", modelCalls: 170, probe: { failed: {}, calls: { P6: 2 } } });
    expect(refused(["--probe-dir", probeDir().dir], "accepted")).toContain("probes failed (P6)");
    const unfinished = probeDir(probe => { complete(probe); delete probe.finished_utc; });
    expect(refused(["--probe-dir", unfinished.dir], "accepted")).toContain("did not finish");
    expect(row(["--probe-dir", unfinished.dir], "incomplete")).toMatchObject({ terminalCause: "probe_unfinished", wallSeconds: null, probe: { finished: false } });
    expect(refused(["--probe-dir", probeDir(probe => { complete(probe); delete probe.P10.assessed; }).dir], "accepted")).toContain("pnpm probe:assess");
    // A P1-only run: no P10, so no input hash and no assessment to wait for.
    const p1 = probeDir(probe => { probe.probes_selected = ["P1"]; probe.probes_run = ["P1"]; probe.probes_failed = {}; probe.probes_skipped = probe.probes_skipped.concat(
      ["P2", "P3", "P4", "P5", "P6", "P7", "P9", "P10", "P11", "adapter"]).sort(); });
    expect(row(["--probe-dir", p1.dir], "accepted")).toMatchObject({ modelCalls: 0, inputSha256: null, probe: { assessed: null, calls: { P1: 0 } } });
    // An export without body digests binds no input hash.
    expect(row(["--probe-dir", probeDir(probe => { delete probe.P10.cells["plan/on"].request_body_sha256; }).dir], "rejected").inputSha256).toBeNull();
    // Only answered calls' usage counts: a request that was not answered 200 counts as a call, never its token fields.
    const errored = row(["--probe-dir", probeDir(probe => { probe.P2.kwargs_low = { status: 503, prompt_tokens: 40, completion_tokens: 600, elapsed_s: 0.2 }; }).dir], "rejected");
    expect([errored.modelCalls, errored.probe.usage.calls, errored.probe.usage.outputTokens]).toEqual([168, 138, 60160 - 600]);
  });

  it("refuses another probe version, a record without the zero-fee guard, unknown probe names and a failure that is not a class name", () => {
    expect(refused(["--probe-dir", probeDir(probe => { probe.probe_version = 1; }).dir], "rejected")).toContain("probe version 2");
    expect(refused(["--probe-dir", probeDir(probe => { probe.transport_class = "https"; probe.cost_policy = null; }).dir], "rejected")).toContain("zero-fee guard");
    expect(refused(["--probe-dir", probeDir(probe => { probe.probes_run.push("P12"); }).dir], "rejected")).toContain("probes_run");
    expect(refused(["--probe-dir", probeDir(probe => { probe.probes_failed = { P6: "connection refused by 10.0.0.5" }; }).dir], "rejected")).toContain("probes_failed");
    expect(refused(["--probe-dir", probeDir(probe => { probe.P10.cells["plan/on"].request_body_sha256 = "/Users/someone/body"; }).dir], "rejected")).toContain("P10's cells");
    expect(refused(["--probe-dir", scratch()], "rejected")).toContain("probe.json is missing");
  });
});

describe("E0 registry modes: role-fixture runs", () => {
  const ALIAS = "Synthetic-Served-Alias";
  /** A loopback chat-completions fake: each call gets the scripted reply of its ordinal, or a dropped connection. */
  async function fakeServer(script: (ordinal: number, body: any) => { status?: number; content?: string; finish?: string; drop?: boolean }) {
    let ordinal = 0;
    const server: Server = createServer((request, response) => {
      let data = ""; request.on("data", chunk => { data += chunk; });
      request.on("end", () => {
        const reply = script(++ordinal, JSON.parse(data));
        if (reply.drop) { request.socket.destroy(); return; }
        response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "x", model: ALIAS, choices: [{ index: 0, message: { role: "assistant", ...(reply.content === undefined ? {} : { content: reply.content }), reasoning_content: "hidden thoughts" },
          finish_reason: reply.finish ?? "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 256 } } }));
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

  it("rows a planner run from the summary the fixture wrote: its calls, usage, classes, manifest hashes and request digests, and no alias or path", async () => {
    // Per condition, two repeats: valid and truncated, rejected and valid, a dropped connection and a reply without content.
    const baseUrl = await fakeServer(ordinal => [{ content: plan }, { content: plan.slice(0, 40), finish: "length" }, { status: 500, content: "" }, { content: plan }, { drop: true }, {}][ordinal - 1]!);
    const out = join(scratch(), "e0-planner-fixture-20261115T200000000Z"), inputs = plannerInputs();
    await runPlannerFixture({ endpoint: { baseUrl, model: ALIAS }, inputs, out, repeats: 2, conditions: DEFAULT_CONDITIONS });
    const bytes = readFileSync(join(out, "summary.json")), summary = JSON.parse(bytes.toString("utf8"));
    const line = run(["--fixture-dir", out, "--fixture", "planner"], "accepted"), result = JSON.parse(line);
    expect(result).toMatchObject({ modelCalls: 6, inputTokens: 3 * 1200, outputTokens: 3 * 80, cachedTokens: 3 * 256, usd: 0, reservedUsd: 0, pinnedUsd: 0, unknownDispatches: 0,
      cloudCalls: [], disclosedBytes: 0, terminalCause: "fixture_finished", date: summary.startedUtc.slice(0, 10), outcome: "accepted", cloudModel: null, profile: null });
    expect(result.fixture).toEqual({ kind: "planner", finished: true, version: 1, sha256: digest(bytes), conditions: [...DEFAULT_CONDITIONS], repeats: 2, usageMissing: 1,
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
    expect(refused(["--fixture-dir", out], "rejected")).toContain("--fixture-dir and --fixture go together");
  });

  it("rows a judge run with its classes, its own scores and its activation cell, and copies no claim, label, note or alias", async () => {
    const passage = "The orchard recorded twelve healthy trees during the autumn survey, and the meadow recorded seven.";
    const claims = ["supported", "supported", "partial", "partial", "unsupported", "unsupported", "contradicted", "contradicted"].map((label, i) => ({ id: `C${i + 1}`, label,
      claim: { id: `C${i + 1}`, sentence: `Synthetic claim sentence number ${i + 1} about the orchard.`, quote: "twelve healthy trees", context: passage } }));
    const claimsBytes = Buffer.from(`${JSON.stringify({ version: 1, task: "r3-grid-batteries", claims: claims.map(item => item.claim) }, null, 1)}\n`);
    const labelsBytes = Buffer.from(`${JSON.stringify({ version: 1, protocol: "e0-judge-labelling-v1", labeller: "openai gpt-6-sol labeller", labels: claims.map(item => ({ id: item.id, label: item.label,
      planted: item.id === "C5", ...(item.id === "C5" ? { note: "PLANTED-NOTE-TEXT" } : {}) })) }, null, 1)}\n`);
    const manifest = { schemaVersion: 1, name: "e0-judge-fixture-test-name", status: "pinned", task: "r3-grid-batteries", exposure: "exposed", promptVersion: ENTAILMENT_PROMPT_VERSION,
      claimsSha256: digest(claimsBytes), labelsSha256: digest(labelsBytes), claimCount: 8, labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, plantedCount: 1,
      minimumPerClass: 2, agreement: { measure: "exact", level: 0.95 }, conditions: ["j1-legacy"], repeats: 1 };
    // Each claim is judged as labelled, except C3 (a reply that is not a verdict) and C6 (an error status).
    const baseUrl = await fakeServer(ordinal => ordinal === 3 ? { content: "no verdict here" } : ordinal === 6 ? { status: 500, content: "" }
      : { content: `{"verdict":"${claims[ordinal - 1]!.label}","reason":"synthetic"}` });
    const out = join(scratch(), "judge-run");
    await runJudgeFixture({ endpoint: { baseUrl, model: ALIAS }, inputs: { claims: claimsBytes, labels: labelsBytes, manifest }, out });
    const bytes = readFileSync(join(out, "summary.json")), summary = JSON.parse(bytes.toString("utf8"));
    const line = run(["--fixture-dir", out, "--fixture", "judge"], "rejected"), result = JSON.parse(line);
    expect(result).toMatchObject({ modelCalls: 8, inputTokens: 7 * 1200, outputTokens: 7 * 80, cachedTokens: 7 * 256, usd: 0, disclosedBytes: 0, terminalCause: "fixture_finished" });
    expect(result.fixture).toMatchObject({ kind: "judge", sha256: digest(bytes), conditions: ["j1-legacy"], repeats: 1, usageMissing: 0, promptVersion: ENTAILMENT_PROMPT_VERSION,
      promptSha256: summary.promptSha256, replyContract: "legacy", activationCondition: "j1-legacy",
      manifest: { sha256: summary.manifest.sha256, claimsSha256: digest(claimsBytes), labelsSha256: digest(labelsBytes), claimCount: 8, plantedCount: 1, minimumPerClass: 2,
        labelCounts: { supported: 2, partial: 2, unsupported: 2, contradicted: 2 }, agreement: { measure: "exact", level: 0.95 } },
      classes: { "j1-legacy": { supported: 2, partial: 1, unsupported: 1, contradicted: 2, judge_reply_invalid: 1, request_rejected: 1 } } });
    const metrics = summary.metrics["j1-legacy"].r1;
    expect(result.fixture.scores).toEqual({ "j1-legacy": { r1: { claims: 8, judged: 6, exactCount: metrics.exactCount, establishedCount: metrics.establishedCount, meetsLevel: false } } });
    expect(result.inputSha256).toBe(digest(canonical({ "j1-legacy": summary.requests["j1-legacy"].requestSetSha256 })));
    expectAbsent(line, ALIAS, "Synthetic claim sentence", "orchard", "PLANTED-NOTE", "gpt-6-sol labeller", "e0-judge-fixture-test-name", "no verdict here");
    // The writer reads the summary's own scores; it never needs, or opens, the labels.
    expect(JSON.stringify(summary)).not.toContain("PLANTED-NOTE");
  });

  it("rows a fixture run that died from its replies listing, dated by the earliest reply, as incomplete or infra_invalid only", () => {
    const out = join(scratch(), "e0-planner-fixture-dead"), replies = join(out, "replies"); mkdirSync(replies, { recursive: true });
    ["legacy-thinking-01.json", "legacy-thinking-02.json", "flash-thinking-01.json"].forEach((name, i) => {
      writeFileSync(join(replies, name), "{\"secret reply\": true}\n");
      const at = Date.UTC(2026, 10, 15, 21, i) / 1000; utimesSync(join(replies, name), at, at);
    });
    writeFileSync(join(replies, "notes.txt"), "not a reply");
    const line = run(["--fixture-dir", out, "--fixture", "planner"], "incomplete"), result = JSON.parse(line);
    expect(result).toMatchObject({ modelCalls: 3, date: "2026-11-15", wallSeconds: null, inputSha256: null, inputTokens: null, usd: 0, terminalCause: "fixture_unfinished",
      fixture: { kind: "planner", finished: false, replies: 3 } });
    expectAbsent(line, "legacy-thinking-01", "secret reply");
    expect(row(["--fixture-dir", out, "--fixture", "planner"], "infra_invalid").outcome).toBe("infra_invalid");
    for (const outcome of ["accepted", "rejected"]) expect(refused(["--fixture-dir", out, "--fixture", "planner"], outcome)).toContain("did not finish");
    const empty = join(scratch(), "empty"); mkdirSync(join(empty, "replies"), { recursive: true });
    expect(refused(["--fixture-dir", empty, "--fixture", "judge"], "incomplete")).toContain("nothing dates it");
    expect(refused(["--fixture-dir", scratch(), "--fixture", "judge"], "incomplete")).toContain("neither summary.json nor a replies directory");
  });
});

describe("E0 registry modes: the labelling call", () => {
  const call = (over: Record<string, unknown>) => ({ purpose: "label", status: "settled", bodySha256: h("a"), bodyBytes: 48210, reservedUsd: 0.62, feeUsd: 0.31, inputTokens: 12000,
    outputTokens: 9000, cachedTokens: 1024, ...over });
  const unsettled = { feeUsd: null, inputTokens: null, outputTokens: null, cachedTokens: null };
  const result = { claimsSha256: h("c"), labelsSha256: h("d"), claimCount: 48, plantedCount: 8, labelCounts: { supported: 20, partial: 10, unsupported: 10, contradicted: 8 } };
  function summaryFile(over: Record<string, unknown> = {}) {
    const summary = { kind: "soar_labelling_summary", version: 1, protocol: "e0-judge-labelling-v1", startedUtc: "2026-11-16T10:00:00.000Z", finishedUtc: "2026-11-16T10:02:30.000Z",
      model: "gpt-6-sol", api: "openai", envelopeLine: "synthetic_data", capUsd: 1, claimsSha256: h("b"), claimCount: 40, calls: [call({})], result, outcome: "labelled", ...over };
    const path = join(scratch(), "summary.json"); writeFileSync(path, `${JSON.stringify(summary, null, 1)}\n`);
    return { path, bytes: readFileSync(path) };
  }

  it("rows a labelled call with its settled fee, reservation, tokens, cloud call, disclosed bytes and envelope line", () => {
    const { path, bytes } = summaryFile();
    expect(row(["--labelling-file", path], "accepted", { "--arm": "cloud-gpt-6-sol" })).toMatchObject({ date: "2026-11-16", wallSeconds: 150, inputSha256: h("b"), cloudModel: "gpt-6-sol",
      cloudApi: "openai", modelCalls: 1, failedDispatches: 0, unknownDispatches: 0, inputTokens: 12000, outputTokens: 9000, cachedTokens: 1024, usd: 0.31, reservedUsd: 0.62, pinnedUsd: 0,
      cloudCalls: [{ purpose: "label", status: "settled", feeUsd: 0.31, reservedUsd: 0.62, bodyBytes: 48210 }], disclosedBytes: 48210, terminalCause: "labelled", profile: null,
      labelling: { version: 1, sha256: digest(bytes), envelopeLine: "synthetic_data", capUsd: 1, claimCount: 40, result }, outcome: "accepted", gitSource: "row_written" });
  });

  it("counts failed and unknown calls, pins an unknown call's reservation, discloses a resent body once, and refuses accepted unless labelled", () => {
    const { path } = summaryFile({ finishedUtc: null, result: null, outcome: "charge_unknown", calls: [call({}), call({ purpose: "plant", status: "failed", bodySha256: h("e"), bodyBytes: 900,
      reservedUsd: 0.2, ...unsettled }), call({ purpose: "plant", status: "unknown", bodySha256: h("e"), bodyBytes: 900, reservedUsd: 0.2, ...unsettled })] });
    expect(row(["--labelling-file", path], "incomplete")).toMatchObject({ modelCalls: 3, failedDispatches: 1, unknownDispatches: 1, usd: 0.31, reservedUsd: 1.02, pinnedUsd: 0.2,
      disclosedBytes: 48210 + 900, wallSeconds: null, inputTokens: 12000, terminalCause: "charge_unknown",
      cloudCalls: [{ status: "settled" }, { purpose: "plant", status: "failed", feeUsd: null, reservedUsd: 0.2 }, { status: "unknown", feeUsd: null }] });
    expect(refused(["--labelling-file", path], "accepted")).toContain("ended charge_unknown, not labelled");
    expect(row(["--labelling-file", summaryFile({ calls: [], result: null, outcome: "cap_refused" }).path], "rejected")).toMatchObject({ modelCalls: 0, usd: 0, disclosedBytes: 0, cloudCalls: [] });
  });

  it("refuses any other key, a free-text model or code, a call that does not hold its keys, and a result that does not match the outcome", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ note: "the labeller's free text" }, "exactly the labelling summary's keys"],
      [{ model: "gpt 6 sol on https://api.example" }, "model or api"],
      [{ api: "responses" }, "model or api"],
      [{ envelopeLine: "phase4_harness" }, "envelope line"],
      [{ outcome: "labelled but late" }, "outcome is not one of its codes"],
      [{ result: null }, "a result is recorded with outcome labelled"],
      [{ protocol: "e0-judge-labelling-v2" }, "version 1 labelling summary"],
      [{ calls: [call({ feeUsd: null })] }, "a settled call must record its fee"],
      [{ calls: [call({ purpose: "label the claims for jane" })] }, "purpose, status, body or reservation"],
      [{ calls: [{ ...call({}), url: "https://api.openai.com/v1" }] }, "exactly the summary's call keys"],
      [{ calls: [call({}), call({ bodyBytes: 7 })] }, "one body digest with different sizes"],
      [{ result: { ...result, labelCounts: { supported: 1 } } }, "result does not hold exactly"],
    ];
    for (const [over, message] of cases) expect(refused(["--labelling-file", summaryFile(over).path], "rejected")).toContain(message);
  });
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
  });
});
