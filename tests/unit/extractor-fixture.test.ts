import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PrivateAgentBroker } from "../../src/main/private-agent/broker";
import { canonical, digest } from "../../src/main/private-agent/contracts";
import { PrivateAgentModel, vllmCacheSalt } from "../../src/main/private-agent/model";
import { COORDINATOR_PROFILES } from "../../src/main/private-agent/profiles";
import { EXTRACT_SYSTEM, OUTPUT_TOKENS, THINKING, assessResearchExtractionReply, researchProtocolSha256 } from "../../src/main/private-agent/research-pipeline";
import type { RequestSettings } from "../../scripts/export-role-schemas";
import { CONDITION_CALLS, EXTRACTOR_CONDITIONS, FIXTURE_JOB_ID, buildExtractorRequests, runExtractorFixture, verifyExtractorInputs,
  type ExtractorFixtureInputs } from "../../scripts/extractor-fixture";
import { buildLocalScreenModelConfig } from "../../scripts/private-agent-local-screen";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); });
const ROOT = resolve(__dirname, "..", "..");
const EXPERIMENTS = join(ROOT, "docs", "experiments");
const QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5"];
const LEGACY: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: false };
const STREAMED: RequestSettings = { vllm: { model: "Synthetic" }, streamingEnabled: true };
const FLASH: RequestSettings = { vllm: { model: "Synthetic", localReplyContract: "flash_next_v1", localContextTokens: 262144 }, streamingEnabled: false };
// Quotes copied from the committed sources, with the lines they sit on.
const NOTICE_BUILT = "Between 3 March and 29 August 2033 the contractor built 140 metres of stepped concrete seawall with a recurved crest.";
const NOTICE_COST = "The trial cost 2.6 million crowns.";
const LOG_CALIBRATION = "G3 readings before that date may read about 15 per cent high.";
const REPORT_COST = "The Board's final account for the trial was 2.9 million crowns.";

/** The committed manifest and corpus, read as the command line reads them. */
function committed(): ExtractorFixtureInputs {
  const bytes = readFileSync(join(EXPERIMENTS, "e0-extractor-fixture-v1.json"));
  return { manifest: JSON.parse(bytes.toString("utf8")), manifestSha256: digest(bytes), read: path => readFileSync(join(EXPERIMENTS, path)) };
}
/** The committed inputs with the manifest changed and some files replaced; the recorded digest follows the manifest. */
function inputsWith(mutate: (manifest: Record<string, any>) => void, files: Record<string, Buffer> = {}): ExtractorFixtureInputs {
  const base = committed(), manifest = structuredClone(base.manifest) as Record<string, any>;
  mutate(manifest);
  return { manifest, manifestSha256: digest(canonical(manifest)), read: path => files[path] ?? base.read(path) };
}
const extraction = (statuses: Record<string, string>, quotes: { quote: string; questionIds: string[]; note?: string }[] = [], ids = QUESTIONS) =>
  JSON.stringify({ questions: ids.map(id => ({ questionId: id, status: statuses[id] ?? "no_verified_evidence" })), quotes, conflicts: [] });
const completion = (content: string, finish = "stop", message: Record<string, unknown> = {}) => ({ id: "x", object: "chat.completion", model: "Synthetic",
  choices: [{ index: 0, message: { role: "assistant", content, ...message }, finish_reason: finish }],
  usage: { prompt_tokens: 1500, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: 0 } } });
/** A streamed reply as vLLM sends it: content deltas, the finish reason, the usage chunk, then [DONE] unless `cut`. */
const sse = (content: string, finish = "stop", cut = false) => {
  const half = Math.floor(content.length / 2), chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
  return [chunk({ id: "x", model: "Synthetic", choices: [{ index: 0, delta: { content: content.slice(0, half) }, finish_reason: null }] }),
    chunk({ id: "x", model: "Synthetic", choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: finish }] }),
    ...(cut ? [] : [chunk({ id: "x", model: "Synthetic", choices: [], usage: { prompt_tokens: 1500, completion_tokens: 90 } }), "data: [DONE]\n\n"])];
};

