import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { digest } from "../../src/main/private-agent/contracts";
import { PYTHON_TIMEOUT_MS, runCardWriter } from "../helpers/serving-card-fixture";
import { syntheticProbe } from "../helpers/serving-probe-fixture";

const SCRIPT = resolve(__dirname, "..", "..", "scripts", "serving-card.py");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "soar-card-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const envFile = join(root, "empty.env"); writeFileSync(envFile, "");
  return { root, envFile };
}
/** Runs the writer as the operator does, with no SOAR variables unless the test sets them and never the repository's .env.local. */
function card(probe: unknown, extra: string[] = [], environment: Record<string, string> = {}) {
  const { root, envFile } = workspace();
  const input = join(root, "probe.json"); writeFileSync(input, JSON.stringify(probe));
  const result = spawnSync("python3", ["-I", SCRIPT, "--input", input, "--env-file", envFile, ...extra], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...environment } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const COMPARE = ["--compare-root", "Qwen3.8-Flash-Next-NVFP4", "--compare-version", "0.33.0rc1.dev617+g821038729", "--compare-context", "262144"];
const ADDRESS_PLANTS: [string, (p: any) => void][] = [
  ["a URL in the alias", (p: any) => { p.P1.models[0].id = "http://rm01.internal:8000/v1"; }],
  ["an IPv4 literal in a failure name", (p: any) => { p.probes_failed.P6 = "10.0.0.5"; }],
  ["a host:port in the run id", (p: any) => { p.run_id = "rm01-box:8000"; }],
  ["an IPv6 literal", (p: any) => { p.model_source = "fe80::1"; }],
  ["a bracketed IPv6 host:port", (p: any) => { p.P1.version = "[::1]:8000"; }],
  ["an address inside a nested key", (p: any) => { p.P10.cells["plan/on"].calls[0]["https://leak.example"] = 1; }],
];

describe("serving-card writer", () => {
  it("emits the identity, behaviour and derived-bounds tables from a probe_version 2 result and tells skipped probes from failed ones", () => {
    const result = card(syntheticProbe(), COMPARE);
    expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const text = result.stdout;
    expect(text).toContain("# Serving card: owner's inference endpoint, 2026-11-08");
    expect(text).toContain("| Engine | vLLM 0.33.0rc1.dev617+g821038729 |");
    expect(text).toContain("| Served alias | `RM-01 VLM` |");
    expect(text).toContain("| Model root (basename) | `Qwen3.8-Flash-Next-NVFP4` |");
    expect(text).toContain("| Context limit | 262,144 tokens |");
    expect(text).toContain("| Transport | loopback");
    expect(text).toContain("| Authentication | none required");
    expect(text).toContain("| Speculative decoding | active: 73% of drafted tokens accepted during the probe |");
    // The comparison says consistent, never that the weights are the same or verified.
    expect(text).toContain("| Consistent with the 2026-11-04 qualification: model root | yes (`Qwen3.8-Flash-Next-NVFP4`) |");
    expect(text).toContain("| Consistent with the 2026-11-04 qualification: engine version | yes");
    expect(text).toContain("| Consistent with the 2026-11-04 qualification: context | yes (`262144`) |");
    expect(text).toContain("cannot prove identical weights");
    expect(text).not.toMatch(/same weights/iu); expect(text).not.toMatch(/\bverified\b/iu);
    // Probe states: run, skipped by the operator, failed before a result.
    expect(text).toContain("| **P8** | not run (skipped by the operator) |");
    expect(text).toContain("| **P6** | failed before recording a result (`URLError`) |");
    expect(text).toContain("| **P4** prefix cache | repeating the same long prompt reused 44,800 cached tokens, first token 1.85 s |");
    expect(text).toContain("| **P9** context guard | max_tokens 262,144 requested: status 400, 0.0 s; rejected with 400 yes |");
    // P10 rows report the 95% rule per cell with the variant named; P11 and the adapter have their own rows.
    expect(text).toContain("**P10** structured output, plan/on | valid 19/20 (95%); truncated 1;");
    expect(text).toContain("against the 95% rule (strict variant): meets");
    expect(text).toContain("**P10** structured output, plan/off | valid 17/20 (85%); truncated 0; schema invalid 2; binding invalid 1;");
    expect(text).toContain("against the 95% rule (strict variant): does not meet");
    expect(text).toContain("| **P10** `response_format` acceptance, plan | strict: accepted (status 200); non-strict: accepted (status 200) |");
    expect(text).toContain("**P11** prefill and decode by prompt size | 20,000 target (20,010 observed)");
    expect(text).toContain("stable_prefix: second request reused 5,120 of 21,010 prompt tokens");
    expect(text).toContain("K=8: aggregate 236.8 tok/s, median per stream 30.2 tok/s");
    expect(text).toContain("| **Adapter** `/tokenize` parity | status 200; count 23 against usage.prompt_tokens 23: parity yes |");
    expect(text).toContain("consistent with `flash_next_v1`: yes");
    // Derived bounds: (900 - 31.2) x 34.1 = 29,626 for the plan's 60k prompt; (300 - 66) ... only the roles' sizes appear.
    expect(text).toContain("## Stage bounds derived from this card (proposals for the E0 card)");
    expect(text).toContain("| plan | 8,192 | 60,000 | 31.2 | 34.1 | 9,166 (within the cap) | 29,626 (within the cap) |");
    expect(text).toContain("| index | 1,536 | 20,000 | 9.8 | 36.0 | 10,447 (within the cap) | 32,047 (within the cap) |");
    expect(text).toContain("## Consequences for the plan");
    // Deterministic for a given input.
    expect(card(syntheticProbe(), COMPARE).stdout).toBe(text);
  });

  it("marks unassessed P10 cells and a missing P11 instead of evaluating the rule or deriving bounds", () => {
    const probe = syntheticProbe();
    delete probe.P10.assessed; probe.P10.cells["plan/on"].counts.unassessed = 20; probe.P10.cells["plan/on"].counts.valid = 0;
    probe.probes_run = probe.probes_run.filter((name: string) => name !== "P11"); probe.probes_skipped.push("P11"); delete probe.P11;
    const result = card(probe);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("20 replies not yet assessed (`pnpm probe:assess`), so the 95% rule is not evaluated");
    expect(result.stdout).toContain("| **P11** | not run (skipped by the operator) |");
    expect(result.stdout).toContain("Not derived: the table needs the role export");
    expect(result.stdout).not.toContain("Consistent with the 2026-11-04");
  });

  it.each(ADDRESS_PLANTS)("refuses %s with exit 2 and no output", (_name, plant) => {
    const probe = syntheticProbe(); plant(probe);
    const result = card(probe, COMPARE);
    expect(result.status).toBe(2); expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refused: an address-like string at $.");
    expect(result.stderr).not.toMatch(/rm01|10\.0\.0\.5|fe80|leak\.example/u);
    if (_name.includes("nested key")) expect(result.stderr).toContain("$.P10.cells.plan/on.calls[0].<redacted-key>");
  });

  it("refuses the configured endpoint's host even without a port or scheme, and a version 1 probe", () => {
    const probe = syntheticProbe(); probe.P1.models[0].root_basename = "weights-from-box-example-host.internal";
    const refused = card(probe, [], { SOAR_VLLM_BASE_URL: "https://box-example-host.internal:8443/v1" });
    expect(refused.status).toBe(2); expect(refused.stdout).toBe(""); expect(refused.stderr).toContain("$.P1.models[0].root_basename");
    expect(refused.stderr).not.toContain("box-example-host");
    const accepted = card(probe, [], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:8000/v1" });
    expect(accepted.status).toBe(0);
    const old = { ...syntheticProbe(), probe_version: 1 };
    const v1 = card(old);
    expect(v1.status).toBe(2); expect(v1.stdout).toBe(""); expect(v1.stderr).toContain("probe_version 2");
    expect(() => execFileSync("python3", ["-I", SCRIPT], { encoding: "utf8", stdio: "pipe" })).toThrow();
  });

  it("leaves ordinary probe text alone: timestamps, versions, ratios and file names are not addresses", () => {
    const probe = syntheticProbe();
    probe.P10.cells["plan/on"].calls[0].reply_file = "plan-on-strict-01.json"; probe.P1.version = "0.33.0rc1.dev617+g821038729";
    probe.P10.assessed.assessedUtc = "2026-11-08T11:05:00.123Z"; probe.started_utc = "2026-11-08T09:15:00+00:00";
    expect(card(probe).status).toBe(0);
  });
});

const h = (n: string) => n.repeat(64);
/** The Markdown's derived-bounds rows: role, assumed prompt size and the two ceilings. */
const BOUND_ROWS = /^\| (index|plan|extract|synthesis) \| [^|]+ \| ([\d,]+) \| [^|]+ \| [^|]+ \| (-?[\d,]+) \([^)]*\) \| (-?[\d,]+) \([^)]*\) \|$/gmu;
const integer = (text: string) => Number(text.replace(/,/gu, ""));
const IMPORT_WRITER = "import importlib.util, json, os, sys\nspec = importlib.util.spec_from_file_location('serving_card', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)";
/** main() through importlib with a standard output whose write raises (W4). */
const BROKEN_STDOUT = [IMPORT_WRITER,
  "class Broken:", "    def write(self, text): raise OSError('standard output closed')", "    def flush(self): pass",
  "args = json.loads(sys.argv[2]); real = sys.stdout; sys.stdout = Broken()",
  "try:", "    code = module.main(args)", "finally:", "    sys.stdout = real",
  "print(json.dumps({'code': code, 'exists': os.path.exists(args[args.index('--policy-out') + 1])}))", ""].join("\n");
