import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { RESEARCH_SYNTHESIS_LENGTH_POLICY } from "../../src/main/private-agent/research-admission";
import { RESEARCH_EXTRACTION_LAYOUT, researchExtractionUserContent } from "../../src/main/private-agent/research-pipeline";
import { currentSyntheticProbe, runCardWriter } from "../helpers/serving-card-fixture";
import { P10_ROLES, P10_THINKING_MODES, buildRoleSchemaExport } from "../../scripts/export-role-schemas";
import { assessProbeFile } from "../../scripts/assess-probe-replies";

const SCRIPT = resolve(__dirname, "..", "..", "scripts", "serving-probe.py");
const root = mkdtempSync(join(tmpdir(), "soar-probe-helpers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
// The driver imports the probe by path under python3 -I with no SOAR variable set, so a module that read the environment at import would fail here.
const DRIVER = join(root, "driver.py");
writeFileSync(DRIVER, [
  "import importlib.util, json, os, sys",
  "assert 'SOAR_VLLM_BASE_URL' not in os.environ",
  "spec = importlib.util.spec_from_file_location('serving_probe', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
  "out = []",
  "for call in json.load(sys.stdin):",
  "    try:",
  "        out.append({'ok': True, 'value': getattr(module, call['fn'])(*call.get('args', []), **call.get('kwargs', {}))})",
  "    except Exception as error:",
  "        out.append({'ok': False, 'error': type(error).__name__, 'message': str(error)})",
  "print(json.dumps(out, default=str))", ""].join("\n"));
const EMPTY_ENV = join(root, "empty.env"); writeFileSync(EMPTY_ENV, "");

type Call = { fn: string; args?: unknown[]; kwargs?: Record<string, unknown> };
function run(calls: Call[]): { ok: boolean; value?: any; error?: string; message?: string }[] {
  return JSON.parse(execFileSync("python3", ["-I", DRIVER, SCRIPT], { input: JSON.stringify(calls), encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }));
}
const one = (fn: string, ...args: unknown[]) => run([{ fn, args }])[0]!;
const values = (calls: Call[]) => run(calls).map(r => { if (!r.ok) throw new Error(`${r.error}: ${r.message}`); return r.value; });
function probe(args: string[], environment: Record<string, string>) {
  const result = spawnSync("python3", ["-I", SCRIPT, "--env-file", EMPTY_ENV, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...environment } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("serving-probe pure helpers (python3 -I, no endpoint)", () => {
  it("classifies P10 replies in order: rejected, truncated, invalid JSON, then the TypeScript assessment", () => {
    const cut = '{"version":2,"questions":[{"id":"Q1"';
    expect(values([
      { fn: "classify_reply", args: [400, null, null] }, { fn: "classify_reply", args: [-1, null, null] },
      { fn: "classify_reply", args: [200, "length", cut] }, { fn: "classify_reply", args: [200, "length", '{"complete": true}'] },
      { fn: "classify_reply", args: [200, "stop", "not json"] }, { fn: "classify_reply", args: [200, "stop", null] }, { fn: "classify_reply", args: [200, "stop", cut] },
      { fn: "classify_reply", args: [200, "stop", 'Reply: {"a": 1} done'] },
      { fn: "classify_reply", args: [200, "stop", "{}", "schema_invalid"] }, { fn: "classify_reply", args: [200, "stop", "{}", "binding_invalid"] }, { fn: "classify_reply", args: [200, "stop", "{}", "valid"] },
      { fn: "classify_reply", args: [200, "length", "{}", "valid"] }, { fn: "classify_reply", args: [500, "stop", "{}", "valid"] },
    ])).toEqual(["request_rejected", "request_rejected", "truncated", "truncated", "invalid_json", "invalid_json", "invalid_json", "unassessed", "schema_invalid", "binding_invalid", "valid", "truncated", "request_rejected"]);
    expect(one("classify_reply", 200, "stop", "{}", "bogus")).toMatchObject({ ok: false, error: "ValueError" });
    expect(values([{ fn: "parse_json_reply", args: ['Reply: {"a": {"b": 2}} tail'] }, { fn: "parse_json_reply", args: ["}{"] }, { fn: "parse_json_reply", args: [null] }])).toEqual([{ a: { b: 2 } }, null, null]);
  });

  it("sizes P11 prompts from the measured tokens per word and refuses sizes above the served context", () => {
    expect(values([{ fn: "words_for_tokens", args: [20000] }, { fn: "words_for_tokens", args: [60000] }, { fn: "words_for_tokens", args: [120000] }])).toEqual([16064, 48193, 96386]);
    expect(one("words_for_tokens", 0)).toMatchObject({ ok: false, error: "ValueError" });
    expect(values([{ fn: "plan_p11_sizes", args: [[20000, 60000, 120000, 262000], 300, 262144] }])).toEqual([[[20000, 60000, 120000], [262000]]]);
    expect(values([{ fn: "p11_size_admissible", args: [261844, 300, 262144] }, { fn: "p11_size_admissible", args: [261845, 300, 262144] }, { fn: "p11_size_admissible", args: [500000, 300, null] }])).toEqual([true, false, true]);
    const [document] = values([{ fn: "synthetic_document", args: [1000, 7] }]) as string[];
    expect(document.split(/\s+/u).length).toBeGreaterThanOrEqual(1000);
    expect(values([{ fn: "synthetic_document", args: [1000, 7] }])[0]).toBe(document);
  });

  it("builds the two extraction layouts with the same stable packet, differing only in the chunk", () => {
    const [packet, chunk1, chunk2] = values([{ fn: "synthetic_packet", args: [5, 2000] }, { fn: "synthetic_chunk", args: [3000, 11] }, { fn: "synthetic_chunk", args: [3000, 12] }]);
    const [first, second] = values([{ fn: "extraction_layouts", args: ["SYSTEM", packet, chunk1] }, { fn: "extraction_layouts", args: ["SYSTEM", packet, chunk2] }]);
    for (const layouts of [first, second]) for (const name of ["sorted_keys", "stable_prefix"]) {
      expect(layouts[name][0]).toEqual({ role: "system", content: "SYSTEM" }); expect(layouts[name][1].role).toBe("user");
    }
    // Markers from the chunk bodies (the JSON content escapes the newline after the document id line).
    const marker1 = (chunk1.text as string).split("\n")[1]!.slice(0, 60), marker2 = (chunk2.text as string).split("\n")[1]!.slice(0, 60);
    expect(marker1).not.toBe(marker2);
    // The layout before 7b.1, kept as P11's comparison: sorted keys put the chunk between brief and plan, so the shared prefix ends at the brief.
    const sorted = first.sorted_keys[1].content as string;
    expect(sorted.indexOf('"brief"')).toBeLessThan(sorted.indexOf('"chunk"')); expect(sorted.indexOf('"chunk"')).toBeLessThan(sorted.indexOf('"plan"'));
    expect(sorted).toContain(marker1); expect(sorted).not.toContain(marker2); expect(second.sorted_keys[1].content).toContain(marker2);
    // The pipeline's layout since 7b.1: the stable packet (brief, plan, units) first, byte-identical across chunks, then chunk, repairReason and source.
    const [prefix1, prefix2] = values([{ fn: "stable_prefix_of", args: [first.stable_prefix] }, { fn: "stable_prefix_of", args: [second.stable_prefix] }]);
    expect(prefix1).toBe(prefix2); expect(Object.keys(JSON.parse(prefix1))).toEqual(["brief", "plan", "units"]); expect(prefix1).not.toContain(marker1);
    expect(prefix1).not.toContain(packet.source.id); expect(prefix1).not.toContain('"repairReason"');
    expect(first.stable_prefix[1].content.startsWith(`${prefix1}\n{"chunk":`)).toBe(true);
    expect(Object.keys(JSON.parse(first.stable_prefix[1].content.split("\n")[1]))).toEqual(["chunk", "repairReason", "source"]);
    // Byte parity with the TypeScript builder the pipeline sends, for the same packet and chunk.
    for (const [layouts, chunk] of [[first, chunk1], [second, chunk2]]) {
      expect(layouts.stable_prefix[1].content).toBe(researchExtractionUserContent({ brief: packet.brief, plan: packet.plan, units: packet.units, source: packet.source, chunk, repairReason: null }));
    }
    expect(first.stable_prefix[1].content).toContain(marker1); expect(first.stable_prefix[1].content).not.toContain(marker2);
    expect(values([{ fn: "sha256_text", args: [prefix1] }, { fn: "sha256_text", args: [prefix2] }])).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/u), expect.stringMatching(/^[a-f0-9]{64}$/u)]);
  });

  it("keeps the probe's copies of the extraction layout and the tokens per word equal to the pipeline's (7b.1)", () => {
    const constants = JSON.parse(execFileSync("python3", ["-I", "-c", [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('serving_probe', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
      "print(json.dumps({'layout': module.EXTRACTION_LAYOUT, 'tokensPerWord': module.TOKENS_PER_WORD}))"].join("\n"), SCRIPT], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }));
    // P11 records this descriptor in cache_layouts.stable_prefix_layout, so a probe JSON states which stable_prefix it measured.
    expect(constants.layout).toEqual({ ...RESEARCH_EXTRACTION_LAYOUT, stable: [...RESEARCH_EXTRACTION_LAYOUT.stable], perChunk: [...RESEARCH_EXTRACTION_LAYOUT.perChunk] });
    expect(constants.tokensPerWord).toBe(RESEARCH_SYNTHESIS_LENGTH_POLICY.tokensPerWord);
  });

  it("records the pipeline's layout and the stable packet's digest and size in P11's cache_layouts, which the card writer accepts and drops (7b.1)", () => {
    const [packet, chunk1, chunk2] = values([{ fn: "synthetic_packet", args: [5, 2000] }, { fn: "synthetic_chunk", args: [3000, 11] }, { fn: "synthetic_chunk", args: [3000, 12] }]);
    const [layouts, record] = values([{ fn: "extraction_layouts", args: ["SYSTEM", packet, chunk1] }, { fn: "cache_layouts_record", args: [packet, [chunk1, chunk2], { stable_prefix: { requests: [] } }] }]);
    // packet_* cover the shared first line only, which since 7b.1 holds no source.
    const firstLine = (layouts.stable_prefix[1].content as string).split("\n")[0]!;
    expect(record.stable_prefix_layout).toEqual({ ...RESEARCH_EXTRACTION_LAYOUT, stable: [...RESEARCH_EXTRACTION_LAYOUT.stable], perChunk: [...RESEARCH_EXTRACTION_LAYOUT.perChunk] });
    expect(record).toMatchObject({ packet_sha256: digest(firstLine), packet_bytes: Buffer.byteLength(firstLine), chunk_bytes: [chunk1.endByte, chunk2.endByte], layouts: { stable_prefix: { requests: [] } } });
    expect(firstLine).not.toContain(packet.source.id);
    const plain = runCardWriter(currentSyntheticProbe()), probe = currentSyntheticProbe(); probe.P11.cache_layouts.stable_prefix_layout = record.stable_prefix_layout;
    const withLayout = runCardWriter(probe);
    expect([plain.status, withLayout.status]).toEqual([0, 0]);
    expect(JSON.parse(withLayout.policy!.toString("utf8")).evidence.p11).toEqual(JSON.parse(plain.policy!.toString("utf8")).evidence.p11);
  });

  it("parses K lists and aggregates a burst of streams with its load samples", () => {
    expect(values([{ fn: "parse_int_list", args: ["8,1,2,2", "k"] }, { fn: "parse_int_list", args: ["4", "k"] }])).toEqual([[1, 2, 8], [4]]);
    for (const bad of ["0,1", "a", "", "-2"]) expect(one("parse_int_list", bad, "k")).toMatchObject({ ok: false, error: "ValueError" });
    expect(values([{ fn: "select_probes", args: ["P10,P1", null] }, { fn: "select_probes", args: [null, "P8,P11"] }])).toEqual([["P1", "P10"], ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P9", "P10", "adapter"]]);
    expect(one("select_probes", "Px", null)).toMatchObject({ ok: false, error: "ValueError" });
    const streams = [{ completion_tokens: 900, total_s: 26, decode_tok_s: 35, ttft_s: 0.13 }, { completion_tokens: 900, total_s: 25.5, decode_tok_s: 33.5, ttft_s: 0.2 }, { error: "URLError", elapsed_s: 1 }];
    expect(values([{ fn: "aggregate_streams", args: [streams, [1, 2, null, 2]] }])[0]).toMatchObject({ streams: 3, errors: 1, per_stream_decode_tok_s: [35, 33.5], median_decode_tok_s: 34.25, aggregate_tok_s: 69.23, max_ttft_s: 0.2, max_total_s: 26, running_max: 2 });
    expect(values([{ fn: "aggregate_streams", args: [[{ error: "x" }], []] }])[0]).toMatchObject({ streams: 1, errors: 1, aggregate_tok_s: null, running_max: null });
  });

  it("redacts server error bodies to length and digest, and the card-safe post view never carries the body", () => {
    const body = "Server at http://rm01.internal:8000 failed; see /home/rm01/vllm.log";
    const [redacted, empty] = values([{ fn: "redact_error", args: [body] }, { fn: "redact_error", args: [null] }]);
    expect(redacted).toEqual({ error_bytes: Buffer.byteLength(body), error_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(JSON.stringify(redacted)).not.toContain("rm01"); expect(empty).toEqual({ error_bytes: 0, error_sha256: null });
    const [record] = values([{ fn: "post_record", args: [{ status: 400, elapsed_s: 0.0412, raw: body, json: null, error_bytes: 10, error_sha256: "f".repeat(64) }] }]);
    expect(record).toEqual({ status: 400, elapsed_s: 0.04, error_bytes: 10, error_sha256: "f".repeat(64) });
    const [stripped] = values([{ fn: "strip_reasoning_fields", args: ['{"choices":[{"message":{"content":"{}","reasoning_content":"secret thoughts"}}]}'] }]);
    expect(String(stripped)).not.toContain("secret"); expect(String(stripped)).toContain('"content": "{}"');
  });

  it("mirrors the app's endpoint policy and names only the transport class", () => {
    expect(values([
      { fn: "endpoint_policy_issue", args: ["http://203.0.113.5:8000/v1", null, false] }, { fn: "endpoint_policy_issue", args: ["http://203.0.113.5:8000/v1", "local_zero_cost", false] },
      { fn: "endpoint_policy_issue", args: ["http://203.0.113.5:8000/v1", "local_zero_cost", true] }, { fn: "endpoint_policy_issue", args: ["https://box.example:8443/v1", "local_zero_cost", false] },
      { fn: "endpoint_policy_issue", args: ["http://127.0.0.1:8000/v1", null, false] }, { fn: "endpoint_policy_issue", args: ["http://localhost:8000/v1", null, false] }, { fn: "endpoint_policy_issue", args: ["ftp://x/v1", null, false] },
    ])).toEqual([expect.stringContaining("SOAR_VLLM_COST_POLICY=local_zero_cost"), expect.stringContaining("SOAR_ALLOW_INSECURE_VLLM_HTTP=true"), null, null, null, null, expect.stringContaining("not a valid")]);
    expect(values([{ fn: "transport_class", args: ["http://127.0.0.1:8000/v1"] }, { fn: "transport_class", args: ["http://[::1]:8000/v1"] }, { fn: "transport_class", args: ["http://203.0.113.5:8000/v1"] }, { fn: "transport_class", args: ["https://box.example/v1"] }]))
      .toEqual(["loopback", "loopback", "plain_http", "https"]);
    expect(one("load_config", {}, join(root, "missing.env"))).toMatchObject({ ok: false, error: "ConfigError" });
    expect(values([{ fn: "load_config", args: [{ SOAR_VLLM_BASE_URL: "http://127.0.0.1:8000/v1/", SOAR_VLLM_COST_POLICY: "local_zero_cost" }, null] }])[0])
      .toEqual({ base: "http://127.0.0.1:8000/v1", key: null, model: null, cost_policy: "local_zero_cost", allow_insecure: false });
  });

  it("derives the adapter verdict and the reasoning-field names the way flash-next-reply.ts reads them", () => {
    const json = (thinking: boolean) => ({ status: 200, finish_reason: "stop", model_matches: true, reasoning_field: thinking ? "reasoning_content" : "none", reasoning_bytes: thinking ? 900 : 0, content_bytes: 20, leading_think_tag: false });
    const sse = (thinking: boolean) => ({ status: 200, finish_reason: "stop", model_chunks: 4, model_mismatch_chunks: 0, reasoning_field: thinking ? "reasoning_content" : "none", reasoning_bytes: thinking ? 900 : 0, content_bytes: 20, leading_think_tag: false });
    const good = { thinking_on_json: json(true), thinking_on_sse: sse(true), thinking_off_json: json(false), thinking_off_sse: sse(false), preserve_thinking: { accepted: true } };
    const [verdict] = values([{ fn: "adapter_verdict", args: [good] }]);
    expect(verdict).toMatchObject({ legacy_consistent: true, flash_next_v1_consistent: true });
    const wrapper = { ...good, thinking_on_sse: { ...sse(true), leading_think_tag: true } };
    const leak = { ...good, thinking_off_json: { ...json(false), reasoning_field: "reasoning", reasoning_bytes: 12 } };
    const noModel = { ...good, thinking_off_sse: { ...sse(false), model_chunks: 0 } };
    const mixed = { ...good, thinking_on_sse: { ...sse(true), reasoning_field: "reasoning" } };
    const rejected = { ...good, thinking_on_json: { ...json(true), status: 400, finish_reason: null, content_bytes: null } };
    const verdicts = values([wrapper, leak, noModel, mixed, rejected].map(adapter => ({ fn: "adapter_verdict", args: [adapter] })));
    expect(verdicts.map(v => [v.legacy_consistent, v.flash_next_v1_consistent])).toEqual([[true, false], [true, false], [true, false], [true, false], [false, false]]);
    expect(verdicts[0].checks.no_leading_think_tag).toBe(false); expect(verdicts[1].checks.no_reasoning_under_thinking_off).toBe(false); expect(verdicts[3].checks.one_reasoning_field).toBe(false);
    expect(values([{ fn: "reasoning_field_of", args: [{ reasoning_content: "x" }] }, { fn: "reasoning_field_of", args: [{ reasoning: "x" }] }, { fn: "reasoning_field_of", args: [{ reasoning: "x", reasoning_content: "y" }] }, { fn: "reasoning_field_of", args: [{ reasoning: "" }] }]))
      .toEqual(["reasoning_content", "reasoning", "mixed", "none"]);
    expect(values([{ fn: "leading_think_tag", args: ["<think>hi"] }, { fn: "leading_think_tag", args: ["  </think>"] }, { fn: "leading_think_tag", args: ["<think class=x>"] }, { fn: "leading_think_tag", args: ["ok <think>"] }, { fn: "leading_think_tag", args: [""] }, { fn: "leading_think_tag", args: [null] }]))
      .toEqual([true, true, true, false, false, false]);
  });

  it("builds both response_format variants, picks the accepted one, and counts cells including grammar-suppressed thinking", () => {
    const [strict, loose] = values([{ fn: "response_format", args: ["plan", { type: "object" }, true] }, { fn: "response_format", args: ["extract", { type: "object" }, false] }]);
    expect(strict).toEqual({ type: "json_schema", json_schema: { name: "research_plan", strict: true, schema: { type: "object" } } });
    expect(loose).toEqual({ type: "json_schema", json_schema: { name: "research_extraction", schema: { type: "object" } } });
    expect(values([
      { fn: "choose_variant", args: [{ strict: { accepted: true }, non_strict: { accepted: true } }, true] }, { fn: "choose_variant", args: [{ strict: { accepted: false }, non_strict: { accepted: true } }, true] },
      { fn: "choose_variant", args: [{ strict: { accepted: false }, non_strict: { accepted: false } }, true] }, { fn: "choose_variant", args: [{ strict: { accepted: true }, non_strict: { accepted: false } }, false] },
    ])).toEqual([true, false, true, true]);
    const calls = [{ status: 200, classification: "valid", elapsed_s: 10, completion_tokens: 300, reasoning_tokens: 0 }, { status: 200, classification: "truncated", elapsed_s: 30, completion_tokens: 8192, reasoning_tokens: 7000 },
      { status: 400, classification: "request_rejected", elapsed_s: 0.1 }, { status: 200, classification: "unassessed", elapsed_s: 12, completion_tokens: 400, reasoning_tokens: null }];
    expect(values([{ fn: "summarize_cell", args: [calls, "on"] }])[0]).toEqual({ request_rejected: 1, truncated: 1, invalid_json: 0, schema_invalid: 0, binding_invalid: 0, valid: 1, unassessed: 1, total: 4,
      median_elapsed_s: 11, max_elapsed_s: 30, median_completion_tokens: 400, thinking_on_zero_reasoning: 1, reasoning_tokens_unreported: 1 });
    expect(values([{ fn: "summarize_cell", args: [calls, "off"] }])[0]).not.toHaveProperty("thinking_on_zero_reasoning");
  });

  it("refuses to run before any request without a base, with a non-loopback base lacking the cost policy, with an unknown probe, or P10 without schemas", () => {
    const missing = probe(["--only", "P1"], {});
    expect(missing.status).toBe(2); expect(missing.stderr).toContain("SOAR_VLLM_BASE_URL is not set");
    // TEST-NET-3 is unroutable, and the refusal precedes any socket: the address must not appear in the output either.
    const policy = probe(["--only", "P1"], { SOAR_VLLM_BASE_URL: "http://203.0.113.5:8000/v1" });
    expect(policy.status).toBe(2); expect(policy.stderr).toContain("SOAR_VLLM_COST_POLICY=local_zero_cost"); expect(policy.stdout + policy.stderr).not.toContain("203.0.113.5");
    const insecure = probe(["--only", "P1"], { SOAR_VLLM_BASE_URL: "http://203.0.113.5:8000/v1", SOAR_VLLM_COST_POLICY: "local_zero_cost" });
    expect(insecure.status).toBe(2); expect(insecure.stderr).toContain("SOAR_ALLOW_INSECURE_VLLM_HTTP=true");
    const unknown = probe(["--only", "P1,Px"], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1" });
    expect(unknown.status).toBe(2); expect(unknown.stderr).toContain("unknown probe");
    const schemas = probe(["--only", "P10", "--schemas", join(root, "absent.json")], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1" });
    expect(schemas.status).toBe(2); expect(schemas.stderr).toContain("P10 needs the role schemas");
    expect(probe(["--p11-ks", "0"], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1" }).status).toBe(2);
  });
});

describe("P10-align: the pipeline's own request bodies (BL-20261113-1011-p10-align-design)", () => {
  const exported = (streamingEnabled: boolean) => buildRoleSchemaExport("2026-11-13T00:00:00.000Z", { vllm: { model: "Synthetic" }, streamingEnabled });
  /** python3 -I without blocking the event loop, so a loopback server in this process can answer the probe. */
  function python(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((done, fail) => {
      const child = spawn("python3", ["-I", ...args], { env: { PATH: process.env.PATH ?? "" } });
      let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", fail); child.on("close", code => done({ code, stdout, stderr })); child.stdin.end();
    });
  }

  it("takes each body from the export, adds only response_format, and reassembles a streamed reply into a plain one", () => {
    const data = JSON.parse(JSON.stringify(exported(true)));
    const [bodies] = values([{ fn: "p10_bodies", args: [data, "Synthetic"] }]);
    for (const role of P10_ROLES) for (const mode of P10_THINKING_MODES) expect(bodies[role][mode]).toEqual(data.requests[role][mode].body);
    // Refused before any request: an older export, no bodies, another model, a missing cell, and a body that already sets response_format.
    const planOn = data.requests.plan.on;
    const refused = run([{ fn: "p10_bodies", args: [{ ...data, version: 1 }, "Synthetic"] }, { fn: "p10_bodies", args: [{ ...data, requests: null }, null] },
      { fn: "p10_bodies", args: [data, "Another"] }, { fn: "p10_bodies", args: [{ ...data, requests: { ...data.requests, extract: { on: data.requests.extract.on } } }, null] },
      { fn: "p10_bodies", args: [{ ...data, requests: { ...data.requests, plan: { ...data.requests.plan, on: { ...planOn, body: { ...planOn.body, response_format: {} } } } } }, null] }]);
    expect(refused.map(r => [r.ok, r.error])).toEqual(Array(5).fill([false, "ConfigError"]));
    expect(refused[0]!.message).toContain("role export version 2"); expect(refused[2]!.message).toContain("another model"); expect(refused[3]!.message).toContain("extract/off");
    const [body] = values([{ fn: "p10_request_body", args: [planOn.body, "plan", { type: "object" }, true] }]);
    const { response_format: format, ...rest } = body;
    expect(rest).toEqual(planOn.body); expect(format).toEqual({ type: "json_schema", json_schema: { name: "research_plan", strict: true, schema: { type: "object" } } });
    const chunk = (delta: object, extra: object = {}) => `data: ${JSON.stringify({ model: "Synthetic", choices: [{ index: 0, delta, ...extra }] })}`;
    const lines = [": keep-alive", chunk({ role: "assistant" }), chunk({ reasoning_content: "thinking " }), chunk({ reasoning_content: "more" }), chunk({ content: "{\"version\":" }),
      chunk({ content: "2}" }, { finish_reason: "stop" }), `data: ${JSON.stringify({ model: "Synthetic", choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}`, "data: [DONE]", chunk({ content: "after DONE" })];
    const [[reply, chunks]] = values([{ fn: "reassemble_stream", args: [lines] }]);
    expect(chunks).toBe(6);
    expect(reply).toEqual({ object: "chat.completion", model: "Synthetic", usage: { prompt_tokens: 11, completion_tokens: 7 },
      choices: [{ index: 0, message: { role: "assistant", content: "{\"version\":2}", reasoning_content: "thinking more" }, finish_reason: "stop" }] });
    expect(run([{ fn: "reassemble_stream", args: [["data: {not json"]] }])[0]).toMatchObject({ ok: false, error: "JSONDecodeError" });
  });

  it("refuses at start-up, before any request, an export without bodies or with another model than the configured one", () => {
    const dir = mkdtempSync(join(root, "p10-refuse-")), old = join(dir, "old.json"), current = join(dir, "current.json");
    const data = exported(true); writeFileSync(old, JSON.stringify({ ...data, version: 1, requests: undefined })); writeFileSync(current, JSON.stringify(data));
    const stale = probe(["--only", "P10", "--schemas", old], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1" });
    expect(stale.status).toBe(2); expect(stale.stderr).toContain("role export version 2");
    const other = probe(["--only", "P10", "--schemas", current], { SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Another" });
    expect(other.status).toBe(2); expect(other.stderr).toContain("another model");
  });

  it("sends each cell the exported body plus response_format on a loopback server, streamed or not, and retains replies the assessor reads", async () => {
    for (const streamingEnabled of [true, false]) {
      const data = exported(streamingEnabled), dir = mkdtempSync(join(root, "p10-run-")), schemasPath = join(dir, "role-schemas.json");
      writeFileSync(schemasPath, JSON.stringify(data));
      const received: Record<string, unknown>[] = [], content = "{\"version\":2}";
      const server = http.createServer((request, response) => {
        let raw = ""; request.on("data", piece => { raw += piece; }); request.on("end", () => {
          if (request.method === "GET") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id: "Synthetic", max_model_len: 262144 }] })); return; }
          const body = JSON.parse(raw) as Record<string, unknown>; received.push(body);
          if (body.stream === true) {
            response.setHeader("content-type", "text/event-stream");
            for (const piece of [{ choices: [{ index: 0, delta: { content: content.slice(0, 5) } }] }, { choices: [{ index: 0, delta: { content: content.slice(5) }, finish_reason: "stop" }] },
              { choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }]) response.write(`data: ${JSON.stringify({ model: "Synthetic", ...piece })}\n\n`);
            response.end("data: [DONE]\n\n");
          } else {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ model: "Synthetic", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 4 } }));
          }
        });
      });
      await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
      try {
        const port = (server.address() as AddressInfo).port;
        const driver = ["import importlib.util, json, sys", "spec = importlib.util.spec_from_file_location('serving_probe', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
          "ep = m.Endpoint({'base': f'http://127.0.0.1:{sys.argv[2]}/v1', 'model': 'Synthetic', 'key': None})",
          "ctx = {'args': m.parse_args(['--p10-calls', '2']), 'schemas': json.load(open(sys.argv[3])), 'run_dir': sys.argv[4]}",
          "print(json.dumps(m.probe_p10(ep, {}, ctx)))"].join("\n");
        const result = await python(["-c", driver, SCRIPT, String(port), schemasPath, dir]);
        expect(result.code).toBe(0);
        const p10 = JSON.parse(result.stdout);
        // Per role: the two 16-token acceptance requests, then two calls per mode; every cell call is the exported body with the strict format only.
        expect(received).toHaveLength(18);
        let index = 0;
        for (const role of P10_ROLES) {
          expect(received.slice(index, index + 2).map(body => body.max_tokens)).toEqual([16, 16]); index += 2;
          for (const mode of P10_THINKING_MODES) for (let call = 0; call < 2; call++) {
            const { response_format: format, ...rest } = received[index++]!;
            expect(canonical(rest)).toBe(canonical(data.requests[role][mode].body));
            expect((format as { json_schema: { strict?: boolean } }).json_schema.strict).toBe(true);
          }
          for (const mode of P10_THINKING_MODES) {
            const cell = p10.cells[`${role}/${mode}`];
            expect(cell).toMatchObject({ streamed: streamingEnabled, request_body_sha256: data.requests[role][mode].bodySha256, max_tokens: data.requests[role][mode].body.max_tokens, strict: true });
            expect(cell.calls.map((call: { classification: string; status: number }) => [call.status, call.classification])).toEqual([[200, "unassessed"], [200, "unassessed"]]);
            if (streamingEnabled) expect(cell.calls.every((call: { stream_chunks?: number }) => call.stream_chunks === 3)).toBe(true);
            else expect(cell.calls.some((call: object) => "stream_chunks" in call)).toBe(false);
          }
        }
        expect(p10).toMatchObject({ export_version: 2, request_settings: data.requestSettings });
        // The retained replies are plain chat completions with the joined content, which the assessor reads with no change.
        const first = JSON.parse(readFileSync(join(dir, "p10", p10.cells["plan/on"].calls[0].reply_file), "utf8"));
        expect(first.choices[0]).toMatchObject({ message: { content }, finish_reason: "stop" });
        writeFileSync(join(dir, "probe.json"), JSON.stringify({ probe_version: 2, P10: p10 }));
        const summary = assessProbeFile(join(dir, "probe.json"));
        for (const role of P10_ROLES) for (const mode of P10_THINKING_MODES) expect(summary.cells[`${role}/${mode}`]).toMatchObject({ total: 2, unassessed: 0, request_rejected: 0 });
      } finally {
        await new Promise<void>(closed => { server.closeAllConnections(); server.close(() => closed()); });
      }
    }
  }, 60_000);
});