type Reply = { status?: number; raw?: string; json?: unknown; sse?: string[] };
/** A loopback fake of the chat-completions route: it answers a scripted reply per call and records every request. */
async function fakeServer(script: (ordinal: number, body: Record<string, unknown>) => Reply) {
  const requests: { url: string; headers: IncomingHttpHeaders; raw: string; body: Record<string, unknown> }[] = [];
  const server: Server = createServer((request, response) => {
    let data = ""; request.setEncoding("utf8"); request.on("data", part => { data += part; });
    request.on("end", () => {
      const body = JSON.parse(data) as Record<string, unknown>; requests.push({ url: request.url ?? "", headers: request.headers, raw: data, body });
      const reply = script(requests.length, body);
      if (reply.sse) { response.writeHead(200, { "content-type": "text/event-stream" }); response.end(reply.sse.join("")); return; }
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" }); response.end(reply.raw ?? JSON.stringify(reply.json));
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  return { requests, baseUrl: `http://127.0.0.1:${port}/v1`, port };
}
function tempDir() { const root = mkdtempSync(join(tmpdir(), "soar-extractor-fixture-")); cleanups.push(() => rmSync(root, { recursive: true, force: true })); return root; }

describe("E0 extractor fixture: inputs and requests", () => {
  it("verifies the committed corpus against its pinned manifest: five units, an accepted plan, and three single-chunk sources", () => {
    const fixture = verifyExtractorInputs(committed());
    expect(fixture.manifest).toMatchObject({ schemaVersion: 1, name: "e0-extractor-fixture-v1", status: "pinned", conditions: [...EXTRACTOR_CONDITIONS], repeats: 10 });
    expect(fixture.units.map(unit => unit.id)).toEqual(["U1", "U2", "U3", "U4", "U5"]);
    expect(fixture.plan.questions.map(question => question.id)).toEqual(QUESTIONS); expect([...fixture.questions]).toEqual(QUESTIONS);
    expect(fixture.chunks.map(chunk => [chunk.chunkId, chunk.sourceId, chunk.bytes, chunk.startLine])).toEqual([
      ["S1C1", "input/corpus/board-notice.md", 1745, 1], ["S2C1", "input/corpus/gauge-log.md", 62694, 1], ["S3C1", "input/corpus/monitoring-report.md", 6691, 1]]);
    // The stage's layout: the stable packet line, then the chunk line with repairReason null.
    for (const chunk of fixture.chunks) {
      const [stable, perChunk] = chunk.userContent.split("\n").map(line => JSON.parse(line));
      expect(Object.keys(stable).sort()).toEqual(["brief", "plan", "units"]); expect(stable.brief).toBe(fixture.brief);
      expect(perChunk).toEqual({ chunk: { endByte: chunk.bytes, id: chunk.chunkId, startByte: 0, text: chunk.text }, repairReason: null, source: { id: chunk.sourceId, sha256: chunk.sourceSha256 } });
    }
    expect(fixture.chunks.map(chunk => Buffer.byteLength(chunk.userContent))).toEqual([5109, 66709, 10116]);
  });

  it("refuses every input that differs from the pin before any request is sent or any file is written", async () => {
    const server = await fakeServer(() => ({ json: completion(extraction({})) })), out = join(tempDir(), "run");
    const attempt = (inputs: ExtractorFixtureInputs, target = out) => runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: LEGACY, inputs, out: target });
    const notice = readFileSync(join(EXPERIMENTS, "e0-extractor-fixture-v1", "sources", "board-notice.md"));
    await expect(attempt(inputsWith(m => { m.status = "template"; }))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.extra = true; }))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.conditions = ["thinking-off", "thinking-off"]; }))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.conditions = ["thinking-medium"]; }))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.corpus = "../e0-extractor-fixture-v1"; }))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.sources[0].file = "/etc/hosts"; }))).rejects.toThrow("extractor_fixture_manifest_invalid");
    await expect(attempt(inputsWith(m => { m.brief.sha256 = "0".repeat(64); }))).rejects.toThrow("extractor_fixture_brief_mismatch");
    await expect(attempt(inputsWith(m => { m.plan.bytes += 1; }))).rejects.toThrow("extractor_fixture_plan_mismatch");
    await expect(attempt(inputsWith(m => { m.sources[2].sha256 = "0".repeat(64); }))).rejects.toThrow("extractor_fixture_source_mismatch");
    await expect(attempt(inputsWith(m => { m.sources[1].file = "sources/absent.md"; }))).rejects.toThrow("extractor_fixture_source_missing");
    await expect(attempt(inputsWith(m => { m.units = ["U1", "U2", "U3", "U4"]; }))).rejects.toThrow("extractor_fixture_units_mismatch");
    await expect(attempt(inputsWith(m => { m.sources[0].chunkId = "S2C1"; }))).rejects.toThrow("extractor_fixture_chunk_mismatch");
    // A plan the pipeline's plan assessor rejects (an unknown source id), pinned by its own hash.
    const plan = JSON.parse(readFileSync(join(EXPERIMENTS, "e0-extractor-fixture-v1", "plan.json"), "utf8"));
    plan.questions[0].sourceIds = ["input/corpus/unlisted.md"];
    const badPlan = Buffer.from(JSON.stringify(plan));
    await expect(attempt(inputsWith(m => { m.plan = { file: "plan-bad.json", sha256: digest(badPlan), bytes: badPlan.length }; },
      { "e0-extractor-fixture-v1/plan-bad.json": badPlan }))).rejects.toThrow("extractor_fixture_plan_rejected");
    // A source longer than one chunk (65,536 bytes), pinned by its own hash, is not one chunk.
    const long = Buffer.concat([notice, Buffer.from(`${"Synthetic filler line for the chunk test.\n".repeat(1700)}`)]);
    expect(long.length).toBeGreaterThan(65536);
    await expect(attempt(inputsWith(m => { m.sources[0] = { ...m.sources[0], file: "sources/long.md", sha256: digest(long), bytes: long.length }; },
      { "e0-extractor-fixture-v1/sources/long.md": long }))).rejects.toThrow("extractor_fixture_chunk_mismatch");
    // An existing out directory is never reused.
    const existing = join(tempDir(), "existing"); mkdirSync(existing);
    await expect(attempt(committed(), existing)).rejects.toThrow("extractor_fixture_out_exists"); expect(readdirSync(existing)).toEqual([]);
    expect(server.requests).toHaveLength(0); expect(existsSync(out)).toBe(false);
  });

  it("sends the stage's own extraction request: thinking-off is byte for byte what the model layer sends for the stage's call", async () => {
    // thinking-off is the stage's call because the stage's extraction thinking is disabled at OUTPUT_TOKENS.extract.
    expect(THINKING.extract).toBe("disabled");
    expect(CONDITION_CALLS).toEqual({ "thinking-off": { thinking: "disabled", maxOutputTokens: OUTPUT_TOKENS.extract }, "thinking-on": { maxOutputTokens: 2048 }, "thinking-on-8192": { maxOutputTokens: 8192 } });
    const fixture = verifyExtractorInputs(committed());
    for (const settings of [LEGACY, STREAMED, FLASH]) {
      const requests = buildExtractorRequests(fixture, settings);
      expect(requests.map(r => `${r.chunkId}/${r.condition}`)).toEqual(fixture.chunks.flatMap(c => EXTRACTOR_CONDITIONS.map(condition => `${c.chunkId}/${condition}`)));
      for (const chunk of fixture.chunks) {
        // The body the pipeline's call() makes for an extraction (its thinking override and cap), captured from PrivateAgentModel with a fake broker.
        let captured = "";
        const broker = { request: async (request: { body: string }, settle: (bytes: Buffer) => number) => { captured = request.body;
          const bytes = Buffer.from(JSON.stringify(completion("{}"))); return { bytes, receipt: { feeMicrousd: settle(bytes) } }; } };
        const config = buildLocalScreenModelConfig({ vllm: settings.vllm as never, streamingEnabled: settings.streamingEnabled }, COORDINATOR_PROFILES.heavy, true);
        await new PrivateAgentModel(broker as unknown as PrivateAgentBroker, config, FIXTURE_JOB_ID, "reader").complete([{ role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: chunk.userContent }], [], new AbortController().signal, { thinking: "disabled", maxOutputTokens: OUTPUT_TOKENS.extract, purpose: "research evidence extraction" });
        const off = requests.find(r => r.chunkId === chunk.chunkId && r.condition === "thinking-off")!;
        expect(off.body).toBe(captured); expect(off.bodySha256).toBe(digest(captured)); expect(off.streamed).toBe(settings.streamingEnabled);
      }
    }
    const legacy = Object.fromEntries(buildExtractorRequests(fixture, LEGACY).filter(r => r.chunkId === "S2C1").map(r => [r.condition, JSON.parse(r.body)]));
    const salt = vllmCacheSalt(FIXTURE_JOB_ID);
    expect(legacy["thinking-off"]).toMatchObject({ model: "Synthetic", stream: false, max_tokens: 2048, chat_template_kwargs: { enable_thinking: false }, cache_salt: salt });
    expect(legacy["thinking-off"]).not.toHaveProperty("reasoning_effort");
    expect(legacy["thinking-on"]).toMatchObject({ stream: false, max_tokens: 2048, reasoning_effort: "medium", temperature: 1, top_p: 0.95, top_k: 20, cache_salt: salt });
    expect(legacy["thinking-on"]).not.toHaveProperty("chat_template_kwargs");
    expect(legacy["thinking-on-8192"]).toMatchObject({ max_tokens: 8192, reasoning_effort: "medium", cache_salt: salt });
    expect(legacy["thinking-off"].messages).toEqual([{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: fixture.chunks[1]!.userContent }]);
    const flash = buildExtractorRequests(fixture, FLASH).find(r => r.chunkId === "S1C1" && r.condition === "thinking-on")!;
    expect(JSON.parse(flash.body)).toMatchObject({ chat_template_kwargs: { enable_thinking: true, preserve_thinking: false }, reasoning_effort: "medium" });
  });
});