/** build_policy over the synthetic probe (read from a file, not stdin), then refuse_addresses before and after planting an address-like K key (W5). */
const PLANTED_KEY = [IMPORT_WRITER,
  "policy = module.build_policy(json.load(open(sys.argv[2], encoding='utf-8')), None, '0' * 64); out = {}",
  "for name in ('clean', 'planted'):",
  "    if name == 'planted': policy['evidence']['p11']['kStreams']['10.0.0.5:8000'] = policy['evidence']['p11']['kStreams']['8']",
  "    try:", "        module.refuse_addresses(policy, []); out[name] = 'passed'", "    except module.Refusal as error:", "        out[name] = str(error)",
  "print(json.dumps(out))", ""].join("\n");
const PROPOSED = { plan: { variant: "strict", thinkingOff: false, thinkingOn: true }, extract: { variant: "strict", thinkingOff: true, thinkingOn: true },
  synthesis: { variant: "strict", thinkingOff: true, thinkingOn: false } };
const structured = (policy: any) => ({ plan: policy.roles.plan.structuredOutput, extract: policy.roles.extract.structuredOutput, synthesis: policy.roles.synthesis.structuredOutput });

describe("serving-card writer: the machine-readable card (--policy-out, SC)", () => {
  it("W1: prints byte-identical Markdown with --policy-out, and the base writer's Markdown digests hold", () => {
    // Digests of the writer at 0e644e5 on syntheticProbe(); a later PR that changes the fixture or the Markdown re-pins them in its own diff.
    const plain = card(syntheticProbe(), COMPARE), withJson = runCardWriter(syntheticProbe(), COMPARE);
    expect(plain.status).toBe(0); expect(withJson.status).toBe(0); expect(withJson.policy).toBeDefined();
    expect(withJson.stdout).toBe(plain.stdout);
    expect(digest(plain.stdout)).toBe("5cf363caa1c6d62bc2719501979a9056569f21c394afaac806f86ba12536f426"); expect(Buffer.byteLength(plain.stdout)).toBe(9024);
    const bare = card(syntheticProbe()), bareWithJson = runCardWriter(syntheticProbe());
    expect(digest(bare.stdout)).toBe("b0278fa07d79e4db737eb6f85bae061521c2c11667969175d038055edd25b5d4"); expect(Buffer.byteLength(bare.stdout)).toBe(8508);
    expect(bareWithJson.stdout).toBe(bare.stdout);
  });

  it("W2: writes the proposed card from syntheticProbe(): identity, probe digest, today's caps and thinking, the 95% rule's proposals, K 1 and the evidence", () => {
    const run = runCardWriter(syntheticProbe());
    expect(run.status).toBe(0); expect(run.stderr).toBe("");
    const text = run.policy!.toString("utf8"), policy = JSON.parse(text);
    expect(text.endsWith("}\n")).toBe(true); expect(text).toContain('\n  "kind": "soar_serving_card",\n');
    expect(Object.keys(policy)).toEqual(["kind", "version", "date", "decision", "identity", "probe", "roles", "concurrency", "admission", "evidence"]);
    expect(policy).toMatchObject({ kind: "soar_serving_card", version: 1, date: "2026-11-08", decision: { status: "proposed", entry: null } });
    expect(policy.identity).toEqual({ servedModel: "RM-01 VLM", engineVersion: "0.33.0rc1.dev617+g821038729", contextTokens: 262144, modelRootBasename: "Qwen3.8-Flash-Next-NVFP4" });
    // The digest of the exact bytes the writer read; failures by probe name only.
    expect(policy.probe).toEqual({ probeVersion: 2, sha256: run.probeSha256, probesRun: ["P1", "P2", "P3", "P4", "P5", "P7", "P9", "P10", "P11", "adapter"],
      probesSkipped: ["P8"], probesFailed: ["P6"] });
    expect(text).not.toContain("URLError");
    expect(policy.roles).toEqual({ index: { maxOutputTokens: [1536, 1536], thinking: ["disabled", "disabled"] },
      plan: { maxOutputTokens: [8192, 8192], thinking: ["model", "model"], structuredOutput: PROPOSED.plan },
      extract: { maxOutputTokens: [2048, 2048], thinking: ["disabled", "disabled"], structuredOutput: PROPOSED.extract },
      synthesis: { maxOutputTokens: [8192, 8192], thinking: ["model", "model"], structuredOutput: PROPOSED.synthesis } });
    expect(policy.concurrency).toEqual({ localStreams: 1 }); expect(policy.admission).toEqual({ basis: "none" });
    const p10 = policy.evidence.p10, both = { strict: true, nonStrict: true };
    expect(p10).toMatchObject({ callsPerCell: 20, strictRequested: true, protocolSha256: h("c"), schemaSha256: { plan: h("1"), extract: h("2"), synthesis: h("3") },
      assessed: { protocolSha256: h("c"), schemasProtocolMatch: true }, acceptance: { plan: both, extract: both, synthesis: both } });
    expect(Object.keys(p10.cells)).toEqual(["plan/on", "plan/off", "extract/on", "extract/off", "synthesis/on", "synthesis/off"]);
    expect(p10.cells["plan/off"]).toEqual({ variant: "strict", maxTokens: 8192, total: 20, valid: 17, truncated: 0, invalidJson: 0, schemaInvalid: 2, bindingInvalid: 1,
      requestRejected: 0, unassessed: 0, meanCompletionTokens: 400, meanReasoningTokens: 0 });
    for (const [key, cell] of Object.entries<any>(p10.cells)) expect(cell).toMatchObject({ meanCompletionTokens: 400, meanReasoningTokens: key.endsWith("/on") ? 350 : 0 });
    const p11 = policy.evidence.p11;
    expect(p11).toMatchObject({ tokensPerWordAssumed: 1.245, maxTokens: 300, sizesRefused: [], cacheLayouts: { packetBytes: 20480, chunkBytes: [65536, 65536] } });
    expect(Object.keys(p11.sizes)).toEqual(["20000", "60000", "120000"]); expect(Object.keys(p11.kStreams)).toEqual(["1", "2", "4", "8"]);
    expect(p11.sizes["60000"]).toEqual({ ok: true, promptTokens: 60100, completionTokens: 300, ttftS: 31.2, prefillTokS: 1926, decodeTokS: 34.1, tokensPerWord: 1.2471 });
    expect(p11.kStreams["8"]).toEqual({ streams: 8, errors: 0, medianDecodeTokS: 30.2, aggregateTokS: 236.8, maxTtftS: 0.5, maxTotalS: 29.8, runningMax: 8 });
    expect(p11.cacheLayouts.layouts.stable_prefix).toEqual({ cacheSaltAccepted: true,
      requests: [{ promptTokens: 21000, cachedTokens: 0, ttftS: 10.2 }, { promptTokens: 21010, cachedTokens: 5120, ttftS: 7.6 }] });
    // The bounds are the Markdown table's numbers.
    const rows = Object.fromEntries([...run.stdout.matchAll(BOUND_ROWS)].map(match => [match[1], { promptTokensAssumed: integer(match[2]!), ceiling300s: integer(match[3]!), ceiling900s: integer(match[4]!) }]));
    expect(Object.keys(rows)).toEqual(["index", "plan", "extract", "synthesis"]); expect(policy.evidence.bounds).toEqual(rows);
    expect(policy.evidence.bounds.plan).toEqual({ promptTokensAssumed: 60000, ceiling300s: 9166, ceiling900s: 29626 });
    expect(policy.evidence.adapter).toEqual({ legacyConsistent: true, flashNextV1Consistent: true, tokenizeParity: true });
    // Deterministic for a given input.
    expect(runCardWriter(syntheticProbe()).policy!.equals(run.policy!)).toBe(true);
  });

  it.each<[string, (p: any) => void, Record<string, unknown>]>([
    ["P10 not assessed", p => { delete p.P10.assessed; }, { plan: null, extract: null, synthesis: null }],
    ["P10 assessed under another protocol", p => { p.P10.assessed.protocolSha256 = h("d"); p.P10.assessed.schemasProtocolMatch = false; }, { plan: null, extract: null, synthesis: null }],
    ["a cell of 19 calls, all valid", p => { p.P10.cells["extract/off"].calls = p.P10.cells["extract/off"].calls.slice(0, 19); },
      { ...PROPOSED, extract: { variant: "strict", thinkingOff: false, thinkingOn: true } }],
    ["the requested strict variant refused for plan, whose cells fell back to non-strict", p => {
      p.P10.acceptance.plan.strict = { status: 400, elapsed_s: 0.2, error_bytes: 90, error_sha256: h("d"), accepted: false };
      p.P10.cells["plan/on"].strict = false; p.P10.cells["plan/off"].strict = false; }, { ...PROPOSED, plan: null }],
    ["non-strict requested and run", p => { p.P10.strict_requested = false; for (const cell of Object.values<any>(p.P10.cells)) cell.strict = false; },
      Object.fromEntries(Object.entries(PROPOSED).map(([role, value]) => [role, { ...value, variant: "non_strict" }]))],
  ])("W3: proposes nothing the evidence cannot back: %s", (_name, edit, expected) => {
    const probe = syntheticProbe(); edit(probe);
    const run = runCardWriter(probe);
    expect(run.status).toBe(0);
    expect(structured(JSON.parse(run.policy!.toString("utf8")))).toEqual(expected);
  });

  it.each(["P10", "P11", "adapter"])("W3: %s skipped leaves its evidence block null", name => {
    const probe = syntheticProbe();
    probe.probes_run = probe.probes_run.filter((item: string) => item !== name); probe.probes_skipped.push(name); delete probe[name];
    const run = runCardWriter(probe), evidence = JSON.parse(run.policy!.toString("utf8")).evidence;
    expect(run.status).toBe(0);
    expect(evidence).toMatchObject({ p10: name === "P10" ? null : expect.any(Object), p11: name === "P11" ? null : expect.any(Object),
      bounds: name === "P11" ? null : expect.any(Object), adapter: name === "adapter" ? null : expect.any(Object) });
    if (name === "P10") expect(structured(JSON.parse(run.policy!.toString("utf8")))).toEqual({ plan: null, extract: null, synthesis: null });
  });

  it.each<[string, (p: any) => void, string[], string, boolean]>([
    ["P1 skipped", p => { p.probes_run = p.probes_run.filter((item: string) => item !== "P1"); p.probes_skipped.push("P1"); delete p.P1; }, [], "needs probe P1", true],
    ["two served models", p => { p.P1.models.push({ id: "RM-02 VLM", root_basename: "Other-Model", max_model_len: 131072 }); }, [], "exactly one served model", true],
    ["no roles block", p => { delete p.roles; }, [], "output caps and thinking", true],
    ["an invalid --date", () => undefined, ["--date", "2026-13-40"], "valid YYYY-MM-DD date", true],
    ["17 K values", p => { for (let k = 9; Object.keys(p.P11.k_streams).length < 17; k++) p.P11.k_streams[String(k)] = { ...p.P11.k_streams["1"], streams: k }; }, [],
      "more P11 sizes, K values or layouts than the card holds", true],
    ["a K above 999", p => { p.P11.k_streams["1000"] = { ...p.P11.k_streams["1"], streams: 1000 }; }, [], "than the card holds", true],
    ["an assessment that disagrees with the protocol hashes", p => { p.P10.assessed.schemasProtocolMatch = false; }, [], "disagrees with the export's", true],
    ["a lone surrogate in the served alias", p => { p.P1.models[0].id = "RM-01 \ud800"; }, [], "cannot be encoded as UTF-8", false],
    ["an engine version that looks like a path", p => { p.P1.version = "/opt/vllm-0.33"; }, [], "at $.P1.version; serve the model under --served-model-name", false],
  ])("W4: refuses %s with exit 2, printing and writing nothing", (_name, edit, extra, message, markdownAlone) => {
    const probe = syntheticProbe(); edit(probe);
    const run = runCardWriter(probe, extra);
    expect(run.status).toBe(2); expect(run.stdout).toBe(""); expect(run.policy).toBeUndefined();
    expect(run.stderr).toContain(message); expect(run.stderr).not.toContain(run.directory);
    expect(run.stderr).not.toMatch(/RM-0[12] VLM|vllm-0\.33/u);
    const alone = card(probe, extra);
    expect(alone.status).toBe(markdownAlone ? 0 : 2);
    if (!markdownAlone) expect(alone.stdout).toBe("");
  });

  it.each(["/home/x/models/m", "~/models/m", "C:\\models\\m", "../m", "./m", "models/../m"])("W4: refuses the path-like served alias %s with and without --policy-out", alias => {
    const probe = syntheticProbe(); probe.P1.models[0].id = alias;
    for (const run of [card(probe, COMPARE), runCardWriter(probe, COMPARE)]) {
      expect(run.status).toBe(2); expect(run.stdout).toBe("");
      expect(run.stderr).toContain("a file-path-like served alias or engine version at $.P1.models[0].id; serve the model under --served-model-name");
      expect(run.stderr).not.toContain(alias);
    }
  });

  it("W4: passes an org/name hub id and the fixture's alias", () => {
    for (const alias of ["Qwen/Qwen3.8-Flash", "RM-01 VLM"]) {
      const probe = syntheticProbe(); probe.P1.models[0].id = alias;
      const run = runCardWriter(probe);
      expect(run.status).toBe(0); expect(JSON.parse(run.policy!.toString("utf8")).identity.servedModel).toBe(alias);
      expect(run.stdout).toContain(`| Served alias | \`${alias}\` |`);
    }
  });

  it("W4: refuses an existing --policy-out file, leaving it byte-unchanged, and a missing directory, never naming the path", () => {
    const { root } = workspace(), existing = join(root, "serving-card-2026-11-08.json"); writeFileSync(existing, "reviewed bytes\n");
    const refused = card(syntheticProbe(), ["--policy-out", existing]);
    expect(refused).toMatchObject({ status: 2, stdout: "" }); expect(refused.stderr).toContain("the --policy-out file exists"); expect(refused.stderr).not.toContain(root);
    expect(readFileSync(existing, "utf8")).toBe("reviewed bytes\n");
    const missing = join(root, "absent", "serving-card.json"), absent = card(syntheticProbe(), ["--policy-out", missing]);
    expect(absent).toMatchObject({ status: 2, stdout: "" }); expect(absent.stderr).toContain("could not be written"); expect(absent.stderr).not.toContain(root);
    expect(existsSync(missing)).toBe(false);
  });

  it.each(ADDRESS_PLANTS)("W4: with --policy-out, refuses %s, printing and writing nothing", (_name, plant) => {
    const probe = syntheticProbe(); plant(probe);
    const run = runCardWriter(probe, COMPARE);
    expect(run.status).toBe(2); expect(run.stdout).toBe(""); expect(run.policy).toBeUndefined();
    expect(run.stderr).toContain("refused: an address-like string at $."); expect(run.stderr).not.toMatch(/rm01|10\.0\.0\.5|fe80|leak\.example/u);
    expect(run.stderr).not.toContain(run.directory);
  });

  it("W4: through importlib, main() whose standard output fails returns 2 and leaves no JSON card", () => {
    const { root, envFile } = workspace(), input = join(root, "probe.json"), out = join(root, "serving-card.json");
    writeFileSync(input, JSON.stringify(syntheticProbe()));
    const result = spawnSync("python3", ["-I", "-c", BROKEN_STDOUT, SCRIPT, JSON.stringify(["--input", input, "--env-file", envFile, "--policy-out", out])],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: PYTHON_TIMEOUT_MS });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ code: 2, exists: false });
    expect(result.stderr).toContain("could not be written to standard output"); expect(result.stderr).not.toContain(root);
    expect(existsSync(out)).toBe(false);
  });

  it("W5: refuse_addresses covers the machine-readable card, keys included", () => {
    // The probe goes through a file: a 70 KB stdin handoff to python once stalled spawnSync under parallel workers.
    const { root } = workspace(), input = join(root, "probe.json"); writeFileSync(input, JSON.stringify(syntheticProbe()));
    const result = JSON.parse(execFileSync("python3", ["-I", "-c", PLANTED_KEY, SCRIPT, input], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: PYTHON_TIMEOUT_MS }));
    expect(result).toEqual({ clean: "passed", planted: "refused: an address-like string at $.evidence.p11.kStreams.<redacted-key>; the card was not written" });
  });

  it("W6: reads its flags after the leading `--` that pnpm 10 passes through, so `pnpm card:serving -- --input ...` works", () => {
    const { root, envFile } = workspace(), input = join(root, "probe.json"), out = join(root, "serving-card.json");
    writeFileSync(input, JSON.stringify(syntheticProbe()));
    const run = (args: string[]) => spawnSync("python3", ["-I", SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: PYTHON_TIMEOUT_MS });
    const plain = card(syntheticProbe(), COMPARE), dashed = run(["--", "--input", input, "--env-file", envFile, ...COMPARE, "--policy-out", out]);
    expect(dashed.status).toBe(0); expect(dashed.stderr).toBe(""); expect(dashed.stdout).toBe(plain.stdout);
    expect(readFileSync(out).equals(runCardWriter(syntheticProbe(), COMPARE).policy!)).toBe(true);
    // Only one leading `--` is dropped: a second one still leaves argparse without --input.
    const twice = run(["--", "--", "--input", input, "--env-file", envFile]);
    expect(twice.status).toBe(2); expect(twice.stdout).toBe(""); expect(twice.stderr).toContain("the following arguments are required: --input");
  });
});