describe("E0 extractor fixture: a run against a loopback endpoint", () => {
  it("runs repeat by repeat, judges each reply with the stage's own checks, retains raw replies 0600 and keeps codes and hashes only", async () => {
    let out = "";
    const seen: number[] = [];
    // Ordinals 1 to 9 are the first repeat: S1C1, S2C1 and S3C1, each under thinking-off, thinking-on and thinking-on-8192.
    const script = (ordinal: number): Reply => {
      seen.push((JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as { calls: unknown[] }).calls.length);
      switch (ordinal) {
        case 1: return { json: completion(extraction({ Q1: "evidence_found", Q4: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }, { quote: NOTICE_COST, questionIds: ["Q4"] }])) };
        case 2: return { json: completion(extraction({ Q1: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }, { quote: "The trial cost 3 million crowns.", questionIds: ["Q4"] }]),
          "stop", { reasoning_content: "hidden thoughts" }) };
        case 3: return { json: completion(extraction({ Q4: "evidence_found" }, [{ quote: "The trial cost 3 million crowns.", questionIds: ["Q4"] }])) };
        case 4: return { json: completion(extraction({ Q5: "needs_followup" })) };
        case 5: return { json: completion(extraction({}, [], ["Q1", "Q2", "Q3", "Q4"])) };
        case 6: return { json: completion(extraction({ Q5: "evidence_found" }, [{ quote: LOG_CALIBRATION, questionIds: ["Q5"], note: "n".repeat(201) }])) };
        case 7: return { json: completion(extraction({}).slice(0, 40), "length") };
        case 8: return { status: 400, raw: "{\"error\":\"bad request\"}" };
        case 9: return { raw: "not json" };
        default: return { json: completion(extraction(ordinal % 3 === 0 ? { Q4: "evidence_found" } : {}, ordinal % 3 === 0 && ordinal >= 16 ? [{ quote: REPORT_COST, questionIds: ["Q4"] }] : [])) };
      }
    };
    const server = await fakeServer(script);
    out = join(tempDir(), "e0-extractor-fixture-test");
    const inputs = inputsWith(m => { m.repeats = 2; });
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl, apiKey: "test-key" }, settings: LEGACY, inputs, out });
    const fixture = verifyExtractorInputs(inputs);
    expect(server.requests).toHaveLength(18); expect(seen).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(server.requests.every(r => r.url === "/v1/chat/completions" && r.headers.authorization === "Bearer test-key")).toBe(true);
    // Repeat-major order, each request's bytes exactly the built body.
    const order = [1, 2].flatMap(repeat => fixture.chunks.flatMap(c => EXTRACTOR_CONDITIONS.map(condition => ({ repeat, chunkId: c.chunkId, condition }))));
    expect(summary.calls.map(c => ({ repeat: c.repeat, chunkId: c.chunkId, condition: c.condition }))).toEqual(order);
    server.requests.forEach((request, i) => expect(digest(request.raw)).toBe(summary.requests[order[i]!.chunkId]![order[i]!.condition]!.bodySha256));
    expect(summary).toMatchObject({ version: 1, dryRun: false, protocolSha256: researchProtocolSha256(), conditions: [...EXTRACTOR_CONDITIONS], repeats: 2, order: "repeat_chunk_condition",
      requestSettings: { model: "Synthetic", streaming: false, localReplyContract: null, localContextTokens: null, profile: "heavy", cacheSalt: true },
      manifest: { name: "e0-extractor-fixture-v1", sha256: inputs.manifestSha256, corpus: "e0-extractor-fixture-v1", units: ["U1", "U2", "U3", "U4", "U5"] } });
    const [kept, drops, held, followup, mismatch, tooBig, truncated, rejected, malformed] = summary.calls;
    expect(kept).toMatchObject({ classification: "complete", keptWithDrops: false, reasons: [], quotes: { given: 2, kept: 2, dropped: 0 }, finishReason: "stop", status: 200,
      usage: { promptTokens: 1500, completionTokens: 90, cachedTokens: 1024, reasoningTokens: 0 }, reasoningField: "none", reasoningBytes: 0, replyFile: "S1C1-thinking-off-01.json",
      outcomes: { Q1: "evidence_retained", Q2: "no_verified_evidence", Q3: "no_verified_evidence", Q4: "evidence_retained", Q5: "no_verified_evidence" } });
    expect(drops).toMatchObject({ classification: "complete", keptWithDrops: true, reasons: [{ code: "quote_not_located", path: ["quotes", 1, "quote"] }], quotes: { given: 2, kept: 1, dropped: 1 },
      reasoningField: "reasoning_content", reasoningBytes: Buffer.byteLength("hidden thoughts") });
    expect(held).toMatchObject({ classification: "held", keptWithDrops: false, questionsDowngraded: 1, outcomes: { Q4: "no_verified_evidence" },
      reasons: [{ code: "quote_not_located", path: ["quotes", 0, "quote"] }, { code: "evidence_found_without_quote", path: ["questions", 3] }] });
    expect(followup).toMatchObject({ classification: "needs_followup", reasons: [{ code: "needs_followup", path: ["questions", 4] }], outcomes: { Q5: "needs_followup" } });
    expect(mismatch).toMatchObject({ classification: "invalid", reasons: [{ code: "question_set_mismatch", path: ["questions"] }] });
    expect(tooBig).toMatchObject({ classification: "invalid", reasons: [{ code: "schema_too_big", path: ["quotes", 0, "note"] }], quotes: { given: 0, kept: 0, dropped: 0 }, outcomes: {} });
    expect(truncated).toMatchObject({ classification: "truncated", finishReason: "length", reasons: [{ code: "truncated", path: [] }] });
    expect(rejected).toMatchObject({ classification: "request_rejected", status: 400, replyFile: "S3C1-thinking-on-01.json" }); expect(rejected).not.toHaveProperty("reasons");
    expect(malformed).toMatchObject({ classification: "malformed_reply", status: 200 }); expect(malformed).not.toHaveProperty("reasons");
    expect(summary.calls.slice(9).every(call => call.classification === "complete")).toBe(true);
    expect(summary.calls[17]).toMatchObject({ chunkId: "S3C1", condition: "thinking-on-8192", quotes: { given: 1, kept: 1, dropped: 0 }, outcomes: { Q4: "evidence_retained" } });
    expect(summary.counts.S1C1).toEqual({
      "thinking-off": { calls: 2, classes: { complete: 2 }, keptWithDrops: 0, reasons: {} },
      "thinking-on": { calls: 2, classes: { complete: 2 }, keptWithDrops: 1, reasons: { quote_not_located: 1 } },
      // The second repeat marks Q4 evidence_found with no quote: kept, with the status corrected.
      "thinking-on-8192": { calls: 2, classes: { held: 1, complete: 1 }, keptWithDrops: 1, reasons: { quote_not_located: 1, evidence_found_without_quote: 2 } } });
    expect(summary.counts.S3C1!["thinking-on"]).toEqual({ calls: 2, classes: { request_rejected: 1, complete: 1 }, keptWithDrops: 0, reasons: {} });
    // Raw replies are retained whole and owner-readable only; the summary binds each by digest and is rewritten whole after every call.
    expect(readdirSync(join(out, "replies"))).toHaveLength(18); expect(readdirSync(out).sort()).toEqual(["replies", "summary.json"]);
    for (const call of summary.calls) {
      const path = join(out, "replies", call.replyFile!);
      expect(statSync(path).mode & 0o777).toBe(0o600); expect(digest(readFileSync(path))).toBe(call.replySha256);
    }
    expect(statSync(join(out, "summary.json")).mode & 0o777).toBe(0o600); expect(statSync(join(out, "replies")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(summary)));
    const serialized = JSON.stringify(summary);
    for (const secret of ["127.0.0.1", String(server.port), "test-key", "hidden thoughts", "Halverstrand", "2.6 million crowns", "stepped concrete", "bad request"])
      expect(serialized).not.toContain(secret);
  });

  it("reads a streamed reply through the broker's assembler, and records a cut stream as malformed", async () => {
    const server = await fakeServer(ordinal => ({ sse: ordinal === 1 ? sse(extraction({ Q1: "evidence_found" }, [{ quote: NOTICE_BUILT, questionIds: ["Q1"] }]))
      : ordinal === 2 ? sse(extraction({}), "stop", true) : sse(extraction({}).slice(0, 30), "length") }));
    const out = join(tempDir(), "streamed");
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: STREAMED, inputs: inputsWith(m => { m.conditions = ["thinking-off"]; m.repeats = 1; }), out });
    expect(server.requests.map(r => r.body.stream)).toEqual([true, true, true]);
    expect(server.requests.every(r => r.headers.authorization === undefined)).toBe(true);
    expect(summary.calls.map(c => c.classification)).toEqual(["complete", "malformed_reply", "truncated"]);
    expect(summary.calls[0]).toMatchObject({ replyFile: "S1C1-thinking-off-01.sse", quotes: { kept: 1 }, usage: { promptTokens: 1500, completionTokens: 90, cachedTokens: null, reasoningTokens: null } });
    expect(summary.calls[0]).not.toHaveProperty("reasoningField");
    expect(summary.calls[1]).toMatchObject({ streamError: "sse_truncated" }); expect(summary.calls[2]).toMatchObject({ finishReason: "length" });
    expect(readFileSync(join(out, "replies", "S1C1-thinking-off-01.sse"), "utf8")).toContain("data: [DONE]");
  });

  it("dry-runs: builds and hashes every body, sends nothing and writes nothing", async () => {
    const server = await fakeServer(() => ({ json: completion(extraction({})) })), out = join(tempDir(), "dry");
    const summary = await runExtractorFixture({ endpoint: { baseUrl: server.baseUrl }, settings: LEGACY, inputs: committed(), out, dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, calls: [], counts: {}, repeats: 10 });
    expect(Object.keys(summary.requests)).toEqual(["S1C1", "S2C1", "S3C1"]);
    expect(summary.requests.S2C1).toMatchObject({ "thinking-off": { maxTokens: 2048, thinking: "disabled", streamed: false }, "thinking-on": { maxTokens: 2048, thinking: "model" },
      "thinking-on-8192": { maxTokens: 8192, thinking: "model" } });
    expect(server.requests).toHaveLength(0); expect(existsSync(out)).toBe(false);
  });

  it("runs from the command line through loadConfig, prints no address, and refuses an out directory Git does not ignore", () => {
    const root = tempDir();
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SOAR_VLLM_BASE_URL: "http://127.0.0.1:9/v1", SOAR_VLLM_MODEL: "Synthetic", SOAR_ENV_FILE: join(root, "none.env") };
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/extractor-fixture.ts", "--dry-run"], { cwd: ROOT, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    const printed = JSON.parse(stdout);
    expect(printed).toMatchObject({ dryRun: true, conditions: [...EXTRACTOR_CONDITIONS], repeats: 10, chunks: ["S1C1", "S2C1", "S3C1"], retained: null });
    expect(stdout).not.toContain("127.0.0.1");
    const refused = spawnSync(process.execPath, ["--import", "tsx", "scripts/extractor-fixture.ts", "--out", join(root, "run")], { cwd: ROOT, encoding: "utf8", env });
    expect(refused.status).toBe(2); expect(refused.stderr.trim()).toBe("extractor_fixture_out_not_ignored"); expect(refused.stdout).toBe(""); expect(existsSync(join(root, "run"))).toBe(false);
  });
});

describe("assessResearchExtractionReply: the extraction stage's checks of one reply", () => {
  const text = "# Synthetic\nThe orchard recorded twelve healthy trees during the autumn survey.\nThe survey ran for three days in October.\n";
  const assess = (content: string, truncated = false) => assessResearchExtractionReply({ content, truncated, questions: new Set(["Q1", "Q2"]),
    source: { id: "input/corpus/alpha.md" }, chunk: { id: "S1C1", sourceSha256: "a".repeat(64), startLine: 10 }, chunkText: text });
  const reply = (questions: [string, string][], quotes: unknown[] = [], conflicts: unknown[] = []) =>
    JSON.stringify({ questions: questions.map(([questionId, status]) => ({ questionId, status })), quotes, conflicts });
  const ORCHARD = "The orchard recorded twelve healthy trees during the autumn survey.";

  it("keeps located quotes with the source line, and lets each outcome follow them", () => {
    const result = assess(reply([["Q1", "evidence_found"], ["Q2", "no_verified_evidence"]], [{ quote: `  ${ORCHARD}  `, questionIds: ["Q2", "Q1"], note: "both" }],
      [{ questionIds: ["Q1"], note: "none" }]));
    expect(result).toEqual({ state: "complete", reasons: [{ code: "no_verified_evidence_with_quote", path: ["questions", 1] }],
      quotes: [{ id: "", questionIds: ["Q1", "Q2"], sourceId: "input/corpus/alpha.md", sourceSha256: "a".repeat(64), chunkIds: ["S1C1"], locator: "line 11", quote: ORCHARD, note: "both" }],
      conflicts: [{ questionIds: ["Q1"], note: "none" }], outcomes: [{ questionId: "Q1", status: "evidence_retained" }, { questionId: "Q2", status: "evidence_retained" }],
      quotesDropped: 0, conflictsDropped: 0, notesCleared: 0, questionsDowngraded: 0, questionsUpgraded: 1, lostEvidence: false });
  });

  it("drops what it cannot verify, clears unencodable notes, and flags a question that lost every quote", () => {
    const lone = String.fromCharCode(0xd800);
    const result = assess(reply([["Q1", "evidence_found"], ["Q2", "evidence_found"]], [
      { quote: "orchard", questionIds: ["Q1"] }, { quote: "The orchard recorded thirteen healthy trees.", questionIds: ["Q1"] },
      { quote: ORCHARD, questionIds: ["Q2", "Q2"] }, { quote: "The survey ran for three days in October.", questionIds: ["Q3"] },
      { quote: "The survey ran for three days in October.", questionIds: ["Q2"], note: `bad ${lone}` }], [{ questionIds: ["Q9"], note: "x" }, { questionIds: ["Q1"], note: `bad ${lone}` }]));
    expect(result.state).toBe("complete"); expect(result.lostEvidence).toBe(true);
    expect(result.reasons.map(r => r.code)).toEqual(["quote_length", "quote_not_located", "duplicate_question_id", "unknown_question_id", "note_unencodable",
      "unknown_question_id", "note_unencodable", "evidence_found_without_quote"]);
    expect(result.reasons[0]).toEqual({ code: "quote_length", path: ["quotes", 0, "quote"], minimum: 12, maximum: 300 });
    expect(result).toMatchObject({ quotesDropped: 4, conflictsDropped: 2, notesCleared: 1, questionsDowngraded: 1, conflicts: [],
      outcomes: [{ questionId: "Q1", status: "no_verified_evidence" }, { questionId: "Q2", status: "evidence_retained" }] });
    expect(result.quotes).toHaveLength(1); expect(result.quotes[0]).toMatchObject({ questionIds: ["Q2"], note: "", locator: "line 12" });
  });

  it("gives truncated, invalid and needs_followup states, and judges quotes in any parsed reply", () => {
    expect(assess(reply([["Q1", "evidence_found"], ["Q2", "evidence_found"]]), true)).toMatchObject({ state: "truncated", reasons: [{ code: "truncated", path: [] }], outcomes: [] });
    expect(assess("not json")).toMatchObject({ state: "invalid", reasons: [{ code: "invalid_json", path: [] }], quotes: [] });
    expect(assess(JSON.stringify({ questions: [], quotes: [], conflicts: [] }))).toMatchObject({ state: "invalid", reasons: [{ code: "schema_too_small", path: ["questions"] }] });
    const wrongSet = assess(reply([["Q1", "evidence_found"]], [{ quote: "The orchard recorded nine trees.", questionIds: ["Q1"] }]));
    expect(wrongSet).toMatchObject({ state: "invalid", quotesDropped: 1, lostEvidence: false });
    expect(wrongSet.reasons.map(r => r.code)).toEqual(["question_set_mismatch", "quote_not_located", "evidence_found_without_quote"]);
    const followup = assess(reply([["Q1", "needs_followup"], ["Q2", "no_verified_evidence"]], [{ quote: ORCHARD, questionIds: ["Q1"] }]));
    expect(followup).toMatchObject({ state: "needs_followup", lostEvidence: false, outcomes: [{ questionId: "Q1", status: "needs_followup" }, { questionId: "Q2", status: "no_verified_evidence" }] });
    expect(followup.reasons).toEqual([{ code: "needs_followup", path: ["questions", 0] }]);
    expect(assess(reply([["Q1", "evidence_found"], ["Q1", "evidence_found"]]))).toMatchObject({ state: "invalid", reasons: [{ code: "question_set_mismatch", path: ["questions"] },
      { code: "evidence_found_without_quote", path: ["questions", 0] }, { code: "evidence_found_without_quote", path: ["questions", 1] }] });
  });
});
